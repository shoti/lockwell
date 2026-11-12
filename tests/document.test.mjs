// @ts-check
// SPDX-FileCopyrightText: 2026 Shota Mtvarelishvili <mtvarelishvili@proton.me>
// SPDX-License-Identifier: MIT
/**
 * @file Tests for the document metadata tool.
 * @author Shota Mtvarelishvili <mtvarelishvili@proton.me> (https://shoti.github.io/)
 */
/**
 * Document metadata tool. Office fixtures are real ZIP archives written here
 * with Node's own compressor (not the tool's writer), so reading and writing
 * are checked against an independent implementation.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { crc32 as nodeCrc32, deflateRawSync, inflateRawSync } from 'node:zlib';
import { crc32 } from '../src/client/bytes.mjs';
import { DocumentError, cleanName, hasFindings, inspectDocument, pdfString, readZip, unzip, writeZip, xmlText } from '../src/client/tool-document.mjs';

const encoder = new TextEncoder();

/**
 * A ZIP archive as office programs write them: compressed entries with dates,
 * extra fields, and (optionally) sizes stored after the data.
 * @param {Record<string, string>} files
 * @param {{ descriptors?: boolean, comment?: string }} [options]
 */
function zip(files, { descriptors = false, comment = '' } = {}) {
  /** @type {Buffer[]} */
  const parts = [];
  /** @type {Buffer[]} */
  const directory = [];
  let offset = 0;
  for (const [name, content] of Object.entries(files)) {
    const raw = Buffer.from(content);
    const data = deflateRawSync(raw);
    const nameBytes = Buffer.from(name);
    const extra = Buffer.from([0x55, 0x54, 5, 0, 1, 0x12, 0x34, 0x56, 0x67]); // a "last modified" timestamp
    const flags = descriptors ? 8 : 0;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(flags, 6);
    local.writeUInt16LE(8, 8);
    local.writeUInt16LE(0x7a3c, 10); // 15:17:56
    local.writeUInt16LE(0x5b69, 12); // 2025-11-09
    if (!descriptors) {
      local.writeUInt32LE(nodeCrc32(raw), 14);
      local.writeUInt32LE(data.length, 18);
      local.writeUInt32LE(raw.length, 22);
    }
    local.writeUInt16LE(nameBytes.length, 26);
    local.writeUInt16LE(extra.length, 28);
    const descriptor = Buffer.alloc(descriptors ? 16 : 0);
    if (descriptors) {
      descriptor.writeUInt32LE(0x08074b50, 0);
      descriptor.writeUInt32LE(nodeCrc32(raw), 4);
      descriptor.writeUInt32LE(data.length, 8);
      descriptor.writeUInt32LE(raw.length, 12);
    }
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(0x031e, 4); // made on Unix
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(flags, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt16LE(0x7a3c, 12);
    central.writeUInt16LE(0x5b69, 14);
    central.writeUInt32LE(nodeCrc32(raw), 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(raw.length, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt16LE(extra.length, 30);
    central.writeUInt32LE(0x81a40000, 38); // Unix permissions
    central.writeUInt32LE(offset, 42);
    parts.push(local, nameBytes, extra, data, descriptor);
    directory.push(central, nameBytes, extra);
    offset += local.length + nameBytes.length + extra.length + data.length + descriptor.length;
  }
  const directoryBytes = Buffer.concat(directory);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(files).length, 8);
  end.writeUInt16LE(Object.keys(files).length, 10);
  end.writeUInt32LE(directoryBytes.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(Buffer.byteLength(comment), 20);
  return new Uint8Array(Buffer.concat([...parts, directoryBytes, end, Buffer.from(comment)]));
}

const CORE = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
<dc:title>Draft &amp; notes</dc:title><dc:creator>Nino Beridze</dc:creator><cp:lastModifiedBy>Giorgi K.</cp:lastModifiedBy>
<cp:revision>14</cp:revision><cp:lastPrinted>2026-10-30T09:15:00Z</cp:lastPrinted>
<dcterms:created xsi:type="dcterms:W3CDTF">2026-10-01T08:00:00Z</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">2026-11-09T14:03:22Z</dcterms:modified>
<dc:subject></dc:subject></cp:coreProperties>`;
const APP = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Template>Newsroom.dotm</Template><TotalTime>372</TotalTime>
<Application>Microsoft Office Word</Application><Company>Example Media LLC</Company><AppVersion>16.0000</AppVersion></Properties>`;
const CUSTOM = '<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/custom-properties"><property fmtid="{x}" pid="2" name="CaseNumber"><vt:lpwstr>A-17</vt:lpwstr></property></Properties>';
const BODY = `<w:document><w:body><w:p><w:r><w:t>The text of the document, ${'word '.repeat(400)}</w:t></w:r></w:p><w:p><w:ins w:id="1" w:author="Nino Beridze" w:date="2026-11-09T14:00:00Z"><w:r><w:t>added later</w:t></w:r></w:ins></w:p></w:body></w:document>`;

const DOCX_FILES = {
  '[Content_Types].xml': '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>',
  '_rels/.rels': '<Relationships/>',
  'word/document.xml': BODY,
  'word/comments.xml': '<w:comments><w:comment w:author="Giorgi K."/></w:comments>',
  'word/media/ფოტო.png': 'not really a picture',
  'docProps/core.xml': CORE,
  'docProps/app.xml': APP,
  'docProps/custom.xml': CUSTOM,
};

describe('document tool: ZIP', () => {
  it('reads archives written by another program, whichever way sizes are stored', async () => {
    for (const descriptors of [false, true]) {
      const entries = readZip(zip(DOCX_FILES, { descriptors, comment: 'archive comment' }));
      assert.deepEqual(entries.map((entry) => entry.name), Object.keys(DOCX_FILES));
      const body = entries.find((entry) => entry.name === 'word/document.xml');
      assert.ok(body);
      assert.equal(new TextDecoder().decode(await unzip(body)), BODY);
      assert.equal(body.size, Buffer.byteLength(BODY));
    }
  });

  it('writes archives another program can read, with dates and extras removed', () => {
    const original = zip(DOCX_FILES, { descriptors: true, comment: 'made on Nino’s laptop' });
    const rewritten = writeZip(readZip(original));
    const view = new DataView(rewritten.buffer);

    // Walk the local headers the way an unzip program does.
    let at = 0;
    for (const [name, content] of Object.entries(DOCX_FILES)) {
      assert.equal(view.getUint32(at, true), 0x04034b50, `local header of ${name}`);
      assert.equal(view.getUint16(at + 6, true) & 8, 0, 'sizes are in the header, not after the data');
      assert.deepEqual([view.getUint16(at + 10, true), view.getUint16(at + 12, true)], [0, 0x0021], 'time and date reset to 1 January 1980');
      const [crc, compressed, size, nameLength, extraLength] = [view.getUint32(at + 14, true), view.getUint32(at + 18, true), view.getUint32(at + 22, true), view.getUint16(at + 26, true), view.getUint16(at + 28, true)];
      assert.equal(extraLength, 0, 'no extra field (it carried a timestamp)');
      assert.equal(Buffer.from(rewritten.subarray(at + 30, at + 30 + nameLength)).toString(), name);
      const data = inflateRawSync(rewritten.subarray(at + 30 + nameLength, at + 30 + nameLength + compressed));
      assert.equal(data.toString(), content);
      assert.equal(size, data.length);
      assert.equal(crc, nodeCrc32(data));
      at += 30 + nameLength + compressed;
    }
    assert.equal(view.getUint32(at, true), 0x02014b50, 'the directory follows the last file');
    assert.equal(view.getUint16(at + 4, true), 20, 'no operating system recorded');
    assert.equal(view.getUint32(at + 38, true), 0, 'no file permissions');
    assert.equal(view.getUint16(rewritten.length - 2, true), 0, 'no archive comment');
    assert.ok(!Buffer.from(rewritten).includes('laptop'));
    assert.deepEqual(readZip(rewritten).map((entry) => entry.name), Object.keys(DOCX_FILES), 'and it reads back');
  });

  it('computes the same checksum as Node', () => {
    for (const text of ['', 'a', 'The quick brown fox', 'ქართული ტექსტი']) assert.equal(crc32(encoder.encode(text)), nodeCrc32(Buffer.from(text)));
  });

  it('refuses broken, truncated and encrypted archives', () => {
    const good = zip(DOCX_FILES);
    const damaged = (/** @type {Uint8Array} */ bytes) => assert.throws(() => readZip(bytes), (error) => error instanceof DocumentError && error.code === 'damaged');
    damaged(good.slice(0, good.length - 30));
    damaged(good.slice(0, 200));
    damaged(encoder.encode('PK\x03\x04 but nothing else'));
    const encrypted = good.slice();
    const directory = new DataView(encrypted.buffer).getUint32(encrypted.length - 6, true);
    encrypted[directory + 8] |= 1;
    damaged(encrypted);
    const wild = good.slice();
    new DataView(wild.buffer).setUint32(directory + 42, 0xfffffff0, true);
    damaged(wild);
  });
});

describe('document tool: Office files', () => {
  it('reports who made a Word document, with what, and when', async () => {
    const report = await inspectDocument(zip(DOCX_FILES));
    assert.equal(report.kind, 'docx');
    assert.deepEqual(report.fields, {
      author: 'Nino Beridze',
      lastAuthor: 'Giorgi K.',
      company: 'Example Media LLC',
      title: 'Draft & notes',
      created: '2026-10-01 08:00',
      modified: '2026-11-09 14:03',
      printed: '2026-10-30 09:15',
      revision: '14',
      editTime: '372',
      software: 'Microsoft Office Word 16.0000',
      template: 'Newsroom.dotm',
    });
    assert.deepEqual([...report.flags].sort(), ['commentsPart', 'custom', 'tracked']);
  });

  it('empties the properties in the cleaned copy and leaves everything else byte for byte', async () => {
    const original = zip(DOCX_FILES, { descriptors: true });
    const { clean } = await inspectDocument(original);
    assert.ok(clean);
    for (const secret of ['Example Media', 'Newsroom', 'CaseNumber', 'Draft &amp;']) assert.ok(!Buffer.from(clean).includes(secret), `"${secret}" must be gone`);

    const before = new Map(readZip(original).map((entry) => [entry.name, entry]));
    for (const entry of readZip(clean)) {
      const source = before.get(entry.name);
      assert.ok(source, `${entry.name} is an entry of the original`);
      if (entry.name.startsWith('docProps/')) {
        const xml = new TextDecoder().decode(await unzip(entry));
        assert.match(xml, /^<\?xml version="1\.0" encoding="UTF-8" standalone="yes"\?>\n<(cp:coreProperties|Properties|meta) [^<]*\/>$/, `${entry.name} is an empty, well-formed property file`);
        assert.equal(entry.crc, nodeCrc32(Buffer.from(xml)));
      } else {
        assert.deepEqual([...entry.data], [...source.data], `${entry.name}: compressed bytes untouched`);
      }
    }

    const again = await inspectDocument(clean);
    assert.deepEqual(again.fields, {}, 'nothing left in the properties');
    assert.deepEqual([...again.flags].sort(), ['commentsPart', 'tracked'], 'tracked changes and comments are in the text itself, so they stay and are reported');
    assert.equal(hasFindings(again), true);
  });

  it('recognises spreadsheets and presentations, and ignores a file that was only saved once', async () => {
    const plainCore = '<cp:coreProperties><cp:revision>1</cp:revision></cp:coreProperties>';
    const plainApp = '<Properties><TotalTime>0</TotalTime></Properties>';
    const base = { '[Content_Types].xml': '<Types/>', 'docProps/core.xml': plainCore, 'docProps/app.xml': plainApp };
    const sheet = await inspectDocument(zip({ ...base, 'xl/workbook.xml': '<workbook/>', 'xl/comments1.xml': '<comments/>' }));
    assert.equal(sheet.kind, 'xlsx');
    assert.deepEqual([...sheet.flags], ['commentsPart']);
    const slides = await inspectDocument(zip({ ...base, 'ppt/presentation.xml': '<p:presentation/>' }));
    assert.equal(slides.kind, 'pptx');
    assert.equal(hasFindings(slides), false);
  });

  it('refuses archives that are not Office documents, old formats and other files', async () => {
    const code = async (/** @type {Uint8Array} */ bytes) => inspectDocument(bytes).then(() => 'accepted', (error) => (error instanceof DocumentError ? error.code : String(error)));
    assert.equal(await code(zip({ 'readme.txt': 'just a zip' })), 'unsupported');
    assert.equal(await code(Uint8Array.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0, 0])), 'old');
    assert.equal(await code(encoder.encode('Dear editor, plain text')), 'unsupported');
    assert.equal(await code(new Uint8Array(0)), 'unsupported');
  });

  it('reports the software named by Apple programs, and removes it too', async () => {
    const files = { '[Content_Types].xml': '<Types/>', 'word/document.xml': '<w:document/>', 'docProps/meta.xml': '<meta xmlns="http://schemas.apple.com/cocoa/2006/metadata"><generator>CocoaOOXMLWriter/2775.2</generator></meta>' };
    const report = await inspectDocument(zip(files));
    assert.deepEqual(report.fields, { software: 'CocoaOOXMLWriter/2775.2' });
    assert.ok(report.clean);
    assert.equal(hasFindings(await inspectDocument(report.clean)), false);
  });

  it('reads XML values with attributes and escapes, and treats empty tags as absent', () => {
    assert.equal(xmlText('<a><dc:creator>Ann &amp; Co &#x10D0;&#4305;</dc:creator></a>', 'dc:creator'), 'Ann & Co აბ');
    assert.equal(xmlText('<dcterms:created xsi:type="x">2026</dcterms:created>', 'dcterms:created'), '2026');
    assert.equal(xmlText('<dc:subject></dc:subject><dc:title/>', 'dc:subject'), '');
    assert.equal(xmlText('<Company>Acme</Company>', 'Manager'), '');
    assert.equal(xmlText('<Companyx>no</Companyx><Company>yes</Company>', 'Company'), 'yes', 'a longer tag name is a different tag');
  });

  it('names the cleaned copy after the original', () => {
    assert.equal(cleanName('Report final.docx', 'docx'), 'Report final-clean.docx');
    assert.equal(cleanName('.xlsx', 'xlsx'), 'document-clean.xlsx');
  });
});

describe('document tool: PDF', () => {
  /** @param {string} info  Contents of the Info dictionary. @param {string} [extra] */
  const pdf = (info, extra = '') =>
    encoder.encode(`%PDF-1.7\n1 0 obj\n<< /Type /Catalog >>\nendobj\n${extra}7 0 obj\n<< ${info} >>\nendobj\ntrailer\n<< /Root 1 0 R /Info 7 0 R >>\n%%EOF\n`);

  it('reads the properties, including escaped, hex and UTF-16 strings', async () => {
    const title = `<FEFF${[...'ანგარიში'].map((char) => char.charCodeAt(0).toString(16).padStart(4, '0')).join('')}>`;
    const report = await inspectDocument(pdf(`/Author (Nino \\(editor\\) Beridze) /Title ${title} /Creator (Microsoft\\256 Word) /Producer <6d61634f53> /CreationDate (D:20261109140322+04'00') /ModDate (D:20261110)`));
    assert.equal(report.kind, 'pdf');
    assert.deepEqual(report.fields, {
      author: 'Nino (editor) Beridze',
      title: 'ანგარიში',
      software: 'Microsoft® Word',
      producer: 'macOS',
      created: '2026-11-09 14:03',
      modified: '2026-11-10',
    });
    assert.equal(report.clean, null, 'PDFs are checked, not cleaned');
  });

  it('only reads the properties object, not look-alike text elsewhere in the file', async () => {
    const report = await inspectDocument(pdf('/Producer (Real producer)', '3 0 obj\n<< /Author (Decoy in another object) >>\nendobj\n'));
    assert.deepEqual(report.fields, { producer: 'Real producer' });
  });

  it('reads the embedded XMP description when there is one', async () => {
    const xmp = '4 0 obj\n<< /Type /Metadata >>\nstream\n<x:xmpmeta><rdf:RDF><rdf:Description><dc:creator><rdf:Seq><rdf:li>Giorgi K.</rdf:li></rdf:Seq></dc:creator><xmp:CreatorTool>LibreOffice 24.2</xmp:CreatorTool></rdf:Description></rdf:RDF></x:xmpmeta>\nendstream\nendobj\n';
    const report = await inspectDocument(pdf('/Producer (PDF library)', xmp));
    assert.deepEqual(report.fields, { producer: 'PDF library', author: 'Giorgi K.', software: 'LibreOffice 24.2' });
    assert.deepEqual([...report.flags], ['xmp']);
  });

  it('reports nothing for a PDF without properties, and refuses encrypted ones', async () => {
    const empty = await inspectDocument(encoder.encode('%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF'));
    assert.equal(hasFindings(empty), false);
    const locked = encoder.encode('%PDF-1.7\ntrailer\n<< /Root 1 0 R /Encrypt 5 0 R /Info 7 0 R >>\n%%EOF');
    await assert.rejects(inspectDocument(locked), (error) => error instanceof DocumentError && error.code === 'damaged');
  });

  it('decodes PDF strings', () => {
    assert.equal(pdfString('(plain)'), 'plain');
    assert.equal(pdfString('(a\\nb\\\\c\\)d)'), 'a\nb\\c)d');
    assert.equal(pdfString('(line one \\\nline two)'), 'line one line two');
    assert.equal(pdfString('<48 65 6C6c 6F>'), 'Hello');
    assert.equal(pdfString('(\\376\\377\\000A\\020\\320)'), 'Aა', 'UTF-16 written as octal escapes');
  });
});

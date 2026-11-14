// @ts-check
/**
 * @file Document tool: what it finds beyond the properties, what the clean copy removes, and what it says it could not check.
 */
/**
 * Fixtures are written here with Node's own compressor (not the tool's
 * writer). Every finding has a status: removed in the clean copy, found but
 * left in, or not checked.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { crc32, deflateRawSync, deflateSync, inflateRawSync } from 'node:zlib';
import { DocumentError, init, inspectDocument, readZip, unzip } from '../src/client/tool-document.mjs';
import { FakeElement, installDom } from './fake-dom.mjs';

/** @typedef {import('../src/client/tool-document.mjs').DocumentReport} DocumentReport */

const encoder = new TextEncoder();

/**
 * A ZIP archive; "mimetype" is stored uncompressed, as OpenDocument requires.
 * A list of pairs allows the same name twice.
 * @param {Record<string, string | Uint8Array> | [string, string | Uint8Array][]} files
 */
function zip(files) {
  const list = Array.isArray(files) ? files : Object.entries(files);
  /** @type {Buffer[]} */
  const parts = [];
  /** @type {Buffer[]} */
  const directory = [];
  let offset = 0;
  for (const [name, content] of list) {
    const raw = Buffer.from(content);
    const stored = name === 'mimetype';
    const data = stored ? raw : deflateRawSync(raw);
    const nameBytes = Buffer.from(name);
    const header = Buffer.alloc(26);
    header.writeUInt16LE(20, 0);
    header.writeUInt16LE(0x0800, 2);
    header.writeUInt16LE(stored ? 0 : 8, 4);
    header.writeUInt32LE(crc32(raw), 10);
    header.writeUInt32LE(data.length, 14);
    header.writeUInt32LE(raw.length, 18);
    header.writeUInt16LE(nameBytes.length, 22);
    const local = Buffer.concat([Buffer.from([0x50, 0x4b, 3, 4]), header, nameBytes, data]);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    header.copy(central, 6);
    central.writeUInt32LE(offset, 42);
    parts.push(local);
    directory.push(central, nameBytes);
    offset += local.length;
  }
  const directoryBytes = Buffer.concat(directory);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(list.length, 8);
  end.writeUInt16LE(list.length, 10);
  end.writeUInt32LE(directoryBytes.length, 12);
  end.writeUInt32LE(offset, 16);
  return new Uint8Array(Buffer.concat([...parts, directoryBytes, end]));
}

/** The text of every entry of an archive, for searching. @param {Uint8Array} bytes */
async function contents(bytes) {
  const out = [];
  for (const entry of readZip(bytes)) out.push(entry.name, new TextDecoder('latin1').decode(await unzip(entry)));
  return out.join('\n');
}

/** @param {DocumentReport} report @param {string} key */
const finding = (report, key) => report.findings.find((item) => item.key === key);
/** @param {DocumentReport} report @param {'removed' | 'kept' | 'unchecked'} status */
const keys = (report, status) => report.findings.filter((item) => item.status === status).map((item) => item.key).sort();

/** A tiny JPEG with a comment segment (metadata the photo tool removes). */
const JPEG_WITH_COMMENT = Uint8Array.from([
  0xff, 0xd8,
  0xff, 0xfe, 0x00, 0x10, ...encoder.encode('Nino s iPhone!'),
  0xff, 0xdb, 0x00, 0x06, 0, 1, 2, 3,
  0xff, 0xc0, 0x00, 0x0b, 8, 0, 1, 0, 1, 1, 1, 0x11, 0,
  0xff, 0xda, 0x00, 0x08, 1, 1, 0, 0, 0x3f, 0, 0x12, 0x34,
  0xff, 0xd9,
]);

/** A printer's settings as Office stores them: a DEVMODE, whose first 64 bytes are the printer's name in UTF-16. */
const DEVMODE = (() => {
  const bytes = new Uint8Array(220);
  bytes.set(Buffer.from('HP LaserJet Newsroom 4F', 'utf16le'), 0);
  bytes[64] = 0x01;
  return bytes;
})();

const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
const DOCX = {
  '[Content_Types].xml': '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="jpeg" ContentType="image/jpeg"/><Override PartName="/docProps/thumbnail.jpeg" ContentType="image/jpeg"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
  '_rels/.rels': '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/thumbnail" Target="docProps/thumbnail.jpeg"/></Relationships>',
  'docProps/thumbnail.jpeg': JPEG_WITH_COMMENT,
  'word/document.xml': `<w:document ${W}><w:body><w:p w:rsidR="00A1B2C3" w:rsidRDefault="00D4E5F6"><w:r><w:t>Text</w:t></w:r><w:ins w:id="1" w:author="Nino Beridze" w:date="2026-11-09T14:00:00Z"><w:r><w:t>added</w:t></w:r></w:ins></w:p></w:body></w:document>`,
  'word/comments.xml': `<w:comments ${W}><w:comment w:id="0" w:author="Giorgi K." w:initials="GK" w:date="2026-11-09T14:00:00Z"><w:p><w:r><w:t>Check the source</w:t></w:r></w:p></w:comment></w:comments>`,
  'word/people.xml': '<w15:people xmlns:w15="http://schemas.microsoft.com/office/word/2012/wordml"><w15:person w15:author="Nino Beridze"><w15:presenceInfo w15:providerId="AD" w15:userId="S::nino@example.org::1a2b3c"/></w15:person></w15:people>',
  'word/settings.xml': `<w:settings ${W} xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><w:attachedTemplate r:id="rId1"/><w:rsids><w:rsidRoot w:val="00A1B2C3"/><w:rsid w:val="00D4E5F6"/></w:rsids></w:settings>`,
  'word/_rels/settings.xml.rels': '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/attachedTemplate" Target="file:///C:\\Users\\nino.beridze\\AppData\\Roaming\\Microsoft\\Templates\\Normal.dotm" TargetMode="External"/></Relationships>',
  'word/_rels/document.xml.rels': '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId5" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="https://example.org/story" TargetMode="External"/><Relationship Id="rId6" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/oleObject" Target="file:///\\\\server\\share\\budget.xlsx" TargetMode="External"/></Relationships>',
  'word/printerSettings/printerSettings1.bin': DEVMODE,
  'word/media/image1.jpeg': JPEG_WITH_COMMENT,
  'word/embeddings/oleObject1.bin': 'another document inside',
  'docMetadata/LabelInfo.xml': '<clbl:labelList xmlns:clbl="http://schemas.microsoft.com/office/2020/mipLabelMetadata"><clbl:label id="{1}" enabled="1" method="Standard" siteId="{72f988bf-86f1-41af-91ab-2d7cd011db47}" removed="0"/></clbl:labelList>',
  'docProps/core.xml': '<cp:coreProperties xmlns:cp="x" xmlns:dc="y"><dc:creator>Nino Beridze</dc:creator></cp:coreProperties>',
};

describe('document tool: Word, beyond the properties', () => {
  it('reports each finding with what the clean copy does about it', async () => {
    const report = await inspectDocument(zip(DOCX));
    assert.deepEqual(keys(report, 'removed'), ['commentAuthors', 'dates', 'media', 'people', 'printer', 'properties', 'revisionAuthors', 'rsid', 'template', 'thumbnail']);
    assert.deepEqual(keys(report, 'kept'), ['commentsPart', 'external', 'labels', 'tracked']);
    assert.deepEqual(keys(report, 'unchecked'), ['embedded']);
    assert.deepEqual(finding(report, 'people')?.values, ['Nino Beridze', 'S::nino@example.org::1a2b3c']);
    assert.deepEqual(finding(report, 'commentAuthors')?.values, ['Giorgi K.']);
    assert.deepEqual(finding(report, 'revisionAuthors')?.values, ['Nino Beridze']);
    assert.deepEqual(finding(report, 'template')?.values, ['file:///C:\\Users\\nino.beridze\\AppData\\Roaming\\Microsoft\\Templates\\Normal.dotm']);
    assert.deepEqual(finding(report, 'printer')?.values, ['HP LaserJet Newsroom 4F']);
    assert.deepEqual(finding(report, 'external')?.values, ['file:///\\\\server\\share\\budget.xlsx'], 'links in the text are not listed');
    assert.deepEqual(finding(report, 'labels')?.values, ['{72f988bf-86f1-41af-91ab-2d7cd011db47}']);
    assert.deepEqual(finding(report, 'embedded')?.values, ['word/embeddings/oleObject1.bin']);
  });

  it('the clean copy anonymises authors and drops the rest, and the tool checks it before offering it', async () => {
    const report = await inspectDocument(zip(DOCX));
    assert.ok(report.clean);
    assert.equal(report.verified, true);
    const text = await contents(report.clean);
    for (const secret of ['Nino Beridze', 'Giorgi K.', 'nino@example.org', 'nino.beridze', 'HP LaserJet', 'w:rsid', 'Nino s iPhone', 'docProps/thumbnail.jpeg']) {
      assert.ok(!text.includes(secret), `"${secret}" must be gone`);
    }
    assert.match(text, /w:author="Author"/, 'tracked changes and comments keep an author, just not the name');
    assert.match(text, /Check the source/, 'the comment itself stays (reported as left in)');
    const again = await inspectDocument(report.clean);
    assert.deepEqual(keys(again, 'removed'), []);
    assert.deepEqual(keys(again, 'kept'), ['commentsPart', 'external', 'labels', 'tracked']);
  });
});

describe('document tool: Excel and PowerPoint', () => {
  it('Excel: people with email addresses, the saved folder, hidden sheets', async () => {
    const report = await inspectDocument(
      zip({
        '[Content_Types].xml': '<Types/>',
        'xl/workbook.xml': '<workbook xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" xmlns:x15ac="http://schemas.microsoft.com/office/spreadsheetml/2010/11/ac"><mc:AlternateContent><mc:Choice Requires="x15"><x15ac:absPath url="C:\\Users\\nino\\Documents\\Leaks\\" xmlns:x15ac="http://schemas.microsoft.com/office/spreadsheetml/2010/11/ac"/></mc:Choice></mc:AlternateContent><sheets><sheet name="Public" sheetId="1" r:id="rId1"/><sheet name="Sources" sheetId="2" state="hidden" r:id="rId2"/></sheets></workbook>',
        'xl/persons/person.xml': '<personList><person displayName="Nino Beridze" id="{A}" userId="nino@example.org" providerId="PeoplePicker"/></personList>',
        'xl/comments1.xml': '<comments><authors><author>Giorgi K.</author></authors><commentList><comment ref="A1" authorId="0"><text><t>check</t></text></comment></commentList></comments>',
      }),
    );
    assert.deepEqual(finding(report, 'people')?.values, ['Nino Beridze', 'nino@example.org']);
    assert.deepEqual(finding(report, 'absPath')?.values, ['C:\\Users\\nino\\Documents\\Leaks\\']);
    assert.deepEqual(finding(report, 'hiddenSheets')?.values, ['Sources']);
    assert.deepEqual(finding(report, 'commentAuthors')?.values, ['Giorgi K.']);
    assert.ok(report.clean);
    const text = await contents(report.clean);
    for (const secret of ['Nino Beridze', 'nino@example.org', 'Leaks', 'Giorgi K.']) assert.ok(!text.includes(secret), secret);
  });

  it('PowerPoint: comment authors, speaker notes and hidden slides', async () => {
    const report = await inspectDocument(
      zip({
        '[Content_Types].xml': '<Types/>',
        'ppt/presentation.xml': '<p:presentation/>',
        'ppt/slides/slide1.xml': '<p:sld/>',
        'ppt/slides/slide2.xml': '<p:sld show="0"/>',
        'ppt/notesSlides/notesSlide1.xml': '<p:notes/>',
        'ppt/commentAuthors.xml': '<p:cmAuthorLst><p:cmAuthor id="0" name="Nino Beridze" initials="NB" lastIdx="1" clrIdx="0"/></p:cmAuthorLst>',
        'ppt/authors.xml': '<p188:authorLst><p188:author id="{A}" name="Giorgi K." initials="GK" userId="giorgi@example.org" providerId="PeoplePicker"/></p188:authorLst>',
      }),
    );
    assert.deepEqual(finding(report, 'people')?.values, ['Nino Beridze', 'Giorgi K.', 'giorgi@example.org']);
    assert.deepEqual(finding(report, 'notes')?.values, ['1']);
    assert.deepEqual(finding(report, 'hiddenSlides')?.values, ['1']);
    assert.ok(report.clean);
    assert.ok(!(await contents(report.clean)).includes('giorgi@example.org'));
  });
});

describe('document tool: OpenDocument', () => {
  const ODT = {
    mimetype: 'application/vnd.oasis.opendocument.text',
    'META-INF/manifest.xml': '<manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0"><manifest:file-entry manifest:full-path="/" manifest:media-type="application/vnd.oasis.opendocument.text"/><manifest:file-entry manifest:full-path="Thumbnails/thumbnail.png" manifest:media-type="image/png"/><manifest:file-entry manifest:full-path="content.xml" manifest:media-type="text/xml"/></manifest:manifest>',
    'meta.xml': '<office:document-meta xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:meta="urn:oasis:names:tc:opendocument:xmlns:meta:1.0" xmlns:dc="http://purl.org/dc/elements/1.1/" office:version="1.3"><office:meta><meta:initial-creator>Nino Beridze</meta:initial-creator><dc:creator>Giorgi K.</dc:creator><meta:creation-date>2026-11-01T09:00:00</meta:creation-date><dc:date>2026-11-09T14:03:22</dc:date><meta:editing-cycles>7</meta:editing-cycles><meta:editing-duration>PT2H5M</meta:editing-duration><meta:generator>LibreOffice/24.2</meta:generator><meta:printed-by>Nino Beridze</meta:printed-by><meta:user-defined meta:name="Case">A-17</meta:user-defined></office:meta></office:document-meta>',
    'content.xml': '<office:document-content xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:text="x"><office:body><text:tracked-changes><text:changed-region text:id="c1"><text:insertion><office:change-info><dc:creator>Nino Beridze</dc:creator><dc:date>2026-11-09T14:00:00</dc:date></office:change-info></text:insertion></text:changed-region></text:tracked-changes><text:p>Hello<office:annotation><dc:creator>Giorgi K.</dc:creator><text:p>check</text:p></office:annotation></text:p></office:body></office:document-content>',
    'settings.xml': '<office:document-settings xmlns:config="urn:oasis:names:tc:opendocument:xmlns:config:1.0"><config:config-item config:name="PrinterName" config:type="string">HP LaserJet Newsroom 4F</config:config-item><config:config-item config:name="PrinterSetup" config:type="base64Binary">c2VjcmV0</config:config-item></office:document-settings>',
    'Thumbnails/thumbnail.png': 'a picture of the first page',
  };

  it('reads meta.xml and finds comments, changes, the thumbnail and the printer', async () => {
    const report = await inspectDocument(zip(ODT));
    assert.equal(report.kind, 'odt');
    assert.deepEqual(report.fields, { author: 'Nino Beridze', lastAuthor: 'Giorgi K.', created: '2026-11-01 09:00', modified: '2026-11-09 14:03', revision: '7', editTime: '125', software: 'LibreOffice/24.2', printedBy: 'Nino Beridze' });
    assert.deepEqual(keys(report, 'removed'), ['commentAuthors', 'custom', 'dates', 'printer', 'properties', 'revisionAuthors', 'thumbnail']);
    assert.deepEqual(keys(report, 'kept'), ['commentsPart', 'tracked']);
  });

  it('the clean copy keeps "mimetype" first and stored, and the manifest without the thumbnail', async () => {
    const report = await inspectDocument(zip(ODT));
    assert.ok(report.clean && report.verified);
    const entries = readZip(report.clean);
    assert.equal(entries[0].name, 'mimetype');
    assert.equal(entries[0].method, 0);
    const text = await contents(report.clean);
    for (const secret of ['Nino Beridze', 'Giorgi K.', 'HP LaserJet', 'c2VjcmV0', 'Thumbnails/thumbnail.png', 'A-17']) assert.ok(!text.includes(secret), secret);
    assert.match(text, /office:version="1\.3"/);
  });
});

describe('document tool: password-protected files', () => {
  /** An OLE compound file whose directory names these streams (UTF-16), as Office writes them. @param {string[]} streams */
  const ole = (streams) => new Uint8Array(Buffer.concat([Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]), Buffer.alloc(504), ...streams.map((name) => Buffer.concat([Buffer.from(name, 'utf16le'), Buffer.alloc(64 - name.length * 2)]))]));
  /** @param {Uint8Array} bytes */
  const code = (bytes) => inspectDocument(bytes).then(() => 'accepted', (error) => (error instanceof DocumentError ? error.code : String(error)));

  it('tells a password-protected .docx from an old .doc', async () => {
    assert.equal(await code(ole(['Root Entry', 'EncryptionInfo', 'EncryptedPackage'])), 'locked');
    assert.equal(await code(ole(['Root Entry', 'WordDocument', '1Table'])), 'old');
  });
});

describe('document tool: PDF, beyond the Info dictionary', () => {
  /** @param {string} body */
  const pdf = (body) => encoder.encode(`%PDF-1.7\n${body}`);
  /** A stream object, compressed. @param {number} number @param {string} dictionary @param {string} data */
  const flate = (number, dictionary, data) => {
    const packed = deflateSync(Buffer.from(data));
    return Buffer.concat([Buffer.from(`${number} 0 obj\n<< ${dictionary} /Filter /FlateDecode /Length ${packed.length} >>\nstream\n`), packed, Buffer.from('\nendstream\nendobj\n')]);
  };

  it('finds the properties when they sit in a compressed object stream (the usual case today)', async () => {
    const objects = '<< /Type /Catalog /Pages 2 0 R >> << /Author (Hidden Author) /Producer (Word) >>';
    const header = '1 0 7 34 ';
    const stream = flate(5, `/Type /ObjStm /N 2 /First ${header.length}`, header + objects);
    const xref = Buffer.from('9 0 obj\n<< /Type /XRef /Root 1 0 R /Info 7 0 R /ID [<A1B2C3D4E5F60718293A4B5C6D7E8F90><A1B2C3D4E5F60718293A4B5C6D7E8F90>] /W [1 2 1] /Size 10 >>\nstream\n\nendstream\nendobj\nstartxref\n0\n%%EOF\n');
    const report = await inspectDocument(new Uint8Array(Buffer.concat([Buffer.from('%PDF-1.7\n'), stream, xref])));
    assert.deepEqual(report.fields, { author: 'Hidden Author', producer: 'Word' });
    assert.deepEqual(finding(report, 'documentId')?.values, ['A1B2C3D4E5F60718293A4B5C6D7E8F90']);
  });

  it('says it could not check, instead of "nothing found", when the properties can’t be read', async () => {
    const report = await inspectDocument(pdf('1 0 obj\n<< /Type /Catalog >>\nendobj\n9 0 obj\n<< /Type /XRef /Info 7 0 R >>\nstream\nendstream\nendobj\n%%EOF\n'));
    assert.deepEqual(keys(report, 'unchecked'), ['propertiesUnchecked']);
  });

  it('reads a compressed XMP packet', async () => {
    const xmp = flate(4, '/Type /Metadata /Subtype /XML', '<x:xmpmeta><rdf:RDF><rdf:Description><dc:creator><rdf:Seq><rdf:li>Giorgi K.</rdf:li></rdf:Seq></dc:creator></rdf:Description></rdf:RDF></x:xmpmeta>');
    const report = await inspectDocument(new Uint8Array(Buffer.concat([Buffer.from('%PDF-1.7\n1 0 obj\n<< /Type /Catalog /Metadata 4 0 R >>\nendobj\n'), xmp, Buffer.from('trailer\n<< /Root 1 0 R >>\n%%EOF\n')])));
    assert.equal(report.fields.author, 'Giorgi K.');
    assert.ok(finding(report, 'xmp'));
  });

  it('finds earlier versions, comment authors, attached files, forms and scripts', async () => {
    const report = await inspectDocument(
      pdf(
        [
          '1 0 obj\n<< /Type /Catalog /AcroForm << /Fields [10 0 R] >> /Names << /JavaScript 12 0 R >> >>\nendobj',
          '7 0 obj\n<< /Author (First Author) >>\nendobj',
          'trailer\n<< /Root 1 0 R /Info 7 0 R >>\n%%EOF',
          '8 0 obj\n<< /Type /Annot /Subtype /Text /T (Nino Beridze) /Contents (Is this source safe?) >>\nendobj',
          '11 0 obj\n<< /Type /Filespec /F (sources.xlsx) /UF (sources.xlsx) /EF << /F 13 0 R >> >>\nendobj',
          '12 0 obj\n<< /S /JavaScript /JS (app.alert\\(1\\)) >>\nendobj',
          '7 0 obj\n<< /Author (Second Author) >>\nendobj',
          'trailer\n<< /Root 1 0 R /Info 7 0 R /Prev 9 >>\n%%EOF\n',
        ].join('\n'),
      ),
    );
    assert.equal(report.fields.author, 'Second Author', 'the latest version of the properties');
    assert.deepEqual(finding(report, 'revisions')?.values, ['1']);
    assert.deepEqual(finding(report, 'annotations')?.values, ['Nino Beridze']);
    assert.deepEqual(finding(report, 'attachments')?.values, ['sources.xlsx']);
    assert.ok(finding(report, 'forms'));
    assert.ok(finding(report, 'scripts'));
    assert.deepEqual(keys(report, 'removed'), [], 'a PDF is checked, not cleaned');
    assert.equal(report.clean, null);
  });

  it('finds scripts and attached files whose names are written with #xx escapes (ISO 32000-1 §7.3.5)', async () => {
    // "/#4A#53" is "/JS" and "/Java#53cript" is "/JavaScript": the same names to a PDF reader, often used to slip past scanners.
    const report = await inspectDocument(
      pdf(
        [
          '1 0 obj\n<< /Type /Catalog /Names << /Java#53cript 12 0 R /Em#62eddedFiles 13 0 R >> >>\nendobj',
          '12 0 obj\n<< /S /Java#53cript /#4A#53 (app.alert\\(1\\)) >>\nendobj',
          'trailer\n<< /Root 1 0 R >>\n%%EOF\n',
        ].join('\n'),
      ),
    );
    assert.ok(finding(report, 'scripts'), 'escaped script names are found');
    assert.ok(finding(report, 'attachments'), 'escaped attachment names are found');
  });

  it('says an encrypted PDF can’t be read, rather than calling it damaged', async () => {
    await assert.rejects(inspectDocument(pdf('trailer\n<< /Root 1 0 R /Encrypt 5 0 R /Info 7 0 R >>\n%%EOF')), (error) => error instanceof DocumentError && error.code === 'encrypted');
  });

  it('does not count the extra end marker of a file built for fast web view as an earlier version', async () => {
    const report = await inspectDocument(pdf('1 0 obj\n<< /Linearized 1 /L 1000 >>\nendobj\ntrailer\n<< /Size 2 >>\nstartxref\n0\n%%EOF\n2 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< /Root 2 0 R >>\n%%EOF\n'));
    assert.equal(finding(report, 'revisions'), undefined);
  });
});

void inflateRawSync;

/* ---------- Review of 2026-11-13: what the clean copy missed ---------- */

const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const CORE_REL = 'http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties';
const CORE = '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:creator>Nino Beridze</dc:creator></cp:coreProperties>';
const APP = '<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Company>ACME Newsroom</Company></Properties>';
/** @param {string} inner */
const rels = (inner) => `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${inner}</Relationships>`;
/** @param {string} [extra] @param {string} [main] */
const types = (extra = '', main = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml') =>
  `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="${main}"/>${extra}</Types>`;
/** @param {string} body */
const wordDocument = (body) => `<w:document ${W}><w:body>${body}</w:body></w:document>`;
/**
 * A Word document with these parts added.
 * @param {Record<string, string | Uint8Array>} parts
 * @param {{ rootRels?: string, body?: string | Uint8Array, types?: string }} [options]
 */
const word = (parts = {}, options = {}) =>
  zip({
    '[Content_Types].xml': options.types ?? types(),
    '_rels/.rels': rels(`<Relationship Id="rId1" Type="${REL}/officeDocument" Target="word/document.xml"/>${options.rootRels ?? ''}`),
    'word/document.xml': options.body ?? wordDocument('<w:p><w:r><w:t>Hello</w:t></w:r></w:p>'),
    ...parts,
  });

/** Every entry of an archive decoded as UTF-8 and as UTF-16, for searching. @param {Uint8Array} bytes */
async function everyEncoding(bytes) {
  const out = [];
  for (const entry of readZip(bytes)) {
    const data = await unzip(entry);
    out.push(entry.name, new TextDecoder().decode(data), new TextDecoder('utf-16le').decode(data), new TextDecoder('utf-16be').decode(data));
  }
  return out.join('\n');
}

/**
 * The report, and a check that none of the secrets is anywhere in the clean copy.
 * @param {Uint8Array} bytes @param {string[]} secrets
 */
async function cleaned(bytes, secrets) {
  const report = await inspectDocument(bytes);
  assert.ok(report.clean, `a clean copy is offered (findings: ${JSON.stringify(report.findings)})`);
  const text = await everyEncoding(report.clean);
  for (const secret of secrets) assert.ok(!text.includes(secret), `"${secret}" must be gone from the clean copy`);
  return report;
}

/** @param {Uint8Array} bytes */
const errorCode = (bytes) => inspectDocument(bytes).then(() => 'accepted', (error) => (error instanceof DocumentError ? error.code : String(error)));

describe('document tool review 2.2: properties outside docProps/core.xml', () => {
  it('finds core properties the Open XML SDK writes as a .psmdcp part, named in the package relationships', async () => {
    const report = await cleaned(word({ 'package/services/metadata/core-properties/abc.psmdcp': CORE }, { rootRels: `<Relationship Id="rId2" Type="${CORE_REL}" Target="/package/services/metadata/core-properties/abc.psmdcp"/>` }), ['Nino Beridze']);
    assert.equal(report.fields.author, 'Nino Beridze');
  });

  it('finds a .psmdcp part even without its relationship', async () => {
    const report = await cleaned(word({ 'package/services/metadata/core-properties/abc.psmdcp': CORE }), ['Nino Beridze']);
    assert.equal(report.fields.author, 'Nino Beridze');
  });

  it('compares part names without regard to case', async () => {
    const report = await cleaned(word({ 'docProps/Core.xml': CORE, 'DocProps/APP.xml': APP }), ['Nino Beridze', 'ACME Newsroom']);
    assert.deepEqual(report.fields, { author: 'Nino Beridze', company: 'ACME Newsroom' });
  });
});

describe('document tool review 2.3: password-protected OpenDocument files', () => {
  it('reports a file whose manifest lists encryption data as locked, not as "nothing found"', async () => {
    const entry = (/** @type {string} */ path) => `<manifest:file-entry manifest:full-path="${path}" manifest:media-type="text/xml"><manifest:encryption-data manifest:checksum-type="SHA1/1K" manifest:checksum="x"><manifest:algorithm manifest:algorithm-name="Blowfish CFB" manifest:initialisation-vector="x"/></manifest:encryption-data></manifest:file-entry>`;
    const junk = new Uint8Array(300).map((_, index) => (index * 37) % 256);
    const bytes = zip({
      mimetype: 'application/vnd.oasis.opendocument.text',
      'META-INF/manifest.xml': `<manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0"><manifest:file-entry manifest:full-path="/" manifest:media-type="application/vnd.oasis.opendocument.text"/>${entry('content.xml')}${entry('meta.xml')}</manifest:manifest>`,
      'meta.xml': junk,
      'content.xml': junk,
      'Thumbnails/thumbnail.png': junk,
    });
    assert.equal(await errorCode(bytes), 'locked');
  });
});

describe('document tool review 2.4: parts written in UTF-16', () => {
  /** @param {string} text */
  const utf16 = (text) => new Uint8Array(Buffer.from(`\ufeff${text}`, 'utf16le'));
  const changed = wordDocument('<w:p><w:ins w:id="1" w:author="Nino Beridze"><w:r><w:t>x</w:t></w:r></w:ins></w:p>');

  it('reads a UTF-16 part by its byte order mark, and the clean copy has no name in either encoding', async () => {
    const report = await cleaned(word({}, { body: utf16(`<?xml version="1.0" encoding="UTF-16"?>${changed}`) }), ['Nino Beridze']);
    assert.deepEqual(finding(report, 'revisionAuthors')?.values, ['Nino Beridze']);
    const document = readZip(/** @type {Uint8Array} */ (report.clean)).find((entry) => entry.name === 'word/document.xml');
    const text = new TextDecoder().decode(await unzip(/** @type {import('../src/client/zip.mjs').ZipEntry} */ (document)));
    assert.match(text, /encoding="UTF-8"/, 'a part rewritten as UTF-8 says so');
  });

  it('reads a UTF-16 big-endian part without a byte order mark', async () => {
    const bytes = new Uint8Array(Buffer.from(changed, 'utf16le').swap16());
    const report = await cleaned(word({}, { body: bytes }), ['Nino Beridze']);
    assert.deepEqual(finding(report, 'revisionAuthors')?.values, ['Nino Beridze']);
  });
});

describe('document tool review 2.5: quotes and prefixes', () => {
  it("reads single-quoted attributes, and both kinds in one part", async () => {
    const body = wordDocument(`<w:p><w:ins w:id='1' w:author='Nino Beridze' w:date='2026-11-09T14:00:00Z'><w:r><w:t>x</w:t></w:r></w:ins><w:del w:id="2" w:author="Other Person"><w:r><w:delText>y</w:delText></w:r></w:del></w:p>`);
    const report = await cleaned(word({}, { body }), ['Nino Beridze', 'Other Person', '2026-11-09']);
    assert.deepEqual(finding(report, 'revisionAuthors')?.values, ['Nino Beridze', 'Other Person']);
  });

  it('matches by local name, whatever the prefix', async () => {
    const body = '<x:document xmlns:x="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><x:body><x:p><x:ins x:id="1" x:author="Nino Beridze"><x:r><x:t>x</x:t></x:r></x:ins></x:p></x:body></x:document>';
    const report = await cleaned(word({}, { body }), ['Nino Beridze']);
    assert.deepEqual(finding(report, 'revisionAuthors')?.values, ['Nino Beridze']);
  });

  it('reads Excel comment authors with attributes, and hidden slides in single quotes', async () => {
    const excel = await cleaned(
      zip({
        '[Content_Types].xml': '<Types/>',
        'xl/workbook.xml': '<workbook><sheets><sheet name="S" sheetId="1"/></sheets></workbook>',
        'xl/comments1.xml': '<comments><authors><author xml:space="preserve">Spaced Author</author></authors><commentList><comment ref="A1" authorId="0"><text><r><t>Spaced Author:</t></r><r><t xml:space="preserve">\nhello</t></r></text></comment></commentList></comments>',
      }),
      ['Spaced Author'],
    );
    assert.deepEqual(finding(excel, 'commentAuthors')?.values, ['Spaced Author']);
    const slides = await inspectDocument(zip({ '[Content_Types].xml': '<Types/>', 'ppt/presentation.xml': '<p:presentation/>', 'ppt/slides/slide1.xml': "<p:sld show='0'/>" }));
    assert.deepEqual(finding(slides, 'hiddenSlides')?.values, ['1']);
  });
});

describe('document tool review 2.6: duplicate entry names', () => {
  it('refuses an archive with two entries of the same name, in any case', async () => {
    const first = wordDocument('<w:p/>');
    const second = wordDocument('<w:p><w:ins w:author="Nino Beridze"/></w:p>');
    const base = /** @type {[string, string][]} */ ([['[Content_Types].xml', types()], ['_rels/.rels', rels(`<Relationship Id="rId1" Type="${REL}/officeDocument" Target="word/document.xml"/>`)]]);
    assert.equal(await errorCode(zip([...base, ['word/document.xml', first], ['word/document.xml', second]])), 'damaged');
    assert.equal(await errorCode(zip([...base, ['word/document.xml', first], ['Word/Document.xml', second]])), 'damaged');
  });
});

describe('document tool review 2.7: PowerPoint co-authoring records', () => {
  it('removes changesInfos and revisionInfo with their relationships and content types, and reports the names', async () => {
    const report = await cleaned(
      zip({
        '[Content_Types].xml': '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/><Override PartName="/ppt/changesInfos/changesInfo1.xml" ContentType="application/vnd.ms-powerpoint.changesinfo+xml"/><Override PartName="/ppt/revisionInfo.xml" ContentType="application/vnd.ms-powerpoint.revisioninfo+xml"/></Types>',
        'ppt/presentation.xml': '<p:presentation/>',
        'ppt/_rels/presentation.xml.rels': rels('<Relationship Id="rId9" Type="http://schemas.microsoft.com/office/2016/11/relationships/changesInfo" Target="changesInfos/changesInfo1.xml"/><Relationship Id="rId10" Type="http://schemas.microsoft.com/office/2015/10/relationships/revisionInfo" Target="revisionInfo.xml"/>'),
        'ppt/changesInfos/changesInfo1.xml': '<pc:chgInfo xmlns:pc="http://schemas.microsoft.com/office/powerpoint/2013/main/command"><pc:docChgLst><pc:chgData name="Nino Beridze" userId="S::nino@example.org::1234" providerId="AD"/></pc:docChgLst></pc:chgInfo>',
        'ppt/revisionInfo.xml': '<p1510:revInfo xmlns:p1510="http://schemas.microsoft.com/office/powerpoint/2015/10/main"><p1510:revLst><p1510:client id="{CLIENT-GUID-1}" v="1" dt="2026-11-09T10:00:00.000"/></p1510:revLst></p1510:revInfo>',
      }),
      ['Nino Beridze', 'nino@example.org', 'CLIENT-GUID', 'changesInfo', 'revisionInfo'],
    );
    assert.deepEqual(finding(report, 'coauthoring'), { key: 'coauthoring', status: 'removed', values: ['Nino Beridze', 'S::nino@example.org::1234'] });
  });

  it('removes the dates on comments', async () => {
    await cleaned(
      zip({
        '[Content_Types].xml': '<Types/>',
        'ppt/presentation.xml': '<p:presentation/>',
        'ppt/comments/comment1.xml': '<p:cmLst><p:cm authorId="0" dt="2026-11-09T15:00:00.000" idx="1"><p:text>hi</p:text></p:cm></p:cmLst>',
        'ppt/comments/modernComment_1.xml': '<p188:cmLst><p188:cm id="{1}" authorId="{A}" created="2026-11-09T16:00:00.000"><p188:txBody/></p188:cm></p188:cmLst>',
      }),
      ['2026-11-09'],
    );
  });
});

describe('document tool review 2.8: Excel names, paths and identifiers', () => {
  const workbook = zip({
    '[Content_Types].xml': '<Types/>',
    'xl/workbook.xml': `<workbook xmlns:xr="http://schemas.microsoft.com/office/spreadsheetml/2014/revision"><xr:revisionPtr revIDLastSave="0" documentId="13_ncr:1_{AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE}"/><sheets><sheet name="S" sheetId="1"/></sheets><definedNames><definedName name="x">'C:\\Users\\nino.beridze\\[book.xlsx]S'!$A$1</definedName></definedNames></workbook>`,
    'xl/pivotCache/pivotCacheDefinition1.xml': '<pivotCacheDefinition refreshedBy="Nino Beridze" refreshedDate="46000.5"/>',
    'xl/connections.xml': '<connections><connection id="1" sourceFile="C:\\Users\\nino.beridze\\data.accdb" name="c"><dbPr connection="Provider=X;User ID=nberidze;Data Source=C:\\Users\\nino.beridze\\data.accdb"/></connection></connections>',
    'xl/revisions/revisionHeaders.xml': '<headers><header guid="{1}" dateTime="2026-11-09T10:00:00" userName="Revision Person"/></headers>',
    'xl/revisions/userNames.xml': '<users><userInfo guid="{2}" name="Shared User" id="1" dateTime="2026-11-09T10:00:00"/></users>',
    'xl/threadedComments/threadedComment1.xml': '<ThreadedComments><threadedComment ref="A1" dT="2026-11-09T15:00:00.00" personId="{P}" id="{C}"><text>hi</text></threadedComment></ThreadedComments>',
    'xl/persons/person.xml': `<personList><person displayName='Single Quote' id="{Q}" userId='sq@example.org' providerId="AD"/></personList>`,
  });

  it('replaces the names, removes the identifier and the dates, and reports the paths it leaves', async () => {
    const report = await cleaned(workbook, ['Nino Beridze', 'Revision Person', 'Shared User', 'Single Quote', 'sq@example.org', 'AAAAAAAA-BBBB', '2026-11-09']);
    assert.deepEqual(finding(report, 'people')?.values, ['Single Quote', 'sq@example.org', 'Nino Beridze', 'Revision Person', 'Shared User']);
    assert.deepEqual(finding(report, 'documentIds')?.status, 'removed');
    assert.ok(finding(report, 'dates'));
    const external = finding(report, 'external');
    assert.equal(external?.status, 'kept');
    assert.ok(external?.values.includes('C:\\Users\\nino.beridze\\data.accdb'), JSON.stringify(external?.values));
    assert.ok(external?.values.some((value) => value.includes('User ID=nberidze')), 'the connection string');
    assert.ok(external?.values.includes('C:\\Users\\nino.beridze\\[book.xlsx]S'), 'the defined name’s path');
  });

  it('keeps the attributes Excel requires on people, with placeholders', async () => {
    const report = await inspectDocument(workbook);
    const persons = readZip(/** @type {Uint8Array} */ (report.clean)).find((entry) => entry.name === 'xl/persons/person.xml');
    const text = new TextDecoder().decode(await unzip(/** @type {import('../src/client/zip.mjs').ZipEntry} */ (persons)));
    assert.match(text, /userId="[^"]+"/);
    assert.match(text, /providerId="None"/);
  });
});

describe('document tool review 2.9 and 2.10: Word identifiers, paths, the glossary and dates', () => {
  const settings = `<w:settings ${W} xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml" xmlns:w15="http://schemas.microsoft.com/office/word/2012/wordml"><w:mailMerge><w:query w:val="SELECT * FROM C:\\Users\\nino.beridze\\Documents\\list.xlsx"/></w:mailMerge><w14:docId w14:val="1A2B3C4D"/><w15:docId w15:val="{11111111-2222-3333-4444-555555555555}"/></w:settings>`;
  const bytes = word({
    'word/settings.xml': settings,
    'word/comments.xml': `<w:comments ${W}><w:comment w:id="0" w:author="Giorgi K" w:initials="GK" w:date="2026-11-09T15:00:00Z"/></w:comments>`,
    'word/commentsExtensible.xml': '<w16cex:commentsExtensible xmlns:w16cex="http://schemas.microsoft.com/office/word/2018/wordml/cex"><w16cex:commentExtensible w16cex:durableId="1" w16cex:dateUtc="2026-11-09T11:00:00Z"/></w16cex:commentsExtensible>',
    'word/glossary/document.xml': `<w:glossaryDocument ${W}><w:docParts><w:docPart><w:docPartBody><w:p><w:ins w:id="9" w:author="Glossary Person"><w:r><w:t>g</w:t></w:r></w:ins></w:p></w:docPartBody></w:docPart></w:docParts></w:glossaryDocument>`,
    'word/_rels/document.xml.rels': rels(`<Relationship Id="rId5" Type="${REL}/hyperlink" Target="file:///C:\\Users\\nino.beridze\\Documents\\secret.docx" TargetMode="External"/><Relationship Id="rId6" Type="${REL}/hyperlink" Target="https://example.org/" TargetMode="External"/><Relationship Id="rId7" Type="${REL}/hyperlink" Target="mailto:desk@example.org" TargetMode="External"/>`),
  });

  it('removes document IDs, the glossary’s author and every date on comments and changes', async () => {
    const report = await cleaned(bytes, ['1A2B3C4D', '11111111-2222', 'Glossary Person', '2026-11-09', 'Giorgi K']);
    assert.equal(finding(report, 'documentIds')?.status, 'removed');
    assert.equal(finding(report, 'dates')?.status, 'removed');
    assert.deepEqual(finding(report, 'revisionAuthors')?.values, ['Glossary Person']);
  });

  it('reports links to files on the author’s computer and the mail merge source, but not web or mail links', async () => {
    const report = await inspectDocument(bytes);
    assert.deepEqual(finding(report, 'external')?.values, ['file:///C:\\Users\\nino.beridze\\Documents\\secret.docx', 'SELECT * FROM C:\\Users\\nino.beridze\\Documents\\list.xlsx']);
  });
});

describe('document tool review 2.11: signatures, custom XML, macros and LibreOffice extras', () => {
  it('removes signatures and custom XML, and says macros could not be checked', async () => {
    const report = await cleaned(
      word(
        {
          'customXml/item1.xml': '<p:properties xmlns:p="http://schemas.microsoft.com/office/2006/metadata/properties"><documentManagement><Owner><UserInfo><DisplayName>Custom Owner</DisplayName></UserInfo></Owner></documentManagement></p:properties>',
          'customXml/itemProps1.xml': '<ds:datastoreItem ds:itemID="{1}" xmlns:ds="http://schemas.openxmlformats.org/officeDocument/2006/customXml"/>',
          'customXml/_rels/item1.xml.rels': rels(`<Relationship Id="rId1" Type="${REL}/customXmlProps" Target="itemProps1.xml"/>`),
          'word/_rels/document.xml.rels': rels(`<Relationship Id="rId8" Type="${REL}/customXml" Target="../customXml/item1.xml"/><Relationship Id="rId9" Type="http://schemas.microsoft.com/office/2006/relationships/vbaProject" Target="vbaProject.bin"/>`),
          'word/vbaProject.bin': 'Attribute VB_Name = "Module1"',
          '_xmlsignatures/origin.sigs': '',
          '_xmlsignatures/sig1.xml': '<Signature xmlns="http://www.w3.org/2000/09/xmldsig#"><KeyInfo><X509Data><X509SubjectName>CN=Signing Person</X509SubjectName></X509Data></KeyInfo></Signature>',
          '_xmlsignatures/_rels/origin.sigs.rels': rels('<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/package/2006/relationships/digital-signature/signature" Target="sig1.xml"/>'),
        },
        { rootRels: '<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/package/2006/relationships/digital-signature/origin" Target="_xmlsignatures/origin.sigs"/>' },
      ),
      ['Custom Owner', 'Signing Person', '_xmlsignatures', 'customXml'],
    );
    assert.deepEqual(finding(report, 'signatures'), { key: 'signatures', status: 'removed', values: ['Signing Person'] });
    assert.equal(finding(report, 'customXml')?.status, 'removed');
    assert.deepEqual(finding(report, 'macros'), { key: 'macros', status: 'unchecked', values: ['word/vbaProject.bin'] });
  });

  it('LibreOffice: signatures, embedded objects’ properties, the address book, macros and name fields', async () => {
    const OFF = 'xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:meta="urn:oasis:names:tc:opendocument:xmlns:meta:1.0" xmlns:config="urn:oasis:names:tc:opendocument:xmlns:config:1.0"';
    const report = await cleaned(
      zip({
        mimetype: 'application/vnd.oasis.opendocument.text',
        'META-INF/manifest.xml': '<manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0"><manifest:file-entry manifest:full-path="/" manifest:media-type="application/vnd.oasis.opendocument.text"/><manifest:file-entry manifest:full-path="META-INF/documentsignatures.xml" manifest:media-type=""/></manifest:manifest>',
        'META-INF/documentsignatures.xml': '<document-signatures><Signature><X509SubjectName>CN=Signing Person</X509SubjectName></Signature></document-signatures>',
        'meta.xml': `<office:document-meta ${OFF}><office:meta><meta:initial-creator>Nino Beridze</meta:initial-creator></office:meta></office:document-meta>`,
        'content.xml': `<office:document-content ${OFF}><office:body><office:text><text:p><office:annotation><dc:creator xml:space="preserve">Spaced Person</dc:creator><dc:date>2026-11-09T15:00:00</dc:date><text:p>hi</text:p></office:annotation><text:author-name>Field Person</text:author-name></text:p></office:text></office:body></office:document-content>`,
        'settings.xml': `<office:document-settings ${OFF}><office:settings><config:config-item-set config:name="ooo:configuration-settings"><config:config-item config:name="CurrentDatabaseDataSource" config:type="string">NinoAddressBook</config:config-item><config:config-item config:type="string" config:name='PrinterName'>HP Second</config:config-item></config:config-item-set></office:settings></office:document-settings>`,
        'Object 1/content.xml': `<office:document-content ${OFF}/>`,
        'Object 1/meta.xml': `<office:document-meta ${OFF}><office:meta><meta:initial-creator>Embedded Creator</meta:initial-creator></office:meta></office:document-meta>`,
        'Basic/Standard/Module1.xml': '<script>REM macro</script>',
      }),
      ['Nino Beridze', 'Signing Person', 'documentsignatures', 'Spaced Person', '2026-11-09', 'NinoAddressBook', 'HP Second', 'Embedded Creator'],
    );
    assert.deepEqual(finding(report, 'signatures')?.values, ['Signing Person']);
    assert.deepEqual(finding(report, 'commentAuthors')?.values, ['Spaced Person']);
    assert.deepEqual(finding(report, 'printer')?.values, ['HP Second']);
    assert.deepEqual(finding(report, 'dataSource'), { key: 'dataSource', status: 'removed', values: ['NinoAddressBook'] });
    assert.deepEqual(finding(report, 'embeddedProperties'), { key: 'embeddedProperties', status: 'removed', values: ['Embedded Creator'] });
    assert.deepEqual(finding(report, 'macros'), { key: 'macros', status: 'unchecked', values: ['Basic/Standard/Module1.xml'] });
    assert.deepEqual(finding(report, 'nameFields'), { key: 'nameFields', status: 'kept', values: ['Field Person'] });
  });
});

describe('document tool review 2.1: parts the tool does not know, and an independent check of the copy', () => {
  it('lists parts outside the known set as not checked, so the file is never "nothing found"', async () => {
    const report = await inspectDocument(word({ 'word/activeX/activeX1.bin': 'control', 'secret/notes.dat': 'notes' }));
    assert.deepEqual(finding(report, 'unknownParts'), { key: 'unknownParts', status: 'unchecked', values: ['word/activeX/activeX1.bin', 'secret/notes.dat'] });
  });

  it('offers no copy when a value it found is still somewhere in the copy, in UTF-8 or UTF-16', async () => {
    for (const leftover of [encoder.encode('owner: Nino Beridze'), new Uint8Array(Buffer.from('owner: Nino Beridze', 'utf16le')), encoder.encode('<x a="Nino&#32;Beridze"/>')]) {
      const report = await inspectDocument(word({ 'docProps/core.xml': CORE, 'word/unknown.bin': leftover }));
      assert.equal(report.fields.author, 'Nino Beridze');
      assert.equal(report.clean, null, 'not offered');
      assert.equal(report.verified, false);
    }
  });

  it('a value reported as left in excuses only what it contains, not a longer name it is part of', async () => {
    const OFF = 'xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" xmlns:meta="urn:oasis:names:tc:opendocument:xmlns:meta:1.0"';
    const report = await inspectDocument(
      zip({
        mimetype: 'application/vnd.oasis.opendocument.text',
        'META-INF/manifest.xml': '<manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0"/>',
        'meta.xml': `<office:document-meta ${OFF}><office:meta><meta:initial-creator>Nino Beridze</meta:initial-creator></office:meta></office:document-meta>`,
        'content.xml': `<office:document-content ${OFF}><office:body><office:text><text:p><text:sender-lastname>Beridze</text:sender-lastname></text:p></office:text></office:body></office:document-content>`,
        'Basic/Standard/Module1.xml': '<script>REM by Nino Beridze</script>',
      }),
    );
    assert.deepEqual(finding(report, 'nameFields')?.values, ['Beridze']);
    assert.equal(report.clean, null, 'the author’s full name is still in the macro module');
  });

  it('a name typed in the text does not stop the copy: only places that are not the text count', async () => {
    const body = wordDocument('<w:p><w:r><w:t>Letter from Nino Beridze</w:t></w:r></w:p>');
    const report = await inspectDocument(word({ 'docProps/core.xml': CORE }, { body }));
    assert.ok(report.clean);
    assert.equal(report.verified, true);
  });
});

describe('document tool review: smaller ZIP items', () => {
  it('stops inflating at the declared size', async () => {
    const real = Buffer.alloc(20 * 1024 * 1024);
    const packed = deflateRawSync(real);
    const bytes = zip({ '[Content_Types].xml': types(), 'word/document.xml': wordDocument('') });
    // Rebuild with a part that claims 1,000 bytes and inflates to 20 MB.
    const bomb = readZip(bytes);
    const { writeZip } = await import('../src/client/zip.mjs');
    const lying = writeZip([...bomb, { name: 'word/big.xml', rawName: encoder.encode('word/big.xml'), flags: 0, method: 8, crc: 0, size: 1000, data: new Uint8Array(packed) }]);
    assert.equal(await errorCode(lying), 'damaged');
  });

  it('gives archives in the ZIP64 format their own message', async () => {
    const bytes = word();
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    view.setUint32(bytes.length - 22 + 16, 0xffffffff, true);
    assert.equal(await errorCode(bytes), 'zip64');
  });

  it('keeps the extension of macro-enabled and template files', async () => {
    const report = await inspectDocument(word({}, { types: types('', 'application/vnd.ms-word.document.macroEnabled.main+xml') }));
    assert.equal(report.extension, 'docm');
    const show = await inspectDocument(zip({ '[Content_Types].xml': '<Types><Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideshow.main+xml"/></Types>', 'ppt/presentation.xml': '<p:presentation/>' }));
    assert.equal(show.extension, 'ppsx');
  });

  it('compresses the parts it changes', async () => {
    const body = wordDocument(`<w:p>${'<w:r w:rsidR="00A1B2C3"><w:t>repeated text</w:t></w:r>'.repeat(200)}</w:p>`);
    const report = await inspectDocument(word({}, { body }));
    const document = readZip(/** @type {Uint8Array} */ (report.clean)).find((entry) => entry.name === 'word/document.xml');
    assert.equal(document?.method, 8);
  });
});

describe('document tool review: PDF', () => {
  /** @param {string} body */
  const pdf = (body) => encoder.encode(`%PDF-1.7\n${body}`);

  it('2.12: shows the properties it read and says what it could not read', async () => {
    const xmp = '<x:xmpmeta><rdf:RDF><rdf:Description><dc:creator><rdf:Seq><rdf:li>Nino Beridze</rdf:li></rdf:Seq></dc:creator></rdf:Description></rdf:RDF></x:xmpmeta>';
    const report = await inspectDocument(pdf(`1 0 obj\n<< /Type /ObjStm /N 1 /First 4 /Filter /LZWDecode /Length 3 >>\nstream\nabc\nendstream\nendobj\n4 0 obj\n<< /Type /Metadata >>\nstream\n${xmp}\nendstream\nendobj\ntrailer\n<< /Info 7 0 R >>\n%%EOF\n`));
    assert.equal(report.fields.author, 'Nino Beridze');
    assert.ok(report.findings.some((item) => item.key === 'properties' && item.status === 'kept'));
    assert.ok(report.findings.some((item) => item.key === 'propertiesUnchecked' && item.status === 'unchecked'));
    assert.ok(finding(report, 'objectsUnchecked'), 'comments, attachments and scripts in the unreadable part were not checked either');
  });

  it('2.13: recognises encryption written in place', async () => {
    assert.equal(await errorCode(pdf('trailer\n<< /Root 1 0 R /Encrypt<< /Filter /Standard /V 2 >> /Info 7 0 R >>\n%%EOF')), 'encrypted');
    assert.equal(await errorCode(pdf('trailer\n<< /Root 1 0 R /Encrypt\n12 0 R >>\n%%EOF')), 'encrypted');
  });

  it('2.14: reads XMP written as attributes, every author, the title and the document ID', async () => {
    const xmp = '<x:xmpmeta><rdf:RDF><rdf:Description xmp:CreatorTool="Acrobat PDFMaker 24 for Word" pdf:Producer="Adobe PDF Library" xmpMM:DocumentID="uuid:1234-abcd"><dc:creator><rdf:Seq><rdf:li>Nino Beridze</rdf:li><rdf:li>Giorgi K.</rdf:li></rdf:Seq></dc:creator><dc:title><rdf:Alt><rdf:li xml:lang="x-default">Sources list</rdf:li></rdf:Alt></dc:title></rdf:Description></rdf:RDF></x:xmpmeta>';
    const report = await inspectDocument(pdf(`4 0 obj\n<< /Type /Metadata >>\nstream\n${xmp}\nendstream\nendobj\n%%EOF\n`));
    assert.deepEqual(report.fields, { author: 'Nino Beridze, Giorgi K.', title: 'Sources list', software: 'Acrobat PDFMaker 24 for Word', producer: 'Adobe PDF Library' });
    assert.ok(finding(report, 'documentId')?.values.includes('uuid:1234-abcd'));
  });

  it('reads nested parentheses, UTF-8 and UTF-16LE strings', async () => {
    const info = '7 0 obj\n<< /Author (Nino Beridze (ACME) Tbilisi) /Title (\xef\xbb\xbf\xe1\x83\x9c\xe1\x83\x98) /Subject <FFFE4E0069006E006F00> >>\nendobj\ntrailer\n<< /Info 7 0 R >>\n%%EOF';
    const report = await inspectDocument(new Uint8Array(Buffer.from(`%PDF-1.7\n${info}`, 'latin1')));
    assert.equal(report.fields.author, 'Nino Beridze (ACME) Tbilisi');
    assert.equal(report.fields.title, 'ნი');
    assert.equal(report.fields.subject, 'Nino');
  });

  it('tells form fields from comments, and reports filled values, signers and links to local files', async () => {
    const report = await inspectDocument(
      pdf(
        [
          '1 0 obj\n<< /Type /Catalog /AcroForm << /Fields [5 0 R 6 0 R] >> >>\nendobj',
          '5 0 obj\n<< /Type /Annot /Subtype /Widget /FT /Tx /T (name) /V (Nino Beridze) >>\nendobj',
          '6 0 obj\n<< /Type /Annot /Subtype /Widget /FT /Sig /T (sig1) /V 9 0 R >>\nendobj',
          '9 0 obj\n<< /Type /Sig /Name (Signing Person) /M (D:20261109) >>\nendobj',
          '10 0 obj\n<< /Type /Annot /Subtype /Link /A << /S /URI /URI (file:///C:/Users/nino/secret.pdf) >> >>\nendobj',
          '%%EOF',
        ].join('\n'),
      ),
    );
    assert.equal(finding(report, 'annotations'), undefined, 'a form field is not a comment');
    assert.deepEqual(finding(report, 'formValues')?.values, ['Nino Beridze']);
    assert.deepEqual(finding(report, 'pdfSignatures')?.values, ['Signing Person']);
    assert.deepEqual(finding(report, 'external')?.values, ['file:///C:/Users/nino/secret.pdf']);
  });

  it('reports a value typed into a field whose type is set on its parent', async () => {
    const report = await inspectDocument(pdf('7 0 obj\n<< /Type /Annot /Subtype /Widget /T (name) /V (Nino Beridze) /Parent 6 0 R >>\nendobj\n%%EOF'));
    assert.deepEqual(finding(report, 'formValues')?.values, ['Nino Beridze']);
    assert.equal(finding(report, 'annotations'), undefined);
  });

  it('reads an object stream whose length is a reference', async () => {
    const objects = '<< /Author (Hidden Author) >>';
    const header = '7 0 ';
    const packed = deflateSync(Buffer.from(header + objects));
    const bytes = Buffer.concat([Buffer.from('%PDF-1.7\n3 0 obj\n' + packed.length + '\nendobj\n5 0 obj\n<< /Type /ObjStm /N 1 /First 4 /Filter /FlateDecode /Length 3 0 R >>\nstream\n'), packed, Buffer.from('\nendstream\nendobj\ntrailer\n<< /Info 7 0 R >>\n%%EOF\n')]);
    const report = await inspectDocument(new Uint8Array(bytes));
    assert.equal(report.fields.author, 'Hidden Author');
  });
});

describe('document tool: the page', () => {
  /** A save area as the template has it. */
  const saveBox = () => {
    const box = new FakeElement('div');
    for (const name of ['neutral', 'neutral-name', 'download', 'share', 'status', 'hint']) box.select[`[data-js="save-${name}"]`] = [new FakeElement(name === 'download' ? 'a' : 'span')];
    return box;
  };
  /** The tool's elements, with report cards made from the template. */
  function page() {
    /** @type {FakeElement[]} */
    const cards = [];
    const makeCard = () => {
      const card = new FakeElement('article');
      const message = new FakeElement('p', { found: 'Found:', none: 'Nothing found.', damaged: 'Damaged.', unsupported: 'Unsupported.' });
      card.select = {
        '[data-js="document-message"]': [message],
        '[data-js="document-name"]': [new FakeElement('h3')],
        '[data-js="document-pdf"]': [new FakeElement('p')],
        '[data-js="document-verified"]': [new FakeElement('p', { ok: 'Checked.', failed: 'Not offered.' })],
        '[data-js="save"]': [saveBox()],
      };
      cards.push(card);
      return card;
    };
    const file = new FakeElement('input');
    const summary = new FakeElement('p', { one: 'The file has been checked.', several: 'Files checked: {n}.' });
    const reports = new FakeElement('div');
    const allBox = new FakeElement('div');
    allBox.select['[data-js="save"]'] = [saveBox()];
    const root = new FakeElement('div');
    root.select = {
      '[data-js="document-file"]': [file],
      '[data-js="document-summary"]': [summary],
      '[data-js="document-reports"]': [reports],
      '[data-js="document-template"]': [Object.assign(new FakeElement('template'), { content: { firstElementChild: { cloneNode: makeCard } } })],
      '[data-js="document-all"]': [allBox],
      '[data-js="document-example"]': [new FakeElement('button')],
    };
    return { root, file, summary, reports, cards };
  }
  /** A chosen file whose bytes arrive when `release` is called. @param {string} name @param {Uint8Array} bytes */
  const slowFile = (name, bytes) => {
    /** @type {() => void} */
    let release = () => {};
    const ready = new Promise((resolve) => {
      release = () => resolve(bytes.buffer);
    });
    return { file: { name, size: bytes.length, arrayBuffer: () => ready }, release: () => release() };
  };
  const EMPTY_PDF = encoder.encode('%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF');
  /** Lets the tool's awaits run. */
  const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

  it('says "nothing found" only for a file it read, and announces the report once it is complete', async () => {
    const dom = installDom();
    Object.assign(globalThis, { HTMLInputElement: class {} });
    try {
      const { root, file, summary, reports, cards } = page();
      init(/** @type {HTMLElement} */ (/** @type {unknown} */ (root)));
      const chosen = slowFile('empty.pdf', EMPTY_PDF);
      Object.assign(file, { files: [chosen.file] });
      file.dispatchEvent({ type: 'change' });
      await settle();
      assert.equal(summary.textContent, '', 'nothing is announced while the file is being read');
      chosen.release();
      await settle();
      assert.equal(reports.children.length, 1);
      assert.equal(cards[0].select['[data-js="document-message"]'][0].textContent, 'Nothing found.');
      assert.equal(summary.textContent, 'The file has been checked.');
    } finally {
      dom.restore();
      delete (/** @type {Record<string, unknown>} */ (globalThis)).HTMLInputElement;
    }
  });

  it('a batch chosen while another is still being read replaces it, and the older one adds nothing', async () => {
    const dom = installDom();
    Object.assign(globalThis, { HTMLInputElement: class {} });
    try {
      const { root, file, summary, reports, cards } = page();
      init(/** @type {HTMLElement} */ (/** @type {unknown} */ (root)));
      const first = slowFile('first.pdf', EMPTY_PDF);
      Object.assign(file, { files: [first.file] });
      file.dispatchEvent({ type: 'change' });
      const second = [slowFile('a.pdf', EMPTY_PDF), slowFile('b.pdf', EMPTY_PDF)];
      Object.assign(file, { files: second.map((item) => item.file) });
      file.dispatchEvent({ type: 'change' });
      for (const item of second) item.release();
      await settle();
      first.release();
      await settle();
      assert.deepEqual(reports.children.map((card) => card.select['[data-js="document-name"]'][0].textContent), ['a.pdf', 'b.pdf']);
      assert.equal(summary.textContent, 'Files checked: 2.');
      assert.equal(cards.length, 3, 'the older card was made, but not shown');
    } finally {
      dom.restore();
      delete (/** @type {Record<string, unknown>} */ (globalThis)).HTMLInputElement;
    }
  });
});

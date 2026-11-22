// @ts-check
/**
 * @file Tests for writing and building PDFs (src/client/pdf-write.mjs, pdf-copy.mjs, pdf-build.mjs): the writer's
 * guarantees (plan §6.4), the build rules, one test per row of the carry-over table (§6.5), the check before a
 * result is offered (§6.9), the save choices, and the operation counts of §8. Sources are built byte by byte in
 * build-files.mjs; results are read back with the site's own reader.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { describe, it } from 'node:test';
import { build, checkResult, interleave, parseRanges, secretsOf, splitPages } from '../src/client/pdf-build.mjs';
import { COUNTS, PdfError, openPdf } from '../src/client/pdf-file.mjs';
import { pageList } from '../src/client/pdf-pages.mjs';
import { PdfDict, PdfName, PdfRef, PdfStream, PdfString, textOf } from '../src/client/pdf-syntax.mjs';
import { PdfWriter, YIELD_MS, pause } from '../src/client/pdf-write.mjs';
import { latin1, pdfFile, simplePdf } from './build-files.mjs';

/** @typedef {import('../src/client/pdf-build.mjs').PlanPage} PlanPage */
/** @typedef {import('./build-files.mjs').PdfPart} PdfPart */

const ID = new Uint8Array(16);

/** @param {Uint8Array} bytes */
async function source(bytes) {
  const file = await openPdf(bytes);
  return { file, pages: pageList(file) };
}

/**
 * A plan of pages: [source, index] pairs, or 'blank'.
 * @param {([number, number] | [number, number, 0 | 90 | 180 | 270] | 'blank')[]} list
 * @returns {PlanPage[]}
 */
const plan = (list) => list.map((item, key) => (item === 'blank' ? { key, origin: { blank: { width: 200, height: 300 } }, turn: 0 } : { key, origin: { source: item[0], index: item[1] }, turn: item[2] ?? 0 }));

/** @param {Map<number, { file: import('../src/client/pdf-file.mjs').PdfFile, pages: import('../src/client/pdf-pages.mjs').PageInfo[] }>} sources @param {PlanPage[]} pages */
const run = (sources, pages) => build({ pages, sources, id: ID });

/** Every page's content, decoded, as text. @param {Uint8Array} bytes */
async function contents(bytes) {
  const file = await openPdf(bytes);
  const out = [];
  for (const page of pageList(file)) {
    const value = file.resolve(page.dict.get('Contents'));
    const streams = Array.isArray(value) ? value.map((item) => file.resolve(item)) : [value];
    let text = '';
    for (const stream of streams) if (stream instanceof PdfStream) text += String.fromCharCode(...(await file.decode(stream)));
    out.push(text);
  }
  return out;
}

/** All bytes of a file plus every decodable stream, decoded: what "absent even when compressed" searches. @param {Uint8Array} bytes */
async function everything(bytes) {
  const file = await openPdf(bytes);
  let text = String.fromCharCode(...bytes);
  for (const num of file.entries.keys()) {
    const value = file.get(num);
    if (value instanceof PdfStream) text += String.fromCharCode(...(await file.decode(value).catch(() => new Uint8Array(0))));
  }
  for (const pack of file.packs.values()) if (!(pack instanceof Error)) text += String.fromCharCode(...pack.data);
  return text;
}

/**
 * A one-page-per-entry source with extra objects; pages are objects 3, 4, 5… with content streams 20, 21, 22….
 * @param {{ pages?: string[], catalog?: string, extra?: PdfPart[], trailer?: string }} spec  pages: extra page keys.
 */
function sourceFile({ pages = [''], catalog = '', extra = [], trailer = '' }) {
  const kids = pages.map((_, i) => `${3 + i} 0 R`).join(' ');
  /** @type {PdfPart[]} */
  const objects = [
    { num: 1, body: `<< /Type /Catalog /Pages 2 0 R ${catalog} >>` },
    { num: 2, body: `<< /Type /Pages /Kids [${kids}] /Count ${pages.length} /MediaBox [0 0 600 800] >>` },
    ...pages.map((keys, i) => ({ num: 3 + i, body: `<< /Type /Page /Parent 2 0 R /Contents ${20 + i} 0 R /Resources << >> ${keys} >>` })),
    ...pages.map((_, i) => ({ num: 20 + i, stream: { data: `BT (page ${i + 1}) Tj ET` } })),
    ...extra,
  ];
  return pdfFile({ objects, trailer });
}

describe('PDF writer (plan §6.4)', () => {
  it('writes a file our reader opens without repair: PDF 1.7, object streams, a cross-reference stream, an /ID and no /Info', async () => {
    const writer = new PdfWriter();
    const page = writer.reserve();
    const pages = writer.add(new PdfDict([['Type', new PdfName('Pages')], ['Kids', [page]], ['Count', 1]]));
    writer.set(page, new PdfDict([['Type', new PdfName('Page')], ['Parent', pages], ['MediaBox', [0, 0, 10, 10]], ['Resources', new PdfDict()]]));
    const root = writer.add(new PdfDict([['Type', new PdfName('Catalog')], ['Pages', pages]]));
    const bytes = await writer.write({ root, id: ID });
    assert.equal(String.fromCharCode(...bytes.subarray(0, 8)), '%PDF-1.7');
    const file = await openPdf(bytes);
    assert.equal(file.repaired, false);
    assert.equal(pageList(file).length, 1);
    assert.ok(Array.isArray(file.trailer.get('ID')));
    assert.equal(file.trailer.has('Info'), false);
    assert.ok([...file.entries.values()].some((entry) => entry.type === 'packed'));
  });

  it('gives the same bytes run to run with a fixed /ID, and a fresh /ID otherwise', async () => {
    const sources = new Map([[1, await source(simplePdf(3))]]);
    const a = await run(sources, plan([[1, 2], [1, 0]]));
    const b = await run(sources, plan([[1, 2], [1, 0]]));
    assert.deepEqual(Array.from(a.bytes), Array.from(b.bytes));
    const c = await build({ pages: plan([[1, 2], [1, 0]]), sources });
    const d = await build({ pages: plan([[1, 2], [1, 0]]), sources });
    assert.notDeepEqual(Array.from(c.bytes), Array.from(d.bytes));
  });

  it('writes identical streams once', async () => {
    const writer = new PdfWriter();
    const x = writer.reserve();
    const y = writer.reserve();
    const z = writer.reserve();
    const image = () => new PdfDict([['Subtype', new PdfName('Image')]]);
    await writer.setStream(x, new PdfStream(image(), latin1('pixels')));
    await writer.setStream(y, new PdfStream(image(), latin1('pixels')));
    await writer.setStream(z, new PdfStream(image(), latin1('other pixels')));
    const page = writer.reserve();
    const pages = writer.add(new PdfDict([['Type', new PdfName('Pages')], ['Kids', [page]], ['Count', 1]]));
    writer.set(page, new PdfDict([['Type', new PdfName('Page')], ['Parent', pages], ['MediaBox', [0, 0, 10, 10]], ['Resources', new PdfDict()]]));
    const root = writer.add(new PdfDict([['Type', new PdfName('Catalog')], ['Pages', pages], ['A', x], ['B', y], ['C', z]]));
    const out = await writer.write({ root, id: ID });
    assert.equal(String.fromCharCode(...out).match(/\nstream\n/g)?.length, 4, 'two pictures, one object stream, the cross-reference stream');
    const file = await openPdf(out);
    const dict = /** @type {PdfDict} */ (file.resolve(file.trailer.get('Root')));
    assert.equal(/** @type {PdfRef} */ (dict.get('A')).num, /** @type {PdfRef} */ (dict.get('B')).num, 'both names point at the one copy');
    assert.notEqual(/** @type {PdfRef} */ (dict.get('A')).num, /** @type {PdfRef} */ (dict.get('C')).num);
  });

  it('never puts a stream or a bare reference into an object stream', async () => {
    const result = await run(new Map([[1, await source(simplePdf(4))]]), plan([[1, 0], [1, 1], [1, 2], [1, 3]]));
    const file = await openPdf(result.bytes);
    for (const [num, entry] of file.entries) {
      if (entry.type !== 'packed') continue;
      const value = file.get(num);
      assert.ok(!(value instanceof PdfStream) && !(value instanceof PdfRef), `object ${num}`);
    }
  });
});

describe('PDF build: pausing', () => {
  it('yields to the page by time, not on every call: a browser timer costs about 4 ms, so a pause per page doubled a 500-page build', async () => {
    const real = globalThis.setTimeout;
    let timers = 0;
    globalThis.setTimeout = /** @type {typeof setTimeout} */ (/** @type {unknown} */ ((/** @type {() => void} */ run) => {
      timers += 1;
      return real(run, 0);
    }));
    try {
      await new Promise((resolve) => real(resolve, YIELD_MS + 5));
      const start = performance.now();
      for (let i = 0; i < 500; i += 1) await pause();
      const elapsed = performance.now() - start;
      assert.ok(timers >= 1, 'the first pause after a long stretch of work yields');
      assert.ok(timers <= 1 + Math.ceil(elapsed / YIELD_MS), `${timers} timers in ${Math.round(elapsed)} ms`);
    } finally {
      globalThis.setTimeout = real;
    }
    assert.equal(YIELD_MS, 50, 'the long-task threshold: the page stays responsive and Cancel is seen');
  });
});

describe('PDF build: pages', () => {
  it('merges two files in the planned order, each page\'s content as in its source', async () => {
    const sources = new Map([[1, await source(simplePdf(3))], [2, await source(sourceFile({ pages: ['', ''] }))]]);
    const result = await run(sources, plan([[2, 1], [1, 0], [1, 2], [2, 0], [1, 1]]));
    assert.equal(result.report.pages, 5);
    assert.deepEqual(await contents(result.bytes), ['BT (page 2) Tj ET', 'BT /F1 12 Tf 72 720 Td (Page 1) Tj ET', 'BT /F1 12 Tf 72 720 Td (Page 3) Tj ET', 'BT (page 1) Tj ET', 'BT /F1 12 Tf 72 720 Td (Page 2) Tj ET']);
  });

  it('copies a compressed stream byte for byte, never decoding it', async () => {
    const data = deflateSync(latin1('BT (compressed) Tj ET'));
    const bytes = sourceFile({ extra: [], pages: [''] });
    const replaced = pdfFile({ objects: [
      { num: 1, body: '<< /Type /Catalog /Pages 2 0 R >>' },
      { num: 2, body: '<< /Type /Pages /Kids [3 0 R] /Count 1 >>' },
      { num: 3, body: '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] /Contents 4 0 R >>' },
      { num: 4, stream: { dict: '/Filter /FlateDecode', data } },
    ] });
    const before = COUNTS.decoded;
    const result = await run(new Map([[1, await source(replaced)]]), plan([[1, 0]]));
    assert.equal(COUNTS.decoded, before, 'saving decodes nothing');
    assert.ok(Buffer.from(result.bytes).includes(Buffer.from(data)), 'the same compressed bytes');
    void bytes;
  });

  it('adds a turn to the page\'s own rotation', async () => {
    const sources = new Map([[1, await source(sourceFile({ pages: ['/Rotate 90', '', '/Rotate 270'] }))]]);
    const result = await run(sources, plan([[1, 0, 90], [1, 1, 270], [1, 2, 180]]));
    assert.deepEqual(pageList(await openPdf(result.bytes)).map((page) => page.rotate), [180, 270, 90]);
  });

  it('writes a duplicated page\'s objects once', async () => {
    const sources = new Map([[1, await source(simplePdf(1))]]);
    const result = await run(sources, plan([[1, 0], [1, 0], [1, 0]]));
    const file = await openPdf(result.bytes);
    const list = pageList(file);
    assert.equal(list.length, 3);
    const refs = list.map((page) => /** @type {PdfRef} */ (page.dict.get('Contents')).num);
    assert.equal(new Set(refs).size, 1, 'one content stream for three pages');
    assert.equal(new Set(list.map((page) => page.ref?.num)).size, 3, 'three page objects');
  });

  it('adds a blank page of the given size', async () => {
    const result = await run(new Map([[1, await source(simplePdf(1))]]), plan([[1, 0], 'blank']));
    const list = pageList(await openPdf(result.bytes));
    assert.deepEqual(list[1].mediaBox, [0, 0, 200, 300]);
    assert.equal(list[1].dict.has('Contents'), false);
  });

  it('writes inherited attributes on the page, and keeps shared resources whole when a sibling is dropped', async () => {
    const bytes = pdfFile({ objects: [
      { num: 1, body: '<< /Type /Catalog /Pages 2 0 R >>' },
      { num: 2, body: '<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 /MediaBox [0 0 500 700] /CropBox [10 10 490 690] /Rotate 90 /Resources 9 0 R >>' },
      { num: 3, body: '<< /Type /Page /Parent 2 0 R /Contents 5 0 R >>' },
      { num: 4, body: '<< /Type /Page /Parent 2 0 R /Contents 6 0 R >>' },
      { num: 5, stream: { data: 'q /Im1 Do Q' } },
      { num: 6, stream: { data: 'q /Im2 Do Q' } },
      { num: 9, body: '<< /XObject << /Im1 10 0 R /Im2 11 0 R >> >>' },
      { num: 10, stream: { dict: '/Type /XObject /Subtype /Image /Width 1 /Height 1 /ColorSpace /DeviceGray /BitsPerComponent 8', data: 'A' } },
      { num: 11, stream: { dict: '/Type /XObject /Subtype /Image /Width 1 /Height 1 /ColorSpace /DeviceGray /BitsPerComponent 8', data: 'B' } },
    ] });
    const result = await run(new Map([[1, await source(bytes)]]), plan([[1, 1]]));
    const file = await openPdf(result.bytes);
    const [page] = pageList(file);
    assert.deepEqual(page.mediaBox, [0, 0, 500, 700]);
    assert.deepEqual(page.cropBox, [10, 10, 490, 690]);
    assert.equal(page.rotate, 90);
    assert.ok(page.dict.has('MediaBox') && page.dict.has('Resources') && page.dict.has('CropBox') && page.dict.has('Rotate'), 'written on the page itself');
    const xobjects = file.resolve(/** @type {PdfDict} */ (file.resolve(page.dict.get('Resources'))).get('XObject'));
    assert.ok(xobjects instanceof PdfDict && xobjects.has('Im1') && xobjects.has('Im2'), 'the shared dictionary is not trimmed');
  });

  it('refuses an encrypted source until locked files are supported', async () => {
    const bytes = sourceFile({ extra: [{ num: 40, body: '<< /Filter /Standard /V 1 /R 2 >>' }], trailer: '/Encrypt 40 0 R' });
    await assert.rejects(run(new Map([[1, await source(bytes)]]), plan([[1, 0]])), (error) => error instanceof PdfError && error.code === 'locked');
  });
});

describe('PDF build: what is carried over (plan §6.5)', () => {
  it('keeps a hidden layer hidden after a merge and after a split', async () => {
    const layered = sourceFile({
      pages: ['/Resources << /Properties << /L1 30 0 R /L2 31 0 R >> >>', ''],
      catalog: '/OCProperties << /OCGs [30 0 R 31 0 R] /D << /OFF [31 0 R] /Order [30 0 R 31 0 R] >> >>',
      extra: [{ num: 30, body: '<< /Type /OCG /Name (Shown) >>' }, { num: 31, body: '<< /Type /OCG /Name (Hidden) >>' }],
    });
    const based = sourceFile({
      pages: ['/Resources << /Properties << /L3 30 0 R /L4 31 0 R >> >>'],
      catalog: '/OCProperties << /OCGs [30 0 R 31 0 R] /D << /BaseState /OFF /ON [30 0 R] >> >>',
      extra: [{ num: 30, body: '<< /Type /OCG /Name (On) >>' }, { num: 31, body: '<< /Type /OCG /Name (Off by base state) >>' }],
    });
    const sources = new Map([[1, await source(layered)], [2, await source(based)]]);
    for (const pages of [plan([[1, 0], [2, 0]]), plan([[1, 0]]), plan([[1, 1]])]) {
      const result = await run(sources, pages);
      assert.ok(result.report.kept.includes('layers'));
      const file = await openPdf(result.bytes);
      const properties = /** @type {PdfDict} */ (file.resolve(file.catalog().get('OCProperties')));
      const off = /** @type {PdfRef[]} */ (/** @type {PdfDict} */ (file.resolve(properties.get('D'))).get('OFF'));
      const names = off.map((ref) => textOf(/** @type {PdfString} */ (/** @type {PdfDict} */ (file.resolve(ref)).get('Name'))));
      assert.ok(names.includes('Hidden'));
      if (pages.length === 2) assert.ok(names.includes('Off by base state'));
      assert.ok(!names.includes('Shown') && !names.includes('On'));
    }
  });

  it('keeps a link to a kept page, pointing at its copy, and removes a link to a dropped page; named destinations are resolved', async () => {
    const linked = sourceFile({
      pages: ['/Annots [40 0 R 41 0 R 42 0 R 43 0 R]', '', ''],
      catalog: '/Names << /Dests << /Names [(chapter) [5 0 R /Fit]] >> >>',
      extra: [
        { num: 40, body: '<< /Type /Annot /Subtype /Link /Rect [0 0 10 10] /Dest [4 0 R /XYZ 0 800 0] >>' },
        { num: 41, body: '<< /Type /Annot /Subtype /Link /Rect [0 0 10 10] /A << /S /GoTo /D [5 0 R /Fit] >> >>' },
        { num: 42, body: '<< /Type /Annot /Subtype /Link /Rect [0 0 10 10] /A << /S /URI /URI (https://example.org/) >> >>' },
        { num: 43, body: '<< /Type /Annot /Subtype /Link /Rect [0 0 10 10] /Dest (chapter) >>' },
      ],
    });
    const result = await run(new Map([[1, await source(linked)]]), plan([[1, 0], [1, 2]]));
    assert.equal(result.report.linksRemoved, 1, 'the link to page 2, which is not kept');
    const file = await openPdf(result.bytes);
    const [first, second] = pageList(file);
    const annots = /** @type {PdfRef[]} */ (first.dict.get('Annots')).map((ref) => /** @type {PdfDict} */ (file.resolve(ref)));
    assert.equal(annots.length, 3);
    const goTo = /** @type {PdfDict} */ (annots[0].get('A'));
    assert.equal(/** @type {PdfRef} */ (/** @type {PdfRef[]} */ (goTo.get('D'))[0]).num, second.ref?.num, 'GoTo points at the copy of page 3');
    const uri = /** @type {PdfDict} */ (annots[1].get('A')).get('URI');
    assert.equal(textOf(/** @type {PdfString} */ (uri)), 'https://example.org/');
    assert.equal(/** @type {PdfRef} */ (/** @type {PdfRef[]} */ (annots[2].get('Dest'))[0]).num, second.ref?.num, 'the named destination became explicit');
  });

  it('keeps comments and their popups with their page, and says so', async () => {
    const commented = sourceFile({
      pages: ['/Annots [40 0 R 41 0 R]'],
      extra: [
        { num: 40, body: '<< /Type /Annot /Subtype /Text /Rect [0 0 10 10] /Contents (Check this) /Popup 41 0 R /P 3 0 R >>' },
        { num: 41, body: '<< /Type /Annot /Subtype /Popup /Rect [0 0 100 100] /Parent 40 0 R >>' },
      ],
    });
    const result = await run(new Map([[1, await source(commented)]]), plan([[1, 0]]));
    assert.deepEqual(result.report.kept, ['comments']);
    const file = await openPdf(result.bytes);
    const [page] = pageList(file);
    const [note, popup] = /** @type {PdfRef[]} */ (page.dict.get('Annots')).map((ref) => /** @type {PdfDict} */ (file.resolve(ref)));
    assert.equal(/** @type {PdfRef} */ (note.get('P')).num, page.ref?.num, '/P points at the new page');
    assert.equal(/** @type {PdfRef} */ (popup.get('Parent')).num, /** @type {PdfRef[]} */ (page.dict.get('Annots'))[0].num);
  });

  it('keeps form fields that have a widget on a kept page, and only those', async () => {
    const form = sourceFile({
      pages: ['/Annots [40 0 R]', '/Annots [41 0 R 42 0 R]'],
      catalog: '/AcroForm << /Fields [40 0 R 43 0 R] /NeedAppearances true /DA (/Helv 0 Tf 0 g) >>',
      extra: [
        { num: 40, body: '<< /Type /Annot /Subtype /Widget /FT /Tx /T (name) /V (Ana) /Rect [0 0 10 10] /P 3 0 R >>' },
        { num: 41, body: '<< /Type /Annot /Subtype /Widget /FT /Tx /T (city) /V (Batumi) /Rect [0 0 10 10] /P 4 0 R >>' },
        { num: 42, body: '<< /Type /Annot /Subtype /Widget /Parent 43 0 R /Rect [0 0 10 10] /P 4 0 R /MK << /CA (on dropped page) >> >>' },
        { num: 43, body: '<< /FT /Btn /T (agree) /Kids [42 0 R 44 0 R] >>' },
        { num: 44, body: '<< /Type /Annot /Subtype /Widget /Parent 43 0 R /Rect [0 0 10 10] /P 3 0 R >>' },
      ],
    });
    const fixed = latin1(String.fromCharCode(...form).replace('/Annots [40 0 R]', '/Annots [40 0 R 44 0 R]'));
    const result = await run(new Map([[1, await source(fixed)]]), plan([[1, 0]]));
    assert.deepEqual(result.report.kept, ['fields']);
    const file = await openPdf(result.bytes);
    const acro = /** @type {PdfDict} */ (file.resolve(file.catalog().get('AcroForm')));
    const fields = /** @type {PdfRef[]} */ (acro.get('Fields')).map((ref) => /** @type {PdfDict} */ (file.resolve(ref)));
    assert.deepEqual(fields.map((field) => textOf(/** @type {PdfString} */ (field.get('T')))), ['name', 'agree']);
    assert.equal(/** @type {PdfRef[]} */ (fields[1].get('Kids')).length, 1, 'only the widget on the kept page');
    assert.equal(acro.get('NeedAppearances'), true);
    const text = await everything(result.bytes);
    assert.ok(!text.includes('Batumi') && !text.includes('on dropped page'), 'what only the dropped page had is not in the file');
  });

  it('keeps fields with the same name from two sources under distinct full names, as qpdf does', async () => {
    const form = (/** @type {string} */ value) => sourceFile({
      pages: ['/Annots [40 0 R 42 0 R]'],
      catalog: '/AcroForm << /Fields [40 0 R 41 0 R] >>',
      extra: [
        { num: 40, body: `<< /Type /Annot /Subtype /Widget /FT /Tx /T (name) /V (${value}) /Rect [0 0 10 10] /P 3 0 R >>` },
        { num: 41, body: '<< /T <FEFF0070006500720073006F006E> /Kids [42 0 R] >>' },
        { num: 42, body: `<< /Type /Annot /Subtype /Widget /FT /Tx /T (city) /V (${value}ville) /Parent 41 0 R /Rect [0 0 10 10] /P 3 0 R >>` },
      ],
    });
    const sources = new Map([[1, await source(form('Ana'))], [2, await source(form('Beka'))], [3, await source(form('Gio'))]]);
    const result = await run(sources, plan([[1, 0], [2, 0], [3, 0]]));
    const file = await openPdf(result.bytes);
    const acro = /** @type {PdfDict} */ (file.resolve(file.catalog().get('AcroForm')));
    const names = /** @type {PdfRef[]} */ (acro.get('Fields')).map((ref) => textOf(/** @type {PdfString} */ (/** @type {PdfDict} */ (file.resolve(ref)).get('T'))));
    assert.deepEqual(names, ['name', 'person', 'name+1', 'person+1', 'name+2', 'person+2']);
  });

  it('keeps a signature field\'s appearance but not the signature, and warns', async () => {
    const signed = sourceFile({
      pages: ['/Annots [40 0 R]'],
      catalog: '/AcroForm << /Fields [40 0 R] /SigFlags 3 >>',
      extra: [
        { num: 40, body: '<< /Type /Annot /Subtype /Widget /FT /Sig /T (Signature1) /V 41 0 R /Rect [0 0 10 10] /P 3 0 R /AP << /N 42 0 R >> >>' },
        { num: 41, body: '<< /Type /Sig /Filter /Adobe.PPKLite /Name (Signer Name) /Contents <00> /ByteRange [0 1 2 3] >>' },
        { num: 42, stream: { dict: '/Type /XObject /Subtype /Form /BBox [0 0 10 10]', data: '0 0 m 10 10 l S' } },
      ],
    });
    const result = await run(new Map([[1, await source(signed)]]), plan([[1, 0]]));
    assert.deepEqual(result.report.warnings, ['signatures']);
    const text = await everything(result.bytes);
    assert.ok(!text.includes('Signer Name') && !text.includes('ByteRange') && !text.includes('SigFlags'));
    assert.ok(text.includes('0 0 m 10 10 l S'), 'the appearance travels');
  });

  it('carries no scripts, open actions, attachments, Info or XMP, even inside compressed object streams, and lists exactly what was left', async () => {
    const xmp = '<x:xmpmeta xmlns:x="adobe:ns:meta/"><dc:creator>Secret Author</dc:creator></x:xmpmeta>';
    const loaded = pdfFile({ packed: { num: 50, objects: [
      { num: 1, body: '<< /Type /Catalog /Pages 2 0 R /OpenAction 30 0 R /AA << /WC 30 0 R >> /Names << /JavaScript 31 0 R /EmbeddedFiles 32 0 R >> /Outlines 33 0 R /PageLabels << /Nums [0 << /S /D >>] >> /StructTreeRoot 34 0 R /MarkInfo << /Marked true >> /Metadata 35 0 R >>' },
      { num: 2, body: '<< /Type /Pages /Kids [3 0 R] /Count 1 >>' },
      { num: 3, body: '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] /Contents 20 0 R /Resources << /XObject << /Im1 38 0 R >> >> /AA << /O 30 0 R >> /Annots [40 0 R 41 0 R 42 0 R 43 0 R] /StructParents 0 /PieceInfo << /App << /Private (app data) >> >> /Thumb 36 0 R /Metadata 35 0 R >>' },
      { num: 42, body: '<< /Type /Annot /Subtype /Square /Rect [0 0 10 10] /Doc 1 0 R /Tree 2 0 R >>' },
      { num: 43, body: '<< /Type /Annot /Subtype /Link /Rect [0 0 10 10] /Dest [60 0 R /Fit] >>' },
      { num: 30, body: '<< /S /JavaScript /JS (app.alert\\("hello"\\)) >>' },
      { num: 31, body: '<< /Names [(script) 30 0 R] >>' },
      { num: 32, body: '<< /Names [(secret.txt) << /Type /Filespec /F (secret.txt) >>] >>' },
      { num: 33, body: '<< /Type /Outlines /First 37 0 R /Last 37 0 R /Count 1 >>' },
      { num: 34, body: '<< /Type /StructTreeRoot >>' },
      { num: 37, body: '<< /Title (Chapter) /Parent 33 0 R /Dest [3 0 R /Fit] >>' },
      { num: 40, body: '<< /Type /Annot /Subtype /FileAttachment /Rect [0 0 10 10] /FS << /Type /Filespec /F (attached.txt) >> >>' },
      { num: 41, body: '<< /Type /Annot /Subtype /Link /Rect [0 0 10 10] /A 30 0 R >>' },
      { num: 60, body: '<< /Title (Quarterly Secret Plan) /Author (Secret Author) /Producer (Some Producer 1.0) >>' },
    ] }, objects: [
      { num: 20, stream: { data: 'BT (body) Tj ET' } },
      { num: 35, stream: { dict: '/Type /Metadata /Subtype /XML', data: xmp } },
      { num: 36, stream: { data: 'thumbnail' } },
      { num: 38, stream: { dict: '/Type /XObject /Subtype /Image /Width 1 /Height 1 /ColorSpace /DeviceGray /BitsPerComponent 8 /Metadata 35 0 R', data: 'A' } },
    ], xref: 'stream', trailer: '/Info 60 0 R' });
    const result = await run(new Map([[1, await source(loaded)]]), plan([[1, 0]]));
    assert.deepEqual(result.report.dropped, ['attachments', 'bookmarks', 'pageLabels', 'scripts', 'structure']);
    assert.deepEqual(result.report.kept, ['comments']);
    assert.equal(result.report.linksRemoved, 1, 'a link whose target is not a page');
    const text = await everything(result.bytes);
    for (const word of ['JavaScript', 'app.alert', 'OpenAction', '/AA', 'EmbeddedFiles', 'secret.txt', 'attached.txt', 'xmpmeta', 'Secret Author', 'Quarterly Secret Plan', 'Some Producer', 'PieceInfo', 'app data', 'thumbnail', 'StructTreeRoot', 'StructParents', 'Chapter', '/Info', '/Metadata']) {
      assert.ok(!text.includes(word), word);
    }
    assert.ok(text.includes('BT (body) Tj ET'));
  });

  it('reports nothing for a plain file', async () => {
    const result = await run(new Map([[1, await source(simplePdf(2))]]), plan([[1, 0], [1, 1]]));
    assert.deepEqual([result.report.dropped, result.report.kept, result.report.warnings, result.report.linksRemoved], [[], [], [], 0]);
  });

  it('carries annotations with the first copy of a page only, and says so', async () => {
    const commented = sourceFile({ pages: ['/Annots [40 0 R]'], extra: [{ num: 40, body: '<< /Type /Annot /Subtype /Text /Rect [0 0 10 10] /Contents (note) >>' }] });
    const result = await run(new Map([[1, await source(commented)]]), plan([[1, 0], [1, 0]]));
    assert.deepEqual(result.report.warnings, ['annotationsOnce']);
    const [first, second] = pageList(await openPdf(result.bytes));
    assert.ok(first.dict.has('Annots') && !second.dict.has('Annots'));
  });
});

describe('PDF build: the check before a result is offered (plan §6.9)', () => {
  it('passes what build writes, and refuses Info, metadata, a wrong page count and a source secret', async () => {
    const good = (await run(new Map([[1, await source(simplePdf(2))]]), plan([[1, 0], [1, 1]]))).bytes;
    await checkResult(good, { pages: 2, secrets: new Set() });
    /** @param {Promise<void>} promise */
    const fails = (promise) => assert.rejects(promise, (error) => error instanceof PdfError && error.code === 'buildFailed');
    await fails(checkResult(good, { pages: 3, secrets: new Set() }));
    await fails(checkResult(latin1(String.fromCharCode(...simplePdf(1)).replace('xref', 'xrfe')), { pages: 1, secrets: new Set() }));
    await fails(checkResult(simplePdf(1, { trailer: '/Info << /Title (x) >>' }), { pages: 1, secrets: new Set() }));
    const withMetadata = pdfFile({ objects: [{ num: 1, body: '<< /Type /Catalog /Pages 2 0 R /Metadata 4 0 R >>' }, { num: 2, body: '<< /Type /Pages /Kids [3 0 R] /Count 1 >>' }, { num: 3, body: '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 1 1] /Resources << >> >>' }, { num: 4, stream: { data: 'x' } }] });
    await fails(checkResult(withMetadata, { pages: 1, secrets: new Set() }));
    const leaking = pdfFile({ objects: [{ num: 1, body: '<< /Type /Catalog /Pages 2 0 R /Lang (Quarterly Secret Plan draft) >>' }, { num: 2, body: '<< /Type /Pages /Kids [3 0 R] /Count 1 >>' }, { num: 3, body: '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 1 1] /Resources << >> >>' }] });
    await fails(checkResult(leaking, { pages: 1, secrets: new Set(['Quarterly Secret Plan']) }));
    const own = pdfFile({ objects: [{ num: 1, body: '<< /Type /Catalog /Pages 2 0 R >>' }, { num: 2, body: '<< /Type /Pages /Kids [3 0 R] /Count 1 >>' }, { num: 3, body: '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 1 1] /Resources << >> /Annots [<< /Subtype /Text /Contents (About the Quarterly Secret Plan) >>] >>' }] });
    await checkResult(own, { pages: 1, secrets: new Set(['Quarterly Secret Plan']) });
  });

  it('reads the sources\' secrets from their information dictionaries, in either encoding', async () => {
    const file = await openPdf(simplePdf(1, { trailer: '/Info << /Title <FEFF004D0079002000540069> /Author (Nino Beridze) /Creator (ab) >>' }));
    assert.deepEqual([...secretsOf([file])], ['My Ti', 'Nino Beridze']);
  });
});

describe('PDF build: save choices', () => {
  const pages = plan([[1, 0], [1, 1], [2, 0], [1, 2], 'blank', [2, 1]]);

  it('splits by each rule', () => {
    /** @param {PlanPage[][]} groups */
    const keys = (groups) => groups.map((group) => group.map((page) => page.key));
    assert.deepEqual(keys(splitPages(pages, { kind: 'all' })), [[0, 1, 2, 3, 4, 5]]);
    assert.deepEqual(keys(splitPages(pages, { kind: 'selected', keys: new Set([1, 4]) })), [[1, 4]]);
    assert.deepEqual(keys(splitPages(pages, { kind: 'selected', keys: new Set() })), []);
    assert.deepEqual(keys(splitPages(pages, { kind: 'ranges', ranges: [[1, 2], [4, 6], [3, 3]] })), [[0, 1], [3, 4, 5], [2]]);
    assert.deepEqual(keys(splitPages(pages, { kind: 'every', n: 4 })), [[0, 1, 2, 3], [4, 5]]);
    assert.deepEqual(keys(splitPages(pages, { kind: 'single' })), [[0], [1], [2], [3], [4], [5]]);
    assert.deepEqual(keys(splitPages(pages, { kind: 'source' })), [[0, 1, 3], [2, 5], [4]]);
  });

  it('reads typed ranges, and refuses what is not one', () => {
    assert.deepEqual(parseRanges('1-3, 5, 8-', 10), [[1, 3], [5, 5], [8, 10]]);
    assert.deepEqual(parseRanges('2–4; 6', 10), [[2, 4], [6, 6]]);
    for (const bad of ['', '0', '3-2', '11', '1-11', 'a', '1-3-5', '-3']) assert.equal(parseRanges(bad, 10), null, bad);
  });

  it('interleaves two runs, with and without reversing the second', () => {
    const a = plan([[1, 0], [1, 1], [1, 2]]);
    const b = plan([[2, 0], [2, 1], [2, 2]]).map((page) => ({ ...page, key: page.key + 10 }));
    assert.deepEqual(interleave(a, b, false).map((page) => page.key), [0, 10, 1, 11, 2, 12]);
    assert.deepEqual(interleave(a, b, true).map((page) => page.key), [0, 12, 1, 11, 2, 10]);
    assert.deepEqual(interleave(a, b.slice(0, 1), false).map((page) => page.key), [0, 10, 1, 2]);
  });
});

describe('PDF build: operation counts and cancelling (plan §8)', () => {
  it('stops before the next batch when cancelled', async () => {
    const sources = new Map([[1, await source(simplePdf(30))]]);
    let calls = 0;
    await assert.rejects(build({ pages: plan(Array.from({ length: 30 }, (_, i) => /** @type {[number, number]} */ ([1, i]))), sources, isCancelled: () => (calls += 1) > 2 }), (error) => error instanceof PdfError && error.code === 'cancelled');
    assert.ok(calls <= 4, `${calls} checks`);
  });

  it('merges 500 pages from 5 files decoding no stream', async () => {
    /** @type {Map<number, { file: import('../src/client/pdf-file.mjs').PdfFile, pages: import('../src/client/pdf-pages.mjs').PageInfo[] }>} */
    const sources = new Map();
    for (let s = 1; s <= 5; s += 1) sources.set(s, await source(simplePdf(100)));
    const before = { ...COUNTS };
    const result = await run(sources, plan(Array.from({ length: 500 }, (_, i) => /** @type {[number, number]} */ ([1 + (i % 5), Math.floor(i / 5)]))));
    assert.equal(result.report.pages, 500);
    assert.equal(COUNTS.decoded, before.decoded);
  });
});

describe('PDF build: privacy', () => {
  it('uses no network, storage or URL state', () => {
    for (const module of ['pdf-write', 'pdf-copy', 'pdf-build']) {
      const source = readFileSync(new URL(`../src/client/${module}.mjs`, import.meta.url), 'utf8');
      for (const word of ['fetch(', 'XMLHttpRequest', 'sendBeacon', 'WebSocket', 'localStorage', 'sessionStorage', 'indexedDB', 'location.', 'history.']) {
        assert.ok(!source.includes(word), `${module}: ${word}`);
      }
    }
  });
});

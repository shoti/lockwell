// @ts-check
/**
 * @file Tests for sign and stamp, the pure part (plan docs/tools-plan/pdf-toolkit.md §7; research log §21): where an
 * overlay lands for every page rotation, how it is written into a page without touching what other pages share, the
 * ink of a photographed signature, and drawn strokes fitted into a box.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { build } from '../src/client/pdf-build.mjs';
import { openPdf } from '../src/client/pdf-file.mjs';
import { pageList } from '../src/client/pdf-pages.mjs';
import { INKS, MARKS, STAMP_OPACITY, apply, compose, fitStrokes, inkMask, overlayMatrix, shownSize, shownToUser } from '../src/client/pdf-overlay.mjs';
import { PdfDict, PdfName, PdfRef, PdfStream } from '../src/client/pdf-syntax.mjs';
import { pdfFile, simplePdf } from './build-files.mjs';

/** @typedef {import('../src/client/pdf-overlay.mjs').Overlay} Overlay */

/** @param {{ x: number, y: number }} p */
const round = (p) => ({ x: Math.round(p.x * 1000) / 1000, y: Math.round(p.y * 1000) / 1000 });

describe('overlays: geometry', () => {
  const box = [10, 20, 210, 120]; // 200 wide, 100 high

  it('puts the top left of the page as shown where each rotation sends it, without scaling', () => {
    // A viewer turns the page clockwise: the shown top left is the unrotated top left, bottom left, bottom right, top right.
    const corners = { 0: { x: 10, y: 120 }, 90: { x: 10, y: 20 }, 180: { x: 210, y: 20 }, 270: { x: 210, y: 120 } };
    for (const [rotate, corner] of Object.entries(corners)) {
      const m = shownToUser({ box, rotate: Number(rotate) });
      assert.deepEqual(round(apply(m, { x: 0, y: 0 })), corner, `rotate ${rotate}`);
      assert.equal(Math.abs(m[0] * m[3] - m[1] * m[2]), 1, 'no scaling');
      const { width, height } = shownSize({ box, rotate: Number(rotate) });
      const far = apply(m, { x: width, y: height });
      assert.ok(far.x >= 10 && far.x <= 210 && far.y >= 20 && far.y <= 120, 'the shown bottom right is on the page too');
    }
    assert.deepEqual(shownSize({ box, rotate: 90 }), { width: 100, height: 200 });
  });

  it('maps an overlay\'s unit square onto its box on the shown page, turned about its centre', () => {
    const page = { box: [0, 0, 600, 800], rotate: 0 };
    const overlay = { x: 0.5, y: 0.25, w: 0.25, h: 0.125, rotation: 0, opacity: 1 };
    const m = overlayMatrix(overlay, page);
    assert.deepEqual(round(apply(m, { x: 0, y: 1 })), { x: 300, y: 600 }, 'top left: 25% down the page is 600 up from the bottom');
    assert.deepEqual(round(apply(m, { x: 1, y: 0 })), { x: 450, y: 500 }, 'bottom right');
    const turned = overlayMatrix({ ...overlay, rotation: 90 }, page);
    assert.deepEqual(round(apply(turned, { x: 0.5, y: 0.5 })), { x: 375, y: 550 }, 'the centre stays put');
    // Turned 90° clockwise as shown: the box's top left goes to its top right.
    assert.deepEqual(round(apply(turned, { x: 0, y: 1 })), { x: 425, y: 625 });
  });

  it('keeps an overlay where it was placed whatever the page\'s rotation: the same shown corner', () => {
    for (const rotate of [0, 90, 180, 270]) {
      const page = { box: [0, 0, 612, 792], rotate };
      const m = overlayMatrix({ x: 0.8, y: 0.9, w: 0.1, h: 0.05, rotation: 0, opacity: 1 }, page);
      const toShown = compose(m, invert(shownToUser(page)));
      const { width, height } = shownSize(page);
      const corner = apply(toShown, { x: 1, y: 0 });
      assert.deepEqual(round({ x: corner.x / width, y: corner.y / height }), { x: 0.9, y: 0.95 }, `rotate ${rotate}`);
    }
  });

  it('is not thenable: importing it with await gives the module (review P21)', async () => {
    const module = await import('../src/client/pdf-overlay.mjs');
    assert.equal(typeof module.compose, 'function');
    assert.equal('then' in module, false);
  });

  it('composes matrices first-then-second', () => {
    const scale = [2, 0, 0, 2, 0, 0];
    const move = [1, 0, 0, 1, 5, 0];
    assert.deepEqual(apply(compose(scale, move), { x: 1, y: 1 }), { x: 7, y: 2 });
    assert.deepEqual(apply(compose(move, scale), { x: 1, y: 1 }), { x: 12, y: 2 });
  });
});

/** @param {number[]} m */
function invert([a, b, c, d, e, f]) {
  const det = a * d - b * c;
  return [d / det, -b / det, -c / det, a / det, (c * f - d * e) / det, (b * e - a * f) / det];
}

describe('overlays: written into the page', () => {
  const mask = { width: 4, height: 2, data: Uint8Array.of(0, 255, 255, 0, 255, 0, 0, 255) };
  /** @type {Overlay[]} */
  const overlays = [
    { type: 'ink', x: 0.6, y: 0.8, w: 0.3, h: 0.1, rotation: 0, opacity: 1, strokes: [[{ x: 0, y: 0.5 }, { x: 0.5, y: 0 }, { x: 1, y: 1 }], [{ x: 0.2, y: 0.2 }]], width: 0.05, color: 'blue' },
    { type: 'mark', mark: 'tick', x: 0.1, y: 0.1, w: 0.05, h: 0.05, rotation: 0, opacity: 1, color: 'black' },
    { type: 'text', text: 'Nino Beridze', font: 'site', bold: false, color: 'black', mask, x: 0.1, y: 0.5, w: 0.3, h: 0.03, rotation: 0, opacity: 1 },
    { type: 'stamp', text: 'COPY', color: 'blue', mask, x: 0.2, y: 0.4, w: 0.6, h: 0.2, rotation: -30, opacity: STAMP_OPACITY },
  ];

  /** Two pages sharing one resource dictionary with a font and a picture. */
  const shared = () => pdfFile({ objects: [
    { num: 1, body: '<< /Type /Catalog /Pages 2 0 R >>' },
    { num: 2, body: '<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 /Resources 5 0 R >>' },
    { num: 3, body: '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 800] /Contents 6 0 R >>' },
    { num: 4, body: '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 800] /Rotate 90 /Contents 6 0 R >>' },
    { num: 5, body: '<< /XObject 7 0 R /ExtGState << /LwG1 << /CA 0.5 >> >> >>' },
    { num: 6, stream: { data: 'q 1 0 0 1 0 0 cm 0 0 1 rg 0 0 10 10 re f' } },
    { num: 7, body: '<< /LwO1 8 0 R >>' },
    { num: 8, stream: { dict: '/Type /XObject /Subtype /Form /BBox [0 0 1 1]', data: '' } },
  ] });

  it('wraps the page\'s content in q … Q, adds one stream after it, and names new resources apart from the old', async () => {
    const source = await openPdf(shared());
    const { bytes, report } = await build({
      pages: [{ key: 1, origin: { source: 1, index: 0 }, turn: 0, overlays }, { key: 2, origin: { source: 1, index: 1 }, turn: 0 }],
      sources: new Map([[1, { file: source, pages: pageList(source) }]]),
    });
    assert.deepEqual(report.warnings, ['signaturePicture'], 'a drawn signature is not a digital signature');
    const file = await openPdf(bytes);
    const [first, second] = pageList(file);
    const contents = /** @type {PdfRef[]} */ (first.dict.get('Contents'));
    assert.equal(contents.length, 3);
    const text = async (/** @type {PdfRef} */ ref) => {
      const stream = /** @type {PdfStream} */ (file.resolve(ref));
      return Buffer.from(await file.decode(stream)).toString('latin1');
    };
    assert.equal(await text(contents[0]), 'q\n');
    const drawn = await text(contents[2]);
    assert.match(drawn, /^Q\n/);
    assert.match(drawn, /0\.08 0\.2 0\.6 RG [\d.]+ w 1 J 1 j/, 'blue ink, round ends and joins');
    assert.match(drawn, /\/LwO2 Do/, '"LwO1" is taken by the page: the next free name');
    assert.match(drawn, /\/LwG2 gs/);
    const resources = /** @type {PdfDict} */ (file.resolve(first.dict.get('Resources')));
    const xobjects = /** @type {PdfDict} */ (file.resolve(resources.get('XObject')));
    assert.ok(xobjects.has('LwO1') && xobjects.has('LwO2') && xobjects.has('LwO3'));
    const state = /** @type {PdfDict} */ (file.resolve(/** @type {PdfDict} */ (file.resolve(resources.get('ExtGState'))).get('LwG2')));
    assert.equal(state.get('ca'), STAMP_OPACITY);
    const image = /** @type {PdfStream} */ (file.resolve(xobjects.get('LwO2')));
    assert.deepEqual([image.dict.get('Width'), image.dict.get('Height')], [1, 1]);
    const soft = /** @type {PdfStream} */ (file.resolve(image.dict.get('SMask')));
    assert.deepEqual([soft.dict.get('Width'), soft.dict.get('Height'), /** @type {PdfName} */ (soft.dict.get('ColorSpace')).value], [4, 2, 'DeviceGray']);
    const otherXobjects = /** @type {PdfDict} */ (file.resolve(/** @type {PdfDict} */ (file.resolve(second.dict.get('Resources'))).get('XObject')));
    assert.deepEqual([...otherXobjects.keys()], ['LwO1'], 'the other page keeps the shared resources as they were');
    assert.ok(second.dict.get('Contents') instanceof PdfRef, 'and its content as it was');
  });

  it('splices a /Contents that refers to an array of streams, keeping every stream (review P1)', async () => {
    const bytes = pdfFile({ objects: [
      { num: 1, body: '<< /Type /Catalog /Pages 2 0 R >>' },
      { num: 2, body: '<< /Type /Pages /Kids [3 0 R] /Count 1 >>' },
      { num: 3, body: '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 800] /Resources << >> /Contents 4 0 R >>' },
      { num: 4, body: '[5 0 R 6 0 R]' },
      { num: 5, stream: { data: '0 0 1 rg' } },
      { num: 6, stream: { data: '0 0 10 10 re f' } },
    ] });
    const source = await openPdf(bytes);
    const result = await build({ pages: [{ key: 1, origin: { source: 1, index: 0 }, turn: 0, overlays: [overlays[1]] }], sources: new Map([[1, { file: source, pages: pageList(source) }]]) });
    const file = await openPdf(result.bytes);
    const [page] = pageList(file);
    const contents = /** @type {PdfRef[]} */ (file.resolve(page.dict.get('Contents')));
    const texts = [];
    for (const ref of contents) {
      const stream = file.resolve(ref);
      assert.ok(stream instanceof PdfStream, 'every entry is a stream, never an array');
      texts.push(Buffer.from(await file.decode(stream)).toString('latin1').split('\n')[0]);
    }
    assert.deepEqual(texts.slice(0, 3), ['q', '0 0 1 rg', '0 0 10 10 re f']);
    assert.match(texts[3], /^Q/);
  });

  it('works on blank pages and picture pages, and writes each distinct mask once', async () => {
    const twice = /** @type {Overlay} */ ({ type: 'text', text: 'x', font: 'site', bold: false, color: 'black', mask, x: 0, y: 0, w: 0.1, h: 0.1, rotation: 0, opacity: 1 });
    const { bytes, report } = await build({
      pages: [
        { key: 1, origin: { blank: { width: 300, height: 400 } }, turn: 90, overlays: [twice] },
        { key: 2, origin: { blank: { width: 300, height: 400 } }, turn: 0, overlays: [twice] },
      ],
      sources: new Map(),
    });
    assert.deepEqual(report.warnings, [], 'text is not a signature');
    const file = await openPdf(bytes);
    const masks = [...file.entries.keys()].map((n) => file.get(n)).filter((v) => v instanceof PdfStream && /** @type {PdfName | undefined} */ (v.dict.get('ColorSpace'))?.value === 'DeviceGray');
    assert.equal(masks.length, 1, 'identical masks are one object');
  });

  it('draws marks and dots: a tick is one stroke, a cross two, a single point a dot', () => {
    assert.equal(MARKS.tick.length, 1);
    assert.equal(MARKS.cross.length, 2);
    assert.deepEqual(Object.keys(INKS), ['black', 'blue']);
  });
});

describe('overlays: a photographed signature', () => {
  /** Light paper with a dark line from (4, 3) to (11, 5), and grey noise lighter than the threshold. */
  function photo() {
    const [w, h] = [16, 10];
    const rgba = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y += 1) {
      for (let x = 0; x < w; x += 1) {
        const i = (y * w + x) * 4;
        const ink = x >= 4 && x <= 11 && y >= 3 && y <= 5;
        const value = ink ? 30 : 220 + ((x * 7 + y) % 20);
        rgba.set([value, value, value, 255], i);
      }
    }
    return { rgba, w, h };
  }

  it('keeps the ink, drops the paper, and crops to the ink', () => {
    const { rgba, w, h } = photo();
    const mask = /** @type {NonNullable<ReturnType<typeof inkMask>>} */ (inkMask(rgba, w, h, 180));
    assert.deepEqual([mask.width, mask.height], [8, 3]);
    assert.ok(mask.data.every((value) => value === 255), 'dark ink is full coverage');
  });

  it('follows the threshold: a stricter one keeps less; paper only gives nothing', () => {
    const { rgba, w, h } = photo();
    assert.equal(inkMask(rgba, w, h, 20), null, 'nothing darker than 20');
    const blank = new Uint8ClampedArray(w * h * 4).fill(250);
    assert.equal(inkMask(blank, w, h, 180), null);
    const clear = new Uint8ClampedArray(w * h * 4);
    assert.equal(inkMask(clear, w, h, 180), null, 'transparent pixels are paper');
  });
});

describe('overlays: drawn strokes', () => {
  it('fits strokes into their own box, with the pen inside it, and smooths corners while keeping the ends', () => {
    const fitted = /** @type {NonNullable<ReturnType<typeof fitStrokes>>} */ (fitStrokes([[{ x: 10, y: 10 }, { x: 110, y: 10 }, { x: 110, y: 60 }]], 10));
    assert.ok(Math.abs(fitted.ratio - 110 / 60) < 1e-9);
    assert.ok(Math.abs(fitted.width - 10 / 60) < 1e-9);
    const [stroke] = fitted.strokes;
    assert.deepEqual(round(stroke[0]), round({ x: 5 / 110, y: 5 / 60 }), 'the first point is kept');
    assert.deepEqual(round(stroke[stroke.length - 1]), round({ x: 105 / 110, y: 55 / 60 }), 'and the last');
    assert.ok(stroke.length > 3, 'the corner is cut');
    assert.equal(fitStrokes([[]], 4), null);
  });
});

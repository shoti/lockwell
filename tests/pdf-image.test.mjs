// @ts-check
/**
 * @file Tests for pictures as PDF pages, the pure part (plan docs/tools-plan/pdf-toolkit.md §6.8; research log §18–19):
 * JPEG and PNG headers, the JPEG reduced to what a PDF needs, PNG data taken unchanged, page sizes, layout and camera
 * orientation; and a built PDF with picture pages, read back, carrying nothing the original photo said.
 */
import assert from 'node:assert/strict';
import { deflateSync } from 'node:zlib';
import { describe, it } from 'node:test';
import { build } from '../src/client/pdf-build.mjs';
import { openPdf } from '../src/client/pdf-file.mjs';
import { pageList } from '../src/client/pdf-pages.mjs';
import { FIT_DENSITY, IMAGE_PAGE, ORIENTATION, PAGE_SIZES, imageLayout, imageStream, jpegEmbeddable, jpegForPdf, jpegInfo, jpegPicture, pngInfo, pngPicture, shownPixels } from '../src/client/pdf-image.mjs';
import { predictedRows } from '../src/client/pdf-raster.mjs';
import { PdfDict, PdfName, PdfStream } from '../src/client/pdf-syntax.mjs';
import { examplePhoto, inspectPhoto } from '../src/client/tool-photo.mjs';
import { byName, isPicture } from '../src/client/tool-pdf.mjs';
import { SCAN, TABLES, be32, chunk, jfif, join, jpegFile as jpeg, latin1, pngFile as png, segment, simplePdf } from './build-files.mjs';

/** @typedef {import('../src/client/pdf-image.mjs').Picture} Picture */

/** @param {Uint8Array} haystack @param {Uint8Array} needle */
const includes = (haystack, needle) => Buffer.from(haystack).includes(Buffer.from(needle));

describe('pictures: JPEG', () => {
  it('reads the size, colours, frame and density from the header', () => {
    assert.deepEqual(jpegInfo(jpeg({ width: 640, height: 480 })), { frame: 0xc0, bits: 8, height: 480, width: 640, components: 3, density: 300 });
    assert.equal(jpegInfo(jpeg({ head: [jfif(2, 100)] }))?.density, 254, 'per centimetre');
    assert.equal(jpegInfo(jpeg({ head: [jfif(0, 1)] }))?.density, null, 'an aspect ratio, not a density');
    assert.equal(jpegInfo(jpeg({ head: [jfif(1, 300, 150)] }))?.density, null, 'non-square pixels');
    assert.equal(jpegInfo(latin1('%PDF-1.7')), null);
    assert.equal(jpegInfo(jpeg().subarray(0, 30)), null, 'cut before the frame');
  });

  it('embeds baseline and progressive 8-bit grey and colour; re-encodes CMYK, 12-bit and other frames', () => {
    const ok = (/** @type {Parameters<typeof jpeg>[0]} */ spec) => jpegEmbeddable(/** @type {NonNullable<ReturnType<typeof jpegInfo>>} */ (jpegInfo(jpeg(spec))));
    assert.equal(ok({}), true);
    assert.equal(ok({ marker: 0xc2 }), true);
    assert.equal(ok({ components: 1 }), true);
    assert.equal(ok({ components: 4 }), false, 'CMYK: research item 5 is open');
    assert.equal(ok({ bits: 12, marker: 0xc1 }), false);
    assert.equal(ok({ marker: 0xc1 }), false);
    assert.equal(ok({ marker: 0xc9 }), false, 'arithmetic coding');
  });

  it('keeps only what decoding needs: JFIF, Adobe, tables, frame and scan; no EXIF, XMP, ICC, Photoshop, comment or trailing data', () => {
    const exif = segment(0xe1, join(latin1('Exif\0\0'), latin1('MM\0*GPS 41.7151 44.8271 Nino iPhone')));
    const xmp = segment(0xe1, latin1('http://ns.adobe.com/xap/1.0/\0<x:xmpmeta>history</x:xmpmeta>'));
    const icc = segment(0xe2, latin1('ICC_PROFILE\0\x01\x01camera profile'));
    const adobe = segment(0xee, join(latin1('Adobe'), [0, 100, 0, 0, 0, 0, 1]));
    const photoshop = segment(0xed, latin1('Photoshop 3.0\x008BIM caption'));
    const comment = segment(0xfe, latin1('shot in Tbilisi'));
    const notJfif = segment(0xe0, latin1('AVI1\0\0\0\0'));
    const source = jpeg({ head: [jfif(1, 72), notJfif, exif, xmp, icc, adobe, photoshop, comment], tail: [...latin1('MOTION-PHOTO-VIDEO')] });
    const out = /** @type {Uint8Array} */ (jpegForPdf(source));
    for (const gone of [exif, xmp, icc, photoshop, comment, notJfif, latin1('MOTION')]) assert.ok(!includes(out, gone));
    for (const kept of [jfif(1, 72), adobe, TABLES, SCAN]) assert.ok(includes(out, kept));
    assert.deepEqual([...out.subarray(0, 2)], [0xff, 0xd8]);
    assert.deepEqual([...out.subarray(-2)], [0xff, 0xd9]);
    assert.deepEqual(jpegInfo(out), jpegInfo(source), 'the picture itself is untouched');
  });

  it('turns a cleaned photo into an embeddable picture with its orientation; null when it must be re-encoded', () => {
    const picture = /** @type {Picture} */ (jpegPicture(jpeg({ width: 400, height: 300 }), 6));
    assert.deepEqual({ ...picture, data: null }, { width: 400, height: 300, orientation: 6, density: 300, filter: 'DCTDecode', colors: 3, data: null });
    assert.equal(jpegPicture(jpeg(), 9)?.orientation, 1, 'an orientation outside 1–8 means as stored');
    assert.equal(jpegPicture(jpeg({ components: 1 }))?.colors, 1);
    assert.equal(jpegPicture(jpeg({ components: 4 })), null);
  });
});

describe('pictures: PNG', () => {
  it('takes 8-bit grey or colour image data unchanged, joined from every IDAT chunk, with its density', () => {
    const file = png({ width: 3, height: 2, extra: [chunk('pHYs', [...be32(11811), ...be32(11811), 1])] });
    const info = /** @type {NonNullable<ReturnType<typeof pngInfo>>} */ (pngInfo(file));
    assert.equal(info.width, 3);
    assert.ok(Math.abs(/** @type {number} */ (info.density) - 300) < 0.01, '11,811 per metre is 300 per inch');
    const picture = /** @type {Picture} */ (pngPicture(file));
    assert.equal(picture.filter, 'FlateDecode');
    assert.equal(picture.colors, 3);
    assert.deepEqual([...picture.data], [...deflateSync(new Uint8Array(2 * 10).map((_, i) => (i % 10 === 0 ? 0 : (i * 37) & 0xff)))]);
    assert.equal(pngPicture(png({ colorType: 0 }))?.colors, 1);
  });

  it('leaves transparency, palettes, interlacing and 16-bit samples to the canvas', () => {
    assert.equal(pngPicture(png({ colorType: 6 })), null);
    assert.equal(pngPicture(png({ colorType: 3 })), null);
    assert.equal(pngPicture(png({ extra: [chunk('tRNS', [0, 0, 0, 0, 0, 0])] })), null);
    assert.equal(pngPicture(png({ interlace: 1 })), null);
    assert.equal(pngPicture(png({ bitDepth: 16 })), null);
    assert.equal(pngInfo(latin1('not a png at all, really not')), null);
  });

  it('writes pixels as rows with the "Up" filter, which a PDF reads with predictor 15', () => {
    const rgba = Uint8ClampedArray.from([10, 20, 30, 255, 40, 50, 60, 255, 5, 25, 70, 255, 40, 40, 40, 255]);
    assert.deepEqual([...predictedRows(rgba, 2, 2)], [2, 10, 20, 30, 40, 50, 60, 2, 251, 5, 40, 0, 246, 236]);
  });
});

describe('pictures: pages', () => {
  it('sizes A4 and Letter from their definitions: 210 × 297 mm and 8.5 × 11 in, 72 points to the inch', () => {
    assert.ok(Math.abs(PAGE_SIZES.a4.width - 595.2756) < 1e-4 && Math.abs(PAGE_SIZES.a4.height - 841.8898) < 1e-4);
    assert.deepEqual(PAGE_SIZES.letter, { width: 612, height: 792 });
  });

  it('maps the stored first row and first column to the sides TIFF 6.0 names for each orientation', () => {
    // [side of the 0th row, side of the 0th column] (TIFF 6.0, Orientation tag; research log §19).
    const expected = { 1: ['top', 'left'], 2: ['top', 'right'], 3: ['bottom', 'right'], 4: ['bottom', 'left'], 5: ['left', 'top'], 6: ['right', 'top'], 7: ['right', 'bottom'], 8: ['left', 'bottom'] };
    /** The side a segment lies on, from its two ends. @param {number[]} m @param {[number, number][]} ends */
    const side = (m, ends) => {
      const points = ends.map(([u, v]) => [m[0] * u + m[2] * v + m[4], m[1] * u + m[3] * v + m[5]]);
      if (points.every(([, y]) => y === 1)) return 'top';
      if (points.every(([, y]) => y === 0)) return 'bottom';
      if (points.every(([x]) => x === 0)) return 'left';
      if (points.every(([x]) => x === 1)) return 'right';
      return 'none';
    };
    for (const [orientation, [row, column]] of Object.entries(expected)) {
      const m = ORIENTATION[Number(orientation)];
      assert.equal(side(m, [[0, 1], [1, 1]]), row, `orientation ${orientation}: row 0`);
      assert.equal(side(m, [[0, 0], [0, 1]]), column, `orientation ${orientation}: column 0`);
    }
  });

  it('fits the page to the picture at its stated density, or 150 per inch, turned a quarter for orientations 5 to 8', () => {
    const at300 = imageLayout({ width: 2480, height: 3508, orientation: 1, density: 300 }, IMAGE_PAGE);
    assert.ok(Math.abs(at300.width - 595.2) < 0.01 && Math.abs(at300.height - 841.92) < 0.01, 'an A4 scan at 300 dpi makes an A4 page');
    const phone = imageLayout({ width: 4032, height: 3024, orientation: 6, density: 72 }, IMAGE_PAGE);
    assert.deepEqual([phone.width, phone.height], [(3024 / FIT_DENSITY) * 72, (4032 / FIT_DENSITY) * 72], '72 means nothing: 150 per inch, portrait');
    assert.deepEqual(shownPixels(/** @type {Picture} */ ({ width: 4, height: 3, orientation: 8 })), { width: 3, height: 4 });
    const tiny = imageLayout({ width: 2, height: 1, orientation: 1, density: null }, IMAGE_PAGE);
    assert.ok(Math.min(tiny.width, tiny.height) >= 3, 'never below 3 units');
    const huge = imageLayout({ width: 60000, height: 1000, orientation: 1, density: null }, IMAGE_PAGE);
    assert.ok(Math.max(huge.width, huge.height) <= 14400, 'never above 14,400 units');
  });

  it('centres the picture on A4 or Letter, landscape for a landscape picture, inside the margin, never stretched', () => {
    const layout = imageLayout({ width: 4000, height: 3000, orientation: 1, density: null }, { size: 'a4', margin: 10 });
    assert.ok(layout.width > layout.height, 'landscape');
    const gap = 0.1 * layout.height;
    assert.ok(Math.abs(layout.box.y - gap) < 1e-6 || Math.abs(layout.box.x - gap) < 1e-6, 'touches the margin on one side');
    assert.ok(layout.box.x >= gap - 1e-6 && layout.box.y >= gap - 1e-6);
    assert.ok(Math.abs(layout.box.width / layout.box.height - 4 / 3) < 1e-9, 'the shape is kept');
    assert.ok(Math.abs(layout.box.x * 2 + layout.box.width - layout.width) < 1e-6, 'centred');
    const letter = imageLayout({ width: 100, height: 200, orientation: 1, density: null }, { size: 'letter', margin: 0 });
    assert.deepEqual([letter.width, letter.height, letter.box.height], [612, 792, 792]);
    const turned = imageLayout({ width: 4000, height: 3000, orientation: 6, density: null }, { size: 'a4', margin: 0 });
    assert.ok(turned.height > turned.width, 'orientation 6 shows a landscape photo as portrait');
    assert.deepEqual(turned.matrix.map((n) => Math.round(n * 1000) / 1000), [0, -turned.box.height, turned.box.width, 0, turned.box.x, turned.box.y + turned.box.height].map((n) => Math.round(n * 1000) / 1000));
  });
});

describe('pictures: building', () => {
  it('writes each picture once, a page per board card, the JPEG data unchanged, and reports "pictures"', async () => {
    const photo = jpeg({ width: 800, height: 600 });
    const picture = /** @type {Picture} */ (jpegPicture(photo, 1));
    const sources = new Map([[1, { picture, findings: null }], [2, { file: await openPdf(simplePdf(1)), pages: pageList(await openPdf(simplePdf(1))) }]]);
    const { bytes, report } = await build({
      pages: [
        { key: 1, origin: { source: 1, index: 0 }, turn: 0 },
        { key: 2, origin: { source: 2, index: 0 }, turn: 0 },
        { key: 3, origin: { source: 1, index: 0 }, turn: 90 },
      ],
      sources,
      imagePage: { size: 'a4', margin: 5 },
    });
    assert.deepEqual(report.kept, ['pictures']);
    const file = await openPdf(bytes);
    const list = pageList(file);
    assert.equal(list.length, 3);
    assert.deepEqual(list.map((page) => page.rotate), [0, 0, 90]);
    assert.ok(Math.abs(list[0].mediaBox[2] - 841.8898) < 0.01, 'A4, landscape for a landscape photo');
    const images = [...file.entries.keys()].map((num) => file.get(num)).filter((value) => value instanceof PdfStream && value.dict.get('Subtype') instanceof PdfName && /** @type {PdfName} */ (value.dict.get('Subtype')).value === 'Image');
    assert.equal(images.length, 1, 'one image object for two pages');
    assert.deepEqual([.../** @type {PdfStream} */ (images[0]).data], [.../** @type {Uint8Array} */ (jpegForPdf(photo))]);
    const xobjects = /** @type {PdfDict} */ (file.resolve(/** @type {PdfDict} */ (list[2].resources).get('XObject')));
    assert.ok(xobjects.get('Im1'), 'the page names its picture');
  });

  it('carries nothing of a phone photo: no location, device, owner or preview anywhere in the PDF', async () => {
    const plain = jpeg({ width: 64, height: 48 });
    const original = examplePhoto(plain, jpeg({ width: 8, height: 6 }));
    const report = await inspectPhoto(original, { dropProfile: true });
    assert.ok(report.findings.location && report.clean && report.verified);
    const picture = /** @type {Picture} */ (jpegPicture(report.clean, report.orientation));
    const { bytes } = await build({ pages: [{ key: 1, origin: { source: 1, index: 0 }, turn: 0 }], sources: new Map([[1, { picture, findings: report.findings }]]) });
    const text = Buffer.from(bytes).toString('latin1');
    for (const secret of report.findings.secrets.filter((value) => value.length >= 4)) assert.ok(!text.includes(secret), secret);
    for (const raw of report.findings.rawSecrets) assert.ok(!includes(bytes, raw), 'raw coordinates');
    assert.ok(!text.includes('Exif'), 'no EXIF block, not even the orientation');
    assert.ok(!includes(bytes, /** @type {Uint8Array} */ (report.findings.preview)), 'no embedded preview');
  });

  it('refuses a result in which a picture\'s details survived', async () => {
    const leaky = /** @type {Picture} */ ({ ...jpegPicture(jpeg(), 1), data: join(jpeg(), latin1('Nino Beridze iPhone 15 Pro')) });
    await assert.rejects(
      build({ pages: [{ key: 1, origin: { source: 1, index: 0 }, turn: 0 }], sources: new Map([[1, { picture: leaky, findings: { location: null, fields: {}, texts: [], moreTexts: 0, secrets: ['Nino Beridze'], rawSecrets: [], preview: null, flags: new Set() } }]]) }),
      /picture's location or camera details/,
    );
  });

  it('describes the image object: size, colours, 8 bits, its filter, and predictor 15 for Flate rows', () => {
    const flate = imageStream({ width: 3, height: 2, orientation: 1, density: null, filter: 'FlateDecode', colors: 1, data: new Uint8Array(1) });
    assert.equal(/** @type {PdfName} */ (flate.dict.get('ColorSpace')).value, 'DeviceGray');
    const parms = /** @type {PdfDict} */ (flate.dict.get('DecodeParms'));
    assert.deepEqual([parms.get('Predictor'), parms.get('Colors'), parms.get('Columns')], [15, 1, 3]);
    const dct = imageStream({ width: 3, height: 2, orientation: 1, density: null, filter: 'DCTDecode', colors: 3, data: new Uint8Array(1) });
    assert.equal(dct.dict.get('DecodeParms'), undefined);
    assert.ok(dct.dict instanceof PdfDict);
  });
});

describe('pictures: on the board', () => {
  it('tells pictures from PDFs by their bytes first, then by the type the browser gives', () => {
    assert.equal(isPicture(jpeg(), ''), true);
    assert.equal(isPicture(png(), 'application/octet-stream'), true);
    assert.equal(isPicture(latin1('GIF89a......'), ''), true);
    assert.equal(isPicture(simplePdf(1), 'image/jpeg'), false, 'a PDF named .jpg is a PDF');
    assert.equal(isPicture(latin1('%PDF-1.7'), ''), false);
    assert.equal(isPicture(latin1('some bytes'), 'image/x-unknown'), true, 'the browser may still decode it');
  });

  it('puts a batch of files in name order, numbers as numbers', () => {
    assert.deepEqual(byName([{ name: 'scan 10.jpg' }, { name: 'Scan 2.jpg' }, { name: 'scan 1.jpg' }]).map((file) => file.name), ['scan 1.jpg', 'Scan 2.jpg', 'scan 10.jpg']);
  });
});

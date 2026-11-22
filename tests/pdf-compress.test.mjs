// @ts-check
/**
 * @file Tests for making the pictures inside a PDF smaller, the part without a canvas (plan
 * docs/tools-plan/pdf-toolkit.md §6.7): which images may be recoded and why the others are left alone, the size each
 * needs, images found through form XObjects, Flate samples handed to the recoder, soft masks kept lossless, and an
 * image replaced only when the new one is smaller. A fake recoder stands in for the browser's canvas.
 */
import assert from 'node:assert/strict';
import { deflateSync, inflateSync } from 'node:zlib';
import { describe, it } from 'node:test';
import { build } from '../src/client/pdf-build.mjs';
import { FIT_STEPS, FLOOR, LEVELS, leftAlone, targetSize } from '../src/client/pdf-compress.mjs';
import { openPdf } from '../src/client/pdf-file.mjs';
import { pageList } from '../src/client/pdf-pages.mjs';
import { PdfDict, PdfName, PdfStream } from '../src/client/pdf-syntax.mjs';
import { PdfWriter } from '../src/client/pdf-write.mjs';
import { latin1, pdfFile } from './build-files.mjs';

/** @typedef {import('../src/client/pdf-compress.mjs').RecodeJob} RecodeJob */

/** A width × height RGB picture whose first pixel is (10, 20, 30), as Flate data. @param {number} width @param {number} height */
const rgbData = (width, height) => {
  const raw = new Uint8Array(width * height * 3).map((_, i) => (i < 3 ? [10, 20, 30][i] : (i * 31) & 0xff));
  return deflateSync(raw);
};

/**
 * One A4 page showing a picture directly and, through a form XObject, a second; the second has a soft mask.
 * @param {{ image?: string, data?: Uint8Array }} [spec]
 */
function scan({ image = '/Type /XObject /Subtype /Image /Width 600 /Height 800 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /FlateDecode', data = rgbData(600, 800) } = {}) {
  return pdfFile({ objects: [
    { num: 1, body: '<< /Type /Catalog /Pages 2 0 R >>' },
    { num: 2, body: '<< /Type /Pages /Kids [3 0 R] /Count 1 >>' },
    { num: 3, body: '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /XObject << /Im1 4 0 R /Fm1 5 0 R >> >> /Contents 8 0 R >>' },
    { num: 4, stream: { dict: image, data } },
    { num: 5, stream: { dict: '/Type /XObject /Subtype /Form /BBox [0 0 1 1] /Resources << /XObject << /Im2 6 0 R >> >>', data: '/Im2 Do' } },
    { num: 6, stream: { dict: '/Type /XObject /Subtype /Image /Width 300 /Height 200 /ColorSpace /DeviceGray /BitsPerComponent 8 /Filter /FlateDecode /SMask 7 0 R', data: deflateSync(new Uint8Array(300 * 200).fill(128)) } },
    { num: 7, stream: { dict: '/Type /XObject /Subtype /Image /Width 300 /Height 200 /ColorSpace /DeviceGray /BitsPerComponent 8 /Filter /FlateDecode', data: deflateSync(new Uint8Array(300 * 200).map((_, i) => i & 0xff)) } },
    { num: 8, stream: { data: 'q 595 0 0 842 0 0 cm /Im1 Do Q /Fm1 Do' } },
  ] });
}

/**
 * A fake recoder: records the jobs and answers with `size` bytes of "JPEG" at the target size, mask scaled by
 * keeping every n-th sample.
 * @param {{ size?: number, dropMask?: boolean }} [options]
 */
function fakeRecoder({ size = 50, dropMask = false } = {}) {
  /** @type {RecodeJob[]} */
  const jobs = [];
  /** @param {RecodeJob} job */
  const recode = async (job) => {
    jobs.push(job);
    const { width, height } = job.target;
    const mask = job.mask && !dropMask ? { width, height, data: new Uint8Array(width * height).fill(200) } : null;
    return { data: Uint8Array.from({ length: size }, (_, i) => (i === 0 ? 0xff : i === 1 ? 0xd8 : 7)), width, height, mask };
  };
  return { jobs, recode };
}

/** @param {Uint8Array} bytes */
async function images(bytes) {
  const file = await openPdf(bytes);
  return [...file.entries.keys()].map((num) => file.get(num)).filter((value) => value instanceof PdfStream && /** @type {PdfName | undefined} */ (value.dict.get('Subtype'))?.value === 'Image').map((value) => /** @type {PdfStream} */ (value));
}

describe('compression: which pictures', () => {
  /** @param {string} dict @param {Uint8Array} [data] */
  const reason = (dict, data = new Uint8Array(1)) => {
    const writer = new PdfWriter();
    const profile = writer.reserve();
    writer.objects.set(profile.num, new PdfStream(new PdfDict([['N', 4]]), new Uint8Array(1)));
    const parsed = new Map(dict.split('/').filter(Boolean).map((part) => {
      const [key, ...rest] = part.trim().split(' ');
      return [key, rest.join(' ')];
    }));
    /** @type {[string, import('../src/client/pdf-syntax.mjs').PdfObject][]} */
    const entries = [...parsed].map(([key, value]) => [key, /^\d+$/.test(value) ? Number(value) : value === 'true' ? true : value === 'ICC4' ? [new PdfName('ICCBased'), profile] : new PdfName(value)]);
    return leftAlone(writer, new PdfStream(new PdfDict(entries), data));
  };
  const base = '/Subtype Image /Width 400 /Height 300 /BitsPerComponent 8';

  it('recodes 8-bit grey and colour pictures in DCT or Flate, and only those', () => {
    assert.equal(reason(`${base} /ColorSpace DeviceRGB /Filter DCTDecode`), null);
    assert.equal(reason(`${base} /ColorSpace DeviceGray /Filter FlateDecode`), null);
    assert.equal(reason(`${base} /ColorSpace CalRGB /Filter FlateDecode`), null);
    assert.equal(reason(`${base} /ColorSpace DeviceCMYK /Filter DCTDecode`), 'kind', 'CMYK');
    assert.equal(reason(`${base} /ColorSpace ICC4 /Filter DCTDecode`), 'kind', 'a four-colour profile');
    assert.equal(reason(`${base} /ColorSpace DeviceRGB /Filter JPXDecode`), 'kind', 'JPEG 2000');
    assert.equal(reason(`${base} /ColorSpace DeviceRGB /Filter DCTDecode /Decode 1`), 'kind');
    assert.equal(reason(`${base} /ColorSpace DeviceRGB /Filter DCTDecode /Mask 1`), 'kind', 'a colour-key mask');
    assert.equal(reason(`/Subtype Image /Width 400 /Height 300 /BitsPerComponent 1 /ColorSpace DeviceGray /Filter FlateDecode`), 'kind', '1-bit');
    assert.equal(reason(`/Subtype Image /Width 400 /Height 300 /BitsPerComponent 1 /ImageMask true /Filter FlateDecode`), 'kind');
  });

  it('leaves small pictures alone, as qpdf does: under 128 pixels a side or 16,384 in area', () => {
    assert.deepEqual(FLOOR, { side: 128, area: 16384 });
    assert.equal(reason('/Subtype Image /Width 127 /Height 300 /BitsPerComponent 8 /ColorSpace DeviceRGB /Filter DCTDecode'), 'small');
    assert.equal(reason('/Subtype Image /Width 128 /Height 128 /BitsPerComponent 8 /ColorSpace DeviceRGB /Filter DCTDecode'), null);
  });

  it('sizes a picture as if it filled its page, at the level\'s resolution, never larger than it is', () => {
    const a4 = { width: 595, height: 842 };
    assert.deepEqual(targetSize(2480, 3508, a4, 150), { width: 1240, height: 1753 }, 'an A4 scan at 300 dpi to 150');
    assert.deepEqual(targetSize(2480, 3508, a4, 100), { width: 826, height: 1169 });
    assert.deepEqual(targetSize(600, 800, a4, 150), { width: 600, height: 800 }, 'already below 150 dpi');
    assert.deepEqual(LEVELS, { good: { dpi: 150, quality: 0.8 }, small: { dpi: 100, quality: 0.6 } });
    assert.ok(FIT_STEPS.every((step, i) => i === 0 || (step.dpi < FIT_STEPS[i - 1].dpi && step.quality < FIT_STEPS[i - 1].quality)), 'stepping down together');
  });
});

describe('compression: building', () => {
  it('recodes pictures shown directly and through form XObjects, hands Flate samples over decoded, and keeps masks lossless', async () => {
    const source = await openPdf(scan());
    const { jobs, recode } = fakeRecoder();
    const { bytes, report } = await build({ pages: [{ key: 1, origin: { source: 1, index: 0 }, turn: 0 }], sources: new Map([[1, { file: source, pages: pageList(source) }]]), compress: { level: LEVELS.small, recode } });
    assert.deepEqual(report.pictures, { done: 2, left: { small: 0, kind: 0, notSmaller: 0 } });
    assert.equal(jobs.length, 2);
    const direct = /** @type {RecodeJob & { kind: 'pixels' }} */ (jobs.find((job) => job.width === 600));
    assert.equal(direct.kind, 'pixels');
    assert.equal(direct.colors, 3);
    assert.deepEqual([...direct.data.subarray(0, 3)], [10, 20, 30], 'decoded samples, not Flate data');
    assert.deepEqual(direct.target, { width: 600, height: 800 }, 'smaller than 100 dpi on A4 already: same size, new quality');
    const masked = /** @type {RecodeJob} */ (jobs.find((job) => job.width === 300));
    assert.equal(masked.mask?.data.length, 300 * 200);
    assert.equal(masked.mask?.data[5], 5);
    const out = await images(bytes);
    const recoded = out.filter((image) => /** @type {PdfName} */ (image.dict.get('Filter')).value === 'DCTDecode');
    assert.equal(recoded.length, 2);
    for (const image of recoded) assert.equal(/** @type {PdfName} */ (image.dict.get('ColorSpace')).value, 'DeviceRGB');
    const file = await openPdf(bytes);
    const mask = /** @type {PdfStream} */ (file.resolve(/** @type {PdfStream} */ (recoded.find((image) => image.dict.has('SMask'))).dict.get('SMask')));
    assert.equal(/** @type {PdfName} */ (mask.dict.get('Filter')).value, 'FlateDecode', 'the mask stays lossless');
    assert.equal(/** @type {PdfName} */ (mask.dict.get('ColorSpace')).value, 'DeviceGray');
    assert.equal(inflateSync(mask.data)[0], 200);
  });

  it('keeps a picture as it was when the new one is not smaller, or when its mask could not be scaled', async () => {
    const source = await openPdf(scan());
    const sources = new Map([[1, { file: source, pages: pageList(source) }]]);
    const pages = [{ key: 1, origin: { source: 1, index: 0 }, turn: /** @type {const} */ (0) }];
    const big = await build({ pages, sources, compress: { level: LEVELS.good, recode: fakeRecoder({ size: 10_000_000 }).recode } });
    assert.deepEqual(big.report.pictures, { done: 0, left: { small: 0, kind: 0, notSmaller: 2 } });
    assert.ok((await images(big.bytes)).every((image) => /** @type {PdfName} */ (image.dict.get('Filter')).value === 'FlateDecode'));
    const maskless = await build({ pages, sources, compress: { level: LEVELS.good, recode: fakeRecoder({ dropMask: true }).recode } });
    assert.equal(maskless.report.pictures?.left.kind, 1, 'never lose transparency');
    assert.equal(maskless.report.pictures?.done, 1);
  });

  it('counts what it leaves alone, and changes nothing without a level', async () => {
    const cmyk = await openPdf(scan({ image: '/Type /XObject /Subtype /Image /Width 600 /Height 800 /ColorSpace /DeviceCMYK /BitsPerComponent 8 /Filter /DCTDecode', data: latin1('\xff\xd8 not decoded \xff\xd9') }));
    const { jobs, recode } = fakeRecoder();
    const sources = new Map([[1, { file: cmyk, pages: pageList(cmyk) }]]);
    const pages = [{ key: 1, origin: { source: 1, index: 0 }, turn: /** @type {const} */ (0) }];
    const { report } = await build({ pages, sources, compress: { level: LEVELS.good, recode } });
    assert.deepEqual(report.pictures, { done: 1, left: { small: 0, kind: 1, notSmaller: 0 } });
    assert.equal(jobs.length, 1, 'the CMYK picture never reaches the recoder');
    const plain = await build({ pages, sources });
    assert.equal(plain.report.pictures, null);
  });

  it('stops when cancelled', async () => {
    const source = await openPdf(scan());
    let calls = 0;
    await assert.rejects(build({
      pages: [{ key: 1, origin: { source: 1, index: 0 }, turn: 0 }],
      sources: new Map([[1, { file: source, pages: pageList(source) }]]),
      compress: { level: LEVELS.good, recode: async () => null },
      isCancelled: () => (calls += 1) > 3,
    }), /cancelled/);
  });
});

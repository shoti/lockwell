// @ts-check
/**
 * @file Making the pictures inside a PDF smaller (plan docs/tools-plan/pdf-toolkit.md §6.7), the part that needs no
 * canvas: which image objects may be recoded and why the others are left alone, how large each needs to be, Flate
 * image data decoded to samples, and replacing an image only when the new one is smaller. The decoding and encoding
 * of pixels is done by a recoder the page passes in (pdf-raster.mjs `createRecoder`), so this runs in Node too.
 */
import { inflate, meter, unpredict } from './pdf-file.mjs';
import { PdfDict, PdfName, PdfRef, PdfStream } from './pdf-syntax.mjs';
import { deflate, pause } from './pdf-write.mjs';

/** @typedef {import('./pdf-write.mjs').PdfWriter} PdfWriter */
/** @typedef {import('./pdf-syntax.mjs').PdfObject} PdfObject */

/**
 * @typedef {{ dpi: number, quality: number }} Level
 * @typedef {{ width: number, height: number, data: Uint8Array }} Gray  8-bit samples, rows from the top.
 * @typedef {{ width: number, height: number, target: { width: number, height: number }, quality: number, mask: Gray | null }
 *   & ({ kind: 'jpeg', data: Uint8Array } | { kind: 'pixels', colors: 1 | 3, data: Uint8Array })} RecodeJob
 * @typedef {{ data: Uint8Array, width: number, height: number, mask: Gray | null }} Recoded  A JPEG, and the mask scaled.
 * @typedef {(job: RecodeJob) => Promise<Recoded | null>} Recoder
 * @typedef {'small' | 'kind' | 'notSmaller'} LeftReason  Below the size worth recoding; a kind left exactly as it is
 *   (CMYK, indexed, JPEG 2000, masks…); recoded but not smaller.
 * @typedef {{ done: number, left: Record<LeftReason, number> }} PictureCount
 */

/** The two levels (Ghostscript's "ebook" resolution for Good, research log §8). */
export const LEVELS = { good: { dpi: 150, quality: 0.8 }, small: { dpi: 100, quality: 0.6 } };
/** "Fit under N MB": resolution and quality stepped down together from Good. */
export const FIT_STEPS = [
  { dpi: 150, quality: 0.8 },
  { dpi: 120, quality: 0.7 },
  { dpi: 100, quality: 0.6 },
  { dpi: 85, quality: 0.55 },
  { dpi: 72, quality: 0.5 },
  { dpi: 60, quality: 0.45 },
];
/** qpdf's floor for --optimize-images (research log §8): smaller pictures are not worth recoding. */
export const FLOOR = { side: 128, area: 16384 };

/** @param {PdfWriter} writer @param {PdfObject | undefined} value @returns {PdfObject | undefined} */
const resolve = (writer, value) => (value instanceof PdfRef ? writer.get(value) : value);
/** @param {PdfObject | undefined} value */
const nameOf = (value) => (value instanceof PdfName ? value.value : null);

/**
 * Every image a page shows, through its resources and the form XObjects in them, with the largest page that shows
 * it (in points, as shown). A picture is assumed to fill that page (plan §6.7: the error only keeps more detail).
 * @param {PdfWriter} writer @param {{ ref: PdfRef, width: number, height: number }[]} pages
 * @returns {Map<number, { width: number, height: number }>}  By the image's number in the writer.
 */
export function imageUses(writer, pages) {
  /** @type {Map<number, { width: number, height: number }>} */
  const uses = new Map();
  for (const { ref, width, height } of pages) {
    const page = resolve(writer, ref);
    if (!(page instanceof PdfDict)) continue;
    /** @type {Set<number>} */
    const seen = new Set();
    /** @param {PdfObject | undefined} resources @param {number} depth */
    const visit = (resources, depth) => {
      const dict = resolve(writer, resources);
      if (!(dict instanceof PdfDict) || depth > 20) return;
      const xobjects = resolve(writer, dict.get('XObject'));
      if (!(xobjects instanceof PdfDict)) return;
      for (const [, value] of xobjects.entries()) {
        if (!(value instanceof PdfRef)) continue;
        const num = writer.alias.get(value.num) ?? value.num;
        if (seen.has(num)) continue;
        seen.add(num);
        const object = writer.get(value);
        if (!(object instanceof PdfStream)) continue;
        const subtype = nameOf(object.dict.get('Subtype'));
        if (subtype === 'Form') visit(object.dict.get('Resources'), depth + 1);
        if (subtype !== 'Image') continue;
        const known = uses.get(num);
        if (!known || width * height > known.width * known.height) uses.set(num, { width, height });
      }
    };
    visit(page.get('Resources'), 0);
  }
  return uses;
}

/**
 * Why an image is left exactly as it is, or null if it may be recoded (plan §6.7, item 1).
 * @param {PdfWriter} writer @param {PdfStream} image
 * @returns {LeftReason | null}
 */
export function leftAlone(writer, image) {
  const { dict } = image;
  const width = resolve(writer, dict.get('Width'));
  const height = resolve(writer, dict.get('Height'));
  if (typeof width !== 'number' || typeof height !== 'number') return 'kind';
  if (resolve(writer, dict.get('ImageMask')) === true || resolve(writer, dict.get('BitsPerComponent')) !== 8) return 'kind';
  if (dict.has('Mask') || dict.has('Decode') || dict.has('SMaskInData')) return 'kind';
  if (colorsOf(writer, dict) === null) return 'kind';
  if (filterOf(writer, dict) === null) return 'kind';
  if (width < FLOOR.side || height < FLOOR.side || width * height < FLOOR.area) return 'small';
  return null;
}

/**
 * Colour components for the colour spaces recoded: DeviceGray, DeviceRGB, CalGray, CalRGB, ICCBased with 1 or 3.
 * @param {PdfWriter} writer @param {PdfDict} dict @returns {1 | 3 | null}
 */
function colorsOf(writer, dict) {
  const space = resolve(writer, dict.get('ColorSpace'));
  const name = nameOf(space) ?? (Array.isArray(space) ? nameOf(resolve(writer, space[0])) : null);
  if (name === 'DeviceGray' || name === 'CalGray') return 1;
  if (name === 'DeviceRGB' || name === 'CalRGB') return 3;
  if (name === 'ICCBased' && Array.isArray(space)) {
    const profile = resolve(writer, space[1]);
    const n = profile instanceof PdfStream ? resolve(writer, profile.dict.get('N')) : null;
    return n === 1 ? 1 : n === 3 ? 3 : null;
  }
  return null;
}

/** The one filter of an image, if it is DCTDecode or FlateDecode alone. @param {PdfWriter} writer @param {PdfDict} dict */
function filterOf(writer, dict) {
  const filter = resolve(writer, dict.get('Filter'));
  const name = nameOf(filter) ?? (Array.isArray(filter) && filter.length === 1 ? nameOf(resolve(writer, filter[0])) : null);
  return name === 'DCTDecode' || name === 'FlateDecode' ? name : null;
}

/**
 * The pixels a picture needs at a resolution when it fills a page: never more than it has.
 * @param {number} width @param {number} height  The picture, in pixels.
 * @param {{ width: number, height: number }} page  In points.
 * @param {number} dpi
 */
export function targetSize(width, height, page, dpi) {
  const shown = Math.min(page.width / width, page.height / height); // points per pixel when it fills the page
  const scale = Math.min(1, (shown / 72) * dpi);
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

/**
 * Flate image data decoded to its samples: `colors` 8-bit components per pixel, rows from the top.
 * @param {PdfWriter} writer @param {PdfStream} stream @param {number} colors
 * @returns {Promise<Uint8Array | null>}  null when it does not decode to the size it says.
 */
async function samples(writer, stream, colors) {
  const width = /** @type {number} */ (resolve(writer, stream.dict.get('Width')));
  const height = /** @type {number} */ (resolve(writer, stream.dict.get('Height')));
  const expected = width * height * colors;
  try {
    let data = await inflate(stream.data, expected * 2 + height + 1024, meter());
    const parms = resolve(writer, stream.dict.get('DecodeParms'));
    const parm = Array.isArray(parms) ? resolve(writer, parms[0]) : parms;
    if (parm instanceof PdfDict) data = unpredict(data, parm, /** @type {import('./pdf-file.mjs').PdfFile} */ (/** @type {unknown} */ ({ resolve: (/** @type {PdfObject} */ value) => resolve(writer, value) })));
    return data.length >= expected ? data.subarray(0, expected) : null;
  } catch {
    return null;
  }
}

/**
 * Recodes every eligible picture the pages show at a level, keeping a new one only if it is smaller (qpdf's rule),
 * soft mask included; the mask stays lossless. Replaces image objects in the writer, before it writes.
 * @param {PdfWriter} writer
 * @param {{ ref: PdfRef, width: number, height: number }[]} pages
 * @param {Level} level @param {Recoder} recode @param {() => boolean} [isCancelled]
 * @returns {Promise<PictureCount>}
 */
export async function compressImages(writer, pages, level, recode, isCancelled = () => false) {
  /** @type {PictureCount} */
  const count = { done: 0, left: { small: 0, kind: 0, notSmaller: 0 } };
  const uses = imageUses(writer, pages);
  // A soft mask used by more than one picture cannot be scaled for one of them.
  /** @type {Map<number, number>} */
  const maskUses = new Map();
  for (const num of uses.keys()) {
    const mask = /** @type {PdfStream} */ (writer.objects.get(num)).dict.get('SMask');
    if (mask instanceof PdfRef) {
      const target = writer.alias.get(mask.num) ?? mask.num;
      maskUses.set(target, (maskUses.get(target) ?? 0) + 1);
    }
  }
  for (const [num, page] of uses) {
    if (isCancelled()) break;
    const image = /** @type {PdfStream} */ (writer.objects.get(num));
    const reason = leftAlone(writer, image);
    if (reason) {
      count.left[reason] += 1;
      continue;
    }
    const { dict } = image;
    const width = /** @type {number} */ (resolve(writer, dict.get('Width')));
    const height = /** @type {number} */ (resolve(writer, dict.get('Height')));
    const colors = /** @type {1 | 3} */ (colorsOf(writer, dict));
    /** @type {{ num: number, stream: PdfStream, gray: Gray } | null} */
    let mask = null;
    const maskRef = dict.get('SMask');
    if (maskRef instanceof PdfRef) {
      const maskNum = writer.alias.get(maskRef.num) ?? maskRef.num;
      const stream = writer.objects.get(maskNum);
      // A /Decode array would invert the mask once rewritten without it (review P5).
      const ok = stream instanceof PdfStream && (maskUses.get(maskNum) ?? 0) === 1 && !stream.dict.has('Matte') && !stream.dict.has('Decode') && filterOf(writer, stream.dict) === 'FlateDecode' && colorsOf(writer, stream.dict) === 1 && resolve(writer, stream.dict.get('BitsPerComponent')) === 8;
      const data = ok ? await samples(writer, /** @type {PdfStream} */ (stream), 1) : null;
      if (!data) {
        count.left.kind += 1;
        continue;
      }
      const w = /** @type {number} */ (resolve(writer, /** @type {PdfStream} */ (stream).dict.get('Width')));
      const h = /** @type {number} */ (resolve(writer, /** @type {PdfStream} */ (stream).dict.get('Height')));
      mask = { num: maskNum, stream: /** @type {PdfStream} */ (stream), gray: { width: w, height: h, data } };
    }
    const target = targetSize(width, height, page, level.dpi);
    /** @type {RecodeJob} */
    let job;
    if (filterOf(writer, dict) === 'DCTDecode') {
      job = { kind: 'jpeg', data: image.data, width, height, target, quality: level.quality, mask: mask?.gray ?? null };
    } else {
      const data = await samples(writer, image, colors);
      if (!data) {
        count.left.kind += 1;
        continue;
      }
      job = { kind: 'pixels', colors, data, width, height, target, quality: level.quality, mask: mask?.gray ?? null };
    }
    const recoded = await recode(job);
    if (recoded && mask && !recoded.mask) {
      count.left.kind += 1;
      continue;
    }
    const newMask = recoded?.mask ? await deflate(recoded.mask.data) : null;
    const before = image.data.length + (mask?.stream.data.length ?? 0);
    const after = recoded ? recoded.data.length + (newMask?.length ?? 0) : Infinity;
    if (!recoded || after >= before) {
      count.left.notSmaller += 1;
      continue;
    }
    const replaced = new PdfDict([
      ['Type', new PdfName('XObject')], ['Subtype', new PdfName('Image')], ['Width', recoded.width], ['Height', recoded.height],
      ['ColorSpace', new PdfName('DeviceRGB')], ['BitsPerComponent', 8], ['Filter', new PdfName('DCTDecode')],
    ]);
    // Its layer above all: a picture in a hidden layer must stay hidden (review P5).
    for (const key of ['Interpolate', 'OC', 'Intent', 'Alternates']) if (dict.has(key)) replaced.set(key, /** @type {PdfObject} */ (dict.get(key)));
    if (mask && recoded.mask && newMask) {
      replaced.set('SMask', new PdfRef(mask.num, 0));
      writer.objects.set(mask.num, new PdfStream(new PdfDict([
        ['Type', new PdfName('XObject')], ['Subtype', new PdfName('Image')], ['Width', recoded.mask.width], ['Height', recoded.mask.height],
        ['ColorSpace', new PdfName('DeviceGray')], ['BitsPerComponent', 8], ['Filter', new PdfName('FlateDecode')],
      ]), newMask));
    }
    writer.objects.set(num, new PdfStream(replaced, recoded.data));
    count.done += 1;
    await pause();
  }
  return count;
}

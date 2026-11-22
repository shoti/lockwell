// @ts-check
/**
 * @file Pictures as PDF pages (plan docs/tools-plan/pdf-toolkit.md §6.8), the pure part: JPEG and PNG headers, a
 * JPEG reduced to what a PDF needs, a PNG's image data taken as it is, the picture's image object, page sizes and
 * where the picture goes on its page, camera orientation included. No canvas here: pdf-raster.mjs decodes and
 * re-encodes what cannot be embedded unchanged.
 */
import { PdfDict, PdfName, PdfStream } from './pdf-syntax.mjs';

/**
 * A picture ready to embed. `width` and `height` are the stored pixels; `orientation` (EXIF, 1–8) says how to turn
 * them for display. DCT data is a JPEG; Flate data is PNG-predicted rows (predictor 15) of 8-bit samples.
 * @typedef {{ width: number, height: number, orientation: number, density: number | null,
 *   filter: 'DCTDecode' | 'FlateDecode', colors: 1 | 3, data: Uint8Array }} Picture
 * @typedef {'fit' | 'a4' | 'letter'} PageSizeName
 * @typedef {{ size: PageSizeName, margin: 0 | 5 | 10 }} ImagePageOptions
 * @typedef {{ width: number, height: number, box: { x: number, y: number, width: number, height: number },
 *   matrix: number[] }} ImageLayout  Page size and the picture's box in points (origin bottom left), and the cm matrix.
 */

/** @param {number} mm */
const millimetres = (mm) => (mm / 25.4) * 72;

/** Paper sizes in points, portrait (research log §18: A4 210 × 297 mm, Letter 8.5 × 11 in; 1 pt = 1/72 in). */
export const PAGE_SIZES = {
  a4: { width: millimetres(210), height: millimetres(297) },
  letter: { width: 8.5 * 72, height: 11 * 72 },
};
/** Pixels per inch for "fit" when the picture states none (or a value outside STATED_DENSITY). */
export const FIT_DENSITY = 150;
/** Stated densities used as they are; 72 and 96, the usual defaults that mean nothing, fall outside. */
export const STATED_DENSITY = { min: 100, max: 1200 };
/** ISO 32000-1 Annex C: page sides between 3 and 14,400 units. */
const PAGE_SIDE = { min: 3, max: 14400 };
/** The default image-page options. @type {ImagePageOptions} */
export const IMAGE_PAGE = { size: 'fit', margin: 0 };

/* ---------- JPEG ---------- */

const SOI = 0xd8;
const EOI = 0xd9;
const SOS = 0xda;
/** Frames a PDF viewer decodes (ISO 32000-1 §7.4.8: baseline, and progressive from PDF 1.3). */
const FRAMES = new Set([0xc0, 0xc2]);
/** Markers with no length: restart markers and TEM. */
const STANDALONE = (/** @type {number} */ marker) => (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01;

/**
 * The segments of a JPEG before its first scan.
 * @param {Uint8Array} bytes
 * @returns {{ segments: { marker: number, start: number, data: number, end: number }[], scan: number } | null}  null if
 *   the bytes are not a JPEG this reader follows to its first scan.
 */
function jpegSegments(bytes) {
  if (bytes[0] !== 0xff || bytes[1] !== SOI) return null;
  const segments = [];
  let at = 2;
  while (at + 4 <= bytes.length) {
    if (bytes[at] !== 0xff) return null;
    const marker = bytes[at + 1];
    if (marker === 0xff) {
      at += 1; // fill byte
      continue;
    }
    if (STANDALONE(marker)) {
      at += 2;
      continue;
    }
    const length = (bytes[at + 2] << 8) | bytes[at + 3];
    if (length < 2 || at + 2 + length > bytes.length) return null;
    segments.push({ marker, start: at, data: at + 4, end: at + 2 + length });
    if (marker === SOS) return { segments, scan: at };
    if (marker === EOI) return null;
    at += 2 + length;
  }
  return null;
}

/**
 * What a JPEG's header says.
 * @param {Uint8Array} bytes
 * @returns {{ width: number, height: number, components: number, bits: number, frame: number, density: number | null } | null}
 */
export function jpegInfo(bytes) {
  const parsed = jpegSegments(bytes);
  if (!parsed) return null;
  let density = null;
  let frame = null;
  for (const { marker, data, end } of parsed.segments) {
    if (marker === 0xe0 && end - data >= 12 && String.fromCharCode(...bytes.subarray(data, data + 5)) === 'JFIF\0') {
      const units = bytes[data + 7];
      const x = (bytes[data + 8] << 8) | bytes[data + 9];
      const y = (bytes[data + 10] << 8) | bytes[data + 11];
      // Units 1: per inch; 2: per centimetre. Unequal densities (non-square pixels) are ignored.
      if (x > 0 && x === y && (units === 1 || units === 2)) density = units === 1 ? x : x * 2.54;
    }
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc && end - data >= 6) {
      frame ??= { frame: marker, bits: bytes[data], height: (bytes[data + 1] << 8) | bytes[data + 2], width: (bytes[data + 3] << 8) | bytes[data + 4], components: bytes[data + 5] };
    }
  }
  if (!frame || frame.width === 0 || frame.height === 0) return null;
  return { ...frame, density };
}

/**
 * Whether a JPEG goes into the PDF unchanged: a baseline or progressive frame, 8 bits, grey or colour. CMYK is
 * decoded and re-encoded until research item 5 (Adobe's inverted CMYK) is closed.
 * @param {NonNullable<ReturnType<typeof jpegInfo>>} info
 */
export const jpegEmbeddable = (info) => FRAMES.has(info.frame) && info.bits === 8 && (info.components === 1 || info.components === 3);

/**
 * The JPEG with only what decoding needs: every application segment except JFIF (APP0) and Adobe (APP14, which says
 * how the colours were stored) is left out, and every comment, before the first scan and between later ones, and
 * anything after the first end of the image (a second picture with its own EXIF, review P18). The photo tool's
 * cleaner has already run; this is the second, independent pass, so no EXIF block (not even the orientation it
 * keeps) reaches the PDF.
 * @param {Uint8Array} bytes
 * @returns {Uint8Array | null}  null when the JPEG can't be followed or never ends.
 */
export function jpegForPdf(bytes) {
  const cleaned = jpegClean(bytes);
  return cleaned && cleaned.ended ? cleaned.bytes : null;
}

/**
 * A JPEG found inside a PDF, without metadata: as jpegForPdf, but one cut short keeps what it has (some readers
 * still draw it). The bytes as they are when the JPEG can't be followed at all.
 * @param {Uint8Array} bytes
 */
export function jpegWithoutMetadata(bytes) {
  return jpegClean(bytes)?.bytes ?? bytes;
}

/**
 * Whether a JPEG still holds something jpegForPdf leaves out (metadata, comments, a second picture): a result's
 * pictures never do. False when it can't be followed.
 * @param {Uint8Array} bytes
 */
export function jpegHasExtras(bytes) {
  const cleaned = jpegClean(bytes);
  return cleaned !== null && cleaned.bytes.length < bytes.length;
}

/**
 * @param {Uint8Array} bytes
 * @returns {{ bytes: Uint8Array, ended: boolean } | null}
 */
function jpegClean(bytes) {
  const parsed = jpegSegments(bytes);
  if (!parsed) return null;
  const keep = parsed.segments.filter(({ marker, data, end }) => {
    if (marker === 0xfe) return false;
    if (marker >= 0xe1 && marker <= 0xef && marker !== 0xee) return false;
    if (marker === 0xe0) return end - data >= 5 && String.fromCharCode(...bytes.subarray(data, data + 5)) === 'JFIF\0';
    return true;
  });
  const scans = afterFirstScan(bytes, parsed.scan);
  if (!scans) return null;
  const parts = [Uint8Array.of(0xff, SOI), ...keep.filter((segment) => segment.marker !== SOS).map(({ start, end: stop }) => bytes.subarray(start, stop)), ...scans.parts];
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return { bytes: out, ended: scans.ended };
}

/**
 * The scans of a JPEG from its first SOS marker, walked marker by marker: the entropy-coded data (with its stuffed
 * zero bytes and restart markers) and the tables and scan headers between scans are kept; application segments and
 * comments are left out; the walk stops at the first end of the image.
 * @param {Uint8Array} bytes @param {number} from  Offset of the first SOS marker.
 * @returns {{ parts: Uint8Array[], ended: boolean } | null}  null when a segment's length runs past the data.
 */
function afterFirstScan(bytes, from) {
  /** @type {Uint8Array[]} */
  const parts = [];
  let keepFrom = from;
  let i = from;
  while (i + 1 < bytes.length) {
    if (bytes[i] !== 0xff) {
      i += 1;
      continue;
    }
    const marker = bytes[i + 1];
    if (marker === 0xff) {
      i += 1; // fill byte
      continue;
    }
    if (marker === 0x00 || (marker >= 0xd0 && marker <= 0xd7)) {
      i += 2; // a stuffed 0xFF in the data, or a restart marker
      continue;
    }
    if (marker === EOI) {
      parts.push(bytes.subarray(keepFrom, i + 2));
      return { parts, ended: true };
    }
    if (i + 3 >= bytes.length) break;
    const stop = i + 2 + ((bytes[i + 2] << 8) | bytes[i + 3]);
    if (stop < i + 4 || stop > bytes.length) return null;
    if ((marker >= 0xe0 && marker <= 0xef) || marker === 0xfe) {
      parts.push(bytes.subarray(keepFrom, i));
      keepFrom = stop;
    }
    i = stop;
  }
  parts.push(bytes.subarray(keepFrom));
  return { parts, ended: false };
}

/**
 * A JPEG as an embeddable picture, or null when it has to go through the canvas.
 * @param {Uint8Array} bytes  Already cleaned by the photo tool.
 * @param {number} orientation  From the photo tool's report.
 * @returns {Picture | null}
 */
export function jpegPicture(bytes, orientation = 1) {
  const info = jpegInfo(bytes);
  if (!info || !jpegEmbeddable(info)) return null;
  const data = jpegForPdf(bytes);
  if (!data) return null;
  return { width: info.width, height: info.height, orientation: orientation >= 1 && orientation <= 8 ? orientation : 1, density: info.density, filter: 'DCTDecode', colors: info.components === 1 ? 1 : 3, data };
}

/* ---------- PNG ---------- */

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/**
 * What a PNG's chunks say, and its image data joined.
 * @param {Uint8Array} bytes
 * @returns {{ width: number, height: number, bitDepth: number, colorType: number, interlace: number,
 *   transparent: boolean, density: number | null, idat: Uint8Array } | null}
 */
export function pngInfo(bytes) {
  if (bytes.length < 33 || PNG_SIGNATURE.some((value, i) => bytes[i] !== value)) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  /** @type {Uint8Array[]} */
  const idat = [];
  let header = null;
  let transparent = false;
  let density = null;
  for (let at = 8; at + 12 <= bytes.length; ) {
    const length = view.getUint32(at);
    const type = String.fromCharCode(...bytes.subarray(at + 4, at + 8));
    const data = at + 8;
    if (data + length + 4 > bytes.length) return null;
    if (type === 'IHDR' && length >= 13) {
      header = { width: view.getUint32(data), height: view.getUint32(data + 4), bitDepth: bytes[data + 8], colorType: bytes[data + 9], interlace: bytes[data + 12] };
    } else if (type === 'IDAT') {
      idat.push(bytes.subarray(data, data + length));
    } else if (type === 'tRNS') {
      transparent = true;
    } else if (type === 'pHYs' && length >= 9) {
      const x = view.getUint32(data);
      const y = view.getUint32(data + 4);
      // Unit 1: per metre.
      if (bytes[data + 8] === 1 && x > 0 && x === y) density = x * 0.0254;
    } else if (type === 'IEND') {
      break;
    }
    at = data + length + 4;
  }
  if (!header || header.width === 0 || header.height === 0 || idat.length === 0) return null;
  const joined = new Uint8Array(idat.reduce((sum, part) => sum + part.length, 0));
  let at = 0;
  for (const part of idat) {
    joined.set(part, at);
    at += part.length;
  }
  return { ...header, transparent, density, idat: joined };
}

/**
 * A PNG as an embeddable picture when its image data can go in unchanged: 8-bit grey or colour, not interlaced, no
 * transparency. Its zlib stream with PNG row filters is exactly Flate with predictor 15 (ISO 32000-1 §7.4.4.4), so
 * nothing is decoded. Otherwise null: the canvas decodes it.
 * @param {Uint8Array} bytes  Already cleaned by the photo tool.
 * @returns {Picture | null}
 */
export function pngPicture(bytes) {
  const info = pngInfo(bytes);
  if (!info || info.bitDepth !== 8 || info.interlace !== 0 || info.transparent || (info.colorType !== 0 && info.colorType !== 2)) return null;
  return { width: info.width, height: info.height, orientation: 1, density: info.density, filter: 'FlateDecode', colors: info.colorType === 0 ? 1 : 3, data: info.idat };
}

/* ---------- The image object and its page ---------- */

/**
 * The image XObject for a picture.
 * @param {Picture} picture
 */
export function imageStream(picture) {
  const dict = new PdfDict([
    ['Type', new PdfName('XObject')],
    ['Subtype', new PdfName('Image')],
    ['Width', picture.width],
    ['Height', picture.height],
    ['ColorSpace', new PdfName(picture.colors === 1 ? 'DeviceGray' : 'DeviceRGB')],
    ['BitsPerComponent', 8],
    ['Filter', new PdfName(picture.filter)],
  ]);
  if (picture.filter === 'FlateDecode') {
    dict.set('DecodeParms', new PdfDict([['Predictor', 15], ['Colors', picture.colors], ['BitsPerComponent', 8], ['Columns', picture.width]]));
  }
  return new PdfStream(dict, picture.data);
}

/**
 * How each EXIF orientation maps the image's unit square (stored pixels, first row at the top) onto the shown
 * picture's unit square, as [a b c d e f]: shown x = a·u + c·v + e, shown y = b·u + d·v + f.
 * 1 as stored; 2 mirrored; 3 turned 180°; 4 flipped; 5 transposed; 6 turned 90° clockwise; 7 transversed;
 * 8 turned 90° anticlockwise.
 */
export const ORIENTATION = /** @type {Record<number, number[]>} */ ({
  1: [1, 0, 0, 1, 0, 0],
  2: [-1, 0, 0, 1, 1, 0],
  3: [-1, 0, 0, -1, 1, 1],
  4: [1, 0, 0, -1, 0, 1],
  5: [0, -1, -1, 0, 1, 1],
  6: [0, -1, 1, 0, 0, 1],
  7: [0, 1, 1, 0, 0, 0],
  8: [0, 1, -1, 0, 1, 0],
});

/** The picture's size as shown: turned a quarter for orientations 5 to 8. @param {Picture} picture */
export const shownPixels = (picture) => (picture.orientation >= 5 ? { width: picture.height, height: picture.width } : { width: picture.width, height: picture.height });

/**
 * Where a picture goes: the page size and the box the picture fills, centred, never cropped or stretched.
 * "fit": the page is the picture (at its stated density, or FIT_DENSITY) plus the margin; A4 and Letter turn to
 * landscape for a landscape picture. The margin is a share of the page's shorter side, on every side.
 * @param {Pick<Picture, 'width' | 'height' | 'orientation' | 'density'>} picture
 * @param {ImagePageOptions} options
 * @returns {ImageLayout}
 */
export function imageLayout(picture, { size, margin }) {
  const shown = shownPixels(/** @type {Picture} */ (picture));
  const share = margin / 100;
  let width;
  let height;
  let box;
  if (size === 'fit') {
    const stated = picture.density;
    const density = stated !== null && stated >= STATED_DENSITY.min && stated <= STATED_DENSITY.max ? stated : FIT_DENSITY;
    let w = (shown.width / density) * 72;
    let h = (shown.height / density) * 72;
    const gap = share * Math.min(w, h);
    // Keep the page within the sides a PDF allows, scaling picture and margin together.
    const grow = Math.max(1, PAGE_SIDE.min / Math.min(w + 2 * gap, h + 2 * gap));
    const shrink = Math.min(1, PAGE_SIDE.max / Math.max(w + 2 * gap, h + 2 * gap));
    const scale = grow > 1 ? grow : shrink;
    [w, h] = [w * scale, h * scale];
    const g = gap * scale;
    width = w + 2 * g;
    height = h + 2 * g;
    box = { x: g, y: g, width: w, height: h };
  } else {
    const paper = PAGE_SIZES[size];
    const landscape = shown.width > shown.height;
    width = landscape ? paper.height : paper.width;
    height = landscape ? paper.width : paper.height;
    const gap = share * Math.min(width, height);
    const scale = Math.min((width - 2 * gap) / shown.width, (height - 2 * gap) / shown.height);
    const [w, h] = [shown.width * scale, shown.height * scale];
    box = { x: (width - w) / 2, y: (height - h) / 2, width: w, height: h };
  }
  const [a, b, c, d, e, f] = ORIENTATION[picture.orientation] ?? ORIENTATION[1];
  const matrix = [a * box.width, b * box.height, c * box.width, d * box.height, e * box.width + box.x, f * box.height + box.y];
  return { width, height, box, matrix };
}

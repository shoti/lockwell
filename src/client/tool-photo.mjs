// @ts-check
/**
 * @file Tool "Photo metadata remover": reads and strips metadata from JPEG, PNG and WebP.
 */
/**
 * Photo metadata viewer and remover for JPEG, PNG and WebP.
 *
 * The file is read in the browser and never uploaded. Cleaning rebuilds the
 * file from its own parts, keeping only what is needed to show the picture:
 * the image data is copied byte for byte (no re-compression, no quality
 * loss), together with the colour profile and the rotation. Everything else
 * goes: location, dates, device, thumbnails, comments, editing history and
 * any data stored after the image.
 */

import { receiveFiles } from './files.mjs';
import { ascii, concat, crc32, startsWith } from './bytes.mjs';

/** A file this tool can't process; `code` picks the message shown. */
export class PhotoError extends Error {
  /** @param {'unsupported' | 'heic' | 'damaged'} code */
  constructor(code) {
    super(`Photo can't be processed: ${code}`);
    this.name = 'PhotoError';
    this.code = code;
  }
}

/**
 * @typedef {'exif' | 'xmp' | 'iptc' | 'comment' | 'thumbnail' | 'trailing' | 'text' | 'other'} Flag
 *
 * @typedef {object} Findings
 * @property {{ lat: number, lon: number } | null} location
 * @property {string | null} camera
 * @property {string | null} taken
 * @property {string | null} software
 * @property {Set<Flag>} flags  Kinds of hidden data present, beyond the values above.
 *
 * @typedef {object} PhotoReport
 * @property {'jpeg' | 'png' | 'webp'} type
 * @property {Findings} findings
 * @property {Uint8Array<ArrayBuffer>} clean  The file without hidden data.
 */

/** @returns {Findings} */
const emptyFindings = () => ({ location: null, camera: null, taken: null, software: null, flags: new Set() });

/** True when the report has anything to show. @param {Findings} findings */
export const hasFindings = ({ location, camera, taken, software, flags }) =>
  Boolean(location || camera || taken || software || flags.size);

/**
 * @param {Uint8Array} bytes
 * @returns {'jpeg' | 'png' | 'webp' | 'heic' | null}
 */
export function detectType(bytes) {
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpeg';
  if (startsWith(bytes, 0, '\x89PNG\r\n\x1a\n')) return 'png';
  if (startsWith(bytes, 0, 'RIFF') && startsWith(bytes, 8, 'WEBP')) return 'webp';
  if (startsWith(bytes, 4, 'ftyp') && ['heic', 'heix', 'hevc', 'heim', 'heis', 'mif1', 'msf1', 'avif'].some((brand) => startsWith(bytes, 8, brand))) {
    return 'heic';
  }
  return null;
}

/* ---------- EXIF (a small TIFF file inside the photo) ---------- */

const TAG = {
  make: 0x010f,
  model: 0x0110,
  orientation: 0x0112,
  software: 0x0131,
  dateTime: 0x0132,
  exifIfd: 0x8769,
  gpsIfd: 0x8825,
  dateTimeOriginal: 0x9003,
  gpsLatRef: 1,
  gpsLat: 2,
  gpsLonRef: 3,
  gpsLon: 4,
};

/**
 * @typedef {object} Exif
 * @property {string | null} make
 * @property {string | null} model
 * @property {string | null} software
 * @property {string | null} taken
 * @property {number} orientation  1–8; 1 means "as stored".
 * @property {{ lat: number, lon: number } | null} location
 * @property {boolean} thumbnail
 * @property {boolean} details  Has tags beyond the ones read here.
 */

/**
 * Reads the few EXIF fields this tool reports. Every offset is checked
 * against the data, so a damaged or hostile block yields "nothing found"
 * rather than an exception.
 * @param {Uint8Array} tiff  The TIFF block (starts with "II" or "MM").
 * @returns {Exif | null}
 */
export function parseExif(tiff) {
  if (tiff.length < 8) return null;
  const view = new DataView(tiff.buffer, tiff.byteOffset, tiff.byteLength);
  const order = view.getUint16(0);
  if (order !== 0x4949 && order !== 0x4d4d) return null;
  const little = order === 0x4949;
  if (view.getUint16(2, little) !== 42) return null;

  /**
   * @param {number} offset
   * @returns {{ entries: Map<number, { type: number, count: number, at: number }>, next: number }}
   */
  const readIfd = (offset) => {
    /** @type {Map<number, { type: number, count: number, at: number }>} */
    const entries = new Map();
    if (offset < 8 || offset + 2 > tiff.length) return { entries, next: 0 };
    const count = view.getUint16(offset, little);
    const end = offset + 2 + count * 12;
    if (end > tiff.length) return { entries, next: 0 };
    for (let i = 0; i < count; i += 1) {
      const at = offset + 2 + i * 12;
      entries.set(view.getUint16(at, little), { type: view.getUint16(at + 2, little), count: view.getUint32(at + 4, little), at: at + 8 });
    }
    return { entries, next: end + 4 <= tiff.length ? view.getUint32(end, little) : 0 };
  };

  /** @param {{ type: number, count: number, at: number } | undefined} entry */
  const text = (entry) => {
    if (!entry || entry.type !== 2 || entry.count === 0 || entry.count > 1024) return null;
    const start = entry.count <= 4 ? entry.at : view.getUint32(entry.at, little);
    if (start + entry.count > tiff.length) return null;
    let out = '';
    for (let i = 0; i < entry.count; i += 1) {
      const code = tiff[start + i];
      if (code === 0) break;
      // Printable ASCII only: this text is shown on the page.
      out += code >= 0x20 && code < 0x7f ? String.fromCharCode(code) : '';
    }
    return out.trim() || null;
  };

  /** @param {{ type: number, count: number, at: number } | undefined} entry */
  const pointer = (entry) => (entry && entry.type === 4 && entry.count === 1 ? view.getUint32(entry.at, little) : 0);

  /**
   * Degrees, minutes, seconds as three fractions.
   * @param {{ type: number, count: number, at: number } | undefined} entry
   */
  const degrees = (entry) => {
    if (!entry || entry.type !== 5 || entry.count !== 3) return null;
    const start = view.getUint32(entry.at, little);
    if (start + 24 > tiff.length) return null;
    let value = 0;
    for (let i = 0; i < 3; i += 1) {
      const bottom = view.getUint32(start + i * 8 + 4, little);
      if (bottom === 0) return null;
      value += view.getUint32(start + i * 8, little) / bottom / 60 ** i;
    }
    return value;
  };

  const ifd0 = readIfd(view.getUint32(4, little));
  const exif = readIfd(pointer(ifd0.entries.get(TAG.exifIfd)));
  const gps = readIfd(pointer(ifd0.entries.get(TAG.gpsIfd)));

  const lat = degrees(gps.entries.get(TAG.gpsLat));
  const lon = degrees(gps.entries.get(TAG.gpsLon));
  const south = text(gps.entries.get(TAG.gpsLatRef)) === 'S';
  const west = text(gps.entries.get(TAG.gpsLonRef)) === 'W';
  const located = lat !== null && lon !== null && lat <= 90 && lon <= 180 && !(lat === 0 && lon === 0);

  const orientationEntry = ifd0.entries.get(TAG.orientation);
  const orientation = orientationEntry && orientationEntry.type === 3 ? view.getUint16(orientationEntry.at, little) : 1;
  // Reported on their own, or (resolution, colour placement) present in every file and telling nothing.
  const known = [TAG.make, TAG.model, TAG.orientation, TAG.software, TAG.dateTime, TAG.exifIfd, TAG.gpsIfd, 0x011a, 0x011b, 0x0128, 0x0213];

  return {
    make: text(ifd0.entries.get(TAG.make)),
    model: text(ifd0.entries.get(TAG.model)),
    software: text(ifd0.entries.get(TAG.software)),
    taken: text(exif.entries.get(TAG.dateTimeOriginal)) ?? text(ifd0.entries.get(TAG.dateTime)),
    orientation: orientation >= 1 && orientation <= 8 ? orientation : 1,
    location: located ? { lat: south ? -lat : lat, lon: west ? -lon : lon } : null,
    thumbnail: ifd0.next !== 0,
    details: exif.entries.size > 1 || [...ifd0.entries.keys()].some((tag) => !known.includes(tag)),
  };
}

/**
 * A TIFF block holding only the rotation, so a cleaned photo is still shown
 * the right way up.
 * @param {number} orientation  2–8
 */
function orientationTiff(orientation) {
  return Uint8Array.of(
    ...[0x4d, 0x4d, 0x00, 0x2a, 0, 0, 0, 8], // big-endian TIFF, first directory at 8
    ...[0, 1], // one entry
    ...[0x01, 0x12, 0, 3, 0, 0, 0, 1, 0, orientation, 0, 0], // Orientation, SHORT, count 1
    ...[0, 0, 0, 0], // no further directory
  );
}

/**
 * Copies what EXIF says into the findings.
 * @param {Findings} findings
 * @param {Exif | null} exif
 */
function reportExif(findings, exif) {
  if (!exif) {
    findings.flags.add('other');
    return;
  }
  const camera = [exif.make, exif.model && exif.make && exif.model.startsWith(exif.make) ? exif.model.slice(exif.make.length).trim() : exif.model]
    .filter(Boolean)
    .join(' ');
  findings.location ??= exif.location;
  findings.camera ??= camera || null;
  // "2026:11:09 14:03:22" → "2026-11-09 14:03"
  findings.taken ??= exif.taken ? exif.taken.replace(/^(\d{4}):(\d{2}):(\d{2})/, '$1-$2-$3').replace(/^(\S+ \d{2}:\d{2}):\d{2}$/, '$1') : null;
  findings.software ??= exif.software;
  if (exif.thumbnail) findings.flags.add('thumbnail');
  if (exif.details) findings.flags.add('exif');
}

/* ---------- JPEG ---------- */

const JPEG = { soi: 0xd8, eoi: 0xd9, sos: 0xda, com: 0xfe, app0: 0xe0, app1: 0xe1, app2: 0xe2, app13: 0xed, app14: 0xee, app15: 0xef };

/**
 * Splits a JPEG into its segments. The compressed image data after each
 * "start of scan" header is kept with that segment.
 * @param {Uint8Array} bytes
 * @returns {{ segments: { marker: number, start: number, end: number }[], end: number }}  end: just past the end-of-image marker.
 */
function jpegSegments(bytes) {
  const segments = [];
  let i = 2;
  while (i + 1 < bytes.length) {
    if (bytes[i] !== 0xff) throw new PhotoError('damaged');
    // Any number of 0xFF fill bytes may precede a marker.
    while (bytes[i + 1] === 0xff) i += 1;
    const marker = bytes[i + 1];
    if (marker === JPEG.eoi) return { segments, end: i + 2 };
    if (i + 3 >= bytes.length) break;
    const length = (bytes[i + 2] << 8) | bytes[i + 3];
    let end = i + 2 + length;
    if (length < 2 || end > bytes.length) throw new PhotoError('damaged');
    if (marker === JPEG.sos) {
      // Image data runs until the next real marker (0xFF00 and restart markers belong to the data).
      while (end + 1 < bytes.length && !(bytes[end] === 0xff && bytes[end + 1] !== 0 && bytes[end + 1] !== 0xff && (bytes[end + 1] < 0xd0 || bytes[end + 1] > 0xd7))) {
        end += 1;
      }
      if (end + 1 >= bytes.length) break;
    }
    segments.push({ marker, start: i, end });
    i = end;
  }
  throw new PhotoError('damaged');
}

/**
 * @param {Uint8Array<ArrayBuffer>} bytes
 * @returns {PhotoReport}
 */
function inspectJpeg(bytes) {
  const findings = emptyFindings();
  const { segments, end } = jpegSegments(bytes);
  /** @type {Uint8Array[]} */
  const kept = [];
  let orientation = 1;
  let hasJfif = false;

  for (const { marker, start, end: segmentEnd } of segments) {
    const data = start + 4;
    const isApp = marker >= JPEG.app0 && marker <= JPEG.app15;
    let keep = !isApp && marker !== JPEG.com;

    if (marker === JPEG.app0 && startsWith(bytes, data, 'JFIF\0')) {
      keep = true;
      hasJfif = true;
    } else if (marker === JPEG.app0 && startsWith(bytes, data, 'JFXX\0')) {
      findings.flags.add('thumbnail');
    } else if ((marker === JPEG.app2 && startsWith(bytes, data, 'ICC_PROFILE\0')) || (marker === JPEG.app14 && startsWith(bytes, data, 'Adobe'))) {
      keep = true; // Colour information: without it the picture can look different.
    } else if (marker === JPEG.app1 && startsWith(bytes, data, 'Exif\0\0')) {
      const exif = parseExif(bytes.subarray(data + 6, segmentEnd));
      reportExif(findings, exif);
      if (exif) orientation = exif.orientation;
    } else if (marker === JPEG.app1 && startsWith(bytes, data, 'http://ns.adobe.com/')) {
      findings.flags.add('xmp');
    } else if (marker === JPEG.app13) {
      findings.flags.add('iptc');
    } else if (marker === JPEG.com) {
      findings.flags.add('comment');
    } else if (isApp) {
      findings.flags.add('other');
    }
    if (keep) kept.push(bytes.subarray(start, segmentEnd));
  }
  if (end < bytes.length) findings.flags.add('trailing');

  /** @type {Uint8Array[]} */
  const head = [Uint8Array.of(0xff, JPEG.soi)];
  // JFIF, when present, has to come first.
  if (hasJfif) head.push(/** @type {Uint8Array} */ (kept.shift()));
  if (orientation !== 1) {
    const tiff = orientationTiff(orientation);
    const length = 2 + 6 + tiff.length;
    head.push(Uint8Array.of(0xff, JPEG.app1, length >> 8, length & 0xff), ascii('Exif\0\0'), tiff);
  }
  return { type: 'jpeg', findings, clean: concat([...head, ...kept, Uint8Array.of(0xff, JPEG.eoi)]) };
}

/* ---------- PNG ---------- */

/** Chunks needed to draw the picture (including animation and colour). Everything else is dropped. */
const PNG_KEEP = new Set(['IHDR', 'PLTE', 'IDAT', 'IEND', 'tRNS', 'gAMA', 'cHRM', 'sRGB', 'iCCP', 'sBIT', 'bKGD', 'pHYs', 'cICP', 'acTL', 'fcTL', 'fdAT']);

/**
 * @param {string} type
 * @param {Uint8Array} data
 */
function pngChunk(type, data) {
  const body = concat([ascii(type), data]);
  const out = new Uint8Array(8 + data.length + 4);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  out.set(body, 4);
  view.setUint32(8 + data.length, crc32(body));
  return out;
}

/**
 * @param {Uint8Array<ArrayBuffer>} bytes
 * @returns {PhotoReport}
 */
function inspectPng(bytes) {
  const findings = emptyFindings();
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  /** @type {Uint8Array[]} */
  const kept = [bytes.subarray(0, 8)];
  let orientation = 1;
  /** Where the image data starts in `kept`; the rotation has to go before it. */
  let imageAt = -1;
  let i = 8;

  while (i + 12 <= bytes.length) {
    const length = view.getUint32(i);
    const end = i + 12 + length;
    if (end > bytes.length) throw new PhotoError('damaged');
    const type = String.fromCharCode(...bytes.subarray(i + 4, i + 8));

    if (type === 'eXIf') {
      const exif = parseExif(bytes.subarray(i + 8, i + 8 + length));
      reportExif(findings, exif);
      if (exif) orientation = exif.orientation;
    } else if (type === 'tEXt' || type === 'zTXt' || type === 'iTXt') {
      findings.flags.add(startsWith(bytes, i + 8, 'XML:com.adobe.xmp') ? 'xmp' : 'text');
    } else if (!PNG_KEEP.has(type)) {
      findings.flags.add('other');
    }

    if (type === 'IDAT' && imageAt === -1) imageAt = kept.length;
    if (type === 'IEND') {
      if (end < bytes.length) findings.flags.add('trailing');
      kept.push(bytes.subarray(i, end));
      // Readers (Apple's, for one) only honour the rotation when it comes before the image data.
      if (orientation !== 1 && imageAt !== -1) kept.splice(imageAt, 0, pngChunk('eXIf', orientationTiff(orientation)));
      return { type: 'png', findings, clean: concat(kept) };
    }
    if (PNG_KEEP.has(type)) kept.push(bytes.subarray(i, end));
    i = end;
  }
  throw new PhotoError('damaged');
}

/* ---------- WebP ---------- */

const WEBP_KEEP = new Set(['VP8 ', 'VP8L', 'VP8X', 'ALPH', 'ANIM', 'ANMF', 'ICCP']);
/** Bits in the VP8X header that announce metadata chunks. */
const WEBP_EXIF_FLAG = 0x08;
const WEBP_XMP_FLAG = 0x04;

/**
 * @param {string} type  Four characters.
 * @param {Uint8Array} data
 */
function webpChunk(type, data) {
  const out = new Uint8Array(8 + data.length + (data.length % 2));
  out.set(ascii(type), 0);
  new DataView(out.buffer).setUint32(4, data.length, true);
  out.set(data, 8);
  return out;
}

/**
 * @param {Uint8Array<ArrayBuffer>} bytes
 * @returns {PhotoReport}
 */
function inspectWebp(bytes) {
  const findings = emptyFindings();
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const riffEnd = 8 + view.getUint32(4, true);
  if (riffEnd > bytes.length) throw new PhotoError('damaged');
  if (riffEnd < bytes.length) findings.flags.add('trailing');

  /** @type {Uint8Array[]} */
  const kept = [];
  let orientation = 1;
  let extended = false;
  let i = 12;
  while (i + 8 <= riffEnd) {
    const type = String.fromCharCode(...bytes.subarray(i, i + 4));
    const length = view.getUint32(i + 4, true);
    const end = i + 8 + length + (length % 2);
    if (i + 8 + length > riffEnd) throw new PhotoError('damaged');

    if (type === 'EXIF') {
      // Some writers repeat the JPEG-style "Exif\0\0" prefix.
      const start = startsWith(bytes, i + 8, 'Exif\0\0') ? i + 14 : i + 8;
      const exif = parseExif(bytes.subarray(start, i + 8 + length));
      reportExif(findings, exif);
      if (exif) orientation = exif.orientation;
    } else if (type === 'XMP ') {
      findings.flags.add('xmp');
    } else if (!WEBP_KEEP.has(type)) {
      findings.flags.add('other');
    } else if (type === 'VP8X') {
      extended = true;
      const header = bytes.slice(i, Math.min(end, riffEnd));
      header[8] &= ~(WEBP_EXIF_FLAG | WEBP_XMP_FLAG);
      kept.push(header);
    } else {
      kept.push(bytes.subarray(i, Math.min(end, riffEnd)));
    }
    i = end;
  }
  if (kept.length === 0) throw new PhotoError('damaged');
  // EXIF comes after the image data, so the rotation is only known once every chunk
  // was read. It can only be kept in files that have the VP8X header (always the
  // first chunk) to announce it.
  if (extended && orientation !== 1) {
    kept[0][8] |= WEBP_EXIF_FLAG;
    kept.push(webpChunk('EXIF', orientationTiff(orientation)));
  }

  const body = concat(kept);
  const header = new Uint8Array(12);
  header.set(ascii('RIFF'), 0);
  new DataView(header.buffer).setUint32(4, 4 + body.length, true);
  header.set(ascii('WEBP'), 8);
  return { type: 'webp', findings, clean: concat([header, body]) };
}

/**
 * Reads a photo: what hidden data it carries, and the same photo without it.
 * @param {Uint8Array<ArrayBuffer>} bytes
 * @returns {PhotoReport}
 * @throws {PhotoError}
 */
export function inspectPhoto(bytes) {
  const type = detectType(bytes);
  if (type === 'jpeg') return inspectJpeg(bytes);
  if (type === 'png') return inspectPng(bytes);
  if (type === 'webp') return inspectWebp(bytes);
  throw new PhotoError(type === 'heic' ? 'heic' : 'unsupported');
}

/* ---------- Page wiring ---------- */

const MAX_BYTES = 40 * 1024 * 1024;
const MIME = { jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };
const EXTENSION = { jpeg: 'jpg', png: 'png', webp: 'webp' };

/**
 * "IMG_1234.JPG" → "IMG_1234-clean.jpg"
 * @param {string} name
 * @param {keyof typeof EXTENSION} type
 */
export function cleanName(name, type) {
  const base = name.replace(/\.[^.]*$/, '') || 'photo';
  return `${base}-clean.${EXTENSION[type]}`;
}

/** @param {HTMLElement} root */
export function init(root) {
  const file = /** @type {HTMLInputElement} */ (root.querySelector('[data-js="photo-file"]'));
  const message = /** @type {HTMLElement} */ (root.querySelector('[data-js="photo-message"]'));
  const facts = /** @type {HTMLElement} */ (root.querySelector('[data-js="photo-facts"]'));
  const save = /** @type {HTMLElement} */ (root.querySelector('[data-js="photo-save"]'));
  const download = /** @type {HTMLAnchorElement} */ (root.querySelector('[data-js="photo-download"]'));
  const rows = /** @type {HTMLElement[]} */ ([...facts.querySelectorAll('[data-row]')]);
  let objectUrl = '';

  /** @param {string} key  A data-* message on the status line. */
  const fail = (key) => {
    message.textContent = message.dataset[key] ?? '';
    facts.hidden = true;
    save.hidden = true;
  };

  /**
   * @param {string} row
   * @param {string | null} value  Text for rows that show a value; "" to show the row's own text.
   */
  const setRow = (row, value) => {
    const element = rows.find((candidate) => candidate.dataset.row === row);
    if (!element) return;
    element.hidden = value === null;
    const cell = element.querySelector('dd');
    if (cell && value) cell.textContent = value;
  };

  /** @param {File | undefined} chosen */
  const open = async (chosen) => {
    // The previous clean copy is no longer needed; let the browser free it.
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    objectUrl = '';
    if (!chosen) return fail('');
    if (chosen.size > MAX_BYTES) return fail('tooLarge');

    let report;
    try {
      report = inspectPhoto(new Uint8Array(await chosen.arrayBuffer()));
    } catch (error) {
      if (!(error instanceof PhotoError)) console.error('[lockwell] Could not read the chosen photo.', error);
      return fail(error instanceof PhotoError ? error.code : 'damaged');
    }

    const { findings } = report;
    if (!hasFindings(findings)) return fail('none');

    message.textContent = message.dataset.found ?? '';
    setRow('location', findings.location ? `${findings.location.lat.toFixed(5)}, ${findings.location.lon.toFixed(5)}` : null);
    setRow('camera', findings.camera);
    setRow('taken', findings.taken);
    setRow('software', findings.software);
    for (const flag of /** @type {Flag[]} */ (['exif', 'xmp', 'iptc', 'comment', 'thumbnail', 'trailing', 'text', 'other'])) {
      setRow(flag, findings.flags.has(flag) ? '' : null);
    }
    facts.hidden = false;

    objectUrl = URL.createObjectURL(new Blob([report.clean], { type: MIME[report.type] }));
    download.href = objectUrl;
    download.download = cleanName(chosen.name, report.type);
    save.hidden = false;
  };

  file.addEventListener('change', () => open(file.files?.[0]));
  receiveFiles(root, open, { paste: true });
}

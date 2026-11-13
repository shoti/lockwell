// @ts-check
/**
 * @file Tool "Photo metadata remover": reads and strips metadata from JPEG, PNG, WebP, HEIC and AVIF.
 */
/**
 * Photo metadata viewer and remover.
 *
 * The file is read in the browser and never uploaded. For JPEG, PNG and WebP
 * cleaning rebuilds the file from its own parts, keeping only what is needed
 * to show the picture: the image data is copied byte for byte (no
 * re-compression, no quality loss), together with the colour profile and the
 * rotation. Everything else goes: location, dates, device, thumbnails,
 * comments, editing history and any data stored after the image.
 *
 * HEIC and AVIF can't be rebuilt that way without a full writer, so their
 * EXIF and XMP items are blanked in place, keeping every offset valid. What
 * that leaves (preview pictures, content credentials) is reported as left in.
 * Format sources: docs/research/tool-photo-metadata.md.
 *
 * Every clean copy is read again before it is offered; if anything that was
 * meant to go is still there, no copy is offered.
 */

import { receiveFiles } from './files.mjs';
import { ascii, concat, crc32, startsWith } from './bytes.mjs';
import { initCopy } from './copy.mjs';
import { initSave } from './save.mjs';
import { cleanArchive } from './zip.mjs';
import { fillText } from './fill.mjs';

/**
 * A file this tool can't process; `code` picks the message shown.
 * "optimised": a PNG in Apple's CgBI form, which browsers can't draw.
 */
export class PhotoError extends Error {
  /** @param {'unsupported' | 'compact' | 'optimised' | 'damaged'} code */
  constructor(code) {
    super(`Photo can't be processed: ${code}`);
    this.name = 'PhotoError';
    this.code = code;
  }
}

/**
 * @typedef {'exif' | 'xmp' | 'iptc' | 'photoshop' | 'comment' | 'thumbnail' | 'trailing' | 'c2pa' | 'hdr' | 'unread' | 'other'} Flag
 *   "unread": metadata is there but could not be read to the end; the clean copy leaves it out.
 * @typedef {'thumbnail' | 'xmp' | 'exif' | 'auxiliary' | 'profile' | 'other'} Kept  What a clean copy keeps, by kind.
 * @typedef {'jpeg' | 'png' | 'webp' | 'heic' | 'avif'} PhotoType
 *
 * @typedef {object} TextNote  A PNG text chunk.
 * @property {string} key
 * @property {string | null} text  null when compressed (not shown).
 * @property {boolean} cut  The text was shortened for the page.
 *
 * @typedef {object} Findings
 * @property {{ lat: number, lon: number } | null} location
 * @property {Record<string, string>} fields  Named values: camera, serial, owner, artist, place, altitude… (see FIELD in the panel).
 * @property {TextNote[]} texts  The first MAX_TEXTS notes.
 * @property {number} moreTexts  How many more there are.
 * @property {string[]} secrets  Values the clean copy must not contain: names, IDs and the raw bytes of coordinates
 *   are searched for in it, independently of the readers.
 * @property {Uint8Array[]} rawSecrets
 * @property {Uint8Array | null} preview  The JPEG preview stored in EXIF, to show.
 * @property {Set<Flag>} flags  Kinds of hidden data present, beyond the values above.
 *
 * @typedef {object} PhotoReport
 * @property {PhotoType} type
 * @property {Findings} findings
 * @property {Set<Kept>} kept  What stays in the clean copy.
 * @property {Uint8Array<ArrayBuffer> | null} clean  The file without hidden data, or null if it couldn't be made safely.
 * @property {boolean} verified  The clean copy was read again and searched, and only what is listed in `kept` was found.
 * @property {number} orientation  1–8, from the first EXIF block (for drawing the preview).
 *
 * @typedef {object} Options
 * @property {boolean} [dropProfile]  Leave out a colour profile that isn't a standard one, instead of keeping it.
 */

/** @returns {Findings} */
const emptyFindings = () => ({ location: null, fields: {}, texts: [], moreTexts: 0, secrets: [], rawSecrets: [], preview: null, flags: new Set() });

/** True when the report has anything to show. @param {Findings} findings */
export const hasFindings = ({ location, fields, texts, preview, flags }) =>
  Boolean(location || Object.keys(fields).length || texts.length || preview || flags.size);

/** Longest value shown; a caption can be a whole article. */
const MAX_VALUE = 300;
/** @param {string} value */
const cut = (value) => (value.length > MAX_VALUE ? `${value.slice(0, MAX_VALUE)}…` : value);

/**
 * Adds values that aren't known yet; the first source to name a field wins.
 * @param {Findings} findings
 * @param {Record<string, string>} fields
 */
function addFields(findings, fields) {
  for (const [key, value] of Object.entries(fields)) {
    if (value && !(key in findings.fields)) findings.fields[key] = cut(value);
    // What names a person or a camera is searched for in the clean copy.
    if (value && SECRET_FIELDS.includes(key)) findings.secrets.push(value);
  }
}

/** Fields that name a person, a device or a photo. */
const SECRET_FIELDS = ['serial', 'lensSerial', 'owner', 'artist', 'copyright', 'uniqueId', 'caption', 'place', 'keywords'];

/** HEIF brands (Nokia HEIF technical page, Table I; AVIF §6). */
const AVIF_BRANDS = ['avif', 'avis'];
const HEIF_BRANDS = ['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis', 'hevm', 'hevs', 'mif1', 'msf1', 'mif2', 'mif3', 'miaf'];

/**
 * The brands of an ISO media file's ftyp box: major brand and compatible ones.
 * @param {Uint8Array} bytes
 */
function brands(bytes) {
  if (bytes.length < 12 || !startsWith(bytes, 4, 'ftyp')) return [];
  const size = Math.min(new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(0), bytes.length);
  const out = [fourCc(bytes, 8)];
  for (let i = 16; i + 4 <= size; i += 4) out.push(fourCc(bytes, i));
  return out;
}

/** @param {Uint8Array} bytes @param {number} at */
const fourCc = (bytes, at) => String.fromCharCode(...bytes.subarray(at, at + 4));

/**
 * @param {Uint8Array} bytes
 * @returns {PhotoType | null}
 */
export function detectType(bytes) {
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpeg';
  if (startsWith(bytes, 0, '\x89PNG\r\n\x1a\n')) return 'png';
  if (startsWith(bytes, 0, 'RIFF') && startsWith(bytes, 8, 'WEBP')) return 'webp';
  const list = brands(bytes);
  if (list.some((brand) => AVIF_BRANDS.includes(brand))) return 'avif';
  if (list.some((brand) => HEIF_BRANDS.includes(brand))) return 'heic';
  return null;
}

/* ---------- Text ---------- */

/** Control, direction, invisible and tag characters: never shown from a file. */
const CONTROL = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u00ad\u061c\u180e\u200b-\u200f\u202a-\u202e\u2060-\u2064\u2066-\u2069\ufeff\u{e0000}-\u{e007f}]/gu;

/** @param {string} text  One line: whitespace runs become one space. */
const oneLine = (text) => text.replace(CONTROL, ' ').replace(/\s+/g, ' ').trim();

/**
 * UTF-8 where the bytes are valid UTF-8, otherwise Latin-1 (older writers).
 * @param {Uint8Array} bytes
 */
function decodeText(bytes) {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder('latin1').decode(bytes);
  }
}

/** @param {string[]} values  Distinct, non-empty, joined. */
const joinValues = (values) => [...new Set(values.map(oneLine).filter(Boolean))].join(', ');

/**
 * "Apple" + "iPhone 15" → "Apple iPhone 15"; "Canon" + "Canon EOS R6" → "Canon EOS R6".
 * @param {string | null | undefined} make
 * @param {string | null | undefined} model
 */
function device(make, model) {
  if (make && model && model.toLowerCase().startsWith(make.toLowerCase())) return model;
  return [make, model].filter(Boolean).join(' ');
}

/**
 * "2026:11:09 14:03:22" or "2026-11-09T14:03:22+04:00" → "2026-11-09 14:03"
 * @param {string | null | undefined} value
 */
function dateTime(value) {
  if (!value) return '';
  const match = /^(\d{4})[:-](\d{2})[:-](\d{2})(?:[T ](\d{2}):(\d{2}))?/.exec(value.trim());
  if (!match) return oneLine(value);
  const [, year, month, day, hour, minute] = match;
  return `${year}-${month}-${day}${hour ? ` ${hour}:${minute}` : ''}`;
}

/* ---------- EXIF (a small TIFF file inside the photo) ---------- */

const TAG = {
  make: 0x010f,
  model: 0x0110,
  orientation: 0x0112,
  software: 0x0131,
  dateTime: 0x0132,
  artist: 0x013b,
  copyright: 0x8298,
  exifIfd: 0x8769,
  gpsIfd: 0x8825,
  dateTimeOriginal: 0x9003,
  uniqueId: 0xa420,
  owner: 0xa430,
  serial: 0xa431,
  lensMake: 0xa433,
  lensModel: 0xa434,
  lensSerial: 0xa435,
  photographer: 0xa437,
  previewOffset: 0x0201,
  previewLength: 0x0202,
  gpsLatRef: 1,
  gpsLat: 2,
  gpsLonRef: 3,
  gpsLon: 4,
  gpsAltitudeRef: 5,
  gpsAltitude: 6,
  gpsTime: 7,
  gpsDirection: 17,
  gpsDate: 29,
};

/** Tags reported by name, or (resolution, colour placement) present in every file and telling nothing. */
const NAMED_IFD0 = [TAG.make, TAG.model, TAG.orientation, TAG.software, TAG.dateTime, TAG.artist, TAG.copyright, TAG.exifIfd, TAG.gpsIfd, 0x011a, 0x011b, 0x0128, 0x0213];
const NAMED_EXIF = [TAG.dateTimeOriginal, TAG.uniqueId, TAG.owner, TAG.serial, TAG.lensMake, TAG.lensModel, TAG.lensSerial, TAG.photographer];
// 0 is the GPS version; 16 the reference of the direction.
const NAMED_GPS = [0, 1, 2, 3, 4, 5, 6, 7, 16, 17, 29];

/**
 * @typedef {object} Exif
 * @property {Record<string, string>} fields
 * @property {number} orientation  1–8; 1 means "as stored".
 * @property {{ lat: number, lon: number } | null} location
 * @property {boolean} thumbnail  Has a second directory (a preview picture).
 * @property {Uint8Array | null} preview  The preview, when it is a JPEG inside the block.
 * @property {boolean} details  Has tags beyond the ones named here.
 * @property {boolean} unread  Something is there that couldn't be read: a directory that can't be walked, or a named
 *   tag whose value doesn't parse (a location of 0/0 seconds, an author stored as bytes).
 * @property {Uint8Array[]} raw  The coordinates as stored, to search the clean copy for.
 */

/** Longest text read from a tag; a longer one counts as unreadable rather than being shown. */
const MAX_TAG_TEXT = 1024;

/**
 * Reads the EXIF fields this tool reports. Every offset is checked against
 * the data; what can't be read sets `unread` rather than throwing or being
 * passed over in silence.
 * @param {Uint8Array} tiff  The TIFF block (starts with "II" or "MM").
 * @returns {Exif | null}  null when it isn't a TIFF block at all.
 */
export function parseExif(tiff) {
  if (tiff.length < 8) return null;
  const view = new DataView(tiff.buffer, tiff.byteOffset, tiff.byteLength);
  const order = view.getUint16(0);
  if (order !== 0x4949 && order !== 0x4d4d) return null;
  const little = order === 0x4949;
  if (view.getUint16(2, little) !== 42) return null;
  let unread = false;

  /** @typedef {{ type: number, count: number, at: number }} Field */
  /**
   * @param {number} offset
   * @returns {{ entries: Map<number, Field>, next: number }}
   */
  const readIfd = (offset) => {
    /** @type {Map<number, Field>} */
    const entries = new Map();
    if (offset === 0) return { entries, next: 0 };
    const count = offset >= 8 && offset + 2 <= tiff.length ? view.getUint16(offset, little) : 0;
    const end = offset + 2 + count * 12;
    if (offset < 8 || offset + 2 > tiff.length || end > tiff.length) {
      unread = true;
      return { entries, next: 0 };
    }
    for (let i = 0; i < count; i += 1) {
      const at = offset + 2 + i * 12;
      entries.set(view.getUint16(at, little), { type: view.getUint16(at + 2, little), count: view.getUint32(at + 4, little), at: at + 8 });
    }
    return { entries, next: end + 4 <= tiff.length ? view.getUint32(end, little) : 0 };
  };

  /** A tag that is there but whose value can't be read. @template T @param {Field | undefined} entry @param {T} value */
  const checked = (entry, value) => {
    if (entry && !value) unread = true;
    return value;
  };

  /** ASCII (2) or UTF-8 (129, Exif 3.0) text. @param {Field | undefined} entry */
  const text = (entry) => {
    if (!entry || (entry.type !== 2 && entry.type !== 129) || entry.count === 0 || entry.count > MAX_TAG_TEXT) return checked(entry, '');
    const start = entry.count <= 4 ? entry.at : view.getUint32(entry.at, little);
    if (start + entry.count > tiff.length) return checked(entry, '');
    const raw = tiff.subarray(start, start + entry.count);
    const end = raw.indexOf(0);
    return checked(entry, oneLine(decodeText(end === -1 ? raw : raw.subarray(0, end))));
  };

  /** @param {Field | undefined} entry */
  const long = (entry) => (entry && entry.type === 4 && entry.count === 1 ? view.getUint32(entry.at, little) : 0);

  /** Where a list of fractions is stored, or -1. @param {Field | undefined} entry @param {number} count */
  const rationalsAt = (entry, count) => {
    if (!entry || entry.type !== 5 || entry.count !== count) return -1;
    const start = view.getUint32(entry.at, little);
    return start + count * 8 > tiff.length ? -1 : start;
  };

  /**
   * Unsigned fractions (RATIONAL) as numbers; null if any is missing or divides by zero.
   * @param {Field | undefined} entry
   * @param {number} count
   */
  const rationals = (entry, count) => {
    const start = rationalsAt(entry, count);
    if (start === -1) return checked(entry, null);
    const out = [];
    for (let i = 0; i < count; i += 1) {
      const bottom = view.getUint32(start + i * 8 + 4, little);
      if (bottom === 0) return checked(entry, null);
      out.push(view.getUint32(start + i * 8, little) / bottom);
    }
    return out;
  };

  /** @param {Field | undefined} entry */
  const degrees = (entry) => {
    const parts = rationals(entry, 3);
    return parts ? parts[0] + parts[1] / 60 + parts[2] / 3600 : null;
  };

  const ifd0 = readIfd(view.getUint32(4, little));
  const exif = readIfd(checked(ifd0.entries.get(TAG.exifIfd), long(ifd0.entries.get(TAG.exifIfd))));
  const gps = readIfd(checked(ifd0.entries.get(TAG.gpsIfd), long(ifd0.entries.get(TAG.gpsIfd))));
  const ifd1 = readIfd(ifd0.next);

  const latEntry = gps.entries.get(TAG.gpsLat);
  const lonEntry = gps.entries.get(TAG.gpsLon);
  const lat = degrees(latEntry);
  const lon = degrees(lonEntry);
  const south = text(gps.entries.get(TAG.gpsLatRef)) === 'S';
  const west = text(gps.entries.get(TAG.gpsLonRef)) === 'W';
  const located = lat !== null && lon !== null && lat <= 90 && lon <= 180 && !(lat === 0 && lon === 0);
  // Half a location, or one out of range, is still a location someone wrote.
  if ((latEntry || lonEntry) && !located) unread = true;
  /** @type {Uint8Array[]} */
  const raw = [latEntry, lonEntry].map((entry) => rationalsAt(entry, 3)).filter((at) => at !== -1).map((at) => tiff.slice(at, at + 24));

  const altitude = rationals(gps.entries.get(TAG.gpsAltitude), 1);
  const altitudeRef = gps.entries.get(TAG.gpsAltitudeRef);
  const below = altitudeRef?.type === 1 && tiff[altitudeRef.at] === 1;
  const direction = rationals(gps.entries.get(TAG.gpsDirection), 1);
  const time = rationals(gps.entries.get(TAG.gpsTime), 3);
  const date = text(gps.entries.get(TAG.gpsDate)).replace(/^(\d{4}):(\d{2}):(\d{2})$/, '$1-$2-$3');
  const clock = time ? time.map((part) => String(Math.floor(part)).padStart(2, '0')).join(':') : '';

  // Rotation is a SHORT; some writers use a LONG.
  const orientationEntry = ifd0.entries.get(TAG.orientation);
  const orientation = orientationEntry?.type === 3 ? view.getUint16(orientationEntry.at, little) : orientationEntry?.type === 4 ? view.getUint32(orientationEntry.at, little) : 1;

  const previewAt = long(ifd1.entries.get(TAG.previewOffset));
  const previewLength = long(ifd1.entries.get(TAG.previewLength));
  const previewOk = previewAt >= 8 && previewLength > 2 && previewAt + previewLength <= tiff.length && tiff[previewAt] === 0xff && tiff[previewAt + 1] === 0xd8;

  const lensMake = text(exif.entries.get(TAG.lensMake));
  const lensModel = text(exif.entries.get(TAG.lensModel));
  /** @type {Record<string, string>} */
  const fields = {
    camera: device(text(ifd0.entries.get(TAG.make)), text(ifd0.entries.get(TAG.model))),
    lens: device(lensMake, lensModel),
    serial: text(exif.entries.get(TAG.serial)),
    lensSerial: text(exif.entries.get(TAG.lensSerial)),
    owner: text(exif.entries.get(TAG.owner)),
    artist: joinValues([text(ifd0.entries.get(TAG.artist)), text(exif.entries.get(TAG.photographer))]),
    copyright: text(ifd0.entries.get(TAG.copyright)),
    uniqueId: text(exif.entries.get(TAG.uniqueId)),
    taken: dateTime(text(exif.entries.get(TAG.dateTimeOriginal)) || text(ifd0.entries.get(TAG.dateTime))),
    software: text(ifd0.entries.get(TAG.software)),
    altitude: altitude ? String(Math.round(below ? -altitude[0] : altitude[0])) : '',
    direction: direction ? String(Math.round(direction[0]) % 360) : '',
    gpsTime: [date, clock].filter(Boolean).join(' '),
  };
  for (const key of Object.keys(fields)) if (!fields[key]) delete fields[key];

  return {
    fields,
    orientation: orientation >= 1 && orientation <= 8 ? orientation : 1,
    location: located ? { lat: south ? -lat : lat, lon: west ? -lon : lon } : null,
    thumbnail: ifd0.next !== 0,
    preview: previewOk ? tiff.slice(previewAt, previewAt + previewLength) : null,
    details:
      [...ifd0.entries.keys()].some((tag) => !NAMED_IFD0.includes(tag)) ||
      [...exif.entries.keys()].some((tag) => !NAMED_EXIF.includes(tag)) ||
      [...gps.entries.keys()].some((tag) => !NAMED_GPS.includes(tag)),
    unread,
    raw,
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
  // Not even a TIFF header: there is a block, and nothing in it could be read.
  if (!exif) {
    findings.flags.add('unread');
    return;
  }
  findings.location ??= exif.location;
  addFields(findings, exif.fields);
  findings.preview ??= exif.preview;
  findings.rawSecrets.push(...exif.raw);
  if (exif.thumbnail) findings.flags.add('thumbnail');
  if (exif.details) findings.flags.add('exif');
  if (exif.unread) findings.flags.add('unread');
}

/* ---------- XMP ---------- */

/** The most XMP text read: real packets are a few kilobytes. */
const MAX_XMP = 256 * 1024;
/** What a blanked XMP item holds: an empty, well-formed packet. */
const EMPTY_XMP = '<x:xmpmeta xmlns:x="adobe:ns:meta/"/>';

/** @param {string} text */
function unescapeXml(text) {
  /** @type {Record<string, string>} */
  const named = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
  return text.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (whole, name) => {
    if (name[0] !== '#') return named[name.toLowerCase()] ?? whole;
    const code = name[1] === 'x' || name[1] === 'X' ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10);
    return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : '';
  });
}

/**
 * The values of one XMP property, written either as an attribute or as an
 * element (plain, or a list of rdf:li). Elements are found with indexOf, so a
 * packet built of unclosed tags takes linear time, not quadratic.
 * @param {string} xmp
 * @param {string} name  With its usual prefix, e.g. "exif:GPSLatitude".
 */
function xmpValues(xmp, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const out = [];
  for (const match of xmp.matchAll(new RegExp(`\\s${escaped}\\s*=\\s*(["'])([^"']*)\\1`, 'g'))) out.push(match[2]);
  const open = new RegExp(`<${escaped}(?=[\\s/>])[^>]*>`, 'g');
  const close = `</${name}>`;
  for (let match = open.exec(xmp); match; match = open.exec(xmp)) {
    if (match[0].endsWith('/>')) continue;
    const end = xmp.indexOf(close, open.lastIndex);
    // No closing tag after this one means none after any later one either.
    if (end === -1) break;
    const inner = xmp.slice(open.lastIndex, end);
    const items = [...inner.matchAll(/<rdf:li(?:\s[^>]*)?>([^<]*)<\/rdf:li>/g)].map((item) => item[1]);
    out.push(...(items.length ? items : [inner]));
    open.lastIndex = end + close.length;
  }
  return out.map((value) => oneLine(unescapeXml(value.replace(/<[^>]*>/g, '')))).filter(Boolean);
}

/**
 * "41,42.906N" or "33,51,35.9S" (CIPA DC-010 §A.2.4.4) → signed degrees.
 * @param {string | undefined} value
 */
function xmpCoordinate(value) {
  const match = /^(\d+(?:\.\d+)?),(\d+(?:\.\d+)?)(?:,(\d+(?:\.\d+)?))?([NSEW])$/i.exec(value?.trim() ?? '');
  if (!match) return null;
  const degrees = Number(match[1]) + Number(match[2]) / 60 + Number(match[3] ?? 0) / 3600;
  return /[SW]/i.test(match[4]) ? -degrees : degrees;
}

/** "5125/10" → 512.5 @param {string | undefined} value */
function xmpRational(value) {
  const match = /^(-?\d+)(?:\/(\d+))?$/.exec(value?.trim() ?? '');
  if (!match || match[2] === '0') return null;
  return Number(match[1]) / Number(match[2] ?? 1);
}

/**
 * Reads XMP: the same kinds of values as EXIF, plus place names and captions.
 * @param {string} xmp
 */
export function parseXmp(xmp) {
  /** @param {...string} names  The first property with a value wins. */
  const first = (...names) => {
    for (const name of names) {
      const [value] = xmpValues(xmp, name);
      if (value) return value;
    }
    return '';
  };
  /** @param {...string} names  All values of all of them. */
  const all = (...names) => joinValues(names.flatMap((name) => xmpValues(xmp, name)));

  const latText = first('exif:GPSLatitude');
  const lonText = first('exif:GPSLongitude');
  const lat = xmpCoordinate(latText);
  const lon = xmpCoordinate(lonText);
  const altitude = xmpRational(first('exif:GPSAltitude'));
  const direction = xmpRational(first('exif:GPSImgDirection'));
  /** @type {Record<string, string>} */
  const fields = {
    camera: device(first('tiff:Make'), first('tiff:Model')),
    lens: first('exifEX:LensModel', 'aux:Lens'),
    serial: first('exifEX:BodySerialNumber', 'aux:SerialNumber'),
    lensSerial: first('exifEX:LensSerialNumber', 'aux:LensSerialNumber'),
    owner: first('exifEX:CameraOwnerName', 'aux:OwnerName'),
    artist: all('dc:creator', 'tiff:Artist', 'exifEX:Photographer'),
    copyright: first('dc:rights'),
    uniqueId: first('exif:ImageUniqueID', 'exifEX:ImageUniqueID'),
    taken: dateTime(first('exif:DateTimeOriginal', 'photoshop:DateCreated', 'xmp:CreateDate')),
    software: first('xmp:CreatorTool'),
    altitude: altitude === null ? '' : String(Math.round(first('exif:GPSAltitudeRef') === '1' ? -altitude : altitude)),
    direction: direction === null ? '' : String(Math.round(direction) % 360),
    caption: first('dc:description'),
    keywords: all('dc:subject'),
    place: all('Iptc4xmpCore:Location', 'photoshop:City', 'photoshop:State', 'photoshop:Country'),
  };
  for (const key of Object.keys(fields)) if (!fields[key]) delete fields[key];
  return {
    fields,
    location: lat !== null && lon !== null && Math.abs(lat) <= 90 && Math.abs(lon) <= 180 && !(lat === 0 && lon === 0) ? { lat, lon } : null,
    // Ultra HDR and other gain-map photos declare the gain map here.
    hdr: xmp.includes('http://ns.adobe.com/hdr-gain-map/1.0/'),
    // Anything beyond an empty packet: editing history, descriptions, tool settings.
    content: xmp.trim() !== '' && xmp.replace(/\s+/g, '') !== EMPTY_XMP.replace(/\s+/g, ''),
    /** The coordinates as written, to search the clean copy for. */
    coordinates: [latText, lonText].filter(Boolean),
  };
}

/**
 * @param {Findings} findings
 * @param {Uint8Array} bytes  The XMP packet.
 */
function reportXmp(findings, bytes) {
  // Real packets are a few kilobytes; a larger one is read in part (and removed whole).
  const xmp = parseXmp(new TextDecoder().decode(bytes.subarray(0, MAX_XMP)));
  if (bytes.length > MAX_XMP) findings.flags.add('xmp');
  findings.location ??= xmp.location;
  findings.secrets.push(...xmp.coordinates);
  addFields(findings, xmp.fields);
  if (xmp.content) findings.flags.add('xmp');
  if (xmp.hdr) findings.flags.add('hdr');
}

/* ---------- Photoshop and IPTC ---------- */

/** IPTC IIM record 2 datasets read by name (IIM 4.2). */
const IIM = { keywords: 25, artist: 80, city: 90, sublocation: 92, province: 95, country: 101, headline: 105, copyright: 116, caption: 120 };

/**
 * Reads an IPTC IIM block.
 * @param {Uint8Array} data
 * @returns {{ fields: Record<string, string>, other: boolean }}
 */
export function parseIim(data) {
  /** @type {Map<number, string[]>} */
  const values = new Map();
  let other = false;
  let i = 0;
  while (i + 5 <= data.length && data[i] === 0x1c) {
    const record = data[i + 1];
    const dataset = data[i + 2];
    const size = (data[i + 3] << 8) | data[i + 4];
    // The high bit marks the rare extended length: stop rather than guess.
    if (size & 0x8000 || i + 5 + size > data.length) break;
    if (record === 2 && dataset !== 0) {
      if (Object.values(IIM).includes(dataset)) values.set(dataset, [...(values.get(dataset) ?? []), decodeText(data.subarray(i + 5, i + 5 + size))]);
      else other = true;
    }
    i += 5 + size;
  }
  const get = (/** @type {number} */ dataset) => values.get(dataset) ?? [];
  /** @type {Record<string, string>} */
  const fields = {
    caption: joinValues(get(IIM.caption).length ? get(IIM.caption) : get(IIM.headline)),
    artist: joinValues(get(IIM.artist)),
    place: joinValues([...get(IIM.sublocation), ...get(IIM.city), ...get(IIM.province), ...get(IIM.country)]),
    copyright: joinValues(get(IIM.copyright)),
    keywords: joinValues(get(IIM.keywords)),
  };
  for (const key of Object.keys(fields)) if (!fields[key]) delete fields[key];
  return { fields, other };
}

/**
 * A JPEG APP13 Photoshop block: image resources ("8BIM"), of which 0x0404 is IPTC.
 * @param {Findings} findings
 * @param {Uint8Array} data  After "Photoshop 3.0\0".
 */
function reportPhotoshop(findings, data) {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let i = 0;
  let read = 0;
  while (i + 12 <= data.length && startsWith(data, i, '8BIM')) {
    const id = view.getUint16(i + 4);
    const nameLength = data[i + 6];
    // The name is a Pascal string padded to an even length.
    const sizeAt = i + 6 + nameLength + 1 + ((nameLength + 1) % 2);
    if (sizeAt + 4 > data.length) break;
    const size = view.getUint32(sizeAt);
    const start = sizeAt + 4;
    if (start + size > data.length) break;
    read += 1;
    if (id === 0x0404) {
      const iptc = parseIim(data.subarray(start, start + size));
      addFields(findings, iptc.fields);
      if (iptc.other) findings.flags.add('iptc');
    } else {
      findings.flags.add('photoshop');
    }
    i = start + size + (size % 2);
  }
  if (read === 0) findings.flags.add('photoshop');
}

/* ---------- Colour profiles (ICC) ---------- */

/**
 * The three profiles photos usually carry, by what they do: colorants (D50) and tone curve. Values read on
 * 2026-11-13 from the profiles macOS ships ("sRGB Profile.icc", "Display P3.icc", "AdobeRGB1998.icc");
 * the sRGB curve is the IEC 61966-2.1 formula, which Display P3 uses too.
 * A profile that matches one of them is replaced with a minimal one written here, so nothing else it says
 * (who made it, when, for which screen) is kept; any other profile is reported by name.
 */
const SRGB_CURVE = [2.4, 1 / 1.055, 0.055 / 1.055, 1 / 12.92, 0.04045];
const STANDARD_PROFILES = /** @type {const} */ ({
  srgb: { name: 'sRGB', colorants: [[0.43607, 0.22249, 0.01392], [0.38515, 0.71687, 0.09708], [0.14307, 0.06061, 0.7141]], curve: SRGB_CURVE },
  p3: { name: 'Display P3', colorants: [[0.51512, 0.2412, -0.00105], [0.29198, 0.69225, 0.04189], [0.1571, 0.06657, 0.78407]], curve: SRGB_CURVE },
  adobe: { name: 'Adobe RGB (1998)', colorants: [[0.60974, 0.31111, 0.01947], [0.20528, 0.62567, 0.06087], [0.14919, 0.06322, 0.74457]], curve: [2.19921875] },
});
/** @typedef {keyof typeof STANDARD_PROFILES} StandardProfile */
/** Bradford adaptation from D65 to D50, as in "Display P3.icc". */
const D65_TO_D50 = [1.04788, 0.02292, -0.0502, 0.02959, 0.99048, -0.01706, -0.00923, 0.01508, 0.75168];
const D50 = [0.9642, 1, 0.8249];

/**
 * A tone curve as a function: a parametric curve (types 0–4) or a 'curv' gamma or table.
 * @param {DataView} view
 * @param {number} at
 * @param {number} size
 * @returns {((x: number) => number) | null}
 */
function iccCurve(view, at, size) {
  if (size < 12) return null;
  const type = view.getUint32(at);
  if (type === 0x63757276) {
    // 'curv': no entries is the identity, one is a gamma, more are a table.
    const count = view.getUint32(at + 8);
    if (count === 0) return (x) => x;
    if (12 + count * 2 > size) return null;
    if (count === 1) return (x) => x ** (view.getUint16(at + 12) / 256);
    return (x) => {
      const position = x * (count - 1);
      const low = Math.floor(position);
      const high = Math.min(low + 1, count - 1);
      return (view.getUint16(at + 12 + low * 2) + (view.getUint16(at + 12 + high * 2) - view.getUint16(at + 12 + low * 2)) * (position - low)) / 65535;
    };
  }
  if (type !== 0x70617261) return null;
  // 'para': g; g a b; g a b c; g a b c d; g a b c d e f (ICC.1:2022 10.18).
  const kind = view.getUint16(at + 8);
  const counts = [1, 3, 4, 5, 7];
  if (kind > 4 || 12 + counts[kind] * 4 > size) return null;
  const [g, a = 1, b = 0, c = 0, d = 0, e = 0, f = 0] = Array.from({ length: counts[kind] }, (_, i) => view.getInt32(at + 12 + i * 4) / 65536);
  if (kind === 0) return (x) => x ** g;
  if (kind === 1) return (x) => (x >= -b / a ? (a * x + b) ** g : 0);
  if (kind === 2) return (x) => (x >= -b / a ? (a * x + b) ** g + c : c);
  if (kind === 3) return (x) => (x >= d ? (a * x + b) ** g : c * x);
  return (x) => (x >= d ? (a * x + b) ** g + e : c * x + f);
}

/**
 * Reads a profile: its name, and which standard profile it is, if any.
 * @param {Uint8Array} profile
 * @returns {{ name: string, standard: StandardProfile | '' }}
 */
export function readProfile(profile) {
  if (profile.length < 132 || !startsWith(profile, 36, 'acsp')) return { name: '', standard: '' };
  const view = new DataView(profile.buffer, profile.byteOffset, profile.byteLength);
  const count = view.getUint32(128);
  /** @type {Map<string, { at: number, size: number }>} */
  const tags = new Map();
  for (let i = 0; i < count && 132 + i * 12 + 12 <= profile.length; i += 1) {
    const at = view.getUint32(136 + i * 12);
    const size = view.getUint32(140 + i * 12);
    if (at + size <= profile.length) tags.set(fourCc(profile, 132 + i * 12), { at, size });
  }
  const desc = tags.get('desc');
  let name = '';
  if (desc && desc.size >= 12 && startsWith(profile, desc.at, 'desc')) {
    // ICC v2: an ASCII description with its length.
    const length = Math.min(view.getUint32(desc.at + 8), desc.size - 12);
    name = decodeText(profile.subarray(desc.at + 12, desc.at + 12 + length).filter((byte) => byte !== 0));
  } else if (desc && desc.size >= 28 && startsWith(profile, desc.at, 'mluc')) {
    // ICC v4: the first of several translations, in UTF-16.
    const length = view.getUint32(desc.at + 20);
    const at = desc.at + view.getUint32(desc.at + 24);
    if (at + length <= desc.at + desc.size) name = new TextDecoder('utf-16be').decode(profile.subarray(at, at + length));
  }
  name = cut(oneLine(name));

  const colorant = (/** @type {string} */ signature) => {
    const tag = tags.get(signature);
    return tag && tag.size >= 20 && startsWith(profile, tag.at, 'XYZ ') ? [0, 1, 2].map((i) => view.getInt32(tag.at + 8 + i * 4) / 65536) : null;
  };
  const colorants = ['rXYZ', 'gXYZ', 'bXYZ'].map(colorant);
  const curves = ['rTRC', 'gTRC', 'bTRC'].map((signature) => {
    const tag = tags.get(signature);
    return tag ? iccCurve(view, tag.at, tag.size) : null;
  });
  // Profiles with lookup tables (A2B0 and the like) are drawn by those, not by the matrix: never "standard".
  const tables = ['A2B0', 'A2B1', 'A2B2', 'B2A0', 'B2A1', 'B2A2', 'D2B0'].some((signature) => tags.has(signature));
  const standard = /** @type {StandardProfile[]} */ (Object.keys(STANDARD_PROFILES)).find((key) => {
    const reference = STANDARD_PROFILES[key];
    const curve = referenceCurve(reference.curve);
    return (
      !tables &&
      colorants.every((values, i) => values && values.every((value, j) => Math.abs(value - reference.colorants[i][j]) < 0.002)) &&
      curves.every((fn) => fn && [0.05, 0.2, 0.5, 0.8, 1].every((x) => Math.abs(fn(x) - curve(x)) < 0.003))
    );
  });
  return { name, standard: standard ?? '' };
}

/** A standard tone curve: a gamma, or the sRGB formula (parametric type 3). @param {readonly number[]} curve @returns {(x: number) => number} */
function referenceCurve(curve) {
  const [g, a = 1, b = 0, c = 0, d = 0] = curve;
  return curve.length === 1 ? (x) => x ** g : (x) => (x >= d ? (a * x + b) ** g : c * x);
}
/** @type {Map<StandardProfile, Uint8Array>} */
const standardProfiles = new Map();

/**
 * A minimal ICC v4 display profile for a standard colour space: header, name, a free-use notice, white point,
 * adaptation, colorants and one shared tone curve. No date, device or maker.
 * @param {StandardProfile} key
 */
export function standardProfile(key) {
  const cached = standardProfiles.get(key);
  if (cached) return cached;
  const { name, colorants, curve } = STANDARD_PROFILES[key];
  /** @param {number} value */
  const s15 = (value) => {
    const out = new Uint8Array(4);
    new DataView(out.buffer).setInt32(0, Math.round(value * 65536));
    return out;
  };
  /** @param {string} text */
  const mluc = (text) => {
    const head = new Uint8Array(28);
    const view = new DataView(head.buffer);
    head.set(ascii('mluc'), 0);
    view.setUint32(8, 1);
    view.setUint32(12, 12);
    head.set(ascii('enUS'), 16);
    view.setUint32(20, text.length * 2);
    view.setUint32(24, 28);
    const body = new Uint8Array(text.length * 2);
    for (let i = 0; i < text.length; i += 1) new DataView(body.buffer).setUint16(i * 2, text.charCodeAt(i));
    return concat([head, body]);
  };
  /** @param {string} type @param {number[]} values */
  const numbers = (type, values) => concat([ascii(type), new Uint8Array(4), ...values.map(s15)]);
  // A plain gamma as a 'curv' (ColorSync draws it exactly as Apple's Adobe RGB profile; a parametric gamma differs
  // by up to 7 of 255, checked 2026-11-13 with sips); the sRGB formula as a parametric curve, as "Display P3.icc" has it.
  const tone =
    curve.length === 1
      ? concat([ascii('curv'), new Uint8Array(4), Uint8Array.of(0, 0, 0, 1, Math.round(curve[0] * 256) >> 8, Math.round(curve[0] * 256) & 0xff)])
      : concat([ascii('para'), new Uint8Array(4), Uint8Array.of(0, 3, 0, 0), ...curve.map(s15)]);
  /** @type {[string, Uint8Array][]} */
  const parts = [
    ['desc', mluc(name)],
    ['cprt', mluc('No copyright, use freely')],
    ['wtpt', numbers('XYZ ', D50)],
    ['chad', numbers('sf32', D65_TO_D50)],
    ['rXYZ', numbers('XYZ ', [...colorants[0]])],
    ['gXYZ', numbers('XYZ ', [...colorants[1]])],
    ['bXYZ', numbers('XYZ ', [...colorants[2]])],
    ['rTRC', tone],
  ];
  const tableSize = 4 + (parts.length + 2) * 12;
  let at = 128 + tableSize;
  const table = new DataView(new ArrayBuffer(tableSize));
  table.setUint32(0, parts.length + 2);
  /** @type {Uint8Array[]} */
  const data = [];
  parts.forEach(([signature, body], i) => {
    new Uint8Array(table.buffer).set(ascii(signature), 4 + i * 12);
    table.setUint32(8 + i * 12, at);
    table.setUint32(12 + i * 12, body.length);
    if (signature === 'rTRC') {
      // Green and blue use the same curve.
      for (const [n, other] of /** @type {const} */ ([[parts.length, 'gTRC'], [parts.length + 1, 'bTRC']])) {
        new Uint8Array(table.buffer).set(ascii(other), 4 + n * 12);
        table.setUint32(8 + n * 12, at);
        table.setUint32(12 + n * 12, body.length);
      }
    }
    const padded = new Uint8Array(Math.ceil(body.length / 4) * 4);
    padded.set(body);
    data.push(padded);
    at += padded.length;
  });
  const header = new DataView(new ArrayBuffer(128));
  header.setUint32(0, at);
  header.setUint32(8, 0x04000000);
  new Uint8Array(header.buffer).set(ascii('mntrRGB XYZ '), 12);
  new Uint8Array(header.buffer).set(ascii('acsp'), 36);
  D50.forEach((value, i) => header.setInt32(68 + i * 4, Math.round(value * 65536)));
  const profile = concat([new Uint8Array(header.buffer), new Uint8Array(table.buffer), ...data]);
  standardProfiles.set(key, profile);
  return profile;
}

/**
 * What the clean copy does with a profile: keeps it, puts a standard one in its place, or leaves it out.
 * @param {Findings} findings
 * @param {Set<Kept>} kept
 * @param {Uint8Array | null} profile  null when it couldn't be read (a PNG profile the browser can't inflate).
 * @param {string} fallbackName  The name to show when the profile has none.
 * @param {Options} options
 * @returns {{ action: 'keep' | 'drop' } | { action: 'standard', key: StandardProfile }}
 */
function decideProfile(findings, kept, profile, fallbackName, options) {
  const { name, standard } = profile ? readProfile(profile) : { name: '', standard: /** @type {''} */ ('') };
  if (standard) return { action: 'standard', key: standard };
  // "" when it has no name: the page then says so in words.
  findings.fields.profile ??= name || oneLine(fallbackName);
  if (options.dropProfile) return { action: 'drop' };
  kept.add('profile');
  return { action: 'keep' };
}

/* ---------- JPEG ---------- */

const JPEG = { soi: 0xd8, eoi: 0xd9, sos: 0xda, com: 0xfe, app0: 0xe0, app1: 0xe1, app2: 0xe2, app11: 0xeb, app13: 0xed, app14: 0xee, app15: 0xef };

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
 * @param {Uint8Array} bytes
 * @param {number} start
 * @param {number} end
 * @param {string} text  ASCII.
 */
function contains(bytes, start, end, text) {
  for (let i = start; i + text.length <= end; i += 1) if (startsWith(bytes, i, text)) return true;
  return false;
}

const XMP_JPEG = 'http://ns.adobe.com/xap/1.0/\0';

/**
 * Markers that describe or hold the picture, kept as they are: frame headers (SOF0–15 but 4, 8 and 12),
 * Huffman and arithmetic-coding tables, quantisation tables, restart interval, number of lines, and the scans
 * (ITU T.81 Table B.1). Everything else is metadata, or something this tool doesn't know, and is left out.
 */
const JPEG_KEEP = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf, 0xc4, 0xcc, 0xdb, 0xdc, 0xdd, JPEG.sos]);
/** The Adobe segment says how colours are stored (RGB or YCbCr): "Adobe", version, two flag words, transform. */
const ADOBE_LENGTH = 2 + 12;
/** A colour profile is split over APP2 segments of at most this many bytes after their header. */
const ICC_CHUNK = 65519;

/**
 * The JFIF header in its fixed 16-byte form: version, units and pixel density kept, any thumbnail left out.
 * @param {Uint8Array} data  After "JFIF\0".
 * @returns {{ segment: Uint8Array, thumbnail: boolean } | null}
 */
function plainJfif(data) {
  if (data.length < 9) return null;
  return { segment: concat([Uint8Array.of(0xff, JPEG.app0, 0, 16), ascii('JFIF\0'), data.subarray(0, 7), Uint8Array.of(0, 0)]), thumbnail: data.length > 9 || data[7] * data[8] > 0 };
}

/** @param {Uint8Array} profile */
function iccSegments(profile) {
  const count = Math.ceil(profile.length / ICC_CHUNK);
  return Array.from({ length: count }, (_, i) => {
    const part = profile.subarray(i * ICC_CHUNK, (i + 1) * ICC_CHUNK);
    const length = 2 + 14 + part.length;
    return concat([Uint8Array.of(0xff, JPEG.app2, length >> 8, length & 0xff), ascii('ICC_PROFILE\0'), Uint8Array.of(i + 1, count), part]);
  });
}

/**
 * @param {Uint8Array<ArrayBuffer>} bytes
 * @param {Options} options
 * @returns {Omit<PhotoReport, 'verified'>}
 */
function inspectJpeg(bytes, options) {
  const findings = emptyFindings();
  /** @type {Set<Kept>} */
  const kept = new Set();
  const { segments, end } = jpegSegments(bytes);
  /** @type {Uint8Array[]} */
  const body = [];
  /** @type {Uint8Array | null} */
  let jfif = null;
  /** @type {number | null} */
  let orientation = null;
  /** @type {Uint8Array[]} */
  const iccParts = [];
  /** @type {Uint8Array[]} */
  const iccOriginal = [];
  let iccTotal = 0;
  let iccBroken = false;

  for (const { marker, start, end: segmentEnd } of segments) {
    const data = start + 4;
    if (JPEG_KEEP.has(marker)) {
      body.push(bytes.subarray(start, segmentEnd));
    } else if (marker === JPEG.app0 && startsWith(bytes, data, 'JFIF\0') && !jfif) {
      const plain = plainJfif(bytes.subarray(data + 5, segmentEnd));
      if (plain) {
        jfif = plain.segment;
        if (plain.thumbnail) findings.flags.add('thumbnail');
      } else findings.flags.add('other');
    } else if (marker === JPEG.app0 && startsWith(bytes, data, 'JFXX\0')) {
      findings.flags.add('thumbnail');
    } else if (marker === JPEG.app2 && startsWith(bytes, data, 'ICC_PROFILE\0') && segmentEnd - data >= 14) {
      // Pieces are numbered 1 to n of n; a number used twice, or totals that disagree, leave no profile to read.
      const [number, total] = [bytes[data + 12], bytes[data + 13]];
      if (iccParts[number] || number < 1 || number > total || (iccTotal && total !== iccTotal)) iccBroken = true;
      iccTotal = total;
      iccParts[number] = bytes.subarray(data + 14, segmentEnd);
      iccOriginal.push(bytes.subarray(start, segmentEnd));
    } else if (marker === JPEG.app14 && startsWith(bytes, data, 'Adobe') && segmentEnd - start === 2 + ADOBE_LENGTH) {
      body.push(bytes.subarray(start, segmentEnd)); // Colour information: without it the picture can look different.
    } else if (marker === JPEG.app1 && startsWith(bytes, data, 'Exif\0\0')) {
      const exif = parseExif(bytes.subarray(data + 6, segmentEnd));
      reportExif(findings, exif);
      // Readers use the first EXIF block: its rotation is the one the picture is shown with.
      if (exif) orientation ??= exif.orientation;
    } else if (marker === JPEG.app1 && startsWith(bytes, data, XMP_JPEG)) {
      reportXmp(findings, bytes.subarray(data + XMP_JPEG.length, segmentEnd));
    } else if (marker === JPEG.app1 && startsWith(bytes, data, 'http://ns.adobe.com/')) {
      findings.flags.add('xmp'); // Extended XMP: the rest of a packet too large for one segment.
    } else if (marker === JPEG.app13 && startsWith(bytes, data, 'Photoshop 3.0\0')) {
      reportPhotoshop(findings, bytes.subarray(data + 14, segmentEnd));
    } else if (marker === JPEG.app11 && contains(bytes, data, segmentEnd, 'c2pa')) {
      findings.flags.add('c2pa');
    } else if (marker === JPEG.com) {
      findings.flags.add('comment');
    } else {
      findings.flags.add('other');
    }
  }
  if (end < bytes.length) findings.flags.add('trailing');

  /** @type {Uint8Array[]} */
  const head = [Uint8Array.of(0xff, JPEG.soi)];
  // JFIF, when present, has to come first.
  if (jfif) head.push(jfif);
  if (orientation && orientation !== 1) head.push(exifSegment(orientationTiff(orientation)));
  if (iccOriginal.length) {
    const complete = !iccBroken && iccParts.length === iccTotal + 1 && iccParts.slice(1).every(Boolean) ? concat(iccParts.slice(1)) : null;
    const choice = decideProfile(findings, kept, complete, '', options);
    if (choice.action === 'standard') head.push(...iccSegments(standardProfile(choice.key)));
    if (choice.action === 'keep') head.push(...iccOriginal);
  }
  return { type: 'jpeg', findings, kept, orientation: orientation ?? 1, clean: concat([...head, ...body, Uint8Array.of(0xff, JPEG.eoi)]) };
}

/** @param {Uint8Array} tiff */
function exifSegment(tiff) {
  const length = 2 + 6 + tiff.length;
  return concat([Uint8Array.of(0xff, JPEG.app1, length >> 8, length & 0xff), ascii('Exif\0\0'), tiff]);
}

/* ---------- PNG ---------- */

/** Chunks needed to draw the picture (including animation and colour). Everything else is dropped. */
const PNG_KEEP = new Set(['IHDR', 'PLTE', 'IDAT', 'IEND', 'tRNS', 'gAMA', 'cHRM', 'sRGB', 'iCCP', 'sBIT', 'bKGD', 'pHYs', 'cICP', 'acTL', 'fcTL', 'fdAT']);
/** Longest text shown per note; AI tools can store whole workflows. */
const MAX_TEXT = 600;
/** Most notes listed; the rest are counted. */
const MAX_TEXTS = 50;
const XMP_PNG = 'XML:com.adobe.xmp';

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
 * A text chunk (PNG 3rd edition §11.3.3): its keyword and, unless compressed, its text.
 * @param {Findings} findings
 * @param {string} type  tEXt, zTXt or iTXt.
 * @param {Uint8Array} data
 */
function reportPngText(findings, type, data) {
  const keyEnd = data.indexOf(0);
  const key = oneLine(new TextDecoder('latin1').decode(keyEnd === -1 ? data : data.subarray(0, keyEnd)));
  /** @type {Uint8Array | null} */
  let body = null;
  let utf8 = false;
  if (keyEnd !== -1 && type === 'tEXt') body = data.subarray(keyEnd + 1);
  if (keyEnd !== -1 && type === 'iTXt' && data[keyEnd + 1] === 0) {
    // Not compressed: skip the method, then the language tag and the translated keyword (each ends with 0).
    const language = data.indexOf(0, keyEnd + 3);
    const translated = language === -1 ? -1 : data.indexOf(0, language + 1);
    if (translated !== -1) body = data.subarray(translated + 1);
    utf8 = true;
  }
  if (key === XMP_PNG) {
    if (body) reportXmp(findings, body);
    else findings.flags.add('xmp');
    return;
  }
  if (findings.texts.length >= MAX_TEXTS) {
    findings.moreTexts += 1;
    return;
  }
  if (!body) {
    findings.texts.push({ key, text: null, cut: false });
    return;
  }
  const text = new TextDecoder(utf8 ? 'utf-8' : 'latin1').decode(body).replace(CONTROL, ' ').trim();
  findings.texts.push({ key, text: text.slice(0, MAX_TEXT), cut: text.length > MAX_TEXT });
}

/**
 * Inflates zlib data with the browser's own decompressor.
 * @param {Uint8Array} data
 * @returns {Promise<Uint8Array | null>}  null when the browser can't or the data is damaged.
 */
async function inflate(data) {
  if (typeof DecompressionStream !== 'function') return null;
  try {
    const stream = new Blob([/** @type {Uint8Array<ArrayBuffer>} */ (data)]).stream().pipeThrough(new DecompressionStream('deflate'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  } catch {
    return null;
  }
}

/** zlib data in one stored (uncompressed) block: a few hundred bytes of profile need no compression (RFC 1950, 1951). @param {Uint8Array} data */
function storedZlib(data) {
  let a = 1;
  let b = 0;
  for (const byte of data) {
    a = (a + byte) % 65521;
    b = (b + a) % 65521;
  }
  const head = Uint8Array.of(0x78, 0x01, 0x01, data.length & 0xff, data.length >> 8, ~data.length & 0xff, (~data.length >> 8) & 0xff);
  const adler = new Uint8Array(4);
  new DataView(adler.buffer).setUint32(0, ((b << 16) | a) >>> 0);
  return concat([head, data, adler]);
}

/**
 * @param {Uint8Array<ArrayBuffer>} bytes
 * @param {Options} options
 * @returns {Promise<Omit<PhotoReport, 'verified'>>}
 */
async function inspectPng(bytes, options) {
  const findings = emptyFindings();
  /** @type {Set<Kept>} */
  const kept = new Set();
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  /** @type {Uint8Array[]} */
  const out = [bytes.subarray(0, 8)];
  /** @type {number | null} */
  let orientation = null;
  /** Where the image data starts in `out`; the rotation has to go before it. */
  let imageAt = -1;
  let srgb = false;
  let i = 8;

  while (i + 12 <= bytes.length) {
    const length = view.getUint32(i);
    const end = i + 12 + length;
    if (end > bytes.length) throw new PhotoError('damaged');
    const type = fourCc(bytes, i + 4);
    const data = bytes.subarray(i + 8, i + 8 + length);
    // The header comes first (PNG 3rd edition §5.6); Apple's CgBI chunk before it marks a PNG only Apple's code can draw.
    if (type === 'CgBI') throw new PhotoError('optimised');
    if (i === 8 && type !== 'IHDR') throw new PhotoError('damaged');

    if (type === 'eXIf') {
      const exif = parseExif(data);
      reportExif(findings, exif);
      if (exif) orientation ??= exif.orientation;
    } else if (type === 'tEXt' || type === 'zTXt' || type === 'iTXt') {
      reportPngText(findings, type, data);
    } else if (type === 'caBX') {
      findings.flags.add('c2pa');
    } else if (type === 'iCCP') {
      const nameEnd = data.indexOf(0);
      const profile = nameEnd === -1 ? null : await inflate(data.subarray(nameEnd + 2));
      const choice = decideProfile(findings, kept, profile, decodeText(nameEnd === -1 ? data : data.subarray(0, nameEnd)), options);
      // sRGB has a chunk of its own (one byte: the rendering intent); the others get the standard profile.
      if (choice.action === 'standard' && choice.key === 'srgb') srgb = true;
      else if (choice.action === 'standard') out.push(pngChunk('iCCP', concat([ascii(`${STANDARD_PROFILES[choice.key].name}\0\0`), storedZlib(standardProfile(choice.key))])));
      else if (choice.action === 'keep') out.push(bytes.subarray(i, end));
    } else if (!PNG_KEEP.has(type)) {
      findings.flags.add('other');
    }

    if (type === 'IDAT' && imageAt === -1) imageAt = out.length;
    if (type === 'IEND') {
      if (imageAt === -1) throw new PhotoError('damaged');
      if (end < bytes.length) findings.flags.add('trailing');
      out.push(bytes.subarray(i, end));
      // Readers (Apple's, for one) only honour the rotation when it comes before the image data.
      if (orientation && orientation !== 1) out.splice(imageAt, 0, pngChunk('eXIf', orientationTiff(orientation)));
      if (srgb && !out.some((part) => fourCc(part, 4) === 'sRGB')) out.splice(2, 0, pngChunk('sRGB', Uint8Array.of(0)));
      return { type: 'png', findings, kept, orientation: orientation ?? 1, clean: concat(out) };
    }
    if (PNG_KEEP.has(type) && type !== 'iCCP') out.push(bytes.subarray(i, end));
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

/** Chunks inside an animation frame (ANMF) that draw it. */
const WEBP_FRAME_KEEP = new Set(['ALPH', 'VP8 ', 'VP8L']);
const WEBP_ICC_FLAG = 0x20;
const WEBP_ALPHA_FLAG = 0x10;

/**
 * The chunks of a WebP (or of an animation frame) between `start` and `end`.
 * @param {Uint8Array} bytes @param {number} start @param {number} end
 * @returns {{ type: string, start: number, data: number, length: number, end: number }[]}
 */
function riffChunks(bytes, start, end) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const out = [];
  let i = start;
  while (i + 8 <= end) {
    const length = view.getUint32(i + 4, true);
    if (i + 8 + length > end) throw new PhotoError('damaged');
    out.push({ type: fourCc(bytes, i), start: i, data: i + 8, length, end: Math.min(i + 8 + length + (length % 2), end) });
    i = out[out.length - 1].end;
  }
  return out;
}

/**
 * The canvas of a simple WebP, from its image data: lossy (VP8 frame header) or lossless (VP8L header).
 * @param {Uint8Array} bytes
 * @param {{ type: string, data: number, length: number }} image
 * @returns {{ width: number, height: number, alpha: boolean } | null}
 */
function webpCanvas(bytes, image) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const at = image.data;
  if (image.type === 'VP8 ' && image.length >= 10 && bytes[at + 3] === 0x9d && bytes[at + 4] === 0x01 && bytes[at + 5] === 0x2a) {
    return { width: view.getUint16(at + 6, true) & 0x3fff, height: view.getUint16(at + 8, true) & 0x3fff, alpha: false };
  }
  if (image.type === 'VP8L' && image.length >= 5 && bytes[at] === 0x2f) {
    const bits = view.getUint32(at + 1, true);
    return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1, alpha: Boolean((bits >>> 28) & 1) };
  }
  return null;
}

/**
 * @param {Uint8Array<ArrayBuffer>} bytes
 * @param {Options} options
 * @returns {Omit<PhotoReport, 'verified'>}
 */
function inspectWebp(bytes, options) {
  const findings = emptyFindings();
  /** @type {Set<Kept>} */
  const kept = new Set();
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const riffEnd = 8 + view.getUint32(4, true);
  if (riffEnd > bytes.length) throw new PhotoError('damaged');
  if (riffEnd < bytes.length) findings.flags.add('trailing');

  const chunks = riffChunks(bytes, 12, riffEnd);
  // The extended header, when there is one, is the first chunk (WebP container spec): anything else is not a WebP readers agree on.
  if (chunks.some((chunk, index) => chunk.type === 'VP8X' && (index !== 0 || chunk.length < 10))) throw new PhotoError('damaged');
  /** A copy of the header: the original file is never written to. */
  const header = chunks[0]?.type === 'VP8X' ? bytes.slice(chunks[0].start, chunks[0].end) : null;
  /** @type {Uint8Array[]} */
  const out = [];
  /** @type {number | null} */
  let orientation = null;
  let profile = false;

  /** @param {{ type: string, start: number, data: number, length: number }} chunk */
  const metadata = (chunk) => {
    if (chunk.type === 'EXIF') {
      // Some writers repeat the JPEG-style "Exif\0\0" prefix.
      const start = startsWith(bytes, chunk.data, 'Exif\0\0') ? chunk.data + 6 : chunk.data;
      const exif = parseExif(bytes.subarray(start, chunk.data + chunk.length));
      reportExif(findings, exif);
      if (exif) orientation ??= exif.orientation;
    } else if (chunk.type === 'XMP ') {
      reportXmp(findings, bytes.subarray(chunk.data, chunk.data + chunk.length));
    } else if (chunk.type === 'C2PA') {
      findings.flags.add('c2pa');
    } else {
      findings.flags.add('other');
    }
  };

  for (const chunk of chunks) {
    if (chunk.type === 'VP8X') {
      out.push(/** @type {Uint8Array} */ (header));
    } else if (chunk.type === 'ICCP') {
      const choice = decideProfile(findings, kept, bytes.subarray(chunk.data, chunk.data + chunk.length), '', options);
      if (choice.action === 'standard') out.push(webpChunk('ICCP', standardProfile(choice.key)));
      if (choice.action === 'keep') out.push(bytes.subarray(chunk.start, chunk.end));
      profile ||= choice.action !== 'drop';
    } else if (chunk.type === 'ANMF') {
      // An animation frame: a 16-byte frame header, then its own chunks, which are walked with the same rules.
      if (chunk.length < 16) throw new PhotoError('damaged');
      const inner = riffChunks(bytes, chunk.data + 16, chunk.data + chunk.length);
      for (const part of inner) if (!WEBP_FRAME_KEEP.has(part.type)) metadata(part);
      out.push(webpChunk('ANMF', concat([bytes.subarray(chunk.data, chunk.data + 16), ...inner.filter((part) => WEBP_FRAME_KEEP.has(part.type)).map((part) => bytes.subarray(part.start, part.end))])));
    } else if (WEBP_KEEP.has(chunk.type)) {
      out.push(bytes.subarray(chunk.start, chunk.end));
    } else {
      metadata(chunk);
    }
  }
  if (!out.some((part) => /^VP8[ L]$/.test(fourCc(part, 0)) || fourCc(part, 0) === 'ANMF')) throw new PhotoError('damaged');

  let flags = header ?? null;
  // EXIF comes after the image data, so the rotation is only known once every chunk was read. A simple WebP has no
  // header to announce it: one is added, with the canvas size read from the image data.
  if (!flags && orientation && orientation !== 1) {
    const image = chunks.find((chunk) => chunk.type === 'VP8 ' || chunk.type === 'VP8L');
    const canvas = image ? webpCanvas(bytes, image) : null;
    if (canvas) {
      const data = new Uint8Array(10);
      data[0] = canvas.alpha ? WEBP_ALPHA_FLAG : 0;
      const view10 = new DataView(data.buffer);
      view10.setUint16(4, (canvas.width - 1) & 0xffff, true);
      data[6] = (canvas.width - 1) >> 16;
      view10.setUint16(7, (canvas.height - 1) & 0xffff, true);
      data[9] = (canvas.height - 1) >> 16;
      flags = webpChunk('VP8X', data);
      out.unshift(flags);
    }
  }
  if (flags) {
    flags[8] &= ~(WEBP_EXIF_FLAG | WEBP_XMP_FLAG | WEBP_ICC_FLAG);
    if (profile) flags[8] |= WEBP_ICC_FLAG;
    if (orientation && orientation !== 1) {
      flags[8] |= WEBP_EXIF_FLAG;
      out.push(webpChunk('EXIF', orientationTiff(orientation)));
    }
  }

  const body = concat(out);
  const riff = new Uint8Array(12);
  riff.set(ascii('RIFF'), 0);
  new DataView(riff.buffer).setUint32(4, 4 + body.length, true);
  riff.set(ascii('WEBP'), 8);
  return { type: 'webp', findings, kept, orientation: orientation ?? 1, clean: concat([riff, body]) };
}

/* ---------- HEIC and AVIF (ISO base media file format) ---------- */

/** The top-level box that carries C2PA content credentials in HEIF and AVIF (C2PA 2.2, A.5). */
const C2PA_UUID = 'd8fec3d61b0e483c92975828877ec481';

/**
 * @typedef {{ type: string, start: number, data: number, end: number }} Box
 */

/**
 * The boxes between `start` and `end`.
 * @param {Uint8Array} bytes
 * @param {number} start
 * @param {number} end
 * @returns {Box[]}
 */
function readBoxes(bytes, start, end) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const damaged = () => new PhotoError('damaged');
  /** @type {Box[]} */
  const out = [];
  let i = start;
  while (i < end) {
    if (i + 8 > end) throw damaged();
    let size = view.getUint32(i);
    let header = 8;
    if (size === 1) {
      // A 64-bit size; photos never come near 4 GB, so the high half must be 0.
      if (i + 16 > end || view.getUint32(i + 8) !== 0) throw damaged();
      size = view.getUint32(i + 12);
      header = 16;
    } else if (size === 0) {
      size = end - i;
    }
    if (size < header || i + size > end) throw damaged();
    out.push({ type: fourCc(bytes, i + 4), start: i, data: i + header, end: i + size });
    i += size;
  }
  return out;
}

/**
 * A cursor over a box's fields, which throws "damaged" instead of reading past the box.
 * @param {Uint8Array} bytes
 * @param {number} at
 * @param {number} end
 */
function reader(bytes, at, end) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let i = at;
  /** @param {number} size */
  const need = (size) => {
    if (i + size > end) throw new PhotoError('damaged');
  };
  return {
    get at() {
      return i;
    },
    u8() {
      need(1);
      return bytes[i++];
    },
    u16() {
      need(2);
      i += 2;
      return view.getUint16(i - 2);
    },
    u32() {
      need(4);
      i += 4;
      return view.getUint32(i - 4);
    },
    /** An unsigned number of 0, 4 or 8 bytes (iloc field sizes). @param {number} size */
    sized(size) {
      if (size === 0) return 0;
      if (size === 4) return this.u32();
      if (size === 8) {
        const high = this.u32();
        const low = this.u32();
        if (high > 0x1fffff) throw new PhotoError('damaged');
        return high * 2 ** 32 + low;
      }
      throw new PhotoError('damaged');
    },
    fourCc() {
      need(4);
      i += 4;
      return fourCc(bytes, i - 4);
    },
    /** Text up to a 0 byte (or the end). */
    string() {
      const stop = bytes.indexOf(0, i);
      const last = stop === -1 || stop > end ? end : stop;
      const text = new TextDecoder().decode(bytes.subarray(i, last));
      i = Math.min(last + 1, end);
      return text;
    },
  };
}

/**
 * @typedef {object} Item
 * @property {number} id
 * @property {string} type  e.g. 'hvc1', 'av01', 'Exif', 'mime'.
 * @property {string} contentType
 * @property {string} encoding
 * @property {{ offset: number, length: number }[] | null} extents  Absolute positions; null when stored in a way this tool doesn't follow.
 * @property {boolean} toEnd  An extent was written with length 0, "to the end of the file".
 * @property {{ start: number, nameEnd: number, end: number }} label  Where the item's name starts and ends (its 0 byte), and where its box ends.
 */

/**
 * Items of a HEIF meta box: their type (iinf) and where their bytes are (iloc).
 * Box layouts: libheif box.cc and libavif read.c (docs/research/tool-photo-metadata.md).
 * @param {Uint8Array} bytes
 * @param {Box} meta
 */
function heifItems(bytes, meta) {
  const children = readBoxes(bytes, meta.data + 4, meta.end);
  const find = (/** @type {string} */ type) => children.find((child) => child.type === type);

  /** @type {Map<number, Item>} */
  const items = new Map();
  const iinf = find('iinf');
  if (iinf) {
    const head = reader(bytes, iinf.data, iinf.end);
    const version = head.u8();
    head.u8(), head.u16(); // flags
    if (version === 0) head.u16();
    else head.u32();
    for (const infe of readBoxes(bytes, head.at, iinf.end)) {
      if (infe.type !== 'infe') continue;
      const field = reader(bytes, infe.data, infe.end);
      const infeVersion = field.u8();
      field.u8(), field.u16();
      // Versions 0 and 1 predate item types; such files have no metadata items to find.
      if (infeVersion < 2) continue;
      const id = infeVersion === 2 ? field.u16() : field.u32();
      field.u16(); // protection index
      const type = field.fourCc();
      const nameAt = field.at;
      field.string(); // name
      const terminator = bytes.indexOf(0, nameAt);
      const nameEnd = terminator === -1 || terminator > infe.end ? infe.end : terminator;
      const contentType = type === 'mime' ? field.string() : '';
      const encoding = type === 'mime' && field.at < infe.end ? field.string() : '';
      items.set(id, { id, type, contentType, encoding, extents: null, toEnd: false, label: { start: nameAt, nameEnd, end: infe.end } });
    }
  }

  const idat = find('idat');
  const iloc = find('iloc');
  if (iloc) {
    const field = reader(bytes, iloc.data, iloc.end);
    const version = field.u8();
    field.u8(), field.u16();
    const sizes = field.u8();
    const more = field.u8();
    const [offsetSize, lengthSize, baseSize, indexSize] = [sizes >> 4, sizes & 15, more >> 4, version >= 1 ? more & 15 : 0];
    const count = version < 2 ? field.u16() : field.u32();
    for (let n = 0; n < count; n += 1) {
      const id = version < 2 ? field.u16() : field.u32();
      const method = version >= 1 ? field.u16() & 15 : 0;
      field.u16(); // data reference index
      const base = field.sized(baseSize);
      const extentCount = field.u16();
      /** @type {{ offset: number, length: number }[] | null} */
      let extents = [];
      let toEnd = false;
      for (let e = 0; e < extentCount; e += 1) {
        field.sized(indexSize);
        const offset = base + field.sized(offsetSize);
        const length = field.sized(lengthSize);
        // 0: the file itself; 1: inside idat; 2 (offsets into another item) isn't followed.
        const [origin, limit] = method === 0 ? [0, bytes.length] : method === 1 && idat ? [idat.data, idat.end] : [-1, -1];
        if (origin === -1) {
          extents = null;
          continue;
        }
        const from = origin + offset;
        if (length === 0) toEnd = true;
        const size = length === 0 ? limit - from : length;
        if (from < origin || from + size > limit) throw new PhotoError('damaged');
        extents?.push({ offset: from, length: size });
      }
      const item = items.get(id);
      if (item) Object.assign(item, { extents, toEnd });
    }
  }

  /** Items that are thumbnails of another (iref 'thmb'), and auxiliary pictures: depth maps, mattes, gain maps ('auxl'). */
  const thumbnails = new Set();
  const auxiliary = new Set();
  const iref = find('iref');
  if (iref) {
    const version = bytes[iref.data];
    for (const reference of readBoxes(bytes, iref.data + 4, iref.end)) {
      if (reference.type !== 'thmb' && reference.type !== 'auxl') continue;
      const field = reader(bytes, reference.data, reference.end);
      (reference.type === 'thmb' ? thumbnails : auxiliary).add(version === 0 ? field.u16() : field.u32());
    }
  }
  return { items: [...items.values()], thumbnails, auxiliary, children };
}

/** @param {Uint8Array} bytes @param {{ offset: number, length: number }[]} extents */
const itemBytes = (bytes, extents) => concat(extents.map(({ offset, length }) => bytes.subarray(offset, offset + length)));

/**
 * Writes an item's new bytes over its old ones (same length).
 * @param {Uint8Array} target
 * @param {{ offset: number, length: number }[]} extents
 * @param {Uint8Array} data
 */
function writeItem(target, extents, data) {
  let from = 0;
  for (const { offset, length } of extents) {
    target.set(data.subarray(from, from + length), offset);
    from += length;
  }
}

/**
 * An EXIF item with the TIFF replaced by an empty one of the same byte order,
 * followed by zeros. The offset field stays, and the TIFF header stays where
 * it points: readers reject an EXIF item without one there.
 * @param {Uint8Array} payload
 * @returns {Uint8Array | null}  null when the item is too short to hold an empty TIFF.
 */
function blankExif(payload) {
  if (payload.length < 4) return null;
  const tiffAt = 4 + new DataView(payload.buffer, payload.byteOffset, payload.byteLength).getUint32(0);
  if (tiffAt + 14 > payload.length) return null;
  const little = payload[tiffAt] === 0x49 && payload[tiffAt + 1] === 0x49;
  const out = payload.slice();
  // Whatever sits between the offset field and the TIFF header goes too.
  out.fill(0, 4);
  out.set(little ? [0x49, 0x49, 42, 0, 8, 0, 0, 0] : [0x4d, 0x4d, 0, 42, 0, 0, 0, 8], tiffAt);
  return out;
}

/** Top-level boxes a still picture needs (ISO/IEC 23008-12); 'moov' carries an image sequence and is left in. */
const HEIF_TOP = new Set(['ftyp', 'meta', 'mdat', 'moov', 'free', 'skip']);
/** Boxes inside 'meta' that describe the pictures. */
const HEIF_META = new Set(['hdlr', 'pitm', 'iloc', 'iinf', 'iref', 'iprp', 'idat', 'dinf', 'grpl', 'free', 'skip']);
/** Item types that are pictures, or build one from others (grid, overlay, tone map). */
const HEIF_PICTURES = new Set(['hvc1', 'hev1', 'av01', 'avc1', 'jpeg', 'j2k1', 'unci', 'grid', 'iovl', 'iden', 'tmap', 'mski']);

/**
 * Turns a box into an empty 'free' box of the same size: what it held is gone, and every offset after it stays valid.
 * @param {Uint8Array} target @param {Box} box
 */
function freeBox(target, box) {
  target.set(ascii('free'), box.start + 4);
  target.fill(0, box.data, box.end);
}

/** True when two lists of extents share a byte. @param {{ offset: number, length: number }[]} a @param {{ offset: number, length: number }[]} b */
const overlaps = (a, b) => a.some((x) => b.some((y) => x.offset < y.offset + y.length && y.offset < x.offset + x.length));

/**
 * @param {Uint8Array<ArrayBuffer>} bytes
 * @param {'heic' | 'avif'} type
 * @returns {Omit<PhotoReport, 'verified'>}
 */
function inspectHeif(bytes, type) {
  const findings = emptyFindings();
  /** @type {Set<Kept>} */
  const kept = new Set();
  const top = readBoxes(bytes, 0, bytes.length);
  if (top[0]?.type !== 'ftyp') throw new PhotoError('damaged');
  // SlimHEIF keeps its metadata in a 'mini' box this tool doesn't read.
  if (brands(bytes).includes('mif3') || top.some((box) => box.type === 'mini')) throw new PhotoError('compact');
  const meta = top.find((box) => box.type === 'meta');
  if (!meta) throw new PhotoError('damaged');

  /** @type {Uint8Array<ArrayBuffer> | null} */
  let clean = bytes.slice();
  /** @param {Kept & Flag} flag */
  const leave = (flag) => {
    findings.flags.add(flag);
    kept.add(flag);
  };
  /** @param {Box} box */
  const isZero = (box) => bytes.subarray(box.data, box.end).every((byte) => byte === 0);
  for (const box of top) {
    if (box.type === 'moov') leave('other'); // An image sequence: the pictures themselves.
    else if (HEIF_TOP.has(box.type) && !((box.type === 'free' || box.type === 'skip') && !isZero(box))) continue;
    else {
      // A motion photo's video, XMP or content credentials in a 'uuid' box, user data, maker boxes: all cut.
      findings.flags.add(box.type === 'uuid' && [...bytes.subarray(box.data, box.data + 16)].map((byte) => byte.toString(16).padStart(2, '0')).join('') === C2PA_UUID ? 'c2pa' : 'other');
      freeBox(clean, box);
    }
  }

  const { items, thumbnails, auxiliary, children } = heifItems(bytes, meta);
  for (const child of children) {
    if (HEIF_META.has(child.type) && !((child.type === 'free' || child.type === 'skip') && !isZero(child))) continue;
    findings.flags.add('other');
    freeBox(clean, child);
  }
  const pictures = items.filter((item) => HEIF_PICTURES.has(item.type));
  for (const item of items) {
    if (thumbnails.has(item.id)) leave('thumbnail');
    if (auxiliary.has(item.id)) {
      findings.flags.add('other');
      kept.add('auxiliary');
    }
    // A name ("IMG_20261109_Nino.heic") goes; the strings after it move up, zeros fill the rest.
    if (item.label.nameEnd > item.label.start && clean) {
      findings.flags.add('other');
      const after = bytes.subarray(Math.min(item.label.nameEnd + 1, item.label.end), item.label.end);
      clean.fill(0, item.label.start, item.label.end);
      clean.set(after, item.label.start + 1);
    }
    const isExif = item.type.toLowerCase() === 'exif';
    const isXmp = item.type === 'mime' && /^application\/rdf\+xml\b/i.test(item.contentType);
    if (!isExif && !isXmp) {
      // Other metadata (and items this tool doesn't know) stay, and are said to stay.
      if (!HEIF_PICTURES.has(item.type)) leave('other');
      continue;
    }
    if (!item.extents) {
      leave(isXmp ? 'xmp' : 'exif');
      clean = null;
      continue;
    }
    // Written "to the end of the file", or sharing bytes with a picture: blanking it could blank the picture.
    if (item.toEnd || pictures.some((picture) => picture.extents && overlaps(picture.extents, /** @type {{ offset: number, length: number }[]} */ (item.extents)))) clean = null;
    const payload = itemBytes(bytes, item.extents);
    if (isExif) {
      const tiffAt = payload.length >= 4 ? 4 + new DataView(payload.buffer).getUint32(0) : payload.length;
      reportExif(findings, parseExif(payload.subarray(Math.min(tiffAt, payload.length))));
      const blank = blankExif(payload);
      if (!blank) clean = null;
      else if (clean) writeItem(clean, item.extents, blank);
    } else if (item.encoding) {
      leave('xmp'); // Compressed XMP: neither read nor blanked.
    } else {
      reportXmp(findings, payload);
      const empty = new Uint8Array(payload.length).fill(0x20);
      if (payload.length >= EMPTY_XMP.length) empty.set(ascii(EMPTY_XMP));
      if (clean) writeItem(clean, item.extents, empty);
    }
  }
  // Blanking XMP leaves a gain-map picture in place: the clean copy keeps its HDR, so there is nothing to warn about.
  findings.flags.delete('hdr');
  return { type, findings, kept, orientation: 1, clean };
}

/* ---------- Reading and checking ---------- */

/**
 * @param {Uint8Array<ArrayBuffer>} bytes
 * @param {Options} options
 * @returns {Promise<Omit<PhotoReport, 'verified'>>}
 */
async function read(bytes, options) {
  const type = detectType(bytes);
  if (type === 'jpeg') return inspectJpeg(bytes, options);
  if (type === 'png') return inspectPng(bytes, options);
  if (type === 'webp') return inspectWebp(bytes, options);
  if (type === 'heic' || type === 'avif') return inspectHeif(bytes, type);
  throw new PhotoError('unsupported');
}

/** @param {Uint8Array} haystack @param {Uint8Array} needle */
function containsBytes(haystack, needle) {
  for (let at = haystack.indexOf(needle[0]); at !== -1 && at + needle.length <= haystack.length; at = haystack.indexOf(needle[0], at + 1)) {
    let matched = 1;
    while (matched < needle.length && haystack[at + matched] === needle[matched]) matched += 1;
    if (matched === needle.length) return true;
  }
  return false;
}

/** A value as UTF-8, UTF-16LE and UTF-16BE bytes. @param {string} value */
function encodings(value) {
  const little = new Uint8Array(value.length * 2);
  const big = new Uint8Array(value.length * 2);
  for (let i = 0; i < value.length; i += 1) {
    const unit = value.charCodeAt(i);
    little[i * 2] = unit & 0xff;
    little[i * 2 + 1] = unit >> 8;
    big[i * 2] = unit >> 8;
    big[i * 2 + 1] = unit & 0xff;
  }
  return [new TextEncoder().encode(value), little, big];
}

/**
 * Shorter values are not searched for: in megabytes of picture data, a few bytes can match by chance. They are still
 * covered by reading the copy again.
 */
const MIN_SECRET = 6;

/**
 * Searches the whole clean copy, independently of the readers, for what the first reading found: names, IDs and
 * places in UTF-8 and UTF-16, and the coordinates as stored.
 * @param {Uint8Array} clean
 * @param {Findings} findings
 */
function stillThere(clean, findings) {
  const values = [...new Set(findings.secrets.map((value) => value.trim()))].filter((value) => value.length >= MIN_SECRET);
  return values.some((value) => encodings(value).some((needle) => containsBytes(clean, needle))) || findings.rawSecrets.some((raw) => containsBytes(clean, raw));
}

/**
 * Reads a photo: what hidden data it carries, and the same photo without it.
 * The clean copy is read again and searched for what was found; if anything
 * that was meant to go is still there, it isn't returned.
 * @param {Uint8Array<ArrayBuffer>} bytes
 * @param {Options} [options]
 * @returns {Promise<PhotoReport>}
 * @throws {PhotoError}
 */
export async function inspectPhoto(bytes, options = {}) {
  const report = await read(bytes, options);
  if (!report.clean) return { ...report, verified: false };
  try {
    const { findings } = await read(report.clean, options);
    const allowed = /** @type {Set<string>} */ (report.kept);
    const left =
      findings.location ||
      Object.keys(findings.fields).some((key) => !(key === 'profile' && report.kept.has('profile'))) ||
      findings.texts.length ||
      findings.preview ||
      [...findings.flags].some((flag) => !allowed.has(flag)) ||
      stillThere(report.clean, report.findings);
    return left ? { ...report, clean: null, verified: false } : { ...report, verified: true };
  } catch (error) {
    if (!(error instanceof PhotoError)) throw error;
    return { ...report, clean: null, verified: false };
  }
}

/* ---------- The example ---------- */

/**
 * @typedef {{ tag: number, text?: string, short?: number, long?: number, byte?: number, rational?: [number, number][] }} TiffEntry
 */

/**
 * A big-endian TIFF block from directories (IFD0, Exif, GPS and a preview).
 * @param {{ ifd0: TiffEntry[], exif: TiffEntry[], gps: TiffEntry[], preview: Uint8Array }} parts
 */
function writeTiff({ ifd0, exif, gps, preview }) {
  /** @param {TiffEntry} entry @returns {{ type: number, count: number, data: number[] }} */
  const encode = (entry) => {
    if (entry.text !== undefined) return { type: 2, count: entry.text.length + 1, data: [...ascii(entry.text), 0] };
    if (entry.rational) return { type: 5, count: entry.rational.length, data: entry.rational.flatMap(([top, bottom]) => [...u32(top), ...u32(bottom)]) };
    if (entry.byte !== undefined) return { type: 1, count: 1, data: [entry.byte] };
    if (entry.short !== undefined) return { type: 3, count: 1, data: [entry.short >> 8, entry.short & 0xff] };
    return { type: 4, count: 1, data: u32(entry.long ?? 0) };
  };
  /** @param {number} n */
  const u32 = (n) => [(n >>> 24) & 0xff, (n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
  /** @param {TiffEntry[]} entries */
  const size = (entries) => 2 + entries.length * 12 + 4 + entries.reduce((sum, entry) => sum + (encode(entry).data.length > 4 ? encode(entry).data.length : 0), 0);
  /** @param {TiffEntry[]} entries @param {number} at @param {number} next */
  const directory = (entries, at, next) => {
    const table = [entries.length >> 8, entries.length & 0xff];
    /** @type {number[]} */
    const extra = [];
    for (const entry of entries) {
      const { type, count, data } = encode(entry);
      table.push(entry.tag >> 8, entry.tag & 0xff, 0, type, ...u32(count));
      if (data.length > 4) {
        table.push(...u32(at + 2 + entries.length * 12 + 4 + extra.length));
        extra.push(...data);
      } else {
        table.push(...data, ...new Array(4 - data.length).fill(0));
      }
    }
    return [...table, ...u32(next), ...extra];
  };
  const pointers = (/** @type {number} */ exifAt, /** @type {number} */ gpsAt) => [...ifd0, { tag: TAG.exifIfd, long: exifAt }, { tag: TAG.gpsIfd, long: gpsAt }];
  const exifAt = 8 + size(pointers(0, 0));
  const gpsAt = exifAt + size(exif);
  const ifd1At = gpsAt + size(gps);
  const thumb = (/** @type {number} */ at) => [{ tag: 0x0103, short: 6 }, { tag: TAG.previewOffset, long: at }, { tag: TAG.previewLength, long: preview.length }];
  const previewAt = ifd1At + size(thumb(0));
  return concat([
    Uint8Array.of(0x4d, 0x4d, 0, 42, 0, 0, 0, 8),
    Uint8Array.from(directory(pointers(exifAt, gpsAt), 8, ifd1At)),
    Uint8Array.from(directory(exif, exifAt, 0)),
    Uint8Array.from(directory(gps, gpsAt, 0)),
    Uint8Array.from(directory(thumb(previewAt), ifd1At, 0)),
    preview,
  ]);
}

/**
 * The example photo: a picture with what a phone would add (made-up values).
 * @param {Uint8Array} jpeg  The picture, a JPEG without metadata.
 * @param {Uint8Array} preview  A JPEG preview of it, as phones store one.
 * @returns {Uint8Array<ArrayBuffer>}
 */
export function examplePhoto(jpeg, preview) {
  const tiff = writeTiff({
    ifd0: [
      { tag: TAG.make, text: 'Example' },
      { tag: TAG.model, text: 'Example Phone 7' },
      { tag: TAG.orientation, short: 1 },
      { tag: TAG.software, text: 'Camera 4.2' },
      { tag: TAG.dateTime, text: '2026:11:09 14:03:22' },
    ],
    exif: [
      { tag: TAG.dateTimeOriginal, text: '2026:11:09 14:03:22' },
      { tag: TAG.owner, text: 'Nino Beridze' },
      { tag: TAG.serial, text: 'EX7-2026-004512' },
      { tag: TAG.uniqueId, text: '8F3A1C55E0B24D6A' },
    ],
    gps: [
      { tag: TAG.gpsLatRef, text: 'N' },
      { tag: TAG.gpsLat, rational: [[41, 1], [41, 1], [5940, 100]] },
      { tag: TAG.gpsLonRef, text: 'E' },
      { tag: TAG.gpsLon, rational: [[44, 1], [48, 1], [1290, 100]] },
      { tag: TAG.gpsAltitudeRef, byte: 0 },
      { tag: TAG.gpsAltitude, rational: [[4870, 10]] },
      { tag: TAG.gpsTime, rational: [[10, 1], [3, 1], [22, 1]] },
      { tag: 16, text: 'T' },
      { tag: TAG.gpsDirection, rational: [[1352, 10]] },
      { tag: TAG.gpsDate, text: '2026:11:09' },
    ],
    preview,
  });
  // Right after the start marker and JFIF header, where phones put it.
  const afterJfif = jpeg[3] === JPEG.app0 ? 4 + ((jpeg[4] << 8) | jpeg[5]) : 2;
  return concat([jpeg.subarray(0, afterJfif), exifSegment(tiff), jpeg.subarray(afterJfif)]);
}

/* ---------- Page wiring ---------- */

const MAX_BYTES = 40 * 1024 * 1024;
/** @type {Record<PhotoType, string>} */
const MIME = { jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', heic: 'image/heic', avif: 'image/avif' };
/** @type {Record<PhotoType, string>} */
const EXTENSION = { jpeg: 'jpg', png: 'png', webp: 'webp', heic: 'heic', avif: 'avif' };

/**
 * Whether the browser can draw this file. A clean copy that the browser
 * can't draw although it drew the original isn't offered.
 * @param {Blob} blob
 */
async function decodes(blob) {
  try {
    (await createImageBitmap(blob)).close();
    return true;
  } catch {
    return false;
  }
}

/**
 * Draws the preview picture the way the photo is shown: turned and mirrored as its EXIF orientation says (1–8:
 * 2 mirrored, 3 turned 180°, 4 mirrored top to bottom, 5 and 7 mirrored across a diagonal, 6 and 8 turned 90°).
 * @param {HTMLCanvasElement} canvas
 * @param {Uint8Array} preview
 * @param {number} orientation
 */
async function drawPreview(canvas, preview, orientation) {
  const bitmap = await createImageBitmap(new Blob([/** @type {Uint8Array<ArrayBuffer>} */ (preview)], { type: 'image/jpeg' }), { imageOrientation: 'none' });
  const { width, height } = bitmap;
  const turned = orientation >= 5;
  canvas.width = turned ? height : width;
  canvas.height = turned ? width : height;
  const context = /** @type {CanvasRenderingContext2D} */ (canvas.getContext('2d'));
  /** @type {Record<number, [number, number, number, number, number, number]>} */
  const transforms = {
    2: [-1, 0, 0, 1, width, 0],
    3: [-1, 0, 0, -1, width, height],
    4: [1, 0, 0, -1, 0, height],
    5: [0, 1, 1, 0, 0, 0],
    6: [0, 1, -1, 0, height, 0],
    7: [0, -1, -1, 0, height, width],
    8: [0, -1, 1, 0, 0, width],
  };
  context.setTransform(...(transforms[orientation] ?? [1, 0, 0, 1, 0, 0]));
  context.drawImage(bitmap, 0, 0);
  bitmap.close();
}

/**
 * Draws the example picture: the whole scene for the preview, a crop of it for the photo,
 * so the preview shows what the crop left out.
 * @param {number} width
 * @param {number} height
 * @param {boolean} cropped
 */
async function exampleScene(width, height, cropped) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = /** @type {CanvasRenderingContext2D} */ (canvas.getContext('2d'));
  // The crop is the right half of the scene, enlarged.
  if (cropped) {
    context.scale(2, 2);
    context.translate(-width / 2, -height / 4);
  }
  const sky = context.createLinearGradient(0, 0, 0, height);
  sky.addColorStop(0, '#7fb3e0');
  sky.addColorStop(1, '#dcebf7');
  context.fillStyle = sky;
  context.fillRect(0, 0, width, height);
  context.fillStyle = '#6a9a4c';
  context.fillRect(0, height * 0.72, width, height * 0.28);
  // A house with a door and a window: the part the crop leaves out.
  context.fillStyle = '#c96f4a';
  context.fillRect(width * 0.08, height * 0.4, width * 0.3, height * 0.34);
  context.fillStyle = '#8c3b28';
  context.beginPath();
  context.moveTo(width * 0.05, height * 0.42);
  context.lineTo(width * 0.23, height * 0.22);
  context.lineTo(width * 0.41, height * 0.42);
  context.fill();
  context.fillStyle = '#f3e3b5';
  context.fillRect(width * 0.13, height * 0.48, width * 0.08, height * 0.09);
  context.fillStyle = '#4a2a1c';
  context.fillRect(width * 0.26, height * 0.56, width * 0.07, height * 0.18);
  // A tree and the sun: what the crop keeps.
  context.fillStyle = '#6b4a2b';
  context.fillRect(width * 0.7, height * 0.45, width * 0.04, height * 0.29);
  context.fillStyle = '#3f7a3a';
  context.beginPath();
  context.arc(width * 0.72, height * 0.42, height * 0.14, 0, Math.PI * 2);
  context.fill();
  context.fillStyle = '#f6c945';
  context.beginPath();
  context.arc(width * 0.88, height * 0.18, height * 0.07, 0, Math.PI * 2);
  context.fill();
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.85));
  if (!(blob instanceof Blob)) throw new Error('The browser could not draw the example picture.');
  return new Uint8Array(await blob.arrayBuffer());
}

/** Most bytes read in one batch: each photo is held two or three times over while it is checked. */
const MAX_BATCH_BYTES = 200 * 1024 * 1024;

/** @param {HTMLElement} root */
export function init(root) {
  /** @template {Element} T @param {string} name @param {ParentNode} [scope] @returns {T} */
  const find = (name, scope = root) => /** @type {T} */ (scope.querySelector(`[data-js="${name}"]`));
  const file = /** @type {HTMLInputElement} */ (find('photo-file'));
  const summary = /** @type {HTMLElement} */ (find('photo-summary'));
  const reports = /** @type {HTMLElement} */ (find('photo-reports'));
  const template = /** @type {HTMLTemplateElement} */ (find('photo-template'));
  const allBox = /** @type {HTMLElement} */ (find('photo-all'));
  const all = initSave(/** @type {HTMLElement} */ (find('save', allBox)));
  /** The save areas of the cards shown, so their object URLs can be released. @type {ReturnType<typeof initSave>[]} */
  let saves = [];
  /** Counts batches: a batch that is no longer the latest stops adding to the page. */
  let run = 0;

  /**
   * Fills one report card.
   * @param {HTMLElement} card
   * @param {PhotoReport} result
   */
  const fill = (card, result) => {
    const { findings } = result;
    for (const row of /** @type {HTMLElement[]} */ ([...card.querySelectorAll('[data-row]')])) {
      const key = row.dataset.row ?? '';
      if (key === 'location') {
        row.hidden = !findings.location;
        if (findings.location) find('photo-coordinates', row).textContent = `${findings.location.lat.toFixed(5)}, ${findings.location.lon.toFixed(5)}`;
      } else if (key === 'texts') {
        row.hidden = findings.texts.length === 0;
        const list = /** @type {HTMLElement} */ (find('photo-texts', row));
        const item = /** @type {HTMLTemplateElement} */ (find('photo-text-template', row));
        const entries = findings.texts.map((note) => {
          const entry = /** @type {HTMLElement} */ (/** @type {HTMLElement} */ (item.content.firstElementChild).cloneNode(true));
          find('photo-text-key', entry).textContent = note.key;
          const body = find('photo-text-body', entry);
          body.textContent = note.text ?? list.dataset.compressed ?? '';
          /** @type {HTMLElement} */ (find('photo-text-cut', entry)).hidden = !note.cut;
          return entry;
        });
        if (findings.moreTexts) {
          const more = document.createElement('li');
          more.textContent = fillText(list.dataset.more, { n: String(findings.moreTexts) });
          entries.push(more);
        }
        list.replaceChildren(...entries);
      } else if (row.dataset.flag !== undefined) {
        row.hidden = !findings.flags.has(/** @type {Flag} */ (key));
      } else {
        const value = findings.fields[key];
        row.hidden = value === undefined;
        const cell = /** @type {HTMLElement} */ (find('photo-value', row));
        if (value !== undefined) cell.textContent = value === '' ? (cell.dataset.unnamed ?? '') : fillText(cell.dataset.template ?? '{value}', { value });
      }
    }
    const keptBox = /** @type {HTMLElement} */ (find('photo-kept', card));
    keptBox.hidden = result.kept.size === 0;
    for (const item of /** @type {HTMLElement[]} */ ([...keptBox.querySelectorAll('[data-kept]')])) item.hidden = !result.kept.has(/** @type {Kept} */ (item.dataset.kept));
  };

  /**
   * One file's report card.
   * @param {File} chosen
   * @param {boolean} overBatch  The batch is already over its size: not read.
   * @param {() => void} changed  Called when the card's clean copy changes after the report (the profile is dropped).
   * @returns {Promise<{ card: HTMLElement, save: ReturnType<typeof initSave>, clean: () => { original: string, extension: string, data: Uint8Array, neutral: boolean } | null }>}
   */
  const report = async (chosen, overBatch, changed) => {
    const card = /** @type {HTMLElement} */ (/** @type {HTMLElement} */ (template.content.firstElementChild).cloneNode(true));
    const message = /** @type {HTMLElement} */ (find('photo-message', card));
    const save = initSave(/** @type {HTMLElement} */ (find('save', card)));
    initCopy(card);
    find('photo-name', card).textContent = chosen.name;
    /** @type {{ original: string, extension: string, data: Uint8Array } | null} */
    let current = null;
    const result = { card, save, clean: () => (current ? { ...current, neutral: save.isNeutral() } : null) };
    /** @param {string} key */
    const fail = (key) => {
      message.textContent = message.dataset[key] ?? '';
      return result;
    };
    if (chosen.size > MAX_BYTES) return fail('tooLarge');
    if (overBatch) return fail('batchLimit');

    /** @type {Uint8Array<ArrayBuffer>} */
    let original;
    /** @type {PhotoReport} */
    let photo;
    try {
      original = new Uint8Array(await chosen.arrayBuffer());
      photo = await inspectPhoto(original);
    } catch (error) {
      if (!(error instanceof PhotoError)) console.error('[lockwell] Could not read the chosen photo.', error);
      return fail(error instanceof PhotoError ? error.code : 'damaged');
    }
    if (!hasFindings(photo.findings)) return fail('none');
    message.textContent = message.dataset.found ?? '';
    fill(card, photo);
    /** @type {HTMLElement} */ (find('photo-facts', card)).hidden = false;

    if (photo.findings.preview) {
      try {
        await drawPreview(find('photo-preview-canvas', card), photo.findings.preview, photo.orientation);
        /** @type {HTMLElement} */ (find('photo-preview', card)).hidden = false;
      } catch (error) {
        console.warn('[lockwell] The browser could not draw the preview stored in the photo.', error);
      }
    }

    const verified = /** @type {HTMLElement} */ (find('photo-verified', card));
    verified.hidden = false;
    const shown = await decodes(new Blob([original], { type: MIME[photo.type] }));
    /** Offers the clean copy, if it passed: its data was checked, and where the browser can draw the original, the copy must draw too. @param {PhotoReport} next */
    const offer = async (next) => {
      const blob = next.clean ? new Blob([next.clean], { type: MIME[next.type] }) : null;
      const drawable = blob !== null && (!shown || (await decodes(blob)));
      verified.textContent = (drawable ? (shown ? verified.dataset.ok : verified.dataset.metadataOnly) : verified.dataset.failed) ?? '';
      current = null;
      if (!blob || !drawable || !next.clean) {
        save.clear();
        return;
      }
      save.offer({ blob, original: chosen.name, extension: EXTENSION[next.type], fallback: 'photo', suffix: 'clean' });
      current = { original: chosen.name, extension: EXTENSION[next.type], data: next.clean };
    };
    await offer(photo);
    // A colour profile that isn't a standard one stays unless the visitor drops it.
    const drop = /** @type {HTMLInputElement} */ (find('photo-drop-profile', card));
    drop.addEventListener('change', async () => {
      const next = await inspectPhoto(original, { dropProfile: drop.checked });
      fill(card, next);
      await offer(next);
      changed();
    });
    return result;
  };

  /** @param {File[]} files */
  const open = async (files) => {
    run += 1;
    const current = run;
    for (const save of saves) save.clear();
    saves = [];
    all.clear();
    allBox.hidden = true;
    reports.replaceChildren();
    summary.textContent = '';
    /** @type {Awaited<ReturnType<typeof report>>[]} */
    const cards = [];
    // Several clean copies: one archive with all of them, each named the way its own card would save it.
    const offerAll = () => {
      const done = cards.map((card) => card.clean()).filter((clean) => clean !== null);
      allBox.hidden = done.length < 2;
      if (done.length < 2) return all.clear();
      all.offer({ blob: new Blob([cleanArchive(done, { fallback: 'photo', suffix: 'clean' })], { type: 'application/zip' }), original: 'photos', extension: 'zip', fallback: 'photos', suffix: 'clean' });
    };
    let total = 0;
    for (const chosen of files) {
      total += chosen.size;
      const result = await report(chosen, total > MAX_BATCH_BYTES, () => current === run && offerAll());
      // A newer batch started meanwhile: this card belongs to nothing on the page.
      if (current !== run) {
        result.save.clear();
        return;
      }
      saves.push(result.save);
      cards.push(result);
      result.save.onRename(offerAll);
      reports.append(result.card);
    }
    // Announced once the report is complete.
    summary.textContent = files.length === 1 ? (summary.dataset.one ?? '') : fillText(summary.dataset.several, { n: String(files.length) });
    offerAll();
  };

  file.addEventListener('change', () => open([...(file.files ?? [])]));
  receiveFiles(root, (_, files) => open(files), { paste: true });
  find('photo-example').addEventListener('click', async () => {
    try {
      const [photo, preview] = await Promise.all([exampleScene(800, 600, true), exampleScene(160, 120, false)]);
      open([new File([examplePhoto(photo, preview)], 'IMG_20261109_140322.jpg', { type: MIME.jpeg })]);
    } catch (error) {
      console.error('[lockwell] Could not make the example photo.', error);
    }
  });
}

// @ts-check
/**
 * @file Tool "Video metadata remover": reads what an MP4, MOV, 3GP or M4V video says about where, when and with what
 * it was recorded, and removes it without re-encoding.
 */
/**
 * Videos from phones and cameras carry their location, the time of recording, the device and its serial numbers.
 * The file is read in the browser and never uploaded; only the box headers and the small `moov` index are read, so
 * videos of several gigabytes work on a phone.
 *
 * Cleaning never rebuilds the file. Every change is a patch of the same length at a fixed offset:
 * - metadata boxes become `free` boxes full of zeros (renaming alone would leave their bytes readable);
 * - recording times in the movie, track and media headers become zero;
 * - tracks of timed data (GPS routes, per-frame dates, unknown data) keep their structure, and their samples in
 *   `mdat` are overwritten with zeros, so every offset and duration stays valid;
 * - `free` and `skip` boxes that hold anything are zeroed, as some cameras keep GPS logs in them.
 * The picture and sound are never touched. Formats, sources and choices: docs/research/tool-video-metadata.md and
 * docs/tools-plan/video-metadata.md.
 */
import { BoxError, childrenOf, fullBox, readBoxes, topLevelBoxes, walk } from './bmff.mjs';
import { readRange } from './file-read.mjs';
import { dateTime, decodeText, device, joinValues, oneLine } from './metadata-text.mjs';
import { MAX_XMP, parseXmp } from './xmp.mjs';
import { fillInto, fillText } from './fill.mjs';
import { receiveFiles } from './files.mjs';
import { initSave } from './save.mjs';

/** @typedef {import('./bmff.mjs').Box} Box */

/**
 * A video this tool can't process; `code` picks the message shown.
 * "photo": a HEIC or AVIF picture (the photo tool reads those). "fragmented": a file recorded in fragments whose
 * timed data would have to be cleaned inside the fragments, which this tool doesn't do.
 */
export class VideoError extends Error {
  /** @param {'unsupported' | 'photo' | 'damaged' | 'tooLarge' | 'fragmented'} code @param {string} [detail] */
  constructor(code, detail = '') {
    super(`Video can't be processed: ${code}${detail ? ` (${detail})` : ''}`);
    this.name = 'VideoError';
    this.code = code;
  }
}

/**
 * @typedef {'thumbnail' | 'xmp' | 'c2pa' | 'samsung' | 'cameraData' | 'timecode' | 'frameData' | 'dataTrack' | 'gpsLog'
 *   | 'emptyLocation' | 'hiddenData' | 'trackNames' | 'other'} Flag
 *   cameraData: device records such as GoPro's settings and IDs. frameData: date and settings stored with every frame.
 *   dataTrack: a track of data this tool can't read. gpsLog: a GPS log in a box of the camera maker's own.
 *   emptyLocation: a location field that says 0, 0 (no position fix). hiddenData: data inside free space.
 *   trackNames: the names tracks give their handlers, which can name the device or app ("GoPro AVC") or carry a date.
 * @typedef {'subtitles' | 'unknownTrack' | 'unknownBox' | 'encoderName'} LeftIn  Kinds of content left as they are.
 *   encoderName: the encoder named in the video's codec description, which players read and this tool doesn't edit.
 *
 * @typedef {{ lat: number, lon: number }} Point
 * @typedef {object} Route  A GPS route recorded alongside the video.
 * @property {number} points  Positions read (or, where they can't be read, samples of the track).
 * @property {Point | null} first
 * @property {Point | null} last
 *
 * @typedef {object} Findings
 * @property {(Point & { alt?: number, accuracy?: number }) | null} location
 * @property {Route | null} route
 * @property {Record<string, string>} fields  taken, timeZone, camera, lens, software, serial, uniqueId, author,
 *   title, description, keywords, place, fileName, copyright.
 * @property {Set<Flag>} flags
 * @property {string[]} secrets  Values the clean copy must not contain anywhere in its index.
 *
 * @typedef {object} Patch  Bytes to write over the original; without `bytes`, zeros.
 * @property {number} offset
 * @property {number} length
 * @property {Uint8Array} [bytes]
 *
 * @typedef {object} VideoReport
 * @property {Findings} findings
 * @property {Patch[]} patches  Sorted by offset, never overlapping.
 * @property {Map<LeftIn, string[]>} leftIn  What stays, with names to show.
 */

/** The most `moov` read into memory; a two-hour phone video's is a few megabytes. */
export const MAX_MOOV = 256 * 1024 * 1024;
/** Boxes up to this size are read whole (camera XML, uuid boxes); larger data is read in pieces of this size. */
const MAX_FREE_READ = 16 * 1024 * 1024;
/** Most separate ranges zeroed; a crafted file can't make the page build millions of pieces. */
export const MAX_PATCHES = 1_000_000;
/** Longest value shown. */
const MAX_VALUE = 300;

const FREE = Uint8Array.from([0x66, 0x72, 0x65, 0x65]);

/** HEIF and AVIF picture brands (photo log; research §1): such files are photos, not videos. */
const PICTURE_BRANDS = new Set(['heic', 'heix', 'heim', 'heis', 'hevc', 'hevx', 'mif1', 'mif2', 'mif3', 'msf1', 'miaf', 'avif', 'avis']);

/** Extended types of `uuid` boxes. */
const UUID = {
  xmp: 'be7acfcb97a942e89c71999491e3afac',
  c2pa: 'd8fec3d61b0e483c92975828877ec481',
  // Sony "USMT" user metadata; "PROF" is a technical profile and stays (samples, docs/samples/video/SOURCES.md).
  sonyMeta: '55534d5421d24fcebb88695cfac9c740',
  sonyProfile: '50524f4621d24fcebb88695cfac9c740',
  // Spherical (360°) video description: needed to play it as 360°.
  spherical: 'ffcc8263f8554a938814587a02521fdd',
};

/**
 * Top-level boxes in which camera makers keep GPS logs (ExifTool QuickTime top-level table, research §2); a top-level
 * `gps ` holds NMEA text in some dashcams (ExifTool QuickTimeStream.pl, ProcessGPSLog).
 */
const GPS_LOG_BOXES = new Set(['gps0', 'gsen', 'gdat', 'udat', 'nbmt', 'inst', 'ssmd', 'gps ']);
/** Top-level boxes that stay: structure and media. */
const KEEP_TOP = new Set(['ftyp', 'moov', 'mdat', 'moof', 'mfra', 'sidx', 'styp', 'wide']);
/** Children of `udta` that stay: loudness, chapters, track selection and kind, hint information. */
const KEEP_UDTA = new Set(['ludt', 'chpl', 'tsel', 'kind', 'hinf', 'hnti']);
/** Track handlers whose samples are the picture, sound or text the visitor sees and hears. */
const MEDIA_HANDLERS = new Set(['vide', 'soun', 'auxv', 'hint']);
const TEXT_HANDLERS = new Set(['text', 'sbtl', 'subt', 'clcp']);
/**
 * The boxes the movie index is built from, by the container they sit in (ISO 14496-12, QuickTime File Format). Any
 * other box directly in these containers is listed as left in; `udta` and `meta` are read on their own.
 * @type {Record<string, Set<string>>}
 */
const STRUCTURE = {
  moov: new Set(['mvhd', 'trak', 'udta', 'meta', 'mvex', 'iods', 'pssh', 'prfl', 'clip', 'ctab', 'uuid', 'free', 'skip']),
  trak: new Set(['tkhd', 'tref', 'edts', 'mdia', 'udta', 'meta', 'load', 'imap', 'matt', 'clip', 'txas', 'tapt', 'uuid', 'free', 'skip']),
  mdia: new Set(['mdhd', 'hdlr', 'minf', 'elng', 'udta', 'uuid', 'free', 'skip']),
  minf: new Set(['vmhd', 'smhd', 'hmhd', 'nmhd', 'sthd', 'gmhd', 'hdlr', 'dinf', 'stbl', 'uuid', 'free', 'skip']),
  stbl: new Set(['stsd', 'stts', 'ctts', 'cslg', 'stss', 'stps', 'stsh', 'sdtp', 'sbgp', 'csgm', 'sgpd', 'subs', 'stsz', 'stz2', 'stsc', 'stco', 'co64', 'padb', 'saiz', 'saio', 'uuid', 'free', 'skip']),
  dinf: new Set(['dref', 'free', 'skip']),
  edts: new Set(['elst', 'free', 'skip']),
  mvex: new Set(['mehd', 'trex', 'trep', 'leve', 'free', 'skip']),
};

/** One character per byte, without spreading every byte as an argument (which fails for long arrays). @param {Uint8Array} bytes */
const latin1 = (bytes) => {
  let text = '';
  for (let at = 0; at < bytes.length; at += 8192) text += String.fromCharCode(...bytes.subarray(at, at + 8192));
  return text;
};

/* ---------- Values ---------- */

/** @param {string} value */
const cut = (value) => (value.length > MAX_VALUE ? `${value.slice(0, MAX_VALUE)}…` : value);

/**
 * ISO 6709 as phones write it, "+41.7151+044.8271+450.000/" (decimal degrees), and the older degree-minute forms
 * "+4142.906+04449.626/" and "+414254.3+0444945.5/". Values outside the globe are rejected.
 * @param {string} text
 * @returns {(Point & { alt?: number }) | null}
 */
export function parseIso6709(text) {
  const match = /^\s*([+-])(\d+(?:\.\d*)?)([+-])(\d+(?:\.\d*)?)(?:([+-]\d+(?:\.\d*)?))?/.exec(text);
  if (!match) return null;
  /** @param {string} sign @param {string} value @param {number} degreeDigits */
  const degrees = (sign, value, degreeDigits) => {
    const whole = value.split('.')[0].length;
    const number = Number(value);
    let out;
    // Android writes degrees without leading zeros ("+7.3713"), so up to the full width means degrees.
    if (whole <= degreeDigits) out = number;
    else if (whole === degreeDigits + 2) out = Math.trunc(number / 100) + (number % 100) / 60;
    else if (whole === degreeDigits + 4) out = Math.trunc(number / 10000) + (Math.trunc(number / 100) % 100) / 60 + (number % 100) / 3600;
    else return NaN;
    return sign === '-' ? -out : out;
  };
  const lat = degrees(match[1], match[2], 2);
  const lon = degrees(match[3], match[4], 3);
  if (!(Math.abs(lat) <= 90 && Math.abs(lon) <= 180)) return null;
  return match[5] === undefined ? { lat, lon } : { lat, lon, alt: Number(match[5]) };
}

/**
 * Seconds since 1904-01-01 UTC (QuickTime) → "2024-04-13 17:03 UTC".
 * @param {number} seconds
 */
export function quickTimeDate(seconds) {
  const date = new Date(Date.UTC(1904, 0, 1) + seconds * 1000);
  return Number.isNaN(date.getTime()) ? '' : `${date.toISOString().slice(0, 16).replace('T', ' ')} UTC`;
}

/**
 * The text of a user-data box, whichever of the three layouts it uses: QuickTime international text (16-bit length,
 * 16-bit language, text), 3GPP (version and flags, 16-bit language, text ending in a zero byte, UTF-8 or UTF-16 with
 * a byte order mark) or plain text (some editors).
 * @param {Uint8Array} payload
 */
export function userText(payload) {
  if (payload.length >= 6 && payload[0] === 0 && payload[1] === 0 && payload[2] === 0 && payload[3] === 0) return decodeString(payload.subarray(6));
  if (payload.length >= 4) {
    const length = (payload[0] << 8) | payload[1];
    if (length > 0 && 4 + length <= payload.length) return decodeString(payload.subarray(4, 4 + length));
  }
  return decodeString(payload);
}

/** UTF-16 with a byte order mark, else UTF-8 (or Latin-1); stops at the first zero. @param {Uint8Array} bytes */
function decodeString(bytes) {
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return oneLine(new TextDecoder('utf-16be').decode(bytes.subarray(2)).split('\0')[0]);
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return oneLine(new TextDecoder('utf-16le').decode(bytes.subarray(2)).split('\0')[0]);
  const end = bytes.indexOf(0);
  return oneLine(decodeText(end === -1 ? bytes : bytes.subarray(0, end)));
}

/**
 * The value of an item's `data` box (QuickTime metadata): text, or a number.
 * @param {Uint8Array} payload  The `data` box's contents.
 * @returns {{ text: string, picture: boolean }}
 */
function dataValue(payload) {
  if (payload.length < 8) return { text: '', picture: false };
  const type = (payload[1] << 16) | (payload[2] << 8) | payload[3];
  const value = payload.subarray(8);
  const view = new DataView(value.buffer, value.byteOffset, value.byteLength);
  // Well-known types: 1 UTF-8, 2 UTF-16, 13 JPEG, 14 PNG, 27 BMP, 21 signed and 22 unsigned big-endian integers,
  // 23 and 24 big-endian floats (QuickTime File Format, metadata data atom).
  if (type === 1) return { text: oneLine(decodeText(value)), picture: false };
  if (type === 2) return { text: oneLine(new TextDecoder('utf-16be').decode(value)), picture: false };
  if (type === 13 || type === 14 || type === 27) return { text: '', picture: true };
  if (type === 23 && value.length === 4) return { text: String(Math.round(view.getFloat32(0) * 1000) / 1000), picture: false };
  if (type === 24 && value.length === 8) return { text: String(Math.round(view.getFloat64(0) * 1000) / 1000), picture: false };
  if ((type === 21 || type === 22) && value.length >= 1 && value.length <= 4) {
    let n = 0;
    for (const byte of value) n = n * 256 + byte;
    if (type === 21 && value[0] & 0x80) n -= 2 ** (8 * value.length);
    return { text: String(n), picture: false };
  }
  return { text: '', picture: false };
}

/* ---------- GoPro GPMF ---------- */

/**
 * The items of a GPMF stream (key, type, structure size, repeat, then the data padded to 4 bytes), visited depth
 * first. Type 0 marks a nest of more items (DEVC device, STRM stream); nests are visited too, with type "\0", before
 * their contents. Source: github.com/gopro/gpmf-parser README (research §2).
 * @param {Uint8Array} bytes
 * @param {(key: string, type: string, size: number, repeat: number, data: Uint8Array) => void} visit
 * @param {number} [depth]
 */
export function readGpmf(bytes, visit, depth = 0) {
  let at = 0;
  while (at + 8 <= bytes.length) {
    const key = String.fromCharCode(bytes[at], bytes[at + 1], bytes[at + 2], bytes[at + 3]);
    const type = bytes[at + 4];
    const size = bytes[at + 5];
    const repeat = (bytes[at + 6] << 8) | bytes[at + 7];
    const length = size * repeat;
    if (key === '\0\0\0\0' || at + 8 + length > bytes.length) return;
    const data = bytes.subarray(at + 8, at + 8 + length);
    visit(key, String.fromCharCode(type), size, repeat, data);
    if (type === 0 && depth < 8) readGpmf(data, visit, depth + 1);
    at += 8 + Math.ceil(length / 4) * 4;
  }
}

/**
 * Numbers of a GPMF item of a simple numeric type.
 * @param {string} type @param {Uint8Array} data
 */
function gpmfNumbers(type, data) {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  /** @type {Record<string, [number, (at: number) => number]>} */
  const readers = {
    b: [1, (at) => view.getInt8(at)],
    B: [1, (at) => view.getUint8(at)],
    s: [2, (at) => view.getInt16(at)],
    S: [2, (at) => view.getUint16(at)],
    l: [4, (at) => view.getInt32(at)],
    L: [4, (at) => view.getUint32(at)],
    f: [4, (at) => view.getFloat32(at)],
    d: [8, (at) => view.getFloat64(at)],
  };
  const reader = readers[type];
  if (!reader) return [];
  const [width, get] = reader;
  return Array.from({ length: Math.floor(data.length / width) }, (_, i) => get(i * width));
}

/** Bytes per field of each GPMF type letter (gpmf-parser README); "?" structures are described by TYPE. */
const GPMF_WIDTH = /** @type {Record<string, number>} */ ({ b: 1, B: 1, c: 1, s: 2, S: 2, l: 4, L: 4, f: 4, F: 4, q: 4, d: 8, j: 8, J: 8, Q: 8, G: 16, U: 16 });

/** Streams that hold positions, best first: GPS5 and GPS9 (cameras), GPRI and GLPI (the Karma drone, samples). */
const POSITION_KEYS = ['GPS5', 'GPS9', 'GPRI', 'GLPI'];

/**
 * GPS positions in a GPMF sample. Latitude and longitude are the first two fields whose UNIT is "deg"; without
 * units (GPS5, and GPS9 where UNIT is missing) they are the first two fields. Each is divided by its SCAL value.
 * Positions come from the first stream in POSITION_KEYS that has any.
 * @param {Uint8Array} bytes
 * @returns {Point[]}
 */
export function gpmfPoints(bytes) {
  /** @type {Map<string, Point[]>} */
  const found = new Map();
  /** Settings of the current stream; a new STRM starts afresh. */
  let stream = { scale: /** @type {number[]} */ ([]), types: '', units: /** @type {string[]} */ ([]) };
  readGpmf(bytes, (key, type, size, repeat, data) => {
    if (key === 'STRM') stream = { scale: [], types: '', units: [] };
    else if (key === 'SCAL') stream.scale = gpmfNumbers(type, data);
    else if (key === 'TYPE') stream.types = latin1(data).replace(/\0+$/, '');
    else if (key === 'UNIT' || key === 'SIUN') stream.units = Array.from({ length: repeat }, (_, i) => latin1(data.subarray(i * size, (i + 1) * size)).replace(/\0+$/, ''));
    if (!POSITION_KEYS.includes(key)) return;
    const types = type === '?' ? stream.types : type.repeat(Math.max(1, Math.floor(size / (GPMF_WIDTH[type] ?? size))));
    /** @type {number[]} */
    const offsets = [];
    let width = 0;
    for (const letter of types) {
      if (!GPMF_WIDTH[letter]) return;
      offsets.push(width);
      width += GPMF_WIDTH[letter];
    }
    if (width !== size) return;
    const degrees = stream.units.flatMap((unit, i) => (unit === 'deg' ? [i] : []));
    const [latField, lonField] = key === 'GPS5' || degrees.length < 2 ? [0, 1] : degrees;
    if (types[latField] !== 'l' || types[lonField] !== 'l') return;
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    /** @param {number} field */
    const scaleOf = (field) => (stream.scale.length > 1 ? stream.scale[field] : stream.scale[0]) || 1;
    const points = found.get(key) ?? [];
    for (let i = 0; i < repeat; i += 1) {
      const lat = view.getInt32(i * size + offsets[latField]) / scaleOf(latField);
      const lon = view.getInt32(i * size + offsets[lonField]) / scaleOf(lonField);
      if ((lat !== 0 || lon !== 0) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180) points.push({ lat, lon });
    }
    found.set(key, points);
  });
  for (const key of POSITION_KEYS) if (found.get(key)?.length) return /** @type {Point[]} */ (found.get(key));
  return [];
}

/**
 * Text values in GoPro's global GPMF box (in `udta`): CASN camera serial, MINF model, FMWR firmware.
 * @param {Uint8Array} bytes
 */
function gpmfStrings(bytes) {
  /** @type {Record<string, string>} */
  const out = {};
  readGpmf(bytes, (key, type, size, repeat, data) => {
    if (type === 'c' && ['CASN', 'MINF', 'FMWR'].includes(key) && !(key in out)) out[key] = decodeString(data);
  });
  return out;
}

/* ---------- Sample tables ---------- */

/**
 * Where a track's samples are in the file: from the sample sizes (`stsz`, or the compact `stz2`), the sample-to-chunk
 * runs (`stsc`) and the chunk offsets (`stco` or `co64`). Neighbouring samples are merged into one range. With one
 * size for every sample, a chunk is added as one range, so a crafted count of billions costs nothing.
 * @param {Uint8Array} bytes  Holds the whole `stbl`.
 * @param {Box} stbl
 * @param {number} base
 * @param {number} fileSize
 * @returns {{ offset: number, length: number, samples: number }[]}
 * @throws {VideoError}
 */
export function sampleRanges(bytes, stbl, base, fileSize) {
  const children = childrenOf(bytes, stbl, base);
  const find = (/** @type {string} */ type) => children.find((child) => child.type === type);
  const stsz = find('stsz') ?? find('stz2');
  const stsc = find('stsc');
  const offsets = find('stco') ?? find('co64');
  if (!stsz && !stsc && !offsets) return [];
  if (!stsz || !stsc || !offsets) throw new VideoError('damaged', 'a sample table is missing a part');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const u32 = (/** @type {number} */ at) => view.getUint32(at - base);
  const need = (/** @type {Box} */ box, /** @type {number} */ at, /** @type {number} */ length) => {
    if (at + length > box.end) throw new VideoError('damaged', `"${box.type}" is shorter than its entries`);
  };

  const sizeFields = fullBox(bytes, stsz, base).fields;
  need(stsz, sizeFields, 8);
  const count = u32(sizeFields + 4);
  let fixedSize = 0;
  /** @type {(i: number) => number} */
  let sampleSize;
  if (stsz.type === 'stz2') {
    // 3 reserved bytes, the size of each field in bits (4, 8 or 16), the count, then the packed sizes.
    const bits = bytes[sizeFields + 3 - base];
    if (bits !== 4 && bits !== 8 && bits !== 16) throw new VideoError('damaged', `"stz2" has ${bits}-bit sizes`);
    need(stsz, sizeFields + 8, Math.ceil((count * bits) / 8));
    const at = sizeFields + 8 - base;
    sampleSize = (i) => (bits === 16 ? view.getUint16(at + i * 2) : bits === 8 ? bytes[at + i] : (bytes[at + (i >> 1)] >> (i & 1 ? 0 : 4)) & 0x0f);
  } else {
    fixedSize = u32(sizeFields);
    if (fixedSize === 0) need(stsz, sizeFields + 8, count * 4);
    sampleSize = (i) => (fixedSize !== 0 ? fixedSize : u32(sizeFields + 8 + i * 4));
  }

  const chunkFields = fullBox(bytes, offsets, base).fields;
  need(offsets, chunkFields, 4);
  const chunks = u32(chunkFields);
  const wide = offsets.type === 'co64';
  need(offsets, chunkFields + 4, chunks * (wide ? 8 : 4));
  const chunkOffset = (/** @type {number} */ i) => (wide ? Number(view.getBigUint64(chunkFields + 4 + i * 8 - base)) : u32(chunkFields + 4 + i * 4));

  const runFields = fullBox(bytes, stsc, base).fields;
  need(stsc, runFields, 4);
  const runs = u32(runFields);
  need(stsc, runFields + 4, runs * 12);

  /** @type {{ offset: number, length: number, samples: number }[]} */
  const out = [];
  /** @param {number} offset @param {number} length @param {number} samples */
  const add = (offset, length, samples) => {
    if (offset + length > fileSize) throw new VideoError('damaged', 'a sample lies past the end of the file');
    const last = out.at(-1);
    if (last && last.offset + last.length === offset) {
      last.length += length;
      last.samples += samples;
    } else if (length > 0) {
      if (out.length === MAX_PATCHES) throw new VideoError('damaged', 'too many separate samples');
      out.push({ offset, length, samples });
    }
  };
  let sample = 0;
  for (let run = 0; run < runs && sample < count; run += 1) {
    const at = runFields + 4 + run * 12;
    const firstChunk = u32(at) - 1;
    const perChunk = u32(at + 4);
    const lastChunk = run + 1 < runs ? u32(at + 12) - 1 : chunks;
    if (firstChunk < 0 || lastChunk > chunks || lastChunk < firstChunk) throw new VideoError('damaged', 'sample-to-chunk runs out of order');
    for (let chunk = firstChunk; chunk < lastChunk && sample < count; chunk += 1) {
      let offset = chunkOffset(chunk);
      if (fixedSize !== 0) {
        const samples = Math.min(perChunk, count - sample);
        add(offset, samples * fixedSize, samples);
        sample += samples;
        continue;
      }
      for (let i = 0; i < perChunk && sample < count; i += 1, sample += 1) {
        const length = sampleSize(sample);
        add(offset, length, 1);
        offset += length;
      }
    }
  }
  return out;
}

/* ---------- Reading the file ---------- */

/** @returns {Findings} */
const emptyFindings = () => ({ location: null, route: null, fields: {}, flags: new Set(), secrets: [] });

/** True when the report has anything to show. @param {Findings} findings */
export const hasFindings = ({ location, route, fields, flags }) => Boolean(location || route || Object.keys(fields).length || flags.size);

/** Fields that are not searched for in the clean copy: dates and short version numbers can occur by chance. */
const NOT_SECRET = new Set(['taken', 'timeZone', 'software']);

/**
 * Collects findings and patches while the file is read.
 * @param {number} fileSize
 */
function collector(fileSize) {
  const findings = emptyFindings();
  /** @type {Patch[]} */
  const patches = [];
  /** @type {Map<LeftIn, string[]>} */
  const leftIn = new Map();

  return {
    findings,
    patches,
    leftIn,
    /** Maker and model from separate user-data boxes. */
    device: { make: '', model: '' },
    fileSize,
    /** The index announces fragments (`mvex`). */
    fragmented: false,
    /** Boxes turned into free space: what was inside them went with them. @type {Box[]} */
    blanked: /** @type {Box[]} */ ([]),
    /** Sample tables of the picture and sound, which data patches must never touch. @type {Box[]} */
    media: /** @type {Box[]} */ ([]),
    /** Blocks of GPS data in `mdat` that a dashcam's index points to. @type {SampleRange[]} */
    gpsBlocks: /** @type {SampleRange[]} */ ([]),
    /** True for a box inside one already blanked. @param {Box} box */
    inside(box) {
      return this.blanked.some((outer) => box.start > outer.start && box.end <= outer.end);
    },
    /** First source of a field wins. @param {string} key @param {string | undefined} value */
    field(key, value) {
      const text = value ? oneLine(value) : '';
      if (!text) return;
      if (!(key in findings.fields)) findings.fields[key] = cut(text);
      if (!NOT_SECRET.has(key) && text.length >= 4) findings.secrets.push(text);
    },
    /** @param {Point & { alt?: number, accuracy?: number }} point @param {string} raw  The text as stored, searched for in the copy. */
    location(point, raw) {
      if (point.lat === 0 && point.lon === 0) findings.flags.add('emptyLocation');
      else findings.location ??= point;
      if (raw.length >= 4) findings.secrets.push(raw);
    },
    /** @param {LeftIn} kind @param {string} name */
    keep(kind, name) {
      const names = leftIn.get(kind) ?? [];
      if (!names.includes(name)) names.push(name);
      leftIn.set(kind, names);
    },
    /** @param {number} offset @param {number} length @param {Uint8Array} [bytes] */
    patch(offset, length, bytes) {
      if (length <= 0) return;
      if (patches.length === MAX_PATCHES) throw new VideoError('damaged', 'too many separate pieces to clean');
      patches.push(bytes ? { offset, length, bytes } : { offset, length });
    },
    /**
     * Turns a box into a `free` box of zeros: its type, its 64-bit size field kept, everything after the size zeroed.
     * @param {Box} box
     */
    blank(box) {
      const header = box.data - box.start - (box.uuid ? 16 : 0);
      this.patch(box.start + 4, 4, FREE);
      this.patch(box.start + header, box.end - box.start - header);
      this.blanked.push(box);
    },
  };
}

/** @typedef {ReturnType<typeof collector>} Collector */

/**
 * Reads the `keys` and `ilst` of a QuickTime metadata box (handler `mdta`): key names by index, and their values.
 * @param {Uint8Array} bytes
 * @param {Box} meta
 * @param {number} base
 * @returns {{ key: string, text: string, picture: boolean }[]}
 */
function metadataItems(bytes, meta, base) {
  const children = childrenOf(bytes, meta, base);
  const keysBox = children.find((child) => child.type === 'keys');
  const ilst = children.find((child) => child.type === 'ilst');
  /** @type {string[]} */
  const names = [];
  if (keysBox) {
    const { fields } = fullBox(bytes, keysBox, base);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let at = fields + 4;
    while (at + 8 <= keysBox.end) {
      const size = view.getUint32(at - base);
      if (size < 8 || at + size > keysBox.end) break;
      names.push(new TextDecoder().decode(bytes.subarray(at + 8 - base, at + size - base)));
      at += size;
    }
  }
  if (!ilst) return [];
  return childrenOf(bytes, ilst, base).flatMap((item) => {
    const data = childrenOf(bytes, item, base, 'ilst').find((child) => child.type === 'data');
    if (!data) return [];
    const index = ((item.type.charCodeAt(0) << 24) >>> 0) + (item.type.charCodeAt(1) << 16) + (item.type.charCodeAt(2) << 8) + item.type.charCodeAt(3);
    // In a key-indexed list the item type is a 1-based key number; otherwise (iTunes-style lists) it is the key itself.
    const key = names.length ? (names[index - 1] ?? '') : item.type;
    return [{ key, ...dataValue(bytes.subarray(data.data - base, data.end - base)) }];
  });
}

/**
 * QuickTime metadata keys (QuickTime File Format metadata key and location tables; AOSP MPEG4Writer; research §2–3).
 * @type {Record<string, string>}
 */
const KEY_FIELDS = {
  'com.apple.quicktime.location.name': 'place',
  'com.apple.quicktime.location.note': 'place',
  'com.apple.quicktime.make': 'make',
  'com.apple.quicktime.model': 'model',
  'com.apple.quicktime.software': 'software',
  'com.apple.quicktime.creationdate': 'taken',
  'com.apple.quicktime.location.date': 'taken',
  'com.apple.quicktime.author': 'author',
  'com.apple.quicktime.artist': 'author',
  'com.apple.quicktime.copyright': 'copyright',
  'com.apple.quicktime.displayname': 'title',
  'com.apple.quicktime.title': 'title',
  'com.apple.quicktime.description': 'description',
  'com.apple.quicktime.comment': 'description',
  'com.apple.quicktime.keywords': 'keywords',
  'com.apple.quicktime.content.identifier': 'uniqueId',
  'com.apple.quicktime.camera.lens_model': 'lens',
  'com.android.manufacturer': 'make',
  'com.android.model': 'model',
  'com.android.version': 'androidVersion',
  'samsung.android.utc_offset': 'timeZone',
  // iTunes-style item lists (udta/meta/ilst), keyed by four characters.
  '\xa9nam': 'title',
  '\xa9cmt': 'description',
  '\xa9des': 'description',
  '\xa9ART': 'author',
  '\xa9day': 'taken',
  '\xa9too': 'software',
  '\xa9swr': 'software',
  '\xa9mak': 'make',
  '\xa9mod': 'model',
  cprt: 'copyright',
  desc: 'description',
};

/**
 * Keys that describe how the video was shot or should play, not who or where: removed with the rest, but not shown
 * as "other details" (QuickTime metadata keys; AOSP MPEG4Writer; samples).
 */
const PLAIN_KEYS = new Set([
  'com.apple.quicktime.camera.focal_length.35mm_equivalent',
  'com.apple.quicktime.camera.identifier',
  'com.apple.quicktime.full-frame-rate-playback-intent',
  'com.apple.quicktime.live-photo.auto',
  'com.apple.quicktime.live-photo.vitality-score',
  'com.apple.quicktime.live-photo.vitality-scoring-version',
  'com.apple.quicktime.still-image-time',
  'com.apple.quicktime.video-orientation',
  'com.android.capture.fps',
  'com.android.video.temporal_layers_count',
]);

/** "2024-04-13T19:03:00+0200" → "+02:00" @param {string} value */
const zoneOf = (value) => /(?:T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?)([+-]\d{2}):?(\d{2})$/.exec(value)?.slice(1, 3).join(':') ?? '';

/**
 * Records the items of a metadata box: location, device, people and dates.
 * @param {Collector} out
 * @param {{ key: string, text: string, picture: boolean }[]} items
 */
function reportItems(out, items) {
  /** @type {Record<string, string>} */
  const raw = {};
  for (const { key, text, picture } of items) {
    if (picture) out.findings.flags.add('thumbnail');
    if (!text) continue;
    if (key === 'com.apple.quicktime.location.ISO6709' || key === '\xa9xyz') {
      const point = parseIso6709(text);
      if (point) out.location(point, text);
    } else if (key === 'com.apple.quicktime.location.accuracy.horizontal') {
      raw.accuracy = text;
    } else if (KEY_FIELDS[key]) {
      const field = KEY_FIELDS[key];
      raw[field] = raw[field] ? joinValues([raw[field], text]) : text;
      // The value as stored is what the clean copy is searched for (make and model are shown joined).
      if (!['taken', 'timeZone', 'software', 'androidVersion'].includes(field) && text.length >= 4) out.findings.secrets.push(text);
    } else if (key && !PLAIN_KEYS.has(key)) {
      out.findings.flags.add('other');
    }
  }
  if (raw.accuracy && out.findings.location && out.findings.location.accuracy === undefined && Number.isFinite(Number(raw.accuracy))) {
    out.findings.location.accuracy = Math.round(Number(raw.accuracy));
  }
  out.field('taken', dateTime(raw.taken));
  out.field('timeZone', raw.timeZone || (raw.taken ? zoneOf(raw.taken) : ''));
  out.field('camera', device(raw.make, raw.model));
  out.field('software', raw.androidVersion ? `Android ${raw.androidVersion}` : raw.software);
  for (const key of ['lens', 'uniqueId', 'author', 'title', 'description', 'keywords', 'place', 'copyright']) out.field(key, raw[key]);
}

/**
 * Text boxes in user data (QuickTime ©-boxes, 3GPP boxes, editors' boxes; research §3, samples).
 * @type {Record<string, string>}
 */
const UDTA_TEXT = {
  '\xa9mak': 'make',
  '\xa9mod': 'model',
  '\xa9swr': 'software',
  '\xa9too': 'software',
  '\xa9day': 'taken',
  '\xa9nam': 'title',
  '\xa9cmt': 'description',
  '\xa9des': 'description',
  '\xa9inf': 'description',
  '\xa9ART': 'author',
  '\xa9aut': 'author',
  '\xa9wrt': 'author',
  '\xa9cpy': 'copyright',
  auth: 'author',
  titl: 'title',
  dscp: 'description',
  cprt: 'copyright',
  perf: 'author',
  clfn: 'fileName',
  FIRM: 'software',
  LENS: 'lensSerial',
  SNum: 'serial',
  slno: 'serial',
  manu: 'make',
  modl: 'model',
};
/** User-data boxes that hold a picture. */
const UDTA_PICTURES = new Set(['thmb', 'thum', 'mcvr', 'nail', 'PICT', 'snal']);
/** Boxes of camera records with no readable text: IDs, settings, highlights, chip information (GoPro; samples). */
const UDTA_CAMERA = new Set(['CAME', 'MUID', 'GUMI', 'BCID', 'SETT', 'HMMT', 'MTDT', 'AMBA']);
/** Samsung's boxes (ExifTool Samsung tags, research §2; `smrd` and `SDLN` seen in Samsung samples). */
const UDTA_SAMSUNG = new Set(['smta', '@sec', 'svss', 'smrd', 'SDLN']);

/**
 * 3GPP location (`loci`): version and flags, language, place name, role, then longitude, latitude and altitude as
 * 16.16 fixed-point numbers, body and notes (FFmpeg mov.c, research §2).
 * @param {Uint8Array} payload
 * @returns {{ point: Point | null, place: string }}
 */
function readLoci(payload) {
  if (payload.length < 6) return { point: null, place: '' };
  // The name ends with a zero byte, or two in UTF-16 (which starts with a byte order mark).
  const utf16 = (payload[6] === 0xfe && payload[7] === 0xff) || (payload[6] === 0xff && payload[7] === 0xfe);
  let nameEnd = -1;
  if (utf16) {
    for (let i = 8; i + 1 < payload.length; i += 2) {
      if (payload[i] === 0 && payload[i + 1] === 0) {
        nameEnd = i;
        break;
      }
    }
  } else nameEnd = payload.indexOf(0, 6);
  const place = decodeString(payload.subarray(6, nameEnd === -1 ? payload.length : nameEnd));
  // After the terminator, one byte of role, then the coordinates.
  const at = nameEnd + (utf16 ? 2 : 1) + 1;
  if (nameEnd === -1 || at + 12 > payload.length) return { point: null, place };
  const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
  const lon = view.getInt32(at) / 65536;
  const lat = view.getInt32(at + 4) / 65536;
  return { point: Math.abs(lat) <= 90 && Math.abs(lon) <= 180 ? { lat, lon } : null, place };
}

/**
 * Reads one child of a `udta` box and blanks it, unless it is one that stays.
 * @param {Collector} out
 * @param {Uint8Array} bytes
 * @param {Box} box
 * @param {number} base
 */
function reportUserData(out, bytes, box, base) {
  if (KEEP_UDTA.has(box.type)) return;
  const payload = bytes.subarray(box.data - base, box.end - base);
  if (box.type === 'free' || box.type === 'skip') {
    clearFree(out, payload, box);
    return;
  }
  if (box.type === '\xa9xyz' || box.type === '@xyz') {
    const text = userText(payload);
    const point = parseIso6709(text);
    if (point) out.location(point, text);
  } else if (box.type === 'loci') {
    const { point, place } = readLoci(payload);
    if (point) out.location(point, '');
    out.field('place', place);
  } else if (box.type === 'kywd') {
    out.field('keywords', userText(payload));
  } else if (UDTA_TEXT[box.type]) {
    const key = UDTA_TEXT[box.type];
    const text = userText(payload);
    if (key === 'make' || key === 'model') {
      // Maker and model come in separate boxes: joined once the whole movie is read (reportMovie).
      out.device[key] ||= text;
      if (text.length >= 4) out.findings.secrets.push(text);
    } else if (key === 'taken') out.field('taken', dateTime(text));
    else out.field(key, text);
  } else if (box.type === 'XMP_') {
    reportXmp(out, payload);
  } else if (box.type === 'GPMF') {
    const values = gpmfStrings(payload);
    out.field('camera', values.MINF ? `GoPro ${values.MINF.replace(/^GoPro\s+/i, '')}` : '');
    out.field('serial', values.CASN);
    out.field('software', values.FMWR);
    out.findings.flags.add('cameraData');
  } else if (box.type === 'meta') {
    reportItems(out, metadataItems(bytes, box, base));
  } else if (UDTA_PICTURES.has(box.type)) {
    out.findings.flags.add('thumbnail');
  } else if (UDTA_CAMERA.has(box.type)) {
    out.findings.flags.add('cameraData');
  } else if (UDTA_SAMSUNG.has(box.type)) {
    out.findings.flags.add('samsung');
  } else {
    out.findings.flags.add('other');
  }
  out.blank(box);
}

/**
 * Zeroes free space in the index that holds anything: editors and cameras leave old values and logs in it.
 * @param {Collector} out
 * @param {Uint8Array} payload
 * @param {Box} box
 */
function clearFree(out, payload, box) {
  if (payload.every((byte) => byte === 0)) return;
  out.findings.flags.add('hiddenData');
  out.patch(box.data, payload.length);
}

/**
 * @param {Collector} out
 * @param {Uint8Array} packet
 */
function reportXmp(out, packet) {
  out.findings.flags.add('xmp');
  const xmp = parseXmp(new TextDecoder().decode(packet.subarray(0, MAX_XMP)));
  if (xmp.location) out.location(xmp.location, '');
  for (const text of xmp.coordinates) if (text.length >= 4) out.findings.secrets.push(text);
  for (const [key, value] of Object.entries(xmp.fields)) {
    const mapped = { artist: 'author', caption: 'description', owner: 'author', lensSerial: 'lensSerial' }[key] ?? key;
    if (['camera', 'lens', 'serial', 'lensSerial', 'author', 'copyright', 'uniqueId', 'taken', 'software', 'description', 'keywords', 'place'].includes(mapped)) out.field(mapped, value);
  }
}

/**
 * The creation and modification times of a movie, track or media header: reported, then zeroed.
 * Both are 32-bit in version 0 and 64-bit in version 1, right after version and flags (research §3).
 * @param {Collector} out
 * @param {Uint8Array} bytes
 * @param {Box} box
 * @param {number} base
 * @param {number[]} times  Collects non-zero creation times.
 */
function clearTimes(out, bytes, box, base, times) {
  const { version, fields } = fullBox(bytes, box, base);
  const width = version === 1 ? 8 : 4;
  if (fields + 2 * width > box.end) throw new VideoError('damaged', `"${box.type}" is too short`);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const read = (/** @type {number} */ at) => (width === 8 ? Number(view.getBigUint64(at - base)) : view.getUint32(at - base));
  const created = read(fields);
  const modified = read(fields + width);
  if (created) times.push(created);
  if (created || modified) out.patch(fields, 2 * width);
}

/**
 * Empties the name in a track's handler box. The name follows version and flags, a component type, the handler type
 * and 12 reserved bytes; QuickTime writes it with a length byte first, MP4 as text ending in a zero byte, so zeros
 * make an empty name in both. Players don't use it; writers fill it with their own names, and one Google writer
 * adds the recording date (samples).
 * @param {Collector} out
 * @param {Uint8Array} bytes
 * @param {Box} box
 * @param {number} base
 */
function clearHandlerName(out, bytes, box, base) {
  const start = box.data + 24;
  if (start >= box.end) return;
  const name = bytes.subarray(start - base, box.end - base);
  if (name.every((byte) => byte === 0)) return;
  out.findings.flags.add('trackNames');
  out.patch(start, name.length);
}

/**
 * What a track is: its handler (picture, sound, data…) and the format of its first sample description.
 * @param {Uint8Array} bytes
 * @param {Box} trak
 * @param {number} base
 */
function trackKind(bytes, trak, base) {
  /** @type {Box | undefined} */ let hdlr;
  /** @type {Box | undefined} */ let stsd;
  /** @type {Box | undefined} */ let stbl;
  /** @type {Box | undefined} */ let dref;
  walk(bytes, trak.data - base, trak.end - base, (box, path) => {
    if (box.type === 'hdlr' && path.at(-1) === 'mdia') hdlr = box;
    if (box.type === 'stbl') stbl = box;
    if (box.type === 'stsd' && path.at(-1) === 'stbl') stsd = box;
    if (box.type === 'dref' && path.at(-1) === 'dinf') dref = box;
  }, base, ['trak']);
  // The first data reference (after version, flags and count): without the "self-contained" flag, the samples are
  // in another file, and their offsets are not offsets into this one.
  let external = false;
  if (dref && dref.end - dref.data >= 20) {
    const at = dref.data + 8 - base;
    external = (bytes[at + 11] & 1) === 0;
  }
  const handler = hdlr && hdlr.end - hdlr.data >= 12 ? String.fromCharCode(...bytes.subarray(hdlr.data + 8 - base, hdlr.data + 12 - base)) : '';
  let format = '';
  /** @type {Uint8Array} */
  let entry = new Uint8Array(0);
  if (stsd && stsd.end - stsd.data >= 16) {
    const at = stsd.data + 8 - base;
    const size = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(at);
    format = String.fromCharCode(...bytes.subarray(at + 4, at + 8));
    entry = bytes.subarray(at, Math.min(at + size, stsd.end - base));
  }
  const descriptions = stsd ? bytes.subarray(stsd.data - base, stsd.end - base) : new Uint8Array(0);
  return { handler, format, entry, descriptions, stbl, external };
}

/** @param {Uint8Array} haystack @param {string} text */
const containsText = (haystack, text) => {
  const needle = Uint8Array.from(text, (char) => char.charCodeAt(0));
  outer: for (let i = 0; i + needle.length <= haystack.length; i += 1) {
    for (let j = 0; j < needle.length; j += 1) if (haystack[i + j] !== needle[j]) continue outer;
    return true;
  }
  return false;
};

/**
 * @typedef {{ offset: number, length: number, samples: number }} SampleRange
 * @typedef {{ ranges: SampleRange[], format: string, handler: string }} TimedTrack  A track of data, not picture or sound.
 */

/**
 * Decides what to do with one track: keep it as it is, or list it for its samples to be read and zeroed.
 * @param {Collector} out
 * @param {Uint8Array} bytes
 * @param {Box} trak
 * @param {number} base
 * @param {TimedTrack[]} timed  Collects data tracks.
 */
function reportTrack(out, bytes, trak, base, timed) {
  const { handler, format, entry, descriptions, stbl, external } = trackKind(bytes, trak, base);
  // A video sample description names its encoder in a 32-byte field at byte 50 (8 header, 6 reserved, 2 reference
  // index, 16 reserved, width, height, resolutions, 4 reserved, frame count), a length byte first.
  if (handler === 'vide' && entry.length >= 82 && entry[50] > 0 && entry[50] < 32) out.keep('encoderName', decodeString(entry.subarray(51, 51 + entry[50])));
  if (MEDIA_HANDLERS.has(handler)) {
    if (stbl && !external) out.media.push(stbl);
    return;
  }
  if (TEXT_HANDLERS.has(handler)) {
    out.keep('subtitles', format || handler);
    return;
  }
  // Apple's timed metadata keeps orientation and Live Photo data, needed to show the video; it goes only when its
  // keys include a location (none of the iPhone samples do, docs/samples/video/SOURCES.md), in any of its descriptions.
  if (format === 'mebx' && !containsText(descriptions, 'location')) return;
  if (handler !== 'meta' && handler !== 'tmcd' && handler !== 'camm' && handler !== 'data' && format !== 'mebx') {
    out.keep('unknownTrack', handler || format || '?');
    return;
  }
  if (!stbl || external) return;
  // Listed even with no samples here: in a fragmented file they are all in the fragments.
  timed.push({ ranges: sampleRanges(bytes, stbl, base, out.fileSize), format, handler });
}

/**
 * Reads a data track's samples and zeroes them, saying what they held: a GPS route, a time of day, per-frame dates or
 * data this tool can't read. Samples that are all zeros (a track already cleaned) are left alone, so a clean copy
 * checks clean however long the recording. Data is read in pieces; positions come from samples that fit in one piece,
 * and reading stops early once nothing more can be learnt.
 * @param {Collector} out
 * @param {Blob} file
 * @param {(blob: Blob, offset: number, length: number) => Promise<Uint8Array>} read
 * @param {TimedTrack} track
 */
async function reportTimed(out, file, read, { ranges, format, handler }) {
  const samples = ranges.reduce((sum, range) => sum + range.samples, 0);
  /** @type {Point[]} */
  const points = [];
  let empty = true;
  for (const range of ranges) {
    if (!empty && format !== 'gpmd') break;
    for (let at = 0; at < range.length; at += MAX_FREE_READ) {
      const data = await read(file, range.offset + at, Math.min(MAX_FREE_READ, range.length - at));
      if (empty && data.some((byte) => byte !== 0)) empty = false;
      if (format === 'gpmd' && range.length <= MAX_FREE_READ) for (const point of gpmfPoints(data)) points.push(point);
      else if (!empty) break;
    }
  }
  if (empty) return;
  // djmd (DJI), camm (Google) and location-bearing mebx (Apple) carry positions this tool doesn't decode: one per sample.
  const route = format === 'gpmd' ? points.length : ['djmd', 'camm', 'mebx'].includes(format) ? samples : 0;
  if (route) {
    const found = out.findings.route ?? { points: 0, first: null, last: null };
    found.points += route;
    found.first ??= points[0] ?? null;
    found.last = points.at(-1) ?? found.last;
    out.findings.route = found;
  } else if (handler === 'tmcd') out.findings.flags.add('timecode');
  else if (format === 'rtmd') out.findings.flags.add('frameData');
  else out.findings.flags.add('dataTrack');
  // GoPro telemetry beyond GPS (motion sensors, settings) goes with the route.
  if (format === 'gpmd' && route) out.findings.flags.add('dataTrack');
  for (const range of ranges) out.patch(range.offset, range.length);
}

/**
 * Reads the `moov` box: user data, metadata, header times and tracks.
 * @param {Collector} out
 * @param {Uint8Array} bytes  The whole `moov`.
 * @param {number} base  Its file offset.
 * @param {TimedTrack[]} timed
 */
function reportMovie(out, bytes, base, timed) {
  /** @type {number[]} */
  const times = [];
  const moov = readBoxes(bytes, 0, bytes.length, base)[0];
  walk(bytes, moov.data - base, moov.end - base, (box, path) => {
    // What sits inside a box already turned into free space went with it.
    if (out.inside(box)) return;
    const parent = path.at(-1) ?? '';
    if (parent === 'udta') reportUserData(out, bytes, box, base);
    else if (box.type === 'free' || box.type === 'skip') clearFree(out, bytes.subarray(box.data - base, box.end - base), box);
    else if (box.type === 'meta' && (parent === 'moov' || parent === 'trak')) {
      reportItems(out, metadataItems(bytes, box, base));
      out.blank(box);
    } else if (box.type === 'uuid') reportUuid(out, bytes.subarray(box.data - base, box.end - base), box);
    else if (box.type === 'mvhd' || box.type === 'tkhd' || box.type === 'mdhd') clearTimes(out, bytes, box, base, times);
    else if (box.type === 'hdlr' && (parent === 'mdia' || parent === 'minf')) clearHandlerName(out, bytes, box, base);
    else if (box.type === 'trak') reportTrack(out, bytes, box, base, timed);
    else if (box.type === 'mvex') out.fragmented = true;
    // A compressed index would hide everything this tool reads.
    else if (box.type === 'cmov') throw new VideoError('unsupported', 'compressed movie index');
    else if (box.type === 'gps ' && parent === 'moov') reportGpsIndex(out, bytes, box, base);
    else if (STRUCTURE[parent] && !STRUCTURE[parent].has(box.type)) out.keep('unknownBox', box.type);
  }, base, ['moov']);
  out.field('camera', device(out.device.make, out.device.model));
  if (times.length) out.field('taken', quickTimeDate(times.reduce((a, b) => Math.min(a, b))));
}

/**
 * A dashcam's index of GPS blocks in `mdat` (Novatek and others; ExifTool QuickTimeStream.pl): version, count, then
 * the offset and size of each block, each starting "freeGPS ". The blocks are checked and zeroed with the data
 * tracks; the index is blanked.
 * @param {Collector} out
 * @param {Uint8Array} bytes
 * @param {Box} box
 * @param {number} base
 */
function reportGpsIndex(out, bytes, box, base) {
  const payload = bytes.subarray(box.data - base, box.end - base);
  const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
  if (payload.length >= 8) {
    const count = Math.min(view.getUint32(4), Math.floor((payload.length - 8) / 8));
    for (let i = 0; i < count; i += 1) {
      const length = view.getUint32(12 + i * 8);
      if (length > 0) out.gpsBlocks.push({ offset: view.getUint32(8 + i * 8), length, samples: 1 });
    }
  }
  out.findings.flags.add('gpsLog');
  out.blank(box);
}

/**
 * Checks that data about to be zeroed lies inside the media data, apart from each other and never on the picture or
 * sound: a crafted or broken table must not make the copy unplayable.
 * @param {SampleRange[]} data
 * @param {Box[]} mdats
 * @param {SampleRange[]} media
 * @throws {VideoError}
 */
function checkDataRanges(data, mdats, media) {
  const sorted = [...data].sort((a, b) => a.offset - b.offset);
  const pictures = [...media].sort((a, b) => a.offset - b.offset);
  let first = 0;
  sorted.forEach(({ offset, length }, i) => {
    const end = offset + length;
    if (!mdats.some((box) => offset >= box.data && end <= box.end)) throw new VideoError('damaged', `data at byte ${offset} lies outside the media data`);
    if (i > 0 && offset < sorted[i - 1].offset + sorted[i - 1].length) throw new VideoError('damaged', `two data tracks share byte ${offset}`);
    while (first < pictures.length && pictures[first].offset + pictures[first].length <= offset) first += 1;
    for (let k = first; k < pictures.length && pictures[k].offset < end; k += 1) {
      if (pictures[k].offset + pictures[k].length > offset) throw new VideoError('damaged', `data at byte ${offset} overlaps the picture or sound`);
    }
  });
}

/**
 * @param {Collector} out
 * @param {Uint8Array} payload
 * @param {Box} box
 */
function reportUuid(out, payload, box) {
  if (box.uuid === UUID.xmp) reportXmp(out, payload);
  else if (box.uuid === UUID.c2pa) out.findings.flags.add('c2pa');
  else if (box.uuid === UUID.sonyMeta) out.findings.flags.add('cameraData');
  else if (box.uuid === UUID.sonyProfile || box.uuid === UUID.spherical) return;
  else {
    out.keep('unknownBox', `uuid ${box.uuid}`);
    return;
  }
  out.blank(box);
}

/**
 * Sony's real-time camera XML (top-level `meta`, handler `nrtm`): device and creation time.
 * @param {Collector} out
 * @param {string} xml
 */
function reportCameraXml(out, xml) {
  /** An attribute of the first such element; the element is cut out first, so the search stays linear. */
  const attribute = (/** @type {string} */ tag, /** @type {string} */ name) => {
    const start = xml.search(new RegExp(`<${tag}\\b`));
    if (start === -1) return '';
    const end = xml.indexOf('>', start);
    return new RegExp(`\\s${name}="([^"]*)"`).exec(xml.slice(start, end === -1 ? undefined : end))?.[1] ?? '';
  };
  out.field('camera', device(attribute('Device', 'manufacturer'), attribute('Device', 'modelName')));
  out.field('serial', attribute('Device', 'serialNo'));
  const created = attribute('CreationDate', 'value');
  out.field('taken', dateTime(created));
  out.field('timeZone', zoneOf(created));
  out.findings.flags.add('cameraData');
}

/**
 * Reads a video and works out how to clean it: what it reveals, and the patches that remove it.
 * @param {Blob} file
 * @param {(blob: Blob, offset: number, length: number) => Promise<Uint8Array>} [read]  How to read a range (tests pass their own).
 * @returns {Promise<VideoReport>}
 * @throws {VideoError}
 */
export async function inspectVideo(file, read = readRange) {
  /** @type {Box[]} */
  let top;
  try {
    top = await topLevelBoxes(file, read);
  } catch (error) {
    if (error instanceof BoxError) throw new VideoError('unsupported', error.message);
    throw error;
  }
  const types = top.map((box) => box.type);
  const moovBox = top.find((box) => box.type === 'moov');
  if (!moovBox) {
    const ftyp = top.find((box) => box.type === 'ftyp');
    const brand = ftyp ? String.fromCharCode(...(await read(file, ftyp.data, 4))) : '';
    throw new VideoError(PICTURE_BRANDS.has(brand) ? 'photo' : 'unsupported', `no movie index; top-level boxes: ${types.slice(0, 8).join(' ')}`);
  }
  if (types.filter((type) => type === 'moov').length > 1) throw new VideoError('damaged', 'more than one movie index');
  if (moovBox.end - moovBox.start > MAX_MOOV) throw new VideoError('tooLarge');

  const out = collector(file.size);
  /** @type {TimedTrack[]} */
  const timed = [];
  /** @type {SampleRange[]} */
  let media = [];
  try {
    const bytes = await read(file, moovBox.start, moovBox.end - moovBox.start);
    reportMovie(out, bytes, moovBox.start, timed);
    for (const box of top) await reportTopLevel(out, file, read, box);
    // The picture and sound are located only when there is data to zero next to them.
    if (timed.some((track) => track.ranges.length) || out.gpsBlocks.length) media = out.media.flatMap((stbl) => sampleRanges(bytes, stbl, moovBox.start, file.size));
  } catch (error) {
    if (error instanceof BoxError) throw new VideoError('damaged', error.message);
    throw error;
  }
  // Timed data inside fragments would need each fragment cleaned; refuse rather than leave it in.
  if (timed.length && (out.fragmented || types.includes('moof'))) throw new VideoError('fragmented');
  // Checked before anything is read, so a crafted table can't make the page read the same data many times.
  checkDataRanges([...timed.flatMap((track) => track.ranges), ...out.gpsBlocks], top.filter((box) => box.type === 'mdat'), media);
  for (const block of out.gpsBlocks) {
    const head = await read(file, block.offset, 12);
    if (latin1(head.subarray(4, 12)) !== 'freeGPS ') throw new VideoError('damaged', `the GPS index points at byte ${block.offset}, which holds no GPS block`);
    out.patch(block.offset, block.length);
  }
  for (const track of timed) await reportTimed(out, file, read, track);

  const patches = out.patches.sort((a, b) => a.offset - b.offset);
  for (let i = 1; i < patches.length; i += 1) {
    if (patches[i].offset < patches[i - 1].offset + patches[i - 1].length) throw new VideoError('damaged', `two changes overlap at byte ${patches[i].offset}`);
  }
  // A value that is also part of a name left in on purpose (make "Apple" in the encoder "Apple ProRes 422 HQ") can't be
  // searched for in the copy.
  const kept = [...out.leftIn.values()].flat();
  out.findings.secrets = [...new Set(out.findings.secrets)].filter((secret) => !kept.some((name) => name.includes(secret)));
  return { findings: out.findings, patches, leftIn: out.leftIn };
}

/**
 * One top-level box other than `moov`.
 * @param {Collector} out
 * @param {Blob} file
 * @param {(blob: Blob, offset: number, length: number) => Promise<Uint8Array>} read
 * @param {Box} box
 */
async function reportTopLevel(out, file, read, box) {
  const size = box.end - box.data;
  if (KEEP_TOP.has(box.type)) return;
  if (box.type === 'free' || box.type === 'skip') {
    // Padding is usually zeros; cameras such as some dashcams keep GPS logs here (research §2). Read in pieces,
    // stopping at the first byte that isn't zero.
    for (let at = box.data; at < box.end; at += MAX_FREE_READ) {
      const piece = await read(file, at, Math.min(MAX_FREE_READ, box.end - at));
      if (piece.some((byte) => byte !== 0)) {
        out.findings.flags.add('hiddenData');
        out.patch(box.data, size);
        return;
      }
    }
    return;
  }
  if (box.type === 'uuid') {
    reportUuid(out, size <= MAX_FREE_READ ? await read(file, box.data, Math.min(size, MAX_XMP)) : new Uint8Array(0), box);
    return;
  }
  if (box.type === 'meta') {
    const bytes = size <= MAX_FREE_READ ? await read(file, box.start, box.end - box.start) : null;
    const xml = bytes ? childrenOf(bytes, readBoxes(bytes, 0, bytes.length, box.start)[0], box.start).find((child) => child.type === 'xml ') : undefined;
    if (bytes && xml) reportCameraXml(out, new TextDecoder().decode(bytes.subarray(xml.data + 4 - box.start, xml.end - box.start)));
    else out.findings.flags.add('other');
    out.blank(box);
    return;
  }
  if (box.type === 'sefd') out.findings.flags.add('samsung');
  // Producer reference time: the wall-clock time a fragment was made (ISO 14496-12 §8.16.5).
  else if (box.type === 'prft') out.findings.flags.add('other');
  else if (GPS_LOG_BOXES.has(box.type)) out.findings.flags.add('gpsLog');
  else if (box.type === 'thm ' || box.type === 'thum' || box.type === 'pnot' || box.type === 'PICT') out.findings.flags.add('thumbnail');
  else {
    out.keep('unknownBox', box.type);
    return;
  }
  out.blank(box);
}

/* ---------- Cleaning ---------- */

/**
 * The clean copy: the original file with the patches written over it. Built from slices of the original, so the
 * video data is never copied into memory; only the patches are new bytes.
 * @param {Blob} file
 * @param {Patch[]} patches  Sorted, not overlapping (as inspectVideo returns them).
 * @param {string} [type]  MIME type of the copy.
 * @returns {Blob}
 */
export function cleanVideo(file, patches, type = file.type) {
  /** @type {BlobPart[]} */
  const parts = [];
  let at = 0;
  for (const { offset, length, bytes } of patches) {
    if (offset > at) parts.push(file.slice(at, offset));
    parts.push(/** @type {Uint8Array<ArrayBuffer>} */ (bytes ?? new Uint8Array(length)));
    at = offset + length;
  }
  if (at < file.size) parts.push(file.slice(at));
  return new Blob(parts, { type });
}

/** A value as UTF-8 and as UTF-16 in both byte orders: writers store text either way. @param {string} text */
function encodings(text) {
  const little = new Uint8Array(text.length * 2);
  const big = new Uint8Array(text.length * 2);
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    little[i * 2] = code & 0xff;
    little[i * 2 + 1] = code >> 8;
    big[i * 2] = code >> 8;
    big[i * 2 + 1] = code & 0xff;
  }
  return [new TextEncoder().encode(text), little, big];
}

/** @param {Uint8Array} haystack @param {Uint8Array} needle */
function containsBytes(haystack, needle) {
  if (needle.length === 0) return false;
  const first = needle[0];
  for (let i = haystack.indexOf(first); i !== -1 && i + needle.length <= haystack.length; i = haystack.indexOf(first, i + 1)) {
    let j = 1;
    while (j < needle.length && haystack[i + j] === needle[j]) j += 1;
    if (j === needle.length) return true;
  }
  return false;
}

/**
 * Checks a clean copy before it is offered: read again from the start, it must report nothing and need no more
 * changes, have the same size, and its index (`moov` and the other small top-level boxes) must not contain any of
 * the original's values, searched for as text independently of the readers.
 * @param {Blob} clean
 * @param {number} size  The original's size.
 * @param {string[]} secrets  From the original's report.
 * @param {(blob: Blob, offset: number, length: number) => Promise<Uint8Array>} [read]
 * @returns {Promise<'ok' | 'size' | 'findings' | 'changes' | 'secret'>}  Why it failed, or "ok".
 */
export async function verifyClean(clean, size, secrets, read = readRange) {
  if (clean.size !== size) return 'size';
  const again = await inspectVideo(clean, read);
  if (hasFindings(again.findings)) return 'findings';
  if (again.patches.length) return 'changes';
  const needles = secrets.flatMap(encodings);
  for (const box of await topLevelBoxes(clean, read)) {
    if (box.type === 'mdat' || box.end - box.start > MAX_MOOV) continue;
    const bytes = await read(clean, box.start, box.end - box.start);
    if (needles.some((needle) => containsBytes(bytes, needle))) return 'secret';
  }
  return 'ok';
}

/* ---------- Example ---------- */

/** @param {number} n */
const be32 = (n) => [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff];
/** @param {string} text */
const latin = (text) => Array.from(text, (char) => char.charCodeAt(0));
/** @param {string} text */
const utf8Bytes = (text) => [...new TextEncoder().encode(text)];
/** @param {string} type @param {...number[]} parts */
const exampleBox = (type, ...parts) => {
  const body = parts.flat();
  return [...be32(8 + body.length), ...latin(type), ...body];
};
/** @param {string} type @param {...number[]} parts */
const exampleFull = (type, ...parts) => exampleBox(type, [0, 0, 0, 0], ...parts);

/**
 * A small QuickTime file made here, for "Try an example": a phone's location, model and recording time, a camera's
 * GPS route of three positions and a serial number. It has no real picture, so it doesn't play.
 */
export function exampleVideo() {
  const recorded = (Date.UTC(2026, 10, 9, 10, 3, 22) - Date.UTC(1904, 0, 1)) / 1000;
  const times = [...be32(recorded), ...be32(recorded)];
  /** A GPMF item: key, type, structure size, 16-bit repeat, data (whole 4-byte words here, so no padding). */
  const item = (/** @type {string} */ key, /** @type {number} */ type, /** @type {number} */ size, /** @type {number[]} */ data) => {
    const repeat = data.length / size;
    return [...latin(key), type, size, (repeat >> 8) & 0xff, repeat & 0xff, ...data];
  };
  /** A GPMF sample: one GPS5 position, scaled by 10^7 for degrees. @param {number} lat @param {number} lon */
  const gps = (lat, lon) => {
    const stream = [
      ...item('SCAL', 0x6c, 4, [1e7, 1e7, 1000, 1000, 100].flatMap(be32)),
      ...item('GPS5', 0x6c, 20, [Math.round(lat * 1e7), Math.round(lon * 1e7), 450000, 0, 0].flatMap((n) => be32(n >>> 0))),
    ];
    return item('DEVC', 0, 1, item('STRM', 0, 1, stream));
  };
  const route = [gps(41.69983, 44.80358), gps(41.70021, 44.80391), gps(41.70064, 44.80422)];
  const ftyp = exampleBox('ftyp', latin('qt  '), be32(0), latin('qt  '));
  const picture = new Array(32).fill(0);
  const pictureAt = ftyp.length + 8;
  const routeAt = pictureAt + picture.length;
  const mdat = exampleBox('mdat', picture, ...route);
  const handler = (/** @type {string} */ kind, /** @type {string} */ name) => exampleFull('hdlr', latin('mhlr'), latin(kind), new Array(12).fill(0), [name.length, ...latin(name)]);
  /** @param {number} id @param {string} kind @param {string} name @param {number[]} entry @param {number} at @param {number[]} sizes */
  const track = (id, kind, name, entry, at, sizes) =>
    exampleBox(
      'trak',
      exampleFull('tkhd', times, be32(id), new Array(72).fill(0)),
      exampleBox(
        'mdia',
        exampleFull('mdhd', times, be32(600), be32(600), [0, 0, 0, 0]),
        handler(kind, name),
        exampleBox(
          'minf',
          exampleBox(
            'stbl',
            exampleFull('stsd', be32(1), entry),
            exampleFull('stsz', be32(0), be32(sizes.length), ...sizes.map(be32)),
            exampleFull('stsc', be32(1), be32(1), be32(sizes.length), be32(1)),
            exampleFull('stco', be32(1), be32(at)),
          ),
        ),
      ),
    );
  const keys = ['com.apple.quicktime.location.ISO6709', 'com.apple.quicktime.make', 'com.apple.quicktime.model', 'com.apple.quicktime.creationdate'];
  const values = ['+41.6998+044.8036+450.000/', 'Example', 'Example Phone 7', '2026-11-09T14:03:22+0400'];
  const meta = exampleBox(
    'meta',
    exampleFull('hdlr', be32(0), latin('mdta'), new Array(12).fill(0), [0]),
    exampleFull('keys', be32(keys.length), ...keys.map((key) => [...be32(8 + utf8Bytes(key).length), ...latin('mdta'), ...utf8Bytes(key)])),
    exampleBox('ilst', ...values.map((value, i) => [...be32(24 + utf8Bytes(value).length), ...be32(i + 1), ...exampleBox('data', be32(1), be32(0), utf8Bytes(value))])),
  );
  const moov = exampleBox(
    'moov',
    exampleFull('mvhd', times, be32(600), be32(600), new Array(80).fill(0)),
    track(1, 'vide', 'Core Media Video', exampleBox('avc1', new Array(6).fill(0), [0, 1], new Array(16).fill(0)), pictureAt, [picture.length]),
    track(2, 'meta', 'Camera telemetry', exampleBox('gpmd', new Array(6).fill(0), [0, 1]), routeAt, route.map((sample) => sample.length)),
    exampleBox('udta', exampleBox('SNum', latin('EX7-2026-004512'))),
    meta,
  );
  return Uint8Array.from([...ftyp, ...mdat, ...moov]);
}

/* ---------- Page wiring ---------- */

/** MIME types by extension, for the clean copy. */
const VIDEO_TYPES = /** @type {Record<string, string>} */ ({ mov: 'video/quicktime', qt: 'video/quicktime', mp4: 'video/mp4', m4v: 'video/x-m4v', '3gp': 'video/3gpp', '3g2': 'video/3gpp2' });

/** @param {Point} point */
const coordinates = (point) => `${point.lat.toFixed(5)}, ${point.lon.toFixed(5)}`;

/** @param {HTMLElement} root */
export function init(root) {
  /** @template {Element} T @param {string} name @param {ParentNode} [scope] @returns {T} */
  const find = (name, scope = root) => /** @type {T} */ (scope.querySelector(`[data-js="${name}"]`));
  const input = /** @type {HTMLInputElement} */ (find('video-file'));
  const report = /** @type {HTMLElement} */ (find('video-report'));
  const message = /** @type {HTMLElement} */ (find('video-message'));
  const facts = /** @type {HTMLElement} */ (find('video-facts'));
  const left = /** @type {HTMLElement} */ (find('video-left'));
  const verified = /** @type {HTMLElement} */ (find('video-verified'));
  const summary = /** @type {HTMLElement} */ (find('video-summary'));
  if (!input || !report || !message) return;
  const save = initSave(/** @type {HTMLElement} */ (find('save', report)));
  /** Counts files: a file that is no longer the latest stops changing the page. */
  let run = 0;

  /** @param {VideoReport} result */
  const fill = ({ findings, leftIn }) => {
    for (const row of /** @type {HTMLElement[]} */ ([...facts.querySelectorAll('[data-row]')])) {
      const key = row.dataset.row ?? '';
      if (key === 'location') {
        row.hidden = !findings.location;
        if (!findings.location) continue;
        find('video-coordinates', row).textContent = coordinates(findings.location);
        const accuracy = /** @type {HTMLElement} */ (find('video-accuracy', row));
        accuracy.hidden = findings.location.accuracy === undefined;
        accuracy.textContent = fillText(accuracy.dataset.template, { value: String(findings.location.accuracy ?? '') });
      } else if (key === 'route') {
        const route = findings.route;
        row.hidden = !route;
        if (!route) continue;
        const count = /** @type {HTMLElement} */ (find('video-route', row));
        count.textContent = fillText(route.first ? count.dataset.template : count.dataset.unread, { n: String(route.points) });
        const ends = /** @type {HTMLElement} */ (find('video-route-ends', row));
        ends.hidden = !(route.first && route.last);
        if (route.first && route.last) fillInto(ends, ends.dataset.template, { first: coordinates(route.first), last: coordinates(route.last) });
      } else if (row.dataset.flag !== undefined) {
        row.hidden = !findings.flags.has(/** @type {Flag} */ (key));
      } else {
        const value = findings.fields[key];
        row.hidden = value === undefined;
        find('video-value', row).textContent = value ?? '';
      }
    }
    facts.hidden = !hasFindings(findings);
    for (const item of /** @type {HTMLElement[]} */ ([...left.querySelectorAll('[data-left]')])) {
      const names = leftIn.get(/** @type {LeftIn} */ (item.dataset.left)) ?? [];
      item.hidden = names.length === 0;
      find('video-left-names', item).textContent = names.length ? `(${names.join(', ')})` : '';
    }
    left.hidden = leftIn.size === 0;
  };

  /** @param {File} chosen */
  const open = async (chosen) => {
    run += 1;
    const current = run;
    save.clear();
    facts.hidden = true;
    left.hidden = true;
    verified.hidden = true;
    summary.textContent = '';
    find('video-name', report).textContent = chosen.name;
    message.textContent = message.dataset.reading ?? '';
    report.hidden = false;
    /** @param {string} text */
    const finish = (text) => {
      message.textContent = text;
      summary.textContent = summary.dataset.done ?? '';
    };

    /** @type {VideoReport} */
    let result;
    try {
      result = await inspectVideo(chosen);
    } catch (error) {
      if (current !== run) return;
      if (!(error instanceof VideoError)) console.error('[lockwell] Could not read the chosen video.', error);
      else console.info(`[lockwell] ${error.message}`);
      finish(message.dataset[error instanceof VideoError ? error.code : 'readFailed'] ?? '');
      return;
    }
    if (current !== run) return;
    fill(result);
    if (result.patches.length === 0) {
      finish(message.dataset.none ?? '');
      return;
    }
    const extension = /\.([a-z0-9]+)$/i.exec(chosen.name)?.[1].toLowerCase() ?? '';
    const type = VIDEO_TYPES[extension] ?? (chosen.type || 'video/mp4');
    const clean = cleanVideo(chosen, result.patches, type);
    /** @type {Awaited<ReturnType<typeof verifyClean>> | 'error'} */
    let verdict;
    try {
      verdict = await verifyClean(clean, chosen.size, result.findings.secrets);
    } catch (error) {
      // The file changed or couldn't be read again: the copy can't be vouched for, so it isn't offered.
      console.error('[lockwell] Could not check the clean copy of the video.', error);
      verdict = 'error';
    }
    if (current !== run) return;
    verified.hidden = false;
    verified.textContent = (verdict === 'ok' ? verified.dataset.ok : verified.dataset.failed) ?? '';
    if (verdict === 'ok') save.offer({ blob: clean, original: chosen.name, extension: VIDEO_TYPES[extension] ? extension : 'mp4', fallback: 'video', suffix: 'clean' });
    else console.warn(`[lockwell] The clean copy of the video failed its check: ${verdict}.`);
    finish(hasFindings(result.findings) ? (message.dataset.found ?? '') : (message.dataset.none ?? ''));
  };

  input.addEventListener('change', () => {
    const [chosen] = input.files ?? [];
    if (chosen) open(chosen);
  });
  receiveFiles(root, (chosen) => open(chosen));
  find('video-example').addEventListener('click', () => {
    open(new File([exampleVideo()], 'VID_20261109_140322.mov', { type: 'video/quicktime' }));
  });
}

// @ts-check
/**
 * @file Tests for the photo metadata tool.
 */
/**
 * Photo metadata tool. The fixtures are small files assembled here byte by
 * byte: real containers (JPEG segments, PNG chunks, WebP chunks) around
 * made-up image data, which the tool must carry over untouched.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { PhotoError, cleanName, detectType, hasFindings, inspectPhoto, parseExif } from '../src/client/tool-photo.mjs';

/** @param {string} text */
const ascii = (text) => Uint8Array.from(text, (char) => char.charCodeAt(0));

/** @param {(Uint8Array | number[])[]} parts */
function bytes(...parts) {
  return Uint8Array.from(parts.flatMap((part) => [...part]));
}

/** @param {Uint8Array} haystack @param {Uint8Array | string} needle */
function includes(haystack, needle) {
  const find = typeof needle === 'string' ? ascii(needle) : needle;
  for (let i = 0; i + find.length <= haystack.length; i += 1) {
    if (find.every((byte, j) => haystack[i + j] === byte)) return true;
  }
  return false;
}

/* ---------- EXIF builder (little-endian TIFF) ---------- */

/**
 * @typedef {{ tag: number, type: 'ascii', value: string } | { tag: number, type: 'short' | 'long', value: number }
 *   | { tag: number, type: 'rational', value: [number, number][] }} Entry
 */

const TYPE = { ascii: 2, short: 3, long: 4, rational: 5 };

/** @param {Entry} entry @returns {{ count: number, data: number[] }} */
function encode(entry) {
  const u16 = (/** @type {number} */ n) => [n & 0xff, n >> 8];
  const u32 = (/** @type {number} */ n) => [n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >>> 24) & 0xff];
  if (entry.type === 'ascii') return { count: entry.value.length + 1, data: [...ascii(entry.value), 0] };
  if (entry.type === 'rational') return { count: entry.value.length, data: entry.value.flatMap(([top, bottom]) => [...u32(top), ...u32(bottom)]) };
  return { count: 1, data: entry.type === 'short' ? u16(entry.value) : u32(entry.value) };
}

/** Size of a directory including the values stored after it. @param {Entry[]} entries */
const ifdSize = (entries) => 2 + entries.length * 12 + 4 + entries.reduce((sum, e) => sum + (encode(e).data.length > 4 ? encode(e).data.length : 0), 0);

/**
 * @param {Entry[]} entries
 * @param {number} offset  Where this directory starts in the TIFF.
 * @param {number} next  Offset of the next directory, or 0.
 */
function ifd(entries, offset, next) {
  const u16 = (/** @type {number} */ n) => [n & 0xff, n >> 8];
  const u32 = (/** @type {number} */ n) => [n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >>> 24) & 0xff];
  /** @type {number[]} */
  const table = [...u16(entries.length)];
  /** @type {number[]} */
  const extra = [];
  const extraStart = offset + 2 + entries.length * 12 + 4;
  for (const entry of entries) {
    const { count, data } = encode(entry);
    table.push(...u16(entry.tag), ...u16(TYPE[entry.type]), ...u32(count));
    if (data.length > 4) {
      table.push(...u32(extraStart + extra.length));
      extra.push(...data);
    } else {
      table.push(...data, ...new Array(4 - data.length).fill(0));
    }
  }
  return [...table, ...u32(next), ...extra];
}

/**
 * A TIFF block as cameras write it.
 * @param {{ orientation?: number, gps?: boolean, thumbnail?: boolean }} [options]
 */
function exifBlock({ orientation = 6, gps = true, thumbnail = true } = {}) {
  /** @type {Entry[]} */
  const exif = [
    { tag: 0x9003, type: 'ascii', value: '2026:11:09 14:03:22' },
    { tag: 0x829a, type: 'rational', value: [[1, 120]] }, // exposure time
    { tag: 0xa434, type: 'ascii', value: 'iPhone 15 back camera 6.86mm f/1.6' }, // lens model
  ];
  /** @type {Entry[]} */
  const location = [
    { tag: 1, type: 'ascii', value: 'N' },
    { tag: 2, type: 'rational', value: [[41, 1], [42, 1], [5436, 100]] }, // 41°42'54.36"
    { tag: 3, type: 'ascii', value: 'E' },
    { tag: 4, type: 'rational', value: [[44, 1], [49, 1], [3756, 100]] }, // 44°49'37.56"
  ];
  /** @param {number} exifAt @param {number} gpsAt @returns {Entry[]} */
  const ifd0 = (exifAt, gpsAt) => [
    { tag: 0x010f, type: 'ascii', value: 'Apple' },
    { tag: 0x0110, type: 'ascii', value: 'iPhone 15' },
    { tag: 0x0112, type: 'short', value: orientation },
    { tag: 0x0131, type: 'ascii', value: '18.1' },
    { tag: 0x8769, type: 'long', value: exifAt },
    ...(gps ? [/** @type {Entry} */ ({ tag: 0x8825, type: 'long', value: gpsAt })] : []),
  ];
  const exifAt = 8 + ifdSize(ifd0(0, 0));
  const gpsAt = exifAt + ifdSize(exif);
  const thumbAt = gpsAt + (gps ? ifdSize(location) : 0);
  return bytes(
    [0x49, 0x49, 42, 0, 8, 0, 0, 0],
    ifd(ifd0(exifAt, gpsAt), 8, thumbnail ? thumbAt : 0),
    ifd(exif, exifAt, 0),
    gps ? ifd(location, gpsAt, 0) : [],
    thumbnail ? ifd([{ tag: 0x0103, type: 'short', value: 6 }], thumbAt, 0) : [],
  );
}

/* ---------- JPEG fixture ---------- */

/** @param {number} marker @param {Uint8Array | number[]} data */
const segment = (marker, data) => bytes([0xff, marker, (data.length + 2) >> 8, (data.length + 2) & 0xff], data);

const JFIF = segment(0xe0, bytes(ascii('JFIF\0'), [1, 1, 0, 0, 1, 0, 1, 0, 0]));
const ICC = segment(0xe2, bytes(ascii('ICC_PROFILE\0'), [1, 1, 9, 9, 9, 9]));
const TABLES = bytes(segment(0xdb, [0, 1, 2, 3]), segment(0xc0, [8, 0, 1, 0, 1, 1, 1, 0x11, 0]), segment(0xc4, [0, 1, 2]));
// Image data with everything that looks like a marker but isn't: a stuffed 0xFF00 and a restart marker.
const SCAN = bytes(segment(0xda, [1, 1, 0, 0, 0x3f, 0]), [0x12, 0xff, 0x00, 0x34, 0xff, 0xd0, 0x56, 0x78, 0xff, 0x00, 0x9a]);
const IMAGE = bytes(TABLES, SCAN);
const SOI = [0xff, 0xd8];
const EOI = [0xff, 0xd9];

/** A phone photo: location, device, date, editing data, comment, thumbnail and a video after the image. */
function phoneJpeg(options = {}) {
  return bytes(
    SOI,
    JFIF,
    segment(0xe1, bytes(ascii('Exif\0\0'), exifBlock(options))),
    segment(0xe1, ascii('http://ns.adobe.com/xap/1.0/\0<x:xmpmeta>secret edit history</x:xmpmeta>')),
    segment(0xed, ascii('Photoshop 3.0\x008BIM caption by Nino')),
    segment(0xfe, ascii('shot for the newsroom')),
    segment(0xe2, ascii('MPF\0 secondary images')),
    ICC,
    IMAGE,
    EOI,
    ascii('MOTION-PHOTO-VIDEO-DATA'),
  );
}

describe('photo tool: file types', () => {
  it('recognises JPEG, PNG, WebP and HEIC by their first bytes, not by name', () => {
    assert.equal(detectType(phoneJpeg()), 'jpeg');
    assert.equal(detectType(bytes([0x89], ascii('PNG\r\n\x1a\n'))), 'png');
    assert.equal(detectType(bytes(ascii('RIFF'), [4, 0, 0, 0], ascii('WEBP'))), 'webp');
    assert.equal(detectType(bytes([0, 0, 0, 24], ascii('ftypheic'))), 'heic');
    assert.equal(detectType(ascii('%PDF-1.7')), null);
  });

  it('explains HEIC and unknown files instead of guessing', () => {
    assert.throws(() => inspectPhoto(bytes([0, 0, 0, 24], ascii('ftypheic'), [0, 0, 0, 0])), (error) => error instanceof PhotoError && error.code === 'heic');
    assert.throws(() => inspectPhoto(ascii('%PDF-1.7 not a photo')), (error) => error instanceof PhotoError && error.code === 'unsupported');
    assert.throws(() => inspectPhoto(new Uint8Array(0)), (error) => error instanceof PhotoError && error.code === 'unsupported');
  });

  it('names the clean copy after the original', () => {
    assert.equal(cleanName('IMG_1234.JPG', 'jpeg'), 'IMG_1234-clean.jpg');
    assert.equal(cleanName('holiday.photo.png', 'png'), 'holiday.photo-clean.png');
    assert.equal(cleanName('.webp', 'webp'), 'photo-clean.webp');
  });
});

describe('photo tool: EXIF', () => {
  it('reads location, device, date and rotation', () => {
    const exif = parseExif(exifBlock());
    assert.ok(exif);
    assert.deepEqual([exif.make, exif.model, exif.software, exif.taken, exif.orientation], ['Apple', 'iPhone 15', '18.1', '2026:11:09 14:03:22', 6]);
    assert.ok(exif.location);
    assert.ok(Math.abs(exif.location.lat - 41.7151) < 1e-6, `lat ${exif.location.lat}`);
    assert.ok(Math.abs(exif.location.lon - 44.8271) < 1e-6, `lon ${exif.location.lon}`);
    assert.equal(exif.thumbnail, true);
    assert.equal(exif.details, true, 'lens and exposure count as further details');
  });

  it('survives damaged or hostile data without throwing', () => {
    const good = exifBlock();
    assert.equal(parseExif(new Uint8Array(4)), null);
    assert.equal(parseExif(bytes(ascii('XX'), [42, 0, 8, 0, 0, 0])), null);
    for (let cut = 8; cut < good.length; cut += 7) assert.doesNotThrow(() => parseExif(good.slice(0, cut)), `cut at ${cut}`);
    // Every pointer aimed far outside the block.
    const wild = good.slice();
    for (let i = 8; i + 4 <= wild.length; i += 4) wild.set([0xff, 0xff, 0xff, 0x7f], i);
    assert.doesNotThrow(() => parseExif(wild));
    // A directory that points at itself must not loop.
    const loop = bytes([0x49, 0x49, 42, 0, 8, 0, 0, 0], [1, 0], [0x69, 0x87, 4, 0, 1, 0, 0, 0, 8, 0, 0, 0], [8, 0, 0, 0]);
    assert.doesNotThrow(() => parseExif(loop));
  });
});

describe('photo tool: JPEG', () => {
  it('reports everything a phone photo carries', () => {
    const { type, findings } = inspectPhoto(phoneJpeg());
    assert.equal(type, 'jpeg');
    assert.ok(findings.location && Math.abs(findings.location.lat - 41.7151) < 1e-6);
    assert.equal(findings.camera, 'Apple iPhone 15');
    assert.equal(findings.taken, '2026-11-09 14:03');
    assert.equal(findings.software, '18.1');
    assert.deepEqual([...findings.flags].sort(), ['comment', 'exif', 'iptc', 'other', 'thumbnail', 'trailing', 'xmp']);
  });

  it('removes all of it, keeps the image data byte for byte, and keeps colour and rotation', () => {
    const { clean } = inspectPhoto(phoneJpeg());
    for (const secret of ['Apple', 'iPhone', '2026:11:09', 'xmpmeta', 'Nino', 'newsroom', 'MPF', 'MOTION-PHOTO']) {
      assert.ok(!includes(clean, secret), `"${secret}" must be gone`);
    }
    assert.ok(includes(clean, IMAGE), 'tables and compressed data are copied unchanged');
    assert.ok(includes(clean, ICC), 'colour profile kept');
    assert.deepEqual([...clean.subarray(0, 2 + JFIF.length)], [...SOI, ...JFIF], 'starts with the JFIF header');
    assert.deepEqual([...clean.subarray(-2)], EOI, 'ends at the end-of-image marker');

    const again = inspectPhoto(clean);
    assert.equal(hasFindings(again.findings), false, 'a clean copy has nothing left to report');
    assert.deepEqual([...again.clean], [...clean], 'cleaning twice changes nothing');
    const kept = parseExif(clean.subarray(2 + JFIF.length + 10));
    assert.equal(kept?.orientation, 6, 'the photo still knows which way is up');
    assert.equal(kept?.location, null);
  });

  it('adds no EXIF at all when the photo is already upright', () => {
    const { clean } = inspectPhoto(phoneJpeg({ orientation: 1 }));
    assert.ok(!includes(clean, 'Exif'));
    assert.deepEqual([...clean], [...bytes(SOI, JFIF, ICC, IMAGE, EOI)]);
  });

  it('finds nothing in a photo that has nothing', () => {
    const plain = bytes(SOI, JFIF, IMAGE, EOI);
    const report = inspectPhoto(plain);
    assert.equal(hasFindings(report.findings), false);
    assert.deepEqual([...report.clean], [...plain]);
  });

  it('handles progressive photos (several scans) and photos without a JFIF header', () => {
    const progressive = bytes(SOI, segment(0xe1, bytes(ascii('Exif\0\0'), exifBlock({ gps: false, thumbnail: false }))), TABLES, SCAN, segment(0xc4, [1, 2]), SCAN, EOI);
    const { clean, findings } = inspectPhoto(progressive);
    assert.equal(findings.location, null);
    assert.equal(findings.camera, 'Apple iPhone 15');
    assert.ok(includes(clean, bytes(TABLES, SCAN, segment(0xc4, [1, 2]), SCAN)), 'both scans kept in order');
    assert.deepEqual([...clean.subarray(0, 4)], [0xff, 0xd8, 0xff, 0xe1], 'rotation EXIF goes right after the start marker');
  });

  it('refuses cut-off or corrupt files instead of saving a broken copy', () => {
    const full = phoneJpeg();
    const damaged = (/** @type {Uint8Array<ArrayBuffer>} */ file) => assert.throws(() => inspectPhoto(file), (error) => error instanceof PhotoError && error.code === 'damaged');
    damaged(full.slice(0, 40));
    damaged(bytes(SOI, JFIF, IMAGE)); // no end-of-image marker
    damaged(bytes(SOI, JFIF, [0x00, 0x11, 0x22, 0x33], EOI)); // bytes that are not a segment
    damaged(bytes(SOI, [0xff, 0xe1, 0xff, 0xff], [1, 2, 3], EOI)); // segment longer than the file
  });
});

/* ---------- PNG ---------- */

/** @param {string} type @param {Uint8Array | number[]} data  The checksum is not verified by the tool; zeros stand in. */
const chunk = (type, data) => bytes([0, 0, data.length >> 8, data.length & 0xff], ascii(type), data, [0, 0, 0, 0]);
const PNG_SIGNATURE = bytes([0x89], ascii('PNG\r\n\x1a\n'));
const PNG_IMAGE = [chunk('IHDR', [0, 0, 0, 1, 0, 0, 0, 1, 8, 2, 0, 0, 0]), chunk('sRGB', [0]), chunk('IDAT', [9, 8, 7, 6, 5])];
const IEND = chunk('IEND', []);

describe('photo tool: PNG', () => {
  const png = bytes(
    PNG_SIGNATURE,
    PNG_IMAGE[0],
    chunk('tEXt', ascii('Comment\0made at home')),
    chunk('iTXt', ascii('XML:com.adobe.xmp\0\0\0\0\0<x:xmpmeta/>')),
    chunk('eXIf', exifBlock({ orientation: 8 })),
    chunk('tIME', [7, 234, 11, 9, 14, 3, 22]),
    PNG_IMAGE[1],
    PNG_IMAGE[2],
    IEND,
    ascii('appended after the end'),
  );

  it('reports text notes, XMP, EXIF and data after the end', () => {
    const { type, findings } = inspectPhoto(png);
    assert.equal(type, 'png');
    assert.equal(findings.camera, 'Apple iPhone 15');
    assert.ok(findings.location);
    assert.deepEqual([...findings.flags].sort(), ['exif', 'other', 'text', 'thumbnail', 'trailing', 'xmp']);
  });

  it('keeps only the picture, plus the rotation with a valid checksum', () => {
    const { clean } = inspectPhoto(png);
    for (const secret of ['made at home', 'xmpmeta', 'Apple', 'tIME', 'appended']) assert.ok(!includes(clean, secret), `"${secret}" must be gone`);
    for (const part of PNG_IMAGE) assert.ok(includes(clean, part));
    assert.deepEqual([...clean.subarray(-IEND.length)], [...IEND], 'ends with the end chunk');

    // The added rotation chunk sits before the image data (readers ignore it after):
    // 26 bytes of TIFF, then the CRC-32 of "eXIf" + data.
    const at = PNG_SIGNATURE.length + PNG_IMAGE[0].length + PNG_IMAGE[1].length;
    assert.deepEqual([...clean.subarray(at + 38, at + 46)], [...PNG_IMAGE[2].subarray(0, 8)], 'image data follows it');
    assert.deepEqual([...clean.subarray(at, at + 8)], [0, 0, 0, 26, ...ascii('eXIf')]);
    assert.equal(parseExif(clean.subarray(at + 8, at + 34))?.orientation, 8);
    const crc = new DataView(clean.buffer, clean.byteOffset).getUint32(at + 34);
    assert.equal(crc, crc32Reference(clean.subarray(at + 4, at + 34)));

    const again = inspectPhoto(clean);
    assert.equal(hasFindings(again.findings), false);
    assert.deepEqual([...again.clean], [...clean]);
  });

  it('refuses a file that stops before its end chunk', () => {
    assert.throws(() => inspectPhoto(bytes(PNG_SIGNATURE, ...PNG_IMAGE)), (error) => error instanceof PhotoError && error.code === 'damaged');
    assert.throws(() => inspectPhoto(bytes(PNG_SIGNATURE, [0, 0, 0xff, 0xff], ascii('IDAT'), [1, 2])), (error) => error instanceof PhotoError && error.code === 'damaged');
  });
});

/** Bitwise CRC-32, written independently of the tool's table-based one. @param {Uint8Array} data */
function crc32Reference(data) {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/* ---------- WebP ---------- */

/** @param {string} type @param {Uint8Array | number[]} data */
const riffChunk = (type, data) => bytes(ascii(type), [data.length & 0xff, data.length >> 8, 0, 0], data, data.length % 2 ? [0] : []);
/** @param {...Uint8Array} chunks */
const webp = (...chunks) => {
  const body = bytes(ascii('WEBP'), ...chunks);
  return bytes(ascii('RIFF'), [body.length & 0xff, body.length >> 8, 0, 0], body);
};
const VP8 = riffChunk('VP8 ', [1, 2, 3, 4, 5]); // odd length: padded
const VP8X_FLAGS_AT = 12 + 8;

describe('photo tool: WebP', () => {
  const file = bytes(
    webp(riffChunk('VP8X', [0x2c, 0, 0, 0, 0, 0, 0, 0, 0, 0]), riffChunk('ICCP', [7, 7]), VP8, riffChunk('EXIF', exifBlock({ orientation: 3 })), riffChunk('XMP ', ascii('<x:xmpmeta/>'))),
    ascii('junk after the file'),
  );

  it('reports EXIF, XMP and data after the file', () => {
    const { type, findings } = inspectPhoto(file);
    assert.equal(type, 'webp');
    assert.equal(findings.camera, 'Apple iPhone 15');
    assert.deepEqual([...findings.flags].sort(), ['exif', 'thumbnail', 'trailing', 'xmp']);
  });

  it('removes it, fixes the header flags and size, and keeps the rotation', () => {
    const { clean } = inspectPhoto(file);
    for (const secret of ['Apple', 'xmpmeta', 'junk']) assert.ok(!includes(clean, secret), `"${secret}" must be gone`);
    assert.ok(includes(clean, VP8) && includes(clean, riffChunk('ICCP', [7, 7])), 'image and colour profile kept');
    assert.equal(new DataView(clean.buffer).getUint32(4, true), clean.length - 8, 'file size in the header matches');
    assert.equal(clean[VP8X_FLAGS_AT], 0x28, 'ICC and EXIF announced, XMP no longer');
    assert.equal(file[VP8X_FLAGS_AT], 0x2c, 'the original bytes are not modified');

    const again = inspectPhoto(clean);
    assert.equal(hasFindings(again.findings), false);
    assert.deepEqual([...again.clean], [...clean]);
  });

  it('leaves a simple WebP without metadata exactly as it is', () => {
    const simple = webp(VP8);
    const report = inspectPhoto(simple);
    assert.equal(hasFindings(report.findings), false);
    assert.deepEqual([...report.clean], [...simple]);
  });

  it('refuses files whose sizes do not add up', () => {
    const damaged = (/** @type {Uint8Array<ArrayBuffer>} */ data) => assert.throws(() => inspectPhoto(data), (error) => error instanceof PhotoError && error.code === 'damaged');
    damaged(file.slice(0, 30));
    damaged(bytes(ascii('RIFF'), [20, 0, 0, 0], ascii('WEBP'), ascii('VP8 '), [0xff, 0, 0, 0], [1, 2, 3, 4]));
    damaged(webp());
  });
});

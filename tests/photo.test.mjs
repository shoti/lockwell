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
import { PhotoError, detectType, hasFindings, inspectPhoto, parseExif, parseXmp } from '../src/client/tool-photo.mjs';

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

/** sRGB colorants (D50) and tone curve (IEC 61966-2.1), as in macOS's "sRGB Profile.icc", read 2026-11-13. */
const SRGB = [[0.43607, 0.22249, 0.01392], [0.38515, 0.71687, 0.09708], [0.14307, 0.06061, 0.7141]];
const SRGB_CURVE = [2.4, 1 / 1.055, 0.055 / 1.055, 1 / 12.92, 0.04045];

/**
 * A minimal display profile (ICC v4, matrix and curves), written here independently of the tool.
 * @param {{ name: string, copyright?: string, colorants: number[][], curve?: number[] }} options  curve: a gamma, or the five sRGB parameters.
 */
function iccProfile({ name, copyright = '', colorants, curve = [2.2] }) {
  const be32 = (/** @type {number} */ n) => [(n >>> 24) & 0xff, (n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
  const s15 = (/** @type {number} */ value) => be32(Math.round(value * 65536) >>> 0);
  const mluc = (/** @type {string} */ text) => bytes(ascii('mluc'), [0, 0, 0, 0], be32(1), be32(12), ascii('enUS'), be32(text.length * 2), be32(28), [...text].flatMap((char) => [char.charCodeAt(0) >> 8, char.charCodeAt(0) & 0xff]));
  const xyz = (/** @type {number[]} */ values) => bytes(ascii('XYZ '), [0, 0, 0, 0], ...values.map(s15));
  const tone = bytes(ascii('para'), [0, 0, 0, 0], [0, curve.length === 1 ? 0 : 3, 0, 0], ...curve.map(s15));
  /** @type {[string, Uint8Array][]} */
  const tags = [['desc', mluc(name)], ['cprt', mluc(copyright)], ['wtpt', xyz([0.9642, 1, 0.8249])], ['rXYZ', xyz(colorants[0])], ['gXYZ', xyz(colorants[1])], ['bXYZ', xyz(colorants[2])], ['rTRC', tone], ['gTRC', tone], ['bTRC', tone]];
  let at = 128 + 4 + tags.length * 12;
  const table = [];
  const data = [];
  for (const [signature, body] of tags) {
    const padded = bytes(body, new Array((4 - (body.length % 4)) % 4).fill(0));
    table.push(...ascii(signature), ...be32(at), ...be32(body.length));
    data.push(...padded);
    at += padded.length;
  }
  const header = new Array(128).fill(0);
  header.splice(0, 4, ...be32(at));
  header.splice(8, 4, 4, 0x30, 0, 0);
  header.splice(12, 12, ...ascii('mntrRGB XYZ '));
  header.splice(36, 4, ...ascii('acsp'));
  header.splice(68, 12, ...s15(0.9642), ...s15(1), ...s15(0.8249));
  return bytes(header, be32(tags.length), table, data);
}
/** A camera's sRGB profile, with its maker's copyright: the clean copy replaces it with a standard one. */
const CAMERA_SRGB = iccProfile({ name: 'sRGB IEC61966-2.1', copyright: 'Copyright camera maker', colorants: SRGB, curve: SRGB_CURVE });

/** The clean copy, which the test expects to be offered. @param {{ clean: Uint8Array<ArrayBuffer> | null }} report */
const cleanOf = (report) => {
  assert.ok(report.clean, 'a clean copy is offered');
  return report.clean;
};

/* ---------- EXIF builder (little-endian TIFF) ---------- */

/**
 * @typedef {{ tag: number, type: 'ascii', value: string } | { tag: number, type: 'byte' | 'short' | 'long', value: number }
 *   | { tag: number, type: 'rational', value: [number, number][] }} Entry
 */

const TYPE = { byte: 1, ascii: 2, short: 3, long: 4, rational: 5 };

/** @param {Entry} entry @returns {{ count: number, data: number[] }} */
function encode(entry) {
  const u16 = (/** @type {number} */ n) => [n & 0xff, n >> 8];
  const u32 = (/** @type {number} */ n) => [n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >>> 24) & 0xff];
  if (entry.type === 'ascii') return { count: entry.value.length + 1, data: [...ascii(entry.value), 0] };
  if (entry.type === 'rational') return { count: entry.value.length, data: entry.value.flatMap(([top, bottom]) => [...u32(top), ...u32(bottom)]) };
  if (entry.type === 'byte') return { count: 1, data: [entry.value] };
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
const ICC = segment(0xe2, bytes(ascii('ICC_PROFILE\0'), [1, 1], CAMERA_SRGB));
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
  it('recognises JPEG, PNG, WebP and HEIC by their first bytes, not by name', async () => {
    assert.equal(detectType(phoneJpeg()), 'jpeg');
    assert.equal(detectType(bytes([0x89], ascii('PNG\r\n\x1a\n'))), 'png');
    assert.equal(detectType(bytes(ascii('RIFF'), [4, 0, 0, 0], ascii('WEBP'))), 'webp');
    assert.equal(detectType(bytes([0, 0, 0, 24], ascii('ftypheic'))), 'heic');
    assert.equal(detectType(ascii('%PDF-1.7')), null);
  });

  it('explains unknown and broken files instead of guessing', async () => {
    await assert.rejects(inspectPhoto(bytes([0, 0, 0, 24], ascii('ftypheic'), [0, 0, 0, 0])), (error) => error instanceof PhotoError && error.code === 'damaged');
    await assert.rejects(inspectPhoto(ascii('%PDF-1.7 not a photo')), (error) => error instanceof PhotoError && error.code === 'unsupported');
    await assert.rejects(inspectPhoto(new Uint8Array(0)), (error) => error instanceof PhotoError && error.code === 'unsupported');
  });

});

describe('photo tool: EXIF', () => {
  it('reads location, device, date and rotation', async () => {
    const exif = parseExif(exifBlock());
    assert.ok(exif);
    assert.deepEqual(exif.fields, { camera: 'Apple iPhone 15', software: '18.1', taken: '2026-11-09 14:03', lens: 'iPhone 15 back camera 6.86mm f/1.6' });
    assert.equal(exif.orientation, 6);
    assert.ok(exif.location);
    assert.ok(Math.abs(exif.location.lat - 41.7151) < 1e-6, `lat ${exif.location.lat}`);
    assert.ok(Math.abs(exif.location.lon - 44.8271) < 1e-6, `lon ${exif.location.lon}`);
    assert.equal(exif.thumbnail, true);
    assert.equal(exif.details, true, 'lens and exposure count as further details');
  });

  it('survives damaged or hostile data without throwing', async () => {
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
  it('reports everything a phone photo carries', async () => {
    const { type, findings } = await inspectPhoto(phoneJpeg());
    assert.equal(type, 'jpeg');
    assert.ok(findings.location && Math.abs(findings.location.lat - 41.7151) < 1e-6);
    assert.equal(findings.fields.camera, 'Apple iPhone 15');
    assert.equal(findings.fields.taken, '2026-11-09 14:03');
    assert.equal(findings.fields.software, '18.1');
    // The Photoshop block here holds no caption or author: it is named for what it is.
    assert.deepEqual([...findings.flags].sort(), ['comment', 'exif', 'other', 'photoshop', 'thumbnail', 'trailing', 'xmp']);
  });

  it('removes all of it, keeps the image data byte for byte, and keeps colour and rotation', async () => {
    const clean = cleanOf(await inspectPhoto(phoneJpeg()));
    for (const secret of ['Apple', 'iPhone', '2026:11:09', 'xmpmeta', 'Nino', 'newsroom', 'MPF', 'MOTION-PHOTO']) {
      assert.ok(!includes(clean, secret), `"${secret}" must be gone`);
    }
    assert.ok(includes(clean, IMAGE), 'tables and compressed data are copied unchanged');
    assert.ok(includes(clean, 'ICC_PROFILE') && !includes(clean, ICC), 'a standard colour profile in place of the camera’s');
    assert.deepEqual([...clean.subarray(0, 2 + JFIF.length)], [...SOI, ...JFIF], 'starts with the JFIF header');
    assert.deepEqual([...clean.subarray(-2)], EOI, 'ends at the end-of-image marker');

    const again = await inspectPhoto(clean);
    assert.equal(hasFindings(again.findings), false, 'a clean copy has nothing left to report');
    assert.deepEqual([...cleanOf(again)], [...clean], 'cleaning twice changes nothing');
    const kept = parseExif(clean.subarray(2 + JFIF.length + 10));
    assert.equal(kept?.orientation, 6, 'the photo still knows which way is up');
    assert.equal(kept?.location, null);
  });

  it('adds no EXIF at all when the photo is already upright', async () => {
    const clean = cleanOf(await inspectPhoto(phoneJpeg({ orientation: 1 })));
    assert.ok(!includes(clean, 'Exif'));
    const profileAt = 2 + JFIF.length;
    const profileEnd = profileAt + 2 + ((clean[profileAt + 2] << 8) | clean[profileAt + 3]);
    assert.deepEqual([...clean.subarray(profileAt, profileAt + 4 + 12)], [0xff, 0xe2, clean[profileAt + 2], clean[profileAt + 3], ...ascii('ICC_PROFILE\0')]);
    assert.deepEqual([...clean.subarray(0, profileAt)], [...SOI, ...JFIF]);
    assert.deepEqual([...clean.subarray(profileEnd)], [...IMAGE, ...EOI], 'nothing else: header, standard profile, picture');
  });

  it('finds nothing in a photo that has nothing', async () => {
    const plain = bytes(SOI, JFIF, IMAGE, EOI);
    const report = await inspectPhoto(plain);
    assert.equal(hasFindings(report.findings), false);
    assert.deepEqual([...cleanOf(report)], [...plain]);
  });

  it('handles progressive photos (several scans) and photos without a JFIF header', async () => {
    const progressive = bytes(SOI, segment(0xe1, bytes(ascii('Exif\0\0'), exifBlock({ gps: false, thumbnail: false }))), TABLES, SCAN, segment(0xc4, [1, 2]), SCAN, EOI);
    const report = await inspectPhoto(progressive);
    const { findings } = report;
    const clean = cleanOf(report);
    assert.equal(findings.location, null);
    assert.equal(findings.fields.camera, 'Apple iPhone 15');
    assert.ok(includes(clean, bytes(TABLES, SCAN, segment(0xc4, [1, 2]), SCAN)), 'both scans kept in order');
    assert.deepEqual([...clean.subarray(0, 4)], [0xff, 0xd8, 0xff, 0xe1], 'rotation EXIF goes right after the start marker');
  });

  it('refuses cut-off or corrupt files instead of saving a broken copy', async () => {
    const full = phoneJpeg();
    const damaged = (/** @type {Uint8Array<ArrayBuffer>} */ file) => assert.rejects(inspectPhoto(file), (error) => error instanceof PhotoError && error.code === 'damaged');
    await damaged(full.slice(0, 40));
    await damaged(bytes(SOI, JFIF, IMAGE)); // no end-of-image marker
    await damaged(bytes(SOI, JFIF, [0x00, 0x11, 0x22, 0x33], EOI)); // bytes that are not a segment
    await damaged(bytes(SOI, [0xff, 0xe1, 0xff, 0xff], [1, 2, 3], EOI)); // segment longer than the file
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

  it('reports text notes, XMP, EXIF and data after the end', async () => {
    const { type, findings } = await inspectPhoto(png);
    assert.equal(type, 'png');
    assert.equal(findings.fields.camera, 'Apple iPhone 15');
    assert.ok(findings.location);
    assert.deepEqual(findings.texts, [{ key: 'Comment', text: 'made at home', cut: false }]);
    assert.deepEqual([...findings.flags].sort(), ['exif', 'other', 'thumbnail', 'trailing', 'xmp']);
  });

  it('keeps only the picture, plus the rotation with a valid checksum', async () => {
    const clean = cleanOf(await inspectPhoto(png));
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

    const again = await inspectPhoto(clean);
    assert.equal(hasFindings(again.findings), false);
    assert.deepEqual([...cleanOf(again)], [...clean]);
  });

  it('refuses a file that stops before its end chunk', async () => {
    await assert.rejects(inspectPhoto(bytes(PNG_SIGNATURE, ...PNG_IMAGE)), (error) => error instanceof PhotoError && error.code === 'damaged');
    await assert.rejects(inspectPhoto(bytes(PNG_SIGNATURE, [0, 0, 0xff, 0xff], ascii('IDAT'), [1, 2])), (error) => error instanceof PhotoError && error.code === 'damaged');
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
    webp(riffChunk('VP8X', [0x2c, 0, 0, 0, 0, 0, 0, 0, 0, 0]), riffChunk('ICCP', CAMERA_SRGB), VP8, riffChunk('EXIF', exifBlock({ orientation: 3 })), riffChunk('XMP ', ascii('<x:xmpmeta/>'))),
    ascii('junk after the file'),
  );

  it('reports EXIF, XMP and data after the file', async () => {
    const { type, findings } = await inspectPhoto(file);
    assert.equal(type, 'webp');
    assert.equal(findings.fields.camera, 'Apple iPhone 15');
    assert.deepEqual([...findings.flags].sort(), ['exif', 'thumbnail', 'trailing', 'xmp']);
  });

  it('removes it, fixes the header flags and size, and keeps the rotation', async () => {
    const clean = cleanOf(await inspectPhoto(file));
    for (const secret of ['Apple', 'xmpmeta', 'junk']) assert.ok(!includes(clean, secret), `"${secret}" must be gone`);
    assert.ok(includes(clean, VP8) && includes(clean, 'ICCP') && !includes(clean, CAMERA_SRGB), 'image kept, and a standard colour profile');
    assert.equal(new DataView(clean.buffer).getUint32(4, true), clean.length - 8, 'file size in the header matches');
    assert.equal(clean[VP8X_FLAGS_AT], 0x28, 'ICC and EXIF announced, XMP no longer');
    assert.equal(file[VP8X_FLAGS_AT], 0x2c, 'the original bytes are not modified');

    const again = await inspectPhoto(clean);
    assert.equal(hasFindings(again.findings), false);
    assert.deepEqual([...cleanOf(again)], [...clean]);
  });

  it('leaves a simple WebP without metadata exactly as it is', async () => {
    const simple = webp(VP8);
    const report = await inspectPhoto(simple);
    assert.equal(hasFindings(report.findings), false);
    assert.deepEqual([...cleanOf(report)], [...simple]);
  });

  it('refuses files whose sizes do not add up', async () => {
    const damaged = (/** @type {Uint8Array<ArrayBuffer>} */ data) => assert.rejects(inspectPhoto(data), (error) => error instanceof PhotoError && error.code === 'damaged');
    await damaged(file.slice(0, 30));
    await damaged(bytes(ascii('RIFF'), [20, 0, 0, 0], ascii('WEBP'), ascii('VP8 '), [0xff, 0, 0, 0], [1, 2, 3, 4]));
    await damaged(webp());
  });
});

/* ---------- Named fields, preview, IPTC, XMP, PNG text, C2PA ---------- */

/**
 * A TIFF block from directories; the pointers between them are filled in here.
 * @param {{ ifd0: Entry[], exif?: Entry[], gps?: Entry[], ifd1?: Entry[], preview?: Uint8Array }} parts
 */
function tiffBlock({ ifd0, exif = [], gps = [], ifd1 = [], preview }) {
  const pointers = (/** @type {number} */ exifAt, /** @type {number} */ gpsAt) => /** @type {Entry[]} */ ([
    ...(exif.length ? [{ tag: 0x8769, type: 'long', value: exifAt }] : []),
    ...(gps.length ? [{ tag: 0x8825, type: 'long', value: gpsAt }] : []),
  ]);
  const first = [...ifd0, ...pointers(0, 0)];
  const exifAt = 8 + ifdSize(first);
  const gpsAt = exifAt + (exif.length ? ifdSize(exif) : 0);
  const ifd1At = gpsAt + (gps.length ? ifdSize(gps) : 0);
  /** @param {number} at @returns {Entry[]} */
  const thumb = (at) => [...ifd1, ...(preview ? /** @type {Entry[]} */ ([{ tag: 0x0201, type: 'long', value: at }, { tag: 0x0202, type: 'long', value: preview.length }]) : [])];
  const hasIfd1 = ifd1.length > 0 || Boolean(preview);
  const previewAt = ifd1At + (hasIfd1 ? ifdSize(thumb(0)) : 0);
  return bytes(
    [0x49, 0x49, 42, 0, 8, 0, 0, 0],
    ifd([...ifd0, ...pointers(exifAt, gpsAt)], 8, hasIfd1 ? ifd1At : 0),
    exif.length ? ifd(exif, exifAt, 0) : [],
    gps.length ? ifd(gps, gpsAt, 0) : [],
    hasIfd1 ? ifd(thumb(previewAt), ifd1At, 0) : [],
    preview ?? [],
  );
}

const PREVIEW = bytes(SOI, TABLES, SCAN, EOI);

/** Everything that names a person or a device, plus a preview picture. */
const IDENTIFYING = tiffBlock({
  ifd0: [
    { tag: 0x010f, type: 'ascii', value: 'Canon' },
    { tag: 0x0110, type: 'ascii', value: 'Canon EOS R6' },
    { tag: 0x013b, type: 'ascii', value: 'Nino Beridze' },
    { tag: 0x8298, type: 'ascii', value: 'Example Newsroom' },
  ],
  exif: [
    { tag: 0xa420, type: 'ascii', value: '4f2a9c1e' },
    { tag: 0xa430, type: 'ascii', value: 'N. Beridze' },
    { tag: 0xa431, type: 'ascii', value: '082021001234' },
    { tag: 0xa433, type: 'ascii', value: 'Canon' },
    { tag: 0xa434, type: 'ascii', value: 'RF24-105mm F4 L IS USM' },
    { tag: 0xa435, type: 'ascii', value: '7310004321' },
    { tag: 0xa437, type: 'ascii', value: 'Giorgi Kapanadze' },
  ],
  gps: [
    { tag: 1, type: 'ascii', value: 'N' },
    { tag: 2, type: 'rational', value: [[41, 1], [42, 1], [5436, 100]] },
    { tag: 3, type: 'ascii', value: 'E' },
    { tag: 4, type: 'rational', value: [[44, 1], [49, 1], [3756, 100]] },
    { tag: 5, type: 'byte', value: 0 },
    { tag: 6, type: 'rational', value: [[5125, 10]] },
    { tag: 7, type: 'rational', value: [[10, 1], [3, 1], [22, 1]] },
    { tag: 16, type: 'ascii', value: 'T' },
    { tag: 17, type: 'rational', value: [[2455, 10]] },
    { tag: 29, type: 'ascii', value: '2026:11:09' },
  ],
  preview: PREVIEW,
});

/** @param {[number, number, string][]} datasets  record, dataset, value */
const iim = (datasets) =>
  bytes(...datasets.map(([record, dataset, value]) => {
    const data = new TextEncoder().encode(value);
    return bytes([0x1c, record, dataset, data.length >> 8, data.length & 0xff], data);
  }));

/** @param {[number, Uint8Array][]} resources  Photoshop image resources: ID and data. */
const photoshop = (resources) =>
  segment(0xed, bytes(ascii('Photoshop 3.0\0'), ...resources.map(([id, data]) =>
    bytes(ascii('8BIM'), [id >> 8, id & 0xff, 0, 0], [0, 0, data.length >> 8, data.length & 0xff], data, data.length % 2 ? [0] : []))));

const XMP = `<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
  <rdf:Description xmlns:exif="http://ns.adobe.com/exif/1.0/" xmlns:photoshop="http://ns.adobe.com/photoshop/1.0/"
    xmlns:exifEX="http://cipa.jp/exif/1.0/" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:xmp="http://ns.adobe.com/xap/1.0/"
    exif:GPSLatitude="41,42.906N" exif:GPSLongitude="44,49.626E" photoshop:City="Tbilisi" photoshop:Country="Georgia"
    xmp:CreatorTool="Adobe Lightroom">
    <exifEX:BodySerialNumber>082021001234</exifEX:BodySerialNumber>
    <dc:creator><rdf:Seq><rdf:li>Nino &amp; Giorgi</rdf:li></rdf:Seq></dc:creator>
    <dc:description><rdf:Alt><rdf:li xml:lang="x-default">Meeting at the office</rdf:li></rdf:Alt></dc:description>
  </rdf:Description></rdf:RDF></x:xmpmeta>`;

const xmpSegment = (/** @type {string} */ text) => segment(0xe1, bytes(ascii('http://ns.adobe.com/xap/1.0/\0'), new TextEncoder().encode(text)));
/** A C2PA manifest store as JPEG carries it: APP11, JPEG XT header, then a JUMBF box labelled "c2pa". */
const C2PA_JPEG = segment(0xeb, bytes(ascii('JP'), [0, 1, 0, 0, 0, 1], [0, 0, 0, 25], ascii('jumb'), [0, 0, 0, 17], ascii('jumd'), ascii('c2pa'), [0, 0, 0, 0, 0]));

describe('photo tool: what names a person or a device', () => {
  it('reads serial numbers, owner, author, unique ID, altitude, direction and GPS time by name', async () => {
    const exif = parseExif(IDENTIFYING);
    assert.ok(exif);
    assert.deepEqual(exif.fields, {
      camera: 'Canon EOS R6',
      lens: 'Canon RF24-105mm F4 L IS USM',
      serial: '082021001234',
      lensSerial: '7310004321',
      owner: 'N. Beridze',
      artist: 'Nino Beridze, Giorgi Kapanadze',
      copyright: 'Example Newsroom',
      uniqueId: '4f2a9c1e',
      altitude: '513',
      direction: '246',
      gpsTime: '2026-11-09 10:03:22',
    });
    assert.equal(exif.details, false, 'every tag in it is named above');
  });

  it('takes out the preview picture so it can be shown', async () => {
    const { findings } = await inspectPhoto(bytes(SOI, segment(0xe1, bytes(ascii('Exif\0\0'), IDENTIFYING)), IMAGE, EOI));
    assert.ok(findings.preview);
    assert.deepEqual([...findings.preview], [...PREVIEW]);
    assert.ok(findings.flags.has('thumbnail'));
  });

  it('ignores a preview that points outside the block', async () => {
    const broken = IDENTIFYING.slice(0, IDENTIFYING.length - 4);
    assert.equal(parseExif(broken)?.preview ?? null, null);
  });

  it('reads caption, author, place and copyright from the IPTC record of a Photoshop block', async () => {
    const iptc = iim([[1, 90, '\x1b%G'], [2, 0, '\0\x04'], [2, 120, 'Protest outside parliament'], [2, 80, 'Nino Beridze'], [2, 90, 'Tbilisi'], [2, 101, 'Georgia'], [2, 116, '© Example Newsroom'], [2, 25, 'politics'], [2, 25, 'protest']]);
    const report = await inspectPhoto(bytes(SOI, JFIF, photoshop([[0x0404, iptc]]), IMAGE, EOI));
    const { findings } = report;
    const clean = cleanOf(report);
    assert.deepEqual(findings.fields, {
      caption: 'Protest outside parliament',
      artist: 'Nino Beridze',
      place: 'Tbilisi, Georgia',
      copyright: '© Example Newsroom',
      keywords: 'politics, protest',
    });
    assert.deepEqual([...findings.flags], [], 'nothing beyond what is named');
    assert.ok(!includes(clean, 'Nino'));
  });

  it('names other IPTC details and other Photoshop data without claiming a caption', async () => {
    const { findings } = await inspectPhoto(bytes(SOI, JFIF, photoshop([[0x0404, iim([[2, 55, '20261109']])], [0x03ed, Uint8Array.of(0, 72, 0, 1)]]), IMAGE, EOI));
    assert.deepEqual(findings.fields, {});
    assert.deepEqual([...findings.flags].sort(), ['iptc', 'photoshop']);
  });

  it('reads a location, place, serial number and author stored only in XMP', async () => {
    const report = await inspectPhoto(bytes(SOI, JFIF, xmpSegment(XMP), IMAGE, EOI));
    const { findings } = report;
    const clean = cleanOf(report);
    assert.ok(findings.location);
    assert.ok(Math.abs(findings.location.lat - 41.7151) < 1e-6, `lat ${findings.location.lat}`);
    assert.ok(Math.abs(findings.location.lon - 44.8271) < 1e-6, `lon ${findings.location.lon}`);
    assert.deepEqual(findings.fields, {
      place: 'Tbilisi, Georgia',
      serial: '082021001234',
      artist: 'Nino & Giorgi',
      caption: 'Meeting at the office',
      software: 'Adobe Lightroom',
    });
    assert.ok(findings.flags.has('xmp'));
    assert.ok(!includes(clean, 'Tbilisi'));
  });

  it('reads XMP coordinates written with seconds, and south and west', async () => {
    const { findings } = await inspectPhoto(bytes(SOI, xmpSegment('<x:xmpmeta><rdf:RDF><rdf:Description exif:GPSLatitude="33,51,35.9S" exif:GPSLongitude="151,12,40W"/></rdf:RDF></x:xmpmeta>'), IMAGE, EOI));
    assert.ok(findings.location);
    assert.ok(Math.abs(findings.location.lat + (33 + 51 / 60 + 35.9 / 3600)) < 1e-6);
    assert.ok(Math.abs(findings.location.lon + (151 + 12 / 60 + 40 / 3600)) < 1e-6);
  });

  it('notices an HDR layer, which the clean copy drops', async () => {
    const hdr = '<x:xmpmeta><rdf:RDF><rdf:Description xmlns:hdrgm="http://ns.adobe.com/hdr-gain-map/1.0/" hdrgm:Version="1.0"/></rdf:RDF></x:xmpmeta>';
    const { findings } = await inspectPhoto(bytes(SOI, xmpSegment(hdr), IMAGE, EOI));
    assert.ok(findings.flags.has('hdr'));
  });

  it('names content credentials (C2PA) in JPEG, PNG and WebP and removes them', async () => {
    const jpeg = await inspectPhoto(bytes(SOI, JFIF, C2PA_JPEG, IMAGE, EOI));
    assert.deepEqual([...jpeg.findings.flags], ['c2pa']);
    assert.ok(!includes(jpeg.clean ?? new Uint8Array(), 'jumb'));
    const png = await inspectPhoto(bytes(PNG_SIGNATURE, PNG_IMAGE[0], chunk('caBX', ascii('jumbc2pa')), PNG_IMAGE[2], IEND));
    assert.deepEqual([...png.findings.flags], ['c2pa']);
    assert.ok(!includes(cleanOf(png), 'jumb'), 'a clean copy is offered, without them');
    const webpFile = await inspectPhoto(webp(riffChunk('VP8X', [0, 0, 0, 0, 0, 0, 0, 0, 0, 0]), VP8, riffChunk('C2PA', ascii('jumbc2pa'))));
    assert.deepEqual([...webpFile.findings.flags], ['c2pa']);
    assert.ok(!includes(cleanOf(webpFile), 'jumb'));
  });
});

describe('photo tool: PNG text', () => {
  it('shows what AI image tools and editors wrote, and what it could not read', async () => {
    const prompt = new TextEncoder().encode('ქალაქი ღამით');
    const long = 'x'.repeat(5000);
    const report = await inspectPhoto(bytes(
      PNG_SIGNATURE,
      PNG_IMAGE[0],
      chunk('tEXt', ascii('parameters\0a cat in Tbilisi, Steps: 20')),
      chunk('iTXt', bytes(ascii('prompt\0\0\0\0\0'), prompt)),
      chunk('tEXt', ascii(`workflow\0${long}`)),
      chunk('zTXt', bytes(ascii('Comment\0\0'), [0x78, 0x9c, 3, 0, 0, 0, 0, 1])),
      PNG_IMAGE[2],
      IEND,
    ));
    const { findings } = report;
    const clean = cleanOf(report);
    assert.deepEqual(findings.texts.map(({ key, cut }) => [key, cut]), [['parameters', false], ['prompt', false], ['workflow', true], ['Comment', false]]);
    assert.equal(findings.texts[0].text, 'a cat in Tbilisi, Steps: 20');
    assert.equal(findings.texts[1].text, 'ქალაქი ღამით');
    assert.ok((findings.texts[2].text ?? '').length < 1000, 'long text is cut for the page');
    assert.equal(findings.texts[3].text, null, 'compressed text is named, not shown');
    assert.ok(!includes(clean ?? new Uint8Array(), 'Tbilisi'));
  });

  it('reads XMP in a PNG as XMP, not as a text note', async () => {
    const { findings } = await inspectPhoto(bytes(PNG_SIGNATURE, PNG_IMAGE[0], chunk('iTXt', bytes(ascii('XML:com.adobe.xmp\0\0\0\0\0'), new TextEncoder().encode(XMP))), PNG_IMAGE[2], IEND));
    assert.deepEqual(findings.texts, []);
    assert.equal(findings.fields.place, 'Tbilisi, Georgia');
  });
});

/* ---------- HEIC and AVIF ---------- */

/** @param {number} n */
const u16be = (n) => [n >> 8, n & 0xff];
/** @param {number} n */
const u32be = (n) => [(n >>> 24) & 0xff, (n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
/** @param {string} type @param {...(Uint8Array | number[])} parts */
const box = (type, ...parts) => {
  const body = bytes(...parts);
  return bytes(u32be(8 + body.length), ascii(type), body);
};
/** @param {string} type @param {number} version @param {...(Uint8Array | number[])} parts */
const fullBox = (type, version, ...parts) => box(type, [version, 0, 0, 0], ...parts);
const C2PA_UUID = [0xd8, 0xfe, 0xc3, 0xd6, 0x1b, 0x0e, 0x48, 0x3c, 0x92, 0x97, 0x58, 0x28, 0x87, 0x7e, 0xc4, 0x81];

/**
 * A HEIF file as phones write it: a coded image, a thumbnail of it, EXIF and XMP items, and content credentials.
 * @param {{ brand?: string, compatible?: string[], exif?: Uint8Array, exifInIdat?: boolean, c2pa?: boolean }} [options]
 */
function heif({ brand = 'heic', compatible = ['mif1', 'heic'], exif = bytes([0, 0, 0, 6], ascii('Exif\0\0'), exifBlock({ orientation: 1 })), exifInIdat = false, c2pa = true } = {}) {
  const image = ascii('CODED-IMAGE-DATA');
  const thumb = ascii('CODED-THUMBNAIL');
  const xmp = new TextEncoder().encode(XMP);
  const ftyp = box('ftyp', ascii(brand), [0, 0, 0, 0], ...compatible.map(ascii));
  const infe = (/** @type {number} */ id, /** @type {string} */ type, /** @type {string} */ extra = '') => fullBox('infe', 2, u16be(id), [0, 0], ascii(type), ascii(`\0${extra}`));
  const items = [
    { id: 1, data: image, idat: false },
    { id: 2, data: exif, idat: exifInIdat },
    { id: 3, data: xmp, idat: false },
    { id: 4, data: thumb, idat: false },
  ];
  /** @param {number} mdatData  Where mdat's data starts in the file. */
  const meta = (mdatData) => {
    let inFile = mdatData;
    const iloc = fullBox('iloc', 1, [0x44, 0x00], u16be(items.length), ...items.map(({ id, data, idat }) => {
      const offset = idat ? 0 : inFile;
      if (!idat) inFile += data.length;
      return bytes(u16be(id), u16be(idat ? 1 : 0), u16be(0), u16be(1), u32be(offset), u32be(data.length));
    }));
    return fullBox(
      'meta',
      0,
      fullBox('hdlr', 0, [0, 0, 0, 0], ascii('pict'), new Array(12).fill(0), [0]),
      fullBox('pitm', 0, u16be(1)),
      fullBox('iinf', 0, u16be(4), infe(1, 'hvc1'), infe(2, 'Exif'), infe(3, 'mime', 'application/rdf+xml\0'), infe(4, 'hvc1')),
      fullBox('iref', 0, box('thmb', u16be(4), u16be(1), u16be(1))),
      iloc,
      ...(exifInIdat ? [box('idat', exif)] : []),
    );
  };
  const uuid = c2pa ? box('uuid', C2PA_UUID, ascii('c2pa manifest')) : new Uint8Array(0);
  const before = ftyp.length + meta(0).length + uuid.length + 8;
  const mdat = box('mdat', ...items.filter(({ idat }) => !idat).map(({ data }) => data));
  return { file: bytes(ftyp, meta(before), uuid, mdat), exif, xmp, image, thumb };
}

/** @param {Uint8Array} haystack @param {Uint8Array} needle */
function indexOf(haystack, needle) {
  for (let i = 0; i + needle.length <= haystack.length; i += 1) {
    if (needle.every((byte, j) => haystack[i + j] === byte)) return i;
  }
  return -1;
}

describe('photo tool: HEIC and AVIF', () => {
  it('recognises HEIC and AVIF', async () => {
    assert.equal(detectType(heif().file), 'heic');
    assert.equal(detectType(heif({ brand: 'avif', compatible: ['mif1', 'avif', 'miaf'] }).file), 'avif');
  });

  it('reports EXIF and XMP, and says what stays in the clean copy', async () => {
    const report = await inspectPhoto(heif().file);
    assert.equal(report.type, 'heic');
    assert.equal(report.findings.fields.camera, 'Apple iPhone 15');
    assert.ok(report.findings.location);
    assert.equal(report.findings.fields.place, 'Tbilisi, Georgia');
    for (const flag of /** @type {const} */ (['thumbnail', 'c2pa', 'xmp'])) assert.ok(report.findings.flags.has(flag), flag);
    assert.deepEqual([...report.kept].sort(), ['thumbnail'], 'content credentials are cut, not left in');
  });

  it('blanks EXIF with a valid empty TIFF and XMP with an empty packet, in place, touching nothing else', async () => {
    const { file, exif, xmp } = heif();
    const report = await inspectPhoto(file);
    const clean = report.clean;
    assert.ok(clean);
    assert.equal(report.verified, true);
    assert.equal(clean.length, file.length, 'every offset in the file stays valid');

    const exifAt = indexOf(file, exif);
    const xmpAt = indexOf(file, xmp);
    const c2pa = indexOf(file, bytes(ascii('uuid'), C2PA_UUID)) - 4;
    const c2paEnd = c2pa + new DataView(file.buffer).getUint32(c2pa);
    for (let i = 0; i < file.length; i += 1) {
      const inExif = i >= exifAt && i < exifAt + exif.length;
      const inXmp = i >= xmpAt && i < xmpAt + xmp.length;
      const inCredentials = i >= c2pa && i < c2paEnd;
      if (!inExif && !inXmp && !inCredentials) assert.equal(clean[i], file[i], `byte ${i} outside the metadata is unchanged`);
    }
    assert.deepEqual([...clean.subarray(c2pa + 4, c2pa + 8)], [...ascii('free')], 'the content credentials box is now empty space');
    assert.ok(clean.subarray(c2pa + 8, c2paEnd).every((byte) => byte === 0));
    // The offset field stays; what was between it and the TIFF header is zeroed; the TIFF is empty and in the same byte order.
    assert.deepEqual([...clean.subarray(exifAt, exifAt + 10)], [0, 0, 0, 6, 0, 0, 0, 0, 0, 0]);
    assert.deepEqual([...clean.subarray(exifAt + 10, exifAt + 24)], [0x49, 0x49, 42, 0, 8, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    assert.ok(clean.subarray(exifAt + 24, exifAt + exif.length).every((byte) => byte === 0));
    const packet = new TextDecoder().decode(clean.subarray(xmpAt, xmpAt + xmp.length));
    assert.match(packet, /^<x:xmpmeta xmlns:x="adobe:ns:meta\/"\/> *$/);
    for (const secret of ['Apple', 'Tbilisi', '082021001234']) assert.ok(!includes(clean, secret), `"${secret}" must be gone`);

    const again = await inspectPhoto(clean);
    assert.equal(again.findings.location, null);
    assert.deepEqual(again.findings.fields, {});
    assert.deepEqual([...again.findings.flags].sort(), ['thumbnail'], 'only what was said to stay');
  });

  it('handles EXIF stored inside the meta box (idat)', async () => {
    const { file } = heif({ exifInIdat: true });
    const report = await inspectPhoto(file);
    assert.equal(report.findings.fields.camera, 'Apple iPhone 15');
    assert.ok(report.clean && !includes(report.clean, 'Apple'));
  });

  it('refuses the compact HEIF layout it cannot read, and broken files', async () => {
    await assert.rejects(inspectPhoto(heif({ compatible: ['mif3', 'heic'] }).file), (error) => error instanceof PhotoError && error.code === 'compact');
    const { file } = heif();
    await assert.rejects(inspectPhoto(file.slice(0, file.length - 10)), (error) => error instanceof PhotoError && error.code === 'damaged');
  });

  it('does not offer a clean copy when EXIF is too short to replace safely', async () => {
    const report = await inspectPhoto(heif({ exif: Uint8Array.of(0, 0, 0, 0, 0x4d, 0x4d) }).file);
    assert.equal(report.clean, null);
    assert.equal(report.verified, false);
  });
});

describe('photo tool: the example', () => {
  it('puts a location, a device, an owner and a preview into a plain picture', async () => {
    const { examplePhoto } = await import('../src/client/tool-photo.mjs');
    const plain = bytes(SOI, JFIF, IMAGE, EOI);
    const example = examplePhoto(plain, PREVIEW);
    const report = await inspectPhoto(example);
    assert.ok(report.findings.location);
    for (const field of ['camera', 'serial', 'owner', 'taken', 'altitude', 'direction']) assert.ok(report.findings.fields[field], field);
    assert.deepEqual([...(report.findings.preview ?? [])], [...PREVIEW]);
    assert.ok(report.verified && report.clean);
    assert.ok(includes(report.clean, IMAGE), 'the picture itself is untouched');
  });
});

/* ---------- Review of 2026-11-13 ---------- */

/** @param {number} n */
const u32le = (n) => [n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >>> 24) & 0xff];
/**
 * A little-endian TIFF with raw entries (any type), in IFD0 and the GPS directory.
 * @typedef {{ tag: number, type: number, count: number, data: number[] }} Raw
 * @param {{ ifd0?: Raw[], gps?: Raw[] }} dirs
 */
function rawTiff({ ifd0 = [], gps = [] }) {
  const le16 = (/** @type {number} */ n) => [n & 0xff, n >> 8];
  const size = (/** @type {Raw[]} */ entries) => 2 + entries.length * 12 + 4 + entries.reduce((sum, e) => sum + (e.data.length > 4 ? e.data.length : 0), 0);
  const dir = (/** @type {Raw[]} */ entries, /** @type {number} */ at) => {
    const table = [...le16(entries.length)];
    /** @type {number[]} */
    const extra = [];
    const extraAt = at + 2 + entries.length * 12 + 4;
    for (const e of entries) {
      table.push(...le16(e.tag), ...le16(e.type), ...u32le(e.count));
      if (e.data.length > 4) {
        table.push(...u32le(extraAt + extra.length));
        extra.push(...e.data);
      } else table.push(...e.data, ...new Array(4 - e.data.length).fill(0));
    }
    return [...table, 0, 0, 0, 0, ...extra];
  };
  const withPointer = (/** @type {number} */ gpsAt) => [...ifd0, ...(gps.length ? [{ tag: 0x8825, type: 4, count: 1, data: u32le(gpsAt) }] : [])];
  const gpsAt = 8 + size(withPointer(0));
  return bytes([0x49, 0x49, 42, 0, 8, 0, 0, 0], dir(withPointer(gpsAt), 8), gps.length ? dir(gps, gpsAt) : []);
}
/** @param {number} tag @param {string} text @returns {Raw} */
const A = (tag, text) => ({ tag, type: 2, count: text.length + 1, data: [...ascii(text), 0] });
/** @param {number} tag @param {[number, number][]} values @param {number} [type] @returns {Raw} */
const R = (tag, values, type = 5) => ({ tag, type, count: values.length, data: values.flatMap(([top, bottom]) => [...u32le(top), ...u32le(bottom)]) });
/** @param {number} value @returns {Raw} */
const turned = (value) => ({ tag: 0x0112, type: 3, count: 1, data: [value, 0] });
/** @param {Uint8Array | number[]} tiff */
const exifSegment = (tiff) => segment(0xe1, bytes(ascii('Exif\0\0'), tiff));
const LATITUDE = R(2, [[41, 1], [42, 1], [5436, 100]]);
const LONGITUDE = R(4, [[44, 1], [49, 1], [3756, 100]]);
/** The raw bytes of the latitude: what the clean copy must not contain anywhere. */
const LATITUDE_BYTES = Uint8Array.from(LATITUDE.data);

/** @param {string} text */
const utf16be = (text) => new Uint8Array(Buffer.from(text, 'utf16le').swap16());
/** @param {Uint8Array} profile */
const iccSegment = (profile) => segment(0xe2, bytes(ascii('ICC_PROFILE\0'), [1, 1], profile));

describe('photo tool review 3.2: EXIF the tool could not read is not "nothing found"', () => {
  const full = rawTiff({ ifd0: [A(0x010f, 'Canon'), A(0x013b, 'Nino Beridze')], gps: [A(1, 'N'), LATITUDE, A(3, 'E'), LONGITUDE] });
  /** @type {[string, Uint8Array][]} */
  const cases = [
    ['IFD0 offset below 8', (() => { const bad = full.slice(); bad[4] = 4; return bad; })()],
    ['an entry count that runs past the block', (() => { const bad = full.slice(); bad[8] = 200; return bad; })()],
    ['GPS seconds 0/0', rawTiff({ gps: [A(1, 'N'), R(2, [[41, 1], [42, 1], [0, 0]]), A(3, 'E'), R(4, [[44, 1], [49, 1], [0, 0]])] })],
    ['GPS as signed rationals', rawTiff({ gps: [A(1, 'N'), R(2, [[41, 1], [42, 1], [5436, 100]], 10), A(3, 'E'), R(4, [[44, 1], [49, 1], [3756, 100]], 10)] })],
    ['GPS as one decimal rational', rawTiff({ gps: [A(1, 'N'), R(2, [[417151, 10000]]), A(3, 'E'), R(4, [[448271, 10000]])] })],
    ['latitude without longitude', rawTiff({ gps: [A(1, 'N'), LATITUDE] })],
    ['latitude above 90', rawTiff({ gps: [A(1, 'N'), R(2, [[91, 1], [0, 1], [0, 1]]), A(3, 'E'), LONGITUDE] })],
    ['location 0,0', rawTiff({ gps: [A(1, 'N'), R(2, [[0, 1], [0, 1], [0, 1]]), A(3, 'E'), R(4, [[0, 1], [0, 1], [0, 1]])] })],
    ['an Artist longer than 1,024 characters', rawTiff({ ifd0: [A(0x013b, 'N'.repeat(2000))] })],
    ['an Artist stored as UNDEFINED', rawTiff({ ifd0: [{ tag: 0x013b, type: 7, count: 12, data: [...ascii('Nino Beridze')] }] })],
  ];
  for (const [label, tiff] of cases) {
    it(`${label}: a finding, and a clean copy without the block`, async () => {
      const report = await inspectPhoto(bytes(SOI, JFIF, exifSegment(tiff), IMAGE, EOI));
      assert.ok(hasFindings(report.findings), 'not "nothing found"');
      const clean = cleanOf(report);
      assert.ok(!includes(clean, 'Exif'), 'no EXIF left');
      assert.ok(!includes(clean, 'Nino'));
    });
  }
  it('a block with only the rotation and the resolution says nothing', async () => {
    const report = await inspectPhoto(bytes(SOI, JFIF, exifSegment(rawTiff({ ifd0: [turned(1), { tag: 0x011a, type: 5, count: 1, data: [...u32le(72), ...u32le(1)] }] })), IMAGE, EOI));
    assert.equal(hasFindings(report.findings), false);
  });
});

describe('photo tool review 3.4: the JFIF header', () => {
  it('is rewritten to its fixed form, and a thumbnail in it is named', async () => {
    const jfif = segment(0xe0, bytes(ascii('JFIF\0'), [1, 2, 0, 0, 1, 0, 1, 4, 2], ascii('THUMBPIXELS-SECRET-FACE'), ascii('X')));
    const report = await inspectPhoto(bytes(SOI, jfif, IMAGE, EOI));
    assert.ok(report.findings.flags.has('thumbnail'));
    const clean = cleanOf(report);
    assert.ok(!includes(clean, 'SECRET-FACE'));
    assert.deepEqual([...clean.subarray(2, 20)], [0xff, 0xe0, 0, 16, ...ascii('JFIF\0'), 1, 2, 0, 0, 1, 0, 1, 0, 0]);
  });
});

describe('photo tool review 3.5: colour profiles (owner decision 2)', () => {
  const known = iccProfile({ name: 'sRGB built-in', copyright: 'Copyright Jane Doe', colorants: SRGB, curve: SRGB_CURVE });
  const monitor = iccProfile({ name: 'DELL U2720Q calibrated by Nino', colorants: [[0.5, 0.25, 0.01], [0.3, 0.68, 0.05], [0.16, 0.07, 0.77]] });

  it('replaces a well-known profile with a minimal standard one', async () => {
    const report = await inspectPhoto(bytes(SOI, JFIF, iccSegment(known), IMAGE, EOI));
    const clean = cleanOf(report);
    assert.ok(!includes(clean, utf16be('Jane Doe')), 'the original profile is gone');
    assert.ok(!includes(clean, utf16be('sRGB built-in')));
    assert.ok(includes(clean, 'ICC_PROFILE'), 'a profile stays, so colours look the same');
    assert.ok(includes(clean, utf16be('sRGB')), 'the standard one, named sRGB');
  });

  it('reports any other profile by name, keeps it, and drops it when asked', async () => {
    const report = await inspectPhoto(bytes(SOI, JFIF, iccSegment(monitor), IMAGE, EOI));
    assert.equal(report.findings.fields.profile, 'DELL U2720Q calibrated by Nino');
    assert.ok(report.kept.has('profile'));
    assert.ok(includes(cleanOf(report), 'ICC_PROFILE'));
    const dropped = await inspectPhoto(bytes(SOI, JFIF, iccSegment(monitor), IMAGE, EOI), { dropProfile: true });
    assert.ok(!includes(cleanOf(dropped), 'ICC_PROFILE'));
    assert.ok(!dropped.kept.has('profile'));
  });

  it('reports two profiles whose pieces collide as one it could not read, rather than picking one', async () => {
    const report = await inspectPhoto(bytes(SOI, JFIF, iccSegment(monitor), iccSegment(known), IMAGE, EOI));
    assert.equal(report.findings.fields.profile, '', 'no name to show');
    assert.ok(report.kept.has('profile'));
    assert.ok(includes(cleanOf(report), utf16be('DELL U2720Q')), 'kept as found, until the visitor removes it');
    assert.ok(!includes(cleanOf(await inspectPhoto(bytes(SOI, JFIF, iccSegment(monitor), iccSegment(known), IMAGE, EOI), { dropProfile: true })), 'ICC_PROFILE'));
  });

  it('does the same in PNG (compressed) and WebP', async () => {
    const { deflateSync } = await import('node:zlib');
    const png = await inspectPhoto(bytes(PNG_SIGNATURE, PNG_IMAGE[0], chunk('iCCP', bytes(ascii('ICC Profile\0\0'), deflateSync(monitor))), PNG_IMAGE[2], IEND));
    assert.equal(png.findings.fields.profile, 'DELL U2720Q calibrated by Nino');
    const pngKnown = await inspectPhoto(bytes(PNG_SIGNATURE, PNG_IMAGE[0], chunk('iCCP', bytes(ascii('Jane Doe\0\0'), deflateSync(known))), PNG_IMAGE[2], IEND));
    assert.ok(!includes(cleanOf(pngKnown), 'Jane Doe'), 'not the name of the chunk');
    assert.ok(!includes(cleanOf(pngKnown), 'iCCP'), 'PNG says sRGB with its own small chunk instead');
    const webpFile = await inspectPhoto(webp(riffChunk('VP8X', [0x20, 0, 0, 0, 0, 0, 0, 0, 0, 0]), riffChunk('ICCP', monitor), VP8));
    assert.equal(webpFile.findings.fields.profile, 'DELL U2720Q calibrated by Nino');
  });
});

describe('photo tool review 3.6: only known structures are kept', () => {
  it('JPEG: drops markers outside the list, and an Adobe segment of the wrong size', async () => {
    const report = await inspectPhoto(bytes(SOI, JFIF, segment(0xee, ascii('Adobe-HIDDEN-PAYLOAD-1')), segment(0xf7, ascii('HIDDEN-PAYLOAD-2')), IMAGE, EOI));
    assert.ok(hasFindings(report.findings));
    const clean = cleanOf(report);
    assert.ok(!includes(clean, 'HIDDEN-PAYLOAD-1'));
    assert.ok(!includes(clean, 'HIDDEN-PAYLOAD-2'));
    const adobe = segment(0xee, bytes(ascii('Adobe'), [0, 100, 0, 0, 0, 0, 1]));
    assert.ok(includes(cleanOf(await inspectPhoto(bytes(SOI, adobe, IMAGE, EOI))), 'Adobe'), 'the real Adobe segment stays: it says how colours are stored');
  });

  it('WebP: looks inside animation frames', async () => {
    const report = await inspectPhoto(webp(riffChunk('VP8X', [2, 0, 0, 0, 0, 0, 0, 0, 0, 0]), riffChunk('ANIM', [0, 0, 0, 0, 0, 0]), riffChunk('ANMF', bytes(new Array(16).fill(0), riffChunk('XMP ', ascii('NESTED-SECRET')), VP8))));
    assert.ok(hasFindings(report.findings));
    assert.ok(!includes(cleanOf(report), 'NESTED-SECRET'));
  });
});

describe('photo tool review 3.7: two EXIF blocks', () => {
  it('the first rotation wins, as readers show it', async () => {
    const report = await inspectPhoto(bytes(SOI, exifSegment(rawTiff({ ifd0: [turned(6)] })), exifSegment(rawTiff({ ifd0: [turned(1), A(0x010f, 'Canon')] })), IMAGE, EOI));
    const clean = cleanOf(report);
    assert.ok(includes(clean, bytes([0x01, 0x12, 0, 3, 0, 0, 0, 1, 0, 6])), 'orientation 6 kept');
  });
});

describe('photo tool review 3.9: copies that could not be drawn', () => {
  it('refuses Apple-optimised PNG, and PNG without a header or image data', async () => {
    await assert.rejects(inspectPhoto(bytes(PNG_SIGNATURE, chunk('CgBI', [0x50, 0, 0x20, 2]), PNG_IMAGE[0], PNG_IMAGE[2], IEND)), (error) => error instanceof PhotoError && error.code === 'optimised');
    await assert.rejects(inspectPhoto(bytes(PNG_SIGNATURE, IEND)), (error) => error instanceof PhotoError && error.code === 'damaged');
    await assert.rejects(inspectPhoto(bytes(PNG_SIGNATURE, PNG_IMAGE[0], IEND)), (error) => error instanceof PhotoError && error.code === 'damaged');
  });
});

describe('photo tool review 3.10: XMP built to be slow', () => {
  it('is read in a fraction of a second', async () => {
    const started = performance.now();
    parseXmp('<dc:creator>'.repeat(80000));
    parseXmp(`<x:xmpmeta>${' a="b"'.repeat(500000)}</x:xmpmeta>`);
    assert.ok(performance.now() - started < 1000, `${Math.round(performance.now() - started)} ms`);
  });
});

describe('photo tool review: WebP details', () => {
  it('refuses a VP8X header that is not first, without touching the original', async () => {
    const original = webp(riffChunk('ICCP', [7, 7, 7, 7]), riffChunk('VP8X', [0x2c, 0, 0, 0, 0, 0, 0, 0, 0, 0]), VP8);
    const copy = original.slice();
    await assert.rejects(inspectPhoto(original), (error) => error instanceof PhotoError && error.code === 'damaged');
    assert.deepEqual(original, copy);
  });

  it('refuses a VP8X header too short to hold its fields, instead of failing', async () => {
    await assert.rejects(inspectPhoto(webp(riffChunk('VP8X', [0, 0, 0, 0]), VP8)), (error) => error instanceof PhotoError && error.code === 'damaged');
  });

  it('keeps the rotation of a simple WebP by adding the header that announces it', async () => {
    // A lossy frame of 3 × 2 pixels: frame tag, start code, then 14-bit width and height.
    const frame = riffChunk('VP8 ', [0x30, 0x01, 0x00, 0x9d, 0x01, 0x2a, 3, 0, 2, 0, 0xaa, 0xbb]);
    const report = await inspectPhoto(webp(frame, riffChunk('EXIF', rawTiff({ ifd0: [turned(6), A(0x010f, 'Canon')] }))));
    const clean = cleanOf(report);
    assert.equal(String.fromCharCode(...clean.subarray(12, 16)), 'VP8X');
    assert.equal(clean[VP8X_FLAGS_AT] & 0x08, 0x08, 'EXIF announced');
    assert.deepEqual([...clean.subarray(VP8X_FLAGS_AT + 4, VP8X_FLAGS_AT + 10)], [2, 0, 0, 1, 0, 0], 'canvas 3 × 2, stored minus one');
    assert.ok(includes(clean, bytes([0x01, 0x12, 0, 3, 0, 0, 0, 1, 0, 6])));
    assert.ok(!includes(clean, 'Canon'));
  });
});

describe('photo tool review: what is shown', () => {
  it('drops invisible and direction characters from values, and caps how much is listed', async () => {
    const tricky = 'Nino؜­\u{e0041}Beridze';
    const report = await inspectPhoto(bytes(SOI, exifSegment(rawTiff({ ifd0: [{ tag: 0x013b, type: 2, count: 0, data: [] }, { ...A(0x013b, ''), data: [...new TextEncoder().encode(tricky), 0], count: new TextEncoder().encode(tricky).length + 1 }] })), IMAGE, EOI));
    assert.equal(report.findings.fields.artist, 'Nino Beridze');
    const many = bytes(PNG_SIGNATURE, PNG_IMAGE[0], ...Array.from({ length: 120 }, (_, n) => chunk('tEXt', ascii(`note${n}\0text`))), PNG_IMAGE[2], IEND);
    const notes = (await inspectPhoto(many)).findings;
    assert.equal(notes.texts.length, 50);
    assert.equal(notes.moreTexts, 70);
  });
});

describe('photo tool review 3.3 and 3.8: HEIC and AVIF', () => {
  /**
   * A HEIF file with extra top-level boxes, extra meta children, item names, an auxiliary image, or an EXIF
   * extent that runs to the end of the file.
   * @param {{ top?: Uint8Array[], metaExtra?: Uint8Array[], name?: string, aux?: boolean, exifToEnd?: boolean, exifType?: string, exif?: Uint8Array }} [options]
   */
  function heifWith({ top = [], metaExtra = [], name = '', aux = false, exifToEnd = false, exifType = 'Exif', exif = bytes([0, 0, 0, 0], rawTiff({ ifd0: [A(0x013b, 'Nino Beridze')], gps: [A(1, 'N'), LATITUDE, A(3, 'E'), LONGITUDE] })) } = {}) {
    const image = ascii('CODED-IMAGE-DATA');
    const depth = ascii('DEPTH-MAP-DATA');
    const ftyp = box('ftyp', ascii('heic'), [0, 0, 0, 0], ascii('mif1'), ascii('heic'));
    const infe = (/** @type {number} */ id, /** @type {string} */ type, /** @type {string} */ itemName = '') => fullBox('infe', 2, u16be(id), [0, 0], ascii(type), ascii(`${itemName}\0`));
    const items = [{ id: 1, data: image }, { id: 3, data: depth }, { id: 2, data: exif }];
    /** @param {number} mdatData */
    const meta = (mdatData) => {
      let at = mdatData;
      const iloc = fullBox('iloc', 1, [0x44, 0x00], u16be(items.length), ...items.map(({ id, data }) => {
        const entry = bytes(u16be(id), u16be(0), u16be(0), u16be(1), u32be(at), u32be(id === 2 && exifToEnd ? 0 : data.length));
        at += data.length;
        return entry;
      }));
      return fullBox(
        'meta',
        0,
        fullBox('hdlr', 0, [0, 0, 0, 0], ascii('pict'), new Array(12).fill(0), [0]),
        fullBox('pitm', 0, u16be(1)),
        fullBox('iinf', 0, u16be(3), infe(1, 'hvc1', name), infe(3, 'hvc1'), infe(2, exifType)),
        fullBox('iref', 0, ...(aux ? [box('auxl', u16be(3), u16be(1), u16be(1))] : [])),
        iloc,
        ...metaExtra,
      );
    };
    const before = ftyp.length + meta(0).length + top.reduce((sum, item) => sum + item.length, 0) + 8;
    return bytes(ftyp, meta(before), ...top, box('mdat', ...items.map(({ data }) => data)));
  }

  it('cuts top-level boxes outside the list (motion video, XMP, user data, unknown), keeping every offset', async () => {
    const top = [box('mpvd', ascii('MOTION-VIDEO')), box('uuid', new Array(16).fill(7), ascii('<x:xmpmeta>XMP-SECRET</x:xmpmeta>')), box('udta', ascii('USERDATA-SECRET')), box('sefd', ascii('SAMSUNG-SECRET'))];
    const file = heifWith({ top });
    const report = await inspectPhoto(file);
    assert.ok(report.findings.flags.has('other'));
    const clean = cleanOf(report);
    assert.equal(clean.length, file.length, 'same length: offsets stay valid');
    for (const secret of ['MOTION-VIDEO', 'XMP-SECRET', 'USERDATA-SECRET', 'SAMSUNG-SECRET']) assert.ok(!includes(clean, secret), secret);
    assert.ok(includes(clean, 'CODED-IMAGE-DATA'));
  });

  it('a file with nothing but a motion video is not "nothing found"', async () => {
    const report = await inspectPhoto(heifWith({ top: [box('mpvd', ascii('MOTION-VIDEO'))], exif: bytes([0, 0, 0, 0], rawTiff({ ifd0: [turned(1)] })) }));
    assert.ok(hasFindings(report.findings));
  });

  it('blanks item names and cuts unknown boxes inside meta', async () => {
    const report = await inspectPhoto(heifWith({ name: 'IMG_20261109_Nino.heic', metaExtra: [box('udta', ascii('META-USERDATA'))] }));
    const clean = cleanOf(report);
    assert.ok(!includes(clean, 'IMG_20261109_Nino'));
    assert.ok(!includes(clean, 'META-USERDATA'));
  });

  it('lists auxiliary pictures (depth maps, mattes, gain maps) as left in', async () => {
    const report = await inspectPhoto(heifWith({ aux: true }));
    assert.ok(report.kept.has('auxiliary'));
  });

  it('removes the location bytes and the name, reading an item type in any case', async () => {
    for (const exifType of ['Exif', 'exif']) {
      const report = await inspectPhoto(heifWith({ exifType }));
      assert.equal(report.findings.fields.artist, 'Nino Beridze', exifType);
      const clean = cleanOf(report);
      assert.ok(!includes(clean, LATITUDE_BYTES));
      assert.ok(!includes(clean, 'Nino'));
    }
  });

  it('zeroes what sits between the offset field and the TIFF header', async () => {
    const exif = bytes([0, 0, 0, 12], ascii('GAP-SECRET!!'), rawTiff({ ifd0: [A(0x013b, 'Nino Beridze')] }));
    assert.ok(!includes(cleanOf(await inspectPhoto(heifWith({ exif }))), 'GAP-SECRET'));
  });

  it('3.8: offers no copy when a metadata extent runs to the end of the file', async () => {
    const report = await inspectPhoto(heifWith({ exifToEnd: true }));
    assert.equal(report.clean, null);
  });

  it('offers no copy when a value it found is still in a part it leaves (independent check)', async () => {
    const report = await inspectPhoto(heifWith({ top: [box('moov', ascii('video by Nino Beridze'))] }));
    assert.equal(report.findings.fields.artist, 'Nino Beridze');
    assert.equal(report.clean, null);
  });
});

describe('photo tool review: animated and AVIF files', () => {
  it('an animated PNG keeps every frame and its timing, and loses its notes', async () => {
    const animation = [chunk('acTL', [0, 0, 0, 2, 0, 0, 0, 0]), chunk('fcTL', new Array(26).fill(0)), PNG_IMAGE[2], chunk('fcTL', new Array(26).fill(1)), chunk('fdAT', [0, 0, 0, 2, 4, 4, 4])];
    const report = await inspectPhoto(bytes(PNG_SIGNATURE, PNG_IMAGE[0], chunk('tEXt', ascii('Author\0Nino Beridze')), ...animation, IEND));
    const clean = cleanOf(report);
    for (const part of animation) assert.ok(includes(clean, part), fourCcOf(part));
    assert.ok(!includes(clean, 'Nino'));
  });

  it('an AVIF is cleaned like a HEIC', async () => {
    const { file } = heif({ brand: 'avif', compatible: ['mif1', 'avif', 'miaf'] });
    const report = await inspectPhoto(file);
    assert.equal(report.type, 'avif');
    const clean = cleanOf(report);
    for (const secret of ['Apple', 'Tbilisi', '082021001234']) assert.ok(!includes(clean, secret), secret);
    assert.ok(includes(clean, 'CODED-IMAGE-DATA'));
  });
});

/** @param {Uint8Array} part  A PNG chunk. */
function fourCcOf(part) {
  return String.fromCharCode(...part.subarray(4, 8));
}

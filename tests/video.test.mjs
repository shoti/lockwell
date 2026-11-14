// @ts-check
/**
 * @file Tests for the video metadata tool.
 */
/**
 * The fixtures are small QuickTime files assembled here byte by byte, independently of the tool: real box layouts
 * (QuickTime File Format, ISO 14496-12, GoPro GPMF) around made-up picture data, which the tool must leave untouched.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  MAX_PATCHES,
  VideoError,
  cleanVideo,
  gpmfPoints,
  hasFindings,
  inspectVideo,
  parseIso6709,
  quickTimeDate,
  readGpmf,
  sampleRanges,
  userText,
  verifyClean,
} from '../src/client/tool-video.mjs';
import { readBoxes } from '../src/client/bmff.mjs';

/** @param {number} n */
const u16 = (n) => [(n >>> 8) & 0xff, n & 0xff];
/** @param {number} n */
const u32 = (n) => [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff];
/** @param {number} n  May be negative. */
const i32 = (n) => u32(n >>> 0);
/** @param {string} text  One byte per character. */
const chars = (text) => Array.from(text, (char) => char.charCodeAt(0));
/** @param {string} text */
const utf8 = (text) => [...new TextEncoder().encode(text)];
/** @param {number} n @param {number} [value] */
const fill = (n, value = 0) => new Array(n).fill(value);

/** @param {string} type @param {...number[]} parts */
function box(type, ...parts) {
  const body = parts.flat();
  return [...u32(8 + body.length), ...chars(type), ...body];
}
/** Version and flags 0, then fields. @param {string} type @param {...number[]} parts */
const full = (type, ...parts) => box(type, [0, 0, 0, 0], ...parts);

/** 1904-01-01 to 2026-11-09 14:03:22 UTC, in seconds. */
const RECORDED = (Date.UTC(2026, 10, 9, 14, 3, 22) - Date.UTC(1904, 0, 1)) / 1000;

const mvhd = () => full('mvhd', u32(RECORDED), u32(RECORDED), u32(600), u32(600), fill(80));
/** @param {number} id */
const tkhd = (id) => full('tkhd', u32(RECORDED), u32(RECORDED), u32(id), fill(72));
const mdhd = () => full('mdhd', u32(RECORDED), u32(RECORDED), u32(600), u32(600), u16(0), u16(0));
/** A QuickTime handler with a name written with a length byte first. @param {string} kind @param {string} name */
const hdlr = (kind, name) => full('hdlr', chars('mhlr'), chars(kind), fill(12), [name.length, ...chars(name)]);

/** A video sample description whose encoder is named `encoder` (32-byte field, length byte first). @param {string} encoder */
function videoEntry(encoder) {
  const name = [encoder.length, ...chars(encoder), ...fill(31 - encoder.length)];
  return box('avc1', fill(6), u16(1), fill(16), u16(16), u16(16), u32(0x480000), u32(0x480000), u32(0), u16(1), name, u16(24), u16(0xffff));
}

/**
 * A track with one chunk of samples at `offset`.
 * @param {{ id: number, kind: string, name: string, entry: number[], offset: number, sizes: number[] }} track
 */
function trak({ id, kind, name, entry, offset, sizes }) {
  const stbl = box(
    'stbl',
    full('stsd', u32(1), entry),
    full('stsz', u32(0), u32(sizes.length), ...sizes.map(u32)),
    full('stsc', u32(1), u32(1), u32(sizes.length), u32(1)),
    full('stco', u32(1), u32(offset)),
  );
  return box('trak', tkhd(id), box('mdia', mdhd(), hdlr(kind, name), box('minf', stbl)));
}

/** One GPMF item: key, type, structure size, repeat, data padded to 4 bytes. @param {string} key @param {string} type @param {number} size @param {number} repeat @param {number[]} data */
function klv(key, type, size, repeat, data) {
  return [...chars(key), type === '\0' ? 0 : type.charCodeAt(0), size, ...u16(repeat), ...data, ...fill((4 - (data.length % 4)) % 4)];
}
/** @param {string} key @param {number[]} items */
const nest = (key, items) => klv(key, '\0', 1, items.length, items);

/** A GPMF sample with a GPS5 stream of the given positions (degrees). @param {[number, number][]} points */
function gps5Sample(points) {
  const scale = klv('SCAL', 'l', 4, 5, [10_000_000, 10_000_000, 1000, 1000, 100].flatMap(i32));
  const gps = klv('GPS5', 'l', 20, points.length, points.flatMap(([lat, lon]) => [...i32(Math.round(lat * 1e7)), ...i32(Math.round(lon * 1e7)), ...i32(450_000), ...i32(0), ...i32(0)]));
  return nest('DEVC', [...klv('DVNM', 'c', 1, 6, chars('Camera')), ...nest('STRM', [...scale, ...gps])]);
}

/** QuickTime metadata (handler mdta): keys and their values. @param {[string, string][]} entries */
function mdtaMeta(entries) {
  const keys = full('keys', u32(entries.length), ...entries.map(([key]) => [...u32(8 + utf8(key).length), ...chars('mdta'), ...utf8(key)]));
  const items = entries.map(([, value], i) => [...u32(8 + 16 + utf8(value).length), ...u32(i + 1), ...box('data', u32(1), u32(0), utf8(value))]);
  return box('meta', full('hdlr', u32(0), chars('mdta'), fill(12), [0]), keys, box('ilst', ...items));
}

/** QuickTime international text: length, language, text. @param {string} text */
const intlText = (text) => [...u16(utf8(text).length), ...u16(0x15c7), ...utf8(text)];

const XMP = '<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF><rdf:Description tiff:Model="iPhone 15" dc:creator="Nino Beridze"/></rdf:RDF></x:xmpmeta>';
const XMP_UUID = [0xbe, 0x7a, 0xcf, 0xcb, 0x97, 0xa9, 0x42, 0xe8, 0x9c, 0x71, 0x99, 0x94, 0x91, 0xe3, 0xaf, 0xac];

/**
 * A recording as a phone and an action camera together would write it: ftyp, mdat (picture and GPS samples), moov,
 * then data hidden in free space and an XMP packet.
 */
function sampleVideo() {
  const ftyp = box('ftyp', chars('qt  '), u32(0), chars('qt  '));
  const picture = fill(64, 0xaa);
  const gpsA = gps5Sample([[41.7151, 44.8271], [41.7152, 44.8272]]);
  const gpsB = gps5Sample([[41.7160, 44.8280]]);
  const mdatStart = ftyp.length;
  const pictureAt = mdatStart + 8;
  const gpsAt = pictureAt + picture.length;
  const mdat = box('mdat', picture, gpsA, gpsB);
  const moov = box(
    'moov',
    mvhd(),
    trak({ id: 1, kind: 'vide', name: 'Core Media Video', entry: videoEntry('Test encoder'), offset: pictureAt, sizes: [64] }),
    trak({ id: 2, kind: 'meta', name: 'GoPro MET', entry: box('gpmd', fill(6), u16(1)), offset: gpsAt, sizes: [gpsA.length, gpsB.length] }),
    box('udta', box('\xa9xyz', intlText('+41.7151+044.8271/')), box('\xa9mak', intlText('Apple')), box('\xa9mod', intlText('iPhone 15')), box('ludt', fill(8, 7))),
    mdtaMeta([
      ['com.apple.quicktime.creationdate', '2026-11-09T18:03:22+0400'],
      ['com.apple.quicktime.content.identifier', 'EE6D649E-788F-4E3A-BCD2-483651BF7B34'],
      ['com.apple.quicktime.camera.focal_length.35mm_equivalent', '26'],
    ]),
  );
  const hidden = box('free', utf8('$GPRMC,140322,A,4142.906,N,04449.626,E'));
  const xmp = box('uuid', XMP_UUID, utf8(XMP));
  const bytes = Uint8Array.from([...ftyp, ...mdat, ...moov, ...hidden, ...xmp]);
  return { bytes, picture: { at: pictureAt, length: picture.length } };
}

/** @param {Blob} blob */
const bytesOf = async (blob) => new Uint8Array(await blob.arrayBuffer());

describe('parseIso6709', () => {
  it('reads decimal degrees as phones write them, with and without altitude', () => {
    assert.deepEqual(parseIso6709('+47.3764+008.5446+433.724/'), { lat: 47.3764, lon: 8.5446, alt: 433.724 });
    assert.deepEqual(parseIso6709('+41.7151+044.8271/'), { lat: 41.7151, lon: 44.8271 });
  });

  it('reads Android degrees without leading zeros', () => {
    assert.deepEqual(parseIso6709('+45.4317+7.3713/'), { lat: 45.4317, lon: 7.3713 });
    assert.deepEqual(parseIso6709('+51.4169-000.0806/'), { lat: 51.4169, lon: -0.0806 });
  });

  it('reads degree-minute and degree-minute-second forms', () => {
    const minutes = parseIso6709('+4142.906+04449.626/');
    assert.ok(minutes && Math.abs(minutes.lat - 41.7151) < 1e-4 && Math.abs(minutes.lon - 44.8271) < 1e-4);
    const seconds = parseIso6709('-334530.0-0700000.0/');
    assert.ok(seconds && Math.abs(seconds.lat + 33.7583) < 1e-4 && seconds.lon === -70);
  });

  it('rejects text that is not a position on the globe', () => {
    assert.equal(parseIso6709('hello'), null);
    assert.equal(parseIso6709('+95.0+010.0/'), null);
    assert.equal(parseIso6709('+45.0+190.0/'), null);
  });
});

describe('userText', () => {
  it('reads QuickTime international text, 3GPP text and plain text', () => {
    assert.equal(userText(Uint8Array.from(intlText('+45.4317+7.3713/'))), '+45.4317+7.3713/');
    assert.equal(userText(Uint8Array.from([0, 0, 0, 0, 0x55, 0xc4, ...utf8('My Movie'), 0])), 'My Movie');
    assert.equal(userText(Uint8Array.from([...chars('HD8.01.01.20.00')])), 'HD8.01.01.20.00');
    assert.equal(userText(Uint8Array.from([...chars('C3343224520348'), 0, 0, 0, 0])), 'C3343224520348');
  });

  it('reads UTF-16 with a byte order mark and drops control characters', () => {
    assert.equal(userText(Uint8Array.from([0, 0, 0, 0, 0x15, 0xc7, 0xfe, 0xff, 0, 0x54, 0x10, 0xd7, 0, 0])), 'Tთ');
    const tricky = utf8(`a${String.fromCharCode(0x202e)}b\nc`);
    assert.equal(userText(Uint8Array.from([...u16(tricky.length), ...u16(0), ...tricky])), 'a b c');
  });
});

describe('quickTimeDate', () => {
  it('turns seconds since 1904 into a UTC date', () => {
    assert.equal(quickTimeDate(RECORDED), '2026-11-09 14:03 UTC');
  });
});

describe('GPMF', () => {
  it('reads GPS5 positions with their scale', () => {
    const points = gpmfPoints(Uint8Array.from(gps5Sample([[41.7151, 44.8271], [-33.5, -70.25]])));
    assert.equal(points.length, 2);
    assert.ok(Math.abs(points[0].lat - 41.7151) < 1e-6 && Math.abs(points[1].lon + 70.25) < 1e-6);
  });

  it('finds latitude and longitude by their units in a structure described by TYPE (the Karma drone)', () => {
    const units = ['s', 'deg', 'deg', 'm'].flatMap((unit) => [...chars(unit), ...fill(3 - unit.length)]);
    const record = [...fill(8), ...i32(417151000), ...i32(448271000), ...i32(450000)];
    const stream = nest('STRM', [
      ...klv('UNIT', 'c', 3, 4, units),
      ...klv('TYPE', 'c', 1, 4, chars('Jlll')),
      ...klv('SCAL', 'l', 4, 4, [1, 10_000_000, 10_000_000, 1000].flatMap(i32)),
      ...klv('GPRI', '?', 20, 1, record),
    ]);
    const points = gpmfPoints(Uint8Array.from(nest('DEVC', stream)));
    assert.equal(points.length, 1);
    assert.ok(Math.abs(points[0].lat - 41.7151) < 1e-6 && Math.abs(points[0].lon - 44.8271) < 1e-6);
  });

  it('starts each stream afresh: a scale from another stream does not apply', () => {
    const other = nest('STRM', klv('SCAL', 'l', 4, 1, i32(1)));
    const gps = nest('STRM', klv('GPS5', 'l', 20, 1, [...i32(417151000), ...i32(448271000), ...fill(12)]));
    assert.deepEqual(gpmfPoints(Uint8Array.from(nest('DEVC', [...other, ...gps]))), [], 'no scale, no trustworthy position: 41715100 degrees is off the globe');
  });

  it('skips positions without a fix and stops at cut-off data', () => {
    assert.deepEqual(gpmfPoints(Uint8Array.from(gps5Sample([[0, 0]]))), []);
    const cutOff = Uint8Array.from(gps5Sample([[41.7, 44.8]])).subarray(0, 40);
    assert.deepEqual(gpmfPoints(cutOff), []);
    /** @type {string[]} */
    const keys = [];
    readGpmf(cutOff, (key) => keys.push(key));
    assert.ok(keys.length <= 3);
  });
});

describe('sampleRanges', () => {
  /** @param {number[]} stbl */
  const ranges = (stbl, fileSize = 10_000) => {
    const bytes = Uint8Array.from(stbl);
    return sampleRanges(bytes, readBoxes(bytes, 0, bytes.length)[0], 0, fileSize);
  };

  it('follows sizes, chunk runs and offsets, and merges neighbouring samples', () => {
    const stbl = box(
      'stbl',
      full('stsz', u32(0), u32(5), u32(10), u32(20), u32(30), u32(5), u32(5)),
      full('stsc', u32(2), u32(1), u32(2), u32(1), u32(2), u32(3), u32(1)),
      full('stco', u32(2), u32(1000), u32(2000)),
    );
    assert.deepEqual(ranges(stbl), [
      { offset: 1000, length: 30, samples: 2 },
      { offset: 2000, length: 40, samples: 3 },
    ]);
  });

  it('reads one size for all samples and 64-bit chunk offsets', () => {
    const stbl = box('stbl', full('stsz', u32(8), u32(2)), full('stsc', u32(1), u32(1), u32(1), u32(1)), full('co64', u32(2), u32(0), u32(100), u32(0), u32(300)));
    assert.deepEqual(ranges(stbl), [{ offset: 100, length: 8, samples: 1 }, { offset: 300, length: 8, samples: 1 }]);
  });

  it('rejects tables that point outside the file or contradict themselves', () => {
    const outside = box('stbl', full('stsz', u32(8), u32(1)), full('stsc', u32(1), u32(1), u32(1), u32(1)), full('stco', u32(1), u32(9999)));
    assert.throws(() => ranges(outside), VideoError);
    const short = box('stbl', full('stsz', u32(0), u32(1000)), full('stsc', u32(0)), full('stco', u32(0)));
    assert.throws(() => ranges(short), /shorter than its entries/);
    const missing = box('stbl', full('stsz', u32(8), u32(1)));
    assert.throws(() => ranges(missing), /missing a part/);
  });
});

describe('inspectVideo', () => {
  it('reports location, route, time, device and IDs from every place they live', async () => {
    const { bytes } = sampleVideo();
    const { findings, leftIn } = await inspectVideo(new Blob([bytes]));
    assert.deepEqual(findings.location, { lat: 41.7151, lon: 44.8271 });
    assert.equal(findings.route?.points, 3);
    assert.ok(findings.route?.last && Math.abs(findings.route.last.lat - 41.716) < 1e-6);
    assert.equal(findings.fields.taken, '2026-11-09 18:03', 'the local time from the metadata beats the UTC header time');
    assert.equal(findings.fields.timeZone, '+04:00');
    assert.equal(findings.fields.camera, 'Apple iPhone 15');
    assert.equal(findings.fields.uniqueId, 'EE6D649E-788F-4E3A-BCD2-483651BF7B34');
    assert.equal(findings.fields.author, 'Nino Beridze');
    for (const flag of /** @type {import('../src/client/tool-video.mjs').Flag[]} */ (['xmp', 'hiddenData', 'trackNames', 'dataTrack'])) assert.ok(findings.flags.has(flag), flag);
    assert.ok(!findings.flags.has('other'), 'the focal length is a known, harmless key');
    assert.deepEqual(leftIn.get('encoderName'), ['Test encoder']);
    assert.ok(findings.secrets.includes('+41.7151+044.8271/'));
  });

  it('falls back to the header time, in UTC, when nothing else gives one', async () => {
    const ftyp = box('ftyp', chars('mp42'), u32(0));
    const bytes = Uint8Array.from([...ftyp, ...box('moov', mvhd()), ...box('mdat')]);
    const { findings } = await inspectVideo(new Blob([bytes]));
    assert.equal(findings.fields.taken, '2026-11-09 14:03 UTC');
  });

  it('flags a location of 0, 0 as empty rather than showing it as a place', async () => {
    const bytes = Uint8Array.from([...box('moov', box('udta', box('\xa9xyz', intlText('+00.0000+000.0000/'))))]);
    const { findings, patches } = await inspectVideo(new Blob([bytes]));
    assert.equal(findings.location, null);
    assert.ok(findings.flags.has('emptyLocation'));
    assert.ok(patches.length > 0, 'still removed');
  });

  it('never reads the picture: only headers, the index and the data tracks', async () => {
    const { bytes, picture } = sampleVideo();
    /** @type {[number, number][]} */
    const reads = [];
    /** @param {Blob} blob @param {number} offset @param {number} length */
    const read = async (blob, offset, length) => {
      reads.push([offset, length]);
      return new Uint8Array(await blob.slice(offset, offset + length).arrayBuffer());
    };
    await inspectVideo(new Blob([bytes]), read);
    const touches = reads.filter(([offset, length]) => offset < picture.at + picture.length && offset + length > picture.at && length > 32);
    assert.deepEqual(touches, []);
  });

  it('tells a photo from a video, and rejects files without a movie', async () => {
    const heic = Uint8Array.from([...box('ftyp', chars('heic'), u32(0), chars('mif1')), ...box('meta', u32(0))]);
    await assert.rejects(inspectVideo(new Blob([heic])), (error) => error instanceof VideoError && error.code === 'photo');
    const text = new Blob(['This is not a video at all, just some text.']);
    await assert.rejects(inspectVideo(text), (error) => error instanceof VideoError && error.code === 'unsupported');
    const twice = Uint8Array.from([...box('moov', mvhd()), ...box('moov', mvhd())]);
    await assert.rejects(inspectVideo(new Blob([twice])), (error) => error instanceof VideoError && error.code === 'damaged');
  });

  it('refuses a fragmented file whose data tracks would need each fragment cleaned', async () => {
    const { bytes } = sampleVideo();
    const fragmented = Uint8Array.from([...bytes, ...box('moof', full('mfhd', u32(1)), box('traf', full('tfhd', u32(2))))]);
    await assert.rejects(inspectVideo(new Blob([fragmented])), (error) => error instanceof VideoError && error.code === 'fragmented');
  });

  it('lists boxes it does not know as left in, by name; a track of a kind it does not know is data', async () => {
    const bytes = Uint8Array.from([...box('moov', mvhd(), box('trak', box('mdia', hdlr('zzzz', '')))), ...box('abcd', [1, 2, 3])]);
    const { leftIn, findings } = await inspectVideo(new Blob([bytes]));
    assert.deepEqual([...leftIn.keys()], ['unknownBox']);
    assert.deepEqual(leftIn.get('unknownBox'), ['abcd']);
    assert.equal(findings.flags.has('dataTrack'), false, 'a data track with no samples has nothing to zero');
  });

  it('keeps the number of separate changes bounded', () => {
    assert.ok(MAX_PATCHES >= 100_000);
  });
});

describe('cleanVideo and verifyClean', () => {
  it('removes everything it reported, changes nothing else, and passes its own check', async () => {
    const { bytes, picture } = sampleVideo();
    const file = new Blob([bytes]);
    const report = await inspectVideo(file);
    const clean = cleanVideo(file, report.patches);
    const out = await bytesOf(clean);

    assert.equal(out.length, bytes.length);
    // Outside the patches, every byte is the original's.
    let at = 0;
    for (const { offset, length } of report.patches) {
      assert.deepEqual(out.subarray(at, offset), bytes.subarray(at, offset));
      at = offset + length;
    }
    assert.deepEqual(out.subarray(at), bytes.subarray(at));
    assert.deepEqual(out.subarray(picture.at, picture.at + picture.length), bytes.subarray(picture.at, picture.at + picture.length), 'the picture is untouched');

    const again = await inspectVideo(clean);
    assert.equal(hasFindings(again.findings), false);
    assert.deepEqual(again.patches, []);
    assert.equal(await verifyClean(clean, file.size, report.findings.secrets), 'ok');

    const text = new TextDecoder('latin1').decode(out);
    for (const value of ['41.7151', 'iPhone 15', 'Nino Beridze', 'EE6D649E', '$GPRMC', 'Core Media']) assert.ok(!text.includes(value), value);
    assert.ok(text.includes('Test encoder'), 'the encoder name in the codec description stays, as reported');
    assert.ok(text.includes('ludt'), 'loudness information stays');
  });

  it('keeps the box structure: removed boxes become free boxes of the same size', async () => {
    const { bytes } = sampleVideo();
    const file = new Blob([bytes]);
    const clean = cleanVideo(file, (await inspectVideo(file)).patches);
    const before = readBoxes(bytes, 0, bytes.length).map((b) => [b.start, b.end]);
    const out = await bytesOf(clean);
    const after = readBoxes(out, 0, out.length);
    assert.deepEqual(after.map((b) => [b.start, b.end]), before);
    assert.deepEqual(after.map((b) => b.type), ['ftyp', 'mdat', 'moov', 'free', 'free']);
  });

  it('refuses a copy that still holds a value', async () => {
    const { bytes } = sampleVideo();
    const file = new Blob([bytes]);
    const report = await inspectVideo(file);
    const leaky = cleanVideo(file, report.patches.filter((patch) => patch.length < 10 || patch.offset < bytes.length - 300));
    assert.notEqual(await verifyClean(leaky, file.size, report.findings.secrets), 'ok');
    assert.equal(await verifyClean(new Blob([bytes, new Uint8Array(1)]), file.size, []), 'size');
  });
});

describe('findings of the 2026-11-15 review', () => {
  const ftyp = () => box('ftyp', chars('mp42'), u32(0), chars('mp42'));
  /** A metadata track (handler `meta`) with the given sample description and sample table. @param {number} id @param {number[]} entry @param {number[][]} table */
  const dataTrak = (id, entry, table) => box('trak', tkhd(id), box('mdia', mdhd(), hdlr('meta', ''), box('minf', box('stbl', full('stsd', u32(1), entry), ...table))));
  /** One chunk of samples at `offset`. @param {number} offset @param {number[]} sizes @returns {number[][]} */
  const table = (offset, sizes) => [full('stsz', u32(0), u32(sizes.length), ...sizes.map(u32)), full('stsc', u32(1), u32(1), u32(sizes.length), u32(1)), full('stco', u32(1), u32(offset))];
  /** Cleans a file and checks the copy as the page does. @param {Uint8Array} bytes */
  const cleanAndCheck = async (bytes) => {
    const file = new Blob([/** @type {Uint8Array<ArrayBuffer>} */ (bytes)]);
    const report = await inspectVideo(file);
    const clean = cleanVideo(file, report.patches);
    return { report, out: await bytesOf(clean), verdict: await verifyClean(clean, file.size, report.findings.secrets) };
  };

  it('refuses a fragmented file even when its data track keeps every sample in the fragments', async () => {
    const empty = [full('stsz', u32(0), u32(0)), full('stsc', u32(0)), full('stco', u32(0))];
    const gpmd = dataTrak(2, box('gpmd', fill(6), u16(1)), empty);
    const withMoof = Uint8Array.from([...ftyp(), ...box('moov', mvhd(), gpmd), ...box('moof', full('mfhd', u32(1))), ...box('mdat', gps5Sample([[41.7151, 44.8271]]))]);
    await assert.rejects(inspectVideo(new Blob([withMoof])), (error) => error instanceof VideoError && error.code === 'fragmented');
    const initSegment = Uint8Array.from([...ftyp(), ...box('moov', mvhd(), gpmd, box('mvex', full('trex', u32(2), u32(1), u32(0), u32(0), u32(0))))]);
    await assert.rejects(inspectVideo(new Blob([initSegment])), (error) => error instanceof VideoError && error.code === 'fragmented', 'an index announcing fragments');
  });

  it('zeroes free and skip boxes that hold anything, at any depth of the index', async () => {
    const picture = fill(16, 0xaa);
    const mdatAt = ftyp().length;
    const stbl = box('stbl', full('stsd', u32(1), videoEntry('enc')), ...table(mdatAt + 8, [16]));
    const trackWithSkip = box('trak', tkhd(1), box('mdia', mdhd(), hdlr('vide', ''), box('minf', stbl)), box('skip', utf8('serial ABC-12345')));
    const bytes = Uint8Array.from([...ftyp(), ...box('mdat', picture), ...box('moov', mvhd(), box('free', utf8('$GPRMC,140322,A,4142.906,N')), trackWithSkip)]);
    const { report, out, verdict } = await cleanAndCheck(bytes);
    assert.ok(report.findings.flags.has('hiddenData'));
    const copy = new TextDecoder('latin1').decode(out);
    assert.ok(!copy.includes('$GPRMC') && !copy.includes('ABC-12345'));
    assert.equal(verdict, 'ok');
  });

  it('lists unknown boxes inside the index, and refuses a compressed index it cannot read', async () => {
    const bytes = Uint8Array.from([...ftyp(), ...box('moov', mvhd(), box('xyz9', utf8('SERIAL-ABC-12345'))), ...box('mdat')]);
    const { leftIn } = await inspectVideo(new Blob([bytes]));
    assert.deepEqual(leftIn.get('unknownBox'), ['xyz9']);
    const compressed = Uint8Array.from([...ftyp(), ...box('moov', box('cmov', box('dcom', chars('zlib'))))]);
    await assert.rejects(inspectVideo(new Blob([compressed])), (error) => error instanceof VideoError && error.code === 'unsupported');
  });

  it("zeroes the GPS blocks a dashcam's `gps ` index points to, and refuses an index pointing elsewhere", async () => {
    const picture = fill(16, 0xaa);
    const block = box('free', chars('GPS '), utf8('$GPRMC,140322,A,4142.906,N,04449.626,E'));
    const mdatAt = ftyp().length;
    const blockAt = mdatAt + 8 + picture.length;
    const video = trak({ id: 1, kind: 'vide', name: '', entry: videoEntry('enc'), offset: mdatAt + 8, sizes: [16] });
    /** @param {number} at */
    const build = (at) => Uint8Array.from([...ftyp(), ...box('mdat', picture, block), ...box('moov', mvhd(), video, box('gps ', u32(0x101), u32(1), u32(at), u32(block.length)))]);
    const { report, out, verdict } = await cleanAndCheck(build(blockAt));
    assert.ok(report.findings.flags.has('gpsLog'));
    assert.ok(!new TextDecoder('latin1').decode(out).includes('$GPRMC'));
    assert.deepEqual(out.subarray(mdatAt + 8, mdatAt + 24), Uint8Array.from(picture), 'the picture is untouched');
    assert.equal(verdict, 'ok');
    await assert.rejects(inspectVideo(new Blob([build(mdatAt + 8)])), (error) => error instanceof VideoError && error.code === 'damaged', 'pointing at the picture');
  });

  it('removes an Apple metadata track whose location keys are in its second description', async () => {
    const keys = (/** @type {string} */ key) => box('keys', box('keyd', chars('mdta'), utf8(key)));
    const sample = utf8('+41.7151+044.8271/');
    const mdatAt = ftyp().length;
    const entries = [...box('mebx', fill(6), u16(1), keys('com.apple.quicktime.video-orientation')), ...box('mebx', fill(6), u16(1), keys('com.apple.quicktime.location.ISO6709'))];
    const stbl = box('stbl', full('stsd', u32(2), entries), ...table(mdatAt + 8, [sample.length]));
    const mebx = box('trak', tkhd(2), box('mdia', mdhd(), hdlr('meta', ''), box('minf', stbl)));
    const bytes = Uint8Array.from([...ftyp(), ...box('mdat', sample), ...box('moov', mvhd(), mebx)]);
    const { out, verdict } = await cleanAndCheck(bytes);
    assert.ok(!new TextDecoder('latin1').decode(out).includes('+41.7151'));
    assert.equal(verdict, 'ok');
  });

  it('cleans and passes its check when a data track is over 64 MB, and leaves a large empty free box alone', async () => {
    const count = 70_000;
    const size = 1024;
    const mdatAt = ftyp().length;
    const header = Uint8Array.from([...ftyp(), ...u32(8 + count * size), ...chars('mdat')]);
    const data = new Uint8Array(count * size);
    data[0] = 1;
    data[data.length - 1] = 2;
    const rtmd = dataTrak(2, box('rtmd', fill(6), u16(1)), [full('stsz', u32(size), u32(count)), full('stsc', u32(1), u32(1), u32(count), u32(1)), full('stco', u32(1), u32(mdatAt + 8))]);
    const moov = Uint8Array.from(box('moov', mvhd(), rtmd));
    const bytes = new Uint8Array(header.length + data.length + moov.length);
    bytes.set(header);
    bytes.set(data, header.length);
    bytes.set(moov, header.length + data.length);
    const { report, verdict } = await cleanAndCheck(bytes);
    assert.ok(report.findings.flags.has('frameData'));
    assert.equal(verdict, 'ok');
    const free = new Uint8Array(17 * 1024 * 1024 + 8);
    free.set([...u32(free.length), ...chars('free')]);
    const padded = new Uint8Array(free.length + 100);
    padded.set(Uint8Array.from([...ftyp(), ...box('moov', box('udta', box('ludt', fill(4))))]));
    const at = ftyp().length + box('moov', box('udta', box('ludt', fill(4)))).length;
    const small = padded.subarray(0, at);
    const bigFree = new Uint8Array(at + free.length);
    bigFree.set(small);
    bigFree.set(free, at);
    const { findings, patches } = await inspectVideo(new Blob([bigFree]));
    assert.equal(findings.flags.has('hiddenData'), false);
    assert.deepEqual(patches, []);
  });

  it('refuses data samples that lie outside the media data or on top of the picture', async () => {
    const picture = fill(16, 0xaa);
    const mdatAt = ftyp().length;
    const video = trak({ id: 1, kind: 'vide', name: '', entry: videoEntry('enc'), offset: mdatAt + 8, sizes: [16] });
    /** @param {number} offset @param {number} length */
    const build = (offset, length) => Uint8Array.from([...ftyp(), ...box('mdat', picture), ...box('moov', mvhd(), video, dataTrak(2, box('gpmd', fill(6), u16(1)), table(offset, [length])))]);
    await assert.rejects(inspectVideo(new Blob([build(0, 8)])), (error) => error instanceof VideoError && error.code === 'damaged', 'the file header');
    await assert.rejects(inspectVideo(new Blob([build(mdatAt + 12, 4)])), (error) => error instanceof VideoError && error.code === 'damaged', 'the picture');
  });

  it('stays fast on crafted sample tables and camera XML', async () => {
    const started = Date.now();
    const bytes = Uint8Array.from(box('stbl', full('stsz', u32(1), u32(500_000_000)), full('stsc', u32(1), u32(1), u32(500_000_000), u32(1)), full('stco', u32(1), u32(0))));
    assert.deepEqual(sampleRanges(bytes, readBoxes(bytes, 0, bytes.length)[0], 0, 1e12), [{ offset: 0, length: 500_000_000, samples: 500_000_000 }]);
    const xml = `<NonRealTimeMeta>${'<Device '.repeat(20_000)}</NonRealTimeMeta>`;
    const meta = box('meta', [0, 0, 0, 0], full('hdlr', u32(0), chars('nrtm'), fill(12), [0]), box('xml ', [0, 0, 0, 0], utf8(xml)));
    await inspectVideo(new Blob([Uint8Array.from([...ftyp(), ...box('moov', mvhd()), ...meta])]));
    assert.ok(Date.now() - started < 2000, `took ${Date.now() - started} ms`);
  });

  it("offers a copy when the maker's name is also in the encoder name that stays (iPhone ProRes)", async () => {
    const picture = fill(16, 0xaa);
    const mdatAt = ftyp().length;
    const video = trak({ id: 1, kind: 'vide', name: '', entry: videoEntry('Apple ProRes 422 HQ'), offset: mdatAt + 8, sizes: [16] });
    const bytes = Uint8Array.from([...ftyp(), ...box('mdat', picture), ...box('moov', mvhd(), video, box('udta', box('\xa9mak', intlText('Apple')), box('\xa9mod', intlText('iPhone 15 Pro'))))]);
    const { verdict, out } = await cleanAndCheck(bytes);
    assert.equal(verdict, 'ok');
    assert.ok(!new TextDecoder('latin1').decode(out).includes('iPhone 15 Pro'));
  });

  it('does not throw on very long GPMF type descriptions', () => {
    const long = klv('TYPE', 'c', 255, 65535, fill(255 * 65535, 0x6c));
    assert.deepEqual(gpmfPoints(Uint8Array.from(long)), []);
  });

  it('reads a 3GPP location whose place name is UTF-16', async () => {
    const name = [0xfe, 0xff, ...Array.from('Tbilisi', (char) => [0, char.charCodeAt(0)]).flat(), 0, 0];
    const loci = box('loci', [0, 0, 0, 0], u16(0x15c7), name, [0], i32(Math.round(44.8 * 65536)), i32(Math.round(41.7 * 65536)), i32(0), [0], [0]);
    const bytes = Uint8Array.from([...ftyp(), ...box('moov', mvhd(), box('udta', loci))]);
    const { findings } = await inspectVideo(new Blob([bytes]));
    assert.ok(findings.location && Math.abs(findings.location.lat - 41.7) < 1e-3 && Math.abs(findings.location.lon - 44.8) < 1e-3, JSON.stringify(findings.location));
    assert.equal(findings.fields.place, 'Tbilisi');
  });

  it('reads compact sample sizes (stz2)', () => {
    const bytes = Uint8Array.from(box('stbl', full('stz2', [0, 0, 0, 8], u32(3), [10, 20, 30]), full('stsc', u32(1), u32(1), u32(3), u32(1)), full('stco', u32(1), u32(100))));
    assert.deepEqual(sampleRanges(bytes, readBoxes(bytes, 0, bytes.length)[0], 0, 10_000), [{ offset: 100, length: 60, samples: 3 }]);
  });

  it('finds a value written in UTF-16 in what the copy keeps', async () => {
    const utf16 = [0, ...Array.from('Nino Beridze', (char) => [char.charCodeAt(0), 0]).flat()].slice(1);
    const kept = new Blob([Uint8Array.from([...ftyp(), ...box('moov', mvhd().map((byte, i) => (i >= 12 && i < 20 ? 0 : byte)), box('udta', box('ludt', utf16)))])]);
    assert.equal(await verifyClean(kept, kept.size, ['Nino Beridze']), 'secret');
  });

  it("removes a track's own name, producer reference times, and leaves data stored in other files alone", async () => {
    const named = box('trak', tkhd(1), box('udta', box('name', utf8("Nino's camera"))));
    const prft = full('prft', u32(1), u32(0x12345678), u32(0x9abcdef0), u32(0));
    const external = box('trak', tkhd(2), box('mdia', mdhd(), hdlr('meta', ''), box('minf', box('dinf', full('dref', u32(1), box('url ', [0, 0, 0, 0], utf8('other.mp4\0')))), box('stbl', full('stsd', u32(1), box('gpmd', fill(6), u16(1))), ...table(0, [8])))));
    const bytes = Uint8Array.from([...ftyp(), ...box('moov', mvhd(), named, external), ...prft, ...box('mdat', fill(8))]);
    const { report, out } = await cleanAndCheck(bytes);
    assert.ok(!new TextDecoder('latin1').decode(out).includes("Nino's camera"));
    assert.ok(report.patches.every((patch) => patch.offset >= ftyp().length), 'nothing in this file is zeroed for the other file’s samples');
    assert.deepEqual(readBoxes(out, 0, out.length).map((b) => b.type), ['ftyp', 'moov', 'free', 'mdat']);
  });

  describe('the final review', () => {
    const latin = (/** @type {Uint8Array} */ bytes) => new TextDecoder('latin1').decode(bytes);
    /** A track with the given handler and minf children. @param {number} id @param {string} handler @param {number[][]} minf */
    const anyTrak = (id, handler, ...minf) => box('trak', tkhd(id), box('mdia', mdhd(), hdlr(handler, ''), box('minf', ...minf)));
    /** A camm sample: reserved, type (little-endian), then the payload. @param {number} type @param {number[]} payload */
    const cammSample = (type, payload) => [0, 0, type, 0, ...payload];
    /** @param {number[]} values */
    const doubles = (values) => {
      const view = new DataView(new ArrayBuffer(values.length * 8));
      values.forEach((value, i) => view.setFloat64(i * 8, value, true));
      return [...new Uint8Array(view.buffer)];
    };
    /** @param {number} n @param {number} value */
    const big = (n, value) => new Uint8Array(n).fill(value);

    it("zeroes a data track whose handler is ffmpeg's `url ` and whose description is empty", async () => {
      const sample = gps5Sample([[41.7151, 44.8271]]);
      const mdatAt = ftyp().length;
      const track = anyTrak(2, 'url ', box('stbl', full('stsd', u32(1)), ...table(mdatAt + 8, [sample.length])));
      const { report, out, verdict } = await cleanAndCheck(Uint8Array.from([...ftyp(), ...box('mdat', sample), ...box('moov', mvhd(), track)]));
      assert.ok(!latin(out).includes('GPS5'), 'the telemetry is zeroed');
      assert.ok(report.findings.flags.has('dataTrack'));
      assert.equal(report.leftIn.size, 0);
      assert.equal(verdict, 'ok');
    });

    it('zeroes a data track whose data reference lacks the self-contained flag but names no other file', async () => {
      const sample = gps5Sample([[41.7151, 44.8271]]);
      const mdatAt = ftyp().length;
      const dinf = box('dinf', full('dref', u32(1), box('url ', [0, 0, 0, 0])));
      const track = anyTrak(2, 'meta', dinf, box('stbl', full('stsd', u32(1), box('gpmd', fill(6), u16(1))), ...table(mdatAt + 8, [sample.length])));
      const { report, out, verdict } = await cleanAndCheck(Uint8Array.from([...ftyp(), ...box('mdat', sample), ...box('moov', mvhd(), track)]));
      assert.equal(report.findings.route?.points, 1);
      assert.ok(!latin(out).includes('GPS5'));
      assert.equal(verdict, 'ok');
    });

    it('cleans and checks a copy of 50 000 separate pieces, and one of 100 000 small free boxes, quickly', async () => {
      const count = 50_000;
      const mdatAt = ftyp().length;
      const header = Uint8Array.from([...ftyp(), ...u32(8 + count * 32), ...chars('mdat')]);
      const offsets = Array.from({ length: count }, (_, i) => u32(mdatAt + 8 + i * 32)).flat();
      const rtmd = dataTrak(2, box('rtmd', fill(6), u16(1)), [full('stsz', u32(16), u32(count)), full('stsc', u32(1), u32(1), u32(1), u32(1)), full('stco', u32(count), offsets)]);
      const many = new Uint8Array(await new Blob([header, big(count * 32, 0x11), Uint8Array.from(box('moov', mvhd(), rtmd))]).arrayBuffer());
      let started = Date.now();
      const pieces = await cleanAndCheck(many);
      assert.ok(pieces.report.patches.length >= count);
      assert.equal(pieces.verdict, 'ok');
      assert.ok(Date.now() - started < 3000, `50 000 pieces took ${Date.now() - started} ms`);
      const free = Uint8Array.from(box('free', [1]));
      const frees = new Uint8Array(await new Blob([Uint8Array.from(ftyp()), ...new Array(100_000).fill(free), Uint8Array.from(box('moov', mvhd()))]).arrayBuffer());
      started = Date.now();
      const boxes = await cleanAndCheck(frees);
      assert.ok(boxes.report.patches.length >= 100_000);
      assert.equal(boxes.verdict, 'ok');
      assert.ok(Date.now() - started < 3000, `100 000 free boxes took ${Date.now() - started} ms`);
    });

    it('stays fast with 100 000 removed or unknown boxes in the index, and lists a bounded number of names', async () => {
      const removed = Uint8Array.from([...ftyp(), ...box('moov', mvhd(), box('udta', new Array(100_000).fill(box('abcd')).flat()))]);
      const types = Array.from({ length: 100_000 }, (_, i) => box(String.fromCharCode(65 + (i % 26), 65 + (Math.floor(i / 26) % 26), 65 + (Math.floor(i / 676) % 26), 65 + (Math.floor(i / 17_576) % 26))));
      const unknown = Uint8Array.from([...ftyp(), ...box('moov', mvhd(), types.flat())]);
      const started = Date.now();
      const first = await inspectVideo(new Blob([removed]));
      assert.ok(first.patches.length >= 100_000);
      const second = await inspectVideo(new Blob([unknown]));
      const names = second.leftIn.get('unknownBox') ?? [];
      assert.ok(names.length > 10 && names.length <= 51, `${names.length} names`);
      assert.ok(Date.now() - started < 2000, `took ${Date.now() - started} ms`);
    });

    it('counts GoPro positions across many samples, keeping the first and the last', async () => {
      const samples = Array.from({ length: 50 }, (_, i) => gps5Sample(Array.from({ length: 20 }, (_, k) => /** @type {[number, number]} */ ([41 + i / 100 + k / 10_000, 44.8]))));
      const mdatAt = ftyp().length;
      const track = dataTrak(2, box('gpmd', fill(6), u16(1)), table(mdatAt + 8, samples.map((sample) => sample.length)));
      const { report } = await cleanAndCheck(Uint8Array.from([...ftyp(), ...box('mdat', samples.flat()), ...box('moov', mvhd(), track)]));
      const route = report.findings.route;
      assert.equal(route?.points, 1000);
      assert.ok(route?.first && Math.abs(route.first.lat - 41) < 1e-6);
      assert.ok(route?.last && Math.abs(route.last.lat - (41 + 0.49 + 0.0019)) < 1e-6);
    });

    it("zeroes a dashcam's GPS blocks kept in a top-level free box", async () => {
      const picture = fill(16, 0xaa);
      const mdatAt = ftyp().length;
      const mdat = box('mdat', picture);
      const block = box('free', chars('GPS '), utf8('$GPRMC,140322,A,4142.906,N,04449.626,E'));
      const video = trak({ id: 1, kind: 'vide', name: '', entry: videoEntry('enc'), offset: mdatAt + 8, sizes: [16] });
      const blockAt = mdatAt + mdat.length;
      const bytes = Uint8Array.from([...ftyp(), ...mdat, ...block, ...box('moov', mvhd(), video, box('gps ', u32(0x101), u32(1), u32(blockAt), u32(block.length)))]);
      const { report, out, verdict } = await cleanAndCheck(bytes);
      assert.ok(report.findings.flags.has('gpsLog'));
      assert.ok(!latin(out).includes('$GPRMC'));
      assert.equal(verdict, 'ok');
    });

    it("cleans a fragmented file whose timecode keeps its sample in the index, and refuses one whose fragments carry data", async () => {
      const picture = fill(16, 0xaa);
      const timecode = u32(0x01020304);
      const mdatAt = ftyp().length;
      const video = trak({ id: 1, kind: 'vide', name: '', entry: videoEntry('enc'), offset: mdatAt + 8, sizes: [16] });
      const tmcd = trak({ id: 3, kind: 'tmcd', name: '', entry: box('tmcd', fill(6), u16(1), fill(16)), offset: mdatAt + 24, sizes: [4] });
      const mvex = box('mvex', full('trex', u32(1), u32(1), u32(0), u32(0), u32(0)), full('trex', u32(3), u32(1), u32(0), u32(0), u32(0)));
      /** @param {number} id */
      const build = (id) => Uint8Array.from([...ftyp(), ...box('mdat', picture, timecode), ...box('moov', mvhd(), video, tmcd, mvex), ...box('moof', full('mfhd', u32(1)), box('traf', full('tfhd', u32(id)))), ...box('mdat', fill(16, 0xbb))]);
      const { report, out, verdict } = await cleanAndCheck(build(1));
      assert.ok(report.findings.flags.has('timecode'));
      assert.deepEqual([...out.subarray(mdatAt + 24, mdatAt + 28)], [0, 0, 0, 0]);
      assert.equal(verdict, 'ok');
      await assert.rejects(inspectVideo(new Blob([build(3)])), (error) => error instanceof VideoError && error.code === 'fragmented');
    });

    it('counts only the positions in a camm track: motion sensors alone are not a route', async () => {
      const mdatAt = ftyp().length;
      /** @param {number[][]} samples */
      const build = (samples) => {
        const stbl = box('stbl', full('stsd', u32(1), box('camm', fill(6), u16(1))), ...table(mdatAt + 8, samples.map((sample) => sample.length)));
        return Uint8Array.from([...ftyp(), ...box('mdat', samples.flat()), ...box('moov', mvhd(), anyTrak(2, 'camm', stbl))]);
      };
      const gyro = await cleanAndCheck(build(new Array(5).fill(cammSample(2, fill(12, 0x3f)))));
      assert.equal(gyro.report.findings.route, null);
      assert.ok(gyro.report.findings.flags.has('dataTrack'));
      assert.equal(gyro.verdict, 'ok');
      const gps = await cleanAndCheck(build([cammSample(2, fill(12, 0x3f)), cammSample(5, doubles([41.7151, 44.8271, 450])), cammSample(5, doubles([41.716, 44.828, 450]))]));
      assert.equal(gps.report.findings.route?.points, 2);
      assert.ok(gps.report.findings.route?.first && Math.abs(gps.report.findings.route.first.lat - 41.7151) < 1e-9);
      assert.equal(gps.verdict, 'ok');
    });

    it("removes metadata kept in a track's media box", async () => {
      const picture = fill(16, 0xaa);
      const mdatAt = ftyp().length;
      const meta = mdtaMeta([['com.apple.quicktime.location.ISO6709', '+41.7151+044.8271/']]);
      const stbl = box('stbl', full('stsd', u32(1), videoEntry('enc')), ...table(mdatAt + 8, [16]));
      const video = box('trak', tkhd(1), box('mdia', mdhd(), hdlr('vide', ''), meta, box('minf', stbl)));
      const { report, out, verdict } = await cleanAndCheck(Uint8Array.from([...ftyp(), ...box('mdat', picture), ...box('moov', mvhd(), video)]));
      assert.ok(report.findings.location && Math.abs(report.findings.location.lat - 41.7151) < 1e-6);
      assert.ok(!latin(out).includes('+41.7151'));
      assert.equal(report.leftIn.has('unknownBox'), false);
      assert.equal(verdict, 'ok');
    });
  });
});

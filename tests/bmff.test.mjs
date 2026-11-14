// @ts-check
/**
 * @file Tests for reading the box structure of MP4 and MOV files.
 */
/**
 * The fixtures are boxes assembled here byte by byte, independently of the reader.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { BoxError, MAX_DEPTH, childrenOf, fullBox, readBox, readBoxes, topLevelBoxes, walk } from '../src/client/bmff.mjs';
import { readRange } from '../src/client/file-read.mjs';

/** @param {number} n */
const u32 = (n) => [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff];
/** @param {string} text  One byte per character. */
const chars = (text) => Array.from(text, (char) => char.charCodeAt(0));

/**
 * A box with a 32-bit size.
 * @param {string} type
 * @param {...(number[] | Uint8Array)} parts  Contents.
 */
function box(type, ...parts) {
  const body = parts.flatMap((part) => [...part]);
  return [...u32(8 + body.length), ...chars(type), ...body];
}

/** A box with a 64-bit size. @param {string} type @param {...number[]} parts */
function box64(type, ...parts) {
  const body = parts.flat();
  const size = 16 + body.length;
  return [...u32(1), ...chars(type), ...u32(0), ...u32(size), ...body];
}

/** @param {...number[]} parts */
const file = (...parts) => Uint8Array.from(parts.flat());

/** Types and offsets of a list of boxes, for compact comparisons. @param {import('../src/client/bmff.mjs').Box[]} boxes */
const shape = (boxes) => boxes.map(({ type, start, data, end }) => [type, start, data, end]);

describe('readBox and readBoxes', () => {
  it('reads sizes, types and offsets, and adds the base offset', () => {
    const bytes = file(box('ftyp', chars('isom'), u32(0)), box('free', [1, 2, 3]));
    assert.deepEqual(shape(readBoxes(bytes, 0, bytes.length)), [
      ['ftyp', 0, 8, 16],
      ['free', 16, 24, 27],
    ]);
    assert.deepEqual(shape(readBoxes(bytes, 0, bytes.length, 1000)), [
      ['ftyp', 1000, 1008, 1016],
      ['free', 1016, 1024, 1027],
    ]);
  });

  it('reads a 64-bit size', () => {
    const bytes = file(box64('mdat', [9, 9, 9, 9]));
    assert.deepEqual(shape(readBoxes(bytes, 0, bytes.length)), [['mdat', 0, 16, 20]]);
  });

  it('rejects a 64-bit size beyond what JavaScript numbers hold exactly', () => {
    const bytes = file([...u32(1), ...chars('mdat'), 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff]);
    assert.throws(() => readBox(bytes, 0, Number.MAX_SAFE_INTEGER), BoxError);
  });

  it('lets size 0 run to the end', () => {
    const bytes = file(box('ftyp', chars('qt  ')), [...u32(0), ...chars('mdat'), 7, 7, 7]);
    assert.deepEqual(shape(readBoxes(bytes, 0, bytes.length)).at(-1), ['mdat', 12, 20, 23]);
  });

  it('reads the extended type of a uuid box and starts its contents after it', () => {
    const id = [0xbe, 0x7a, 0xcf, 0xcb, 0x97, 0xa9, 0x42, 0xe8, 0x9c, 0x71, 0x99, 0x94, 0x91, 0xe3, 0xaf, 0xac];
    const bytes = file(box('uuid', id, chars('<x:xmpmeta/>')));
    const [found] = readBoxes(bytes, 0, bytes.length);
    assert.equal(found.uuid, 'be7acfcb97a942e89c71999491e3afac');
    assert.equal(found.data, 24);
    assert.equal(found.end, bytes.length);
  });

  it('keeps the © of QuickTime text boxes as one character', () => {
    const bytes = file(box('\xa9xyz', [0, 5, 0x15, 0xc7], chars('+1+2/')));
    assert.equal(readBoxes(bytes, 0, bytes.length)[0].type, '©xyz');
  });

  it('rejects sizes that are too small or run past the parent', () => {
    assert.throws(() => readBoxes(file([...u32(4), ...chars('free')]), 0, 8), /smaller than its own header/);
    assert.throws(() => readBoxes(file([...u32(100), ...chars('free')]), 0, 8), /runs past the end/);
    assert.equal(readBoxes(file([...u32(24), ...chars('uuid'), ...new Array(16).fill(0)]), 0, 24)[0].data, 24, 'an empty uuid box is fine');
    assert.throws(() => readBoxes(file([...u32(20), ...chars('uuid'), ...new Array(12).fill(0)]), 0, 20), /smaller than its own header/);
  });

  it('rejects a header cut off at the end', () => {
    assert.throws(() => readBoxes(file(box('free'), [0, 0, 0, 9, 0x66]), 0, 13), /cut off/);
  });

  it('accepts a short zero tail as padding, as QuickTime user data may end with a 32-bit zero', () => {
    const bytes = file(box('\xa9nam', chars('x')), [0, 0, 0, 0]);
    assert.deepEqual(readBoxes(bytes, 0, bytes.length).map((b) => b.type), ['©nam']);
  });

  it('stops at a crafted file with too many boxes instead of hanging', async () => {
    const { MAX_BOXES } = await import('../src/client/bmff.mjs');
    const bytes = new Uint8Array((MAX_BOXES + 1) * 8);
    for (let i = 0; i < bytes.length; i += 8) bytes.set([0, 0, 0, 8, 0x66, 0x72, 0x65, 0x65], i);
    assert.throws(() => readBoxes(bytes, 0, bytes.length), /More than/);
  });
});

describe('childrenOf', () => {
  it('reads containers and leaves the rest alone', () => {
    const bytes = file(box('moov', box('mvhd', new Array(100).fill(0)), box('udta', box('\xa9xyz', chars('+1+2/')))));
    const [moov] = readBoxes(bytes, 0, bytes.length);
    const children = childrenOf(bytes, moov);
    assert.deepEqual(children.map((b) => b.type), ['mvhd', 'udta']);
    assert.deepEqual(childrenOf(bytes, children[0]), []);
    assert.deepEqual(childrenOf(bytes, children[1]).map((b) => b.type), ['©xyz']);
  });

  it('reads both kinds of meta box: ISO (version and flags first) and QuickTime (starts with hdlr)', () => {
    const hdlr = box('hdlr', u32(0), u32(0), chars('mdta'), u32(0), u32(0), u32(0), [0]);
    const quickTime = file(box('meta', hdlr, box('keys', u32(0), u32(0)), box('ilst')));
    const iso = file(box('meta', u32(0), hdlr, box('iloc', u32(0))));
    assert.deepEqual(childrenOf(quickTime, readBoxes(quickTime, 0, quickTime.length)[0]).map((b) => b.type), ['hdlr', 'keys', 'ilst']);
    assert.deepEqual(childrenOf(iso, readBoxes(iso, 0, iso.length)[0]).map((b) => b.type), ['hdlr', 'iloc']);
    const empty = file(box('meta', [0, 0]));
    assert.deepEqual(childrenOf(empty, readBoxes(empty, 0, empty.length)[0]), []);
  });

  it('reads the items of an ilst as containers of data boxes', () => {
    const data = box('data', u32(1), u32(0), chars('Apple'));
    const bytes = file(box('ilst', [...u32(8 + data.length), 0, 0, 0, 1, ...data]));
    const [ilst] = readBoxes(bytes, 0, bytes.length);
    const [item] = childrenOf(bytes, ilst);
    assert.equal(item.type, '\x00\x00\x00\x01');
    assert.deepEqual(childrenOf(bytes, item, 0, 'ilst').map((b) => b.type), ['data']);
    assert.deepEqual(childrenOf(bytes, item), [], 'outside an ilst the same box is not a container');
  });
});

describe('walk', () => {
  it('visits every box depth first with its ancestors', () => {
    const bytes = file(
      box('ftyp', chars('qt  ')),
      box('moov', box('mvhd'), box('trak', box('tkhd'), box('mdia', box('hdlr'))), box('udta', box('\xa9mak', chars('Apple')))),
      box('mdat', [1, 2]),
    );
    /** @type {string[]} */
    const seen = [];
    walk(bytes, 0, bytes.length, (found, path) => seen.push([...path, found.type].join('/')));
    assert.deepEqual(seen, ['ftyp', 'moov', 'moov/mvhd', 'moov/trak', 'moov/trak/tkhd', 'moov/trak/mdia', 'moov/trak/mdia/hdlr', 'moov/udta', 'moov/udta/©mak', 'mdat']);
  });

  it('walks part of a file with its file offset and ancestors', () => {
    const moov = file(box('moov', box('udta', box('\xa9xyz', chars('+1+2/')))));
    /** @type {[string, number][]} */
    const seen = [];
    // Only moov's contents, as the video tool reads them: bytes start at file offset 5000.
    walk(moov, 8, moov.length, (found, path) => seen.push([[...path, found.type].join('/'), found.start]), 5000, ['moov']);
    assert.deepEqual(seen, [['moov/udta', 5008], ['moov/udta/©xyz', 5016]]);
  });

  it('stops at nesting deeper than any real file', () => {
    let nested = box('udta');
    for (let i = 0; i < MAX_DEPTH + 2; i += 1) nested = box('udta', nested);
    const bytes = file(nested);
    assert.throws(() => walk(bytes, 0, bytes.length, () => {}), /nested more than/);
  });

  it('reports the damaged box with its file offset', () => {
    const bytes = file(box('moov', [...u32(500), ...chars('trak')]));
    assert.throws(() => walk(bytes, 0, bytes.length, () => {}, 300), /"trak" \(500 bytes\) runs past the end of its parent at byte 308/);
  });
});

describe('fullBox', () => {
  it('reads version and flags', () => {
    const bytes = file(box('mvhd', [1, 0, 0, 3], u32(0)));
    assert.deepEqual(fullBox(bytes, readBoxes(bytes, 0, bytes.length)[0]), { version: 1, flags: 3, fields: 12 });
    const short = file(box('mvhd', [1]));
    assert.throws(() => fullBox(short, readBoxes(short, 0, short.length)[0]), BoxError);
  });
});

describe('topLevelBoxes', () => {
  it('lists the boxes of a file read from a Blob', async () => {
    const blob = new Blob([file(box('ftyp', chars('mp42')), box('moov', box('mvhd')), box64('mdat', [1, 2, 3]))]);
    assert.deepEqual(shape(await topLevelBoxes(blob)), [
      ['ftyp', 0, 8, 12],
      ['moov', 12, 20, 28],
      ['mdat', 28, 44, 47],
    ]);
  });

  it('reads only headers: a 5 GB video stream is skipped, not read', async () => {
    const mdatSize = 5 * 1024 ** 3;
    const head = file(box('ftyp', chars('qt  ')), [...u32(1), ...chars('mdat'), ...u32(Math.floor(mdatSize / 2 ** 32)), ...u32(mdatSize % 2 ** 32)]);
    const moov = file(box('moov', box('mvhd')));
    const size = 12 + mdatSize + moov.length;
    /** @type {[number, number][]} */
    const reads = [];
    // A stand-in for a 5 GB File: only the ranges holding headers exist.
    const fake = /** @type {Blob} */ ({ size });
    /** @param {Blob} _ @param {number} offset @param {number} length */
    const read = async (_, offset, length) => {
      reads.push([offset, length]);
      if (offset === 0) return head.subarray(0, length);
      if (offset === 12) return head.subarray(12, 12 + length);
      if (offset === 12 + mdatSize) return moov.subarray(0, length);
      throw new Error(`read inside the video data at ${offset}`);
    };
    const boxes = await topLevelBoxes(fake, read);
    assert.deepEqual(boxes.map((b) => [b.type, b.start, b.end]), [['ftyp', 0, 12], ['mdat', 12, 12 + mdatSize], ['moov', 12 + mdatSize, size]]);
    assert.ok(reads.every(([, length]) => length <= 32), 'no read is longer than a header');
  });

  it('rejects a last box that claims more than the file holds', async () => {
    const blob = new Blob([file(box('ftyp', chars('qt  ')), [...u32(100), ...chars('mdat'), 1, 2])]);
    await assert.rejects(topLevelBoxes(blob), /runs past the end/);
  });

  it('rejects a header cut off at the end of the file, but accepts a zero tail', async () => {
    await assert.rejects(topLevelBoxes(new Blob([file(box('ftyp'), [0, 0, 1])])), /cut off/);
    assert.equal((await topLevelBoxes(new Blob([file(box('ftyp'), [0, 0, 0, 0])]))).length, 1);
  });
});

describe('readRange', () => {
  it('reads part of a Blob, and less at its end', async () => {
    const blob = new Blob([Uint8Array.from([0, 1, 2, 3, 4, 5])]);
    assert.deepEqual([...(await readRange(blob, 2, 3))], [2, 3, 4]);
    assert.deepEqual([...(await readRange(blob, 4, 10))], [4, 5]);
  });
});

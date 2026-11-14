// @ts-check
/**
 * @file Reading the box structure of MP4, MOV, 3GP and M4V files (ISO base media file format and QuickTime).
 */
/**
 * A file of this family is a list of boxes ("atoms" in QuickTime): a 32-bit size, a four-character type, then the
 * contents, which for container boxes are more boxes. Size 1 means a 64-bit size follows the type; size 0 means the
 * box runs to the end of the file. A `uuid` box carries a 16-byte extended type after the header.
 * Sources: docs/research/tool-video-metadata.md §1.
 *
 * Every box is given with its absolute position in the file, so the video tool can report and patch exact bytes.
 * Parts of the file are passed around as `bytes` plus `base`, the file offset of `bytes[0]`.
 *
 * Nothing here trusts a size: a box that would run past its parent, a size too small to hold its own header, or
 * nesting deeper than MAX_DEPTH throws BoxError, never reads outside the given bytes.
 */
import { readRange } from './file-read.mjs';

export class BoxError extends Error {
  /** @param {string} message  What is wrong and where, for the console. */
  constructor(message) {
    super(message);
    this.name = 'BoxError';
  }
}

/**
 * @typedef {object} Box
 * @property {string} type  Four characters, each byte as one character (so © stays one character).
 * @property {number} start  File offset of the box's first byte.
 * @property {number} data  File offset of its contents, after the header (and the extended type of a `uuid` box).
 * @property {number} end  File offset just after the box.
 * @property {string} [uuid]  A `uuid` box's extended type, 32 lowercase hex digits.
 */

/** Containers whose contents are boxes from their first byte. ISO 14496-12 and QuickTime (research §1). */
const CONTAINERS = new Set(['moov', 'trak', 'mdia', 'minf', 'stbl', 'dinf', 'edts', 'udta', 'mvex', 'moof', 'traf', 'mfra', 'ilst']);

/** Deeper than any real file (moov/trak/mdia/minf/stbl/stsd is six); stops crafted files from recursing without end. */
export const MAX_DEPTH = 16;

/** Most boxes read at one level: far more than any real file, small enough to keep a crafted one from hanging the page. */
export const MAX_BOXES = 200_000;

/** @param {Uint8Array} bytes @param {number} at */
const fourCc = (bytes, at) => String.fromCharCode(bytes[at], bytes[at + 1], bytes[at + 2], bytes[at + 3]);

/** @param {Uint8Array} bytes @param {number} at @param {number} length */
const hex = (bytes, at, length) => Array.from(bytes.subarray(at, at + length), (byte) => byte.toString(16).padStart(2, '0')).join('');

/**
 * The header of the box at `at`, which must end by `end` (both are offsets into `bytes`).
 * @param {Uint8Array} bytes
 * @param {number} at
 * @param {number} end
 * @param {number} [base]  File offset of bytes[0].
 * @returns {Box}
 * @throws {BoxError}
 */
export function readBox(bytes, at, end, base = 0) {
  const where = `at byte ${base + at}`;
  if (at + 8 > end) throw new BoxError(`A box header is cut off ${where}.`);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const type = fourCc(bytes, at + 4);
  let size = view.getUint32(at);
  let header = 8;
  if (size === 1) {
    if (at + 16 > end) throw new BoxError(`The 64-bit size of "${type}" is cut off ${where}.`);
    const large = view.getBigUint64(at + 8);
    if (large > BigInt(Number.MAX_SAFE_INTEGER)) throw new BoxError(`"${type}" claims an impossible size ${where}.`);
    size = Number(large);
    header = 16;
  } else if (size === 0) {
    size = end - at;
  }
  if (type === 'uuid') header += 16;
  if (size < header) throw new BoxError(`"${type}" is smaller than its own header (${size} bytes) ${where}.`);
  if (at + size > end) throw new BoxError(`"${type}" (${size} bytes) runs past the end of its parent ${where}.`);
  /** @type {Box} */
  const box = { type, start: base + at, data: base + at + header, end: base + at + size };
  if (type === 'uuid') box.uuid = hex(bytes, at + header - 16, 16);
  return box;
}

/**
 * The boxes from `start` to `end` (offsets into `bytes`). A tail of fewer than 8 bytes that are all zero is
 * accepted as padding: QuickTime writers may end a list of user data with a 32-bit zero.
 * @param {Uint8Array} bytes
 * @param {number} start
 * @param {number} end
 * @param {number} [base]  File offset of bytes[0].
 * @returns {Box[]}
 * @throws {BoxError}
 */
export function readBoxes(bytes, start, end, base = 0) {
  /** @type {Box[]} */
  const out = [];
  let at = start;
  while (at < end) {
    if (end - at < 8 && bytes.subarray(at, end).every((byte) => byte === 0)) break;
    if (out.length === MAX_BOXES) throw new BoxError(`More than ${MAX_BOXES} boxes in one place at byte ${base + start}.`);
    const box = readBox(bytes, at, end, base);
    out.push(box);
    at = box.end - base;
  }
  return out;
}

/**
 * Where the children of a `meta` box start. ISO files write it as a full box (4 bytes of version and flags before
 * the first child); QuickTime's metadata box (the one with the `mdta` keys) has no version and starts with `hdlr`.
 * @param {Uint8Array} bytes
 * @param {Box} box
 * @param {number} base
 */
function metaChildren(bytes, box, base) {
  const at = box.data - base;
  const quickTime = box.end - box.data >= 8 && fourCc(bytes, at + 4) === 'hdlr';
  return quickTime ? at : at + 4;
}

/**
 * The child boxes of `box`, or an empty list if it isn't a container. Items in an `ilst` (their type is a key
 * number or a four-character code) are containers of `data` boxes, so `parent` must say when the box is in an `ilst`.
 * @param {Uint8Array} bytes  Holds the whole box.
 * @param {Box} box
 * @param {number} [base]  File offset of bytes[0].
 * @param {string} [parent]  Type of the box that holds `box`.
 * @returns {Box[]}
 * @throws {BoxError}
 */
export function childrenOf(bytes, box, base = 0, parent = '') {
  if (box.type === 'meta') {
    const start = metaChildren(bytes, box, base);
    return start > box.end - base ? [] : readBoxes(bytes, start, box.end - base, base);
  }
  if (CONTAINERS.has(box.type) || parent === 'ilst') return readBoxes(bytes, box.data - base, box.end - base, base);
  return [];
}

/**
 * Visits every box from `start` to `end` depth first. `path` lists the types of the box's ancestors, outermost first.
 * @param {Uint8Array} bytes
 * @param {number} start  Offset into `bytes`.
 * @param {number} end
 * @param {(box: Box, path: string[]) => unknown} visit  Returning false skips the box's children.
 * @param {number} [base]  File offset of bytes[0].
 * @param {string[]} [path]  Ancestors of the boxes between `start` and `end`.
 * @throws {BoxError}
 */
export function walk(bytes, start, end, visit, base = 0, path = []) {
  /** @param {Box[]} boxes @param {string[]} ancestors */
  const each = (boxes, ancestors) => {
    for (const box of boxes) {
      if (visit(box, ancestors) === false) continue;
      const children = childrenOf(bytes, box, base, ancestors.at(-1));
      if (children.length === 0) continue;
      if (ancestors.length + 1 > MAX_DEPTH) throw new BoxError(`Boxes are nested more than ${MAX_DEPTH} deep at byte ${box.start}.`);
      each(children, [...ancestors, box.type]);
    }
  };
  each(readBoxes(bytes, start, end, base), path);
}

/**
 * Version and flags of a full box, and where its fields start.
 * @param {Uint8Array} bytes
 * @param {Box} box
 * @param {number} [base]  File offset of bytes[0].
 * @returns {{ version: number, flags: number, fields: number }}  fields: file offset after version and flags.
 * @throws {BoxError}
 */
export function fullBox(bytes, box, base = 0) {
  const at = box.data - base;
  if (box.end - box.data < 4) throw new BoxError(`"${box.type}" is too short for a version and flags at byte ${box.start}.`);
  return { version: bytes[at], flags: (bytes[at + 1] << 16) | (bytes[at + 2] << 8) | bytes[at + 3], fields: box.data + 4 };
}

/** Enough for a header with a 64-bit size and a `uuid` type. */
const HEADER_READ = 32;

/**
 * The top-level boxes of a file, reading only their headers: the contents (the video data in `mdat` can be
 * gigabytes) are never read.
 * @param {Blob} file
 * @param {(blob: Blob, offset: number, length: number) => Promise<Uint8Array>} [read]  How to read a range (tests pass their own).
 * @returns {Promise<Box[]>}
 * @throws {BoxError}
 */
export async function topLevelBoxes(file, read = readRange) {
  /** @type {Box[]} */
  const out = [];
  let at = 0;
  while (at < file.size) {
    const head = await read(file, at, Math.min(HEADER_READ, file.size - at));
    // The same rule as readBoxes for a short zero tail.
    if (head.length < 8 && head.every((byte) => byte === 0)) break;
    if (out.length === MAX_BOXES) throw new BoxError(`More than ${MAX_BOXES} top-level boxes.`);
    // The size is checked against the rest of the file, not against the few bytes read. readBox only looks at the
    // header (at most 32 bytes), and those exist: a header longer than the rest of the file fails its size checks.
    const padded = new Uint8Array(HEADER_READ);
    padded.set(head);
    const box = readBox(padded, 0, file.size - at, at);
    out.push(box);
    at = box.end;
  }
  return out;
}

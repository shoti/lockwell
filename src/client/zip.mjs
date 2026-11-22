// @ts-check
/**
 * @file Writing ZIP archives: the document tool's clean copies, and several clean files saved at once.
 */

import { concat, crc32 } from './bytes.mjs';
import { hasDate, savedName } from './save.mjs';

const SIG = { local: 0x04034b50, central: 0x02014b50, end: 0x06054b50 };
/** Bit 11 of the flags: the name is UTF-8. */
export const FLAG_UTF8 = 1 << 11;
/** 1 January 1980, the earliest date a ZIP entry can carry. */
const DOS_DATE_ZERO = 0x0021;

/**
 * @typedef {object} ZipEntry
 * @property {string} name
 * @property {Uint8Array} rawName
 * @property {number} flags
 * @property {number} method  0 = stored, 8 = deflated.
 * @property {number} crc
 * @property {number} size  Uncompressed size.
 * @property {Uint8Array} data  The entry's bytes as stored in the archive.
 */

/* ---------- Reading ---------- */

/** Bit 0 of the flags: the entry is encrypted (APPNOTE 4.4.4). */
const FLAG_ENCRYPTED = 1;

/**
 * An archive this reader can't use; `code` says why.
 * "locked": encrypted entries. "zip64": the ZIP64 format, which this reader doesn't handle. "browser": the browser
 * can't decompress.
 */
export class ZipError extends Error {
  /** @param {'damaged' | 'locked' | 'zip64' | 'browser'} code @param {string} [detail] */
  constructor(code, detail = '') {
    super(`ZIP archive can't be read: ${code}${detail ? ` (${detail})` : ''}`);
    this.name = 'ZipError';
    this.code = code;
  }
}

/**
 * @typedef {'notZip' | 'damaged' | 'zip64' | 'encrypted' | 'duplicate' | 'nameMismatch' | 'traversal'} ZipProblem
 *   duplicate: two entries of one name (in any case): a reader would see one, another program the other.
 *   nameMismatch: an entry's name in its own header differs from the directory's, which tools disagree about.
 *   traversal: a name that starts at the root, names a drive or climbs out with "..", writing outside the folder.
 * @typedef {ZipEntry & { encrypted: boolean, localName: string }} ScannedEntry
 */

/**
 * Lists a ZIP archive's entries without trusting it: problems are collected instead of thrown, and the listing stops
 * only where the directory itself can't be followed. Encrypted entries are listed (their names are readable).
 * @param {Uint8Array} bytes
 * @returns {{ entries: ScannedEntry[], problems: Set<ZipProblem> }}
 */
export function scanZip(bytes) {
  /** @type {ScannedEntry[]} */
  const entries = [];
  /** @type {Set<ZipProblem>} */
  const problems = new Set();
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  // The directory is at the end, after an optional comment of up to 65,535 bytes.
  let end = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 0xffff); i -= 1) {
    if (view.getUint32(i, true) === SIG.end) {
      end = i;
      break;
    }
  }
  if (end === -1) {
    problems.add('notZip');
    return { entries, problems };
  }
  const count = view.getUint16(end + 10, true);
  let at = view.getUint32(end + 16, true);
  // 0xFFFF / 0xFFFFFFFF mean "see the ZIP64 record".
  if (count === 0xffff || at === 0xffffffff) {
    problems.add('zip64');
    return { entries, problems };
  }

  // Bytes in front of the archive (a self-extractor's program, a mail tool's header) move everything by the same
  // amount; archive tools find the directory from the end record and shift every offset by the difference.
  // ZIP64 end records sit between the directory and the end record, so the gap there is expected: no shift.
  const directorySize = view.getUint32(end + 12, true);
  const zip64Records = end >= 20 && view.getUint32(end - 20, true) === 0x07064b50;
  const shift = zip64Records ? 0 : end - directorySize - at;
  if (shift > 0 && end - directorySize >= 0 && view.getUint32(end - directorySize, true) === SIG.central) at += shift;
  const offset = shift > 0 && at === end - directorySize ? shift : 0;

  const seen = new Set();
  const decoder = new TextDecoder();
  for (let n = 0; n < count; n += 1) {
    if (at + 46 > bytes.length || view.getUint32(at, true) !== SIG.central) {
      problems.add('damaged');
      break;
    }
    const flags = view.getUint16(at + 8, true);
    const method = view.getUint16(at + 10, true);
    const crc = view.getUint32(at + 16, true);
    const compressedSize = view.getUint32(at + 20, true);
    const size = view.getUint32(at + 24, true);
    const nameLength = view.getUint16(at + 28, true);
    const local = view.getUint32(at + 42, true) + offset;
    const next = at + 46 + nameLength + view.getUint16(at + 30, true) + view.getUint16(at + 32, true);
    if (at + 46 + nameLength > bytes.length) {
      problems.add('damaged');
      break;
    }
    const rawName = bytes.subarray(at + 46, at + 46 + nameLength);
    const name = decoder.decode(rawName);
    at = next;
    if (compressedSize === 0xffffffff || size === 0xffffffff || local - offset === 0xffffffff) {
      problems.add('zip64');
      continue;
    }
    if (local + 30 > bytes.length || view.getUint32(local, true) !== SIG.local) {
      problems.add('damaged');
      continue;
    }
    const localNameLength = view.getUint16(local + 26, true);
    const dataStart = local + 30 + localNameLength + view.getUint16(local + 28, true);
    if (dataStart + compressedSize > bytes.length) {
      problems.add('damaged');
      continue;
    }
    const localName = decoder.decode(bytes.subarray(local + 30, local + 30 + localNameLength));
    if (localName !== name) problems.add('nameMismatch');
    if (seen.has(name.toLowerCase())) problems.add('duplicate');
    seen.add(name.toLowerCase());
    if (/^[/\\]|^[a-z]:/i.test(name) || /(^|[/\\])\.\.([/\\]|$)/.test(name)) problems.add('traversal');
    const encrypted = Boolean(flags & FLAG_ENCRYPTED);
    if (encrypted) problems.add('encrypted');
    entries.push({ name, rawName, flags, method, crc, size, data: bytes.subarray(dataStart, dataStart + compressedSize), encrypted, localName });
  }
  return { entries, problems };
}

/**
 * Lists the entries of a ZIP archive that is to be read in full.
 * @param {Uint8Array} bytes
 * @returns {ZipEntry[]}
 * @throws {ZipError} "damaged" for broken archives and archives with two entries of the same name (in any case),
 *   "locked" for encrypted entries, "zip64" for the ZIP64 format.
 */
export function readZip(bytes) {
  const { entries, problems } = scanZip(bytes);
  if (problems.has('zip64')) throw new ZipError('zip64');
  if (problems.has('encrypted')) throw new ZipError('locked');
  for (const problem of ['notZip', 'damaged', 'duplicate']) if (problems.has(/** @type {ZipProblem} */ (problem))) throw new ZipError('damaged', problem);
  return entries.map(({ name, rawName, flags, method, crc, size, data }) => ({ name, rawName, flags, method, crc, size, data }));
}

/**
 * An entry's contents, decompressed. The size the archive declares is enforced while inflating: an entry that grows
 * past it is not what it says, and may be built to exhaust memory.
 * @param {ZipEntry} entry
 * @param {number} maxBytes  Largest size accepted.
 * @returns {Promise<Uint8Array>}
 * @throws {ZipError}
 */
export async function unzip(entry, maxBytes) {
  if (entry.flags & FLAG_ENCRYPTED) throw new ZipError('locked');
  if (entry.method === 0) {
    if (entry.data.length !== entry.size) throw new ZipError('damaged', 'stored size differs');
    return entry.data;
  }
  if (entry.method !== 8) throw new ZipError('damaged', `compression method ${entry.method}`);
  if (typeof DecompressionStream !== 'function') throw new ZipError('browser');
  if (entry.size > maxBytes) throw new ZipError('damaged', 'too large');
  /** @type {Uint8Array[]} */
  const chunks = [];
  let total = 0;
  try {
    const reader = new Blob([/** @type {Uint8Array<ArrayBuffer>} */ (entry.data)]).stream().pipeThrough(new DecompressionStream('deflate-raw')).getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > entry.size) {
        await reader.cancel();
        break;
      }
      chunks.push(value);
    }
  } catch {
    throw new ZipError('damaged', 'inflate failed');
  }
  if (total !== entry.size) throw new ZipError('damaged', 'size differs from the directory');
  return concat(chunks);
}

/* ---------- Writing ---------- */

/**
 * Writes a ZIP archive. Entries keep their bytes and names; dates are reset
 * and every optional field that could carry information is left out.
 * @param {ZipEntry[]} entries
 * @returns {Uint8Array<ArrayBuffer>}
 */
export function writeZip(entries) {
  return concat(/** @type {Uint8Array[]} */ (zipParts(entries)));
}

/**
 * The same archive as a Blob whose entries are the Blobs (or Files) given: nothing is copied into memory, so several
 * large files cost their headers only (review C8).
 * @param {(Omit<ZipEntry, 'data'> & { data: Blob })[]} entries
 */
export function zipBlob(entries) {
  return new Blob(/** @type {BlobPart[]} */ (zipParts(entries)), { type: 'application/zip' });
}

/**
 * The pieces of an archive in order: headers, names and the entries' data as given.
 * @param {(Omit<ZipEntry, 'data'> & { data: Uint8Array | Blob })[]} entries
 * @returns {(Uint8Array | Blob)[]}
 */
function zipParts(entries) {
  // Without ZIP64 the count is 16 bits: more would write an archive that lists none of them (review C9).
  if (entries.length > 0xffff) throw new RangeError(`A ZIP archive without ZIP64 holds at most 65,535 entries, not ${entries.length}.`);
  /** @type {(Uint8Array | Blob)[]} */
  const files = [];
  /** @type {Uint8Array[]} */
  const directory = [];
  let offset = 0;

  for (const entry of entries) {
    // The shared part of both headers: version, flags, method, time, date, checksum, sizes, name length.
    const common = new DataView(new ArrayBuffer(26));
    common.setUint16(0, 20, true);
    common.setUint16(2, entry.flags & FLAG_UTF8, true);
    common.setUint16(4, entry.method, true);
    common.setUint16(6, 0, true);
    common.setUint16(8, DOS_DATE_ZERO, true);
    common.setUint32(10, entry.crc, true);
    const stored = entry.data instanceof Blob ? entry.data.size : entry.data.length;
    common.setUint32(14, stored, true);
    common.setUint32(18, entry.size, true);
    common.setUint16(22, entry.rawName.length, true);
    common.setUint16(24, 0, true); // no extra field
    const shared = new Uint8Array(common.buffer);

    const local = new Uint8Array(4);
    new DataView(local.buffer).setUint32(0, SIG.local, true);
    files.push(local, shared, entry.rawName, entry.data);

    const central = new DataView(new ArrayBuffer(46));
    central.setUint32(0, SIG.central, true);
    central.setUint16(4, 20, true); // made by: plain ZIP 2.0, no system named
    new Uint8Array(central.buffer).set(shared, 6);
    central.setUint32(42, offset, true); // comment length, disk and attributes stay 0
    directory.push(new Uint8Array(central.buffer), entry.rawName);

    offset += 4 + shared.length + entry.rawName.length + stored;
  }

  const directorySize = directory.reduce((sum, part) => sum + part.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, SIG.end, true);
  end.setUint16(8, entries.length, true);
  end.setUint16(10, entries.length, true);
  end.setUint32(12, directorySize, true);
  end.setUint32(16, offset, true);
  return [...files, ...directory, new Uint8Array(end.buffer)];
}

/** Characters that can't be in a file name on some system: separators, Windows' reserved ones, control characters. */
const UNSAFE_IN_NAME = /[\\/:*?"<>|\u0000-\u001f\u007f]/g;

/**
 * One archive holding several clean copies, stored uncompressed. Each copy
 * is named the way its own card would save it: neutrally ("photo-1.jpg") when
 * chosen there (the default when the original name has a date in it),
 * otherwise after the original ("cat-clean.png"). Characters that can't be in
 * a file name are replaced, and names that differ only in case, which are the
 * same file on macOS and Windows, get a number.
 * @param {{ original: string, extension: string, data: Uint8Array, neutral?: boolean }[]} files
 * @param {{ fallback: string, suffix: string }} naming
 * @returns {Uint8Array<ArrayBuffer>}
 */
export function cleanArchive(files, { fallback, suffix }) {
  const encoder = new TextEncoder();
  const used = new Set();
  let neutral = 0;
  const entries = files.map(({ original, extension, data, neutral: chosen }) => {
    const plain = chosen ?? hasDate(original);
    if (plain) neutral += 1;
    const first = savedName(original, { extension, fallback: `${fallback}-${neutral}`, suffix, neutral: plain }).replace(UNSAFE_IN_NAME, '-');
    let name = first;
    for (let n = 2; used.has(name.toLowerCase()); n += 1) name = first.replace(/(\.[^.]*)$/, `-${n}$1`);
    used.add(name.toLowerCase());
    return { name, rawName: encoder.encode(name), flags: FLAG_UTF8, method: 0, crc: crc32(data), size: data.length, data };
  });
  return writeZip(entries);
}

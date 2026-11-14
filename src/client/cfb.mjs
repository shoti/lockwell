// @ts-check
/**
 * @file Reading Microsoft compound files (.doc, .xls, .ppt, .msi, .msg): the names of their streams, and a stream's bytes.
 */
/**
 * A compound file is a small file system inside one file: 512- or 4,096-byte sectors, a FAT of sector chains, a
 * directory of 128-byte entries arranged as a tree of storages (folders) and streams (files), and a mini stream for
 * streams under 4,096 bytes. Layout: MS-CFB §2.2 (header) and §2.6.1 (directory entry), read 2026-11-14 at
 * https://learn.microsoft.com/en-us/openspecs/windows_protocols/ms-cfb/.
 *
 * Nothing is trusted: chains that loop or leave the file, and directory trees that loop, throw CfbError.
 */

export class CfbError extends Error {
  /** @param {string} detail */
  constructor(detail) {
    super(`Compound file can't be read: ${detail}`);
    this.name = 'CfbError';
  }
}

/**
 * @typedef {object} CfbEntry
 * @property {string} name
 * @property {string} path  Storage names and the entry's own, joined with "/", e.g. "Macros/VBA/dir".
 * @property {'storage' | 'stream' | 'root'} type
 * @property {string} clsid  The class ID of a storage, as 32 lowercase hex digits ("" for streams and all zeros).
 * @property {number} start  First sector.
 * @property {number} size  Stream size in bytes.
 */

const SIGNATURE = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
const END_OF_CHAIN = 0xfffffffe;
const FREE_SECTOR = 0xffffffff;
const NO_STREAM = 0xffffffff;
/** More entries than any real document; stops a crafted file from listing without end. */
const MAX_ENTRIES = 100_000;
/** Storages nested deeper than any real file (Outlook messages inside messages go a few levels); paths grow with depth. */
const MAX_DEPTH = 64;

/** @param {Uint8Array} bytes */
export const isCfb = (bytes) => SIGNATURE.every((byte, i) => bytes[i] === byte);

/**
 * Opens a compound file.
 * @param {Uint8Array} bytes
 * @returns {{ entries: CfbEntry[], read: (entry: CfbEntry, maxBytes: number) => Uint8Array }}
 * @throws {CfbError}
 */
export function readCfb(bytes) {
  return guarded(() => open(bytes));
}

/**
 * Runs a reading step; a read past the end of a file cut short becomes a CfbError.
 * @template T
 * @param {() => T} step
 * @returns {T}
 */
function guarded(step) {
  try {
    return step();
  } catch (error) {
    if (error instanceof RangeError) throw new CfbError('the file is cut short');
    throw error;
  }
}

/**
 * @param {Uint8Array} bytes
 * @returns {{ entries: CfbEntry[], read: (entry: CfbEntry, maxBytes: number) => Uint8Array }}
 */
function open(bytes) {
  if (bytes.length < 512 || !isCfb(bytes)) throw new CfbError('not a compound file');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const u32 = (/** @type {number} */ at) => view.getUint32(at, true);
  const major = view.getUint16(26, true);
  const sectorShift = view.getUint16(30, true);
  if (!((major === 3 && sectorShift === 9) || (major === 4 && sectorShift === 12))) throw new CfbError(`version ${major} with sector shift ${sectorShift}`);
  const sectorSize = 1 << sectorShift;
  // Sector n starts after the header, at (n + 1) × size. A last sector cut short is read as far as it goes.
  const sectorCount = Math.ceil(bytes.length / sectorSize) - 1;
  /** @param {number} sector */
  const sectorAt = (sector) => {
    if (sector >= sectorCount) throw new CfbError(`sector ${sector} lies outside the file`);
    return (sector + 1) * sectorSize;
  };

  // The FAT's own sectors: 109 in the header, the rest in a chain of DIFAT sectors. A FAT never needs more sectors
  // than it takes to list every sector in the file, so the chain is followed no further: a crafted chain through
  // every sector would otherwise collect 127 numbers per sector.
  const needed = Math.ceil(sectorCount / (sectorSize / 4));
  /** @type {number[]} */
  const fatSectors = [];
  for (let i = 0; i < 109; i += 1) {
    const sector = u32(76 + i * 4);
    if (sector !== FREE_SECTOR) fatSectors.push(sector);
  }
  let difat = u32(68);
  const seenDifat = new Set();
  while (difat !== END_OF_CHAIN && difat !== FREE_SECTOR && fatSectors.length < needed) {
    if (seenDifat.has(difat)) throw new CfbError('the DIFAT chain loops');
    seenDifat.add(difat);
    const at = sectorAt(difat);
    for (let i = 0; i < sectorSize / 4 - 1; i += 1) {
      const sector = u32(at + i * 4);
      if (sector !== FREE_SECTOR) fatSectors.push(sector);
    }
    difat = u32(at + sectorSize - 4);
  }
  fatSectors.length = Math.min(fatSectors.length, needed);
  const fat = new Uint32Array(fatSectors.length * (sectorSize / 4));
  fatSectors.forEach((sector, n) => {
    const at = sectorAt(sector);
    for (let i = 0; i < sectorSize / 4; i += 1) fat[n * (sectorSize / 4) + i] = u32(at + i * 4);
  });

  /**
   * The sectors of a chain, in order.
   * @param {Uint32Array} table
   * @param {number} start
   */
  const chain = (table, start) => {
    /** @type {number[]} */
    const out = [];
    const seen = new Set();
    for (let sector = start; sector !== END_OF_CHAIN; sector = table[sector]) {
      if (sector === FREE_SECTOR || sector >= table.length || seen.has(sector)) throw new CfbError(`a sector chain is broken at ${sector}`);
      seen.add(sector);
      out.push(sector);
    }
    return out;
  };
  /** The bytes of a chain of regular sectors, cut to `size`. @param {number} start @param {number} size */
  const regular = (start, size) => {
    const sectors = chain(fat, start);
    const out = new Uint8Array(Math.min(size, sectors.length * sectorSize));
    sectors.forEach((sector, i) => {
      const at = sectorAt(sector);
      out.set(bytes.subarray(at, at + Math.min(sectorSize, out.length - i * sectorSize)), i * sectorSize);
    });
    return out;
  };

  // The directory: 128-byte entries.
  const directory = regular(u32(48), Number.MAX_SAFE_INTEGER);
  const dirView = new DataView(directory.buffer, directory.byteOffset, directory.byteLength);
  const count = Math.min(Math.floor(directory.length / 128), MAX_ENTRIES);
  /** @param {number} id */
  const raw = (id) => {
    const at = id * 128;
    const nameLength = Math.min(dirView.getUint16(at + 64, true), 64);
    const name = new TextDecoder('utf-16le').decode(directory.subarray(at, at + Math.max(0, nameLength - 2)));
    const type = directory[at + 66];
    const clsid = Array.from(directory.subarray(at + 80, at + 96), (byte) => byte.toString(16).padStart(2, '0')).join('');
    return {
      name,
      type,
      left: dirView.getUint32(at + 68, true),
      right: dirView.getUint32(at + 72, true),
      child: dirView.getUint32(at + 76, true),
      clsid: /^0+$/.test(clsid) ? '' : clsid,
      start: dirView.getUint32(at + 116, true),
      // Version 3 files may leave rubbish in the high half of the size (MS-CFB §2.6.1); streams are under 4 GB there.
      size: major === 3 ? dirView.getUint32(at + 120, true) : Number(dirView.getBigUint64(at + 120, true)),
    };
  };
  if (count === 0 || raw(0).type !== 5) throw new CfbError('no root entry');

  /** @type {CfbEntry[]} */
  const entries = [];
  const visited = new Set();
  const root = raw(0);
  visited.add(0);
  entries.push({ name: root.name, path: '', type: 'root', clsid: root.clsid, start: root.start, size: root.size });
  // Each storage's children form a red-black tree of siblings; walked with a stack, not recursion, so a crafted
  // chain of nested storages can't exhaust the call stack.
  /** @type {{ id: number, parent: string, depth: number }[]} */
  const stack = [{ id: root.child, parent: '', depth: 1 }];
  while (stack.length) {
    const { id, parent, depth } = /** @type {{ id: number, parent: string, depth: number }} */ (stack.pop());
    if (id === NO_STREAM) continue;
    if (id >= count || visited.has(id)) throw new CfbError('the directory tree loops or points outside it');
    if (depth > MAX_DEPTH) throw new CfbError('storages are nested too deeply');
    visited.add(id);
    const entry = raw(id);
    stack.push({ id: entry.left, parent, depth }, { id: entry.right, parent, depth });
    if (entry.type !== 1 && entry.type !== 2) continue;
    const path = parent ? `${parent}/${entry.name}` : entry.name;
    entries.push({ name: entry.name, path, type: entry.type === 1 ? 'storage' : 'stream', clsid: entry.clsid, start: entry.start, size: entry.size });
    if (entry.type === 1) stack.push({ id: entry.child, parent: path, depth: depth + 1 });
  }

  // Streams under the cutoff live in the mini stream, in 64-byte sectors listed in the mini FAT.
  const cutoff = u32(56);
  /** @type {Uint8Array | null} */
  let miniStream = null;
  /** @type {Uint32Array | null} */
  let miniFat = null;

  return {
    entries,
    read: (entry, maxBytes) => guarded(() => readStream(entry, maxBytes)),
  };

  /** @param {CfbEntry} entry @param {number} maxBytes */
  function readStream(entry, maxBytes) {
    if (entry.type !== 'stream') return new Uint8Array(0);
    if (entry.size > maxBytes) throw new CfbError(`"${entry.path}" is larger than ${maxBytes} bytes`);
    if (entry.size >= cutoff) return regular(entry.start, entry.size);
    miniStream ??= regular(root.start, root.size);
    if (!miniFat) {
      const table = u32(64) ? regular(u32(60), u32(64) * sectorSize) : new Uint8Array(0);
      miniFat = new Uint32Array(table.length / 4);
      const tableView = new DataView(table.buffer, table.byteOffset, table.byteLength);
      for (let i = 0; i < miniFat.length; i += 1) miniFat[i] = tableView.getUint32(i * 4, true);
    }
    const sectors = chain(miniFat, entry.start);
    const out = new Uint8Array(Math.min(entry.size, sectors.length * 64));
    sectors.forEach((sector, i) => {
      if ((sector + 1) * 64 > /** @type {Uint8Array} */ (miniStream).length) throw new CfbError('a mini sector lies outside the mini stream');
      out.set(/** @type {Uint8Array} */ (miniStream).subarray(sector * 64, sector * 64 + Math.min(64, out.length - i * 64)), i * 64);
    });
    return out;
  }
}

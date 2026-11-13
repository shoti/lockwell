// @ts-check
/**
 * @file Writing ZIP archives: the document tool's clean copies, and several clean files saved at once.
 */

import { concat, crc32 } from './bytes.mjs';
import { hasDate, savedName } from './save.mjs';

export const SIG = { local: 0x04034b50, central: 0x02014b50, end: 0x06054b50 };
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

/**
 * Writes a ZIP archive. Entries keep their bytes and names; dates are reset
 * and every optional field that could carry information is left out.
 * @param {ZipEntry[]} entries
 * @returns {Uint8Array<ArrayBuffer>}
 */
export function writeZip(entries) {
  /** @type {Uint8Array[]} */
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
    common.setUint32(14, entry.data.length, true);
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

    offset += 4 + shared.length + entry.rawName.length + entry.data.length;
  }

  const directorySize = directory.reduce((sum, part) => sum + part.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, SIG.end, true);
  end.setUint16(8, entries.length, true);
  end.setUint16(10, entries.length, true);
  end.setUint32(12, directorySize, true);
  end.setUint32(16, offset, true);
  return concat([...files, ...directory, new Uint8Array(end.buffer)]);
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

// @ts-check
/**
 * @file Small helpers for reading and writing binary files, shared by the file tools.
 */
/** Small helpers for reading and writing binary files, shared by the file tools. */

/**
 * @param {Uint8Array} bytes
 * @param {number} offset
 * @param {string} text  ASCII.
 */
export function startsWith(bytes, offset, text) {
  if (offset + text.length > bytes.length) return false;
  for (let i = 0; i < text.length; i += 1) {
    if (bytes[offset + i] !== text.charCodeAt(i)) return false;
  }
  return true;
}

/** @param {Uint8Array[]} parts */
export function concat(parts) {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

/** @param {string} text  ASCII. */
export const ascii = (text) => Uint8Array.from(text, (char) => char.charCodeAt(0));

const CRC_TABLE = Uint32Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

/** The CRC-32 checksum used by PNG and ZIP. @param {Uint8Array} bytes */
export function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

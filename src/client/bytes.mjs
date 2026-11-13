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

/**
 * Bytes as text of one character per byte, code points 0 to 255, so offsets and binary data survive and
 * `ascii` turns it back. Not TextDecoder("latin1"), which is windows-1252 and changes bytes 0x80 to 0x9F.
 * @param {Uint8Array} bytes
 */
export function byteString(bytes) {
  let out = '';
  for (let i = 0; i < bytes.length; i += 0x8000) out += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return out;
}

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

// @ts-check
/**
 * @file RC4, written out because Web Crypto has none. Used only to open PDFs locked with the old standard security
 * handler, revisions 2 to 4 (ISO 32000-1 §7.6.2), where the PDF format itself prescribes it; checked against the
 * RFC 6229 test vectors. Never use it to protect anything: RC4 is broken for that.
 */

/**
 * RC4 with a key of 1 to 256 bytes over some bytes. Encrypting and decrypting are the same operation.
 * @param {Uint8Array} key
 * @param {Uint8Array} bytes
 * @returns {Uint8Array}  A new array.
 */
export function rc4(key, bytes) {
  if (key.length === 0 || key.length > 256) throw new RangeError(`RC4 key must be 1 to 256 bytes, got ${key.length}`);
  const s = Uint8Array.from({ length: 256 }, (_, i) => i);
  for (let i = 0, j = 0; i < 256; i += 1) {
    j = (j + s[i] + key[i % key.length]) & 0xff;
    [s[i], s[j]] = [s[j], s[i]];
  }
  const out = new Uint8Array(bytes.length);
  for (let n = 0, i = 0, j = 0; n < bytes.length; n += 1) {
    i = (i + 1) & 0xff;
    j = (j + s[i]) & 0xff;
    const t = s[i];
    s[i] = s[j];
    s[j] = t;
    out[n] = bytes[n] ^ s[(s[i] + s[j]) & 0xff];
  }
  return out;
}

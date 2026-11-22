// @ts-check
/**
 * @file MD5 (RFC 1321), written out because Web Crypto has none. Used only to open PDFs locked with the old
 * standard security handler, revisions 2 to 4 (ISO 32000-1 §7.6.3, plan docs/tools-plan/pdf-toolkit.md §6.6), where
 * the PDF format itself prescribes it. Never use it to protect anything: MD5 is broken for that.
 */

/** T[i] = the integer part of 4294967296 × abs(sin(i)), i = 1…64 (RFC 1321 §3.4). */
const T = Uint32Array.from({ length: 64 }, (_, i) => Math.floor(4294967296 * Math.abs(Math.sin(i + 1))));

/** Left-rotation amounts, four per round (RFC 1321 §3.4). */
const SHIFTS = [
  [7, 12, 17, 22],
  [5, 9, 14, 20],
  [4, 11, 16, 23],
  [6, 10, 15, 21],
];

/** Which message word step i of a round uses: round 1 i, round 2 1+5i, round 3 5+3i, round 4 7i (mod 16). */
const WORD = Uint8Array.from({ length: 64 }, (_, i) => {
  const step = i % 16;
  return [step, (1 + 5 * step) % 16, (5 + 3 * step) % 16, (7 * step) % 16][i >> 4];
});

/**
 * The 16-byte MD5 digest of some bytes.
 * @param {Uint8Array} bytes
 * @returns {Uint8Array}
 */
export function md5(bytes) {
  // Steps 1 and 2: a 1 bit, 0 bits up to 448 mod 512, then the length in bits, low word first.
  const padded = new Uint8Array((((bytes.length + 8) >> 6) + 1) << 6);
  padded.set(bytes);
  padded[bytes.length] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(padded.length - 8, (bytes.length * 8) >>> 0, true);
  view.setUint32(padded.length - 4, Math.floor(bytes.length / 0x20000000), true);
  // Step 3: the buffer, low-order bytes first: 01 23 45 67, 89 ab cd ef, fe dc ba 98, 76 54 32 10.
  let a0 = 0x67452301;
  let b0 = 0xefcdab89;
  let c0 = 0x98badcfe;
  let d0 = 0x10325476;
  const x = new Uint32Array(16);
  for (let block = 0; block < padded.length; block += 64) {
    for (let j = 0; j < 16; j += 1) x[j] = view.getUint32(block + j * 4, true);
    let a = a0;
    let b = b0;
    let c = c0;
    let d = d0;
    for (let i = 0; i < 64; i += 1) {
      const round = i >> 4;
      const f =
        round === 0 ? (b & c) | (~b & d) : round === 1 ? (b & d) | (c & ~d) : round === 2 ? b ^ c ^ d : c ^ (b | ~d);
      const sum = (a + f + x[WORD[i]] + T[i]) | 0;
      const s = SHIFTS[round][i & 3];
      const next = (b + ((sum << s) | (sum >>> (32 - s)))) | 0;
      a = d;
      d = c;
      c = b;
      b = next;
    }
    a0 = (a0 + a) | 0;
    b0 = (b0 + b) | 0;
    c0 = (c0 + c) | 0;
    d0 = (d0 + d) | 0;
  }
  const out = new Uint8Array(16);
  const outView = new DataView(out.buffer);
  [a0, b0, c0, d0].forEach((word, i) => outView.setUint32(i * 4, word >>> 0, true));
  return out;
}

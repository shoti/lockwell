// @ts-check
/**
 * @file Writing a PDF (plan §6.4): a fresh file every time, never an update of a source. PDF 1.7 header; every
 * object that is not a stream packed into object streams, with a cross-reference stream (ISO 32000-1 §7.5.7–7.5.8);
 * streams without a filter deflated; identical streams written once; objects numbered from 1 without gaps. The
 * trailer has a fresh random /ID and nothing else that describes the document: no /Info. The same objects and the
 * same /ID give the same bytes.
 */
import { concat } from './bytes.mjs';
import { PdfDict, PdfError, PdfName, PdfRef, PdfStream, PdfString, serialise } from './pdf-syntax.mjs';

/** @typedef {import('./pdf-syntax.mjs').PdfObject} PdfObject */

/** Objects per object stream. */
export const PACK = 100;
/** Objects handled between pauses, so the page stays responsive and Cancel is seen (plan §8). */
export const BATCH = 200;

/** Yields to the event loop. */
export const pause = () => new Promise((resolve) => setTimeout(resolve, 0));

/** @param {string} text  One character per byte. */
const bytesOf = (text) => {
  const out = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i += 1) out[i] = text.charCodeAt(i);
  return out;
};

/**
 * Deflate (zlib, RFC 1950) through the browser's CompressionStream.
 * @param {Uint8Array} data
 */
export async function deflate(data) {
  const stream = new Blob([/** @type {Uint8Array<ArrayBuffer>} */ (data)]).stream().pipeThrough(new CompressionStream('deflate'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** @param {Uint8Array} data */
async function sha256(data) {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', /** @type {Uint8Array<ArrayBuffer>} */ (data)));
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** The output document: objects under provisional numbers, written with final ones. */
export class PdfWriter {
  constructor() {
    /** @type {Map<number, PdfObject>} */
    this.objects = new Map();
    this.next = 1;
    /** A stream found identical to an earlier one, by number, and the number that holds it. @type {Map<number, number>} */
    this.alias = new Map();
    /** @type {Map<string, number>} */
    this.hashes = new Map();
  }

  /** A number for an object that is filled in later. */
  reserve() {
    const ref = new PdfRef(this.next, 0);
    this.next += 1;
    return ref;
  }

  /** @param {PdfRef} ref @param {PdfObject} value */
  set(ref, value) {
    if (value instanceof PdfStream) throw new PdfError('damaged', 'streams go through setStream');
    this.objects.set(ref.num, value);
  }

  /** @param {PdfObject} value */
  add(value) {
    const ref = this.reserve();
    this.set(ref, value);
    return ref;
  }

  /** @param {PdfRef} ref */
  get(ref) {
    const num = this.alias.get(ref.num) ?? ref.num;
    return this.objects.get(num);
  }

  /**
   * A stream. One identical in dictionary and data to a stream already set is not stored again: its number
   * becomes another name for the first (plan §6.4).
   * @param {PdfRef} ref
   * @param {PdfStream} stream
   */
  async setStream(ref, stream) {
    const dict = new PdfDict([...stream.dict.entries()].filter(([key]) => key !== 'Length'));
    const key = await sha256(concat([bytesOf(serialise(dict)), Uint8Array.of(0), stream.data]));
    const first = this.hashes.get(key);
    if (first !== undefined && first !== ref.num) {
      this.alias.set(ref.num, first);
      this.objects.delete(ref.num);
      return;
    }
    this.hashes.set(key, ref.num);
    this.objects.set(ref.num, new PdfStream(dict, stream.data));
  }

  /**
   * The file.
   * @param {{ root: PdfRef, id?: Uint8Array, isCancelled?: () => boolean }} options
   *   id: 16 bytes for /ID (tests pass a fixed one); otherwise random.
   * @returns {Promise<Uint8Array>}
   * @throws {PdfError}  `cancelled`.
   */
  async write({ root, id = crypto.getRandomValues(new Uint8Array(16)), isCancelled = () => false }) {
    // Final numbers: 1, 2, 3… in provisional order, aliases resolved, references to nothing made null.
    /** @type {Map<number, number>} */
    const final = new Map();
    for (const num of [...this.objects.keys()].sort((a, b) => a - b)) final.set(num, final.size + 1);
    /** @param {PdfObject} value @returns {PdfObject} */
    const renumber = (value) => {
      if (value instanceof PdfRef) {
        const target = final.get(this.alias.get(value.num) ?? value.num);
        return target === undefined ? null : new PdfRef(target, 0);
      }
      if (Array.isArray(value)) return value.map(renumber);
      if (value instanceof PdfDict) return new PdfDict([...value.entries()].map(([key, item]) => [key, renumber(item)]));
      return value;
    };
    const rootRef = renumber(root);
    if (!(rootRef instanceof PdfRef)) throw new PdfError('damaged', 'the catalog was not written');

    /** @type {Uint8Array[]} */
    const parts = [];
    let length = 0;
    /** @param {Uint8Array} bytes */
    const put = (bytes) => {
      parts.push(bytes);
      length += bytes.length;
    };
    /** Offsets of plain objects, and the object stream and index of packed ones, by final number. */
    /** @type {Map<number, number | [number, number]>} */
    const entries = new Map();
    put(concat([bytesOf('%PDF-1.7\n%'), Uint8Array.of(0xe2, 0xe3, 0xcf, 0xd3), bytesOf('\n')]));

    /** @type {[number, PdfObject][]} */
    const packable = [];
    let done = 0;
    const step = async () => {
      done += 1;
      if (done % BATCH === 0) {
        await pause();
        if (isCancelled()) throw new PdfError('cancelled');
      }
    };
    for (const [provisional, value] of [...this.objects].sort(([a], [b]) => a - b)) {
      const num = /** @type {number} */ (final.get(provisional));
      if (value instanceof PdfStream) {
        entries.set(num, length);
        put(await this.streamBytes(num, /** @type {PdfDict} */ (renumber(value.dict)), value.data));
      } else if (value instanceof PdfRef) {
        // An object that is only a reference may not go into an object stream (§7.5.7).
        entries.set(num, length);
        put(bytesOf(`${num} 0 obj\n${serialise(renumber(value))}\nendobj\n`));
      } else {
        packable.push([num, renumber(value)]);
      }
      await step();
    }

    let nextNum = final.size + 1;
    for (let i = 0; i < packable.length; i += PACK) {
      const group = packable.slice(i, i + PACK);
      const bodies = group.map(([, value]) => serialise(value));
      let offset = 0;
      const head = group.map(([num], k) => {
        const pair = `${num} ${offset}`;
        offset += bodies[k].length + 1;
        return pair;
      }).join(' ');
      const first = head.length + 1;
      const data = await deflate(bytesOf(`${head}\n${bodies.join('\n')}\n`));
      const streamNum = nextNum;
      nextNum += 1;
      group.forEach(([num], k) => entries.set(num, [streamNum, k]));
      entries.set(streamNum, length);
      const dict = new PdfDict([['Type', new PdfName('ObjStm')], ['N', group.length], ['First', first], ['Filter', new PdfName('FlateDecode')]]);
      put(await this.streamBytes(streamNum, dict, data, false));
      await step();
    }

    // The cross-reference stream lists itself (§7.5.8.3).
    const xrefNum = nextNum;
    const xrefAt = length;
    entries.set(xrefNum, xrefAt);
    const size = xrefNum + 1;
    const largest = Math.max(xrefAt, size);
    const width = Math.max(1, Math.ceil(Math.log2(largest + 1) / 8));
    const rows = new Uint8Array(size * (1 + width + 2));
    for (let num = 0; num < size; num += 1) {
      const entry = entries.get(num);
      const at = num * (1 + width + 2);
      const [type, second, third] = entry === undefined ? [0, 0, num === 0 ? 65535 : 0] : Array.isArray(entry) ? [2, entry[0], entry[1]] : [1, entry, 0];
      rows[at] = type;
      for (let k = 0; k < width; k += 1) rows[at + 1 + k] = Math.floor(second / 256 ** (width - 1 - k)) % 256;
      rows[at + 1 + width] = third >> 8;
      rows[at + 2 + width] = third & 0xff;
    }
    const idString = new PdfString(Uint8Array.from(id), true);
    const xref = new PdfDict([
      ['Type', new PdfName('XRef')],
      ['Size', size],
      ['W', [1, width, 2]],
      ['Root', rootRef],
      ['ID', [idString, idString]],
      ['Filter', new PdfName('FlateDecode')],
    ]);
    put(await this.streamBytes(xrefNum, xref, await deflate(rows), false));
    put(bytesOf(`startxref\n${xrefAt}\n%%EOF\n`));
    return concat(parts);
  }

  /**
   * One stream object. Data without a filter is deflated unless that makes it larger.
   * @param {number} num @param {PdfDict} dict @param {Uint8Array} data @param {boolean} [compress]
   */
  async streamBytes(num, dict, data, compress = true) {
    let out = data;
    const head = new PdfDict(dict.entries());
    if (compress && !head.has('Filter') && data.length > 0) {
      const packed = await deflate(data);
      if (packed.length < data.length) {
        out = packed;
        head.delete('DecodeParms');
        head.set('Filter', new PdfName('FlateDecode'));
      }
    }
    head.set('Length', out.length);
    return concat([bytesOf(`${num} 0 obj\n${serialise(head)}\nstream\n`), out, bytesOf('\nendstream\nendobj\n')]);
  }
}

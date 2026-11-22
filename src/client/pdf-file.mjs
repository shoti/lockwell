// @ts-check
/**
 * @file Opening a PDF: the header, the cross-reference data (classic tables, cross-reference streams, hybrid files,
 * chains of updates), object streams, objects read on demand, stream decoding, and a repair scan when the
 * cross-reference data cannot be followed. ISO 32000-1 §7.4–7.5, quoted in docs/research/tool-pdf-toolkit.md §4 and
 * §14. Pure, no DOM; Web streams for Flate (DecompressionStream). Encrypted files are recognised here and read by
 * pdf-crypt.mjs.
 */
import { concat } from './bytes.mjs';
import { Lexer, PdfDict, PdfError, PdfName, PdfRef, PdfStream, isName, isRegular, isSpace, parseObject } from './pdf-syntax.mjs';

export { PdfError };

/** Limits of plan §6.3 that the reader enforces. Over one: `tooLarge`. */
export const LIMITS = {
  /** Objects in one file. */
  objects: 2_000_000,
  /** Bytes of one decoded stream. */
  stream: 256 * 1024 ** 2,
  /** Bytes decoded in one job, all streams of all files together (a `Meter`). */
  total: 1024 ** 3,
  /** Cross-reference sections followed through /Prev. */
  sections: 10_000,
};

/** How much work the reader did, for tests that count operations instead of timing them. */
export const COUNTS = { parsed: 0, structural: 0, decoded: 0 };

/**
 * Decoded bytes so far against a limit; one per job, shared by its files.
 * @typedef {{ used: number, limit: number }} Meter
 */
/** @param {number} [limit] @returns {Meter} */
export const meter = (limit = LIMITS.total) => ({ used: 0, limit });

/**
 * Where an object is: at a byte offset, inside an object stream, or nowhere (deleted).
 * @typedef {{ type: 'plain', offset: number } | { type: 'packed', stream: number, index: number } | { type: 'free' }} Entry
 * @typedef {{ data: Uint8Array, first: number, pairs: [number, number][] }} Pack
 */

/** Bytes searched backwards from the end for "startxref". Files often have junk after %%EOF. */
const TAIL = 4096;

/**
 * Opens a PDF. Reads only the structure: the cross-reference data and the object streams; no page content and no
 * picture is decoded (plan §8).
 * @param {Uint8Array} bytes
 * @param {{ meter?: Meter }} [options]
 * @returns {Promise<PdfFile>}
 * @throws {PdfError}
 */
export async function openPdf(bytes, { meter: jobMeter = meter() } = {}) {
  const file = new PdfFile(bytes, jobMeter);
  await file.load();
  return file;
}

export class PdfFile {
  /** @param {Uint8Array} bytes @param {Meter} jobMeter */
  constructor(bytes, jobMeter) {
    this.bytes = bytes;
    this.meter = jobMeter;
    /** Offset of "%PDF-": junk before it shifts every offset in some files. */
    this.header = -1;
    /** The version in the header, such as "1.7". */
    this.version = '';
    /** @type {Map<number, Entry>} */
    this.entries = new Map();
    this.trailer = new PdfDict();
    /** True when the cross-reference data was rebuilt by scanning (plan §6.2). */
    this.repaired = false;
    /** True when the trailer names an encryption dictionary. */
    this.encrypted = false;
    /** Objects that are listed but could not be read: they read as null. */
    this.broken = new Set();
    /** @type {Map<number, import('./pdf-syntax.mjs').PdfObject>} */
    this.cache = new Map();
    /** @type {Map<number, Pack | PdfError>} */
    this.packs = new Map();
    /** Objects being read, so a stream whose /Length refers to itself cannot loop. @type {Set<number>} */
    this.reading = new Set();
    /** Cross-reference streams read, by number, with where they really are. @type {Map<number, number>} */
    this.sections = new Map();
  }

  async load() {
    const { bytes } = this;
    this.header = find(bytes, '%PDF-', 0, 1024);
    if (this.header < 0) throw new PdfError('unsupported', 'no %PDF- header in the first 1024 bytes');
    this.version = /^\d\.\d/.exec(String.fromCharCode(...bytes.subarray(this.header + 5, this.header + 8)))?.[0] ?? '';
    let readable = false;
    try {
      await this.readSections();
      readable = this.offsetsHold();
    } catch (error) {
      if (!(error instanceof PdfError)) throw error; // any broken section: the repair scan below, which keeps the limits
    }
    if (readable) {
      this.encrypted = this.trailer.has('Encrypt');
      await this.loadPacks();
      if (this.hasPageTree()) return;
    }
    await this.repair();
    if (!this.hasPageTree()) throw new PdfError('damaged', 'no page tree');
  }

  /* ---------- Cross-reference sections (§7.5.4–7.5.8) ---------- */

  async readSections() {
    const { bytes } = this;
    const from = Math.max(0, bytes.length - TAIL);
    const at = findLast(bytes, 'startxref', from);
    if (at < 0) throw new PdfError('damaged', 'no startxref');
    const lexer = new Lexer(bytes, at + 9);
    const first = lexer.next();
    if (first.type !== 'number' || !first.integer) throw new PdfError('damaged', 'startxref has no offset');
    /** @type {number | null} */
    let offset = first.value;
    const seen = new Set();
    /** @type {PdfDict[]} */
    const trailers = [];
    while (offset !== null) {
      // A /Prev that points back to a section already read ends the chain: everything newer has been read.
      if (seen.has(offset)) break;
      seen.add(offset);
      if (seen.size > LIMITS.sections) throw new PdfError('tooLarge', 'too many cross-reference sections');
      const section = await this.readSection(offset);
      trailers.push(section);
      const stream = section.get('XRefStm');
      if (typeof stream === 'number' && !seen.has(stream)) {
        seen.add(stream);
        await this.readSection(stream).catch((error) => {
          if (!(error instanceof PdfError) || error.code === 'tooLarge') throw error;
        });
      }
      const prev = section.get('Prev');
      offset = typeof prev === 'number' ? prev : null;
    }
    // The newest trailer counts; keys it lacks are taken from older ones (an update may leave out /Root).
    const trailer = new PdfDict();
    for (const section of trailers) {
      for (const [key, value] of section.entries()) if (!trailer.has(key) && key !== 'Prev' && key !== 'XRefStm') trailer.set(key, value);
    }
    this.trailer = trailer;
  }

  /**
   * One section at an offset: a classic table ("xref") or a cross-reference stream ("n 0 obj"). Entries already
   * known (from newer sections) are kept.
   * @param {number} offset
   * @returns {Promise<PdfDict>}  Its trailer, or the stream's dictionary.
   */
  async readSection(offset) {
    for (const at of this.header > 0 ? [offset, offset + this.header] : [offset]) {
      const lexer = new Lexer(this.bytes, at);
      lexer.skipSpace();
      if (startsAt(this.bytes, lexer.pos, 'xref')) return this.readTable(lexer.pos + 4);
      if (headerAt(this.bytes, lexer.pos) >= 0) return this.readXrefStream(lexer.pos);
    }
    throw new PdfError('damaged', `no cross-reference section at ${offset}`);
  }

  /** @param {number} at  Just after "xref". */
  readTable(at) {
    const lexer = new Lexer(this.bytes, at);
    let firstSubsection = true;
    for (;;) {
      const token = lexer.next();
      if (token.type === 'keyword' && token.value === 'trailer') break;
      const count = lexer.next();
      if (token.type !== 'number' || !token.integer || count.type !== 'number' || !count.integer || token.value < 0 || count.value < 0) {
        throw new PdfError('damaged', `bad cross-reference subsection at ${token.start}`);
      }
      let start = token.value;
      for (let i = 0; i < count.value; i += 1) {
        const value = lexer.next();
        const gen = lexer.next();
        const kind = lexer.next();
        if (value.type !== 'number' || gen.type !== 'number' || kind.type !== 'keyword' || (kind.value !== 'n' && kind.value !== 'f')) {
          throw new PdfError('damaged', `bad cross-reference entry at ${value.start}`);
        }
        // A common writer bug: "1 n" for a table that starts with object 0's free entry.
        if (firstSubsection && i === 0 && start === 1 && kind.value === 'f' && value.value === 0 && gen.value === 65535) start = 0;
        this.keep(start + i, kind.value === 'n' && value.value > 0 ? { type: 'plain', offset: value.value } : { type: 'free' });
      }
      firstSubsection = false;
    }
    const trailer = parseObject(lexer);
    if (!(trailer instanceof PdfDict)) throw new PdfError('damaged', 'trailer is not a dictionary');
    return trailer;
  }

  /** @param {number} at  Where "n 0 obj" starts. */
  async readXrefStream(at) {
    const stream = this.readAt(at, headerAt(this.bytes, at));
    if (!(stream instanceof PdfStream) || !isName(stream.dict.get('Type'), 'XRef')) throw new PdfError('damaged', `no cross-reference stream at ${at}`);
    this.sections.set(headerAt(this.bytes, at), at);
    const { dict } = stream;
    const widths = dict.get('W');
    if (!Array.isArray(widths) || widths.length < 3 || !widths.every((w) => Number.isInteger(w) && /** @type {number} */ (w) >= 0 && /** @type {number} */ (w) <= 8)) {
      throw new PdfError('damaged', 'bad /W in a cross-reference stream');
    }
    const [w1, w2, w3] = /** @type {number[]} */ (widths);
    const width = w1 + w2 + w3;
    if (width === 0) throw new PdfError('damaged', '/W of zero width');
    const size = dict.get('Size');
    const index = dict.get('Index') ?? [0, typeof size === 'number' ? size : 0];
    if (!Array.isArray(index) || index.length % 2 !== 0 || !index.every((n) => Number.isInteger(n) && /** @type {number} */ (n) >= 0)) {
      throw new PdfError('damaged', 'bad /Index in a cross-reference stream');
    }
    const data = await this.decode(stream, { structural: true });
    let pos = 0;
    /** @param {number} n */
    const field = (n) => {
      let value = 0;
      for (let i = 0; i < n; i += 1) value = value * 256 + data[pos + i];
      pos += n;
      return value;
    };
    for (let i = 0; i < index.length; i += 2) {
      const start = /** @type {number} */ (index[i]);
      const count = /** @type {number} */ (index[i + 1]);
      if (count > LIMITS.objects) throw new PdfError('tooLarge', 'too many objects');
      for (let j = 0; j < count && pos + width <= data.length; j += 1) {
        const type = w1 === 0 ? 1 : field(w1);
        const second = field(w2);
        const third = field(w3);
        if (type === 1) this.keep(start + j, second > 0 ? { type: 'plain', offset: second } : { type: 'free' });
        else if (type === 2) this.keep(start + j, { type: 'packed', stream: second, index: third });
        else this.keep(start + j, { type: 'free' }); // type 0, and unknown types read as null (§7.5.8.3)
      }
    }
    return dict;
  }

  /** @param {number} num @param {Entry} entry */
  keep(num, entry) {
    if (this.entries.has(num)) return;
    if (this.entries.size >= LIMITS.objects) throw new PdfError('tooLarge', 'too many objects');
    this.entries.set(num, entry);
  }

  /**
   * True when every listed object is where the table says. Junk before the header shifts every offset in some
   * files: when the offsets all hold once shifted, the shift is applied. Writers often list a cross-reference
   * stream at a stale offset in its own data (qpdf's good17.pdf, hybrid-xref.pdf); nothing refers to it, so its
   * entry is set to where it was read instead of counting as damage.
   */
  offsetsHold() {
    for (const [num, at] of this.sections) {
      const entry = this.entries.get(num);
      if (entry?.type === 'plain' && headerAt(this.bytes, entry.offset) !== num) entry.offset = at;
    }
    const plain = [...this.entries].filter(([, entry]) => entry.type === 'plain');
    /** @param {number} shift */
    const hold = (shift) => plain.every(([num, entry]) => headerAt(this.bytes, /** @type {{ offset: number }} */ (entry).offset + shift) === num);
    if (hold(0)) return true;
    if (this.header > 0 && hold(this.header)) {
      for (const [, entry] of plain) /** @type {{ offset: number }} */ (entry).offset += this.header;
      return true;
    }
    return false;
  }

  /* ---------- Object streams (§7.5.7) ---------- */

  /** Decodes every object stream the entries point into. In an encrypted file they wait for the key. */
  async loadPacks() {
    const streams = new Set();
    for (const entry of this.entries.values()) if (entry.type === 'packed') streams.add(entry.stream);
    for (const num of streams) {
      if (this.encrypted) {
        this.packs.set(num, new PdfError('locked', 'object stream of an encrypted file'));
        continue;
      }
      try {
        this.packs.set(num, await this.readPack(num));
      } catch (error) {
        if (!(error instanceof PdfError) || error.code === 'tooLarge') throw error;
        this.packs.set(num, error);
      }
    }
  }

  /** @param {number} num */
  async readPack(num) {
    const entry = this.entries.get(num);
    const stream = entry?.type === 'plain' ? this.readAt(entry.offset, num) : null;
    if (!(stream instanceof PdfStream)) throw new PdfError('damaged', `object stream ${num} is missing`);
    const count = stream.dict.get('N');
    const first = stream.dict.get('First');
    if (!Number.isInteger(count) || !Number.isInteger(first) || /** @type {number} */ (count) < 0 || /** @type {number} */ (first) < 0) {
      throw new PdfError('damaged', `object stream ${num} has no /N or /First`);
    }
    const data = await this.decode(stream, { structural: true });
    const lexer = new Lexer(data, 0);
    /** @type {[number, number][]} */
    const pairs = [];
    for (let i = 0; i < /** @type {number} */ (count); i += 1) {
      const number = lexer.next();
      const offset = lexer.next();
      if (number.type !== 'number' || offset.type !== 'number' || offset.start >= /** @type {number} */ (first)) break;
      pairs.push([number.value, offset.value]);
    }
    return { data, first: /** @type {number} */ (first), pairs };
  }

  /* ---------- Objects ---------- */

  /**
   * An indirect object by number: null when it is missing, deleted or unreadable (§7.3.10: a reference to an
   * undefined object is null). Parsed once and cached.
   * @param {number} num
   * @returns {import('./pdf-syntax.mjs').PdfObject}
   * @throws {PdfError}  `locked` for an object packed in an encrypted object stream.
   */
  get(num) {
    if (this.cache.has(num)) return /** @type {import('./pdf-syntax.mjs').PdfObject} */ (this.cache.get(num));
    const entry = this.entries.get(num);
    let value = null;
    if (entry?.type === 'plain' || entry?.type === 'packed') {
      try {
        value = entry.type === 'plain' ? this.readAt(entry.offset, num) : this.readPacked(num, entry);
      } catch (error) {
        if (!(error instanceof PdfError) || error.code === 'locked') throw error;
        this.broken.add(num);
      }
    }
    this.cache.set(num, value);
    return value;
  }

  /**
   * A value with references followed: a reference to a reference is followed too, a few times.
   * @param {import('./pdf-syntax.mjs').PdfObject | undefined} value
   * @returns {import('./pdf-syntax.mjs').PdfObject}
   */
  resolve(value) {
    let current = value ?? null;
    for (let i = 0; current instanceof PdfRef; i += 1) {
      if (i === 32) return null;
      current = this.get(current.num);
    }
    return current;
  }

  /** The document catalog. @returns {PdfDict} */
  catalog() {
    const root = this.resolve(this.trailer.get('Root'));
    if (!(root instanceof PdfDict)) throw new PdfError('damaged', 'no catalog');
    return root;
  }

  hasPageTree() {
    try {
      return this.resolve(this.catalog().get('Pages')) instanceof PdfDict;
    } catch (error) {
      if (error instanceof PdfError && error.code === 'locked') throw error;
      return false;
    }
  }

  /**
   * The object whose header "num gen obj" starts at an offset.
   * @param {number} offset
   * @param {number} num  The number the header must carry.
   */
  readAt(offset, num) {
    const lexer = new Lexer(this.bytes, offset);
    const n = lexer.next();
    const g = lexer.next();
    const obj = lexer.next();
    if (n.type !== 'number' || n.value !== num || g.type !== 'number' || obj.type !== 'keyword' || obj.value !== 'obj') {
      throw new PdfError('damaged', `object ${num} is not at ${offset}`);
    }
    COUNTS.parsed += 1;
    this.reading.add(num);
    try {
      const value = parseObject(lexer);
      if (!(value instanceof PdfDict)) return value;
      const back = lexer.pos;
      lexer.skipSpace();
      if (startsAt(this.bytes, lexer.pos, 'stream')) return this.streamAt(value, lexer.pos + 6);
      lexer.pos = back;
      return value;
    } finally {
      this.reading.delete(num);
    }
  }

  /**
   * A stream's data: from the line end after "stream" for /Length bytes, when "endstream" follows there; otherwise
   * up to the next "endstream" (§6.1 of the plan: a wrong or missing /Length is common).
   * @param {PdfDict} dict
   * @param {number} at  Just after the keyword "stream".
   */
  streamAt(dict, at) {
    const { bytes } = this;
    let start = at;
    if (bytes[start] === 0x0d) start += 1;
    if (bytes[start] === 0x0a) start += 1;
    let length = dict.get('Length');
    if (length instanceof PdfRef) length = this.reading.has(length.num) ? null : this.resolve(length);
    if (typeof length === 'number' && Number.isInteger(length) && length >= 0 && start + length <= bytes.length) {
      let end = start + length;
      while (end < bytes.length && isSpace(bytes[end]) && end < start + length + 4) end += 1;
      if (startsAt(bytes, end, 'endstream')) return new PdfStream(dict, bytes.subarray(start, start + length));
    }
    let end = find(bytes, 'endstream', start);
    if (end < 0) end = find(bytes, 'endobj', start);
    if (end < 0) throw new PdfError('damaged', `stream at ${at} has no end`);
    if (bytes[end - 1] === 0x0a) end -= 1;
    if (bytes[end - 1] === 0x0d) end -= 1;
    return new PdfStream(dict, bytes.subarray(start, Math.max(start, end)));
  }

  /** @param {number} num @param {{ stream: number, index: number }} entry */
  readPacked(num, entry) {
    const pack = this.packs.get(entry.stream);
    if (pack instanceof PdfError) throw pack;
    if (!pack) throw new PdfError('damaged', `object stream ${entry.stream} was not read`);
    /** @type {[number, number] | undefined} */
    let pair = pack.pairs[entry.index];
    if (pair?.[0] !== num) pair = pack.pairs.find(([n]) => n === num);
    if (!pair) throw new PdfError('damaged', `object ${num} is not in object stream ${entry.stream}`);
    COUNTS.parsed += 1;
    return parseObject(new Lexer(pack.data, pack.first + pair[1]));
  }

  /* ---------- Repair (plan §6.2) ---------- */

  /**
   * Rebuilds the entries by scanning for "n g obj" headers, in file order so a later copy of an object wins, and
   * skipping stream data so that bytes inside a stream are never taken for objects. The trailer is the last one
   * that names a catalog; failing that, the last catalog found.
   */
  async repair() {
    const { bytes } = this;
    this.repaired = true;
    this.entries = new Map();
    this.cache = new Map();
    this.packs = new Map();
    this.broken = new Set();
    /** Trailers and cross-reference stream dictionaries, with where they are. @type {[number, PdfDict][]} */
    const found = [];
    /** @type {number[]} */
    const packs = [];
    /** @type {[number, number][]} */
    const skipped = [];
    let pos = this.header;
    for (;;) {
      const at = find(bytes, 'obj', pos);
      if (at < 0) break;
      pos = at + 3;
      const start = objectStart(bytes, at);
      if (start < 0) continue;
      const num = headerAt(bytes, start);
      if (num < 0) continue;
      if (!this.entries.has(num) && this.entries.size >= LIMITS.objects) throw new PdfError('tooLarge', 'too many objects');
      this.entries.delete(num);
      this.entries.set(num, { type: 'plain', offset: start });
      try {
        this.cache.delete(num);
        const value = this.readAt(start, num);
        if (value instanceof PdfStream) {
          const end = value.data.byteOffset - bytes.byteOffset + value.data.length;
          skipped.push([at, end]);
          pos = Math.max(pos, end);
          if (isName(value.dict.get('Type'), 'XRef')) found.push([start, value.dict]);
          if (isName(value.dict.get('Type'), 'ObjStm')) packs.push(num);
        }
      } catch (error) {
        if (!(error instanceof PdfError)) throw error; // an unreadable or over-nested object is skipped
      }
    }
    this.cache = new Map();
    for (let at = find(bytes, 'trailer', this.header); at >= 0; at = find(bytes, 'trailer', at + 7)) {
      if (skipped.some(([from, to]) => at > from && at < to)) continue;
      try {
        const value = parseObject(new Lexer(bytes, at + 7));
        if (value instanceof PdfDict) found.push([at, value]);
      } catch (error) {
        if (!(error instanceof PdfError)) throw error;
      }
    }
    const trailers = found.sort(([a], [b]) => a - b).map(([, dict]) => dict);
    const encrypt = trailers.findLast((t) => t.has('Encrypt'));
    this.encrypted = Boolean(encrypt);
    // Objects in object streams, unless a plain copy exists.
    if (!this.encrypted) {
      for (const num of packs) {
        try {
          const pack = await this.readPack(num);
          this.packs.set(num, pack);
          pack.pairs.forEach(([n], index) => {
            if (!this.entries.has(n)) this.keepRepaired(n, { type: 'packed', stream: num, index });
          });
        } catch (error) {
          if (!(error instanceof PdfError) || error.code === 'tooLarge') throw error;
        }
      }
    }
    this.cache = new Map();
    const trailer = new PdfDict();
    const named = trailers.findLast((t) => this.isCatalog(t.get('Root')));
    if (named) {
      trailer.set('Root', /** @type {import('./pdf-syntax.mjs').PdfObject} */ (named.get('Root')));
    } else {
      const catalog = [...this.entries.keys()].findLast((num) => this.isCatalog(new PdfRef(num, 0)));
      if (catalog !== undefined) trailer.set('Root', new PdfRef(catalog, 0));
    }
    for (const key of ['Encrypt', 'ID', 'Info']) {
      const source = trailers.findLast((t) => t.has(key));
      if (source) trailer.set(key, /** @type {import('./pdf-syntax.mjs').PdfObject} */ (source.get(key)));
    }
    this.trailer = trailer;
  }

  /** @param {number} num @param {Entry} entry */
  keepRepaired(num, entry) {
    if (this.entries.size >= LIMITS.objects) throw new PdfError('tooLarge', 'too many objects');
    this.entries.set(num, entry);
  }

  /** @param {import('./pdf-syntax.mjs').PdfObject | undefined} value */
  isCatalog(value) {
    try {
      const dict = this.resolve(value);
      return dict instanceof PdfDict && isName(dict.get('Type'), 'Catalog') && this.resolve(dict.get('Pages')) instanceof PdfDict;
    } catch (error) {
      if (error instanceof PdfError) return false;
      throw error;
    }
  }

  /* ---------- Streams (§7.4) ---------- */

  /**
   * A stream's data with its filters undone: Flate (with predictors), LZW, ASCIIHex and ASCII85. Pictures
   * (DCT, JPX, JBIG2, CCITTFax) and RunLength are not decoded: `unsupported`; such streams are copied as they are.
   * @param {PdfStream} stream
   * @param {{ structural?: boolean, limit?: number }} [options]  structural: a cross-reference or object stream.
   * @returns {Promise<Uint8Array>}
   * @throws {PdfError}
   */
  async decode(stream, { structural = false, limit = LIMITS.stream } = {}) {
    if (structural) COUNTS.structural += 1;
    else COUNTS.decoded += 1;
    const filters = listOf(this.resolve(stream.dict.get('Filter'))).map((f) => this.resolve(f));
    const parms = listOf(this.resolve(stream.dict.get('DecodeParms') ?? stream.dict.get('DP'))).map((p) => this.resolve(p));
    if (this.encrypted && !structural && !(filters.length > 0 && isName(filters[0], 'Crypt'))) {
      throw new PdfError('locked', 'stream of an encrypted file');
    }
    let data = stream.data;
    for (let i = 0; i < filters.length; i += 1) {
      const filter = filters[i];
      const parm = parms[i] instanceof PdfDict ? /** @type {PdfDict} */ (parms[i]) : new PdfDict();
      if (!(filter instanceof PdfName)) throw new PdfError('damaged', 'filter is not a name');
      switch (filter.value) {
        case 'FlateDecode':
        case 'Fl':
          data = unpredict(await inflate(data, limit, this.meter), parm, this);
          break;
        case 'LZWDecode':
        case 'LZW': {
          const early = this.resolve(parm.get('EarlyChange'));
          data = unpredict(lzw(data, early === 0 ? 0 : 1, limit, this.meter), parm, this);
          break;
        }
        case 'ASCIIHexDecode':
        case 'AHx':
          data = asciiHex(data, this.meter);
          break;
        case 'ASCII85Decode':
        case 'A85':
          data = ascii85(data, this.meter);
          break;
        case 'Crypt': {
          const name = this.resolve(parm.get('Name'));
          if (name !== null && !isName(name, 'Identity')) throw new PdfError('locked', 'crypt filter');
          break;
        }
        default:
          throw new PdfError('unsupported', `filter ${filter.value}`);
      }
    }
    return data;
  }
}

/** @param {import('./pdf-syntax.mjs').PdfObject} value */
const listOf = (value) => (value === null ? [] : Array.isArray(value) ? value : [value]);

/* ---------- Byte search ---------- */

/**
 * First offset of an ASCII text from `from`, or -1.
 * @param {Uint8Array} bytes @param {string} text @param {number} from @param {number} [to]  Search stops here.
 */
export function find(bytes, text, from, to = bytes.length) {
  const first = text.charCodeAt(0);
  const last = Math.min(to, bytes.length) - text.length;
  for (let at = bytes.indexOf(first, from); at >= 0 && at <= last; at = bytes.indexOf(first, at + 1)) {
    if (startsAt(bytes, at, text)) return at;
  }
  return -1;
}

/** Last offset of an ASCII text at or after `from`, or -1. @param {Uint8Array} bytes @param {string} text @param {number} from */
function findLast(bytes, text, from) {
  const first = text.charCodeAt(0);
  for (let at = bytes.lastIndexOf(first, bytes.length - text.length); at >= from; at = bytes.lastIndexOf(first, at - 1)) {
    if (startsAt(bytes, at, text)) return at;
    if (at === 0) break;
  }
  return -1;
}

/** @param {Uint8Array} bytes @param {number} at @param {string} text */
function startsAt(bytes, at, text) {
  if (at < 0 || at + text.length > bytes.length) return false;
  for (let i = 0; i < text.length; i += 1) if (bytes[at + i] !== text.charCodeAt(i)) return false;
  return true;
}

/**
 * The object number of a header "n g obj" at an offset, or -1.
 * @param {Uint8Array} bytes @param {number} at
 */
function headerAt(bytes, at) {
  if (at < 0 || at >= bytes.length) return -1;
  let pos = at;
  /** @returns {number} */
  const integer = () => {
    const start = pos;
    let value = 0;
    while (pos < bytes.length && bytes[pos] >= 0x30 && bytes[pos] <= 0x39 && pos - start < 10) {
      value = value * 10 + bytes[pos] - 0x30;
      pos += 1;
    }
    return pos > start && !(bytes[pos] >= 0x30 && bytes[pos] <= 0x39) ? value : -1;
  };
  const spaces = () => {
    const start = pos;
    while (pos < bytes.length && isSpace(bytes[pos])) pos += 1;
    return pos > start;
  };
  const num = integer();
  if (num < 0 || !spaces() || integer() < 0 || !spaces() || !startsAt(bytes, pos, 'obj')) return -1;
  const after = bytes[pos + 3];
  return after === undefined || isSpace(after) || after === 0x3c || after === 0x5b || after === 0x2f || after === 0x28 || after === 0x25 ? num : -1;
}

/**
 * Where the header "n g obj" whose "obj" is at `at` starts, or -1.
 * @param {Uint8Array} bytes @param {number} at
 */
function objectStart(bytes, at) {
  let pos = at - 1;
  const back = (/** @type {(byte: number) => boolean} */ test) => {
    const end = pos;
    while (pos >= 0 && test(bytes[pos])) pos -= 1;
    return pos < end;
  };
  const digit = (/** @type {number} */ byte) => byte >= 0x30 && byte <= 0x39;
  if (!back(isSpace) || !back(digit) || !back(isSpace) || !back(digit)) return -1;
  return pos < 0 || !isRegular(bytes[pos]) ? pos + 1 : -1;
}

/* ---------- Filters ---------- */

/**
 * @param {Meter} jobMeter @param {number} n  Bytes about to be produced.
 */
function charge(jobMeter, n) {
  jobMeter.used += n;
  if (jobMeter.used > jobMeter.limit) throw new PdfError('tooLarge', 'more data than one job may decode');
}

/**
 * Flate (zlib, RFC 1950), stopping past a limit. A stream cut short or with a bad checksum keeps what was
 * inflated, as other readers do; a stream without the zlib header is tried as raw deflate.
 * @param {Uint8Array} data @param {number} limit @param {Meter} jobMeter
 * @param {'deflate' | 'deflate-raw'} [format]
 * @returns {Promise<Uint8Array>}
 */
export async function inflate(data, limit, jobMeter, format = 'deflate') {
  if (data.length === 0) return new Uint8Array(0);
  /** @type {Uint8Array[]} */
  const chunks = [];
  let total = 0;
  let failed = false;
  const reader = new Blob([/** @type {Uint8Array<ArrayBuffer>} */ (data)]).stream().pipeThrough(new DecompressionStream(format)).getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > limit) {
        await reader.cancel().catch(() => {});
        throw new PdfError('tooLarge', 'a stream inflates past the limit');
      }
      charge(jobMeter, value.length);
      chunks.push(value);
    }
  } catch (error) {
    if (error instanceof PdfError) throw error;
    failed = true;
  }
  if (failed && total === 0) {
    if (format === 'deflate') return inflate(data, limit, jobMeter, 'deflate-raw');
    throw new PdfError('damaged', 'Flate data cannot be inflated');
  }
  return concat(chunks);
}

/** A growable byte buffer for the filters that produce data byte by byte. */
class Output {
  /** @param {number} limit @param {Meter} jobMeter */
  constructor(limit, jobMeter) {
    this.bytes = new Uint8Array(1024);
    this.length = 0;
    this.limit = limit;
    this.meter = jobMeter;
  }

  /** @param {number} byte */
  push(byte) {
    if (this.length === this.bytes.length) this.grow();
    this.bytes[this.length] = byte;
    this.length += 1;
  }

  grow() {
    if (this.bytes.length >= this.limit) throw new PdfError('tooLarge', 'a stream decodes past the limit');
    const next = new Uint8Array(Math.min(this.limit, this.bytes.length * 2));
    charge(this.meter, next.length - this.bytes.length);
    next.set(this.bytes);
    this.bytes = next;
  }

  result() {
    return this.bytes.subarray(0, this.length);
  }
}

/**
 * LZW (§7.4.4.2): 9- to 12-bit codes, 256 clears the table, 257 ends; widths grow one code early when
 * EarlyChange is 1 (the default). A code that cannot occur ends the data, as in other readers.
 * @param {Uint8Array} data @param {0 | 1} early @param {number} limit @param {Meter} jobMeter
 */
export function lzw(data, early, limit, jobMeter) {
  const prefix = new Int16Array(4096);
  const suffix = new Uint8Array(4096);
  const length = new Uint16Array(4096);
  for (let i = 0; i < 256; i += 1) {
    prefix[i] = -1;
    suffix[i] = i;
    length[i] = 1;
  }
  const out = new Output(limit, jobMeter);
  const sequence = new Uint8Array(4096);
  /** Writes the sequence of a code; returns its first byte. @param {number} code */
  const emit = (code) => {
    const n = length[code];
    for (let i = n - 1, c = code; i >= 0; i -= 1, c = prefix[c]) sequence[i] = suffix[c];
    for (let i = 0; i < n; i += 1) out.push(sequence[i]);
    return sequence[0];
  };
  let next = 258;
  let width = 9;
  let prev = -1;
  let buffer = 0;
  let bits = 0;
  let pos = 0;
  for (;;) {
    while (bits < width && pos < data.length) {
      buffer = ((buffer << 8) | data[pos]) & 0xffffff;
      bits += 8;
      pos += 1;
    }
    if (bits < width) break;
    const code = (buffer >>> (bits - width)) & ((1 << width) - 1);
    bits -= width;
    if (code === 256) {
      next = 258;
      width = 9;
      prev = -1;
      continue;
    }
    if (code === 257) break;
    if (prev < 0) {
      if (code > 255) break;
      emit(code);
      prev = code;
      continue;
    }
    let first;
    if (code < next) {
      first = emit(code);
    } else if (code === next) {
      first = emit(prev);
      out.push(first);
    } else {
      break;
    }
    if (next < 4096) {
      prefix[next] = prev;
      suffix[next] = first;
      length[next] = length[prev] + 1;
      next += 1;
      if (next + early >= 1 << width && width < 12) width += 1;
    }
    prev = code;
  }
  return out.result();
}

/** @param {number} byte  0–15, or -1. */
function hexDigit(byte) {
  if (byte >= 0x30 && byte <= 0x39) return byte - 0x30;
  if (byte >= 0x41 && byte <= 0x46) return byte - 0x37;
  if (byte >= 0x61 && byte <= 0x66) return byte - 0x57;
  return -1;
}

/**
 * ASCIIHex (§7.4.2): white space ignored, ">" ends, an odd last digit is followed by 0, anything else is an error.
 * @param {Uint8Array} data @param {Meter} jobMeter
 */
export function asciiHex(data, jobMeter) {
  const out = new Uint8Array(Math.ceil(data.length / 2));
  let n = 0;
  let high = -1;
  for (const byte of data) {
    if (byte === 0x3e) break;
    if (isSpace(byte)) continue;
    const value = hexDigit(byte);
    if (value < 0) throw new PdfError('damaged', 'not hexadecimal');
    if (high < 0) {
      high = value;
    } else {
      out[n] = high * 16 + value;
      n += 1;
      high = -1;
    }
  }
  if (high >= 0) {
    out[n] = high * 16;
    n += 1;
  }
  charge(jobMeter, n);
  return out.subarray(0, n);
}

/**
 * ASCII85 (§7.4.3): "!" to "u" in groups of five, "z" for four zero bytes, "~>" ends; a last group of n + 1
 * characters gives n bytes. A group above 2^32 − 1, a "z" inside a group and a last group of one character are
 * errors. A missing "~>" ends at the end of the data.
 * @param {Uint8Array} data @param {Meter} jobMeter
 */
export function ascii85(data, jobMeter) {
  const out = new Output(LIMITS.stream, jobMeter);
  const group = [];
  let i = 0;
  if (data[0] === 0x3c && data[1] === 0x7e) i = 2; // "<~", written by some PostScript tools
  /** @param {number[]} digits */
  const write = (digits) => {
    const count = digits.length;
    while (digits.length < 5) digits.push(84);
    let value = 0;
    for (const digit of digits) value = value * 85 + digit;
    if (value > 0xffffffff) throw new PdfError('damaged', 'ASCII85 group too large');
    for (let k = 0; k < count - 1; k += 1) out.push((value >>> (24 - 8 * k)) & 0xff);
  };
  for (; i < data.length; i += 1) {
    const byte = data[i];
    if (byte === 0x7e) break;
    if (isSpace(byte)) continue;
    if (byte === 0x7a) {
      if (group.length > 0) throw new PdfError('damaged', 'ASCII85 "z" inside a group');
      for (let k = 0; k < 4; k += 1) out.push(0);
      continue;
    }
    if (byte < 0x21 || byte > 0x75) throw new PdfError('damaged', 'not ASCII85');
    group.push(byte - 0x21);
    if (group.length === 5) write(group.splice(0));
  }
  if (group.length === 1) throw new PdfError('damaged', 'ASCII85 last group of one character');
  if (group.length > 1) write(group);
  return out.result();
}

/**
 * Undoes a predictor (§7.4.4.4, Tables 8–10): TIFF predictor 2, or PNG predictors with a tag per row. Samples
 * outside the picture count as 0.
 * @param {Uint8Array} data @param {PdfDict} parm @param {PdfFile} file
 */
export function unpredict(data, parm, file) {
  /** @param {string} key @param {number} fallback */
  const integer = (key, fallback) => {
    const value = file.resolve(parm.get(key));
    return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : fallback;
  };
  const predictor = integer('Predictor', 1);
  if (predictor < 2) return data;
  const colors = Math.min(integer('Colors', 1), 32);
  const bpc = integer('BitsPerComponent', 8);
  if (![1, 2, 4, 8, 16].includes(bpc)) throw new PdfError('damaged', `predictor with ${bpc} bits per component`);
  const columns = integer('Columns', 1);
  const pixelBytes = Math.max(1, Math.ceil((colors * bpc) / 8));
  const rowBytes = Math.ceil((colors * bpc * columns) / 8);
  if (rowBytes === 0 || rowBytes > LIMITS.stream) throw new PdfError('damaged', 'predictor row too long');
  if (predictor === 2) return tiff(data, rowBytes, colors, bpc);
  const rows = Math.ceil(data.length / (rowBytes + 1));
  const out = new Uint8Array(rows * rowBytes);
  let length = 0;
  for (let row = 0; row < rows; row += 1) {
    const from = row * (rowBytes + 1);
    const tag = data[from];
    const at = row * rowBytes;
    const available = Math.min(rowBytes, data.length - from - 1);
    for (let i = 0; i < available; i += 1) {
      const raw = data[from + 1 + i];
      const left = i >= pixelBytes ? out[at + i - pixelBytes] : 0;
      const up = row > 0 ? out[at - rowBytes + i] : 0;
      const corner = row > 0 && i >= pixelBytes ? out[at - rowBytes + i - pixelBytes] : 0;
      let value = raw;
      if (tag === 1) value = raw + left;
      else if (tag === 2) value = raw + up;
      else if (tag === 3) value = raw + ((left + up) >> 1);
      else if (tag === 4) {
        const p = left + up - corner;
        const pa = Math.abs(p - left);
        const pb = Math.abs(p - up);
        const pc = Math.abs(p - corner);
        value = raw + (pa <= pb && pa <= pc ? left : pb <= pc ? up : corner);
      }
      out[at + i] = value & 0xff;
    }
    length = at + Math.max(0, available);
  }
  return out.subarray(0, length);
}

/**
 * TIFF predictor 2: each component is the difference from the same component of the sample to its left.
 * @param {Uint8Array} data @param {number} rowBytes @param {number} colors @param {number} bpc
 */
function tiff(data, rowBytes, colors, bpc) {
  const out = Uint8Array.from(data);
  for (let row = 0; row * rowBytes < out.length; row += 1) {
    const at = row * rowBytes;
    const end = Math.min(at + rowBytes, out.length);
    if (bpc === 8) {
      for (let i = at + colors; i < end; i += 1) out[i] = (out[i] + out[i - colors]) & 0xff;
    } else if (bpc === 16) {
      for (let i = at + 2 * colors; i + 1 < end; i += 2) {
        const value = ((out[i] << 8) | out[i + 1]) + ((out[i - 2 * colors] << 8) | out[i - 2 * colors + 1]);
        out[i] = (value >> 8) & 0xff;
        out[i + 1] = value & 0xff;
      }
    } else {
      const mask = (1 << bpc) - 1;
      const samples = Math.floor(((end - at) * 8) / bpc);
      const read = (/** @type {number} */ k) => (out[at + ((k * bpc) >> 3)] >> (8 - bpc - ((k * bpc) & 7))) & mask;
      const write = (/** @type {number} */ k, /** @type {number} */ value) => {
        const shift = 8 - bpc - ((k * bpc) & 7);
        const index = at + ((k * bpc) >> 3);
        out[index] = (out[index] & ~(mask << shift)) | ((value & mask) << shift);
      };
      for (let k = colors; k < samples; k += 1) write(k, read(k) + read(k - colors));
    }
  }
  return out;
}

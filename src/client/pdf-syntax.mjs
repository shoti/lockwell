// @ts-check
/**
 * @file PDF objects from bytes and back: the lexical rules and object types of ISO 32000-1 §7.2–7.3 (quoted in
 * docs/research/tool-pdf-toolkit.md §14). Used by the PDF tools' reader and writer; pure, no DOM. Not the
 * pattern scanner in pdf.mjs, which the document tool and the attachment checker use on hostile byte soup.
 */

/**
 * Why a PDF could not be read or written. `unsupported`: not a PDF, or a feature this tool does not read.
 * `damaged`: the structure is broken beyond repair. `tooLarge`: over one of the limits. `locked`: encrypted.
 * `wrongPassword`: the password does not open it. `cancelled`: the visitor stopped it.
 * @typedef {'unsupported' | 'damaged' | 'tooLarge' | 'locked' | 'wrongPassword' | 'cancelled'} PdfErrorCode
 */
export class PdfError extends Error {
  /** @param {PdfErrorCode} code @param {string} [detail]  For developers; never shown. */
  constructor(code, detail = '') {
    super(detail ? `${code}: ${detail}` : code);
    this.name = 'PdfError';
    /** @type {PdfErrorCode} */
    this.code = code;
  }
}

/** A name object; `value` holds its bytes as one character per byte, with #xx escapes decoded. */
export class PdfName {
  /** @param {string} value */
  constructor(value) {
    this.value = value;
  }
}

/** A string object; `hex` remembers how it was written, so a copy looks the same. */
export class PdfString {
  /** @param {Uint8Array} bytes @param {boolean} [hex] */
  constructor(bytes, hex = false) {
    this.bytes = bytes;
    this.hex = hex;
  }
}

/** A reference to an indirect object ("12 0 R"). */
export class PdfRef {
  /** @param {number} num @param {number} gen */
  constructor(num, gen) {
    this.num = num;
    this.gen = gen;
  }
}

/** A dictionary: keys are name values, in the order they were read or set. */
export class PdfDict {
  /** @param {Iterable<[string, PdfObject]>} [entries] */
  constructor(entries) {
    /** @type {Map<string, PdfObject>} */
    this.map = new Map(entries);
  }

  /** @param {string} key @returns {PdfObject | undefined} */
  get(key) {
    return this.map.get(key);
  }

  /** @param {string} key @param {PdfObject} value */
  set(key, value) {
    this.map.set(key, value);
    return this;
  }

  /** @param {string} key */
  has(key) {
    return this.map.has(key);
  }

  /** @param {string} key */
  delete(key) {
    return this.map.delete(key);
  }

  keys() {
    return this.map.keys();
  }

  entries() {
    return this.map.entries();
  }

  get size() {
    return this.map.size;
  }
}

/** A stream: its dictionary and its data exactly as stored in the file (still encoded by its filters). */
export class PdfStream {
  /** @param {PdfDict} dict @param {Uint8Array} data */
  constructor(dict, data) {
    this.dict = dict;
    this.data = data;
  }
}

/** @typedef {null | boolean | number | PdfName | PdfString | PdfRef | PdfDict | PdfStream | PdfObject[]} PdfObject */

/** Nesting of arrays and dictionaries accepted inside one object (plan §6.3). */
export const MAX_DEPTH = 100;

/* ---------- Characters (§7.2.2) ---------- */

/** 1: white space (Table 1), 2: delimiter (Table 2), 0: regular. */
const CLASS = new Uint8Array(256);
for (const code of [0x00, 0x09, 0x0a, 0x0c, 0x0d, 0x20]) CLASS[code] = 1;
for (const char of '()<>[]{}/%') CLASS[char.charCodeAt(0)] = 2;

/** @param {number} byte */
export const isSpace = (byte) => CLASS[byte] === 1;
/** @param {number} byte */
export const isRegular = (byte) => CLASS[byte] === 0;

/** @param {number} byte  -1 when not a hex digit. */
function hexValue(byte) {
  if (byte >= 0x30 && byte <= 0x39) return byte - 0x30;
  if (byte >= 0x41 && byte <= 0x46) return byte - 0x37;
  if (byte >= 0x61 && byte <= 0x66) return byte - 0x57;
  return -1;
}

const NUMBER = /^[+-]?(?:\d+\.?\d*|\.\d+)$/;

/* ---------- Tokens ---------- */

/**
 * @typedef {{ type: 'number', value: number, integer: boolean, start: number }
 *   | { type: 'name', value: string, start: number }
 *   | { type: 'string', value: PdfString, start: number }
 *   | { type: 'keyword', value: string, start: number }
 *   | { type: 'open', value: '[' | '<<' | '{', start: number }
 *   | { type: 'close', value: ']' | '>>' | '}', start: number }
 *   | { type: 'eof', value: '', start: number }} Token
 */

/** Reads tokens from bytes, from a position, skipping white space and comments (§7.2.3). */
export class Lexer {
  /** @param {Uint8Array} bytes @param {number} [pos] */
  constructor(bytes, pos = 0) {
    this.bytes = bytes;
    this.pos = pos;
  }

  skipSpace() {
    const { bytes } = this;
    while (this.pos < bytes.length) {
      const byte = bytes[this.pos];
      if (byte === 0x25) {
        while (this.pos < bytes.length && bytes[this.pos] !== 0x0a && bytes[this.pos] !== 0x0d) this.pos += 1;
      } else if (CLASS[byte] === 1) {
        this.pos += 1;
      } else {
        return;
      }
    }
  }

  /** @returns {Token} */
  next() {
    this.skipSpace();
    const { bytes } = this;
    const start = this.pos;
    if (start >= bytes.length) return { type: 'eof', value: '', start };
    const byte = bytes[start];
    switch (byte) {
      case 0x28: // (
        return { type: 'string', value: this.literal(), start };
      case 0x3c: // <
        if (bytes[start + 1] === 0x3c) {
          this.pos += 2;
          return { type: 'open', value: '<<', start };
        }
        return { type: 'string', value: this.hex(), start };
      case 0x3e: // >
        if (bytes[start + 1] === 0x3e) {
          this.pos += 2;
          return { type: 'close', value: '>>', start };
        }
        this.pos += 1;
        throw new PdfError('damaged', `stray ">" at ${start}`);
      case 0x5b:
        this.pos += 1;
        return { type: 'open', value: '[', start };
      case 0x5d:
        this.pos += 1;
        return { type: 'close', value: ']', start };
      case 0x7b:
        this.pos += 1;
        return { type: 'open', value: '{', start };
      case 0x7d:
        this.pos += 1;
        return { type: 'close', value: '}', start };
      case 0x29:
        this.pos += 1;
        throw new PdfError('damaged', `stray ")" at ${start}`);
      case 0x2f:
        return { type: 'name', value: this.name(), start };
      default: {
        let end = start;
        while (end < bytes.length && CLASS[bytes[end]] === 0) end += 1;
        this.pos = end;
        const text = String.fromCharCode(...bytes.subarray(start, Math.min(end, start + 64)));
        if (end - start <= 64 && NUMBER.test(text)) {
          return { type: 'number', value: Number(text), integer: !text.includes('.'), start };
        }
        return { type: 'keyword', value: end - start <= 64 ? text : `${text}…`, start };
      }
    }
  }

  /** A name after its "/" (§7.3.5): regular characters, #xx decoded; a "#" not followed by two hex digits stays. */
  name() {
    const { bytes } = this;
    this.pos += 1;
    let value = '';
    while (this.pos < bytes.length && CLASS[bytes[this.pos]] === 0) {
      const byte = bytes[this.pos];
      if (byte === 0x23) {
        const high = hexValue(bytes[this.pos + 1] ?? -1);
        const low = hexValue(bytes[this.pos + 2] ?? -1);
        if (high >= 0 && low >= 0) {
          value += String.fromCharCode(high * 16 + low);
          this.pos += 3;
          continue;
        }
      }
      value += String.fromCharCode(byte);
      this.pos += 1;
    }
    return value;
  }

  /** A literal string (§7.3.4.2): nested parentheses, the escapes of Table 3, line ends read as LF. */
  literal() {
    const { bytes } = this;
    const start = this.pos;
    this.pos += 1;
    const out = [];
    let depth = 1;
    while (this.pos < bytes.length) {
      let byte = bytes[this.pos];
      this.pos += 1;
      if (byte === 0x28) {
        depth += 1;
      } else if (byte === 0x29) {
        depth -= 1;
        if (depth === 0) return new PdfString(Uint8Array.from(out));
      } else if (byte === 0x0d) {
        if (bytes[this.pos] === 0x0a) this.pos += 1;
        byte = 0x0a;
      } else if (byte === 0x5c) {
        const escaped = bytes[this.pos];
        this.pos += 1;
        switch (escaped) {
          case 0x6e: byte = 0x0a; break; // \n
          case 0x72: byte = 0x0d; break; // \r
          case 0x74: byte = 0x09; break; // \t
          case 0x62: byte = 0x08; break; // \b
          case 0x66: byte = 0x0c; break; // \f
          case 0x0d: // backslash and a line end: both disregarded
            if (bytes[this.pos] === 0x0a) this.pos += 1;
            continue;
          case 0x0a:
            continue;
          default:
            if (escaped >= 0x30 && escaped <= 0x37) {
              let code = escaped - 0x30;
              for (let i = 0; i < 2 && bytes[this.pos] >= 0x30 && bytes[this.pos] <= 0x37; i += 1) {
                code = code * 8 + bytes[this.pos] - 0x30;
                this.pos += 1;
              }
              byte = code & 0xff; // "high-order overflow shall be ignored"
            } else if (escaped === undefined) {
              continue;
            } else {
              byte = escaped; // \( \) \\ and any other: the backslash is ignored
            }
        }
      }
      out.push(byte);
    }
    throw new PdfError('damaged', `string at ${start} is not closed`);
  }

  /** A hex string (§7.3.4.3): white space ignored, a missing last digit is 0. Other characters are skipped. */
  hex() {
    const { bytes } = this;
    const start = this.pos;
    this.pos += 1;
    const out = [];
    let high = -1;
    while (this.pos < bytes.length) {
      const byte = bytes[this.pos];
      this.pos += 1;
      if (byte === 0x3e) {
        if (high >= 0) out.push(high * 16);
        return new PdfString(Uint8Array.from(out), true);
      }
      const value = hexValue(byte);
      if (value < 0) continue;
      if (high < 0) {
        high = value;
      } else {
        out.push(high * 16 + value);
        high = -1;
      }
    }
    throw new PdfError('damaged', `hex string at ${start} is not closed`);
  }
}

/* ---------- Objects ---------- */

/**
 * The object that starts at the lexer's position: a direct object, or a reference "n g R". Streams are not read
 * here: they need the file (their length may be another object), so the caller looks for "stream" after a
 * dictionary. Keywords other than true, false and null are an error.
 * @param {Lexer} lexer
 * @param {number} [depth]
 * @returns {PdfObject}
 */
export function parseObject(lexer, depth = 0) {
  return objectFrom(lexer, lexer.next(), depth);
}

/**
 * @param {Lexer} lexer
 * @param {Token} token
 * @param {number} depth
 * @returns {PdfObject}
 */
function objectFrom(lexer, token, depth) {
  switch (token.type) {
    case 'number':
      return token.integer && token.value >= 0 ? referenceOr(lexer, token.value) : token.value;
    case 'name':
      return new PdfName(token.value);
    case 'string':
      return token.value;
    case 'open':
      if (depth >= MAX_DEPTH) throw new PdfError('tooLarge', `nesting deeper than ${MAX_DEPTH} at ${token.start}`);
      if (token.value === '[') return arrayFrom(lexer, depth + 1);
      if (token.value === '<<') return dictFrom(lexer, depth + 1);
      throw new PdfError('damaged', `"{" outside a function at ${token.start}`);
    case 'keyword':
      if (token.value === 'true') return true;
      if (token.value === 'false') return false;
      if (token.value === 'null') return null;
      throw new PdfError('damaged', `unexpected "${token.value}" at ${token.start}`);
    case 'close':
      throw new PdfError('damaged', `unexpected "${token.value}" at ${token.start}`);
    default:
      throw new PdfError('damaged', 'the file ends inside an object');
  }
}

/**
 * After a non-negative integer: "n g R" is a reference; otherwise the integer, and the lexer is put back.
 * @param {Lexer} lexer
 * @param {number} num
 */
function referenceOr(lexer, num) {
  const back = lexer.pos;
  try {
    const gen = lexer.next();
    if (gen.type === 'number' && gen.integer && gen.value >= 0) {
      const r = lexer.next();
      if (r.type === 'keyword' && r.value === 'R') return new PdfRef(num, gen.value);
    }
  } catch (error) {
    if (!(error instanceof PdfError)) throw error;
  }
  lexer.pos = back;
  return num;
}

/** Keywords that end an object: met inside an array or dictionary, the object was never closed. */
const STRUCTURE = new Set(['obj', 'endobj', 'stream', 'endstream', 'xref', 'trailer', 'startxref']);

/**
 * True for a token that other readers skip inside an array or dictionary (PDF.js keeps it as a command, qpdf
 * reads it as a string): an unknown keyword. A keyword of the file structure means the object is broken.
 * @param {Token} token
 */
function skipped(token) {
  if (token.type !== 'keyword' || token.value === 'true' || token.value === 'false' || token.value === 'null') return false;
  if (STRUCTURE.has(token.value)) throw new PdfError('damaged', `"${token.value}" inside an object at ${token.start}`);
  return true;
}

/** @param {Lexer} lexer @param {number} depth */
function arrayFrom(lexer, depth) {
  /** @type {PdfObject[]} */
  const items = [];
  for (;;) {
    const token = lexer.next();
    if (token.type === 'close' && token.value === ']') return items;
    if (token.type === 'eof') throw new PdfError('damaged', 'the file ends inside an array');
    if (!skipped(token)) items.push(objectFrom(lexer, token, depth));
  }
}

/**
 * A dictionary after "<<". As in PDF.js, a token where a key should be that is not a name is skipped, and so is a
 * key whose value is an unknown keyword. A key without a value before ">>" is dropped; a repeated key keeps the
 * last value.
 * @param {Lexer} lexer
 * @param {number} depth
 */
function dictFrom(lexer, depth) {
  const dict = new PdfDict();
  for (;;) {
    const token = lexer.next();
    if (token.type === 'close' && token.value === '>>') return dict;
    if (token.type === 'eof') throw new PdfError('damaged', 'the file ends inside a dictionary');
    if (token.type !== 'name') {
      if (!skipped(token)) objectFrom(lexer, token, depth);
      continue;
    }
    const value = lexer.next();
    if (value.type === 'close' && value.value === '>>') return dict;
    if (value.type === 'eof') throw new PdfError('damaged', 'the file ends inside a dictionary');
    if (!skipped(value)) dict.set(token.value, objectFrom(lexer, value, depth));
  }
}

/* ---------- Helpers for readers ---------- */

/** @param {PdfObject | undefined} value @param {string} [name] */
export const isName = (value, name) => value instanceof PdfName && (name === undefined || value.value === name);

/** The bytes of a string object as text of one character per byte. @param {PdfString} string */
export const stringBytes = (string) => String.fromCharCode(...string.bytes);

/* ---------- Writing (§7.3) ---------- */

/**
 * A number as PDF writes it: no exponent, no radix (§7.3.3 NOTE 1), and the shortest form that reads back as the
 * same value.
 * @param {number} n
 */
export function formatNumber(n) {
  if (!Number.isFinite(n)) throw new PdfError('damaged', `number ${n} cannot be written`);
  if (Object.is(n, -0)) return '0';
  const text = String(n);
  if (!text.includes('e')) return text;
  if (Math.abs(n) >= 1) return BigInt(Math.round(n)).toString();
  const fixed = n.toFixed(20).replace(/0+$/, '');
  return fixed.endsWith('.') ? fixed.slice(0, -1) : fixed;
}

/** Regular characters written as themselves in a name; everything else as #xx (§7.3.5 a–c). */
function writeName(/** @type {string} */ value) {
  let out = '/';
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    out += code > 0x20 && code < 0x7f && CLASS[code] === 0 && code !== 0x23 ? value[i] : `#${code.toString(16).padStart(2, '0')}`;
  }
  return out;
}

/**
 * A string written back: hex as it came, or literal with ( ) \ escaped and control bytes as octal; bytes from
 * 0x80 stay as they are (§7.3.4.2). CR must be escaped: written raw it would read back as LF.
 * @param {PdfString} string
 */
function writeString(string) {
  const { bytes } = string;
  if (string.hex) {
    let out = '<';
    for (const byte of bytes) out += byte.toString(16).padStart(2, '0');
    return `${out}>`;
  }
  let out = '(';
  for (const byte of bytes) {
    if (byte === 0x28 || byte === 0x29 || byte === 0x5c) out += `\\${String.fromCharCode(byte)}`;
    else if (byte < 0x20 || byte === 0x7f) out += `\\${byte.toString(8).padStart(3, '0')}`;
    else out += String.fromCharCode(byte);
  }
  return `${out})`;
}

/**
 * An object as PDF text, one character per byte. Streams are written by the file writer, which owns their data.
 * @param {PdfObject} value
 * @param {number} [depth]
 * @returns {string}
 */
export function serialise(value, depth = 0) {
  if (depth > MAX_DEPTH) throw new PdfError('tooLarge', 'nesting too deep to write');
  if (value === null) return 'null';
  if (value === true) return 'true';
  if (value === false) return 'false';
  if (typeof value === 'number') return formatNumber(value);
  if (value instanceof PdfName) return writeName(value.value);
  if (value instanceof PdfString) return writeString(value);
  if (value instanceof PdfRef) return `${value.num} ${value.gen} R`;
  if (Array.isArray(value)) return `[${value.map((item) => serialise(item, depth + 1)).join(' ')}]`;
  if (value instanceof PdfDict) {
    let out = '<<';
    for (const [key, item] of value.entries()) {
      const text = serialise(item, depth + 1);
      out += `${writeName(key)}${/^[/[(<]/.test(text) ? '' : ' '}${text}`;
    }
    return `${out}>>`;
  }
  throw new PdfError('damaged', 'a stream cannot be written inside another object');
}

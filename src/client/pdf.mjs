// @ts-check
/**
 * @file Reading PDF objects: strings, names, streams and the objects packed in object streams. Shared by the document
 * tool and the attachment checker.
 */
import { ascii, byteString } from './bytes.mjs';

/**
 * The PDF string that starts at `at`: "(…)" with nested parentheses and escapes, or "<hex>".
 * @param {string} text
 * @param {number} at
 * @returns {string}  The token, or "" when no string starts there.
 */
export function stringToken(text, at) {
  if (text[at] === '<' && text[at + 1] !== '<') {
    const end = text.indexOf('>', at);
    return end === -1 ? '' : text.slice(at, end + 1);
  }
  if (text[at] !== '(') return '';
  let depth = 0;
  for (let i = at; i < text.length; i += 1) {
    if (text[i] === '\\') i += 1;
    else if (text[i] === '(') depth += 1;
    else if (text[i] === ')') {
      depth -= 1;
      if (depth === 0) return text.slice(at, i + 1);
    }
  }
  return '';
}

/**
 * The text of a PDF string object: "(…)" with escapes, or "<hex>". A string may start with a byte order mark:
 * FE FF (UTF-16BE, the usual one), FF FE (UTF-16LE) or EF BB BF (UTF-8, PDF 2.0).
 * @param {string} token
 */
export function pdfString(token) {
  let raw = '';
  if (token.startsWith('<')) {
    const hex = token.slice(1, -1).replace(/\s/g, '');
    for (let i = 0; i + 1 < hex.length; i += 2) raw += String.fromCharCode(Number.parseInt(hex.slice(i, i + 2), 16));
  } else {
    const escapes = { n: '\n', r: '\r', t: '\t', b: '\b', f: '\f' };
    raw = token
      .slice(1, -1)
      .replace(/\\(\r\n|\r|\n)/g, '')
      .replace(/\\([0-7]{1,3})|\\(.)/g, (_, octal, char) =>
        octal ? String.fromCharCode(Number.parseInt(octal, 8) & 0xff) : (escapes[/** @type {keyof typeof escapes} */ (char)] ?? char),
      );
  }
  /** @param {number} from @param {boolean} big */
  const utf16 = (from, big) => {
    let text = '';
    for (let i = from; i + 1 < raw.length; i += 2) text += String.fromCharCode(big ? (raw.charCodeAt(i) << 8) | raw.charCodeAt(i + 1) : raw.charCodeAt(i) | (raw.charCodeAt(i + 1) << 8));
    return text;
  };
  if (raw.startsWith('\xfe\xff')) return utf16(2, true).trim();
  if (raw.startsWith('\xff\xfe')) return utf16(2, false).trim();
  if (raw.startsWith('\xef\xbb\xbf')) return new TextDecoder().decode(ascii(raw.slice(3))).trim();
  return raw.trim();
}

/** A decoded stream larger than this is not read: a few kilobytes of Flate data can inflate to gigabytes. */
const MAX_STREAM_BYTES = 64 * 1024 * 1024;

/** Bytes inflated from all the object streams of one file together, before the rest are reported unread. */
const MAX_PACKED_BYTES = 256 * 1024 * 1024;

/**
 * Counts the bytes inflated, including those of streams that grew past their limit and were dropped, so a caller can
 * stop a file that makes it inflate the same bomb again and again.
 * @typedef {{ inflated: number }} Meter
 */

/**
 * The part of an object before its stream data: the dictionary, where names such as /JS mean something. Stream data
 * (pictures, fonts, thumbnails) can hold "/JS" or "/AA" by chance.
 * @param {string} body
 */
export function dictionaryPart(body) {
  const at = body.search(/(?:^|[^A-Za-z])stream\r?\n/);
  return at === -1 ? body : body.slice(0, at + 1);
}

/**
 * Inflates a Flate-compressed (zlib) stream, up to maxBytes.
 * @param {Uint8Array} data
 * @param {number} maxBytes
 * @param {Meter} [meter]
 * @returns {Promise<Uint8Array | null>}  null when the browser can't, the data is damaged, or it grows past maxBytes.
 */
async function inflate(data, maxBytes, meter) {
  if (typeof DecompressionStream !== 'function') return null;
  /** @type {Uint8Array[]} */
  const chunks = [];
  let total = 0;
  try {
    const reader = new Blob([/** @type {Uint8Array<ArrayBuffer>} */ (data)]).stream().pipeThrough(new DecompressionStream('deflate')).getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.length;
      if (meter) meter.inflated += value.length;
      if (total > maxBytes) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
  } catch {
    return null;
  }
  const out = new Uint8Array(total);
  chunks.reduce((offset, chunk) => (out.set(chunk, offset), offset + chunk.length), 0);
  return out;
}

/**
 * The data of a stream object, decoded when it is Flate-compressed.
 * @param {Uint8Array} bytes  The whole file.
 * @param {number} at  Where the object's body starts.
 * @param {string} body  The object's text (one character per byte).
 * @param {Map<number, string>} [objects]  For a length given as a reference to another object.
 * @param {number} [maxBytes]  Largest decoded size read.
 * @param {Meter} [meter]  Counts the bytes inflated, whether or not the stream fits.
 * @returns {Promise<string | null>}  null when it can't be decoded or is larger than maxBytes.
 */
export async function streamData(bytes, at, body, objects, maxBytes = MAX_STREAM_BYTES, meter = undefined) {
  const start = /stream\r?\n/.exec(body);
  if (!start) return null;
  const from = at + start.index + start[0].length;
  const dictionary = body.slice(0, start.index);
  const direct = /\/Length\s+(\d+)(?!\s+\d+\s+R)/.exec(dictionary)?.[1];
  const reference = /\/Length\s+(\d+)\s+\d+\s+R/.exec(dictionary)?.[1];
  const length = Number(direct ?? (reference ? objects?.get(Number(reference))?.trim() : undefined) ?? Number.NaN);
  // Without a length, the data runs to "endstream", less the line break before it.
  const end = Number.isFinite(length) ? from + length : at + body.lastIndexOf('endstream') - (/\r?\n$/.exec(body.slice(0, body.lastIndexOf('endstream')))?.[0].length ?? 0);
  const raw = bytes.subarray(from, Math.max(from, end));
  const filter = /\/Filter\s*\[?\s*\/(\w+)/.exec(dictionary)?.[1];
  if (!filter) return raw.length > maxBytes ? null : byteString(raw);
  if (filter !== 'FlateDecode') return null;
  const inflated = await inflate(raw, maxBytes, meter);
  return inflated ? byteString(inflated) : null;
}

/**
 * Every object of a PDF, by number: the plain ones and those packed in
 * compressed object streams. When a number appears more than once (the file
 * was saved again with changes appended), the later one counts in `objects`;
 * `versions` keeps every occurrence, because a reader follows the
 * cross-reference table, not the order in the file, and a copy written into a
 * stream's data could otherwise hide the real object from a check.
 * One pass over the text: each body ends at the next "endobj" or the next
 * object header, whichever comes first, so unfinished objects can't make the
 * scan quadratic.
 * @param {Uint8Array} bytes
 * @param {string} text
 * @returns {Promise<{ objects: Map<number, string>, versions: Map<number, string[]>, unreadable: boolean }>}
 */
export async function pdfObjects(bytes, text) {
  /** @type {Map<number, string>} */
  const objects = new Map();
  /** @type {Map<number, string[]>} */
  const versions = new Map();
  /** @param {number} number @param {string} body */
  const keep = (number, body) => {
    objects.set(number, body);
    const list = versions.get(number);
    if (list) list.push(body);
    else versions.set(number, [body]);
  };
  let unreadable = false;
  /** @type {{ at: number, body: string }[]} */
  const packed = [];
  const headers = [...text.matchAll(/(?:^|[\r\n\s])(\d+)\s+(\d+)\s+obj\b/g)];
  const ends = [...text.matchAll(/endobj/g)].map((match) => match.index);
  let next = 0;
  headers.forEach((match, i) => {
    const at = match.index + match[0].length;
    while (next < ends.length && ends[next] < at) next += 1;
    const end = Math.min(ends[next] ?? text.length, headers[i + 1]?.index ?? text.length);
    const body = text.slice(at, end);
    keep(Number(match[1]), body);
    const streamAt = body.search(/stream\r?\n/);
    if (/\/Type\s*\/ObjStm\b/.test(streamAt === -1 ? body : body.slice(0, streamAt + 1))) packed.push({ at, body });
  });
  /** @type {Meter} */
  const meter = { inflated: 0 };
  for (const { at, body } of packed) {
    if (meter.inflated >= MAX_PACKED_BYTES) {
      unreadable = true;
      break;
    }
    const data = await streamData(bytes, at, body, objects, Math.min(MAX_STREAM_BYTES, MAX_PACKED_BYTES - meter.inflated), meter);
    const declared = Number(/\/N\s+(\d+)/.exec(body)?.[1] ?? 0);
    const first = Number(/\/First\s+(\d+)/.exec(body)?.[1] ?? 0);
    if (data === null) {
      unreadable = true;
      continue;
    }
    const numbers = data.slice(0, first).trim().split(/\s+/).map(Number);
    // The count can't exceed the number/offset pairs actually written, and offsets must increase: objects that
    // overlap would let a small stream stand for thousands of copies of the same megabytes.
    const count = Math.min(declared, Math.floor(numbers.length / 2));
    for (let i = 0; i < count; i += 1) {
      const start = first + numbers[i * 2 + 1];
      const end = i + 1 < count ? first + numbers[i * 2 + 3] : data.length;
      if (!Number.isFinite(numbers[i * 2]) || !Number.isFinite(start) || !Number.isFinite(end) || end < start || end > data.length) {
        unreadable = true;
        break;
      }
      keep(numbers[i * 2], data.slice(start, end));
    }
  }
  return { objects, versions, unreadable };
}

/**
 * PDF text with the #xx escapes in names decoded: "/#4A#53" is "/JS" and "/Java#53cript" is "/JavaScript" to a PDF
 * reader (ISO 32000-1 §7.3.5), so keyword checks must see them decoded. Only for matching: lengths change, so
 * offsets into the file must come from the raw text.
 * @param {string} text
 */
export function pdfNames(text) {
  return text.replace(/\/[^\s/[\]<>(){}%]*#[0-9A-Fa-f]{2}[^\s/[\]<>(){}%]*/g, (name) => name.replace(/#([0-9A-Fa-f]{2})/g, (_, code) => String.fromCharCode(parseInt(code, 16))));
}

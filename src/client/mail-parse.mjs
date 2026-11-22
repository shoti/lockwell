// @ts-check
/**
 * @file Reading email headers: finding the header block in a paste, unfolding fields, encoded words (RFC 2047),
 * addresses, dates and parameters (RFC 2231).
 */
/**
 * Everything here reads text written by whoever sent the message, so every reader is one left-to-right pass with hard
 * limits, never a regular expression with nested repetition. Each loop adds to STEPS.count, so tests can show that
 * hostile input costs time in proportion to its length. Nothing here builds HTML.
 * Grammar: RFC 5322 (fields, addresses, dates, obsolete forms), RFC 2047, RFC 6532, RFC 2231; research log
 * docs/research/tool-email-headers.md §1.
 */

/** Work done by the readers, for tests: reset it, read something, compare with the input's length. */
export const STEPS = { count: 0 };

/** Pasted text read at most (characters). */
export const MAX_TEXT = 2 * 1024 * 1024;
/** Header fields read at most; the rest are counted as not read. */
export const MAX_FIELDS = 2000;
/** One field's value after unfolding, at most (characters); the rest is cut. */
export const MAX_FIELD_LENGTH = 256 * 1024;
/** Addresses read from one field at most. */
const MAX_ADDRESSES = 1000;
/** RFC 2231 continuations of one parameter read at most. */
const MAX_SEGMENTS = 1000;
/** Bytes of one decoded parameter value, at most (a file name, a charset): more is cut off (review E8). */
const MAX_PARAM_BYTES = 8192;

/* ---------- Tokens of structured fields ---------- */

/**
 * @typedef {object} Token
 * @property {'atom' | 'quoted' | 'comment' | 'literal' | 'special'} type
 * @property {string} text  A quoted string or comment without its delimiters and escapes; a literal with its brackets.
 * @property {boolean} space  White space comes right before it.
 * @property {number} start  Offset in the text.
 * @property {number} end
 * @property {boolean} [open]  A quoted string, comment or literal that never closes (runs to the end).
 */

/**
 * Splits a structured field value into tokens: atoms, quoted strings, comments (nested), domain literals and the
 * given special characters. Never fails: anything unterminated runs to the end of the text.
 * @param {string} text
 * @param {string} specials  One-character tokens, e.g. "<>@,;:." for addresses.
 * @param {{ literals?: boolean }} [options]  literals: read "[...]" as one token.
 * @returns {Token[]}
 */
export function tokenize(text, specials, { literals = false } = {}) {
  /** @type {Token[]} */
  const tokens = [];
  let i = 0;
  let space = false;
  const n = text.length;
  while (i < n) {
    STEPS.count += 1;
    const char = text[i];
    if (char === ' ' || char === '\t' || char === '\n' || char === '\r') {
      space = true;
      i += 1;
      continue;
    }
    const start = i;
    if (char === '(') {
      let depth = 1;
      let out = '';
      i += 1;
      while (i < n && depth > 0) {
        STEPS.count += 1;
        const c = text[i];
        if (c === '\\' && i + 1 < n) {
          out += text[i + 1];
          i += 2;
          continue;
        }
        if (c === '(') depth += 1;
        else if (c === ')') depth -= 1;
        if (depth > 0) out += c;
        i += 1;
      }
      tokens.push({ type: 'comment', text: out, space, start, end: i, ...(depth > 0 ? { open: true } : {}) });
    } else if (char === '"') {
      let out = '';
      let closed = false;
      i += 1;
      while (i < n) {
        STEPS.count += 1;
        const c = text[i];
        if (c === '\\' && i + 1 < n) {
          out += text[i + 1];
          i += 2;
          continue;
        }
        i += 1;
        if (c === '"') {
          closed = true;
          break;
        }
        out += c;
      }
      tokens.push({ type: 'quoted', text: out, space, start, end: i, ...(closed ? {} : { open: true }) });
    } else if (literals && char === '[') {
      let closed = false;
      i += 1;
      while (i < n) {
        STEPS.count += 1;
        const c = text[i];
        i += 1;
        if (c === ']') {
          closed = true;
          break;
        }
      }
      tokens.push({ type: 'literal', text: text.slice(start, i), space, start, end: i, ...(closed ? {} : { open: true }) });
    } else if (specials.includes(char)) {
      i += 1;
      tokens.push({ type: 'special', text: char, space, start, end: i });
    } else {
      while (i < n) {
        STEPS.count += 1;
        const c = text[i];
        if (c === ' ' || c === '\t' || c === '\n' || c === '\r' || c === '(' || c === '"' || (literals && c === '[') || specials.includes(c)) break;
        i += 1;
      }
      tokens.push({ type: 'atom', text: text.slice(start, i), space, start, end: i });
    }
    space = false;
  }
  return tokens;
}

/** @param {Token} token @param {string} char */
export const isSpecial = (token, char) => token.type === 'special' && token.text === char;

/**
 * Splits tokens at a special character.
 * @param {Token[]} tokens
 * @param {string} char
 * @returns {Token[][]}
 */
export function splitTokens(tokens, char) {
  /** @type {Token[][]} */
  const parts = [[]];
  for (const token of tokens) {
    if (isSpecial(token, char)) parts.push([]);
    else /** @type {Token[]} */ (parts.at(-1)).push(token);
  }
  return parts;
}

/* ---------- The header block ---------- */

/**
 * @typedef {object} Field
 * @property {string} name  As written.
 * @property {string} key  Lowercase name.
 * @property {string} value  Unfolded, without the white space after the colon or at the end.
 * @property {number} index  0 for the topmost field.
 * @property {boolean} cut  The value was longer than MAX_FIELD_LENGTH and was cut.
 *
 * @typedef {object} Message
 * @property {Field[]} fields  Top first, as received.
 * @property {string[]} unparsed  Lines inside the header block that are neither a field nor its continuation.
 * @property {string} body  Everything after the empty line that ends the header block ("" when there is none).
 * @property {boolean} hasBody  An empty line ended the header block and text follows it.
 * @property {number} notRead  Fields beyond MAX_FIELDS, not read.
 * @property {boolean} tooLarge  The text is longer than MAX_TEXT and was not read.
 * @property {{ quoted: boolean, indented: boolean, mbox: boolean, before: number }} cleaned  What was removed around
 *   the headers: ">" quote marks, a common indent, an mbox "From " line, lines before the header block.
 */

/** Fields that only mail servers write: the header block of a real message has them, a summary pasted above it doesn't. */
const TRACE = new Set([
  'received', 'return-path', 'authentication-results', 'arc-seal', 'arc-message-signature', 'arc-authentication-results', 'dkim-signature',
  'received-spf', 'delivered-to', 'x-received', 'x-original-to',
]);
/** Fields every message has; used to find a header block that was pasted without its trace fields. */
const CORE = new Set(['from', 'to', 'subject', 'date', 'message-id', 'reply-to', 'sender', 'cc', 'mime-version', 'content-type']);

/**
 * Where a field's name ends: the position of its colon, or -1 when the line doesn't start a field. RFC 5322 field
 * names are printable ASCII without ":"; white space before the colon is the obsolete form (§4.5).
 * @param {string} line
 */
function fieldColon(line) {
  let i = 0;
  while (i < line.length && i < 200) {
    const code = line.charCodeAt(i);
    if (code === 58) return i > 0 ? i : -1;
    if (code < 33 || code > 126) break;
    i += 1;
  }
  if (i === 0) return -1;
  let j = i;
  while (j < line.length && (line[j] === ' ' || line[j] === '\t')) j += 1;
  return line[j] === ':' && j > i ? j : -1;
}

/** @param {string} line */
const isBlank = (line) => line.trim() === '';
/** @param {string} line */
const isContinuation = (line) => (line[0] === ' ' || line[0] === '\t') && !isBlank(line);

/**
 * Removes what mail programs and people put around a copied source: a byte order mark, ">" quoting and a common
 * indent on every line, an mbox "From " line.
 * @param {string[]} lines
 */
function cleanLines(lines) {
  let quoted = false;
  for (let level = 0; level < 5; level += 1) {
    const filled = lines.filter((line) => !isBlank(line));
    if (filled.length === 0 || !filled.every((line) => line.startsWith('>'))) break;
    quoted = true;
    for (let i = 0; i < lines.length; i += 1) {
      STEPS.count += 1;
      lines[i] = lines[i].replace(/^> ?/, '');
    }
  }
  let indent = Infinity;
  for (const line of lines) {
    STEPS.count += 1;
    if (isBlank(line)) continue;
    let k = 0;
    while (k < line.length && (line[k] === ' ' || line[k] === '\t')) k += 1;
    indent = Math.min(indent, k);
  }
  const indented = indent !== Infinity && indent > 0;
  if (indented) {
    for (let i = 0; i < lines.length; i += 1) {
      STEPS.count += 1;
      lines[i] = isBlank(lines[i]) ? '' : lines[i].slice(indent);
    }
  }
  const first = lines.findIndex((line) => !isBlank(line));
  const mbox = first !== -1 && lines[first].startsWith('From ') && fieldColon(lines[first]) === -1;
  if (mbox) lines.splice(first, 1);
  return { quoted, indented, mbox };
}

/**
 * Quote marks at the start of a line ("> > "): how many, and where the text after them starts.
 * @param {string} line
 */
function quoteOf(line) {
  let level = 0;
  let at = 0;
  while (level < 5 && line[at] === '>') {
    level += 1;
    at += line[at + 1] === ' ' ? 2 : 1;
  }
  return { level, at };
}

/** @param {string} line @param {number} from */
function indentOf(line, from) {
  let k = from;
  while (k < line.length && (line[k] === ' ' || line[k] === '\t')) k += 1;
  return k - from;
}

/**
 * Headers quoted or indented inside other text (a note above them, a signature below): finds the first known field
 * once quote marks and indent are taken off, and cleans only the run of lines around it, at its quote level and
 * indent (review E15). Used only when no header block shows as the text stands.
 * @param {string[]} lines  Changed in place.
 * @returns {{ quoted: boolean, indented: boolean } | null}
 */
function cleanRun(lines) {
  /** @param {Set<string>} names */
  const find = (names) => {
    for (let i = 0; i < lines.length; i += 1) {
      STEPS.count += 1;
      const { level, at } = quoteOf(lines[i]);
      const indent = indentOf(lines[i], at);
      if (level === 0 && indent === 0) continue;
      const rest = lines[i].slice(at + indent);
      const colon = fieldColon(rest);
      if (colon !== -1 && names.has(rest.slice(0, colon).trim().toLowerCase())) return { i, level, indent };
    }
    return null;
  };
  const found = find(TRACE) ?? find(CORE);
  if (!found) return null;
  const { level, indent } = found;
  /** The text after the run's quote marks, or null when the line is at another quote level or less indented. @param {string} line */
  const inRun = (line) => {
    const quote = quoteOf(line);
    if (quote.level !== level) return null;
    const rest = line.slice(quote.at);
    return isBlank(rest) || indentOf(line, quote.at) >= indent ? rest : null;
  };
  let from = found.i;
  for (let rest = from > 0 ? inRun(lines[from - 1]) : null; rest !== null && !isBlank(rest); rest = from > 0 ? inRun(lines[from - 1]) : null) {
    STEPS.count += 1;
    from -= 1;
  }
  let to = found.i;
  while (to + 1 < lines.length && inRun(lines[to + 1]) !== null) {
    STEPS.count += 1;
    to += 1;
  }
  for (let i = from; i <= to; i += 1) {
    const rest = /** @type {string} */ (inRun(lines[i]));
    lines[i] = isBlank(rest) ? '' : rest.slice(indent);
  }
  return { quoted: level > 0, indented: indent > 0 };
}

/**
 * The first line of the header block: the run of field lines around the first trace field, or, without one, around
 * the first common field. Lines above it (a summary a mail program shows before the source) are skipped.
 * @param {string[]} lines
 * @returns {number}  -1 when there is no header block.
 */
function headerStart(lines) {
  /** @param {Set<string>} names */
  const firstOf = (names) => {
    for (let i = 0; i < lines.length; i += 1) {
      STEPS.count += 1;
      const colon = fieldColon(lines[i]);
      if (colon !== -1 && names.has(lines[i].slice(0, colon).trim().toLowerCase())) return i;
    }
    return -1;
  };
  /** @param {number} at */
  const blockStart = (at) => {
    while (at > 0 && (fieldColon(lines[at - 1]) !== -1 || isContinuation(lines[at - 1]))) {
      STEPS.count += 1;
      at -= 1;
    }
    while (fieldColon(lines[at]) === -1) at += 1;
    return at;
  };
  const trace = firstOf(TRACE);
  const core = firstOf(CORE);
  if (trace === -1) return core === -1 ? -1 : blockStart(core);
  if (core !== -1 && core < trace) {
    // A whole header block above the trace fields, with a multipart body that holds them: a sent message with another
    // message attached. The attached one's Received lines are not this message's (review E16).
    const start = blockStart(core);
    const block = readHeaderBlock(lines, start, trace);
    const type = block.fields.find((field) => field.key === 'content-type')?.value ?? '';
    if (block.end < trace && /^\s*multipart\//i.test(type)) return start;
  }
  return blockStart(trace);
}

/**
 * Reads the fields of a header block from `start` up to the empty line that ends it (or `end`), unfolding them.
 * @param {string[]} lines
 * @param {number} start
 * @param {number} end
 * @returns {{ fields: Field[], unparsed: string[], notRead: number, end: number }}  end: the index of the empty line.
 */
function readHeaderBlock(lines, start, end) {
  /** @type {Field[]} */
  const fields = [];
  /** @type {string[]} */
  const unparsed = [];
  let notRead = 0;
  /** @type {{ name: string, parts: string[], length: number, cut: boolean } | null} */
  let current = null;
  const finish = () => {
    if (!current) return;
    if (fields.length < MAX_FIELDS) {
      const value = current.parts.join('').trim();
      fields.push({ name: current.name, key: current.name.toLowerCase(), value, index: fields.length, cut: current.cut });
    } else {
      notRead += 1;
    }
    current = null;
  };
  let i = start;
  for (; i < end; i += 1) {
    STEPS.count += 1;
    const line = lines[i];
    if (isBlank(line)) {
      // A line of only white space followed by a continuation is obsolete folding (RFC 5322 §4.2), not the end.
      if (line !== '' && current && i + 1 < end && isContinuation(lines[i + 1])) continue;
      break;
    }
    if (isContinuation(line)) {
      if (!current) {
        unparsed.push(line.trim());
        continue;
      }
      if (current.length < MAX_FIELD_LENGTH) {
        const piece = line.slice(0, MAX_FIELD_LENGTH - current.length);
        current.parts.push(piece);
        current.length += piece.length;
        if (piece.length < line.length) current.cut = true;
      } else {
        current.cut = true;
      }
      continue;
    }
    const colon = fieldColon(line);
    finish();
    if (colon === -1) {
      unparsed.push(line.trim());
      continue;
    }
    const value = line.slice(colon + 1);
    const piece = value.slice(0, MAX_FIELD_LENGTH);
    current = { name: line.slice(0, colon).trim(), parts: [piece], length: piece.length, cut: piece.length < value.length };
  }
  finish();
  return { fields, unparsed, notRead, end: i };
}

/**
 * Finds the header block in pasted text or a message file, unfolds its fields (RFC 5322 §2.2.3) and keeps the body.
 * @param {string} input
 * @param {{ limit?: number }} [options]  Characters read at most: pasted text has MAX_TEXT, a chosen file its own size.
 * @returns {Message}
 */
export function splitMessage(input, { limit = MAX_TEXT } = {}) {
  /** @type {Message} */
  const message = { fields: [], unparsed: [], body: '', hasBody: false, notRead: 0, tooLarge: false, cleaned: { quoted: false, indented: false, mbox: false, before: 0 } };
  if (input.length > limit) {
    message.tooLarge = true;
    return message;
  }
  const lines = input.replace(/^\ufeff/, '').replace(/\r\n?/g, '\n').split('\n');
  message.cleaned = { ...cleanLines(lines), before: 0 };
  let start = headerStart(lines);
  if (start === -1) {
    const run = cleanRun(lines);
    if (run) {
      message.cleaned.quoted ||= run.quoted;
      message.cleaned.indented ||= run.indented;
      start = headerStart(lines);
    }
  }
  if (start === -1) return message;
  message.cleaned.before = lines.slice(0, start).filter((line) => !isBlank(line)).length;

  const block = readHeaderBlock(lines, start, lines.length);
  message.fields = block.fields;
  message.unparsed = block.unparsed;
  message.notRead = block.notRead;
  const i = block.end;
  const body = lines.slice(i + 1);
  message.hasBody = i < lines.length && body.some((line) => !isBlank(line));
  message.body = message.hasBody ? body.join('\n') : '';
  return message;
}

/**
 * The fields with a name, top first.
 * @param {Field[]} fields
 * @param {string} key  Lowercase.
 */
export const fieldsNamed = (fields, key) => fields.filter((field) => field.key === key);

/* ---------- Encoded words (RFC 2047) ---------- */

/** Characters RFC 2047 allows in a charset name (a token: no especials, no space). "*" starts a language (RFC 2231 §5). */
const ESPECIALS = '()<>@,;:"/[]?.= ';

/**
 * The bytes of base64 text; null when it isn't base64. Missing padding is accepted.
 * @param {string} text
 * @returns {Uint8Array | null}
 */
export function base64Bytes(text) {
  const clean = text.replace(/=+$/, '');
  /** @type {number[]} */
  const out = [];
  let buffer = 0;
  let bits = 0;
  for (let i = 0; i < clean.length; i += 1) {
    STEPS.count += 1;
    const code = clean.charCodeAt(i);
    const value =
      code >= 65 && code <= 90 ? code - 65
        : code >= 97 && code <= 122 ? code - 71
          : code >= 48 && code <= 57 ? code + 4
            : code === 43 ? 62
              : code === 47 ? 63
                : -1;
    if (value === -1) return null;
    buffer = (buffer << 6) | value;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out.push((buffer >> bits) & 0xff);
    }
  }
  return Uint8Array.from(out);
}

/**
 * The bytes of "Q" text: "_" is a space, "=XX" a byte, other characters themselves (UTF-8 for anything beyond ASCII).
 * @param {string} text
 * @returns {Uint8Array}
 */
function qBytes(text) {
  /** @type {number[]} */
  const out = [];
  for (let i = 0; i < text.length; i += 1) {
    STEPS.count += 1;
    const char = text[i];
    if (char === '_') out.push(0x20);
    else if (char === '=' && /^[0-9a-f]{2}$/i.test(text.slice(i + 1, i + 3))) {
      out.push(parseInt(text.slice(i + 1, i + 3), 16));
      i += 2;
    } else if (char.charCodeAt(0) < 0x80) out.push(char.charCodeAt(0));
    else out.push(...new TextEncoder().encode(char));
  }
  return Uint8Array.from(out);
}

/**
 * Text from bytes in a named character set; null when the browser doesn't know the name.
 * @param {Uint8Array} bytes
 * @param {string} charset
 * @returns {string | null}
 */
export function decodeCharset(bytes, charset) {
  try {
    return new TextDecoder(charset.trim().toLowerCase()).decode(bytes);
  } catch {
    return null;
  }
}

/**
 * Reads one encoded word starting at `at` ("=?charset?B?text?="): its parts and where it ends, or null.
 * Stops at the first "?" or white space after the encoding, so each failed attempt costs only up to there.
 * @param {string} text
 * @param {number} at  Position of "=?".
 * @returns {{ charset: string, encoding: string, payload: string, end: number } | null}
 */
function readEncodedWord(text, at) {
  let i = at + 2;
  const charsetStart = i;
  while (i < text.length && i - charsetStart <= 64) {
    STEPS.count += 1;
    const c = text[i];
    if (c === '?') break;
    if (ESPECIALS.includes(c) || c.charCodeAt(0) < 33 || c.charCodeAt(0) > 126) return null;
    i += 1;
  }
  if (text[i] !== '?' || i === charsetStart) return null;
  const charset = text.slice(charsetStart, i);
  const encoding = (text[i + 1] ?? '').toUpperCase();
  if ((encoding !== 'B' && encoding !== 'Q') || text[i + 2] !== '?') return null;
  i += 3;
  const payloadStart = i;
  while (i < text.length) {
    STEPS.count += 1;
    const c = text[i];
    if (c === '?') return text[i + 1] === '=' ? { charset, encoding, payload: text.slice(payloadStart, i), end: i + 2 } : null;
    if (c === ' ' || c === '\t' || c === '\n' || c === '\r') return null;
    i += 1;
  }
  return null;
}

/**
 * Decodes the encoded words in a header value (RFC 2047): "=?UTF-8?B?...?=" and "=?ISO-8859-1?Q?...?=". White space
 * between two encoded words is dropped. A word in a character set the browser doesn't know, or that doesn't decode,
 * is left as written and `broken` is set.
 * @param {string} text
 * @returns {{ text: string, broken: boolean }}
 */
export function decodeWords(text) {
  let out = '';
  let broken = false;
  let i = 0;
  let afterWord = false;
  while (i < text.length) {
    STEPS.count += 1;
    const at = text.indexOf('=?', i);
    if (at === -1) {
      out += text.slice(i);
      break;
    }
    const word = readEncodedWord(text, at);
    if (!word) {
      out += text.slice(i, at + 2);
      i = at + 2;
      afterWord = false;
      continue;
    }
    const between = text.slice(i, at);
    if (!(afterWord && between.trim() === '')) out += between;
    const bytes = word.encoding === 'B' ? base64Bytes(word.payload) : qBytes(word.payload);
    const decoded = bytes ? decodeCharset(bytes, word.charset.split('*')[0]) : null;
    if (decoded === null) {
      broken = true;
      out += text.slice(at, word.end);
      afterWord = false;
    } else {
      out += decoded;
      afterWord = true;
    }
    i = word.end;
  }
  return { text: out, broken };
}

/* ---------- Addresses (RFC 5322 §3.4) ---------- */

/**
 * @typedef {object} Address
 * @property {string} name  The shown name, decoded; for "addr (Name)", the comment.
 * @property {string} local  The part before "@", as written (quoted strings without their quotes).
 * @property {string} domain  The part after "@", as written; "" when the address didn't parse.
 * @property {string} address  local@domain, or "" when it didn't parse.
 * @property {string} raw  The whole item as written.
 * @property {string} group  The group it belongs to ("" for none).
 * @property {boolean} bad  The item isn't an address; shown as written, never guessed.
 */

const ADDRESS_SPECIALS = '<>@,;:.';

/**
 * Text of tokens as a phrase: words separated where the source had white space.
 * @param {Token[]} tokens
 */
function phrase(tokens) {
  let out = '';
  for (const token of tokens) {
    if (token.type === 'comment') continue;
    out += (out && token.space ? ' ' : '') + token.text;
  }
  return out;
}

/**
 * One mailbox from its tokens.
 * @param {Token[]} tokens
 * @param {string} text  The field value, for `raw`.
 * @param {string} group
 * @returns {Address | null}  null for an empty item ("a, , b").
 */
function mailbox(tokens, text, group) {
  const content = tokens.filter((token) => token.type !== 'comment');
  if (content.length === 0) return null;
  const raw = text.slice(tokens[0].start, tokens[tokens.length - 1].end).trim();
  const angle = tokens.findIndex((token) => isSpecial(token, '<'));
  let nameTokens = /** @type {Token[]} */ ([]);
  let specTokens = content;
  if (angle !== -1) {
    nameTokens = tokens.slice(0, angle);
    const close = tokens.findIndex((token, index) => index > angle && isSpecial(token, '>'));
    specTokens = tokens.slice(angle + 1, close === -1 ? tokens.length : close).filter((token) => token.type !== 'comment');
    // An obsolete route: "<@node.test:mary@example.net>".
    const route = specTokens.findLastIndex((token) => isSpecial(token, ':'));
    if (route !== -1) specTokens = specTokens.slice(route + 1);
  }
  const atSign = specTokens.findLastIndex((token) => isSpecial(token, '@'));
  const local = atSign > 0 ? specTokens.slice(0, atSign).map((token) => token.text).join('') : '';
  const domainTokens = atSign === -1 ? [] : specTokens.slice(atSign + 1);
  const domain = domainTokens.map((token) => token.text).join('');
  const good = local !== '' && domain !== '' && domainTokens.every((token) => token.type === 'atom' || token.type === 'literal' || isSpecial(token, '.'))
    && !domain.startsWith('.') && !domain.endsWith('.') && (angle === -1 || tokens.some((token, index) => index > angle && isSpecial(token, '>')));
  // The old form "jdoe@example.org (John Doe)": a comment after the address. One before it is not a name.
  const comment = tokens.find((token) => token.type === 'comment' && token.start > content[0].start)?.text ?? '';
  const shown = phrase(nameTokens) || (angle === -1 ? comment : '');
  return {
    name: decodeWords(shown).text.trim(),
    local: good ? local : '',
    domain: good ? domain : '',
    address: good ? `${local}@${domain}` : '',
    raw,
    group,
    bad: !good,
  };
}

/**
 * Reads an address list: "Name <a@b>", "a@b (Name)", quoted names, comments, groups, obsolete routes and spacing.
 * @param {string} text
 * @returns {Address[]}
 */
export function parseAddresses(text) {
  const tokens = tokenize(text, ADDRESS_SPECIALS, { literals: true });
  /** @type {Address[]} */
  const out = [];
  /** @type {Token[]} */
  let item = [];
  let group = '';
  let inGroup = false;
  let depth = 0;
  const flush = () => {
    const found = mailbox(item, text, group);
    if (found && out.length < MAX_ADDRESSES) out.push(found);
    item = [];
  };
  for (const token of tokens) {
    if (isSpecial(token, '<')) depth += 1;
    else if (isSpecial(token, '>')) depth = Math.max(0, depth - 1);
    if (depth === 0 && isSpecial(token, ':') && !inGroup && !item.some((t) => isSpecial(t, '@') || isSpecial(t, '>'))) {
      group = decodeWords(phrase(item)).text.trim();
      inGroup = true;
      item = [];
      continue;
    }
    if (depth === 0 && isSpecial(token, ';') && inGroup) {
      flush();
      group = '';
      inGroup = false;
      continue;
    }
    if (depth === 0 && isSpecial(token, ',')) {
      flush();
      continue;
    }
    item.push(token);
  }
  flush();
  return out;
}

/**
 * The identifiers in Message-ID, In-Reply-To or References: "<left@right>" each, with the part after "@".
 * @param {string} text
 * @returns {{ id: string, domain: string }[]}
 */
export function parseMessageIds(text) {
  const tokens = tokenize(text, '<>@.', { literals: true }).filter((token) => token.type !== 'comment');
  /** @type {{ id: string, domain: string }[]} */
  const out = [];
  /** @type {Token[] | null} */
  let inside = null;
  for (const token of tokens) {
    if (isSpecial(token, '<')) inside = [];
    else if (isSpecial(token, '>') && inside) {
      const at = inside.findLastIndex((t) => isSpecial(t, '@'));
      const id = inside.map((t) => t.text).join('');
      if (id && out.length < MAX_ADDRESSES) out.push({ id, domain: at === -1 ? '' : inside.slice(at + 1).map((t) => t.text).join('') });
      inside = null;
    } else if (inside) inside.push(token);
  }
  return out;
}

/* ---------- Dates (RFC 5322 §3.3 and §4.3) ---------- */

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
/** Obsolete zone names (RFC 5322 §4.3), in minutes east of UTC. */
const ZONES = /** @type {Record<string, number>} */ ({ ut: 0, utc: 0, gmt: 0, z: 0, est: -300, edt: -240, cst: -360, cdt: -300, mst: -420, mdt: -360, pst: -480, pdt: -420 });

/** @param {string} word @returns {number} 0 to 11, or -1 */
const monthOf = (word) => (word.length >= 3 ? MONTHS.indexOf(word.slice(0, 3).toLowerCase()) : -1);

/**
 * Reads a date-time as mail writes it: "Fri, 21 Nov 1997 09:55:06 -0600", obsolete forms ("21 Nov 97 09:55:06 GMT",
 * comments and spacing anywhere), and the orders real servers use ("Fri, Feb 15 2002 17:19:07 -0800"). Military and
 * unknown zone letters count as UTC (RFC 5322 §4.3); a missing zone too.
 * @param {string} text
 * @returns {number | null}  Milliseconds since 1970 (UTC), or null when it isn't a date.
 */
export function parseDate(text) {
  const tokens = tokenize(text.slice(0, 500), ',:').filter((token) => token.type === 'atom' || isSpecial(token, ':'));
  let i = 0;
  if (tokens[i]?.type === 'atom' && DAYS.includes(tokens[i].text.slice(0, 3).toLowerCase()) && !/\d/.test(tokens[i].text)) i += 1;
  const colon = tokens.findIndex((token, index) => index > i && isSpecial(token, ':'));
  if (colon < 1) return null;
  const dateParts = tokens.slice(i, colon - 1).map((token) => token.text);
  if (dateParts.length !== 3) return null;
  const monthAt = dateParts.findIndex((part) => monthOf(part) !== -1 && !/\d/.test(part));
  if (monthAt === -1 || monthAt === 2) return null;
  const month = monthOf(dateParts[monthAt]);
  const numbers = dateParts.filter((_, index) => index !== monthAt);
  if (!/^\d{1,2}$/.test(numbers[0]) || !/^\d{2,4}$/.test(numbers[1])) return null;
  const day = Number(numbers[0]);
  let year = Number(numbers[1]);
  if (numbers[1].length === 2) year += year < 50 ? 2000 : 1900;
  else if (numbers[1].length === 3) year += 1900;

  const hour = tokens[colon - 1].text;
  const minute = tokens[colon + 1]?.text ?? '';
  let next = colon + 2;
  let second = '0';
  if (tokens[next] && isSpecial(tokens[next], ':')) {
    second = tokens[next + 1]?.text ?? '';
    next += 2;
  }
  if (!/^\d{1,2}$/.test(hour) || !/^\d{1,2}$/.test(minute) || !/^\d{1,2}(\.\d+)?$/.test(second)) return null;
  const [h, m, s] = [Number(hour), Number(minute), Math.min(59, Math.floor(Number(second)))];
  if (h > 23 || m > 59 || day < 1 || day > 31) return null;

  let offset = 0;
  const zone = tokens[next]?.type === 'atom' ? tokens[next].text : '';
  if (/^[+-]\d{4}$/.test(zone)) {
    const minutes = Number(zone.slice(3, 5));
    if (minutes > 59) return null;
    offset = (zone[0] === '-' ? -1 : 1) * (Number(zone.slice(1, 3)) * 60 + minutes);
  } else {
    offset = ZONES[zone.toLowerCase()] ?? 0;
  }
  const time = Date.UTC(year, month, day, h, m, s);
  if (new Date(time).getUTCDate() !== day) return null;
  return time - offset * 60_000;
}

/* ---------- Parameters (RFC 2045 §5.1, RFC 2231) ---------- */

/**
 * Bytes of RFC 2231 extended text: "%XX" bytes and plain characters.
 * @param {string} text
 * @returns {number[]}
 */
function percentBytes(text) {
  /** @type {number[]} */
  const out = [];
  for (let i = 0; i < text.length; i += 1) {
    STEPS.count += 1;
    if (text[i] === '%' && /^[0-9a-f]{2}$/i.test(text.slice(i + 1, i + 3))) {
      out.push(parseInt(text.slice(i + 1, i + 3), 16));
      i += 2;
    } else {
      out.push(...new TextEncoder().encode(text[i]));
    }
  }
  return out;
}

/**
 * Reads a Content-Type or Content-Disposition value: the value before the first ";" and its parameters, with RFC
 * 2231 continuations ("name*0", "name*1") and character sets ("name*=utf-8''%E2%82%AC") joined and decoded, and
 * RFC 2047 encoded words decoded (many programs write file names that way).
 * @param {string} text
 * @returns {{ value: string, params: Record<string, string> }}
 */
export function parseParams(text) {
  const parts = splitTokens(tokenize(text, ';='), ';');
  const value = parts[0].filter((token) => token.type !== 'comment').map((token) => token.text).join('').trim();
  /** @type {Record<string, string>} */
  const plain = {};
  /** @type {Map<string, { index: number, text: string, extended: boolean }[]>} */
  const continued = new Map();
  for (const part of parts.slice(1)) {
    const tokens = part.filter((token) => token.type !== 'comment');
    const equals = tokens.findIndex((token) => isSpecial(token, '='));
    if (equals < 1) continue;
    const name = tokens.slice(0, equals).map((token) => token.text).join('').trim().toLowerCase();
    const paramValue = tokens.slice(equals + 1).map((token) => token.text).join('');
    const match = /^([^*]+)\*(\d{1,4})(\*?)$/.exec(name);
    if (match) {
      const list = continued.get(match[1]) ?? [];
      if (list.length < MAX_SEGMENTS) list.push({ index: Number(match[2]), text: paramValue, extended: match[3] === '*' });
      continued.set(match[1], list);
    } else if (name.endsWith('*')) {
      continued.set(name.slice(0, -1), [{ index: 0, text: paramValue, extended: true }]);
    } else if (!(name in plain)) {
      plain[name] = paramValue;
    }
  }
  /** @type {Record<string, string>} */
  const params = {};
  for (const [name, list] of continued) {
    list.sort((a, b) => a.index - b.index);
    let charset = '';
    /** @type {number[]} */
    const bytes = [];
    list.forEach((segment, n) => {
      if (bytes.length >= MAX_PARAM_BYTES) return;
      let segmentText = segment.text;
      if (n === 0 && segment.extended) {
        const quote = segmentText.indexOf("'");
        const second = quote === -1 ? -1 : segmentText.indexOf("'", quote + 1);
        if (second !== -1) {
          charset = segmentText.slice(0, quote);
          segmentText = segmentText.slice(second + 1);
        }
      }
      // A loop, not push(...bytes): spreading a long value overflows the call stack (review E8).
      for (const byte of segment.extended ? percentBytes(segmentText) : new TextEncoder().encode(segmentText)) {
        if (bytes.length >= MAX_PARAM_BYTES) break;
        bytes.push(byte);
      }
    });
    const array = Uint8Array.from(bytes);
    params[name] = decodeCharset(array, charset || 'utf-8') ?? new TextDecoder('latin1').decode(array);
  }
  for (const [name, paramValue] of Object.entries(plain)) {
    if (!(name in params)) params[name] = paramValue.includes('=?') ? decodeWords(paramValue).text : paramValue;
  }
  return { value, params };
}

/* ---------- The message body (RFC 2045, RFC 2046, RFC 2183) ---------- */

/** Parts nested deeper than this are not opened. */
export const MAX_MIME_DEPTH = 10;
/** Parts read at most; the rest are counted. */
export const MAX_PARTS = 1000;
/** Text decoded from all text parts together, at most (characters). */
const MAX_BODY_TEXT = 4 * 1024 * 1024;

/**
 * @typedef {object} MimePart
 * @property {string} type  Lowercase, e.g. "text/plain", "application/pdf".
 * @property {string} name  The file name, decoded ("" when there is none).
 * @property {string} disposition  Lowercase: "attachment", "inline" or "".
 * @property {number} size  Bytes after decoding (worked out from the encoded length for base64).
 * @property {string} text  The decoded text of a text/plain or text/html part that isn't an attachment, else "".
 * @property {boolean} broken  Its transfer encoding or character set couldn't be decoded.
 *
 * @typedef {object} MimeReport
 * @property {MimePart[]} parts  Leaf parts, in order.
 * @property {number} total  Leaf parts found, including those beyond MAX_PARTS.
 * @property {boolean} tooDeep  Parts nested deeper than MAX_MIME_DEPTH were left out.
 * @property {boolean} textCut  More text than MAX_BODY_TEXT: the rest was not read.
 */

/**
 * Bytes of quoted-printable text (RFC 2045 §6.7): "=XX" bytes, "=" at a line end joins lines, the rest as written
 * (UTF-8 for anything beyond ASCII, as raw 8-bit text arrives here already decoded).
 * @param {string} text
 */
export function quotedPrintableBytes(text) {
  /** @type {number[]} */
  const out = [];
  const encoder = new TextEncoder();
  for (let i = 0; i < text.length; i += 1) {
    STEPS.count += 1;
    const char = text[i];
    if (char === '=') {
      if (text[i + 1] === '\n') {
        i += 1;
        continue;
      }
      if (/^[0-9a-f]{2}$/i.test(text.slice(i + 1, i + 3))) {
        out.push(parseInt(text.slice(i + 1, i + 3), 16));
        i += 2;
        continue;
      }
    }
    const code = char.charCodeAt(0);
    if (code < 0x80) out.push(code);
    else out.push(...encoder.encode(char));
  }
  return Uint8Array.from(out);
}

/**
 * The decoded size of a base64 range without decoding it.
 * @param {string[]} lines
 * @param {number} start
 * @param {number} end
 */
function base64Size(lines, start, end) {
  let count = 0;
  for (let i = start; i < end; i += 1) {
    STEPS.count += 1;
    const line = lines[i].trim();
    count += line.replace(/=+$/, '').length;
  }
  return Math.floor((count * 3) / 4);
}

/**
 * Walks a message body and lists its parts: multipart/* by boundary, message/rfc822 into the attached message, and
 * the leaves with their names, sizes and (for text) decoded text. Nothing is rendered: HTML is read only as text.
 * A boundary that never closes runs to the end; parts deeper than MAX_MIME_DEPTH or beyond MAX_PARTS are counted.
 * @param {Field[]} fields  The header fields of the message (Content-Type, Content-Transfer-Encoding, …).
 * @param {string} body
 * @returns {MimeReport}
 */
export function readMime(fields, body) {
  const lines = body.replace(/\r\n?/g, '\n').split('\n');
  /** @type {MimeReport} */
  const report = { parts: [], total: 0, tooDeep: false, textCut: false };
  let textLeft = MAX_BODY_TEXT;
  /** @type {{ fields: Field[], start: number, end: number, depth: number }[]} */
  const stack = [{ fields, start: 0, end: lines.length, depth: 0 }];
  /** @param {Field[]} list @param {string} key */
  const value = (list, key) => list.find((field) => field.key === key)?.value ?? '';
  while (stack.length) {
    STEPS.count += 1;
    const node = /** @type {{ fields: Field[], start: number, end: number, depth: number }} */ (stack.pop());
    const contentType = parseParams(value(node.fields, 'content-type'));
    const type = (contentType.value || 'text/plain').toLowerCase();
    const disposition = parseParams(value(node.fields, 'content-disposition'));
    if (type.startsWith('multipart/') || type === 'message/rfc822') {
      if (node.depth >= MAX_MIME_DEPTH) {
        report.tooDeep = true;
        continue;
      }
    }
    if (type.startsWith('multipart/') && contentType.params.boundary) {
      const open = `--${contentType.params.boundary}`;
      /** @type {[number, number][]} */
      const ranges = [];
      let partStart = -1;
      for (let i = node.start; i < node.end; i += 1) {
        STEPS.count += 1;
        const line = lines[i].trimEnd();
        if (line !== open && line !== `${open}--`) continue;
        if (partStart !== -1) ranges.push([partStart, i]);
        partStart = line === open ? i + 1 : -1;
        if (line !== open) break;
      }
      if (partStart !== -1) ranges.push([partStart, node.end]);
      // In reverse, so the stack hands them out in order.
      for (const [start, end] of ranges.reverse()) {
        const block = readHeaderBlock(lines, start, end);
        stack.push({ fields: block.fields, start: Math.min(block.end + 1, end), end, depth: node.depth + 1 });
      }
      continue;
    }
    if (type === 'message/rfc822') {
      // The attached message is listed as an attachment itself (review E16), and its parts are read too.
      report.total += 1;
      if (report.parts.length < MAX_PARTS) {
        let size = 0;
        for (let i = node.start; i < node.end; i += 1) size += lines[i].length + 1;
        report.parts.push({ type, name: disposition.params.filename ?? contentType.params.name ?? '', disposition: disposition.value.toLowerCase(), size, text: '', broken: false });
      }
      const block = readHeaderBlock(lines, node.start, node.end);
      stack.push({ fields: block.fields, start: Math.min(block.end + 1, node.end), end: node.end, depth: node.depth + 1 });
      continue;
    }
    report.total += 1;
    if (report.parts.length >= MAX_PARTS) continue;
    const encoding = value(node.fields, 'content-transfer-encoding').trim().toLowerCase();
    const name = disposition.params.filename ?? contentType.params.name ?? '';
    const kind = disposition.value.toLowerCase();
    const isText = (type === 'text/plain' || type === 'text/html') && kind !== 'attachment' && !name;
    /** @type {MimePart} */
    const part = { type, name, disposition: kind, size: 0, text: '', broken: false };
    if (encoding === 'base64') part.size = base64Size(lines, node.start, node.end);
    if (isText && textLeft > 0) {
      const raw = lines.slice(node.start, node.end).join('\n');
      /** @type {Uint8Array | null} */
      let bytes = null;
      if (encoding === 'base64') bytes = base64Bytes(raw.replace(/[\s]+/g, ''));
      else if (encoding === 'quoted-printable') bytes = quotedPrintableBytes(raw);
      if (bytes === null && (encoding === 'base64')) {
        part.broken = true;
      } else {
        const charset = contentType.params.charset ?? 'utf-8';
        const text = bytes ? decodeCharset(bytes, charset) : raw;
        if (text === null) part.broken = true;
        part.text = (text ?? new TextDecoder('latin1').decode(/** @type {Uint8Array} */ (bytes))).slice(0, textLeft);
        textLeft -= part.text.length;
        if (textLeft <= 0) report.textCut = true;
        if (!part.size) part.size = bytes ? bytes.length : raw.length;
      }
    } else if (isText) {
      report.textCut = true;
    }
    if (!part.size && encoding !== 'base64') {
      for (let i = node.start; i < node.end; i += 1) part.size += lines[i].length + 1;
    }
    report.parts.push(part);
  }
  return report;
}

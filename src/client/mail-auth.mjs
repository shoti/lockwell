// @ts-check
/**
 * @file Reading the fields mail servers add about a message: Authentication-Results (RFC 8601), Received-SPF (RFC
 * 7208), DKIM-Signature (RFC 6376), ARC sets (RFC 8617), Received (RFC 5321 §4.4) and the spam filters' own fields.
 */
/**
 * These readers only parse: which of the fields can be believed (the trust boundary) and what they mean are decided
 * in tool-email.mjs. Every reader accepts what real servers write, keeps what it doesn't understand as text, and
 * never throws on bad input. Sources: docs/research/tool-email-headers.md §2–§5 and §12.
 */
import { STEPS, isSpecial, parseDate, splitTokens, tokenize } from './mail-parse.mjs';
import { parseIp } from './ip.mjs';

/** Results read from one Authentication-Results field at most. */
const MAX_RESULTS = 200;
/** Tags read from one DKIM or ARC tag list at most. */
const MAX_TAGS = 64;
/** ARC instances run from 1 to 50 (RFC 8617 §4.2.1). */
export const MAX_ARC = 50;
/** Pairs read from one filter report at most. */
const MAX_PAIRS = 300;

/* ---------- Authentication-Results ---------- */

/**
 * @typedef {object} AuthProp
 * @property {string} ptype  "smtp", "header", "policy"…; "" for a bare key such as Microsoft's "action".
 * @property {string} property  "mailfrom", "d", "from"…
 * @property {string} value
 *
 * @typedef {object} AuthResult
 * @property {string} method  Lowercase: "spf", "dkim", "dmarc", "arc", "compauth"…
 * @property {string} version  "" when not given.
 * @property {string} result  Lowercase, as written: "pass", "fail", "softfail", "bestguesspass"…
 * @property {string} reason  The reason= value, as written ("" when absent).
 * @property {AuthProp[]} props
 * @property {string[]} comments  Comments inside this result, in order (Gmail's "(p=… dis=…)", Microsoft's
 *   "(sender IP is …)"): shown as written, never interpreted.
 *
 * @typedef {object} AuthResults
 * @property {string} authservId  Who wrote it; "" when the field doesn't say (Microsoft's form starts with a result).
 * @property {string} version
 * @property {boolean} none  "; none": the server checked nothing.
 * @property {AuthResult[]} results
 * @property {string[]} unparsed  Parts that aren't a result, as written (Microsoft's "; contoso.com;").
 */

/**
 * Reads one token value at the cursor: the token and every token glued to it without white space or a comment
 * ("abc/de=" in a signature value).
 * @param {Token[]} tokens
 * @param {number} k
 * @returns {{ text: string, next: number }}
 */
function gluedValue(tokens, k) {
  let text = tokens[k].text;
  let i = k + 1;
  while (i < tokens.length && tokens[i].type !== 'comment' && !tokens[i].space && !isSpecial(tokens[i], ';')) {
    STEPS.count += 1;
    text += tokens[i].text;
    i += 1;
  }
  return { text, next: i };
}

/** @typedef {import('./mail-parse.mjs').Token} Token */

/**
 * One "method=result reason=… ptype.property=value…" part.
 * @param {Token[]} tokens
 * @returns {AuthResult | null}
 */
function readResult(tokens) {
  /** @type {string[]} */
  const comments = [];
  let k = 0;
  const peek = () => {
    while (k < tokens.length && tokens[k].type === 'comment') {
      comments.push(tokens[k].text);
      k += 1;
    }
    return tokens[k];
  };
  /** @param {(token: Token) => boolean} test */
  const take = (test) => {
    const token = peek();
    if (!token || !test(token)) return null;
    k += 1;
    return token;
  };
  const isWord = (/** @type {Token} */ token) => token.type === 'atom';
  const method = take(isWord);
  if (!method) return null;
  let version = '';
  if (take((token) => isSpecial(token, '/'))) {
    const v = take(isWord);
    if (!v) return null;
    version = v.text;
  }
  if (!take((token) => isSpecial(token, '='))) return null;
  const result = take((token) => token.type === 'atom' || token.type === 'quoted');
  if (!result) return null;
  /** @type {AuthResult} */
  const found = { method: method.text.toLowerCase(), version, result: result.text.toLowerCase(), reason: '', props: [], comments };
  while (peek()) {
    STEPS.count += 1;
    /** @type {string[]} */
    const key = [];
    while (peek() && tokens[k].type === 'atom' && key.length < 5) {
      key.push(tokens[k].text);
      k += 1;
    }
    if (key.length === 0 || !take((token) => isSpecial(token, '='))) {
      // Not a key=value pair: skip the token so the loop moves on.
      if (peek()) k += 1;
      continue;
    }
    if (!peek()) break;
    const { text, next } = gluedValue(tokens, k);
    k = next;
    const name = key.join('');
    if (name.toLowerCase() === 'reason') {
      found.reason = text;
      continue;
    }
    const dot = name.indexOf('.');
    found.props.push(dot === -1 ? { ptype: '', property: name.toLowerCase(), value: text } : { ptype: name.slice(0, dot).toLowerCase(), property: name.slice(dot + 1).toLowerCase(), value: text });
  }
  return found;
}

/** @param {string} value @param {Token[]} tokens */
const textOf = (value, tokens) => (tokens.length ? value.slice(tokens[0].start, tokens[tokens.length - 1].end).trim() : '');

/**
 * Reads the parts of a results field after any ARC instance.
 * @param {string} value
 * @param {Token[][]} parts  Token lists split at ";".
 * @returns {AuthResults}
 */
function readAuthParts(value, parts) {
  /** @type {AuthResults} */
  const out = { authservId: '', version: '', none: false, results: [], unparsed: [] };
  const [head = [], ...rest] = parts;
  const words = head.filter((token) => token.type !== 'comment');
  const resultParts = [...rest];
  if (words.some((token) => isSpecial(token, '='))) {
    // Microsoft's form: no authserv-id, the first part is already a result.
    resultParts.unshift(head);
  } else if (words.length) {
    out.authservId = words[0].text.toLowerCase();
    if (words[1] && /^\d+$/.test(words[1].text)) out.version = words[1].text;
    const extra = words.slice(out.version ? 2 : 1);
    if (extra.length) out.unparsed.push(textOf(value, extra));
  }
  for (const part of resultParts) {
    STEPS.count += 1;
    const words = part.filter((token) => token.type !== 'comment');
    if (words.length === 0) continue;
    if (words.length === 1 && words[0].text.toLowerCase() === 'none') {
      out.none = true;
      continue;
    }
    const result = out.results.length < MAX_RESULTS ? readResult(part) : null;
    if (result) out.results.push(result);
    else out.unparsed.push(textOf(value, part));
  }
  return out;
}

/**
 * Reads an Authentication-Results value (RFC 8601 §2.2), and the forms real servers write: comments anywhere,
 * Microsoft's results without an authserv-id, bare names between results, quoted reasons.
 * @param {string} value
 * @returns {AuthResults}
 */
export function parseAuthResults(value) {
  return readAuthParts(value, splitTokens(tokenize(value, ';=/'), ';'));
}

/* ---------- Received-SPF ---------- */

/**
 * Reads a Received-SPF value (RFC 7208 §9.1): the result, the comment, and the key=value pairs.
 * @param {string} value
 * @returns {{ result: string, comment: string, pairs: Record<string, string> }}
 */
export function parseReceivedSpf(value) {
  const tokens = tokenize(value, ';=');
  const comment = tokens.find((token) => token.type === 'comment')?.text ?? '';
  const first = tokens.findIndex((token) => token.type !== 'comment');
  const result = tokens[first]?.type === 'atom' ? tokens[first].text.toLowerCase() : '';
  /** @type {Record<string, string>} */
  const pairs = {};
  let k = first + 1;
  while (first !== -1 && k < tokens.length) {
    STEPS.count += 1;
    const [key, equals, start] = [tokens[k], tokens[k + 1], tokens[k + 2]];
    if (key.type === 'atom' && equals && isSpecial(equals, '=') && start && start.type !== 'comment' && start.type !== 'special') {
      const { text, next } = gluedValue(tokens, k + 2);
      const name = key.text.toLowerCase();
      if (!(name in pairs) && Object.keys(pairs).length < MAX_PAIRS) pairs[name] = text;
      k = next;
      continue;
    }
    k += 1;
  }
  return { result, comment, pairs };
}

/* ---------- DKIM signatures and ARC ---------- */

/**
 * @typedef {object} TagList
 * @property {Record<string, string>} tags  Lowercase names; values without white space. The first of a repeated tag.
 * @property {boolean} repeated  A tag appears twice (RFC 6376 §3.2: the signature is then invalid).
 */

/**
 * Reads a DKIM-style tag list: "v=1; a=rsa-sha256; d=example.com; …" (RFC 6376 §3.2).
 * @param {string} value
 * @returns {TagList}
 */
export function parseTagList(value) {
  /** @type {Record<string, string>} */
  const tags = {};
  let repeated = false;
  let count = 0;
  for (const part of value.split(';')) {
    STEPS.count += 1;
    const equals = part.indexOf('=');
    if (equals === -1) continue;
    const name = part.slice(0, equals).trim().toLowerCase();
    if (!/^[a-z][a-z0-9_]*$/.test(name)) continue;
    if (name in tags) {
      repeated = true;
      continue;
    }
    if (count >= MAX_TAGS) break;
    tags[name] = part.slice(equals + 1).replace(/[ \t\r\n]+/g, '');
    count += 1;
  }
  return { tags, repeated };
}

/**
 * @typedef {object} DkimSignature
 * @property {string} domain  d=, lowercase.
 * @property {string} selector  s=
 * @property {string} algorithm  a=, lowercase.
 * @property {number | null} length  l= (body length counted by the signature), or null.
 * @property {number | null} signedAt  t= in milliseconds, or null.
 * @property {number | null} expires  x= in milliseconds, or null.
 * @property {string[]} headers  h=, lowercase.
 * @property {boolean} repeated
 * @property {Record<string, string>} tags
 */

/** @param {string | undefined} text */
const seconds = (text) => (text && /^\d{1,12}$/.test(text) ? Number(text) * 1000 : null);

/**
 * Reads a DKIM-Signature or ARC-Message-Signature value.
 * @param {string} value
 * @returns {DkimSignature}
 */
export function parseDkimSignature(value) {
  const { tags, repeated } = parseTagList(value);
  return {
    domain: (tags.d ?? '').toLowerCase(),
    selector: tags.s ?? '',
    algorithm: (tags.a ?? '').toLowerCase(),
    length: tags.l !== undefined && /^\d{1,76}$/.test(tags.l) ? Number(tags.l) : null,
    signedAt: seconds(tags.t),
    expires: seconds(tags.x),
    headers: tags.h ? tags.h.split(':').map((name) => name.toLowerCase()).filter(Boolean) : [],
    repeated,
    tags,
  };
}

/**
 * @typedef {object} ArcSet
 * @property {number} instance  i=, 1 to 50; the highest is the newest.
 * @property {TagList | null} seal  ARC-Seal.
 * @property {DkimSignature | null} signature  ARC-Message-Signature.
 * @property {AuthResults | null} results  ARC-Authentication-Results.
 * @property {string} cv  The seal's chain validation: "none", "pass", "fail", or "" when absent.
 * @property {number} index  Position of the set's topmost field.
 */

/**
 * The instance of an ARC-Authentication-Results value and its results.
 * @param {string} value
 * @returns {{ instance: number, results: AuthResults } | null}
 */
export function parseArcResults(value) {
  const parts = splitTokens(tokenize(value, ';=/'), ';');
  const words = parts[0].filter((token) => token.type !== 'comment');
  if (words.length !== 3 || words[0].text.toLowerCase() !== 'i' || !isSpecial(words[1], '=') || !/^\d{1,2}$/.test(words[2].text)) return null;
  return { instance: Number(words[2].text), results: readAuthParts(value, parts.slice(1)) };
}

/**
 * Groups the ARC fields into sets by instance, newest first. Fields with an instance outside 1–50 are counted, not used.
 * @param {import('./mail-parse.mjs').Field[]} fields
 * @returns {{ sets: ArcSet[], invalid: number }}
 */
export function parseArcSets(fields) {
  /** @type {Map<number, ArcSet>} */
  const sets = new Map();
  let invalid = 0;
  /** @param {number} instance @param {number} index */
  const setFor = (instance, index) => {
    const set = sets.get(instance) ?? { instance, seal: null, signature: null, results: null, cv: '', index };
    set.index = Math.min(set.index, index);
    sets.set(instance, set);
    return set;
  };
  for (const field of fields) {
    STEPS.count += 1;
    if (field.key === 'arc-authentication-results') {
      const read = parseArcResults(field.value);
      if (!read || read.instance < 1 || read.instance > MAX_ARC) {
        invalid += 1;
        continue;
      }
      const set = setFor(read.instance, field.index);
      set.results ??= read.results;
    } else if (field.key === 'arc-seal' || field.key === 'arc-message-signature') {
      const list = parseTagList(field.value);
      const instance = /^\d{1,2}$/.test(list.tags.i ?? '') ? Number(list.tags.i) : 0;
      if (instance < 1 || instance > MAX_ARC) {
        invalid += 1;
        continue;
      }
      const set = setFor(instance, field.index);
      if (field.key === 'arc-seal') {
        set.seal ??= list;
        set.cv ||= (list.tags.cv ?? '').toLowerCase();
      } else {
        set.signature ??= parseDkimSignature(field.value);
      }
    }
  }
  return { sets: [...sets.values()].sort((a, b) => b.instance - a.instance), invalid };
}

/* ---------- Received ---------- */

/**
 * Protocol types for "with" (IANA Mail Parameters, updated 2025-09-19): S means STARTTLS, A means AUTH.
 * @type {Record<string, { tls: boolean, auth: boolean }>}
 */
const PROTOCOLS = {
  SMTP: { tls: false, auth: false }, ESMTP: { tls: false, auth: false }, ESMTPA: { tls: false, auth: true }, ESMTPS: { tls: true, auth: false }, ESMTPSA: { tls: true, auth: true },
  LMTP: { tls: false, auth: false }, LMTPA: { tls: false, auth: true }, LMTPS: { tls: true, auth: false }, LMTPSA: { tls: true, auth: true }, MMS: { tls: false, auth: false },
  UTF8SMTP: { tls: false, auth: false }, UTF8SMTPA: { tls: false, auth: true }, UTF8SMTPS: { tls: true, auth: false }, UTF8SMTPSA: { tls: true, auth: true },
  UTF8LMTP: { tls: false, auth: false }, UTF8LMTPA: { tls: false, auth: true }, UTF8LMTPS: { tls: true, auth: false }, UTF8LMTPSA: { tls: true, auth: true },
};

const CLAUSES = /** @type {const} */ (['from', 'by', 'via', 'with', 'id', 'for']);

/**
 * @typedef {object} Received
 * @property {string} from  The name the sending side gave (HELO), as written.
 * @property {string} fromAddress  The address the receiving server saw, as written (from the "(name [address])" part,
 *   or a "from [address]" literal); "" when none.
 * @property {import('./ip.mjs').Ip | null} ip  That address, when it is a valid IP address.
 * @property {string} reverse  The name the receiving server looked up for that address ("" when none).
 * @property {string} by  The server that wrote this line.
 * @property {string} via
 * @property {string} with  As written, e.g. "ESMTPS" or "Microsoft SMTPSVC".
 * @property {string} protocol  The first word of "with", uppercase.
 * @property {boolean | null} tls  STARTTLS by the registered protocol name; null when the name isn't registered.
 * @property {boolean | null} auth  The sender signed in, by the registered protocol name; null when not registered.
 * @property {string} id
 * @property {string} for
 * @property {number | null} date  Milliseconds, or null.
 * @property {string} dateText
 * @property {string[]} comments  Every comment, as written.
 * @property {string} extra  Text before the first clause or repeated clauses, as written.
 */

/**
 * The sending address and its looked-up name from a comment like "(mail.example.net [192.0.2.1])".
 * @param {string} comment
 */
function tcpInfo(comment) {
  const open = comment.indexOf('[');
  const close = open === -1 ? -1 : comment.indexOf(']', open);
  if (close === -1) {
    // Microsoft 365 writes the address without brackets: "(192.0.2.25)" (review E17).
    const words = comment.trim().split(/\s+/);
    const last = words[words.length - 1] ?? '';
    return parseIp(last) ? { address: last, reverse: words.length > 1 ? words[0].replace(/\.$/, '') : '' } : null;
  }
  const before = comment.slice(0, open).trim().split(/\s+/)[0] ?? '';
  return { address: comment.slice(open + 1, close).trim(), reverse: before.replace(/\.$/, '') };
}

/**
 * Reads a Received value: "from … by … via … with … id … for …; date" (RFC 5321 §4.4, RFC 5322 §3.6.7), keeping
 * what servers add freely.
 * @param {string} value
 * @returns {Received}
 */
export function parseReceived(value) {
  const tokens = tokenize(value, ';');
  let semi = -1;
  for (let k = tokens.length - 1; k >= 0; k -= 1) {
    if (isSpecial(tokens[k], ';')) {
      semi = k;
      break;
    }
  }
  const dateText = semi === -1 ? '' : value.slice(tokens[semi].end).trim();
  const clauseTokens = semi === -1 ? tokens : tokens.slice(0, semi);
  /** @type {Record<string, { words: string[], comments: string[] }>} */
  const clauses = {};
  /** @type {string[]} */
  const extra = [];
  /** @type {{ words: string[], comments: string[] } | null} */
  let current = null;
  /** @type {string[]} */
  const comments = [];
  clauseTokens.forEach((token, k) => {
    STEPS.count += 1;
    if (token.type === 'comment') {
      comments.push(token.text);
      current?.comments.push(token.text);
      return;
    }
    const word = token.text.toLowerCase();
    const starts = token.type === 'atom' && /** @type {readonly string[]} */ (CLAUSES).includes(word) && (k === 0 || token.space || clauseTokens[k - 1].type === 'comment');
    if (starts && !(word in clauses)) {
      current = { words: [], comments: [] };
      clauses[word] = current;
      return;
    }
    if (current) current.words.push(token.text);
    else extra.push(token.text);
  });
  /** @param {string} name */
  const words = (name) => clauses[name]?.words.join(' ') ?? '';

  const from = words('from');
  const info = (clauses.from?.comments ?? []).map(tcpInfo).find(Boolean) ?? null;
  const literal = /^\[.*\]$/.test(from) ? from.slice(1, -1) : '';
  const fromAddress = info?.address || literal;
  const withText = words('with');
  const protocol = (withText.split(' ')[0] ?? '').toUpperCase();
  const known = PROTOCOLS[protocol];
  return {
    from,
    fromAddress,
    ip: fromAddress ? parseIp(fromAddress) : null,
    reverse: info?.reverse ?? '',
    by: words('by'),
    via: words('via'),
    with: withText,
    protocol,
    // Microsoft names no registered protocol but writes the TLS version it used: "(version=TLS1_2, cipher=…)" (review E28).
    tls: known ? known.tls : (clauses.with?.comments ?? []).some((comment) => /\bversion=TLS1_[0-3]\b/i.test(comment)) ? true : null,
    auth: known ? known.auth : null,
    id: words('id'),
    for: words('for'),
    date: dateText ? parseDate(dateText) : null,
    dateText,
    comments,
    extra: extra.join(' '),
  };
}

/* ---------- Spam filters' fields ---------- */

/**
 * Reads "KEY:value;KEY:value" pairs, as in Microsoft's X-Forefront-Antispam-Report and X-Microsoft-Antispam.
 * @param {string} value
 * @returns {Record<string, string>}  Uppercase keys; the first of a repeated key.
 */
export function parsePairs(value) {
  /** @type {Record<string, string>} */
  const pairs = {};
  let count = 0;
  for (const part of value.split(';')) {
    STEPS.count += 1;
    const colon = part.indexOf(':');
    if (colon < 1) continue;
    const key = part.slice(0, colon).trim().toUpperCase();
    if (!/^[A-Z][A-Z0-9-]*$/.test(key) || key in pairs) continue;
    if (count >= MAX_PAIRS) break;
    pairs[key] = part.slice(colon + 1).trim();
    count += 1;
  }
  return pairs;
}

/**
 * Reads SpamAssassin's X-Spam-Status: "Yes, score=6.1 required=5.0 tests=A,B autolearn=no version=4.0.0".
 * @param {string} value
 * @returns {{ spam: boolean | null, score: number | null, required: number | null, tests: string[] }}
 */
export function parseSpamStatus(value) {
  const comma = value.indexOf(',');
  const first = (comma === -1 ? value : value.slice(0, comma)).trim().toLowerCase();
  const spam = first === 'yes' ? true : first === 'no' ? false : null;
  /** @type {Record<string, string>} */
  const pairs = {};
  let last = '';
  for (const word of (comma === -1 ? '' : value.slice(comma + 1)).split(/[ \t\r\n]+/)) {
    STEPS.count += 1;
    const equals = word.indexOf('=');
    if (equals > 0 && /^[a-z]+$/i.test(word.slice(0, equals))) {
      last = word.slice(0, equals).toLowerCase();
      pairs[last] ??= word.slice(equals + 1);
    } else if (last === 'tests' && word) {
      pairs.tests += word;
    }
  }
  /** @param {string | undefined} text */
  const number = (text) => (text && /^-?\d+(\.\d+)?$/.test(text) ? Number(text) : null);
  return { spam, score: number(pairs.score), required: number(pairs.required), tests: (pairs.tests ?? '').split(',').filter(Boolean).slice(0, MAX_PAIRS) };
}

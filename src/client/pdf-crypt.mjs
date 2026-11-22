// @ts-check
/**
 * @file The standard security handler, revisions 2 to 4 (ISO 32000-1 §7.6; plan docs/tools-plan/pdf-toolkit.md §6.6):
 * reading the encryption dictionary, checking a password (Algorithms 2 and 5 to 7) and decrypting strings and
 * streams (Algorithm 1). Only to open a file: nothing here writes encryption. Revisions 5 and 6 (AES-256, ISO
 * 32000-2) and other handlers are refused with their own error codes.
 */
import { md5 } from './md5.mjs';
import { rc4 } from './rc4.mjs';
import { PdfDict, PdfError, PdfName, PdfString } from './pdf-syntax.mjs';

/** Algorithm 2 step a: what pads a password to 32 bytes. */
export const PADDING = Uint8Array.of(
  0x28, 0xbf, 0x4e, 0x5e, 0x4e, 0x75, 0x8a, 0x41, 0x64, 0x00, 0x4e, 0x56, 0xff, 0xfa, 0x01, 0x08,
  0x2e, 0x2e, 0x00, 0xb6, 0xd0, 0x68, 0x3e, 0x80, 0x2f, 0x0c, 0xa9, 0xfe, 0x64, 0x53, 0x69, 0x7a,
);

/**
 * How one kind of data is encrypted. `none` is the Identity crypt filter (§7.6.5).
 * @typedef {'none' | 'rc4' | 'aes'} Method
 * @typedef {{ revision: 2 | 3 | 4, length: number, o: Uint8Array, u: Uint8Array, p: number, id: Uint8Array,
 *   encryptMetadata: boolean, strings: Method, streams: Method, filters: Map<string, Method>, restricted: boolean,
 *   lengthGiven: boolean }}
 *   Security  `length` is the key length in bytes; `filters` are the named crypt filters of a V 4 dictionary.
 */

/** Permission bits that mean something is restricted (Table 22): print, modify, copy, annotate, fill, extract, assemble, print well. */
const PERMISSIONS = [3, 4, 5, 6, 9, 10, 11, 12].reduce((mask, bit) => mask | (1 << (bit - 1)), 0);

/**
 * The encryption dictionary read and checked.
 * @param {import('./pdf-syntax.mjs').PdfObject} encrypt  The trailer's /Encrypt, resolved.
 * @param {import('./pdf-syntax.mjs').PdfObject} id  The trailer's /ID, resolved.
 * @param {(value: import('./pdf-syntax.mjs').PdfObject | undefined) => import('./pdf-syntax.mjs').PdfObject} resolve
 * @returns {Security}
 * @throws {PdfError}  `lockedHandler` for a handler other than the standard one, `lockedRevision` for revisions 5 and 6
 *   (and the unpublished V 3), `damaged` for a dictionary that cannot be used.
 */
export function readSecurity(encrypt, id, resolve) {
  if (!(encrypt instanceof PdfDict)) throw new PdfError('damaged', 'encryption dictionary is not a dictionary');
  const filter = resolve(encrypt.get('Filter'));
  if (!(filter instanceof PdfName) || filter.value !== 'Standard') {
    throw new PdfError('lockedHandler', `security handler ${filter instanceof PdfName ? filter.value : '(none)'}`);
  }
  const v = numberOf(resolve(encrypt.get('V')), 0);
  const r = numberOf(resolve(encrypt.get('R')), 0);
  if (r >= 5 || v >= 5) throw new PdfError('lockedRevision', `standard handler R ${r} V ${v}`);
  if (![1, 2, 4].includes(v) || ![2, 3, 4].includes(r)) throw new PdfError('lockedRevision', `standard handler R ${r} V ${v}`);
  const o = bytesOf(resolve(encrypt.get('O')));
  const u = bytesOf(resolve(encrypt.get('U')));
  if (!o || !u || o.length < 32 || u.length < 32) throw new PdfError('damaged', 'encryption dictionary has no usable O or U');
  const first = Array.isArray(id) ? bytesOf(resolve(id[0])) : null;
  // Table 20: Length is in bits, a multiple of 8 from 40 to 128; V 1 is always 40.
  // V 4 keys are 128 bits in practice (AESV2 needs them); qpdf writes Length 128 there.
  const declared = resolve(encrypt.get('Length'));
  const bits = v === 1 ? 40 : numberOf(declared, v === 4 ? 128 : 40);
  if (bits % 8 !== 0 || bits < 40 || bits > 128) throw new PdfError('damaged', `key length ${bits}`);
  const p = numberOf(resolve(encrypt.get('P')), -1) | 0;
  /** @type {Map<string, Method>} */
  const filters = new Map();
  let strings = /** @type {Method} */ ('rc4');
  let streams = /** @type {Method} */ ('rc4');
  if (v === 4) {
    const cf = resolve(encrypt.get('CF'));
    if (cf instanceof PdfDict) {
      for (const [name, value] of cf.entries()) filters.set(name, methodOf(resolve(value), resolve));
    }
    strings = namedMethod(resolve(encrypt.get('StrF')), filters);
    streams = namedMethod(resolve(encrypt.get('StmF')), filters);
  }
  return {
    revision: /** @type {2 | 3 | 4} */ (r),
    length: r === 2 ? 5 : bits / 8,
    o: o.subarray(0, 32),
    u: u.subarray(0, 32),
    p,
    id: first ?? new Uint8Array(0),
    encryptMetadata: r === 4 ? resolve(encrypt.get('EncryptMetadata')) !== false : true,
    strings,
    streams,
    filters,
    restricted: (p & PERMISSIONS) !== PERMISSIONS,
    lengthGiven: v === 1 || typeof declared === 'number',
  };
}

/**
 * The file's key for a password, trying it as the user password (Algorithm 6) and then as the owner password
 * (Algorithm 7); null when it is neither. When the dictionary gives no key length, 128 bits is tried after the
 * default of 40, as qpdf manages to (qpdf corpus: bad-encryption-length.pdf).
 * @param {Security} security
 * @param {Uint8Array} password  The password's bytes (§7.6.3.3: PDFDocEncoding for these revisions).
 * @returns {Uint8Array | null}
 */
export function authenticate(security, password) {
  const lengths = security.lengthGiven || security.revision === 2 ? [security.length] : [security.length, 16];
  for (const length of lengths) {
    const tried = { ...security, length };
    const key = userKey(tried, password) ?? userKey(tried, ownerToUser(tried, password));
    if (key) return key;
  }
  return null;
}

/**
 * The password bytes to try for what was typed: Latin-1 when every character fits, then UTF-8 (some writers use it).
 * @param {string} text
 * @returns {Uint8Array[]}
 */
export function passwordBytes(text) {
  const utf8 = new TextEncoder().encode(text);
  if ([...text].some((c) => /** @type {number} */ (c.codePointAt(0)) > 0xff)) return [utf8];
  const latin = Uint8Array.from(text, (c) => c.charCodeAt(0));
  return latin.length === utf8.length ? [latin] : [latin, utf8];
}

/**
 * Algorithm 1: the key for one object, and the method that applies to it.
 * @param {Uint8Array} fileKey
 * @param {number} num
 * @param {number} gen
 * @param {Method} method
 */
export function objectKey(fileKey, num, gen, method) {
  const salt = method === 'aes' ? [0x73, 0x41, 0x6c, 0x54] : [];
  const input = Uint8Array.of(
    ...fileKey,
    num & 0xff,
    (num >> 8) & 0xff,
    (num >> 16) & 0xff,
    gen & 0xff,
    (gen >> 8) & 0xff,
    ...salt,
  );
  return md5(input).subarray(0, Math.min(fileKey.length + 5, 16));
}

/**
 * Decrypts one string or stream's data (Algorithm 1). AES data is the 16-byte IV, then CBC blocks with the
 * padding of §7.6.2; data that is too short or badly padded comes back as far as it can be read, never as an error,
 * because some writers get the padding wrong.
 * @param {Uint8Array} key  The object's key from objectKey.
 * @param {Method} method
 * @param {Uint8Array} data
 * @returns {Promise<Uint8Array>}
 */
export async function decrypt(key, method, data) {
  if (method === 'none') return data;
  if (method === 'rc4') return rc4(key, data);
  if (data.length < 32) return new Uint8Array(0); // an IV and no whole block: nothing to read
  const whole = data.length - ((data.length - 16) % 16);
  const iv = data.slice(0, 16);
  const body = data.slice(16, whole);
  const aes = await crypto.subtle.importKey('raw', /** @type {Uint8Array<ArrayBuffer>} */ (key.slice()), 'AES-CBC', false, ['encrypt', 'decrypt']);
  const plain = await crypto.subtle.decrypt({ name: 'AES-CBC', iv }, aes, body).then(
    (buffer) => new Uint8Array(buffer),
    // Web Crypto insists on PKCS#7 padding (W3C Web Crypto §28), and some writers get the PDF's (the same rule) wrong.
    // One extra block that decrypts to a whole block of padding makes it accept any data; whatever padding the data
    // has is then taken off below, leniently.
    () => decryptUnpadded(aes, iv, body),
  );
  if (plain.length !== body.length) return plain; // Web Crypto took the padding off
  const pad = plain[plain.length - 1];
  const padded = pad >= 1 && pad <= 16 && plain.subarray(plain.length - pad).every((b) => b === pad);
  return padded ? plain.subarray(0, plain.length - pad) : plain;
}

/**
 * AES-CBC decryption of whole blocks whatever their padding: the plain text, padding included.
 * @param {CryptoKey} aes @param {Uint8Array<ArrayBuffer>} iv @param {Uint8Array<ArrayBuffer>} body
 */
async function decryptUnpadded(aes, iv, body) {
  const last = body.subarray(body.length - 16);
  const extra = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-CBC', iv: last }, aes, new Uint8Array(16).fill(16))).subarray(0, 16);
  const joined = new Uint8Array(body.length + 16);
  joined.set(body);
  joined.set(extra, body.length);
  return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-CBC', iv }, aes, joined));
}

/* ---------- Algorithms 2, 3, 5, 6 and 7 ---------- */

/** @param {Uint8Array} password */
function padded(password) {
  const out = new Uint8Array(32);
  const used = password.subarray(0, 32);
  out.set(used);
  out.set(PADDING.subarray(0, 32 - used.length), used.length);
  return out;
}

/**
 * Algorithm 2: the file key for a user password.
 * @param {Security} security @param {Uint8Array} password
 */
function fileKey(security, password) {
  const p = new Uint8Array(4);
  new DataView(p.buffer).setUint32(0, security.p >>> 0, true);
  const parts = [padded(password), security.o, p, security.id];
  if (security.revision >= 4 && !security.encryptMetadata) parts.push(Uint8Array.of(0xff, 0xff, 0xff, 0xff));
  let hash = md5(concat(parts));
  if (security.revision >= 3) for (let i = 0; i < 50; i += 1) hash = md5(hash.subarray(0, security.length));
  return hash.slice(0, security.length);
}

/**
 * Algorithm 6: the key when the password is the user password, otherwise null.
 * @param {Security} security @param {Uint8Array} password
 */
function userKey(security, password) {
  const key = fileKey(security, password);
  if (security.revision === 2) return equal(rc4(key, PADDING), security.u) ? key : null;
  let value = rc4(key, md5(concat([PADDING, security.id])));
  for (let i = 1; i <= 19; i += 1) value = rc4(key.map((b) => b ^ i), value);
  return equal(value, security.u.subarray(0, 16)) ? key : null;
}

/**
 * Algorithm 7 steps a to c: the user password the O entry hides, if this is the owner password (Algorithm 3 a–d for the key).
 * @param {Security} security @param {Uint8Array} password
 */
function ownerToUser(security, password) {
  let hash = md5(padded(password));
  if (security.revision >= 3) for (let i = 0; i < 50; i += 1) hash = md5(hash);
  const key = hash.subarray(0, security.length);
  if (security.revision === 2) return rc4(key, security.o);
  let value = security.o;
  for (let i = 19; i >= 0; i -= 1) value = rc4(key.map((b) => b ^ i), value);
  return value;
}

/* ---------- Helpers ---------- */

/** @param {import('./pdf-syntax.mjs').PdfObject} value @param {Map<string, Method>} filters @returns {Method} */
function namedMethod(value, filters) {
  if (!(value instanceof PdfName) || value.value === 'Identity') return 'none';
  const method = filters.get(value.value);
  if (!method) throw new PdfError('damaged', `crypt filter ${value.value} is not defined`);
  return method;
}

/**
 * A crypt filter dictionary's method (Table 25).
 * @param {import('./pdf-syntax.mjs').PdfObject} value
 * @param {(value: import('./pdf-syntax.mjs').PdfObject | undefined) => import('./pdf-syntax.mjs').PdfObject} resolve
 * @returns {Method}
 */
function methodOf(value, resolve) {
  const cfm = value instanceof PdfDict ? resolve(value.get('CFM')) : null;
  const name = cfm instanceof PdfName ? cfm.value : 'None';
  if (name === 'None') return 'none';
  if (name === 'V2') return 'rc4';
  if (name === 'AESV2') return 'aes';
  if (name === 'AESV3') throw new PdfError('lockedRevision', 'crypt filter AESV3');
  throw new PdfError('lockedHandler', `crypt filter method ${name}`);
}

/** @param {import('./pdf-syntax.mjs').PdfObject} value @param {number} fallback */
const numberOf = (value, fallback) => (typeof value === 'number' && Number.isFinite(value) ? value : fallback);

/** @param {import('./pdf-syntax.mjs').PdfObject} value */
const bytesOf = (value) => (value instanceof PdfString ? value.bytes : null);

/** @param {Uint8Array[]} parts */
function concat(parts) {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

/** @param {Uint8Array} a @param {Uint8Array} b */
const equal = (a, b) => a.length === b.length && a.every((byte, i) => byte === b[i]);

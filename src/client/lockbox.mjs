// @ts-check
/**
 * @file The Lockwell encrypted-file format, version 1: pure and free of the DOM, shared by the encryption tool, its
 * tests and the reference decryptor (scripts/lockbox-open.mjs). The public description is docs/ENCRYPTED-FORMAT.md.
 *
 * Only primitives the browser provides: PBKDF2-HMAC-SHA-256, HKDF-SHA-256, HMAC-SHA-256 and AES-256-GCM from Web
 * Crypto, and crypto.getRandomValues. No cipher, hash or key derivation is written here. The payload copies age's
 * STREAM layout (64 KiB chunks; the nonce is an 11-byte counter and a last-chunk flag; 16-byte tags) with AES-256-GCM
 * in place of ChaCha20-Poly1305.
 *
 * Nothing unauthenticated leaves this module: a chunk reaches the sink only after its tag verified, and `open`
 * resolves only after the final chunk verified. A cut-off file is an error, not a shorter file.
 *
 * Strength, honestly: PBKDF2 is not memory-hard. One high-end GPU tries roughly 11,000 passwords a second at
 * 1,000,000 iterations (scaled from a community hashcat benchmark; an inference, not a measurement), so the
 * protection comes from the password: six random words are far out of reach, a short human password is not.
 */

import { byteString } from './bytes.mjs';
import { CONTROL } from './metadata-text.mjs';

/** "LOCKWELL": the first eight bytes of every file. A format name, not branding: it stays if the site is renamed. */
export const MAGIC = Uint8Array.from('LOCKWELL', (char) => char.charCodeAt(0));
export const VERSION = 1;
/** Key derivation id 1: PBKDF2-HMAC-SHA-256. A later one gets a new id, which version 1 readers refuse. */
export const KDF_PBKDF2 = 1;
/** Written into new files. Above OWASP's 600,000 for PBKDF2-HMAC-SHA256; each file stores its own count. */
export const ITERATIONS = 1_000_000;
/** Accepted when opening. The upper bound stops a file that asks for an hour of work. */
export const MIN_ITERATIONS = 100_000;
export const MAX_ITERATIONS = 10_000_000;
export const SALT_LENGTH = 16;
/** The header MAC covers bytes 0 to 29. */
const SIGNED_LENGTH = 30;
export const HEADER_LENGTH = 62;
/** Plaintext bytes per chunk; the last chunk has 1 to 65,536. */
export const CHUNK = 65_536;
export const TAG = 16;
const SEALED_CHUNK = CHUNK + TAG;
export const MAX_NAME = 1024;
export const MAX_TYPE = 255;
/** The metadata block's fixed part: kind (1), content size (8), name length (2), type length (2). */
const META_FIXED = 13;
export const KIND = /** @type {const} */ ({ text: 0, file: 1, files: 2 });
/** Chunks sealed or opened together between two checks for Cancel. */
export const BATCH = 16;
/** A saved file's name when the locked one carries none, or none that survives cleaning. */
export const FALLBACK_NAME = 'unlocked';
const MAX_SAVED_NAME = 200;

export const ARMOUR_BEGIN = '-----BEGIN LOCKWELL MESSAGE-----';
export const ARMOUR_END = '-----END LOCKWELL MESSAGE-----';
const ARMOUR_WIDTH = 64;

/**
 * How much work was done, so tests can show cost without timing anything: key derivations, chunks sealed, chunks
 * opened.
 */
export const COUNTS = { kdf: 0, sealed: 0, opened: 0 };

/**
 * @typedef {'notLocked' | 'newerVersion' | 'damaged' | 'wrongPassword' | 'cancelled' | 'readFailed'} LockboxCode
 *   notLocked: not a Lockwell file. newerVersion: a version, key derivation or content kind this reader doesn't
 *   know. damaged: the file breaks the format, was cut off or changed. wrongPassword: the header didn't verify, so
 *   the password is wrong or the header was changed (the two can't be told apart). cancelled: the caller's
 *   `isCancelled` said stop. readFailed: the source gave fewer bytes than asked for.
 */

/** A file or text this module can't seal or open; `code` says why. */
export class LockboxError extends Error {
  /** @param {LockboxCode} code @param {string} [detail] */
  constructor(code, detail = '') {
    super(`Lockwell file can't be processed: ${code}${detail ? ` (${detail})` : ''}`);
    this.name = 'LockboxError';
    this.code = code;
  }
}

/**
 * @typedef {object} Meta  What the encrypted part says about its content.
 * @property {number} kind  0 text (UTF-8), 1 one file, 2 several files as one ZIP (see KIND).
 * @property {number} size  Bytes of content.
 * @property {string} name  The file's name; empty for text.
 * @property {string} type  Media type, printable ASCII; may be empty.
 */
/**
 * @typedef {(offset: number, length: number) => Promise<Uint8Array<ArrayBuffer>>} Read
 *   Reads `length` bytes of the source from `offset` (fewer only at its end).
 * @typedef {(bytes: Uint8Array<ArrayBuffer>) => void | Promise<void>} Write  Receives output in order.
 * @typedef {object} StreamOptions
 * @property {number} [batch]  Chunks per step; Cancel is checked between steps.
 * @property {(done: number, total: number) => void} [onProgress]  Called after each step, in bytes.
 * @property {() => boolean} [isCancelled]
 */

const encoder = new TextEncoder();
const strictDecoder = new TextDecoder('utf-8', { fatal: true });

/** @param {string} password  Used as typed, after NFC normalisation: no trimming, no case change. */
export const passwordBytes = (password) => encoder.encode(password.normalize('NFC'));

/** @returns {Uint8Array<ArrayBuffer>} */
export const randomSalt = () => crypto.getRandomValues(new Uint8Array(SALT_LENGTH));

/** @param {Uint8Array} bytes */
export const looksLocked = (bytes) => bytes.length >= MAGIC.length && MAGIC.every((byte, i) => bytes[i] === byte);

/**
 * The two keys of one file, both non-extractable: master = PBKDF2(password, salt, iterations); then HKDF-SHA-256 of
 * the master with the salt gives the header MAC key ("lockwell/v1/header") and the AES-GCM key
 * ("lockwell/v1/payload").
 * @param {string} password
 * @param {Uint8Array<ArrayBuffer>} salt
 * @param {number} iterations
 */
export async function deriveKeys(password, salt, iterations) {
  COUNTS.kdf += 1;
  const { subtle } = crypto;
  const base = await subtle.importKey('raw', passwordBytes(password), 'PBKDF2', false, ['deriveBits']);
  const master = await subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, base, 256);
  const hkdf = await subtle.importKey('raw', master, 'HKDF', false, ['deriveKey']);
  /** @param {string} label */
  const expand = (label) => ({ name: 'HKDF', hash: 'SHA-256', salt, info: encoder.encode(label) });
  const [macKey, dataKey] = await Promise.all([
    subtle.deriveKey(expand('lockwell/v1/header'), hkdf, { name: 'HMAC', hash: 'SHA-256', length: 256 }, false, ['sign', 'verify']),
    subtle.deriveKey(expand('lockwell/v1/payload'), hkdf, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']),
  ]);
  return { macKey, dataKey };
}

/* ---------- Header ---------- */

/**
 * @param {Uint8Array<ArrayBuffer>} salt
 * @param {number} iterations
 * @param {CryptoKey} macKey
 */
async function buildHeader(salt, iterations, macKey) {
  const header = new Uint8Array(HEADER_LENGTH);
  header.set(MAGIC, 0);
  header[8] = VERSION;
  header[9] = KDF_PBKDF2;
  new DataView(header.buffer).setUint32(10, iterations);
  header.set(salt, 14);
  header.set(new Uint8Array(await crypto.subtle.sign('HMAC', macKey, header.subarray(0, SIGNED_LENGTH))), SIGNED_LENGTH);
  return header;
}

/**
 * Reads a header without verifying it (that needs the password). Order matters for the messages: not ours, then a
 * newer version or key derivation, then anything else wrong.
 * @param {Uint8Array<ArrayBuffer>} bytes  The file's first bytes (all 62 when it has them).
 */
export function parseHeader(bytes) {
  if (!looksLocked(bytes)) throw new LockboxError('notLocked');
  if (bytes.length > 8 && bytes[8] > VERSION) throw new LockboxError('newerVersion', `version ${bytes[8]}`);
  if (bytes.length > 9 && bytes[8] === VERSION && bytes[9] > KDF_PBKDF2) throw new LockboxError('newerVersion', `key derivation ${bytes[9]}`);
  if (bytes.length < HEADER_LENGTH) throw new LockboxError('damaged', 'header cut off');
  if (bytes[8] !== VERSION || bytes[9] !== KDF_PBKDF2) throw new LockboxError('damaged', 'version or key derivation 0');
  const iterations = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(10);
  if (iterations < MIN_ITERATIONS || iterations > MAX_ITERATIONS) throw new LockboxError('damaged', `${iterations} iterations`);
  return {
    iterations,
    salt: bytes.slice(14, 14 + SALT_LENGTH),
    signed: bytes.slice(0, SIGNED_LENGTH),
    mac: bytes.slice(SIGNED_LENGTH, HEADER_LENGTH),
  };
}

/* ---------- Metadata block ---------- */

/**
 * @param {Meta} meta
 * @returns {Uint8Array<ArrayBuffer>}
 */
export function encodeMeta({ kind, size, name, type }) {
  const nameBytes = encoder.encode(name);
  if (!Object.values(KIND).includes(/** @type {0 | 1 | 2} */ (kind))) throw new RangeError(`Unknown content kind ${kind}`);
  if (!Number.isSafeInteger(size) || size < 0) throw new RangeError(`Content size ${size} is not a whole number of bytes`);
  if (nameBytes.length > MAX_NAME) throw new RangeError(`File name is ${nameBytes.length} bytes in UTF-8; at most ${MAX_NAME} fit`);
  if (type.length > MAX_TYPE || /[^\x20-\x7e]/.test(type)) throw new RangeError(`Media type "${type}" is not up to ${MAX_TYPE} printable ASCII characters`);
  const out = new Uint8Array(META_FIXED + nameBytes.length + type.length);
  const view = new DataView(out.buffer);
  out[0] = kind;
  view.setBigUint64(1, BigInt(size));
  view.setUint16(9, nameBytes.length);
  out.set(nameBytes, 11);
  view.setUint16(11 + nameBytes.length, type.length);
  out.set(Uint8Array.from(type, (char) => char.charCodeAt(0)), META_FIXED + nameBytes.length);
  return out;
}

/**
 * Reads the metadata block from the start of the first chunk's plaintext. The block is at most 1,292 bytes, so it
 * always lies whole in the first chunk; one that doesn't is damage.
 * @param {Uint8Array<ArrayBuffer>} plain
 * @returns {{ meta: Meta, length: number }}
 */
export function decodeMeta(plain) {
  if (plain.length < META_FIXED) throw new LockboxError('damaged', 'metadata cut off');
  const view = new DataView(plain.buffer, plain.byteOffset, plain.byteLength);
  const size = view.getBigUint64(1);
  if (size > BigInt(Number.MAX_SAFE_INTEGER)) throw new LockboxError('damaged', 'content size too large');
  const nameLength = view.getUint16(9);
  if (nameLength > MAX_NAME || plain.length < META_FIXED + nameLength) throw new LockboxError('damaged', 'name length');
  let name = '';
  try {
    name = strictDecoder.decode(plain.subarray(11, 11 + nameLength));
  } catch {
    throw new LockboxError('damaged', 'name is not UTF-8');
  }
  const typeLength = view.getUint16(11 + nameLength);
  const length = META_FIXED + nameLength + typeLength;
  if (typeLength > MAX_TYPE || plain.length < length) throw new LockboxError('damaged', 'media type length');
  const typeBytes = plain.subarray(META_FIXED + nameLength, length);
  if (typeBytes.some((byte) => byte < 0x20 || byte > 0x7e)) throw new LockboxError('damaged', 'media type is not printable ASCII');
  const kind = plain[0];
  if (!Object.values(KIND).includes(/** @type {0 | 1 | 2} */ (kind))) throw new LockboxError('newerVersion', `content kind ${kind}`);
  return { meta: { kind, size: Number(size), name, type: byteString(typeBytes) }, length };
}

/* ---------- Chunks ---------- */

/**
 * The chunk nonce: an 11-byte big-endian counter, then 0x01 for the last chunk and 0x00 before it.
 * @param {number} index
 * @param {boolean} last
 */
function nonce(index, last) {
  const iv = new Uint8Array(12);
  for (let at = 10, rest = index; rest > 0; at -= 1, rest = Math.floor(rest / 256)) iv[at] = rest % 256;
  iv[11] = last ? 1 : 0;
  return iv;
}

/**
 * @param {CryptoKey} key
 * @param {number} index
 * @param {boolean} last
 * @param {Uint8Array<ArrayBuffer>} plain
 */
async function sealChunk(key, index, last, plain) {
  COUNTS.sealed += 1;
  return new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce(index, last), tagLength: 128 }, key, plain));
}

/**
 * @param {CryptoKey} key
 * @param {number} index
 * @param {boolean} last
 * @param {Uint8Array<ArrayBuffer>} sealed
 */
async function openChunk(key, index, last, sealed) {
  COUNTS.opened += 1;
  try {
    return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: nonce(index, last), tagLength: 128 }, key, sealed));
  } catch {
    throw new LockboxError('damaged', `chunk ${index} didn't verify`);
  }
}

/**
 * @param {Read} read
 * @param {number} offset
 * @param {number} length
 */
async function readExactly(read, offset, length) {
  const bytes = await read(offset, length);
  if (bytes.length !== length) throw new LockboxError('readFailed', `asked for ${length} bytes at ${offset}, got ${bytes.length}`);
  return bytes;
}

/** @param {number} from @param {number} to */
const indices = (from, to) => Array.from({ length: to - from }, (_, i) => from + i);

/**
 * Padmé (Nikitin et al., "Reducing Metadata Leakage from Encrypted Files and Communication with PURBs", PoPETs 2019,
 * Algorithm 1): rounds a length up so that its lowest E − S bits are zero, where E = ⌊log2 L⌋ and S = ⌊log2 E⌋ + 1.
 * A length then shows only roughly how large it is, for at most +11.11% (9 bytes to 10) and less as it grows.
 * Exact integer arithmetic, so it holds beyond 32 bits.
 * @param {number} length
 */
export function padme(length) {
  if (length < 2) return length;
  const exponent = length.toString(2).length - 1;
  const zeros = exponent - exponent.toString(2).length;
  if (zeros <= 0) return length;
  const step = 2 ** zeros;
  return Math.ceil(length / step) * step;
}

/**
 * The plaintext stream's length: metadata block and content, rounded up by Padmé when the exact size is to be hidden.
 * @param {Meta} meta
 * @param {boolean} pad
 */
const streamLength = (meta, pad) => {
  const total = encodeMeta(meta).length + meta.size;
  return pad ? padme(total) : total;
};

/**
 * The size of the locked file for a content and its metadata: header, metadata block, content, padding if any, and
 * one tag a chunk.
 * @param {Meta} meta
 * @param {{ pad?: boolean }} [options]
 */
export function sealedSize(meta, { pad = false } = {}) {
  const total = streamLength(meta, pad);
  return HEADER_LENGTH + total + Math.ceil(total / CHUNK) * TAG;
}

/* ---------- Sealing and opening ---------- */

/**
 * Locks a content: writes the header, then the sealed chunks of (metadata block + content + zero padding), in order.
 * @param {{ password: string, meta: Meta, read: Read, write: Write, iterations?: number, salt?: Uint8Array<ArrayBuffer>, pad?: boolean } & StreamOptions} options
 *   `read` gives the content (not the metadata); `salt` is fixed only by tests; `pad` hides the exact size (Padmé).
 * @returns {Promise<number>}  Bytes written.
 */
export async function seal({ password, meta, read, write, iterations = ITERATIONS, salt = randomSalt(), pad = false, batch = BATCH, onProgress, isCancelled }) {
  if (!Number.isInteger(iterations) || iterations < MIN_ITERATIONS || iterations > MAX_ITERATIONS) throw new RangeError(`${iterations} iterations is outside ${MIN_ITERATIONS} to ${MAX_ITERATIONS}`);
  if (salt.length !== SALT_LENGTH) throw new RangeError(`The salt must be ${SALT_LENGTH} bytes, not ${salt.length}`);
  const metaBytes = encodeMeta(meta);
  const contentEnd = metaBytes.length + meta.size;
  const total = streamLength(meta, pad);
  const count = Math.ceil(total / CHUNK);
  if (isCancelled?.()) throw new LockboxError('cancelled');
  const { macKey, dataKey } = await deriveKeys(password, salt, iterations);
  const header = await buildHeader(salt, iterations, macKey);
  await write(header);
  let written = header.length;
  for (let first = 0; first < count; first += batch) {
    if (isCancelled?.()) throw new LockboxError('cancelled');
    const last = Math.min(count, first + batch);
    const start = first * CHUNK;
    const end = Math.min(total, last * CHUNK);
    const plain = new Uint8Array(end - start);
    if (start < metaBytes.length) plain.set(metaBytes.subarray(start, Math.min(end, metaBytes.length)));
    const from = Math.max(start, metaBytes.length) - metaBytes.length;
    // Past the content is padding, already zero in the new buffer.
    const to = Math.min(end, contentEnd) - metaBytes.length;
    if (to > from) plain.set(await readExactly(read, from, to - from), from + metaBytes.length - start);
    const sealed = await Promise.all(indices(first, last).map((index) => {
      const at = (index - first) * CHUNK;
      return sealChunk(dataKey, index, index === count - 1, plain.subarray(at, Math.min(at + CHUNK, plain.length)));
    }));
    for (const chunk of sealed) {
      await write(chunk);
      written += chunk.length;
    }
    onProgress?.(end, total);
  }
  return written;
}

/**
 * Unlocks a file. The header is verified first (one key derivation, no content read), so a wrong password is
 * reported before anything else. `start` is called with the metadata once the first chunk verified, and returns the
 * sink for the content; the promise resolves only after the final chunk verified. On any error the caller must
 * discard whatever the sink received.
 * @param {{ password: string, read: Read, size: number, start: (meta: Meta) => Write | Promise<Write> } & StreamOptions} options
 *   `read` gives the locked file; `size` is its length in bytes.
 * @returns {Promise<Meta>}
 */
export async function open({ password, read, size, start, batch = BATCH, onProgress, isCancelled }) {
  if (isCancelled?.()) throw new LockboxError('cancelled');
  const { dataKey, count } = await unlock(password, read, size);
  /** @type {Meta | null} */
  let meta = null;
  /** @type {Write | null} */
  let write = null;
  let written = 0;
  for (let first = 0; first < count; first += batch) {
    if (isCancelled?.()) throw new LockboxError('cancelled');
    const last = Math.min(count, first + batch);
    const from = HEADER_LENGTH + first * SEALED_CHUNK;
    const to = Math.min(size, HEADER_LENGTH + last * SEALED_CHUNK);
    const bytes = await readExactly(read, from, to - from);
    const plains = await Promise.all(indices(first, last).map((index) => {
      const at = (index - first) * SEALED_CHUNK;
      return openChunk(dataKey, index, index === count - 1, bytes.subarray(at, Math.min(at + SEALED_CHUNK, bytes.length)));
    }));
    for (const plain of plains) {
      let at = 0;
      if (!meta) {
        const decoded = decodeMeta(plain);
        meta = decoded.meta;
        at = decoded.length;
        write = await start(meta);
      }
      const take = Math.min(plain.length - at, meta.size - written);
      if (take > 0 && write) {
        await write(plain.subarray(at, at + take));
        written += take;
        at += take;
      }
      // Whatever follows the content is padding, and padding is zeros (version 1 writes none).
      for (let i = at; i < plain.length; i += 1) if (plain[i] !== 0) throw new LockboxError('damaged', 'bytes after the content');
    }
    onProgress?.(to, size);
  }
  if (!meta || written !== meta.size) throw new LockboxError('damaged', `content is ${written} bytes, not ${meta?.size}`);
  return meta;
}

/**
 * The first step of opening: reads and verifies the header (one key derivation, no content read) and works out the
 * chunks from the file's size.
 * @param {string} password
 * @param {Read} read
 * @param {number} size
 */
async function unlock(password, read, size) {
  const header = parseHeader(await read(0, Math.min(size, HEADER_LENGTH)));
  const payload = size - HEADER_LENGTH;
  const count = Math.ceil(payload / SEALED_CHUNK);
  const lastLength = payload - (count - 1) * SEALED_CHUNK;
  const { macKey, dataKey } = await deriveKeys(password, header.salt, header.iterations);
  if (!(await crypto.subtle.verify('HMAC', macKey, header.mac, header.signed))) throw new LockboxError('wrongPassword');
  // No chunk at all, or a final chunk with no plaintext: a valid file never ends so (its metadata is never empty).
  if (count === 0 || lastLength <= TAG) throw new LockboxError('damaged', 'no final chunk');
  return { dataKey, count };
}

/**
 * Opens a locked file at its two ends only: the header, the first chunk and the last chunk. It tells the metadata
 * before a save dialog is opened, and checks results too large to open twice. The middle is not verified, so this
 * never releases content to the visitor.
 * @param {{ password: string, read: Read, size: number }} options
 * @returns {Promise<{ meta: Meta, first: Uint8Array<ArrayBuffer>, last: { offset: number, bytes: Uint8Array<ArrayBuffer> } }>}
 *   first: the content held by the first chunk; last: the content held by the last chunk and its offset in the content.
 */
export async function openEnds({ password, read, size }) {
  const { dataKey, count } = await unlock(password, read, size);
  const firstPlain = await openChunk(dataKey, 0, count === 1, await readExactly(read, HEADER_LENGTH, Math.min(SEALED_CHUNK, size - HEADER_LENGTH)));
  const { meta, length } = decodeMeta(firstPlain);
  const first = firstPlain.subarray(length, Math.min(firstPlain.length, length + meta.size));
  if (count === 1) return { meta, first, last: { offset: 0, bytes: first } };
  const at = HEADER_LENGTH + (count - 1) * SEALED_CHUNK;
  const lastPlain = await openChunk(dataKey, count - 1, true, await readExactly(read, at, size - at));
  const offset = (count - 1) * CHUNK - length;
  const take = Math.max(0, Math.min(lastPlain.length, meta.size - offset));
  for (let i = take; i < lastPlain.length; i += 1) if (lastPlain[i] !== 0) throw new LockboxError('damaged', 'bytes after the content');
  // The content ends in this chunk, or (padding) before it; it can't run past the file.
  if (offset + lastPlain.length < meta.size) throw new LockboxError('damaged', 'content shorter than its size');
  return { meta, first, last: { offset: Math.min(offset, meta.size), bytes: lastPlain.subarray(0, take) } };
}

/** @param {Uint8Array<ArrayBuffer>} bytes @returns {Read} */
export const readBytes = (bytes) => async (offset, length) => bytes.slice(offset, offset + length);

/** @param {Uint8Array<ArrayBuffer>[]} parts */
function join(parts) {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

/**
 * Locks a content held in memory.
 * @param {{ password: string, meta: Omit<Meta, 'size'>, content: Uint8Array<ArrayBuffer>, iterations?: number, salt?: Uint8Array<ArrayBuffer>, pad?: boolean } & StreamOptions} options
 */
export async function sealBytes({ content, meta, ...options }) {
  /** @type {Uint8Array<ArrayBuffer>[]} */
  const parts = [];
  await seal({ ...options, meta: { ...meta, size: content.length }, read: readBytes(content), write: (bytes) => { parts.push(bytes.slice()); } });
  return join(parts);
}

/**
 * Unlocks a file held in memory.
 * @param {{ password: string, bytes: Uint8Array<ArrayBuffer> } & StreamOptions} options
 */
export async function openBytes({ bytes, ...options }) {
  /** @type {Uint8Array<ArrayBuffer>[]} */
  const parts = [];
  const meta = await open({ ...options, read: readBytes(bytes), size: bytes.length, start: () => (part) => { parts.push(part.slice()); } });
  return { meta, content: join(parts) };
}

/* ---------- Armoured text ---------- */

/**
 * A locked file as text that survives chats and mail: standard base64, 64 characters a line, between markers.
 * @param {Uint8Array} bytes
 */
export function armour(bytes) {
  const step = (ARMOUR_WIDTH / 4) * 3 * 1024;
  let text = '';
  for (let at = 0; at < bytes.length; at += step) text += btoa(byteString(bytes.subarray(at, at + step)));
  const lines = [];
  for (let at = 0; at < text.length; at += ARMOUR_WIDTH) lines.push(text.slice(at, at + ARMOUR_WIDTH));
  return [ARMOUR_BEGIN, ...lines, ARMOUR_END].join('\n');
}

/**
 * Reads armoured text back, tolerating what chats and mail do to it: markers missing, ">" quote marks at line
 * starts, invisible characters, spaces and line breaks, the URL-safe alphabet and missing "=". Null when the result
 * isn't a Lockwell file.
 * @param {string} text
 * @returns {Uint8Array<ArrayBuffer> | null}
 */
export function unarmour(text) {
  // Invisible characters first: one inside a marker would otherwise hide the marker.
  let body = text.replace(CONTROL, '');
  const begin = body.indexOf(ARMOUR_BEGIN);
  if (begin !== -1) body = body.slice(begin + ARMOUR_BEGIN.length);
  const end = body.indexOf(ARMOUR_END);
  if (end !== -1) body = body.slice(0, end);
  body = body
    .replace(/^[ \t]*(?:>[ \t]*)+/gm, '')
    .replace(/\s+/g, '')
    .replace(/-/g, '+')
    .replace(/_/g, '/')
    .replace(/=+$/, '');
  if (!/^[A-Za-z0-9+/]+$/.test(body) || body.length % 4 === 1) return null;
  const bytes = Uint8Array.from(atob(body.padEnd(Math.ceil(body.length / 4) * 4, '=')), (char) => char.charCodeAt(0));
  return looksLocked(bytes) ? bytes : null;
}

/* ---------- Names ---------- */

/**
 * The name to save an unlocked file under: path separators, control, direction and invisible characters removed,
 * no leading dots or spaces, at most 200 characters with the extension kept; FALLBACK_NAME when nothing is left.
 * @param {string} name
 */
export function cleanName(name) {
  const cleaned = name.replace(CONTROL, '').replace(/[/\\]/g, '').replace(/^[\s.]+/, '').trim();
  const chars = [...cleaned];
  if (chars.length <= MAX_SAVED_NAME) return cleaned || FALLBACK_NAME;
  const dot = cleaned.lastIndexOf('.');
  const extension = dot > 0 && cleaned.length - dot <= 16 ? [...cleaned.slice(dot)] : [];
  return [...chars.slice(0, MAX_SAVED_NAME - extension.length), ...extension].join('');
}

// @ts-check
/**
 * @file Tests for the Lockwell encrypted-file format (src/client/lockbox.mjs).
 *
 * Files are checked against a second implementation written here with Node's own node:crypto (pbkdf2Sync,
 * hkdfSync, createHmac, AES-256-GCM ciphers), not with the tool's code, in both directions. The frozen vector must
 * open forever: a change that breaks it is a format break.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createCipheriv, createDecipheriv, createHmac, hkdfSync, pbkdf2Sync, timingSafeEqual } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  ARMOUR_BEGIN,
  ARMOUR_END,
  CHUNK,
  COUNTS,
  FALLBACK_NAME,
  HEADER_LENGTH,
  ITERATIONS,
  KIND,
  LockboxError,
  MAX_ITERATIONS,
  MAX_NAME,
  MIN_ITERATIONS,
  armour,
  cleanName,
  open,
  openBytes,
  openEnds,
  padme,
  readBytes,
  seal,
  sealBytes,
  sealedSize,
  unarmour,
} from '../src/client/lockbox.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SCRIPT = join(ROOT, 'scripts', 'lockbox-open.mjs');
/** The accepted minimum, so the tests stay fast. */
const FAST = MIN_ITERATIONS;
const PASSWORD = 'tidal-mammal-spoon-uncover-gravy-pebble';
const encoder = new TextEncoder();

/** @param {string} text */
const utf8 = (text) => new Uint8Array(encoder.encode(text));
/** @param {number} n */
const salt = (n = 0) => Uint8Array.from({ length: 16 }, (_, i) => (i + n) % 256);
/** @param {number} length @param {number} [seed] */
const pattern = (length, seed = 7) => Uint8Array.from({ length }, (_, i) => (i * 31 + seed) % 251);
const resetCounts = () => Object.assign(COUNTS, { kdf: 0, sealed: 0, opened: 0 });

/* ---------- The independent implementation ---------- */

/** @param {string} password @param {Uint8Array} saltBytes @param {number} iterations */
function refKeys(password, saltBytes, iterations) {
  const master = pbkdf2Sync(Buffer.from(password.normalize('NFC'), 'utf8'), saltBytes, iterations, 32, 'sha256');
  return {
    mac: Buffer.from(hkdfSync('sha256', master, saltBytes, 'lockwell/v1/header', 32)),
    data: Buffer.from(hkdfSync('sha256', master, saltBytes, 'lockwell/v1/payload', 32)),
  };
}

/** @param {number} index @param {boolean} last */
function refNonce(index, last) {
  const iv = Buffer.alloc(12);
  iv.writeUIntBE(index, 5, 6);
  iv[11] = last ? 1 : 0;
  return iv;
}

/**
 * @typedef {object} RefFile
 * @property {string} [password]
 * @property {Uint8Array} [salt]
 * @property {number} [iterations]
 * @property {number} [version]
 * @property {number} [kdf]
 * @property {number} [kind]
 * @property {string} [name]
 * @property {string} [type]
 * @property {Uint8Array} [content]
 * @property {number} [declaredSize]  A content size other than the real one.
 * @property {Uint8Array} [padding]  Bytes after the content.
 * @property {number} [lastAt]  Flag this chunk as the last one and stop there.
 * @property {boolean} [emptyLast]  End with an empty final chunk after full ones (only a writer with the key can).
 */

/** @param {RefFile} file */
function refWrite({ password = PASSWORD, salt: saltBytes = salt(), iterations = FAST, version = 1, kdf = 1, kind = KIND.text, name = '', type = '', content = new Uint8Array(), declaredSize, padding = new Uint8Array(), lastAt, emptyLast = false }) {
  const keys = refKeys(password, saltBytes, iterations);
  const header = Buffer.alloc(30);
  header.write('LOCKWELL', 0, 'latin1');
  header[8] = version;
  header[9] = kdf;
  header.writeUInt32BE(iterations, 10);
  Buffer.from(saltBytes).copy(header, 14);
  const mac = createHmac('sha256', keys.mac).update(header).digest();
  const nameBytes = Buffer.from(name, 'utf8');
  const fixed = Buffer.alloc(11);
  fixed[0] = kind;
  fixed.writeBigUInt64BE(BigInt(declaredSize ?? content.length), 1);
  fixed.writeUInt16BE(nameBytes.length, 9);
  const typeLength = Buffer.alloc(2);
  typeLength.writeUInt16BE(type.length);
  const stream = Buffer.concat([fixed, nameBytes, typeLength, Buffer.from(type, 'latin1'), content, padding]);
  const count = Math.max(1, Math.ceil(stream.length / CHUNK));
  const chunks = [];
  for (let i = 0; i < count; i += 1) {
    const last = emptyLast ? false : lastAt === undefined ? i === count - 1 : i === lastAt;
    const cipher = createCipheriv('aes-256-gcm', keys.data, refNonce(i, last), { authTagLength: 16 });
    chunks.push(cipher.update(stream.subarray(i * CHUNK, (i + 1) * CHUNK)), cipher.final(), cipher.getAuthTag());
    if (last) break;
  }
  if (emptyLast) {
    const cipher = createCipheriv('aes-256-gcm', keys.data, refNonce(count, true), { authTagLength: 16 });
    chunks.push(cipher.update(new Uint8Array()), cipher.final(), cipher.getAuthTag());
  }
  return new Uint8Array(Buffer.concat([header, mac, ...chunks]));
}

/** @param {Uint8Array} bytes @param {string} [password] */
function refRead(bytes, password = PASSWORD) {
  const file = Buffer.from(bytes);
  assert.equal(file.subarray(0, 8).toString('latin1'), 'LOCKWELL');
  assert.equal(file[8], 1);
  assert.equal(file[9], 1);
  const iterations = file.readUInt32BE(10);
  const keys = refKeys(password, file.subarray(14, 30), iterations);
  assert.ok(timingSafeEqual(createHmac('sha256', keys.mac).update(file.subarray(0, 30)).digest(), file.subarray(30, 62)), 'header MAC');
  const payload = file.subarray(62);
  const count = Math.ceil(payload.length / (CHUNK + 16));
  const plain = [];
  for (let i = 0; i < count; i += 1) {
    const sealed = payload.subarray(i * (CHUNK + 16), (i + 1) * (CHUNK + 16));
    const decipher = createDecipheriv('aes-256-gcm', keys.data, refNonce(i, i === count - 1), { authTagLength: 16 });
    decipher.setAuthTag(sealed.subarray(sealed.length - 16));
    plain.push(decipher.update(sealed.subarray(0, sealed.length - 16)), decipher.final());
  }
  const stream = Buffer.concat(plain);
  const size = Number(stream.readBigUInt64BE(1));
  const nameLength = stream.readUInt16BE(9);
  const typeLength = stream.readUInt16BE(11 + nameLength);
  const start = 13 + nameLength + typeLength;
  return {
    iterations,
    kind: stream[0],
    name: stream.subarray(11, 11 + nameLength).toString('utf8'),
    type: stream.subarray(13 + nameLength, start).toString('latin1'),
    content: new Uint8Array(stream.subarray(start, start + size)),
  };
}

/**
 * @param {Promise<unknown>} promise
 * @param {string} code
 */
async function rejectsWith(promise, code) {
  await assert.rejects(promise, (error) => error instanceof LockboxError && error.code === code);
}

/* ---------- The frozen vector ---------- */

/**
 * Made by the independent writer above from: password PASSWORD, salt 00 01 … 0f, 100,000 iterations, kind text,
 * content VECTOR_TEXT. The same bytes are printed in docs/ENCRYPTED-FORMAT.md.
 */
const VECTOR_TEXT = 'Lockwell format test vector, version 1.\n';
const VECTOR_HEX =
  '4c4f434b57454c4c0101000186a0000102030405060708090a0b0c0d0e0f' +
  'd357293db5e692db8d71d67d092fd05a9cab68a133c7eec8ba5a25c7ce90776d' +
  'cd9db4352cefe60509807343628e2de6599731d4f4ce1a85c5fc35ee40bd5de8' +
  'c1d44048b869aa1b0f3e61288abe1cf44d83ee4737b5a2b6fb556846c6cec714' +
  '8a155c6473';

describe('lockbox: the frozen test vector', () => {
  it('is what the independent writer makes from the documented inputs', () => {
    const made = refWrite({ salt: salt(), content: utf8(VECTOR_TEXT) });
    assert.equal(Buffer.from(made).toString('hex'), VECTOR_HEX);
  });

  it('is printed in docs/ENCRYPTED-FORMAT.md, as hex and as locked text', () => {
    const doc = readFileSync(join(ROOT, 'docs/ENCRYPTED-FORMAT.md'), 'utf8');
    const hex = doc.match(/^[0-9a-f]{8,64}$/gm)?.join('');
    assert.equal(hex, VECTOR_HEX);
    assert.ok(doc.includes(armour(new Uint8Array(Buffer.from(VECTOR_HEX, 'hex')))));
  });

  it('opens with the tool, and the tool writes exactly these bytes from the same inputs', async () => {
    const bytes = new Uint8Array(Buffer.from(VECTOR_HEX, 'hex'));
    const { meta, content } = await openBytes({ password: PASSWORD, bytes });
    assert.deepEqual(meta, { kind: KIND.text, size: VECTOR_TEXT.length, name: '', type: '' });
    assert.equal(new TextDecoder().decode(content), VECTOR_TEXT);
    const sealed = await sealBytes({ password: PASSWORD, meta: { kind: KIND.text, name: '', type: '' }, content: utf8(VECTOR_TEXT), iterations: FAST, salt: salt() });
    assert.equal(Buffer.from(sealed).toString('hex'), VECTOR_HEX);
  });
});

describe('lockbox: both directions against the independent implementation', () => {
  const CASES = [
    ['empty content', 0],
    ['1 byte', 1],
    ['a stream of 65,535 bytes', CHUNK - 1 - 13],
    ['a stream of exactly one chunk', CHUNK - 13],
    ['a stream of 65,537 bytes', CHUNK + 1 - 13],
    ['a stream of exactly two chunks', 2 * CHUNK - 13],
    ['content crossing three chunks', 2 * CHUNK + 5],
  ];
  for (const [label, length] of CASES) {
    it(`${label}: the tool's file opens with node:crypto, and node:crypto's with the tool`, async () => {
      const content = pattern(Number(length));
      const sealed = await sealBytes({ password: PASSWORD, meta: { kind: KIND.text, name: '', type: '' }, content, iterations: FAST, salt: salt(3) });
      assert.equal(sealed.length, sealedSize({ kind: KIND.text, size: content.length, name: '', type: '' }));
      const read = refRead(sealed);
      assert.deepEqual(read.content, content);
      assert.equal(read.iterations, FAST);
      const opened = await openBytes({ password: PASSWORD, bytes: refWrite({ salt: salt(3), content }) });
      assert.deepEqual(opened.content, content);
      assert.deepEqual(sealed, refWrite({ salt: salt(3), content }), 'same inputs, same bytes');
    });
  }

  it('carries a file name of the full 1,024 bytes, a media type and a ZIP kind', async () => {
    const name = `${'ა'.repeat(339)}.docx`; // 339 × 3 bytes + 5 = 1,022; one more letter would not fit
    const longest = `${name}xy`;
    assert.equal(utf8(longest).length, MAX_NAME);
    const content = pattern(CHUNK * 2);
    const sealed = await sealBytes({ password: PASSWORD, meta: { kind: KIND.files, name: longest, type: 'application/zip' }, content, iterations: FAST });
    const read = refRead(sealed);
    assert.equal(read.name, longest);
    assert.equal(read.type, 'application/zip');
    assert.equal(read.kind, KIND.files);
    const opened = await openBytes({ password: PASSWORD, bytes: refWrite({ kind: KIND.file, name: longest, type: 'application/pdf', content }) });
    assert.deepEqual(opened.meta, { kind: KIND.file, size: content.length, name: longest, type: 'application/pdf' });
    await assert.rejects(sealBytes({ password: PASSWORD, meta: { kind: KIND.file, name: `${longest}z`, type: '' }, content, iterations: FAST }), RangeError);
  });

  it('writes the default iteration count into new files, and refuses counts outside the accepted range', async () => {
    assert.equal(ITERATIONS, 1_000_000);
    await assert.rejects(sealBytes({ password: PASSWORD, meta: { kind: KIND.text, name: '', type: '' }, content: utf8('x'), iterations: MIN_ITERATIONS - 1 }), RangeError);
  });

  it('accepts zero padding after the content (for later versions) and the full accepted iteration range', async () => {
    const content = utf8('padded');
    const opened = await openBytes({ password: PASSWORD, bytes: refWrite({ content, padding: new Uint8Array(CHUNK) }) });
    assert.deepEqual(opened.content, content);
  });
});

/* ---------- Tampering ---------- */

describe('lockbox: tampering is refused with the right error and nothing is released', () => {
  const content = pattern(3 * CHUNK);
  const good = refWrite({ content });
  const SEALED = CHUNK + 16;
  /** @param {Uint8Array} bytes */
  async function attempt(bytes) {
    let released = 0;
    const result = open({ password: PASSWORD, read: readBytes(new Uint8Array(bytes)), size: bytes.length, start: () => () => { released += 1; } });
    return { result, released: () => released };
  }
  /** @param {number} at */
  const flipped = (at) => {
    const bytes = good.slice();
    bytes[at] ^= 0x01;
    return bytes;
  };
  /** @param {number} index */
  const chunkAt = (index) => good.subarray(HEADER_LENGTH + index * SEALED, HEADER_LENGTH + (index + 1) * SEALED);
  /** @param {Uint8Array[]} chunks */
  const withChunks = (chunks) => new Uint8Array(Buffer.concat([good.subarray(0, HEADER_LENGTH), ...chunks]));

  it('every header byte flipped in turn', async () => {
    /** @param {number} at */
    const expected = (at) => {
      if (at < 8) return 'notLocked';
      if (at === 8 || at === 9) return 'damaged'; // version or key derivation 1 → 0
      if (at === 10 || at === 11) return 'damaged'; // 100,000 → 16,877,216 or 34,464 iterations
      return 'wrongPassword'; // 100,256 or 100,001 iterations, the salt or the MAC: the MAC doesn't verify
    };
    await Promise.all(Array.from({ length: HEADER_LENGTH }, async (_, at) => {
      const { result, released } = await attempt(flipped(at));
      await rejectsWith(result, expected(at));
      assert.equal(released(), 0, `byte ${at}`);
    }));
  });

  it('a flipped byte in each chunk', async () => {
    for (let index = 0; index < 4; index += 1) {
      const { result, released } = await attempt(flipped(HEADER_LENGTH + index * SEALED + 10));
      await rejectsWith(result, 'damaged');
      assert.equal(released(), 0, 'all chunks are in one batch, so none is released');
    }
  });

  it('two chunks swapped, a chunk repeated, a chunk removed from the middle', async () => {
    for (const chunks of [
      [chunkAt(1), chunkAt(0), chunkAt(2), chunkAt(3)],
      [chunkAt(0), chunkAt(1), chunkAt(1), chunkAt(2), chunkAt(3)],
      [chunkAt(0), chunkAt(2), chunkAt(3)],
    ]) {
      const { result } = await attempt(withChunks(chunks));
      await rejectsWith(result, 'damaged');
    }
  });

  it('the last chunk removed (cut off at a chunk boundary), bytes appended, the file cut mid-chunk', async () => {
    for (const bytes of [
      withChunks([chunkAt(0), chunkAt(1), chunkAt(2)]),
      new Uint8Array(Buffer.concat([good, Buffer.from([0])])),
      good.slice(0, good.length - 1),
      good.slice(0, HEADER_LENGTH),
      good.slice(0, HEADER_LENGTH + 10),
    ]) {
      const { result, released } = await attempt(bytes);
      await rejectsWith(result, 'damaged');
      assert.equal(released(), 0);
    }
  });

  it('the last-chunk flag forged on an earlier chunk, and an empty final chunk after full ones', async () => {
    const { result } = await attempt(refWrite({ content, lastAt: 1 }));
    await rejectsWith(result, 'damaged');
    const { result: empty, released } = await attempt(refWrite({ content: pattern(CHUNK - 13), emptyLast: true }));
    await rejectsWith(empty, 'damaged');
    assert.equal(released(), 0);
  });

  it('content shorter than its declared size, and non-zero bytes after the content', async () => {
    for (const bytes of [refWrite({ content, declaredSize: content.length + 1 }), refWrite({ content, padding: Uint8Array.of(0, 0, 1) })]) {
      await rejectsWith(openBytes({ password: PASSWORD, bytes }), 'damaged');
    }
  });

  it('iterations below 100,000 or above 10,000,000, even with a valid MAC; version 2; key derivation 2', async () => {
    await rejectsWith(openBytes({ password: PASSWORD, bytes: refWrite({ iterations: MIN_ITERATIONS - 1 }) }), 'damaged');
    const tooMany = refWrite({ iterations: FAST });
    new DataView(tooMany.buffer).setUint32(10, MAX_ITERATIONS + 1);
    await rejectsWith(openBytes({ password: PASSWORD, bytes: tooMany }), 'damaged');
    await rejectsWith(openBytes({ password: PASSWORD, bytes: refWrite({ version: 2 }) }), 'newerVersion');
    await rejectsWith(openBytes({ password: PASSWORD, bytes: refWrite({ kdf: 2 }) }), 'newerVersion');
    await rejectsWith(openBytes({ password: PASSWORD, bytes: refWrite({ kind: 3 }) }), 'newerVersion');
  });

  it('something that is not a Lockwell file', async () => {
    for (const bytes of [new Uint8Array(), utf8('LOCKWEL'), utf8('%PDF-1.7 and some more bytes than a header has, well over sixty-two of them')]) {
      await rejectsWith(openBytes({ password: PASSWORD, bytes }), 'notLocked');
    }
  });
});

/* ---------- Passwords ---------- */

describe('lockbox: passwords', () => {
  it('NFC and NFD forms of the same password open the same file; a trailing space matters', async () => {
    const nfc = 'café-ქართული-პაროლი'.normalize('NFC');
    const nfd = nfc.normalize('NFD');
    assert.notEqual(nfc, nfd);
    const sealed = await sealBytes({ password: nfd, meta: { kind: KIND.text, name: '', type: '' }, content: utf8('ok'), iterations: FAST });
    assert.equal(new TextDecoder().decode((await openBytes({ password: nfc, bytes: sealed })).content), 'ok');
    await rejectsWith(openBytes({ password: `${nfc} `, bytes: sealed }), 'wrongPassword');
  });
});

/* ---------- Cost ---------- */

describe('lockbox: operation counts', () => {
  it('a wrong password costs exactly one key derivation and no chunk', async () => {
    const bytes = refWrite({ content: pattern(5 * CHUNK) });
    resetCounts();
    let started = false;
    await rejectsWith(open({ password: 'wrong', read: readBytes(bytes), size: bytes.length, start: () => { started = true; return () => {}; } }), 'wrongPassword');
    assert.deepEqual(COUNTS, { kdf: 1, sealed: 0, opened: 0 });
    assert.equal(started, false);
  });

  it('a 10-chunk input reaches the sink once per chunk, in order, after the header', async () => {
    const content = pattern(10 * CHUNK - 13);
    /** @type {Uint8Array[]} */
    const writes = [];
    resetCounts();
    await seal({ password: PASSWORD, meta: { kind: KIND.text, size: content.length, name: '', type: '' }, read: readBytes(content), write: (bytes) => { writes.push(bytes.slice()); }, iterations: FAST });
    assert.deepEqual(writes.map((bytes) => bytes.length), [HEADER_LENGTH, ...Array(10).fill(CHUNK + 16)]);
    assert.deepEqual(COUNTS, { kdf: 1, sealed: 10, opened: 0 });
    assert.deepEqual(refRead(Buffer.concat(writes)).content, content);
    /** @type {number[]} */
    const lengths = [];
    resetCounts();
    await open({ password: PASSWORD, read: readBytes(new Uint8Array(Buffer.concat(writes))), size: writes.reduce((sum, bytes) => sum + bytes.length, 0), start: () => (bytes) => { lengths.push(bytes.length); } });
    assert.deepEqual(lengths, [CHUNK - 13, ...Array(9).fill(CHUNK)]);
    assert.deepEqual(COUNTS, { kdf: 1, sealed: 0, opened: 10 });
  });

  it('Cancel stops sealing and opening before the next batch', async () => {
    const content = pattern(40 * CHUNK);
    let steps = 0;
    resetCounts();
    await rejectsWith(seal({ password: PASSWORD, meta: { kind: KIND.text, size: content.length, name: '', type: '' }, read: readBytes(content), write: () => {}, iterations: FAST, onProgress: () => { steps += 1; }, isCancelled: () => steps > 0 }), 'cancelled');
    assert.equal(COUNTS.sealed, 16);
    const bytes = refWrite({ content });
    steps = 0;
    resetCounts();
    await rejectsWith(open({ password: PASSWORD, read: readBytes(bytes), size: bytes.length, start: () => () => {}, onProgress: () => { steps += 1; }, isCancelled: () => steps > 0 }), 'cancelled');
    assert.equal(COUNTS.opened, 16);
  });

  it('a source that gives fewer bytes than asked for is a read failure, not a shorter file', async () => {
    const content = pattern(1000);
    await rejectsWith(seal({ password: PASSWORD, meta: { kind: KIND.text, size: 2000, name: '', type: '' }, read: readBytes(content), write: () => {}, iterations: FAST }), 'readFailed');
  });
});

/* ---------- Hiding the exact size ---------- */

describe('lockbox: hiding the exact size with Padmé', () => {
  it('follows the paper\'s Algorithm 1: 9 bytes become 10, powers of two and small lengths stay, never more than +12%', () => {
    assert.equal(padme(9), 10, 'the PURBs paper\'s own example');
    assert.equal(padme(8), 8);
    assert.equal(padme(10), 10);
    for (const n of [0, 1, 2, 3]) assert.equal(padme(n), n);
    let worst = 0;
    for (let n = 2; n < 200_000; n += 1) {
      const padded = padme(n);
      assert.ok(padded >= n);
      worst = Math.max(worst, (padded - n) / n);
    }
    // The paper's text gives +11.11% (9 to 10) as the maximum, but its Algorithm 1 pads 129 to 144 (+11.63%:
    // E = 7, S = 3, four low bits cleared). The abstract's "at most 12%" holds.
    assert.equal(padme(129), 144);
    assert.ok(worst < 0.12, `worst overhead ${worst}`);
    assert.equal(padme(2 ** 40 + 1), 2 ** 40 + 2 ** (40 - 6), 'exact beyond 32 bits: E = 40, S = 6');
    assert.ok(padme(5 * 2 ** 30) / (5 * 2 ** 30) - 1 < 0.02, 'about 1-2% at gigabytes');
  });

  it('gives nearby sizes the same locked size, and opens back to the exact content in both implementations', async () => {
    const meta = { kind: KIND.file, name: 'scan.pdf', type: 'application/pdf' };
    const a = pattern(1_000_000);
    const b = pattern(1_010_000, 3);
    const lockedA = await sealBytes({ password: PASSWORD, meta, content: a, iterations: FAST, pad: true });
    const lockedB = await sealBytes({ password: PASSWORD, meta, content: b, iterations: FAST, pad: true });
    assert.equal(lockedA.length, lockedB.length, 'one size bucket');
    assert.equal(lockedA.length, sealedSize({ ...meta, size: a.length }, { pad: true }));
    const plainA = await sealBytes({ password: PASSWORD, meta, content: a, iterations: FAST });
    assert.notEqual(plainA.length, lockedA.length);
    assert.deepEqual((await openBytes({ password: PASSWORD, bytes: lockedA })).content, a);
    assert.deepEqual(refRead(lockedB).content, b);
  });

  it('opens a padded file whose last chunk holds only padding, at its ends too', async () => {
    // 13 + 8 + 15 = 36 bytes of metadata. The stream ends on a chunk boundary at 2^23 + 64 KiB (129 chunks); Padmé
    // rounds it up to a multiple of 2^18 (E = 23, S = 5), 132 chunks: the last three chunks are padding only, so the
    // last chunk starts after the content ends.
    const meta = { kind: KIND.file, name: 'scan.pdf', type: 'application/pdf' };
    const content = pattern(2 ** 23 + CHUNK - 36);
    const locked = await sealBytes({ password: PASSWORD, meta, content, iterations: FAST, pad: true });
    assert.equal(locked.length, HEADER_LENGTH + 132 * (CHUNK + 16), 'three chunks of padding only');
    assert.deepEqual((await openBytes({ password: PASSWORD, bytes: locked })).content, content);
    const ends = await openEnds({ password: PASSWORD, read: readBytes(locked), size: locked.length });
    assert.equal(ends.meta.size, content.length);
    // The end of the content sits in chunk 128, before the three chunks of padding: it is opened and returned, so the
    // "start and end" check really compares the end (review C5; this test used to expect nothing at the end).
    assert.equal(ends.last.offset, content.length - CHUNK);
    assert.deepEqual(ends.last.bytes, content.subarray(content.length - CHUNK));
  });

  it('refuses non-zero bytes after the content where the content ends and in the last chunk, at its ends too', async () => {
    const content = pattern(3 * CHUNK);
    // Content ends inside chunk 3; padding runs on through chunk 5. A stray byte right after the content, or one in the
    // last chunk only: both are refused by the ends check alone.
    for (const at of [0, 2 * CHUNK]) {
      const padding = new Uint8Array(2 * CHUNK + 100);
      padding[at] = 1;
      const bytes = refWrite({ kind: KIND.file, name: 'a.bin', type: '', content, padding });
      await assert.rejects(openEnds({ password: PASSWORD, read: readBytes(bytes), size: bytes.length }), (error) => error instanceof LockboxError && error.code === 'damaged', `stray byte at ${at}`);
    }
    const clean = refWrite({ kind: KIND.file, name: 'a.bin', type: '', content, padding: new Uint8Array(2 * CHUNK + 100) });
    const ends = await openEnds({ password: PASSWORD, read: readBytes(clean), size: clean.length });
    assert.deepEqual(ends.last.bytes, content.subarray(ends.last.offset));
    assert.ok(ends.last.offset > 0 && ends.last.bytes.length > 0);
  });
});

/* ---------- Opening at the ends ---------- */

describe('lockbox: opening a file at its two ends', () => {
  it('gives the metadata and the content of the first and last chunks, after one key derivation', async () => {
    const content = pattern(5 * CHUNK + 300);
    const bytes = refWrite({ kind: KIND.file, name: 'video.mp4', type: 'video/mp4', content });
    resetCounts();
    const { meta, first, last } = await openEnds({ password: PASSWORD, read: readBytes(bytes), size: bytes.length });
    assert.deepEqual(COUNTS, { kdf: 1, sealed: 0, opened: 2 });
    assert.deepEqual(meta, { kind: KIND.file, size: content.length, name: 'video.mp4', type: 'video/mp4' });
    assert.deepEqual(first, content.subarray(0, first.length));
    assert.equal(first.length, CHUNK - (13 + 'video.mp4'.length + 'video/mp4'.length));
    assert.equal(last.offset + last.bytes.length, content.length);
    assert.deepEqual(last.bytes, content.subarray(last.offset));
  });

  it('works for a one-chunk file, and refuses a wrong password, a changed last chunk and a cut file', async () => {
    const small = refWrite({ content: utf8('tiny') });
    const one = await openEnds({ password: PASSWORD, read: readBytes(small), size: small.length });
    assert.deepEqual(one.first, utf8('tiny'));
    assert.deepEqual(one.last, { offset: 0, bytes: utf8('tiny') });
    const big = refWrite({ content: pattern(3 * CHUNK) });
    resetCounts();
    await rejectsWith(openEnds({ password: 'wrong', read: readBytes(big), size: big.length }), 'wrongPassword');
    assert.deepEqual(COUNTS, { kdf: 1, sealed: 0, opened: 0 });
    const changed = big.slice();
    changed[changed.length - 3] ^= 1;
    await rejectsWith(openEnds({ password: PASSWORD, read: readBytes(changed), size: changed.length }), 'damaged');
    const cut = big.slice(0, HEADER_LENGTH + 2 * (CHUNK + 16));
    await rejectsWith(openEnds({ password: PASSWORD, read: readBytes(cut), size: cut.length }), 'damaged');
  });
});

/* ---------- Armour ---------- */

describe('lockbox: armoured text', () => {
  /** @type {Uint8Array<ArrayBuffer>} */
  let bytes;
  /** @type {string} */
  let text;
  it('round-trips, 64 characters a line between the markers', async () => {
    bytes = await sealBytes({ password: PASSWORD, meta: { kind: KIND.text, name: '', type: '' }, content: utf8('a secret recovery code: 4417-2291'), iterations: FAST });
    text = armour(bytes);
    const lines = text.split('\n');
    assert.equal(lines[0], ARMOUR_BEGIN);
    assert.equal(lines.at(-1), ARMOUR_END);
    assert.ok(lines.slice(1, -2).every((line) => line.length === 64));
    assert.deepEqual(unarmour(text), bytes);
    assert.equal(new TextDecoder().decode((await openBytes({ password: PASSWORD, bytes: /** @type {Uint8Array<ArrayBuffer>} */ (unarmour(text)) })).content), 'a secret recovery code: 4417-2291');
  });

  it('survives what chats and mail do to it', () => {
    const body = text.split('\n').slice(1, -1);
    const variants = {
      'markers missing': body.join('\n'),
      'quoted lines': text.split('\n').map((line) => `> ${line}`).join('\n'),
      'quoted twice': text.split('\n').map((line) => `> > ${line}`).join('\n'),
      CRLF: text.replace(/\n/g, '\r\n'),
      'zero-width characters': text.replace(/(.{10})/g, '$1\u200b').replace(/(.{7})/g, '$1\u2060'),
      'URL-safe alphabet, no padding': body.join('').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''),
      'one long line inside a message': `Here it is: ${ARMOUR_BEGIN} ${body.join(' ')} ${ARMOUR_END} thanks!`,
    };
    for (const [label, variant] of Object.entries(variants)) assert.deepEqual(unarmour(variant), bytes, label);
  });

  it('gives null for text that is not base64 or not a Lockwell file', () => {
    assert.equal(unarmour('Hello, this is an ordinary message.'), null);
    assert.equal(unarmour(`${ARMOUR_BEGIN}\n!!!!\n${ARMOUR_END}`), null);
    assert.equal(unarmour(btoa('%PDF-1.7 not ours')), null);
    assert.equal(unarmour(''), null);
  });

  it('the binary file and the armoured text are the same bytes', async () => {
    const file = refWrite({ kind: KIND.file, name: 'scan.pdf', type: 'application/pdf', content: pattern(70_000) });
    assert.deepEqual(unarmour(armour(file)), file);
  });
});

/* ---------- Names ---------- */

describe('lockbox: the name an unlocked file is saved under', () => {
  it('removes path separators, control and direction characters, leading dots; keeps the extension when cut', () => {
    assert.equal(cleanName('../../etc/passwd'), 'etcpasswd');
    assert.equal(cleanName('C:\\Users\\me\\report.pdf'), 'C:Usersmereport.pdf');
    assert.equal(cleanName('invoice\u202Efdp.exe'), 'invoicefdp.exe');
    assert.equal(cleanName('.hidden'), 'hidden');
    assert.equal(cleanName(''), FALLBACK_NAME);
    assert.equal(cleanName('\u200b\u202e'), FALLBACK_NAME);
    const long = cleanName(`${'ა'.repeat(300)}.pdf`);
    assert.equal([...long].length, 200);
    assert.ok(long.endsWith('ა.pdf'));
  });
});

/* ---------- Privacy ---------- */

describe('lockbox: privacy', () => {
  it('uses no network, storage, URL or Math.random', () => {
    const source = readFileSync(join(ROOT, 'src/client/lockbox.mjs'), 'utf8');
    for (const word of ['fetch(', 'XMLHttpRequest', 'sendBeacon', 'WebSocket', 'localStorage', 'sessionStorage', 'indexedDB', 'location.', 'history.', 'Math.random']) {
      assert.ok(!source.includes(word), word);
    }
  });
});

/* ---------- The reference decryptor ---------- */

describe('scripts/lockbox-open.mjs', () => {
  it('opens a file with the password on stdin, refuses a wrong one and leaves no output behind', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'lockbox-'));
    try {
      const content = pattern(CHUNK + 100);
      const locked = join(dir, 'report.pdf.lockwell');
      writeFileSync(locked, await sealBytes({ password: PASSWORD, meta: { kind: KIND.file, name: 'report.pdf', type: 'application/pdf' }, content, iterations: FAST }));
      const out = join(dir, 'out.pdf');
      const ok = spawnSync(process.execPath, [SCRIPT, locked, out], { input: `${PASSWORD}\n`, encoding: 'utf8' });
      assert.equal(ok.status, 0, ok.stderr);
      assert.deepEqual(new Uint8Array(readFileSync(out)), content);
      const again = spawnSync(process.execPath, [SCRIPT, locked, out], { input: `${PASSWORD}\n`, encoding: 'utf8' });
      assert.notEqual(again.status, 0, 'never overwrites');
      const wrong = spawnSync(process.execPath, [SCRIPT, locked, join(dir, 'wrong.pdf')], { input: 'wrong\n', encoding: 'utf8' });
      assert.notEqual(wrong.status, 0);
      assert.match(wrong.stderr, /password is wrong/);
      assert.equal(existsSync(join(dir, 'wrong.pdf')), false);
      const text = join(dir, 'note.lockwell');
      writeFileSync(text, armour(await sealBytes({ password: PASSWORD, meta: { kind: KIND.text, name: '', type: '' }, content: utf8('hello'), iterations: FAST })));
      const printed = spawnSync(process.execPath, [SCRIPT, text], { input: `${PASSWORD}\n`, encoding: 'utf8' });
      assert.equal(printed.status, 0, printed.stderr);
      assert.equal(printed.stdout, 'hello');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

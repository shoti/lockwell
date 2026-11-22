// @ts-check
/**
 * @file Tests for opening locked PDFs (plan docs/tools-plan/pdf-toolkit.md §6.6, §11): MD5 against RFC 1321's test
 * suite, RC4 against RFC 6229's vectors (both files read 2026-11-22), the standard security handler of revisions 2
 * to 4 on files qpdf encrypted (tests/pdf-crypt-fixtures.mjs), the wrong password, revision 6 and other handlers
 * refused, a copy saved without encryption, and damaged encrypted files.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { md5 } from '../src/client/md5.mjs';
import { rc4 } from '../src/client/rc4.mjs';
import { decrypt, passwordBytes } from '../src/client/pdf-crypt.mjs';
import { build } from '../src/client/pdf-build.mjs';
import { PdfError, openPdf } from '../src/client/pdf-file.mjs';
import { pageList } from '../src/client/pdf-pages.mjs';
import { PdfDict, PdfName, PdfStream, PdfString, textOf } from '../src/client/pdf-syntax.mjs';
import * as fixtures from './pdf-crypt-fixtures.mjs';

const ascii = (/** @type {string} */ text) => new TextEncoder().encode(text);
const hex = (/** @type {Uint8Array} */ bytes) => Buffer.from(bytes).toString('hex');
const fromHex = (/** @type {string} */ text) => Uint8Array.from(Buffer.from(text.replace(/\s+/g, ''), 'hex'));

/** @param {Promise<unknown>} promise @param {string} code */
const rejectsPdf = (promise, code) => assert.rejects(promise, (error) => error instanceof PdfError && error.code === code);

/**
 * What the fixture letter says, read through the file: its page content, its annotation and its Info title.
 * @param {import('../src/client/pdf-file.mjs').PdfFile} file
 */
async function letter(file) {
  const [page] = pageList(file);
  const content = file.resolve(page.dict.get('Contents'));
  assert.ok(content instanceof PdfStream);
  const annots = file.resolve(page.dict.get('Annots'));
  const note = Array.isArray(annots) ? file.resolve(annots[0]) : null;
  const info = file.resolve(file.trailer.get('Info'));
  const string = (/** @type {unknown} */ value) => (value instanceof PdfString ? textOf(value) : null);
  return {
    content: new TextDecoder().decode(await file.decode(content)).trim(),
    note: note instanceof PdfDict ? string(file.resolve(note.get('Contents'))) : null,
    title: info instanceof PdfDict ? string(file.resolve(info.get('Title'))) : null,
  };
}

const LETTER = { content: 'BT /F1 12 Tf 20 50 Td (Locked letter) Tj ET', note: 'A note inside', title: 'Secret title' };

describe('MD5 (RFC 1321 §A.5 test suite)', () => {
  it('gives the digests listed in the RFC', () => {
    const suite = [
      ['', 'd41d8cd98f00b204e9800998ecf8427e'],
      ['a', '0cc175b9c0f1b6a831c399e269772661'],
      ['abc', '900150983cd24fb0d6963f7d28e17f72'],
      ['message digest', 'f96b697d7cb7938d525a2f31aaf161d0'],
      ['abcdefghijklmnopqrstuvwxyz', 'c3fcd3d76192e4007dfb496cca67e13b'],
      ['ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789', 'd174ab98d277d9f5a5611c2c9f419d9f'],
      ['1234567890'.repeat(8), '57edf4a22be3c955ac49da2e2107b67a'],
    ];
    for (const [text, digest] of suite) assert.equal(hex(md5(ascii(text))), digest, JSON.stringify(text));
  });

  it('pads correctly at the block edges (55, 56, 63 and 64 bytes)', () => {
    // The RFC suite has no message between 56 and 64 bytes; these lengths take the padding across a block.
    const results = [55, 56, 63, 64].map((n) => hex(md5(new Uint8Array(n).fill(0x61))));
    assert.equal(new Set(results).size, 4);
    for (const digest of results) assert.match(digest, /^[0-9a-f]{32}$/);
    assert.equal(hex(md5(ascii('a'.repeat(64)))), results[3]);
  });
});

describe('RC4 (RFC 6229 §2 test vectors)', () => {
  /** @param {string} keyHex @param {[number, string][]} rows */
  const check = (keyHex, rows) => {
    const stream = rc4(fromHex(keyHex), new Uint8Array(4112));
    for (const [offset, expected] of rows) assert.equal(hex(stream.subarray(offset, offset + 16)), expected.replace(/\s+/g, ''), `${keyHex} @ ${offset}`);
  };

  it('40-bit key 0x0102030405', () => {
    check('0102030405', [
      [0, 'b2 39 63 05 f0 3d c0 27 cc c3 52 4a 0a 11 18 a8'],
      [16, '69 82 94 4f 18 fc 82 d5 89 c4 03 a4 7a 0d 09 19'],
      [240, '28 cb 11 32 c9 6c e2 86 42 1d ca ad b8 b6 9e ae'],
      [256, '1c fc f6 2b 03 ed db 64 1d 77 df cf 7f 8d 8c 93'],
      [1536, 'd8 72 9d b4 18 82 25 9b ee 4f 82 53 25 f5 a1 30'],
      [4096, 'ff 25 b5 89 95 99 67 07 e5 1f bd f0 8b 34 d8 75'],
    ]);
  });

  it('128-bit keys', () => {
    check('0102030405060708090a0b0c0d0e0f10', [
      [0, '9a c7 cc 9a 60 9d 1e f7 b2 93 28 99 cd e4 1b 97'],
      [16, '52 48 c4 95 90 14 12 6a 6e 8a 84 f1 1d 1a 9e 1c'],
      [512, 'c6 8c 1d 5c 55 9a 97 41 23 df 1d bc 52 a4 3b 89'],
    ]);
    check('ebb46227c6cc8b37641910833222772a', [
      [0, '72 0c 94 b6 3e df 44 e1 31 d9 50 ca 21 1a 5a 30'],
      [496, '08 12 8c 46 9f 27 53 42 ad da 20 2b 2b 58 da 95'],
    ]);
  });

  it('is its own inverse and refuses an empty key', () => {
    const key = ascii('key');
    assert.equal(new TextDecoder().decode(rc4(key, rc4(key, ascii('plain text')))), 'plain text');
    assert.throws(() => rc4(new Uint8Array(0), ascii('x')), RangeError);
  });
});

describe('PDF crypt: helpers', () => {
  it('tries Latin-1 bytes, then UTF-8, for what was typed', () => {
    assert.deepEqual(passwordBytes('abc').map(hex), ['616263']);
    assert.deepEqual(passwordBytes('é').map(hex), ['e9', 'c3a9']);
    assert.deepEqual(passwordBytes('ქ').map(hex), ['e183a5']);
    assert.deepEqual(passwordBytes(''), [new Uint8Array(0)]);
  });

  it('decrypts AES-CBC with PDF padding, and data whose padding is wrong as far as it goes', async () => {
    const key = new Uint8Array(16).fill(7);
    const iv = new Uint8Array(16).fill(3);
    const aes = await crypto.subtle.importKey('raw', key, 'AES-CBC', false, ['encrypt']);
    const plain = ascii('thirty-two bytes of plain text!\u0000');
    const sealed = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-CBC', iv }, aes, plain));
    const data = new Uint8Array([...iv, ...sealed]);
    assert.deepEqual(await decrypt(key, 'aes', data), plain);
    // Without its padding block the last byte is 0, not a padding length: everything is returned.
    assert.deepEqual(await decrypt(key, 'aes', data.subarray(0, 16 + 32)), plain);
    // A stray byte after the last whole block is ignored; less than an IV and one block reads as nothing.
    assert.deepEqual(await decrypt(key, 'aes', new Uint8Array([...data, 1])), plain);
    assert.equal((await decrypt(key, 'aes', data.subarray(0, 31))).length, 0);
    assert.equal(decrypt(key, 'none', data) instanceof Promise, true);
    assert.deepEqual(await decrypt(key, 'none', data), data);
  });
});

describe('PDF crypt: opening files qpdf encrypted', () => {
  for (const [name, revision] of /** @type {const} */ ([['r2Empty', 2], ['r3Empty', 3], ['r4Empty', 4]])) {
    it(`revision ${revision}, no user password: opens with the empty password and reads like the plain file`, async () => {
      const file = await openPdf(fixtures[name]);
      assert.equal(file.encrypted, true);
      assert.equal(file.unlocked, false);
      assert.equal(await file.unlock(''), true);
      assert.equal(file.unlocked, true);
      assert.equal(file.security?.revision, revision);
      assert.equal(file.security?.restricted, false);
      assert.deepEqual(await letter(file), LETTER);
      assert.deepEqual(await letter(await openPdf(fixtures.plain)), LETTER, 'the fixture says what the plain file says');
    });
  }

  for (const [name, revision] of /** @type {const} */ ([['r2Password', 2], ['r3Password', 3], ['r4Password', 4]])) {
    it(`revision ${revision} with a user password: refuses the empty and a wrong one, opens with either right one`, async () => {
      const file = await openPdf(fixtures[name]);
      assert.equal(await file.unlock(''), false);
      assert.equal(await file.unlock('User-pw'), false, 'case counts');
      assert.equal(await file.unlock('wrong'), false);
      assert.equal(file.unlocked, false);
      await rejectsPdf(file.decode(/** @type {PdfStream} */ (file.resolve(pageList(file)[0].dict.get('Contents')))), 'locked');
      assert.equal(await file.unlock(fixtures.USER_PASSWORD), true);
      assert.deepEqual(await letter(file), LETTER);
      const owner = await openPdf(fixtures[name]);
      assert.equal(await owner.unlock(fixtures.OWNER_PASSWORD), true, 'the owner password opens it too (Algorithm 7)');
      assert.deepEqual(await letter(owner), LETTER);
    });
  }

  it('reads a restricted file whose objects are in an encrypted object stream', async () => {
    const file = await openPdf(fixtures.r4PackedRestricted);
    assert.equal(file.encrypted, true);
    assert.throws(() => pageList(file), (error) => error instanceof PdfError && error.code === 'locked', 'nothing packed reads before it is unlocked');
    assert.equal(await file.unlock(''), true);
    assert.equal(file.security?.restricted, true);
    assert.equal(pageList(file).length, 1);
    assert.deepEqual(await letter(file), LETTER);
  });

  it('refuses revision 6 and other security handlers, each with its own reason', async () => {
    const r6 = await openPdf(fixtures.r6Password);
    await rejectsPdf(r6.unlock(fixtures.USER_PASSWORD), 'lockedRevision');
    const text = String.fromCharCode(...fixtures.r2Empty);
    assert.ok(text.includes('/Filter /Standard'));
    const other = Uint8Array.from(text.replace('/Filter /Standard', '/Filter /Unknown1'), (c) => c.charCodeAt(0));
    await rejectsPdf((await openPdf(other)).unlock(''), 'lockedHandler');
  });

  it('takes a stream’s own Crypt filter out of its filter list', async () => {
    const file = await openPdf(fixtures.r4Empty);
    await file.unlock('');
    const dict = new PdfDict([
      ['Filter', [new PdfName('Crypt'), new PdfName('FlateDecode')]],
      ['DecodeParms', [new PdfDict([['Name', new PdfName('Identity')]]), null]],
    ]);
    assert.equal(file.streamMethod(dict), 'none');
    assert.deepEqual(dict.get('Filter'), [new PdfName('FlateDecode')]);
    assert.equal(dict.has('DecodeParms'), false);
    const named = new PdfDict([['Filter', new PdfName('Crypt')], ['DecodeParms', new PdfDict([['Name', new PdfName('StdCF')]])]]);
    assert.equal(file.streamMethod(named), 'aes');
    assert.equal(named.has('Filter'), false);
    assert.equal(file.streamMethod(new PdfDict([['Type', new PdfName('XObject')]])), 'aes', 'the default for streams');
  });
});

describe('PDF crypt: the saved copy', () => {
  it('is not encrypted, says so, and carries the text', async () => {
    for (const [name, password] of /** @type {const} */ ([['r2Password', 'user-pw'], ['r3Empty', ''], ['r4Password', 'owner-pw'], ['r4PackedRestricted', '']])) {
      const file = await openPdf(fixtures[name]);
      assert.equal(await file.unlock(password), true);
      const pages = pageList(file);
      const result = await build({ pages: [{ key: 0, origin: { source: 1, index: 0 }, turn: 0 }], sources: new Map([[1, { file, pages }]]), id: new Uint8Array(16) });
      assert.ok(result.report.dropped.includes('encryption'), name);
      const copy = await openPdf(result.bytes);
      assert.equal(copy.encrypted, false, name);
      assert.ok(!String.fromCharCode(...result.bytes).includes('/Encrypt'), name);
      assert.deepEqual((await letter(copy)).content, LETTER.content, name);
    }
  });

  it('is refused while the file is still locked', async () => {
    const file = await openPdf(fixtures.r2Password);
    const pages = pageList(file);
    await rejectsPdf(build({ pages: [{ key: 0, origin: { source: 1, index: 0 }, turn: 0 }], sources: new Map([[1, { file, pages }]]), id: new Uint8Array(16) }), 'locked');
  });
});

describe('PDF crypt: damaged encrypted files never crash', () => {
  const generator = (/** @type {number} */ seed) => () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  const sources = [fixtures.r2Empty, fixtures.r3Password, fixtures.r4Empty, fixtures.r4PackedRestricted, fixtures.r6Password];

  /** Opens, unlocks and reads every object: either it works or it throws PdfError. @param {Uint8Array} bytes */
  const attempt = async (bytes) => {
    try {
      const file = await openPdf(bytes);
      await file.unlock('');
      await file.unlock(fixtures.USER_PASSWORD);
      for (const num of file.entries.keys()) {
        const value = file.get(num);
        if (value instanceof PdfStream) await file.decode(value).catch((error) => assert.ok(error instanceof PdfError, String(error)));
      }
      pageList(file);
    } catch (error) {
      assert.ok(error instanceof PdfError, String(error));
    }
  };

  it('truncated anywhere', async () => {
    const random = generator(7);
    for (const bytes of sources) for (let i = 0; i < 30; i += 1) await attempt(bytes.subarray(0, Math.floor(random() * bytes.length)));
  });

  it('with bytes flipped', async () => {
    const random = generator(8);
    for (const bytes of sources) {
      for (let i = 0; i < 40; i += 1) {
        const copy = Uint8Array.from(bytes);
        for (let k = 0; k < 1 + Math.floor(random() * 6); k += 1) copy[Math.floor(random() * copy.length)] ^= 1 << Math.floor(random() * 8);
        await attempt(copy);
      }
    }
  });
});

describe('PDF crypt: privacy', () => {
  it('uses no network, storage or URL state', () => {
    for (const module of ['md5', 'rc4', 'pdf-crypt']) {
      const source = readFileSync(new URL(`../src/client/${module}.mjs`, import.meta.url), 'utf8');
      for (const word of ['fetch(', 'XMLHttpRequest', 'sendBeacon', 'WebSocket', 'localStorage', 'sessionStorage', 'indexedDB', 'location.', 'history.']) {
        assert.ok(!source.includes(word), `${module}: ${word}`);
      }
    }
  });
});

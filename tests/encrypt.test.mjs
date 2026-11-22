// @ts-check
/**
 * @file Tests for the file encryption tool's pure helpers (src/client/tool-encrypt.mjs). The format itself is tested in
 * lockbox.test.mjs, the page in encrypt-page.test.mjs.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { KIND, LockboxError, MAX_NAME, openBytes, sealBytes } from '../src/client/lockbox.mjs';
import { MIN_PASSWORD, canUse, fitName, mediaType, passwordWarnings, savedAs, sizeParts, withPassword, wrongPasswordMessage } from '../src/client/tool-encrypt.mjs';

describe('file encryption: warnings about a typed password', () => {
  it('warns for each rule, and says nothing for an empty field', () => {
    assert.deepEqual(passwordWarnings(''), []);
    assert.deepEqual(passwordWarnings('Ab1!'), ['tooShort']);
    assert.deepEqual(passwordWarnings('Tb1!sxyz9Q'), ['short']);
    assert.deepEqual(passwordWarnings('abcdefghijklm'), ['oneClass', 'run']);
    assert.deepEqual(passwordWarnings('aaaaaaaaaaaaaaa'), ['oneClass', 'run']);
    assert.deepEqual(passwordWarnings('9876543210123'.slice(0, 10)), ['short', 'oneClass', 'run']);
    assert.deepEqual(passwordWarnings('ქართულიპაროლიგრძელი'), ['oneClass'], 'Georgian letters are one kind of character');
    assert.deepEqual(passwordWarnings('My-passport-scan-2026!', { name: 'Passport-Scan.pdf' }), ['name'], 'in any case');
    assert.deepEqual(passwordWarnings('My-passport-scan-2026!', { name: 'contract.pdf' }), []);
    assert.deepEqual(passwordWarnings('My-passport-scan-2026!', { name: 'ab.pdf' }), [], 'names under 3 characters are ignored');
    assert.deepEqual(passwordWarnings('Recovery code 4417-2291', { text: 'Recovery code 4417-2291' }), ['text']);
  });

  it('warns about white space at either end, never inside (review C7)', () => {
    assert.deepEqual(passwordWarnings('pocket violin tundra spark '), ['edges']);
    assert.deepEqual(passwordWarnings('\tpocket violin tundra spark'), ['edges']);
    assert.deepEqual(passwordWarnings('pocket violin tundra spark'), []);
  });

  it('never calls a password strong: a rule cannot tell Tbilisi2026! from a good one', () => {
    assert.deepEqual(passwordWarnings('Tbilisi2026!'), []);
    const known = new Set(['tooShort', 'short', 'oneClass', 'run', 'name', 'text']);
    for (const password of ['x', 'correct horse battery staple', 'Tr0ub4dor&3', 'ქართული-პაროლი-2026', '😀😀😀😀😀😀😀😀', 'A'.repeat(200)]) {
      for (const key of passwordWarnings(password)) assert.ok(known.has(key), `${password}: ${key}`);
    }
  });

  it('allows a typed password from 8 characters, typed twice alike while hidden', () => {
    assert.equal(MIN_PASSWORD, 8);
    assert.equal(canUse({ password: 'seven77', repeat: 'seven77', shown: false }), false);
    assert.equal(canUse({ password: 'eight888', repeat: 'eight88', shown: false }), false);
    assert.equal(canUse({ password: 'eight888', repeat: 'eight888', shown: false }), true);
    assert.equal(canUse({ password: 'eight888', repeat: '', shown: true }), true);
    assert.equal(canUse({ password: 'ქართული1', repeat: '', shown: true }), true, 'counted in characters, not bytes');
  });
});

describe('file encryption: names, types and sizes', () => {
  it('fits a long name into the format, keeping its extension', () => {
    assert.equal(fitName('report.pdf'), 'report.pdf');
    const fitted = fitName(`${'ა'.repeat(600)}.pdf`);
    assert.ok(new TextEncoder().encode(fitted).length <= MAX_NAME);
    assert.ok(fitted.endsWith('ა.pdf'));
  });

  it('keeps only media types the format can carry', () => {
    assert.equal(mediaType('application/pdf'), 'application/pdf');
    assert.equal(mediaType(''), '');
    assert.equal(mediaType('text/plain; charset=ü'), '');
    assert.equal(mediaType('x'.repeat(256)), '');
  });

  it('offers an unlocked file under its cleaned name', () => {
    assert.deepEqual(savedAs({ kind: KIND.file, size: 1, name: 'report.pdf', type: '' }), { original: 'report.pdf', extension: 'pdf' });
    assert.deepEqual(savedAs({ kind: KIND.file, size: 1, name: '../x‮gpj.exe', type: '' }), { original: 'xgpj.exe', extension: 'exe' });
    assert.deepEqual(savedAs({ kind: KIND.file, size: 1, name: 'README', type: '' }), { original: 'README', extension: '' });
    assert.deepEqual(savedAs({ kind: KIND.files, size: 1, name: '', type: '' }), { original: 'files.zip', extension: 'zip' });
  });

  it('gives sizes in bytes, kilobytes, megabytes and gigabytes', () => {
    assert.deepEqual(sizeParts(0, 'en'), { unit: 'b', n: '0' });
    assert.deepEqual(sizeParts(1023, 'en'), { unit: 'b', n: '1,023' });
    assert.deepEqual(sizeParts(1536, 'en'), { unit: 'kb', n: '2' });
    assert.deepEqual(sizeParts(32 * 1024 ** 2, 'en'), { unit: 'mb', n: '32' });
    assert.deepEqual(sizeParts(1.9 * 1024 ** 3, 'en'), { unit: 'gb', n: '1.9' });
  });
});

describe('file encryption: privacy', () => {
  it('uses no network, storage, URL state or Math.random', () => {
    const source = readFileSync(new URL('../src/client/tool-encrypt.mjs', import.meta.url), 'utf8');
    for (const word of ['fetch(', 'XMLHttpRequest', 'sendBeacon', 'WebSocket', 'localStorage', 'sessionStorage', 'indexedDB', 'location.', 'history.', 'Math.random']) {
      assert.ok(!source.includes(word), word);
    }
  });
});

describe('file encryption: a wrong password (review C7)', () => {
  const PASSWORD = 'pocket violin tundra spark';
  /** @type {Uint8Array<ArrayBuffer>} */
  let sealed;
  const ready = sealBytes({ password: PASSWORD, meta: { kind: KIND.text, name: '', type: '' }, content: new TextEncoder().encode('hi'), iterations: 100_000 }).then((bytes) => {
    sealed = bytes;
  });

  it('tries once more without white space at the ends, and says which password opened it', async () => {
    await ready;
    let tries = 0;
    /** @param {string} password */
    const step = (password) => {
      tries += 1;
      return openBytes({ password, bytes: sealed });
    };
    const opened = await withPassword(` ${PASSWORD}\n`, step);
    assert.equal(opened.password, PASSWORD);
    assert.equal(new TextDecoder().decode(opened.result.content), 'hi');
    assert.equal(tries, 2);
    tries = 0;
    assert.equal((await withPassword(PASSWORD, step)).password, PASSWORD);
    assert.equal(tries, 1, 'a right password costs one try');
    tries = 0;
    await assert.rejects(withPassword('wrong password here', step), (error) => error instanceof LockboxError && error.code === 'wrongPassword');
    assert.equal(tries, 1, 'nothing to trim: one try');
    tries = 0;
    await assert.rejects(withPassword(' wrong password here ', step), (error) => error instanceof LockboxError && error.code === 'wrongPassword');
    assert.equal(tries, 2);
  });

  it('does not try again for any other failure', async () => {
    let tries = 0;
    const damaged = async () => {
      tries += 1;
      throw new LockboxError('damaged');
    };
    await assert.rejects(withPassword(' x ', damaged), (error) => error instanceof LockboxError && error.code === 'damaged');
    assert.equal(tries, 1);
  });

  it('hints at Caps Lock first, then at Georgian letters typed for a password set in English', () => {
    assert.equal(wrongPasswordMessage('Pocket', true), 'wrongPasswordCaps');
    assert.equal(wrongPasswordMessage('ზჩბფი', true), 'wrongPasswordCaps');
    assert.equal(wrongPasswordMessage('ზჩბფი ვიოლინო', false), 'wrongPasswordLayout');
    assert.equal(wrongPasswordMessage('pocket violin', false), 'wrongPassword');
  });
});

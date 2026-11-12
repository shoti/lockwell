// @ts-check
// SPDX-FileCopyrightText: 2026 Shota Mtvarelishvili <mtvarelishvili@proton.me>
// SPDX-License-Identifier: MIT
/**
 * @file Tests for the tools: pure logic and page labels.
 * @author Shota Mtvarelishvili <mtvarelishvili@proton.me> (https://shoti.github.io/)
 */
/** The tools under /tools/: their pure logic, and the pages the build writes for them. */
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { build } from '../src/build/build.mjs';
import { TOOLS } from '../src/build/tools.mjs';
import { FONTS, autofillLeak, browserFacts, detectFonts, fingerprintSource, utcOffset } from '../src/client/tool-browser.mjs';
import { imitatedBrand, inspectLink, nestedDomain, oneEditApart, punycodeDecode, scriptTrick, siteName, unicodeHost } from '../src/client/tool-check.mjs';
import { KINDS as HIDDEN_KINDS } from '../src/client/tool-hidden.mjs';
import { cleanText, cleanUrl, findLinks, isTracking } from '../src/client/tool-links.mjs';
import { ZOOMS, boxFromDrag, commit, createHistory, currentDrawing, exportSize, frameRect, handleAt, hitShape, moveBox, moveShape, outputFrame, pixelRect, previewSize, redactedName, redo, resizeBox, resizeFromHandle, shapeBounds, stepZoom, undo } from '../src/client/tool-redact.mjs';
import { charSets, entropyBits, generatePassword, guessTime, randomInt, strengthOf } from '../src/client/tool-password.mjs';

const ALL = { lower: true, upper: true, digits: true, symbols: true, avoid: false };

describe('password generator', () => {
  it('builds the character sets that were asked for', () => {
    assert.deepEqual(charSets({ ...ALL, upper: false, symbols: false }), ['abcdefghijklmnopqrstuvwxyz', '0123456789']);
    assert.deepEqual(charSets({ lower: false, upper: false, digits: false, symbols: false, avoid: false }), []);
    const safe = charSets({ ...ALL, avoid: true }).join('');
    for (const char of '0Oo1lI|') assert.ok(!safe.includes(char), `look-alike "${char}" is left out`);
    assert.equal(new Set(charSets(ALL).join('')).size, charSets(ALL).join('').length, 'no character appears twice, which would skew the odds');
  });

  it('never returns a number outside the range, and redraws values from the uneven tail', () => {
    for (let i = 0; i < 2000; i += 1) {
      const n = randomInt(7);
      assert.ok(Number.isInteger(n) && n >= 0 && n < 7);
    }
    // 2^32 % 10 = 6, so the top 6 values would make 0–5 slightly more likely: they must be rejected.
    const draws = [0xffffffff, 0xfffffffa, 123];
    const picked = randomInt(10, (buffer) => {
      buffer[0] = /** @type {number} */ (draws.shift());
    });
    assert.equal(picked, 3);
    assert.equal(draws.length, 0, 'both tail values were drawn again');
  });

  it('spreads its choices evenly (no modulo bias, no Math.random)', () => {
    const counts = new Array(6).fill(0);
    for (let i = 0; i < 60000; i += 1) counts[randomInt(6)] += 1;
    for (const count of counts) assert.ok(Math.abs(count - 10000) < 500, `expected about 10000 of each, got ${counts}`);
    assert.doesNotMatch(randomInt.toString() + generatePassword.toString(), /Math\.random/);
  });

  it('makes passwords of the requested length with every chosen kind of character', () => {
    const sets = charSets(ALL);
    for (let i = 0; i < 300; i += 1) {
      const password = generatePassword(sets, 12);
      assert.equal(password.length, 12);
      for (const set of sets) assert.ok([...password].some((char) => set.includes(char)), `"${password}" has a character from "${set}"`);
      assert.ok([...password].every((char) => sets.join('').includes(char)));
    }
    assert.equal(generatePassword(sets, 4).length, 4, 'exactly one of each still works');
    assert.match(generatePassword(['0123456789'], 6), /^\d{6}$/, 'PIN');
  });

  it('does not put the guaranteed characters in fixed places', () => {
    const sets = charSets(ALL);
    const firstIsLower = Array.from({ length: 400 }, () => generatePassword(sets, 20)).filter((p) => sets[0].includes(p[0])).length;
    assert.ok(firstIsLower < 320, `the first character was a lowercase letter ${firstIsLower}/400 times`);
  });

  it('returns nothing when no characters are chosen or the length is too short for one of each', () => {
    assert.equal(generatePassword([], 20), '');
    assert.equal(generatePassword(charSets(ALL), 3), '');
  });

  it('rates strength from the number of possible passwords', () => {
    assert.equal(entropyBits(['0123456789'], 6), 19);
    assert.equal(strengthOf(entropyBits(['0123456789'], 6)), 'weak');
    assert.equal(strengthOf(entropyBits(charSets(ALL), 8)), 'fair');
    assert.equal(strengthOf(entropyBits(charSets(ALL), 12)), 'strong');
    assert.equal(strengthOf(entropyBits(charSets(ALL), 20)), 'veryStrong');
    assert.equal(entropyBits([], 20), 0);
  });
});

describe('link cleaner', () => {
  /** @param {string} input */
  const clean = (input) => {
    const result = cleanUrl(input);
    assert.equal(result.status, 'ok', `${input} should be a valid link`);
    return /** @type {Extract<import('../src/client/tool-links.mjs').CleanResult, { status: 'ok' }>} */ (result);
  };

  it('removes tracking parameters and keeps the rest exactly as written', () => {
    const result = clean('https://example.com/a%20b/?id=7&utm_source=fb&q=hello+world&fbclid=IwAR0x&utm_medium=cpc#part');
    assert.equal(result.url, 'https://example.com/a%20b/?id=7&q=hello+world#part');
    assert.deepEqual(result.removed, ['utm_source', 'fbclid', 'utm_medium']);
  });

  it('drops the "?" when nothing is left, and reports a clean link as clean', () => {
    assert.equal(clean('https://example.com/page?gclid=abc&UTM_Campaign=x').url, 'https://example.com/page');
    const untouched = clean('https://example.com/search?q=privacy&page=2');
    assert.equal(untouched.url, 'https://example.com/search?q=privacy&page=2');
    assert.deepEqual(untouched.removed, []);
  });

  it('only removes site-specific parameters on their own sites', () => {
    assert.equal(clean('https://youtu.be/dQw4w9WgXcQ?si=AbCdEf&t=42').url, 'https://youtu.be/dQw4w9WgXcQ?t=42');
    assert.equal(clean('https://x.com/user/status/1?s=20&t=abc').url, 'https://x.com/user/status/1');
    assert.equal(clean('https://example.com/?si=1&s=2&t=3').url, 'https://example.com/?si=1&s=2&t=3', 'elsewhere these may be needed');
    assert.equal(isTracking('si', 'music.youtube.com'), true);
    assert.equal(isTracking('si', 'notyoutube.com'), false);
  });

  it('skips redirect pages and cleans the real address', () => {
    const result = clean('https://l.facebook.com/l.php?u=https%3A%2F%2Fexample.com%2Fnews%3Futm_source%3Dfb%26id%3D5&h=AT0xyz');
    assert.equal(result.url, 'https://example.com/news?id=5');
    assert.deepEqual(result.unwrapped, ['l.facebook.com']);
    assert.deepEqual(result.removed, ['utm_source']);
    assert.equal(clean('https://www.google.com/url?q=https://example.org/&sa=D').url, 'https://example.org/');
    assert.deepEqual(clean('https://www.google.com/search?q=https://example.org/').unwrapped, [], 'a search is not a redirect');
  });

  it('never unwraps into something that is not a web link', () => {
    const result = clean('https://l.facebook.com/l.php?u=javascript%3Aalert(1)');
    assert.equal(new URL(result.url).hostname, 'l.facebook.com');
    assert.deepEqual(result.unwrapped, []);
  });

  it('accepts a link pasted without https://, and rejects everything that is not a web link', () => {
    assert.equal(clean('  example.com/a?utm_source=x  ').url, 'https://example.com/a');
    for (const input of ['', 'hello there', 'javascript:alert(1)', 'mailto:a@example.com', 'file:///etc/passwd', 'ftp://example.com/x']) {
      assert.equal(cleanUrl(input).status, 'invalid', input);
    }
  });

  it('never contacts the link (no fetch, navigation or storage in the tool)', async () => {
    const source = await readFile(new URL('../src/client/tool-links.mjs', import.meta.url), 'utf8');
    assert.doesNotMatch(source, /fetch\(|XMLHttpRequest|location\.|window\.open|sendBeacon|Storage/);
  });
});

describe('link checker', () => {
  /** @param {string} input */
  const check = (input) => {
    const report = inspectLink(input);
    assert.equal(report.status, 'ok', `${input} should be a valid link`);
    return /** @type {import('../src/client/tool-check.mjs').LinkReport} */ (report);
  };

  it('decodes international names (RFC 3492 examples and real cases)', () => {
    assert.equal(punycodeDecode('bcher-kva'), 'bücher');
    assert.equal(punycodeDecode('80ak6aa92e'), 'аррӏе', 'the well-known fake "apple" in Cyrillic');
    assert.equal(punycodeDecode('node'), 'გე', 'the Georgian country ending');
    assert.equal(punycodeDecode('egbpdaj6bu4bxfgehfvwxn'), 'ليهمابتكلموشعربي؟');
    assert.throws(() => punycodeDecode('a-b!c'), RangeError);
    assert.equal(unicodeHost('www.xn--bcher-kva.example'), 'www.bücher.example');
    assert.equal(unicodeHost('xn--!!!.com'), 'xn--!!!.com', 'undecodable parts are shown as they are');
  });

  it('finds the registered site name, including two-part endings', () => {
    assert.equal(siteName('login.example.com'), 'example.com');
    assert.equal(siteName('a.b.example.com.ge'), 'example.com.ge');
    assert.equal(siteName('shop.example.co.uk'), 'example.co.uk');
    assert.equal(siteName('example.ge'), 'example.ge');
  });

  it('says where a link really leads, reading the address from the end', () => {
    const report = check('https://paypal.com.secure-login.ge/signin?next=/account');
    assert.equal(report.site, 'secure-login.ge');
    assert.equal(report.host, 'paypal.com.secure-login.ge');
    assert.deepEqual(report.warnings, ['brandSubdomain']);
    assert.equal(report.details.brand, 'paypal');
  });

  it('flags brand names glued to other words, and small misspellings', () => {
    assert.deepEqual(check('https://paypal-login.com/').warnings, ['brandLookalike']);
    assert.deepEqual(check('https://tbcbank-online.ge/').warnings, ['brandLookalike']);
    assert.deepEqual(check('https://secure-apple.com/id').warnings, ['brandLookalike']);
    assert.deepEqual(check('https://g00gle.com/').warnings, ['typo']);
    assert.deepEqual(check('https://faceboook.com/').warnings, ['typo']);
    assert.deepEqual(check('https://arnazon.com/').warnings, ['typo'], '"rn" passing for "m"');
    assert.equal(oneEditApart('amazon', 'amazno'), true, 'swapped neighbours');
    assert.equal(oneEditApart('amazon', 'amazon'), false);
    assert.equal(oneEditApart('amazon', 'amaz'), false);
  });

  it('does not cry wolf at real addresses', () => {
    for (const link of [
      'https://www.google.com/search?q=privacy', 'https://google.ge/', 'https://www.amazon.de/dp/B0', 'https://accounts.google.com/', 'https://lh3.googleusercontent.com/x',
      'https://www.tbcbank.ge/', 'https://bankofgeorgia.ge/', 'https://web.whatsapp.com/', 'https://t.me/durov', 'https://pineapple.com/', 'https://lockwell.org/guides/accounts/',
      'https://en.wikipedia.org/wiki/Signal_(software)', 'https://signal.org/download/', 'https://my.gov.ge/',
    ]) {
      assert.deepEqual(check(link).warnings, [], link);
    }
    assert.equal(imitatedBrand('example.com', 'www'), null);
  });

  it('flags look-alike letters from other alphabets, but not honest Georgian or Cyrillic names', () => {
    assert.equal(scriptTrick('раypal'), 'mixed', 'Cyrillic "ра" + Latin "ypal"');
    assert.equal(scriptTrick('аррӏе'), 'lookalike');
    assert.equal(scriptTrick('ბოქლომი'), null);
    assert.equal(scriptTrick('новости'), null);
    assert.equal(scriptTrick('example'), null);
    const fake = check('https://xn--80ak6aa92e.com/');
    assert.equal(fake.site, 'аррӏе.com', 'shown as the letters a person would see');
    assert.deepEqual(fake.warnings, ['lookalikeScript']);
    assert.deepEqual(check('https://xn--node.xn--node/').warnings, []);
  });

  it('flags the other classic tricks', () => {
    assert.deepEqual(check('http://example.com/').warnings, ['http']);
    assert.deepEqual(check('https://192.168.1.10/login').warnings, ['ip']);
    assert.deepEqual(check('https://google.com@evil.ge/').warnings, ['userinfo']);
    assert.equal(check('https://google.com@evil.ge/').site, 'evil.ge');
    assert.deepEqual(check('https://example.com:8443/').warnings, ['port']);
    assert.equal(check('https://example.com:8443/').details.port, '8443');
    assert.deepEqual(check('https://bit.ly/3abcd').warnings, ['shortener']);
    assert.deepEqual(check('https://a.b.c.d.example.com/').warnings, ['deepSubdomain']);
    assert.deepEqual(check('https://invoice.zip/').warnings, ['fileTld']);
    assert.deepEqual(check('https://example.com/files/Invoice.PDF.exe').warnings, ['download']);
    assert.equal(check('https://example.com/files/Invoice.PDF.exe').details.file, 'exe');
    assert.deepEqual(check('https://example.com/report.pdf').warnings, []);
  });

  it('looks through redirect pages and judges the real destination', () => {
    const report = check('https://l.facebook.com/l.php?u=http%3A%2F%2Fpaypal-verify.com%2Flogin');
    assert.equal(report.site, 'paypal-verify.com');
    assert.equal(report.details.via, 'l.facebook.com');
    assert.deepEqual(report.warnings, ['redirect', 'http', 'brandLookalike']);
  });

  it('accepts a link without https://, and rejects what is not a web link', () => {
    assert.equal(check('example.com/page').site, 'example.com');
    for (const input of ['', 'just words', 'javascript:alert(1)', 'data:text/html,<script>', 'mailto:a@example.com']) assert.equal(inspectLink(input).status, 'invalid', input);
  });

  it('never contacts the link', async () => {
    const source = await readFile(new URL('../src/client/tool-check.mjs', import.meta.url), 'utf8');
    assert.doesNotMatch(source, /fetch\(|XMLHttpRequest|location\.|window\.open|sendBeacon|Storage/);
  });
});

describe('links inside a pasted message', () => {
  it('finds links and leaves sentence punctuation out of them', () => {
    const text = 'Look (https://example.com/a?utm_source=x), then www.example.org/page. Or “https://ex.am/b”! And https://en.wikipedia.org/wiki/Tbilisi_(city).';
    assert.deepEqual(findLinks(text).map((link) => link.text), ['https://example.com/a?utm_source=x', 'www.example.org/page', 'https://ex.am/b', 'https://en.wikipedia.org/wiki/Tbilisi_(city)']);
    for (const link of findLinks(text)) assert.equal(text.slice(link.start, link.end), link.text);
    assert.deepEqual(findLinks('no links here, not even example.com'), []);
  });

  it('cleans every link in a message and leaves the words alone', () => {
    const result = cleanText('Hi!\nSee https://example.com/a?id=7&utm_source=news&fbclid=abc and https://example.org/b?x=1.\nBye');
    assert.deepEqual(result, {
      status: 'ok',
      url: 'Hi!\nSee https://example.com/a?id=7 and https://example.org/b?x=1.\nBye',
      removed: ['utm_source', 'fbclid'],
      unwrapped: [],
      links: 2,
    });
  });

  it('keeps a link with nothing to remove exactly as written', () => {
    const text = 'Read HTTPS://Example.com and www.example.org today';
    const result = cleanText(text);
    assert.equal(result.status === 'ok' && result.url, text);
  });

  it('treats a single link as before, and text without links as not a link', () => {
    const single = cleanText('  https://example.com/?utm_medium=x  ');
    assert.deepEqual(single, { status: 'ok', url: 'https://example.com/', removed: ['utm_medium'], unwrapped: [], links: 1 });
    assert.deepEqual(cleanText('just some words'), { status: 'invalid' });
    assert.deepEqual(cleanText('nonsense'), { status: 'invalid' });
  });

  it('link checker: judges the first link of a message and says how many there are', () => {
    const report = inspectLink('Your parcel is waiting: https://paypal.com.secure-login.ge/pay. Details: https://example.com');
    assert.equal(report.status === 'ok' && report.site, 'secure-login.ge');
    assert.equal(report.status === 'ok' && report.links, 2);
    assert.ok(report.status === 'ok' && report.warnings.includes('brandSubdomain'));
    const parcel = inspectLink('http://dhl.com.track-parcel.xyz/confirm');
    assert.deepEqual(parcel.status === 'ok' && parcel.warnings, ['http', 'brandSubdomain'], 'a parcel company in front of someone else’s site');
    const nested = inspectLink('https://www.mybank.com.secure-check.net/');
    assert.deepEqual(nested.status === 'ok' && [nested.warnings, nested.details.inner], [['nestedDomain'], 'mybank.com'], 'any complete-looking address in front of the real one');
    for (const fine of ['https://www.example.com/', 'https://mail.google.com/', 'https://en.wikipedia.org/', 'https://shop.example.co.uk/', 'https://my.gov.ge/', 'https://www.tbcbank.ge/', 'https://bog.ge/', 'https://www.dhl.com/track']) {
      const report = inspectLink(fine);
      assert.deepEqual(report.status === 'ok' && report.warnings, [], fine);
    }
    const one = inspectLink('https://example.com/');
    assert.equal(one.status === 'ok' && one.links, 1);
    assert.deepEqual(inspectLink('call me tomorrow please'), { status: 'invalid' });
  });
});

describe('link checker: an address inside an address', () => {
  it('finds a complete-looking address in the subdomains', () => {
    assert.equal(nestedDomain('dhl.com'), 'dhl.com');
    assert.equal(nestedDomain('www.paypal.com.secure'), 'paypal.com');
    assert.equal(nestedDomain('login.bank.ge.verify'), 'login.bank.ge');
    assert.equal(nestedDomain('www'), '');
    assert.equal(nestedDomain('mail'), '');
    assert.equal(nestedDomain('com'), '', 'an ending with nothing in front of it is just a name');
    assert.equal(nestedDomain('a.b.c'), '');
    assert.equal(nestedDomain(''), '');
  });
});

describe('password: time to guess', () => {
  it('goes from instantly to practically never as the password grows', () => {
    assert.equal(guessTime(entropyBits(['0123456789'], 6)), 'instant', 'a six-digit PIN');
    assert.equal(guessTime(entropyBits(['abcdefghijklmnopqrstuvwxyz'], 8)), 'instant');
    assert.equal(guessTime(47), 'minutes');
    assert.equal(guessTime(53), 'hours');
    assert.equal(guessTime(58), 'days');
    assert.equal(guessTime(63), 'months');
    assert.equal(guessTime(70), 'years');
    assert.equal(guessTime(80), 'centuries');
    assert.equal(guessTime(100), 'forever');
    const order = ['instant', 'minutes', 'hours', 'days', 'months', 'years', 'centuries', 'forever'];
    let last = 0;
    for (let bits = 1; bits <= 300; bits += 1) {
      const rank = order.indexOf(guessTime(bits));
      assert.ok(rank >= last, `never gets shorter (${bits} bits)`);
      last = rank;
    }
  });
});

describe('image redaction', () => {
  /** @param {object | null} box */
  const rounded = (box) => box && Object.fromEntries(Object.entries(box).map(([key, value]) => [key, typeof value === 'number' ? Math.round(value * 1000) / 1000 : value]));

  it('makes a box from a drag in any direction, kept inside the image', () => {
    assert.deepEqual(rounded(boxFromDrag({ x: 0.2, y: 0.3 }, { x: 0.6, y: 0.5 })), { x: 0.2, y: 0.3, w: 0.4, h: 0.2 });
    assert.deepEqual(rounded(boxFromDrag({ x: 0.6, y: 0.5 }, { x: 0.2, y: 0.3 })), { x: 0.2, y: 0.3, w: 0.4, h: 0.2 }, 'dragged up and to the left');
    assert.deepEqual(rounded(boxFromDrag({ x: 0.9, y: 0.9 }, { x: 1.4, y: 1.2 })), { x: 0.9, y: 0.9, w: 0.1, h: 0.1 }, 'released outside the image');
    assert.deepEqual(rounded(boxFromDrag({ x: -0.3, y: 0.1 }, { x: 0.1, y: 0.4 })), { x: 0, y: 0.1, w: 0.1, h: 0.3 });
    assert.equal(boxFromDrag({ x: 0.5, y: 0.5 }, { x: 0.502, y: 0.9 }), null, 'a slip, not a box');
  });

  it('moves and resizes a box without letting it leave the image or vanish', () => {
    const box = { x: 0.4, y: 0.4, w: 0.2, h: 0.2 };
    assert.deepEqual(rounded(moveBox(box, 0.1, -0.1)), { x: 0.5, y: 0.3, w: 0.2, h: 0.2 });
    assert.deepEqual(rounded(moveBox(box, 5, 5)), { x: 0.8, y: 0.8, w: 0.2, h: 0.2 });
    assert.deepEqual(rounded(moveBox(box, -5, -5)), { x: 0, y: 0, w: 0.2, h: 0.2 });
    assert.deepEqual(rounded(resizeBox(box, 0.1, 0.05)), { x: 0.4, y: 0.4, w: 0.3, h: 0.25 });
    assert.deepEqual(rounded(resizeBox(box, 5, 5)), { x: 0.4, y: 0.4, w: 0.6, h: 0.6 });
    assert.deepEqual(rounded(resizeBox(box, -5, -5)), { x: 0.4, y: 0.4, w: 0.01, h: 0.01 });
  });

  it('covers whole pixels: a box never leaves a sliver of what is under it', () => {
    assert.deepEqual(pixelRect({ x: 0.1, y: 0.1, w: 0.2, h: 0.2 }, 1000, 500), { x: 100, y: 50, w: 200, h: 100 });
    // 0.333 × 100 = 33.3 → starts at 33; (0.333 + 0.334) × 100 = 66.7 → ends at 67.
    assert.deepEqual(pixelRect({ x: 0.333, y: 0.333, w: 0.334, h: 0.334 }, 100, 100), { x: 33, y: 33, w: 34, h: 34 });
    assert.deepEqual(pixelRect({ x: 0.9, y: 0.9, w: 0.1, h: 0.1 }, 37, 23), { x: 33, y: 20, w: 4, h: 3 }, 'reaches the last pixel, not past it');
    for (const [width, height] of [[640, 480], [4032, 3024], [37, 23]]) {
      const box = { x: 0.123, y: 0.456, w: 0.321, h: 0.2 };
      const rect = pixelRect(box, width, height);
      assert.ok(rect.x <= box.x * width + 1e-6 && rect.x + rect.w >= (box.x + box.w) * width - 1e-6, 'covers the box horizontally');
      assert.ok(rect.y <= box.y * height + 1e-6 && rect.y + rect.h >= (box.y + box.h) * height - 1e-6, 'covers the box vertically');
    }
  });

  it('saves at full size, and scales down only images too large for a canvas', () => {
    assert.deepEqual(exportSize(4032, 3024), { width: 4032, height: 3024, scaled: false });
    const big = exportSize(8000, 6000);
    assert.equal(big.scaled, true);
    assert.ok(big.width * big.height <= 16_000_000);
    assert.ok(Math.abs(big.width / big.height - 8000 / 6000) < 0.001, 'keeps the proportions');
  });

  it('names the copy after the original and its saved type', () => {
    assert.equal(redactedName('Screenshot 2026-11-11.png', 'image/png'), 'Screenshot 2026-11-11-redacted.png');
    assert.equal(redactedName('IMG_1.HEIC', 'image/jpeg'), 'IMG_1-redacted.jpg');
    assert.equal(redactedName('', 'image/jpeg'), 'image-redacted.jpg');
  });

  it('finds the handle under a pointer, corners before edges', () => {
    const box = { x: 0.2, y: 0.2, w: 0.4, h: 0.2 };
    const reach = { x: 0.02, y: 0.02 };
    assert.equal(handleAt(box, { x: 0.21, y: 0.19 }, reach), 'nw');
    assert.equal(handleAt(box, { x: 0.6, y: 0.4 }, reach), 'se');
    assert.equal(handleAt(box, { x: 0.4, y: 0.21 }, reach), 'n');
    assert.equal(handleAt(box, { x: 0.61, y: 0.3 }, reach), 'e');
    assert.equal(handleAt(box, { x: 0.4, y: 0.3 }, reach), null, 'the middle is not a handle');
    assert.equal(handleAt(box, { x: 0.3, y: 0.2 }, reach), null, 'nor is the edge between two handles');
    // A box smaller than the reach: every handle is within range, and a corner is chosen.
    assert.equal(handleAt({ x: 0.5, y: 0.5, w: 0.01, h: 0.01 }, { x: 0.505, y: 0.505 }, reach), 'nw');
  });

  it('resizes from a handle with the opposite side fixed, never inside out or off the image', () => {
    const box = { type: /** @type {const} */ ('ellipse'), x: 0.2, y: 0.2, w: 0.4, h: 0.2 };
    assert.deepEqual(rounded(resizeFromHandle(box, 'se', { x: 0.8, y: 0.5 })), { type: 'ellipse', x: 0.2, y: 0.2, w: 0.6, h: 0.3 });
    assert.deepEqual(rounded(resizeFromHandle(box, 'nw', { x: 0.1, y: 0.1 })), { type: 'ellipse', x: 0.1, y: 0.1, w: 0.5, h: 0.3 });
    assert.deepEqual(rounded(resizeFromHandle(box, 'n', { x: 0.9, y: 0.3 })), { type: 'ellipse', x: 0.2, y: 0.3, w: 0.4, h: 0.1 }, 'an edge handle changes one direction only');
    assert.deepEqual(rounded(resizeFromHandle(box, 'w', { x: 0.9, y: 0.3 })), { type: 'ellipse', x: 0.59, y: 0.2, w: 0.01, h: 0.2 }, 'dragged past the other side: stops at the smallest size');
    assert.deepEqual(rounded(resizeFromHandle(box, 'se', { x: 3, y: 3 })), { type: 'ellipse', x: 0.2, y: 0.2, w: 0.8, h: 0.8 });
    assert.deepEqual(rounded(resizeFromHandle(box, 'nw', { x: -3, y: -3 })), { type: 'ellipse', x: 0, y: 0, w: 0.6, h: 0.4 });
  });

  it('knows whether a point is on a box, an ellipse or a marker stroke', () => {
    const area = { x: 0.2, y: 0.2, w: 0.4, h: 0.2 };
    assert.equal(hitShape({ type: 'box', ...area }, { x: 0.21, y: 0.21 }, 1), true);
    assert.equal(hitShape({ type: 'ellipse', ...area }, { x: 0.21, y: 0.21 }, 1), false, 'the corner of an ellipse’s frame is outside it');
    assert.equal(hitShape({ type: 'ellipse', ...area }, { x: 0.4, y: 0.3 }, 1), true);
    assert.equal(hitShape({ type: 'box', ...area }, { x: 0.7, y: 0.3 }, 1), false);

    const stroke = { type: /** @type {const} */ ('line'), points: [{ x: 0.2, y: 0.5 }, { x: 0.8, y: 0.5 }], size: 0.04 };
    assert.equal(hitShape(stroke, { x: 0.5, y: 0.515 }, 1), true, 'within half the thickness');
    assert.equal(hitShape(stroke, { x: 0.5, y: 0.53 }, 1), false);
    assert.equal(hitShape(stroke, { x: 0.81, y: 0.5 }, 1), true, 'the round end');
    assert.equal(hitShape(stroke, { x: 0.83, y: 0.5 }, 1), false);
    // On a 2:1 image the stroke covers twice the fraction of the height.
    assert.equal(hitShape(stroke, { x: 0.5, y: 0.53 }, 2), true);
    const dot = { type: /** @type {const} */ ('line'), points: [{ x: 0.5, y: 0.5 }], size: 0.1 };
    assert.equal(hitShape(dot, { x: 0.54, y: 0.5 }, 1), true, 'a single tap is a dot');
    assert.equal(hitShape(dot, { x: 0.56, y: 0.5 }, 1), false);
  });

  it('frames and moves a marker stroke without letting it leave the image', () => {
    const stroke = { type: /** @type {const} */ ('line'), points: [{ x: 0.2, y: 0.4 }, { x: 0.5, y: 0.6 }], size: 0.04 };
    assert.deepEqual(rounded(shapeBounds(stroke, 1)), { x: 0.18, y: 0.38, w: 0.34, h: 0.24 });
    assert.deepEqual(rounded(shapeBounds(stroke, 2)), { x: 0.18, y: 0.36, w: 0.34, h: 0.28 });
    assert.deepEqual(rounded(shapeBounds({ ...stroke, points: [{ x: 0, y: 1 }] }, 1)), { x: 0, y: 0.98, w: 0.02, h: 0.02 }, 'cut at the image’s edge');
    assert.deepEqual(shapeBounds({ type: 'box', x: 0.1, y: 0.2, w: 0.3, h: 0.4 }, 1), { x: 0.1, y: 0.2, w: 0.3, h: 0.4 });

    const point = (/** @type {{ x: number, y: number }} */ p) => [Math.round(p.x * 1000) / 1000, Math.round(p.y * 1000) / 1000];
    assert.deepEqual(moveShape(stroke, 0.1, -0.1).points.map(point), [[0.3, 0.3], [0.6, 0.5]]);
    assert.deepEqual(moveShape(stroke, 9, 9).points.map(point), [[0.7, 0.8], [1, 1]], 'stops at the edge and keeps its form');
    assert.deepEqual(moveShape(stroke, -9, -9).points.map(point), [[0, 0], [0.3, 0.2]]);
    assert.deepEqual(rounded(moveShape({ type: 'ellipse', x: 0.4, y: 0.4, w: 0.2, h: 0.2 }, 5, 5)), { type: 'ellipse', x: 0.8, y: 0.8, w: 0.2, h: 0.2 });
  });

  it('crops inwards: the copy never includes a pixel from outside the outline', () => {
    assert.deepEqual(outputFrame(1000, 500, null), { sx: 0, sy: 0, sw: 1000, sh: 500, width: 1000, height: 500, scaled: false });
    assert.deepEqual(outputFrame(1000, 500, { x: 0.1, y: 0.2, w: 0.5, h: 0.6 }), { sx: 100, sy: 100, sw: 500, sh: 300, width: 500, height: 300, scaled: false });
    // 0.333 × 100 = 33.3 → first whole pixel inside is 34; ends at 66.7 → 66.
    assert.deepEqual(outputFrame(100, 100, { x: 0.333, y: 0.333, w: 0.334, h: 0.334 }), { sx: 34, sy: 34, sw: 32, sh: 32, width: 32, height: 32, scaled: false });
    for (const [width, height] of [[640, 480], [4032, 3024], [37, 23]]) {
      const crop = { x: 0.123, y: 0.456, w: 0.321, h: 0.2 };
      const frame = outputFrame(width, height, crop);
      assert.ok(frame.sx >= crop.x * width - 1e-6 && frame.sx + frame.sw <= (crop.x + crop.w) * width + 1e-6, 'inside horizontally');
      assert.ok(frame.sy >= crop.y * height - 1e-6 && frame.sy + frame.sh <= (crop.y + crop.h) * height + 1e-6, 'inside vertically');
    }
    const sliver = outputFrame(10, 10, { x: 0.99, y: 0.99, w: 0.01, h: 0.01 });
    assert.deepEqual([sliver.sx, sliver.sy, sliver.sw, sliver.sh], [9, 9, 1, 1], 'never empty, never past the image');
    assert.equal(outputFrame(8000, 6000, null).scaled, true);
    assert.equal(outputFrame(8000, 6000, { x: 0, y: 0, w: 0.5, h: 0.5 }).scaled, false, 'a crop of a huge image may fit as it is');
  });

  it('places covered areas correctly in a cropped copy, still rounded outwards', () => {
    const frame = outputFrame(1000, 500, { x: 0.1, y: 0.2, w: 0.5, h: 0.6 });
    assert.deepEqual(frameRect({ x: 0.2, y: 0.4, w: 0.1, h: 0.2 }, 1000, 500, frame), { x: 100, y: 100, w: 100, h: 100 });
    assert.deepEqual(frameRect({ x: 0, y: 0, w: 0.3, h: 0.5 }, 1000, 500, frame), { x: 0, y: 0, w: 200, h: 150 }, 'cut at the crop’s edge');
    assert.deepEqual(frameRect({ x: 0.8, y: 0.1, w: 0.1, h: 0.05 }, 1000, 500, frame).w, 0, 'outside the crop: nothing to draw');
    // Scaled down 2×: 0.2005 × 1000 = 200.5 → 100.5 px in the crop → 50.25 → covers from pixel 50.
    const small = { ...frame, width: 250, height: 150 };
    assert.deepEqual(frameRect({ x: 0.2005, y: 0.4, w: 0.1, h: 0.2 }, 1000, 500, small), { x: 50, y: 50, w: 51, h: 50 });
  });

  it('undoes and redoes, dropping the undone steps once something new is drawn', () => {
    /** @param {number} n @returns {import('../src/client/tool-redact.mjs').Drawing} */
    const state = (n) => ({ shapes: Array.from({ length: n }, () => ({ type: /** @type {const} */ ('box'), x: 0, y: 0, w: 0.1, h: 0.1 })), crop: null });
    const count = (/** @type {import('../src/client/tool-redact.mjs').History} */ h) => currentDrawing(h).shapes.length;
    let history = createHistory(state(0));
    history = commit(commit(commit(history, state(1)), state(2)), state(3));
    assert.equal(count(history), 3);
    history = undo(undo(history));
    assert.equal(count(history), 1);
    assert.equal(count(redo(history)), 2);
    history = commit(history, state(7));
    assert.equal(count(history), 7);
    assert.equal(count(redo(history)), 7, 'the undone steps are gone');
    assert.equal(count(undo(history)), 1);
    assert.equal(count(undo(undo(undo(undo(history))))), 0, 'stops at the start');
  });

  it('counts a run of arrow key presses as one step, and keeps a bounded history', () => {
    /** @param {number} x @returns {import('../src/client/tool-redact.mjs').Drawing} */
    const at = (x) => ({ shapes: [{ type: 'box', x, y: 0, w: 0.1, h: 0.1 }], crop: null });
    const x = (/** @type {import('../src/client/tool-redact.mjs').History} */ h) => /** @type {import('../src/client/tool-redact.mjs').Area} */ (currentDrawing(h).shapes[0]).x;
    let history = createHistory(at(0));
    for (const step of [0.01, 0.02, 0.03]) history = commit(history, at(step), 'move:0');
    assert.equal(history.entries.length, 2);
    assert.equal(x(history), 0.03);
    assert.equal(x(undo(history)), 0, 'one undo takes the whole run back');
    history = commit(history, at(0.5), 'resize:0');
    assert.equal(history.entries.length, 3, 'a different kind of change is its own step');
    history = commit(undo(history), at(0.04), 'move:0');
    assert.equal(x(undo(history)), 0.03, 'after an undo a new run starts');

    for (let step = 0; step < 300; step += 1) history = commit(history, at(step / 1000));
    assert.equal(history.entries.length, 100);
    assert.equal(history.index, 99);
  });

  it('zooms in fixed steps and keeps the editing canvas within what a browser can hold', () => {
    assert.deepEqual(ZOOMS.map((zoom) => stepZoom(zoom, 1)), [1.5, 2, 3, 4, 4]);
    assert.deepEqual(ZOOMS.map((zoom) => stepZoom(zoom, -1)), [1, 1, 1.5, 2, 3]);
    assert.deepEqual(previewSize(4000, 3000, 1), { width: 1600, height: 1200 });
    assert.deepEqual(previewSize(4000, 3000, 2), { width: 3200, height: 2400 });
    assert.deepEqual(previewSize(800, 600, 4), { width: 800, height: 600 }, 'never larger than the image');
    const tall = previewSize(1200, 30000, 1);
    assert.ok(tall.width * tall.height <= 8_000_000, 'a very long screenshot is scaled to fit');
    assert.ok(Math.abs(tall.width / tall.height - 1200 / 30000) < 0.001);
  });

  it('keeps the image in the page: no network, storage or URL in the tool', async () => {
    const source = await readFile(new URL('../src/client/tool-redact.mjs', import.meta.url), 'utf8');
    assert.doesNotMatch(source, /fetch\(|XMLHttpRequest|sendBeacon|WebSocket|localStorage|sessionStorage|location\./);
    assert.doesNotMatch(source, /context\.filter/, 'solid boxes only: no blur');
  });
});

describe('browser check', () => {
  /** @param {string[]} matching  Media queries that match. */
  const media = (matching) => (/** @type {string} */ query) => matching.includes(query);
  const env = {
    navigator: {
      languages: ['ka-GE', 'en-US'], userAgent: 'TestBrowser/1.0', platform: 'iPhone', hardwareConcurrency: 8, deviceMemory: 4, maxTouchPoints: 5,
      cookieEnabled: true, doNotTrack: '1', globalPrivacyControl: true, connection: { effectiveType: '4g', downlink: 10, saveData: true },
    },
    screen: { width: 390, height: 844, colorDepth: 24 },
    window: { innerWidth: 390, innerHeight: 700, devicePixelRatio: 3 },
    timeZone: 'Asia/Tbilisi',
    offsetMinutes: -240,
    media: media(['(prefers-color-scheme: dark)', '(prefers-reduced-motion: reduce)', '(color-gamut: p3)', '(color-gamut: srgb)', '(dynamic-range: high)']),
    referrer: '',
  };

  it('reports what the browser exposes', () => {
    assert.deepEqual(browserFacts(env), {
      languages: 'ka-GE, en-US',
      timeZone: 'Asia/Tbilisi (UTC+4)',
      userAgent: 'TestBrowser/1.0',
      platform: 'iPhone',
      cores: '8',
      memory: '4 GB',
      screen: '390 × 844, ×3',
      window: '390 × 700',
      colors: '24-bit, P3, HDR',
      touch: 'yes',
      theme: 'dark',
      motion: 'on',
      contrast: 'off',
      cookies: 'yes',
      dnt: 'on',
      gpc: 'on',
      connection: '4g, 10 Mbps, data saver',
      referrer: 'none',
    });
  });

  it('says so when a browser does not expose a value', () => {
    const facts = browserFacts({ ...env, navigator: { language: 'en' }, screen: { width: 390, height: 844 }, window: { innerWidth: 1200, innerHeight: 800 }, media: media([]), referrer: 'https://example.com/' });
    assert.equal(facts.languages, 'en');
    assert.equal(facts.screen, '390 × 844');
    assert.deepEqual([facts.cores, facts.memory, facts.userAgent, facts.platform, facts.colors, facts.connection], ['unknown', 'unknown', 'unknown', 'unknown', 'unknown', 'unknown']);
    assert.deepEqual([facts.touch, facts.cookies, facts.dnt, facts.gpc, facts.theme, facts.motion], ['no', 'no', 'unset', 'unsupported', 'light', 'off']);
    assert.equal(facts.referrer, 'https://example.com/');
    assert.equal(browserFacts({ ...env, navigator: { doNotTrack: '0', globalPrivacyControl: false } }).dnt, 'off');
    assert.equal(browserFacts({ ...env, navigator: { globalPrivacyControl: false } }).gpc, 'off');
    assert.equal(browserFacts({ ...env, media: media(['(prefers-contrast: more)']) }).contrast, 'on');
  });

  it('formats time zone offsets, including half hours and zones behind UTC', () => {
    assert.equal(utcOffset(-240), 'UTC+4');
    assert.equal(utcOffset(0), 'UTC+0');
    assert.equal(utcOffset(300), 'UTC-5');
    assert.equal(utcOffset(-330), 'UTC+5:30');
    assert.equal(utcOffset(210), 'UTC-3:30');
  });

  it('builds the fingerprint from stable details only, in a fixed order', () => {
    const facts = { ...browserFacts(env), gpu: 'Apple GPU', canvas: 'aaaa-bbbb-cccc' };
    const source = fingerprintSource(facts);
    assert.match(source, /^canvas=aaaa-bbbb-cccc\ncolors=24-bit, P3, HDR\n/);
    assert.doesNotMatch(source, /window=|referrer=|connection=/, 'things that change while browsing would break recognition');
    const resized = { ...facts, window: '100 × 100', referrer: 'https://example.com/', connection: '3g' };
    assert.equal(fingerprintSource(resized), source);
    assert.notEqual(fingerprintSource({ ...facts, gpu: 'Other GPU' }), source);
    assert.equal(fingerprintSource(Object.fromEntries(Object.entries(facts).reverse())), source, 'the order the facts were read in does not matter');
  });

  it('detects a font when text set in it differs in width from a generic fallback', () => {
    /** @param {string} family */
    const width = (family) => (family.includes('Calibri') ? 111 : family.includes('Sylfaen') && family.includes('serif') && !family.includes('sans') ? 222 : family.includes('monospace') ? 100 : family.includes('sans-serif') ? 90 : 95);
    assert.deepEqual(detectFonts(['Arial', 'Calibri', 'Sylfaen', 'Nonexistent'], width), ['Calibri', 'Sylfaen']);
    assert.deepEqual(detectFonts(FONTS, () => 100), [], 'identical widths everywhere: nothing detected');
    assert.equal(new Set(FONTS).size, FONTS.length);
  });

  it('autofill demonstration: reports hidden fields that hold a value, and nothing when only typing by hand', () => {
    const fields = [
      { label: 'Phone', value: ' +995 555 12 34 56 ' },
      { label: 'Company', value: '' },
      { label: 'City', value: 'Tbilisi' },
      { label: 'Postal code', value: '   ' },
    ];
    assert.deepEqual(autofillLeak(fields), [{ label: 'Phone', value: '+995 555 12 34 56' }, { label: 'City', value: 'Tbilisi' }]);
    assert.deepEqual(autofillLeak(fields.map((field) => ({ ...field, value: '' }))), []);
  });

  it('keeps what it reads in the page: no network, storage or URL in the tool', async () => {
    const source = await readFile(new URL('../src/client/tool-browser.mjs', import.meta.url), 'utf8');
    assert.doesNotMatch(source, /fetch\(|XMLHttpRequest|sendBeacon|WebSocket|RTCPeerConnection|localStorage|sessionStorage|location\.|history\./);
    assert.match(source, /window\.addEventListener\('pagehide', clear\)/, 'autofilled values are erased on leaving');
  });

  it('has a translated word for every token, in both languages', async () => {
    for (const lang of ['ka', 'en']) {
      const strings = JSON.parse(await readFile(new URL(`../content/i18n/${lang}.json`, import.meta.url), 'utf8'));
      const known = Object.keys(strings.tools.items.browser.tokens);
      for (const token of ['yes', 'no', 'on', 'off', 'unset', 'unsupported', 'none', 'dark', 'light', 'unknown']) assert.ok(known.includes(token), `${lang}: token "${token}"`);
    }
  });
});

describe('tool pages', () => {
  /** @type {string} */
  let dir;
  /** @param {string} path */
  const read = (path) => readFile(join(dir, 'dist', path), 'utf8');

  before(async () => {
    dir = await mkdtemp(join(tmpdir(), 'lockwell-tools-'));
    await build({ outDir: join(dir, 'dist'), siteUrl: 'https://example.org/' });
  });

  after(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('builds an index and a page per tool in both languages, in the sitemap', async () => {
    const index = await read('en/tools/index.html');
    const sitemap = await read('sitemap.xml');
    for (const tool of TOOLS) {
      assert.match(index, new RegExp(`<a class="card__link" href="/en/tools/${tool.slug}/">`));
      assert.match(await read(`tools/${tool.slug}/index.html`), /<html lang="ka"/);
      const page = await read(`en/tools/${tool.slug}/index.html`);
      assert.match(page, new RegExp(`data-js="tool" data-tool="${tool.key}"`));
      assert.match(page, /"@type":"WebApplication"/);
      assert.match(sitemap, new RegExp(`<loc>https://example\\.org/en/tools/${tool.slug}/</loc>`));
    }
    assert.match(await read('en/index.html'), /aria-labelledby="home__tools"/);
  });

  it('without JavaScript the page says the tool needs it, and still explains the tool', async () => {
    const page = await read('en/tools/password-generator/index.html');
    assert.match(page, /<p class="draft-notice no-js-only" data-js="tool-fallback">/);
    assert.match(page, /<section class="tool js-only"/);
    assert.match(page, /<h2 id="tool__notes">Good to know<\/h2>\s*<p>Every character is picked/);
    const css = await read('assets/site.css');
    assert.match(css, /\.js \.no-js-only:not\(\.is-visible\) \{\s*display: none;/);
  });

  it('loads a tool’s code only on its own page, with the shared version', async () => {
    const loader = await read('assets/js/tools.mjs');
    for (const tool of TOOLS) assert.match(loader, new RegExp(`import\\('\\./tool-${tool.key}\\.mjs\\?v=[0-9a-f]{10}'\\)`));
    assert.doesNotMatch(await read('assets/js/main.mjs'), /tool-(password|links|photo|browser)\.mjs/);
  });

  it('keeps the strict CSP: no blob:, data: or inline allowances were added for the tools', async () => {
    const csp = /Content-Security-Policy" content="([^"]+)"/.exec(await read('en/tools/photo-metadata/index.html'))?.[1] ?? '';
    assert.match(csp, /connect-src 'none'/);
    assert.doesNotMatch(csp, /blob:|data:|unsafe/);
  });

  it('header: Tools is linked everywhere; About is a wide-screen header link', async () => {
    const page = await read('en/tools/index.html');
    assert.match(page, /<li><a class="site-nav__link" href="\/en\/tools\/" aria-current="page">Tools<\/a><\/li>/);
    assert.match(page, /<li class="site-nav__item--wide"><a class="site-nav__link" href="\/en\/about\/">About<\/a><\/li>/);
  });

  it('every label a tool can show exists in the page (the client builds no text of its own)', async () => {
    const photo = await read('en/tools/photo-metadata/index.html');
    for (const row of ['location', 'camera', 'taken', 'software', 'exif', 'xmp', 'iptc', 'comment', 'thumbnail', 'trailing', 'text', 'other']) {
      assert.match(photo, new RegExp(`<div class="facts__row" data-row="${row}" hidden><dt>[^<]+</dt>`), row);
    }
    for (const message of ['found', 'none', 'unsupported', 'heic', 'too-large', 'damaged']) assert.match(photo, new RegExp(`data-${message}="[^"]+"`), message);
    const browser = await read('en/tools/browser-check/index.html');
    const instant = Object.keys(browserFacts({ navigator: {}, screen: { width: 1, height: 1 }, window: { innerWidth: 1, innerHeight: 1 }, timeZone: '', offsetMinutes: 0, media: () => false, referrer: '' }));
    for (const key of [...instant, 'os', 'model', 'gpu', 'canvas', 'fonts', 'fingerprint']) {
      assert.match(browser, new RegExp(`data-row="${key}"`), key);
    }
  });

  it('UX-8: file tools have a chooser in the page\'s language, built on a real file input', async () => {
    const strings = {
      'en/': JSON.parse(await readFile(join('content', 'i18n', 'en.json'), 'utf8')).tools,
      '': JSON.parse(await readFile(join('content', 'i18n', 'ka.json'), 'utf8')).tools,
    };
    for (const [lang, t] of Object.entries(strings)) {
      for (const [slug, id] of [['photo-metadata', 'photo'], ['image-redaction', 'redact'], ['document-metadata', 'document']]) {
        const page = await read(`${lang}tools/${slug}/index.html`);
        const box = /<div class="file">([\s\S]*?)<\/div>/.exec(page)?.[1] ?? '';
        assert.match(box, new RegExp(`^\\s*<input class="file__input" type="file" id="${id}__file" accept="[^"]+" data-js="${id}-file">`), `${lang}${slug}: a real input, first so the focus ring rule can reach the button`);
        assert.ok(page.includes(`<label class="field__label" for="${id}__file">${t.items[id].file}</label>`), `${lang}${slug}: the input has a visible label`);
        // What the visitor sees is ours; screen readers get the native control, so the copies are hidden from them.
        assert.ok(box.includes(`<span>${t.chooseFile}</span></span>`), `${lang}${slug}: button text`);
        assert.ok(box.includes(`<span class="file__name" aria-hidden="true" data-js="file-name" data-empty="${t.noFile}">${t.noFile}</span>`), `${lang}${slug}: "no file" text, also kept for when the choice is cleared`);
        assert.match(box, /<span class="button button--ghost button--small file__button" aria-hidden="true">/);
        assert.equal((page.match(/type="file"/g) ?? []).length, 1);
      }
    }
    assert.notEqual(strings[''].chooseFile, strings['en/'].chooseFile, 'Georgian has its own wording');
    const css = await read('assets/site.css');
    assert.match(css, /\.file__input \{[^}]*opacity: 0;/, 'the native text (in the browser\'s language) is not shown');
    assert.match(css, /\.file__input:focus-visible ~ \.file__button \{\s*outline: 3px solid var\(--color-focus\);/, 'keyboard focus stays visible');
  });

  it('UX-9: paste and drop hints name no keyboard shortcut (phones have none)', async () => {
    for (const lang of ['', 'en/']) {
      for (const slug of ['photo-metadata', 'image-redaction', 'document-metadata']) {
        const hint = /<\/div>\s*<p class="facts__why">([^<]+)<\/p>/.exec(await read(`${lang}tools/${slug}/index.html`))?.[1] ?? '';
        assert.ok(hint.length > 10, `${lang}${slug} has a hint under the chooser`);
        assert.doesNotMatch(hint, /Ctrl|⌘|Cmd/);
      }
    }
  });

  it('the password generator starts with every character set on and look-alikes allowed', async () => {
    const page = await read('en/tools/password-generator/index.html');
    const checked = Object.fromEntries([...page.matchAll(/<input class="checkbox checkbox--small" type="checkbox" id="password__(\w+)" data-js="password-\w+"( checked)?>/g)].map((m) => [m[1], Boolean(m[2])]));
    assert.deepEqual(checked, { lower: true, upper: true, digits: true, symbols: true, avoid: false });
    assert.match(page, /value="password" data-js="password-mode" checked>/);
    assert.doesNotMatch(page, /value="pin" data-js="password-mode" checked>/);
  });

  it('the browser report explains the IP address once, in the network group', async () => {
    const page = await read('en/tools/browser-check/index.html');
    const groups = [...page.matchAll(/<section class="report__group" aria-labelledby="browser__(\w+)">([\s\S]*?)<\/section>/g)];
    assert.deepEqual(groups.map((m) => m[1]), ['place', 'device', 'settings', 'signature', 'network']);
    const withIp = groups.filter((m) => m[2].includes('<dt>IP address</dt>')).map((m) => m[1]);
    assert.deepEqual(withIp, ['network']);
  });

  it('document and hidden-character pages hold every row and message their code can show', async () => {
    const page = await read('en/tools/document-metadata/index.html');
    for (const row of ['author', 'lastAuthor', 'company', 'manager', 'title', 'subject', 'keywords', 'comments', 'created', 'modified', 'printed', 'revision', 'editTime', 'software', 'template', 'producer', 'tracked', 'commentsPart', 'custom', 'xmp']) {
      assert.match(page, new RegExp(`<div class="facts__row" data-row="${row}" hidden><dt>[^<]+</dt><dd[^>]*>`), row);
    }
    for (const message of ['found', 'none', 'unsupported', 'old', 'too-large', 'damaged', 'browser']) assert.match(page, new RegExp(`data-${message}="[^"]+"`), message);
    for (const name of ['document-file', 'document-facts', 'document-save', 'document-download', 'document-pdf', 'document-kept']) assert.match(page, new RegExp(`data-js="${name}"`), name);

    for (const lang of ['', 'en/']) {
      const hidden = await read(`${lang}tools/hidden-characters/index.html`);
      for (const kind of HIDDEN_KINDS) assert.match(hidden, new RegExp(`data-row="${kind}" hidden>\\s*<dt><span data-js="hidden-name">[^<]+</span>`), kind);
      for (const name of ['input', 'result', 'summary', 'details', 'secret', 'truncated', 'marked', 'clean']) assert.match(hidden, new RegExp(`data-js="hidden-${name}"`), name);
      assert.match(hidden, /data-js="copy" data-copy-from="hidden-clean" data-status="hidden-clean-status"/);
      assert.match(hidden, /data-template="[^"]*\{text\}"/);
    }
  });

  it('image redaction page holds every control and message its code uses', async () => {
    for (const lang of ['', 'en/']) {
      const page = await read(`${lang}tools/image-redaction/index.html`);
      for (const name of ['file', 'message', 'editor', 'view', 'canvas', 'count', 'size', 'zoom-value', 'zoom-in', 'zoom-out', 'undo', 'redo', 'remove', 'uncrop', 'clear', 'check', 'result', 'result-canvas', 'result-info', 'result-status', 'download', 'copy']) {
        assert.match(page, new RegExp(`data-js="redact-${name}"`), name);
      }
      for (const mode of ['box', 'ellipse', 'marker', 'crop']) assert.match(page, new RegExp(`data-js="redact-mode" data-mode="${mode}"`), mode);
      for (const message of ['unsupported', 'too-large', 'resized', 'encode-failed', 'template', 'cropped', 'done', 'failed']) assert.match(page, new RegExp(`data-${message}="[^"]+"`), message);
      assert.match(page, /<button class="[^"]*button--icon" type="button" aria-label="[^"]+" title="[^"]+" data-js="redact-zoom-in">/, 'icon-only buttons have a name');
    }
    const css = await read('assets/site.css');
    for (const zoom of ZOOMS.filter((zoom) => zoom !== 1)) assert.ok(css.includes(`.redact__view[data-zoom="${zoom}"] .redact__canvas`), `a width for zoom ${zoom}`);
  });

  it('pages say how the tool compares with asking an AI service, where that matters', async () => {
    for (const lang of ['', 'en/']) {
      for (const tool of TOOLS) {
        const page = await read(`${lang}tools/${tool.slug}/index.html`);
        const section = /<h2 id="tool__ai">[^<]+<\/h2>((?:\s*<p>[^<]+<\/p>)*)/.exec(page);
        assert.equal(section ? (section[1].match(/<p>/g) ?? []).length : 0, tool.ai, `${lang}${tool.slug}`);
      }
    }
    assert.match(await read('en/tools/image-redaction/index.html'), /the service has to receive the original/);
  });

  it('password, link and file tools hold the labels for their newer features', async () => {
    const password = await read('en/tools/password-generator/index.html');
    for (const time of ['instant', 'minutes', 'hours', 'days', 'months', 'years', 'centuries', 'forever']) assert.match(password, new RegExp(`data-js="password-time"[^>]* data-${time}="[^"]+"`), time);
    assert.match(await read('en/tools/link-cleaner/index.html'), /data-several="[^"]*\{n\}/);
    assert.match(await read('en/tools/link-checker/index.html'), /data-js="check-several" data-template="[^"]*\{n\}/);
    assert.match(await read('en/tools/photo-metadata/index.html'), /paste a photo/);
    assert.match(await read('en/tools/document-metadata/index.html'), /drop a file here/);
  });

  it('autofill demonstration: two visible fields, six unseen ones, and a form that can go nowhere', async () => {
    const page = await read('en/tools/browser-check/index.html');
    assert.equal((page.match(/data-js="autofill-visible"/g) ?? []).length, 2);
    assert.equal((page.match(/data-js="autofill-hidden"/g) ?? []).length, 6);
    assert.match(page, /<div class="autofill__unseen" aria-hidden="true">/);
    assert.match(page, /autocomplete="street-address" tabindex="-1" data-js="autofill-hidden" data-label="Street address"/);
    assert.doesNotMatch(page, /autocomplete="cc-|type="password"/, 'no card or password fields');
    assert.doesNotMatch(page, /<form[^>]*\saction=/, 'the form has nowhere to send anything');
    assert.match(page, /form-action 'none'/, 'and the CSP forbids sending');
    assert.match(page, /<div class="autofill__result" data-js="autofill-result" hidden>/);
  });
});

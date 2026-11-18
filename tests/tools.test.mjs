// @ts-check
/**
 * @file Tests for the tools: pure logic and page labels.
 */
/** The tools under /tools/: their pure logic, and the pages the build writes for them. */
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { build } from '../src/build/build.mjs';
import { TOOLS, TOOL_GROUPS } from '../src/build/tools.mjs';
import { FONTS, TRACE_URL, autofillLeak, browserFacts, canvasNoise, canvasPattern, compareFacts, detectFonts, detectProtections, fingerprintSource, layoutSample, parseTrace, protectionNotes, rememberedFacts, utcOffset } from '../src/client/tool-browser.mjs';
import { imitatedBrand, inspectLink, nestedDomain, oneEditApart, punycodeDecode, scriptTrick, siteOf, unicodeHost } from '../src/client/tool-check.mjs';
import { KINDS as HIDDEN_KINDS } from '../src/client/tool-hidden.mjs';
import { EXPECTED_KINDS, FINDINGS as ATTACHMENT_FINDINGS } from '../src/client/tool-attachment.mjs';
import { cleanText, cleanUrl, findLinks, isTracking } from '../src/client/tool-links.mjs';
import { ZOOMS, boxFromDrag, checkCovered, commit, createHistory, currentDrawing, exportSize, frameRect, handleAt, hitShape, isAnimated, moveBox, moveShape, outputFrame, pinchZoom, pixelRect, previewGrow, previewSize, redo, resizeBox, resizeFromHandle, shapeBounds, stepZoom, straightEnd, undo, unsavedWork } from '../src/client/tool-redact.mjs';
import { charSets, entropyBits, generatePassphrase, generatePassword, guessTime, passphraseBits, pinOdds, randomInt, strengthOf } from '../src/client/tool-password.mjs';
import { WORDS } from '../src/client/wordlist-en.mjs';

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
    assert.equal(siteOf('login.example.com').site, 'example.com');
    assert.equal(siteOf('a.b.example.com.ge').site, 'example.com.ge');
    assert.equal(siteOf('shop.example.co.uk').site, 'example.co.uk');
    assert.equal(siteOf('example.ge').site, 'example.ge');
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
    assert.deepEqual(check('https://faceboook.com/').warnings, ['typo'], 'a doubled letter is a sign on its own');
    assert.deepEqual(check('https://netfliix.com/').warnings, ['typo']);
    assert.deepEqual(check('https://arnazon.com/').warnings, ['typo'], '"rn" passing for "m"');
    assert.equal(oneEditApart('amazon', 'amazno'), true, 'swapped neighbours');
    assert.equal(oneEditApart('amazon', 'amazon'), false);
    assert.equal(oneEditApart('amazon', 'amaz'), false);
  });

  it('does not cry wolf at real addresses', () => {
    for (const link of [
      'https://www.google.com/search?q=privacy', 'https://google.ge/', 'https://www.amazon.de/dp/B0', 'https://accounts.google.com/',
      'https://www.tbcbank.ge/', 'https://bankofgeorgia.ge/', 'https://web.whatsapp.com/', 'https://pineapple.com/', 'https://lockwell.org/guides/accounts/',
      'https://en.wikipedia.org/wiki/Signal_(software)', 'https://signal.org/download/', 'https://my.gov.ge/',
    ]) {
      assert.deepEqual(check(link).warnings, [], link);
    }
    assert.equal(imitatedBrand('example', 'example.com', 'www'), null);
    // Places where anyone can publish are named as such, whoever owns the site.
    for (const link of ['https://lh3.googleusercontent.com/x', 'https://t.me/durov']) assert.deepEqual(check(link).warnings, ['publicPage'], link);
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
    for (const input of ['', 'just words']) assert.equal(inspectLink(input).status, 'invalid', input);
    // Addresses that are not web links say what they are (tests/link-check.test.mjs).
    for (const input of ['javascript:alert(1)', 'data:text/html,<script>', 'mailto:a@example.com']) assert.equal(inspectLink(input).status, 'scheme', input);
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
      parts: [
        { text: 'Hi!\nSee https://example.com/a?id=7', removed: false },
        { text: '&utm_source=news&fbclid=abc', removed: true },
        { text: ' and https://example.org/b?x=1.\nBye', removed: false },
      ],
      shared: [],
      lookup: [],
      short: [],
      emails: [],
      secrets: [],
    });
  });

  it('keeps a link with nothing to remove exactly as written', () => {
    const text = 'Read HTTPS://Example.com and www.example.org today';
    const result = cleanText(text);
    assert.equal(result.status === 'ok' && result.url, text);
  });

  it('treats a single link as before, and text without links as not a link', () => {
    const single = cleanText('  https://example.com/?utm_medium=x  ');
    assert.deepEqual(single, {
      status: 'ok',
      url: 'https://example.com/',
      removed: ['utm_medium'],
      unwrapped: [],
      links: 1,
      parts: [{ text: 'https://example.com/', removed: false }, { text: '?utm_medium=x', removed: true }],
      shared: [],
      lookup: [],
      short: [],
      emails: [],
      secrets: [],
    });
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

describe('password generator: passphrases and PINs', () => {
  const words = WORDS.split(' ');

  it('uses EFF’s long list: 7,776 different words', () => {
    assert.equal(words.length, 7776);
    assert.equal(new Set(words).size, 7776);
    assert.ok(words.every((word) => /^[a-z]+(-[a-z]+)?$/.test(word)));
  });

  it('builds a passphrase from random words, with an optional capital and digit', () => {
    let calls = 0;
    const fixed = (/** @type {number} */ max) => (calls++ % max);
    assert.equal(generatePassphrase(['alpha', 'bravo', 'charlie'], 3, { separator: '-', capital: false, digit: false }, fixed), 'alpha-bravo-charlie');
    calls = 0;
    const phrase = generatePassphrase(['alpha', 'bravo', 'charlie'], 3, { separator: ' ', capital: true, digit: true }, fixed);
    assert.match(phrase, /^\S+ \S+ \S+$/);
    assert.equal((phrase.match(/[A-Z]/g) ?? []).length, 1, 'one capital letter');
    assert.equal((phrase.match(/\d/g) ?? []).length, 1, 'one digit');
    const real = generatePassphrase(words, 6, { separator: '.', capital: false, digit: false });
    assert.equal(real.split('.').length >= 6, true);
  });

  it('counts the strength honestly: 12.9 bits a word, plus what the capital and digit really add', () => {
    assert.equal(passphraseBits(7776, 6, { capital: false, digit: false }), 77);
    assert.equal(passphraseBits(7776, 6, { capital: true, digit: false }), 80, 'which of six words: log2(6) more');
    assert.equal(passphraseBits(7776, 6, { capital: true, digit: true }), 86, 'which digit and where: log2(10) + log2(6) more');
  });

  it('describes a PIN by how many codes there are and what a lockout does', () => {
    assert.deepEqual(pinOdds(6, 10), { codes: 1_000_000, oneIn: 100_000 });
    assert.deepEqual(pinOdds(4, 10), { codes: 10_000, oneIn: 1_000 });
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

  it('checks the saved picture: every covered area must be solid black in the decoded file', () => {
    const [width, height] = [200, 100];
    const image = { width, height };
    const frame = { sx: 0, sy: 0, sw: width, sh: height, width, height };
    /** A grey picture with black painted where `paint` would cover. @param {(x: number, y: number) => boolean} black */
    const picture = (black) => {
      const data = new Uint8ClampedArray(width * height * 4);
      for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) {
          const value = black(x, y) ? 0 : 150;
          data.set([value, value, value, 255], (y * width + x) * 4);
        }
      }
      return data;
    };
    /** @type {import('../src/client/tool-redact.mjs').Shape[]} */
    const shapes = [
      { type: 'box', x: 0.1, y: 0.2, w: 0.3, h: 0.4 },
      { type: 'ellipse', x: 0.6, y: 0.1, w: 0.3, h: 0.6 },
      { type: 'line', points: [{ x: 0.1, y: 0.9 }, { x: 0.9, y: 0.9 }], size: 0.05 },
    ];
    const inBox = (/** @type {number} */ x, /** @type {number} */ y) => x >= 20 && x < 80 && y >= 20 && y < 60;
    const inEllipse = (/** @type {number} */ x, /** @type {number} */ y) => ((x + 0.5 - 150) / 30) ** 2 + ((y + 0.5 - 40) / 30) ** 2 <= 1;
    const onLine = (/** @type {number} */ x, /** @type {number} */ y) => x >= 15 && x < 185 && Math.abs(y + 0.5 - 90) <= 5;
    const covered = picture((x, y) => inBox(x, y) || inEllipse(x, y) || onLine(x, y));
    assert.deepEqual(checkCovered(covered, shapes, image, frame, 2), { checked: 3, thin: 0, solid: true });

    const leak = covered.slice();
    leak.set([200, 200, 200, 255], (40 * width + 50) * 4); // one light pixel in the middle of the box
    assert.equal(checkCovered(leak, shapes, image, frame, 2).solid, false);
    const missing = picture((x, y) => inBox(x, y) || onLine(x, y)); // the ellipse never got painted
    assert.equal(checkCovered(missing, shapes, image, frame, 2).solid, false);
    const faint = picture(() => false).map((value, index) => (index % 4 === 3 ? 255 : inBox(Math.floor(index / 4) % width, Math.floor(index / 4 / width)) ? 90 : value));
    assert.equal(checkCovered(faint, shapes.slice(0, 1), image, frame, 2).solid, false, 'a see-through grey is not covered');

    // Edges blur in a JPEG: pixels within the allowance of the outline are not judged.
    const soft = covered.slice();
    soft.set([120, 120, 120, 255], (20 * width + 20) * 4);
    assert.equal(checkCovered(soft, shapes, image, frame, 2).solid, true);

    // A crop: shapes outside the saved part are not checked; the rest are found at their new place.
    const crop = outputFrame(width, height, { x: 0, y: 0, w: 0.5, h: 1 });
    const left = picture((x, y) => x < 100 && (inBox(x, y) || onLine(x, y))).filter((_, index) => (Math.floor(index / 4) % width) < 100);
    assert.deepEqual(checkCovered(left, shapes, image, crop, 2), { checked: 2, thin: 0, solid: true });
  });

  it('zooms with two fingers to the nearest step', () => {
    assert.equal(pinchZoom(1, 100, 100), 1);
    assert.equal(pinchZoom(1, 100, 210), 2, 'fingers spread twice as far');
    assert.equal(pinchZoom(2, 100, 50), 1);
    assert.equal(pinchZoom(1, 100, 900), ZOOMS[ZOOMS.length - 1], 'no further than the largest step');
    assert.equal(pinchZoom(1, 100, 10), 1);
    assert.equal(pinchZoom(1.5, 0, 50), 1.5, 'fingers that started on one spot change nothing');
  });

  it('draws straight marker lines, level when nearly level', () => {
    const from = { x: 0.2, y: 0.5 };
    assert.deepEqual(straightEnd(from, { x: 0.8, y: 0.52 }, 1), { x: 0.8, y: 0.5 }, 'a line of text: kept level');
    assert.deepEqual(straightEnd(from, { x: 0.21, y: 0.9 }, 1), { x: 0.2, y: 0.9 }, 'nearly upright: kept upright');
    assert.deepEqual(straightEnd(from, { x: 0.6, y: 0.9 }, 1), { x: 0.6, y: 0.9 }, 'a slant stays a slant');
    // On a wide picture 0.04 of the height is little next to 0.6 of the width.
    assert.deepEqual(straightEnd(from, { x: 0.8, y: 0.54 }, 3), { x: 0.8, y: 0.5 });
  });

  it('knows when a new picture would throw away covering that was not saved', () => {
    const start = createHistory({ shapes: [], crop: null });
    assert.equal(unsavedWork(start, false), false, 'nothing drawn yet');
    const drawn = commit(start, { shapes: [{ type: 'box', x: 0, y: 0, w: 0.5, h: 0.5 }], crop: null });
    assert.equal(unsavedWork(drawn, false), true);
    assert.equal(unsavedWork(drawn, true), false, 'saved or copied');
    assert.equal(unsavedWork(undo(drawn), false), false, 'undone back to the start');
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

  it('keeps the image in the page in the modules it shares with other image tools', async () => {
    for (const name of ['box.mjs', 'history.mjs', 'canvas.mjs']) {
      const source = await readFile(new URL(`../src/client/${name}`, import.meta.url), 'utf8');
      assert.doesNotMatch(source, /fetch\(|XMLHttpRequest|sendBeacon|WebSocket|localStorage|sessionStorage|location\./, name);
      assert.doesNotMatch(source, /context\.filter/, `${name}: no blur`);
    }
  });
});

describe('image redaction: review of 2026-11-13', () => {
  /** @typedef {import('../src/client/tool-redact.mjs').Shape} Shape */
  const full = (/** @type {number} */ width, /** @type {number} */ height) => ({ sx: 0, sy: 0, sw: width, sh: height, width, height });
  /** A white picture with black wherever `black` says. @param {number} width @param {number} height @param {(x: number, y: number) => boolean} black */
  const picture = (width, height, black) => {
    const data = new Uint8ClampedArray(width * height * 4).fill(255);
    for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) if (black(x, y)) data.fill(0, (y * width + x) * 4, (y * width + x) * 4 + 3);
    return data;
  };
  /** @param {number} x0 @param {number} y0 @param {number} x1 @param {number} y1 */
  const rect = (x0, y0, x1, y1) => (/** @type {number} */ x, /** @type {number} */ y) => x >= x0 && x < x1 && y >= y0 && y < y1;
  /** Distance from a point to a segment. @param {number} px @param {number} py @param {number[]} segment */
  const toSegment = (px, py, [ax, ay, bx, by]) => {
    const t = Math.max(0, Math.min(1, ((px - ax) * (bx - ax) + (py - ay) * (by - ay)) / ((bx - ax) ** 2 + (by - ay) ** 2 || 1)));
    return Math.hypot(px - ax - t * (bx - ax), py - ay - t * (by - ay));
  };
  const PNG = 0;
  const JPEG = 2;

  it('4.3 keeps the zoom when one finger lifts during a pinch', () => {
    assert.equal(pinchZoom(3, 100, 0), 3);
    assert.equal(pinchZoom(4, 250, 0), 4);
  });

  it('4.2 judges every pixel of a large box, not a sample of them', () => {
    const [width, height] = [4000, 3000];
    const shape = /** @type {Shape} */ ({ type: 'box', x: 0.1, y: 0.1, w: 0.5, h: 0.5 }); // 2000 × 1500
    // Black only on the grids the old sampling looked at (every 27th pixel from 408/308 with an 8 px margin, every 28th from 402/302 with 2 px).
    const onGrid = (/** @type {number} */ x, /** @type {number} */ y, /** @type {number} */ step, /** @type {number} */ x0, /** @type {number} */ y0) => x >= x0 && y >= y0 && (x - x0) % step === 0 && (y - y0) % step === 0;
    const grid = picture(width, height, (x, y) => x < 2400 && y < 1800 && (onGrid(x, y, 27, 408, 308) || onGrid(x, y, 28, 402, 302)));
    for (const edge of [PNG, JPEG]) assert.equal(checkCovered(grid, [shape], { width, height }, full(width, height), edge).solid, false, `edge ${edge}`);
    const solid = picture(width, height, rect(400, 300, 2400, 1800));
    assert.equal(checkCovered(solid, [shape], { width, height }, full(width, height), PNG).solid, true);
  });

  it('4.2 finds a light ring along the edge, beyond what JPEG blurs', () => {
    const [width, height] = [1000, 800];
    const shape = /** @type {Shape} */ ({ type: 'box', x: 0.2, y: 0.2, w: 0.3, h: 0.1 }); // x 200–500, y 160–240
    const image = { width, height };
    const ring = (/** @type {number} */ n) => picture(width, height, rect(200 + n, 160 + n, 500 - n, 240 - n));
    assert.equal(checkCovered(ring(2), [shape], image, full(width, height), PNG).solid, false, 'PNG keeps edges sharp: a 2 px ring shows');
    assert.equal(checkCovered(ring(1), [shape], image, full(width, height), PNG).solid, false);
    assert.equal(checkCovered(ring(2), [shape], image, full(width, height), JPEG).solid, true, 'JPEG blurs up to 2 px, measured');
    assert.equal(checkCovered(ring(3), [shape], image, full(width, height), JPEG).solid, false);
    assert.equal(checkCovered(ring(8), [shape], image, full(width, height), JPEG).solid, false, 'the old 8 px margin');
  });

  it('4.2 finds a box painted in the wrong place, from geometry of its own', () => {
    const [width, height] = [1000, 800];
    const shape = /** @type {Shape} */ ({ type: 'box', x: 0.2, y: 0.2, w: 0.3, h: 0.1 });
    const image = { width, height };
    for (const [off, edge] of [[8, JPEG], [3, JPEG], [1, PNG]]) {
      const shifted = picture(width, height, rect(200 + off, 160 + off, 500 + off, 240 + off));
      assert.equal(checkCovered(shifted, [shape], image, full(width, height), edge).solid, false, `${off} px off, edge ${edge}`);
    }
  });

  it('4.2 judges a small JPEG box by all its inner pixels', () => {
    const [width, height] = [1000, 800];
    const shape = /** @type {Shape} */ ({ type: 'box', x: 0.2, y: 0.2, w: 0.016, h: 0.02 }); // 16 × 16
    const one = picture(width, height, (x, y) => x === 208 && y === 168);
    assert.equal(checkCovered(one, [shape], { width, height }, full(width, height), JPEG).solid, false);
  });

  it('4.2 judges all of a marker stroke, round caps and joins included', () => {
    const [width, height] = [1000, 800];
    const image = { width, height };
    const straight = /** @type {Shape} */ ({ type: 'line', points: [{ x: 0.1, y: 0.5 }, { x: 0.9, y: 0.5 }], size: 0.06 }); // 60 px thick
    const rows = picture(width, height, (_, y) => y === 378 || y === 400 || y === 422);
    for (const edge of [PNG, JPEG]) assert.equal(checkCovered(rows, [straight], image, full(width, height), edge).solid, false, `three rows, edge ${edge}`);

    // A turn: painted as two plain rectangles, without round caps or the round join.
    const turn = /** @type {Shape} */ ({ type: 'line', points: [{ x: 0.2, y: 0.25 }, { x: 0.6, y: 0.25 }, { x: 0.6, y: 0.75 }], size: 0.04 }); // 40 px thick
    const segments = [[200, 200, 600, 200], [600, 200, 600, 600]];
    const butt = picture(width, height, (x, y) => rect(200, 180, 600, 220)(x, y) || rect(580, 200, 620, 600)(x, y));
    assert.equal(checkCovered(butt, [turn], image, full(width, height), PNG).solid, false, 'the caps and the outer join are missing');
    const round = picture(width, height, (x, y) => segments.some((segment) => toSegment(x + 0.5, y + 0.5, segment) <= 20));
    assert.deepEqual(checkCovered(round, [turn], image, full(width, height), PNG), { checked: 1, thin: 0, solid: true }, 'a stroke painted round passes');
    // Only the cap at the start left light.
    const capless = picture(width, height, (x, y) => x >= 200 && segments.some((segment) => toSegment(x + 0.5, y + 0.5, segment) <= 20));
    assert.equal(checkCovered(capless, [turn], image, full(width, height), PNG).solid, false, 'the round cap is judged');
  });

  it('4.2 gives no edge allowance where two areas meet or where the copy is cropped', () => {
    const [width, height] = [400, 200];
    const image = { width, height };
    const shapes = /** @type {Shape[]} */ ([{ type: 'box', x: 0.1, y: 0.2, w: 0.25, h: 0.5 }, { type: 'box', x: 0.35, y: 0.2, w: 0.25, h: 0.5 }]); // x 40–140 and 140–240
    const seam = picture(width, height, (x, y) => rect(40, 40, 240, 140)(x, y) && x !== 140);
    assert.equal(checkCovered(seam, shapes, image, full(width, height), JPEG).solid, false, 'a light line where two boxes touch');
    // Cropped through the second box: its cut side is the picture's edge, not a blurred one.
    const frame = outputFrame(width, height, { x: 0, y: 0, w: 0.5, h: 1 }); // x 0–200
    const cut = picture(200, height, (x, y) => rect(40, 40, 198, 140)(x, y));
    assert.equal(checkCovered(cut, shapes, image, frame, JPEG).solid, false, 'light pixels at the crop edge');
    assert.deepEqual(checkCovered(picture(200, height, rect(40, 40, 200, 140)), shapes, image, frame, JPEG), { checked: 2, thin: 0, solid: true });
  });

  it('4.2 says which areas were too thin to judge', () => {
    const [width, height] = [300, 200];
    const thin = /** @type {Shape} */ ({ type: 'line', points: [{ x: 0.1, y: 0.5 }, { x: 0.9, y: 0.5 }], size: 0.01 }); // 3 px thick
    const painted = picture(width, height, (x, y) => x >= 30 && x < 270 && y >= 98 && y < 102);
    assert.deepEqual(checkCovered(painted, [thin], { width, height }, full(width, height), JPEG), { checked: 0, thin: 1, solid: true });
  });

  it('the saved copy covers at least what the editor showed', () => {
    let seed = 12345;
    const random = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
    for (const [width, height] of [[4032, 3024], [3024, 4032], [1170, 2532], [6000, 4000], [8000, 6000]]) {
      const out = outputFrame(width, height, null);
      for (const zoom of ZOOMS) {
        const preview = previewSize(width, height, zoom);
        const shown = { sx: 0, sy: 0, sw: width, sh: height, ...preview };
        for (let i = 0; i < 300; i += 1) {
          const box = { x: random() * 0.8, y: random() * 0.8, w: 0.01 + random() * 0.19, h: 0.01 + random() * 0.19 };
          const onScreen = frameRect(box, width, height, shown);
          const saved = frameRect(box, width, height, out, previewGrow(width, height));
          const [kx, ky] = [out.width / preview.width, out.height / preview.height];
          assert.ok(saved.x <= onScreen.x * kx + 1e-6 && saved.y <= onScreen.y * ky + 1e-6, `${width}×${height} at ${zoom}: top left`);
          assert.ok(saved.x + saved.w >= (onScreen.x + onScreen.w) * kx - 1e-6 && saved.y + saved.h >= (onScreen.y + onScreen.h) * ky - 1e-6, `${width}×${height} at ${zoom}: bottom right`);
        }
      }
    }
  });

  it('accepts small boxes measured in screen pixels on a very long screenshot', () => {
    // 1170 × 20000 shown 390 px wide: 1 % of the height would be 200 image pixels.
    const min = { x: 6 / 390, y: 6 / (390 * (20000 / 1170)) };
    const box = boxFromDrag({ x: 0.1, y: 0.1 }, { x: 0.5, y: 0.1015 }, min); // 30 px high
    assert.ok(box && Math.abs(box.h - 0.0015) < 1e-9);
    assert.equal(boxFromDrag({ x: 0.1, y: 0.1 }, { x: 0.5, y: 0.1001 }, min), null, 'still too small to be meant');
    assert.ok(resizeBox({ x: 0.1, y: 0.1, w: 0.4, h: 0.05 }, 0, -0.049, min).h < 0.01);
    assert.ok(resizeFromHandle({ x: 0.1, y: 0.1, w: 0.4, h: 0.05 }, 's', { x: 0.3, y: 0.1005 }, min).h < 0.01);
  });

  it('still reports unsaved work after more steps than the history keeps', () => {
    /** @param {number} n @returns {import('../src/client/tool-redact.mjs').Drawing} */
    const state = (n) => ({ shapes: Array.from({ length: n }, () => ({ type: /** @type {const} */ ('box'), x: 0, y: 0, w: 0.1, h: 0.1 })), crop: null });
    let history = createHistory(state(0));
    for (let n = 1; n <= 150; n += 1) history = commit(history, state(n));
    for (let n = 0; n < 99; n += 1) history = undo(history);
    assert.equal(history.index, 0);
    assert.equal(unsavedWork(history, false), true, 'the 51 areas on screen were never saved');
    assert.equal(unsavedWork(history, true), false);
    assert.equal(unsavedWork(createHistory(state(0)), false), false);
  });

  it('scales a picture taller or wider than a canvas side allows', () => {
    const tall = exportSize(1000, 20000);
    assert.equal(tall.scaled, true);
    assert.ok(tall.height <= 16384 && tall.width <= 16384);
    assert.ok(Math.abs(tall.width / tall.height - 1000 / 20000) < 0.001);
    const preview = previewSize(500, 30000, 4);
    assert.ok(preview.height <= 16384);
  });

  it('tells an animated picture from a still one', () => {
    const gifFrame = [0x21, 0xf9, 4, 0, 10, 0, 0, 0, 0x2c, 0, 0, 0, 0, 1, 0, 1, 0, 0, 2, 2, 0x4c, 1, 0];
    const gif = (/** @type {number} */ frames) => new Uint8Array([...Buffer.from('GIF89a'), 1, 0, 1, 0, 0, 0, 0, ...Array.from({ length: frames }, () => gifFrame).flat(), 0x3b]);
    assert.equal(isAnimated(gif(1)), false);
    assert.equal(isAnimated(gif(3)), true);
    const riff = (/** @type {string} */ fourcc, /** @type {number} */ flags) => {
      const vp8x = [...Buffer.from('VP8X'), 10, 0, 0, 0, flags, 0, 0, 0, 0, 0, 0, 0, 0, 0];
      const body = [...Buffer.from('WEBP'), ...vp8x, ...Buffer.from(fourcc), 0, 0, 0, 0];
      return new Uint8Array([...Buffer.from('RIFF'), body.length & 255, body.length >> 8, 0, 0, ...body]);
    };
    assert.equal(isAnimated(riff('ANIM', 0x02)), true);
    assert.equal(isAnimated(riff('VP8 ', 0)), false);
    const pngChunk = (/** @type {string} */ type) => [0, 0, 0, 0, ...Buffer.from(type), 0, 0, 0, 0];
    assert.equal(isAnimated(new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, ...pngChunk('IHDR'), ...pngChunk('acTL'), ...pngChunk('IDAT')])), true);
    assert.equal(isAnimated(new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, ...pngChunk('IHDR'), ...pngChunk('IDAT')])), false);
    assert.equal(isAnimated(new Uint8Array([0xff, 0xd8, 0xff])), false);
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
      screen: '390 × 844',
      pixelRatio: '3',
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
    assert.equal(facts.pixelRatio, '1');
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
    // The theme follows sunset on automatic settings; the pixel ratio follows page zoom; blockers get switched.
    const evening = { ...facts, theme: 'light', pixelRatio: '1.25', blocker: 'notSeen' };
    assert.equal(fingerprintSource(evening), source, 'the same browser keeps the same code');
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

  it('keeps what it reads in the page: one opt-in request to its own host, the comparison only in this tab', async () => {
    const source = await readFile(new URL('../src/client/tool-browser.mjs', import.meta.url), 'utf8');
    assert.doesNotMatch(source, /XMLHttpRequest|sendBeacon|WebSocket|RTCPeerConnection|localStorage|sessionStorage|location\.|history\./);
    assert.deepEqual(source.match(/fetch\([^)]*\)/g), ['fetch(TRACE_URL, { cache: \'no-store\', credentials: \'omit\', signal: controller.signal })'], 'the IP lookup is the only request');
    assert.equal(TRACE_URL, '/cdn-cgi/trace', 'to the same host, a path Cloudflare answers itself');
    assert.match(source, /addEventListener\('click', async \(\) => \{\s*\/\/ Only on request/, 'only after the visitor asks');
    const calls = [...source.matchAll(/\b(?:write|read|remove)\(COMPARE_KEY[^\n]*/g)].map((m) => m[0]);
    assert.ok(calls.length >= 3 && calls.every((call) => call.includes("'session')")), 'the comparison is kept in this tab only');
    assert.match(source, /window\.addEventListener\('pagehide', clear\)/, 'autofilled values are erased on leaving');
  });

  it('notices the protections browsers announce through what they report', () => {
    const base = { screen: { width: 1920, height: 1080 }, window: { innerWidth: 1280, innerHeight: 720, screenX: 40, screenY: 30 }, timeZone: 'Asia/Tbilisi', offsetMinutes: -240 };
    assert.deepEqual(detectProtections(base), []);
    // Safari's Advanced Fingerprinting Protection: screen size = window size, window at 0,0.
    assert.deepEqual(detectProtections({ ...base, screen: { width: 1280, height: 720 }, window: { ...base.window, screenX: 0, screenY: 0 } }), ['screen']);
    // Tor Browser and Firefox's resistFingerprinting: one time zone for everyone, windows rounded to 200 × 100.
    assert.deepEqual(detectProtections({ ...base, timeZone: 'Atlantic/Reykjavik', offsetMinutes: 0 }), ['timeZone']);
    assert.deepEqual(detectProtections({ ...base, timeZone: 'UTC', offsetMinutes: 0 }), ['timeZone']);
    assert.deepEqual(detectProtections({ ...base, window: { ...base.window, innerWidth: 1000, innerHeight: 900 } }), ['window']);
    assert.deepEqual(detectProtections({ ...base, window: { ...base.window, innerWidth: 390, innerHeight: 664 } }), [], 'an ordinary phone');
  });

  it('notices a canvas the browser changed on purpose', () => {
    const pixels = (/** @type {number[]} */ ...changes) => {
      const data = canvasPattern();
      for (const at of changes) data[at] += 1;
      return data;
    };
    assert.equal(canvasNoise(pixels(), canvasPattern()), false);
    assert.equal(canvasNoise(pixels(21), canvasPattern()), true, 'one channel off by one is noise');
  });

  it('reads the address and country from the trace answer, and nothing else', () => {
    const answer = 'fl=1f\nh=lockwell.org\nip=203.0.113.7\nts=1\nvisit_scheme=https\nuag=Mozilla/5.0\ncolo=TBS\nloc=GE\ntls=TLSv1.3\n';
    assert.deepEqual(parseTrace(answer), { ip: '203.0.113.7', country: 'GE' });
    assert.deepEqual(parseTrace('ip=2001:db8::1\nloc=DE'), { ip: '2001:db8::1', country: 'DE' });
    assert.equal(parseTrace('<html>error</html>'), null);
    assert.equal(parseTrace('ip=<script>\nloc=GE'), null, 'only an address is shown');
    assert.deepEqual(parseTrace('ip=203.0.113.7\nloc=xx1'), { ip: '203.0.113.7', country: '' });
  });

  it('shows the keyboard layout through a few keys', () => {
    const georgian = new Map([['KeyQ', 'ქ'], ['KeyW', 'წ'], ['KeyE', 'ე'], ['KeyR', 'რ'], ['KeyT', 'ტ'], ['KeyY', 'ყ']]);
    assert.equal(layoutSample((code) => georgian.get(code)), 'ქწერტყ');
    assert.equal(layoutSample((code) => ({ KeyQ: 'a', KeyW: 'z', KeyE: 'e', KeyR: 'r', KeyT: 't', KeyY: 'y' })[code]), 'azerty');
    assert.equal(layoutSample(() => undefined), '');
  });

  it('compares with values remembered before a settings change', () => {
    const before = { languages: 'ka', canvas: 'aaaa', fingerprint: '1111', window: '100 × 100' };
    const after = { languages: 'ka', canvas: 'bbbb', fingerprint: '2222', window: '200 × 100', gpu: 'new' };
    assert.deepEqual(compareFacts(before, after), ['canvas', 'fingerprint', 'gpu'], 'window size changes on its own and is not counted');
  });

  describe('review of 2026-11-13', () => {
    /** Probe environments from the review (review-redact-browser/browser.mjs). @param {number} sw @param {number} sh @param {number} iw @param {number} ih */
    const env = (sw, sh, iw, ih, timeZone = 'Asia/Tbilisi', offsetMinutes = -240, screenX = 0, screenY = 0) => ({ screen: { width: sw, height: sh }, window: { innerWidth: iw, innerHeight: ih, screenX, screenY }, timeZone, offsetMinutes });

    it('5.1 says nothing about protection from one sign that ordinary browsers also give', () => {
      for (const [label, place] of /** @type {const} */ ([
        ['Chrome in full screen, 1920 × 1080', env(1920, 1080, 1920, 1080)],
        ['Chrome in full screen, 1600 × 900 (also on the 200 × 100 grid)', env(1600, 900, 1600, 900)],
        ['a 1200 × 800 window', env(1920, 1080, 1200, 800, 'Asia/Tbilisi', -240, 100, 50)],
        ['anyone in Iceland', env(1920, 1080, 1280, 913, 'Atlantic/Reykjavik', 0, 10, 10)],
        ['a computer set to UTC', env(1920, 1080, 1280, 913, 'UTC', 0, 10, 10)],
        ['a tablet at 800 × 1100', env(800, 1280, 800, 1100)],
      ])) {
        assert.deepEqual(protectionNotes(detectProtections(place)), { rows: [], shifting: false }, label);
      }
    });

    it('5.1 names protections only with two independent signs, and says the code shifts only for canvas noise', () => {
      const tor = protectionNotes(detectProtections(env(1400, 900, 1400, 900, 'Atlantic/Reykjavik', 0)));
      assert.deepEqual(tor, { rows: ['screen', 'timeZone', 'window'], shifting: false }, 'uniform values protect, but they do not make the code change');
      assert.deepEqual(protectionNotes(['canvas']), { rows: ['canvas'], shifting: true }, 'changed pixels are seen directly');
      assert.deepEqual(protectionNotes(['canvas', 'timeZone']), { rows: ['canvas', 'timeZone'], shifting: true });
    });

    it('5.3 looks for canvas noise with several colours, which Firefox does not skip', () => {
      const pattern = canvasPattern();
      assert.equal(pattern.length, 16 * 16 * 4);
      const colours = new Set();
      for (let i = 0; i < pattern.length; i += 4) colours.add(pattern.slice(i, i + 4).join());
      assert.ok(colours.size >= 4, 'not a single colour (Firefox leaves uniform canvases alone: nsRFPService::RandomizeElements)');
      assert.equal(canvasNoise(pattern.slice(), pattern), false);
      const noisy = pattern.slice();
      noisy[4 * 37 + 1] ^= 0x2; // Firefox flips one of the two lowest bits of a colour channel
      assert.equal(canvasNoise(noisy, pattern), true);
    });

    it('5.4 reads remembered values only when they are a set of values', () => {
      assert.deepEqual(rememberedFacts('{"gpu":"x","canvas":"y"}'), { gpu: 'x', canvas: 'y' });
      for (const text of ['null', '[]', '5', '"text"', '{"gpu":3}', 'not json', '{}']) assert.equal(rememberedFacts(text), null, text);
    });

    it('5.5 keeps the code the same when the phone turns, the clocks change or the voices arrive late', () => {
      const facts = { screen: '390 × 844', timeZone: 'Europe/Berlin (UTC+1)', voices: '0', gpu: 'Apple GPU', languages: 'ka' };
      const source = fingerprintSource(facts);
      assert.equal(fingerprintSource({ ...facts, screen: '844 × 390' }), source, 'turned sideways');
      assert.equal(fingerprintSource({ ...facts, timeZone: 'Europe/Berlin (UTC+2)' }), source, 'summer time');
      assert.equal(fingerprintSource({ ...facts, voices: '61' }), source, 'the voice list came in after the reading');
      assert.notEqual(fingerprintSource({ ...facts, timeZone: 'Asia/Tbilisi (UTC+4)' }), source);
      assert.notEqual(fingerprintSource({ ...facts, screen: '430 × 932' }), source);
    });
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

  it('groups the tools index by task, every tool once', async () => {
    for (const lang of ['', 'en/']) {
      const index = await read(`${lang}tools/index.html`);
      const groups = [...index.matchAll(/<section class="tool-group" aria-labelledby="tools__(\w+)">\s*<h2[^>]*>[^<]+<\/h2>([\s\S]*?)<\/section>/g)];
      assert.deepEqual(groups.map((m) => m[1]), TOOL_GROUPS.map((group) => group.key), lang);
      const listed = groups.flatMap((m) => [...m[2].matchAll(/href="[^"]*\/tools\/([a-z-]+)\/"/g)].map((link) => link[1]));
      assert.deepEqual([...listed].sort(), TOOLS.map((tool) => tool.slug).sort(), `${lang}: each tool in exactly one group`);
    }
  });

  it('a tool page lists the guides that link to it, found at build time', async () => {
    const page = await read('en/tools/photo-metadata/index.html');
    const section = /<section class="tool-guides" aria-labelledby="tool__guides">([\s\S]*?)<\/section>/.exec(page)?.[1] ?? '';
    for (const slug of ['location-photos', 'protest', 'sources-documents']) assert.match(section, new RegExp(`href="/en/guides/${slug}/"`), slug);
    assert.doesNotMatch(section, /guides\/accounts\//);
    for (const [lang, prefix] of [['en', '/en'], ['ka', '']]) {
      const video = await read(`${lang === 'en' ? 'en/' : ''}tools/video-metadata/index.html`);
      const videoGuides = /<section class="tool-guides" aria-labelledby="tool__guides">([\s\S]*?)<\/section>/.exec(video)?.[1] ?? '';
      for (const slug of ['location-photos', 'protest', 'sources-documents']) assert.match(videoGuides, new RegExp(`href="${prefix}/guides/${slug}/"`), `${lang} video ${slug}`);
      const attachment = await read(`${lang === 'en' ? 'en/' : ''}tools/attachment-checker/index.html`);
      const attachmentGuides = /<section class="tool-guides" aria-labelledby="tool__guides">([\s\S]*?)<\/section>/.exec(attachment)?.[1] ?? '';
      for (const slug of ['phishing', 'spyware', 'sources-documents']) assert.match(attachmentGuides, new RegExp(`href="${prefix}/guides/${slug}/"`), `${lang} attachment ${slug}`);
    }
    assert.match(await read('tools/link-checker/index.html'), /<section class="tool-guides"[\s\S]*?href="\/guides\/phishing\/"/, 'Georgian too');
    for (const tool of TOOLS) {
      const html = await read(`en/tools/${tool.slug}/index.html`);
      const count = (/<section class="tool-guides"[\s\S]*?<\/section>/.exec(html)?.[0].match(/<li>/g) ?? []).length;
      assert.ok(count === 0 || /<section class="tool-guides"/.test(html), tool.slug);
    }
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

  it('lets only the browser check page talk to its own host (for the opt-in IP lookup), in the page and in _headers', async () => {
    const policy = async (/** @type {string} */ page) => /Content-Security-Policy" content="([^"]+)"/.exec(await read(page))?.[1] ?? '';
    for (const lang of ['', 'en/']) {
      const csp = await policy(`${lang}tools/browser-check/index.html`);
      assert.match(csp, /connect-src 'self';/, lang);
      assert.doesNotMatch(csp, /blob:|data:|unsafe|https?:/);
      for (const other of TOOLS.filter((tool) => tool.slug !== 'browser-check')) assert.match(await policy(`${lang}tools/${other.slug}/index.html`), /connect-src 'none'/, other.slug);
    }
    assert.match(await policy('en/index.html'), /connect-src 'none'/);
    const headers = await read('_headers');
    const all = headers.indexOf('/*\n');
    for (const path of ['/tools/browser-check/', '/en/tools/browser-check/']) {
      const at = headers.indexOf(`${path}\n`);
      assert.ok(at > all, `${path}: a rule after the one for every page, so it can replace its policy`);
      const rule = headers.slice(at).split(/\n(?=\S)/)[0];
      assert.match(rule, /\n  ! Content-Security-Policy\n  Content-Security-Policy: [^\n]*connect-src 'self';[^\n]*frame-ancestors 'none'/, path);
    }
    for (const lang of ['', 'en/']) assert.ok((await read(`${lang}tools/browser-check/index.html`)).includes('data-js="browser-ip"'));
  });

  it('header: Tools is linked everywhere; About is a wide-screen header link', async () => {
    const page = await read('en/tools/index.html');
    assert.match(page, /<li><a class="site-nav__link" href="\/en\/tools\/" aria-current="page">Tools<\/a><\/li>/);
    assert.match(page, /<li class="site-nav__item--wide"><a class="site-nav__link" href="\/en\/about\/">About<\/a><\/li>/);
  });

  it('every label a tool can show exists in the page (the client builds no text of its own)', async () => {
    const photo = await read('en/tools/photo-metadata/index.html');
    const values = ['location', 'altitude', 'direction', 'gpsTime', 'place', 'taken', 'camera', 'lens', 'serial', 'lensSerial', 'owner', 'artist', 'copyright', 'caption', 'keywords', 'uniqueId', 'software', 'profile', 'texts'];
    const flags = ['exif', 'xmp', 'iptc', 'photoshop', 'comment', 'thumbnail', 'trailing', 'c2pa', 'hdr', 'unread', 'other'];
    for (const row of [...values, ...flags]) {
      assert.match(photo, new RegExp(`<div class="facts__row" data-row="${row}"( data-flag)? hidden><dt>[^<]+</dt>`), row);
    }
    for (const kept of ['thumbnail', 'xmp', 'exif', 'auxiliary', 'profile', 'other']) assert.match(photo, new RegExp(`<li data-kept="${kept}" hidden>[^<]+`), `kept ${kept}`);
    for (const message of ['found', 'none', 'unsupported', 'compact', 'optimised', 'too-large', 'batch-limit', 'damaged', 'several', 'one', 'compressed', 'more', 'ok', 'metadata-only', 'failed']) {
      assert.match(photo, new RegExp(`data-${message}="[^"]+"`), message);
    }
    assert.match(photo, /data-js="photo-value" data-unnamed="[^"]+"/, 'a profile without a name is said to have none');
    assert.match(photo, /<input class="checkbox checkbox--small" type="checkbox" data-js="photo-drop-profile">/, 'a colour profile that is not a standard one can be dropped');
    assert.match(photo, /<p class="visually-hidden" role="status" data-js="photo-summary"/, 'the report is announced once complete');
    for (const unit of ['{value} m', '{value}°', '{value} UTC']) assert.ok(photo.includes(`data-template="${unit}"`), unit);
    assert.match(photo, /data-js="photo-example"/);
    assert.match(photo, /data-copy-from="photo-coordinates"/, 'coordinates can be copied');
    assert.doesNotMatch(photo, /maps\.|openstreetmap|geo:/i, 'no map link: it would send the location elsewhere');
    for (const lang of ['en', 'ka']) {
      const video = await read(`${lang === 'en' ? 'en/' : ''}tools/video-metadata/index.html`);
      const videoValues = ['location', 'route', 'taken', 'timeZone', 'place', 'camera', 'lens', 'serial', 'lensSerial', 'uniqueId', 'software', 'author', 'copyright', 'title', 'description', 'keywords', 'fileName'];
      const videoFlags = ['emptyLocation', 'thumbnail', 'xmp', 'c2pa', 'cameraData', 'samsung', 'frameData', 'timecode', 'dataTrack', 'gpsLog', 'hiddenData', 'trackNames', 'other'];
      for (const row of [...videoValues, ...videoFlags]) assert.match(video, new RegExp(`<div class="facts__row" data-row="${row}"( data-flag)? hidden><dt>[^<]+</dt>`), `${lang} video ${row}`);
      for (const kept of ['encoderName', 'subtitles', 'unknownBox']) assert.match(video, new RegExp(`<li data-left="${kept}" hidden>[^<]+<span translate="no" data-js="video-left-names">`), `${lang} video left ${kept}`);
      for (const message of ['reading', 'found', 'none', 'unsupported', 'photo', 'damaged', 'too-large', 'fragmented', 'read-failed', 'ok', 'failed', 'done']) {
        assert.match(video, new RegExp(`data-${message}="[^"]+"`), `${lang} video ${message}`);
      }
      for (const template of ['{value}', '{n}', '{first}']) assert.ok(video.includes(template), `${lang} video ${template}`);
      assert.match(video, /data-js="video-example"/);
      assert.match(video, /data-copy-from="video-coordinates"/, 'coordinates can be copied');
      assert.doesNotMatch(video, /maps\.|openstreetmap|geo:/i, 'no map link: it would send the location elsewhere');
      assert.match(/Content-Security-Policy" content="([^"]+)"/.exec(video)?.[1] ?? '', /connect-src 'none'/, 'the video page makes no requests');
    }
    for (const lang of ['en', 'ka']) {
      const page = await read(`${lang === 'en' ? 'en/' : ''}tools/attachment-checker/index.html`);
      for (const key of Object.keys(ATTACHMENT_FINDINGS)) assert.match(page, new RegExp(`<li data-finding="${key}" hidden>[^<]+`), `${lang} attachment finding ${key}`);
      for (const kind of new Set([...Object.values(EXPECTED_KINDS).flat(), 'elf', 'macho', 'javaClass', 'shebang', 'libraryMs', 'searchMs', 'mobileconfig', 'xar', 'cfb', 'aiff', 'midi', 'unknown', 'empty'])) {
        const attribute = kind.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
        assert.match(page, new RegExp(`data-kind-${attribute}="[^"]+"`), `${lang} attachment kind ${kind}`);
      }
      for (const verdict of ['program', 'disguise', 'active', 'locked', 'none']) {
        for (const part of ['verdict', 'advice', 'inside-list']) assert.match(page, new RegExp(`data-js="attachment-${part}"[^>]*data-${verdict}="[^"]+"`), `${lang} attachment ${part} ${verdict}`);
      }
      for (const payload of ['vpn', 'certificate', 'mdm', 'wifi', 'mail', 'dns', 'web-clip', 'restrictions', 'other']) assert.match(page, new RegExp(`data-payload-${payload}="[^"]+"`), `${lang} attachment payload ${payload}`);
      for (const message of ['reading', 'done', 'capped', 'ok', 'warn']) assert.match(page, new RegExp(`data-${message}="[^"]+"`), `${lang} attachment ${message}`);
      for (const template of ['{n}', '{max}']) assert.ok(page.includes(template), `${lang} attachment ${template}`);
      assert.match(page, new RegExp(`<a href="${lang === 'en' ? '/en' : ''}/tools/link-checker/">[^<]+</a>`), 'links point to the link checker');
      assert.match(page, /<input class="file__input" type="file" id="attachment__file" data-js="attachment-file" multiple>/, 'any file, several at once');
      assert.match(page, /data-js="attachment-example"/);
      assert.match(/Content-Security-Policy" content="([^"]+)"/.exec(page)?.[1] ?? '', /connect-src 'none'/, 'the attachment page makes no requests');
    }
    const browser = await read('en/tools/browser-check/index.html');
    const instant = Object.keys(browserFacts({ navigator: {}, screen: { width: 1, height: 1 }, window: { innerWidth: 1, innerHeight: 1 }, timeZone: '', offsetMinutes: 0, media: () => false, referrer: '' }));
    for (const key of [...instant, 'os', 'model', 'gpu', 'canvas', 'fonts', 'keyboard', 'voices', 'blocker', 'fingerprint']) {
      assert.match(browser, new RegExp(`data-row="${key}"`), key);
    }
    for (const family of ['firefox', 'safari', 'brave', 'chromium', 'other']) assert.match(browser, new RegExp(`<p class="steps__family" data-family="${family}">[^<]+ <a href="/en/guides/browser/#[a-z-]+">`), family);
    for (const key of ['screen', 'timeZone', 'window', 'canvas']) assert.match(browser, new RegExp(`data-row="${key}"[\\s\\S]*?data-protected>[^<]+<`), `protected ${key}`);
    for (const rating of ['strong', 'some', 'barely']) assert.match(browser, new RegExp(`<span class="rating rating--${rating}">[^<]+</span>`), rating);
    for (const message of ['remembered', 'failed', 'forgotten', 'changed', 'same']) assert.match(browser, new RegExp(`data-js="browser-compare-status"[^>]* data-${message}="[^"]+"`), message);
    assert.match(browser, /data-js="browser-fingerprint-protected">[^<]+</);
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
        assert.match(box, new RegExp(`^\\s*<input class="file__input" type="file" id="${id}__file" accept="[^"]+" data-js="${id}-file"( multiple)?>`), `${lang}${slug}: a real input, first so the focus ring rule can reach the button`);
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

  it('the password generator offers passphrases, PIN odds, hiding, and presets for sites with rules', async () => {
    for (const lang of ['', 'en/']) {
      const page = await read(`${lang}tools/password-generator/index.html`);
      assert.match(page, /value="passphrase" data-js="password-mode"/, `${lang}: passphrase mode`);
      assert.match(page, /<input class="range" type="range" id="password__words" min="4" max="10" step="1" value="6" data-js="password-words">/, `${lang}: word count`);
      for (const separator of ['hyphen', 'space', 'dot', 'none']) assert.match(page, new RegExp(`id="password__sep-${separator}" value="[^"]*" data-js="password-separator"`), `${lang}: separator ${separator}`);
      for (const name of ['password-capital', 'password-digit', 'password-mask', 'password-hide', 'password-pin', 'password-preset-symbols', 'password-preset-16']) assert.match(page, new RegExp(`data-js="${name}"`), `${lang}: ${name}`);
      assert.match(page, /data-js="password-pin"[^>]* data-codes="[^"]*\{codes\}[^"]*" data-lockout="[^"]*\{tries\}[^"]*\{odds\}/, `${lang}: PIN odds`);
      assert.match(page, /data-js="password-hide" aria-pressed="false" data-show="[^"]+" data-hide="[^"]+"/, `${lang}: hide toggle`);
      assert.match(page, /EFF/, `${lang}: credits the word list`);
    }
  });

  it('the password generator starts with every character set on and look-alikes allowed', async () => {
    const page = await read('en/tools/password-generator/index.html');
    const checked = Object.fromEntries([...page.matchAll(/<input class="checkbox checkbox--small" type="checkbox" id="password__(\w+)" data-js="password-\w+"( checked)?>/g)].map((m) => [m[1], Boolean(m[2])]));
    assert.deepEqual(checked, { lower: true, upper: true, digits: true, symbols: true, avoid: false, capital: false, digit: false });
    assert.match(page, /value="password" data-js="password-mode" checked>/);
    assert.doesNotMatch(page, /value="pin" data-js="password-mode" checked>/);
  });

  it('browser check (review of 2026-11-13): nothing appears late and pushes the page down', async () => {
    for (const lang of ['', 'en/']) {
      const page = await read(`${lang}tools/browser-check/index.html`);
      // 5.6: the steps for this browser are chosen by the head script before the first paint, in CSS.
      const steps = [...page.matchAll(/<p[^>]*data-family="(\w+)"[^>]*>/g)];
      assert.deepEqual(steps.map((step) => step[1]).sort(), ['brave', 'chromium', 'firefox', 'other', 'safari']);
      for (const [tag] of steps) assert.doesNotMatch(tag, /\bhidden\b/, 'not revealed late');
      for (const pattern of [/data-changed hidden/, /data-protected hidden/, /data-js="browser-fingerprint-protected" hidden/, /data-js="browser-compare-forget" hidden/]) assert.doesNotMatch(page, pattern);
      // 5.4: remembering waits for the slow readings.
      assert.match(page, /<button[^>]*data-js="browser-compare-remember" disabled>/);
      assert.match(page, /<button[^>]*data-js="browser-compare-forget" disabled>/);
      // 5.2 (owner decision 4): no camera, microphone or permission rows.
      assert.doesNotMatch(page, /data-row="(?:devices|permissions)"/);
      // The blocker row can say "Not seen" rather than "No".
      assert.match(page, /data-token-not-seen="[^"]+"/);
    }
    const css = await read('assets/site.css');
    for (const family of ['firefox', 'safari', 'brave', 'chromium', 'other']) assert.ok(css.includes(`[data-browser="${family}"] [data-family="${family}"]`), family);
  });

  it('browser check: a rating badge wraps inside the name column instead of running over the value (long in Georgian)', async () => {
    const css = await read('assets/site.css');
    const rule = /\.rating \{([^}]*)\}/.exec(css)?.[1] ?? '';
    assert.doesNotMatch(rule, /white-space: nowrap/);
    assert.match(rule, /max-inline-size: 100%/);
  });

  it('the browser report explains the IP address once, in the network group', async () => {
    const page = await read('en/tools/browser-check/index.html');
    const groups = [...page.matchAll(/<section class="report__group" aria-labelledby="browser__(\w+)">([\s\S]*?)<\/section>/g)];
    assert.deepEqual(groups.map((m) => m[1]), ['place', 'device', 'settings', 'signature', 'extra', 'network']);
    const withIp = groups.filter((m) => m[2].includes('<dt>IP address</dt>')).map((m) => m[1]);
    assert.deepEqual(withIp, ['network']);
  });

  it('document and hidden-character pages hold every row and message their code can show', async () => {
    for (const lang of ['', 'en/']) {
      const page = await read(`${lang}tools/document-metadata/index.html`);
      const template = /<template data-js="document-template">([\s\S]*?)<\/template>/.exec(page)?.[1] ?? '';
      for (const row of ['author', 'lastAuthor', 'company', 'manager', 'title', 'subject', 'keywords', 'comments', 'created', 'modified', 'printed', 'printedBy', 'revision', 'editTime', 'software', 'template', 'producer']) {
        assert.match(template, new RegExp(`<div class="facts__row" data-row="${row}" hidden><dt>[^<]+</dt><dd[^>]*>`), `${lang}: ${row}`);
      }
      const source = await readFile(new URL('../src/client/tool-document.mjs', import.meta.url), 'utf8');
      // Every finding the code can report has a row in the group of each status it can have.
      for (const [, key, status] of source.matchAll(/findings\.(?:add|addValues)\('(\w+)', '(removed|kept|unchecked)'/g)) {
        const group = new RegExp(`data-group="${status}"[\\s\\S]*?</section>`).exec(template)?.[0] ?? '';
        assert.match(group, new RegExp(`data-finding="${key}"`), `${lang}: ${key} (${status})`);
      }
      for (const message of ['found', 'none', 'unsupported', 'old', 'locked', 'encrypted', 'too-large', 'damaged', 'zip64', 'browser']) assert.match(template, new RegExp(`data-js="document-message"[^>]* data-${message}="[^"]+"`), `${lang}: ${message}`);
      // The report is announced once it is complete, for one file or several, without taking room on the page.
      assert.match(page, /<p class="visually-hidden" role="status" data-js="document-summary" data-one="[^"]+" data-several="[^"]*\{n\}[^"]*"><\/p>/, `${lang}: summary`);
      assert.match(page, /accept="[^"]*\.docm[^"]*\.ppsx[^"]*"/, `${lang}: macro-enabled files and slide shows`);
      for (const name of ['document-file', 'document-summary', 'document-reports', 'document-all', 'document-example']) assert.match(page, new RegExp(`data-js="${name}"`), `${lang}: ${name}`);
      for (const name of ['document-name', 'document-pdf', 'document-verified', 'save', 'save-neutral', 'save-download', 'save-share', 'save-status', 'save-hint']) assert.match(template, new RegExp(`data-js="${name}"`), `${lang}: ${name}`);
      assert.match(page, /type="file" id="document__file" accept="[^"]*\.odt[^"]*" data-js="document-file" multiple>/, `${lang}: several files, OpenDocument too`);
    }

    for (const lang of ['', 'en/']) {
      const hidden = await read(`${lang}tools/hidden-characters/index.html`);
      for (const kind of HIDDEN_KINDS) assert.match(hidden, new RegExp(`data-row="${kind}" hidden>\\s*<dt><span data-js="hidden-name">[^<]+</span>`), kind);
      for (const name of ['input', 'result', 'summary', 'details', 'secret', 'truncated', 'marked', 'clean']) assert.match(hidden, new RegExp(`data-js="hidden-${name}"`), name);
      assert.match(hidden, /data-js="copy" data-copy-from="hidden-clean" data-status="hidden-clean-status"/);
      assert.match(hidden, /data-template="[^"]*\{text\}"/);
    }
  });

  it('link checker page holds a verdict template with every warning, and every message its code can show', async () => {
    const source = await readFile(new URL('../src/client/tool-check.mjs', import.meta.url), 'utf8');
    const warnings = (/@typedef \{([^}]+)\} Warning/.exec(source)?.[1] ?? '').match(/'(\w+)'/g)?.map((w) => w.slice(1, -1)) ?? [];
    assert.ok(warnings.length >= 20, 'the Warning type lists every warning');
    for (const lang of ['', 'en/']) {
      const page = await read(`${lang}tools/link-checker/index.html`);
      const template = /<template data-js="check-template">([\s\S]*?)<\/template>/.exec(page)?.[1] ?? '';
      for (const warning of warnings) assert.match(template, new RegExp(`<li data-js="check-warning" data-warning="${warning}" data-template="[^"]+" hidden>`), `${lang}: ${warning}`);
      for (const name of ['site', 'before', 'site-part', 'after', 'ascii', 'shown', 'defanged', 'verdict']) assert.match(template, new RegExp(`data-js="check-${name}"`), `${lang}: ${name}`);
      // A shortened or mail-security link only shows its first stop: the label must not say that is where it leads.
      assert.match(template, /<p class="field__label" data-js="check-leads" data-first="[^"]+">[^<]+<\/p>/, `${lang}: a label for links whose destination is hidden`);
      for (const message of ['invalid', 'data', 'javascript', 'other', 'several', 'capped', 'qr-none', 'qr-failed']) assert.match(page, new RegExp(`data-js="check-summary"[^>]* data-${message}="[^"]+"`), `${lang}: ${message}`);
      assert.match(page, /data-js="check-results"/);
      const example = /data-js="check-example" data-example="([^"]+)"/.exec(page)?.[1] ?? '';
      assert.match(example, /gpost-ge\.info\/pay/, `${lang}: the example has a link written without https://`);
      assert.match(page, /<div class="field qr-only">[\s\S]*?data-js="check-qr"/, `${lang}: the QR field is shown only where the browser can read QR codes`);
    }
    const css = await read('assets/site.css');
    assert.match(css, /\.qr-only \{\s*display: none;/);
    assert.match(css, /\[data-qr\] \.qr-only \{\s*display: grid;/);
    for (const lang of ['', 'en/']) {
      const checker = await read(`${lang}tools/link-checker/index.html`);
      assert.match(checker, /data-js="check-summary" data-one="[^"]+"/, 'one link is announced too');
      assert.match(checker, /<p class="facts__why qr-absent">[^<]+<\/p>/, 'where pictures can’t be read, the page says so');
      assert.match(checker, /<p class="verdict__address" dir="ltr" translate="no">/);
    }
  });

  it('link cleaner page holds the example, the share button, the before-and-after view and every message', async () => {
    for (const lang of ['', 'en/']) {
      const page = await read(`${lang}tools/link-cleaner/index.html`);
      assert.match(page, /data-js="links-example" data-example="[^"]*utm_source[^"]*"/, `${lang}: example`);
      assert.match(page, /<button class="[^"]*share-only[^"]*" type="button" data-js="links-share"/, `${lang}: share button, only where sharing works`);
      assert.match(page, /data-js="links-diff"/, `${lang}: before and after`);
      for (const message of ['removed', 'clean', 'invalid', 'unwrapped', 'several', 'shared', 'lookup']) assert.match(page, new RegExp(`data-js="links-message"[^>]* data-${message}="[^"]+"`), `${lang}: ${message}`);
    }
    const css = await read('assets/site.css');
    assert.match(css, /\.share-only \{\s*display: none;/);
    assert.match(css, /\[data-share\] \.share-only \{\s*display: inline-flex;/);
  });

  it('hidden-character page has an example, a text-file chooser, the normalise option and the comparison', async () => {
    for (const lang of ['', 'en/']) {
      const page = await read(`${lang}tools/hidden-characters/index.html`);
      assert.match(page, /data-js="hidden-example" data-example="[^"]+"/, `${lang}: example`);
      assert.match(page, /type="file" id="hidden__file" accept="\.txt,\.md,\.csv,text\/plain" data-js="hidden-file"/, `${lang}: text file`);
      assert.match(page, /id="hidden__normalise" data-js="hidden-normalise">/, `${lang}: normalise, off by default`);
      assert.match(page, /data-js="hidden-other"/, `${lang}: second copy`);
      for (const message of ['same', 'found', 'too-long', 'too-different', 'needs-first']) assert.match(page, new RegExp(`data-js="hidden-compare-summary"[^>]* data-${message}="[^"]+"`), `${lang}: ${message}`);
      for (const message of ['unsupported', 'too-large']) assert.match(page, new RegExp(`data-js="hidden-file-message"[^>]* data-${message}="[^"]+"`), `${lang}: ${message}`);
    }
  });

  it('image redaction page holds every control and message its code uses', async () => {
    for (const lang of ['', 'en/']) {
      const page = await read(`${lang}tools/image-redaction/index.html`);
      for (const name of ['file', 'message', 'editor', 'view', 'canvas', 'count', 'size', 'straight', 'zoom-value', 'zoom-in', 'zoom-out', 'undo', 'redo', 'remove', 'uncrop', 'clear', 'check', 'result', 'result-canvas', 'result-info', 'result-status', 'verified', 'copy', 'replace', 'replace-yes', 'replace-no', 'example', 'add', 'move-left', 'move-right', 'move-up', 'move-down', 'narrower', 'wider', 'shorter', 'taller']) {
        assert.match(page, new RegExp(`data-js="redact-${name}"`), name);
      }
      const result = /data-js="redact-result"[\s\S]*?<\/div>\s*<\/div>\s*$/m.exec(page)?.[0] ?? page;
      assert.match(result, /data-js="save-download"/, 'saved through the shared save area (sharing, neutral name)');
      for (const message of ['ok', 'ok-jpeg', 'thin', 'empty', 'blocked', 'animated']) assert.match(page, new RegExp(`data-${message}="[^"]+"`), message);
      for (const name of ['move-left', 'wider']) assert.match(page, new RegExp(`aria-label="[^"]+" title="[^"]+" data-js="redact-${name}"`), `${name} has a name`);
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
    assert.match(await read('en/tools/link-checker/index.html'), /data-js="check-summary"[^>]* data-several="[^"]*\{n\}/);
    assert.match(await read('en/tools/photo-metadata/index.html'), /paste a photo/);
    assert.match(await read('en/tools/document-metadata/index.html'), /drop several files/);
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

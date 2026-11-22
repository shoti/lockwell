// @ts-check
/**
 * @file Tests for the file encryption page: the built panel in both languages, in a small DOM made from its HTML,
 * driven through the page's own module with Node's real Web Crypto.
 */
import assert from 'node:assert/strict';
import { resolveObjectURL } from 'node:buffer';
import { readFileSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { build } from '../src/build/build.mjs';
import { ARMOUR_BEGIN, COUNTS, unarmour } from '../src/client/lockbox.mjs';
import { init } from '../src/client/tool-encrypt.mjs';
import { installDom } from './fake-dom.mjs';
import { PageElement, toolSection } from './page-dom.mjs';

/** @type {string} */
let dir;
/** @type {Record<string, string>} */
const pages = {};

before(async () => {
  dir = await mkdtemp(join(tmpdir(), 'lockwell-encrypt-'));
  await build({ outDir: join(dir, 'dist'), siteUrl: 'https://example.org/' });
  for (const [lang, path] of [['en', 'en/tools/file-encryption/index.html'], ['ka', 'tools/file-encryption/index.html']]) pages[lang] = await readFile(join(dir, 'dist', path), 'utf8');
});
after(async () => {
  if (dir) await rm(dir, { recursive: true, force: true });
});

/**
 * Waits for something the page does after an await (key derivation runs in Node's thread pool).
 * @param {() => boolean} done
 * @param {string} what
 */
async function until(done, what) {
  for (let i = 0; i < 400; i += 1) {
    if (done()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Timed out waiting for ${what}`);
}

/**
 * The tool's section from a built page, in a small DOM, with the module started.
 * @param {'en' | 'ka'} lang
 */
function open(lang) {
  const tool = toolSection(pages[lang]);
  const dom = installDom();
  dom.root.setAttribute('lang', lang);
  Object.assign(dom.root, { lang });
  const g = /** @type {Record<string, unknown>} */ (globalThis);
  Object.assign(g, { HTMLElement: PageElement, HTMLInputElement: PageElement });
  init(/** @type {HTMLElement} */ (/** @type {unknown} */ (tool)));
  /** @param {string} name */
  const part = (name) => /** @type {PageElement} */ (tool.querySelector(`[data-js="encrypt-${name}"]`));
  /** @param {string} name @param {string} value */
  const choose = (name, value) => {
    const radios = tool.querySelectorAll(`[data-js="encrypt-${name}"]`);
    for (const radio of radios) radio.checked = radio.value === value;
    /** @type {PageElement} */ (radios.find((radio) => radio.value === value)).dispatchEvent({ type: 'change' });
  };
  /** @param {string} name @param {string} value */
  const type = (name, value) => {
    part(name).value = value;
    part(name).dispatchEvent({ type: 'input' });
  };
  const message = () => part('message').textContent;
  const said = (/** @type {string} */ key) => message() === part('message').dataset[key];
  /** The download link in one of the two save boxes. @param {'lock' | 'open'} which */
  const download = (which) => /** @type {PageElement} */ (part(`${which}-save`).querySelector('[data-js="save-download"]'));
  /** @param {'lock' | 'open'} which */
  const saved = async (which) => {
    const blob = resolveObjectURL(download(which).getAttribute('href') ?? '');
    assert.ok(blob, 'a file is offered');
    return new Uint8Array(await blob.arrayBuffer());
  };
  return {
    tool,
    part,
    choose,
    type,
    message,
    said,
    download,
    saved,
    restore() {
      dom.restore();
      delete g.HTMLInputElement;
    },
  };
}

/** The names the module looks up: find('…'), input('…'), button('…'). */
const NAMES = new Set([...readFileSync(new URL('../src/client/tool-encrypt.mjs', import.meta.url), 'utf8').matchAll(/\b(?:find|input|button)\('([a-z-]+)'/g)].map((match) => match[1]));

describe('file encryption page', () => {
  it('has every element the module looks for, every message and size unit in both languages, and no style attributes', () => {
    for (const lang of /** @type {const} */ (['en', 'ka'])) {
      const tool = toolSection(pages[lang]);
      for (const name of NAMES) assert.ok(tool.querySelector(`[data-js="encrypt-${name}"]`), `${lang}: encrypt-${name}`);
      const message = /** @type {PageElement} */ (tool.querySelector('[data-js="encrypt-message"]'));
      for (const key of ['locking', 'checking', 'opening', 'locked', 'opened', 'needsInput', 'wrongPassword', 'damaged', 'notLocked', 'newerVersion', 'tooLarge', 'bundleTooLarge', 'unsupported', 'readFailed', 'cancelled', 'verifyFailed']) {
        assert.ok(message.dataset[key], `${lang}: message ${key}`);
      }
      const units = /** @type {PageElement} */ (tool.querySelector('[data-js="encrypt"]'));
      for (const unit of ['b', 'kb', 'mb', 'gb']) assert.match(units.dataset[unit] ?? '', /\{n\}/, `${lang}: unit ${unit}`);
      assert.doesNotMatch(pages[lang], /\sstyle="/);
      assert.match(pages[lang], new RegExp(`${lang === 'en' ? 'https://example.org/en/' : 'https://example.org/'}tools/file-encryption/`), 'the sentence for the recipient names this page');
    }
  });

  it('locks a text with the made-up password, checks it, and opens it again (English)', async () => {
    const page = open('en');
    try {
      await until(() => Boolean(page.part('passphrase').textContent), 'the passphrase');
      const passphrase = page.part('passphrase').textContent;
      assert.match(passphrase, /^[a-z]+(?:-[a-z]+){5}$/);
      assert.match(page.part('bits').textContent, /77 bits/);
      assert.equal(page.part('lock-button').disabled, true, 'nothing to lock yet');
      page.type('text', 'Recovery code: 4417-2291');
      assert.equal(page.part('lock-button').disabled, false);
      page.part('lock-button').click();
      assert.equal(page.part('lock-button').disabled, true, 'one job at a time');
      await until(() => page.said('locked'), 'locking');
      assert.equal(page.part('locked').hidden, false);
      assert.equal(page.part('verified').textContent, page.part('verified').dataset.full);
      const block = page.part('armour').value;
      assert.ok(block.startsWith(ARMOUR_BEGIN));
      assert.equal(page.part('armour').textContent, block, 'Copy reads the text');
      assert.equal(page.part('long').hidden, true, 'a short text needs no chat warning');
      assert.equal(page.download('lock').getAttribute('download') ?? page.download('lock').download, 'locked.lockwell');
      assert.deepEqual(await page.saved('lock'), unarmour(block), 'the saved file and the text are the same bytes');

      page.choose('mode', 'open');
      assert.equal(page.part('lock').hidden, true);
      assert.equal(page.part('text').value, '', 'leaving Lock clears it');
      page.type('locked-text', block);
      page.type('open-password', passphrase);
      page.part('open-button').click();
      await until(() => page.said('opened'), 'opening');
      assert.equal(page.part('plain').value, 'Recovery code: 4417-2291');
      assert.equal(page.part('kind').textContent, page.part('kind').dataset.text);
      assert.equal(page.part('name-row').hidden, true);
    } finally {
      page.restore();
    }
  });

  it('keeps Lock disabled until a typed password is long enough and typed twice alike', async () => {
    const page = open('en');
    try {
      page.choose('password-kind', 'own');
      assert.equal(page.part('made').hidden, true);
      assert.equal(page.part('own').hidden, false);
      page.type('text', 'something to lock');
      page.type('password', 'short');
      const shown = () => page.part('warnings').querySelectorAll('[data-warning]').filter((row) => !row.hidden).map((row) => row.dataset.warning);
      assert.deepEqual(shown(), ['tooShort', 'oneClass']);
      assert.equal(page.part('lock-button').disabled, true);
      page.type('password', 'a much longer pass phrase');
      page.type('repeat', 'a much longer pass phrasE');
      assert.deepEqual(shown(), ['mismatch']);
      assert.equal(page.part('lock-button').disabled, true);
      page.type('repeat', 'a much longer pass phrase');
      assert.deepEqual(shown(), []);
      assert.equal(page.part('lock-button').disabled, false);
      page.type('repeat', '');
      page.part('password-show').click();
      assert.equal(page.part('password').type, 'text');
      assert.equal(page.part('repeat').disabled, true, 'shown, so no second field');
      assert.equal(page.part('lock-button').disabled, false);
    } finally {
      page.restore();
    }
  });

  it('offers nothing when the password field changed before the check', async () => {
    const page = open('en');
    try {
      page.choose('password-kind', 'own');
      page.part('password-show').click();
      page.type('text', 'something to lock');
      page.type('password', 'the first password typed');
      page.part('lock-button').click();
      page.part('password').value = 'changed while locking';
      await until(() => page.said('verifyFailed'), 'the check');
      assert.equal(page.part('locked').hidden, true);
      assert.equal(page.download('lock').getAttribute('href'), null);
    } finally {
      page.restore();
    }
  });

  it('locks a file, moves to Open when the locked file is dropped, and gives the file back (Georgian)', async () => {
    const page = open('ka');
    try {
      await until(() => Boolean(page.part('passphrase').textContent), 'the passphrase');
      const passphrase = page.part('passphrase').textContent;
      const content = new Uint8Array(70_000).map((_, i) => (i * 7) % 256);
      page.part('file').files = [new File([content], 'report.pdf', { type: 'application/pdf' })];
      page.part('file').dispatchEvent({ type: 'change' });
      await until(() => page.part('file-box').hidden === false && page.part('lock-button').disabled === false, 'the file');
      assert.equal(page.part('text-box').hidden, true);
      page.part('lock-button').click();
      await until(() => page.said('locked'), 'locking');
      assert.equal(page.part('armour-box').hidden, true, 'a file gives a file, not a text');
      const neutral = /** @type {PageElement} */ (page.part('lock-save').querySelector('[data-js="save-neutral"]'));
      assert.equal(neutral.checked, true, 'the neutral name is the default');
      neutral.checked = false;
      neutral.dispatchEvent({ type: 'change' });
      assert.equal(page.download('lock').download, 'report.pdf.lockwell');
      const lockedBytes = await page.saved('lock');

      page.part('lock').dispatchEvent({ type: 'drop', preventDefault() {}, dataTransfer: { files: [new File([lockedBytes], 'report.pdf.lockwell')] } });
      await until(() => page.part('open').hidden === false, 'the move to Open');
      assert.equal(page.part('lock').hidden, true);
      COUNTS.kdf = 0;
      COUNTS.opened = 0;
      page.type('open-password', 'wrong-password-here');
      page.part('open-button').click();
      await until(() => page.said('wrongPassword'), 'the wrong password');
      assert.deepEqual([COUNTS.kdf, COUNTS.opened], [1, 0], 'one key derivation, no chunk opened');
      assert.equal(page.part('opened').hidden, true);
      page.type('open-password', passphrase);
      page.part('open-button').click();
      await until(() => page.said('opened'), 'opening');
      assert.equal(page.part('kind').textContent, page.part('kind').dataset.file);
      assert.equal(page.part('name').textContent, 'report.pdf');
      assert.equal(page.part('size').textContent, '68 კბ');
      assert.equal(page.download('open').download, 'report.pdf');
      assert.deepEqual(await page.saved('open'), content);
    } finally {
      page.restore();
    }
  });

  it('moves a locked text pasted into the text to lock over to Open, and refuses damaged or foreign text', async () => {
    const page = open('en');
    try {
      await until(() => Boolean(page.part('passphrase').textContent), 'the passphrase');
      page.type('text', 'hello');
      page.part('lock-button').click();
      await until(() => page.said('locked'), 'locking');
      const block = page.part('armour').value;
      page.choose('mode', 'lock');
      page.type('text', `Here you go:\n${block}`);
      assert.equal(page.part('open').hidden, false);
      assert.equal(page.part('locked-text').value, `Here you go:\n${block}`);
      const lines = block.split('\n');
      lines[2] = `${lines[2].slice(0, 10)}${lines[2][10] === 'A' ? 'B' : 'A'}${lines[2].slice(11)}`;
      page.type('locked-text', lines.join('\n'));
      page.type('open-password', 'any password at all');
      page.part('open-button').click();
      await until(() => page.said('wrongPassword') || page.said('damaged'), 'the damaged text');
      page.type('locked-text', 'just an ordinary message');
      page.part('open-button').click();
      await until(() => page.said('notLocked'), 'the foreign text');
    } finally {
      page.restore();
    }
  });

  it('fills in the example, which then opens; Start again clears everything', async () => {
    const page = open('ka');
    try {
      page.part('example').click();
      await until(() => Boolean(page.part('locked-text').value), 'the example');
      assert.equal(page.part('open').hidden, false);
      assert.equal(page.part('open-password').value, page.part('example').dataset.password);
      page.part('open-button').click();
      await until(() => page.said('opened'), 'opening the example');
      assert.equal(page.part('plain').value, page.part('example').dataset.text);
      page.part('reset').click();
      assert.equal(page.part('locked-text').value, '');
      assert.equal(page.part('open-password').value, '');
      assert.equal(page.part('opened').hidden, true);
      assert.equal(page.part('plain').value, '');
      assert.equal(page.message(), '');
    } finally {
      page.restore();
    }
  });
});

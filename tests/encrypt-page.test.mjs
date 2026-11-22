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
import { ARMOUR_BEGIN, COUNTS, KIND, sealBytes, unarmour } from '../src/client/lockbox.mjs';
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
  /** Whether the message line says `key`, with its {placeholders} filled by anything. @param {string} key */
  const said = (key) => {
    const template = part('message').dataset[key] ?? '';
    const pattern = template.split(/\{\w+\}/).map((piece) => piece.replace(/[.*+?^$()|[\]\\]/g, '\\$&')).join('.+');
    return Boolean(template) && new RegExp(`^${pattern}$`).test(message());
  };
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
      for (const key of ['locking', 'checking', 'opening', 'locked', 'opened', 'needsInput', 'wrongPassword', 'damaged', 'notLocked', 'newerVersion', 'tooLarge', 'bundleTooLarge', 'unsupported', 'readFailed', 'writeFailed', 'cancelled', 'verifyFailed']) {
        assert.ok(message.dataset[key], `${lang}: message ${key}`);
      }
      const units = /** @type {PageElement} */ (tool.querySelector('[data-js="encrypt"]'));
      for (const unit of ['b', 'kb', 'mb', 'gb']) assert.match(units.dataset[unit] ?? '', /\{n\}/, `${lang}: unit ${unit}`);
      assert.doesNotMatch(pages[lang], /\sstyle="/);
      assert.match(pages[lang], new RegExp(`${lang === 'en' ? 'https://example.org/en/' : 'https://example.org/'}tools/file-encryption/`), 'the sentence for the recipient names this page');
    }
  });

  it('writes the bits line at build time, the same as the page works it out (review C16)', async () => {
    const { ENCRYPT_PASSPHRASE_BITS } = await import('../src/build/templates/tool-panels.mjs');
    const { passphraseBits } = await import('../src/client/tool-password.mjs');
    const { WORDS } = await import('../src/client/wordlist-en.mjs');
    assert.equal(ENCRYPT_PASSPHRASE_BITS, passphraseBits(WORDS.split(' ').length, 6, { capital: false, digit: false }));
    for (const lang of /** @type {const} */ (['en', 'ka'])) {
      const tool = toolSection(pages[lang]);
      const bits = /** @type {PageElement} */ (tool.querySelector('[data-js="encrypt-bits"]'));
      assert.match(bits.textContent, new RegExp(`${ENCRYPT_PASSPHRASE_BITS}`), lang);
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

  it('opens with a space typed around the password, and hints at the keyboard when the password is wrong (review C7)', async () => {
    const page = open('ka');
    try {
      await until(() => Boolean(page.part('passphrase').textContent), 'the passphrase');
      const passphrase = page.part('passphrase').textContent;
      page.type('text', 'Recovery code: 4417-2291');
      page.part('lock-button').click();
      await until(() => page.said('locked'), 'locking');
      const block = page.part('armour').value;
      page.choose('mode', 'open');
      page.type('locked-text', block);
      page.type('open-password', 'ზჩბფი-ვიოლინო');
      page.part('open-button').click();
      await until(() => !page.said('opening'), 'opening');
      assert.ok(page.said('wrongPasswordLayout'), page.message());
      page.type('open-password', 'POCKET-VIOLIN');
      page.part('open-password').dispatchEvent({ type: 'keyup', getModifierState: (/** @type {string} */ key) => key === 'CapsLock' });
      page.part('open-button').click();
      await until(() => !page.said('opening'), 'opening');
      assert.ok(page.said('wrongPasswordCaps'), page.message());
      page.part('open-password').dispatchEvent({ type: 'keyup', getModifierState: () => false });
      page.type('open-password', `${passphrase} `);
      page.part('open-button').click();
      await until(() => page.said('opened'), 'opening');
      assert.equal(page.part('plain').value, 'Recovery code: 4417-2291');
    } finally {
      page.restore();
    }
  });

  it('withdraws the result when the password in force changes after locking (review C1)', async () => {
    const page = open('en');
    try {
      await until(() => Boolean(page.part('passphrase').textContent), 'the passphrase');
      page.type('text', 'Recovery code: 4417-2291');
      const lockAndWait = async () => {
        page.part('lock-button').click();
        await until(() => page.said('locked'), 'locking');
        assert.equal(page.part('locked').hidden, false);
        assert.ok(page.download('lock').getAttribute('href'), 'a file is offered');
      };
      await lockAndWait();
      const before = page.part('passphrase').textContent;
      page.part('another').click();
      await until(() => page.part('passphrase').textContent !== before, 'another passphrase');
      assert.equal(page.part('locked').hidden, true, 'Another one: the result no longer matches the password shown');
      assert.ok(!page.download('lock').getAttribute('href'), 'and its download is gone');
      assert.equal(page.message(), '', '"Locked and checked" no longer stands');

      await lockAndWait();
      page.choose('password-kind', 'own');
      assert.equal(page.part('locked').hidden, true, 'switching to a typed password');

      page.type('password', 'a long and private sentence');
      page.type('repeat', 'a long and private sentence');
      await lockAndWait();
      page.type('password', 'a long and private sentence!');
      assert.equal(page.part('locked').hidden, true, 'editing the typed password');
    } finally {
      page.restore();
    }
  });

  it('says the job stopped when the visitor switches between Lock and Open during it (review C17)', async () => {
    const page = open('en');
    try {
      await until(() => Boolean(page.part('passphrase').textContent), 'the passphrase');
      page.type('text', 'Recovery code: 4417-2291');
      page.part('lock-button').click();
      page.choose('mode', 'open');
      assert.ok(page.said('cancelled'), page.message());
      await new Promise((resolve) => setTimeout(resolve, 1500));
      assert.ok(page.said('cancelled'), 'the stopped job says nothing more');
      page.choose('mode', 'lock');
      assert.equal(page.message(), '', 'nothing to stop: nothing said');
    } finally {
      page.restore();
    }
  });

  it('holds what is being locked still while the job runs (review C2)', async () => {
    const page = open('en');
    try {
      await until(() => Boolean(page.part('passphrase').textContent), 'the passphrase');
      page.type('text', 'IBAN GE00 0001');
      page.part('lock-button').click();
      assert.equal(page.part('text').readOnly, true, 'the text can’t be edited during the job');
      assert.equal(page.part('file').disabled, true);
      page.tool.dispatchEvent({ type: 'drop', preventDefault() {}, dataTransfer: { files: [new File(['other'], 'final.pdf')] } });
      await until(() => page.said('busy') || page.said('locked'), 'the dropped file to be turned down');
      await until(() => page.said('locked'), 'locking');
      assert.equal(page.part('text').readOnly, false);
      assert.equal(page.part('file').disabled, false);
      assert.equal(page.part('text').value, 'IBAN GE00 0001');
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
      assert.equal(page.part('example').disabled, true, 'not twice at once (review C17)');
      await until(() => Boolean(page.part('locked-text').value), 'the example');
      assert.equal(page.part('example').disabled, false);
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

/**
 * A stand-in for the handle Chromium's save dialog returns: it records what is written, closed or discarded.
 * @param {string} name
 */
function savedFile(name) {
  const state = { written: /** @type {Blob | null} */ (null), aborted: 0, writers: 0 };
  const handle = {
    name,
    async createWritable() {
      state.writers += 1;
      /** @type {Uint8Array<ArrayBuffer>[]} */
      const parts = [];
      return {
        async write(/** @type {Uint8Array<ArrayBuffer>} */ bytes) {
          parts.push(bytes.slice());
        },
        async close() {
          state.written = new Blob(parts);
        },
        async abort() {
          state.aborted += 1;
        },
      };
    },
    async getFile() {
      return new File([state.written ?? new Blob([])], name);
    },
  };
  return { handle, state };
}

/**
 * Installs a save dialog that answers with `answer` and records what it was asked.
 * @param {(options: { suggestedName?: string }) => Promise<unknown>} answer
 */
function withPicker(answer) {
  /** @type {{ suggestedName?: string }[]} */
  const calls = [];
  const g = /** @type {Record<string, unknown>} */ (globalThis);
  g.showSaveFilePicker = async (/** @type {{ suggestedName?: string }} */ options) => {
    calls.push(options);
    return answer(options);
  };
  return { calls, remove: () => delete g.showSaveFilePicker };
}

/** A file of `size` bytes that is never read: for limits that must refuse before reading. @param {string} name @param {number} size */
const unread = (name, size) => /** @type {File} */ (/** @type {unknown} */ ({ name, size, type: '', slice: () => new Blob([new Uint8Array(8)]) }));

/** @param {number} size */
const bytesOf = (size) => new Uint8Array(size).map((_, i) => (i * 13 + 5) % 251);

describe('file encryption page: large and several files', () => {
  it('puts several files in one ZIP archive, and gives the archive back when opened', async () => {
    const { readZip } = await import('../src/client/zip.mjs');
    const page = open('en');
    try {
      await until(() => Boolean(page.part('passphrase').textContent), 'the passphrase');
      const passphrase = page.part('passphrase').textContent;
      const a = new File([bytesOf(3000)], 'scan.pdf');
      const b = new File([bytesOf(5000)], 'Scan.PDF');
      // Read a slice at a time, never whole into memory (review C8).
      for (const file of [a, b]) file.arrayBuffer = () => Promise.reject(new Error('read whole'));
      page.part('lock').dispatchEvent({ type: 'drop', preventDefault() {}, dataTransfer: { files: [a, b] } });
      await until(() => page.part('lock-button').disabled === false, 'the files');
      assert.equal(page.part('files').hidden, false);
      assert.equal(page.part('files').children.length, 2);
      page.part('lock-button').click();
      await until(() => page.said('locked'), 'locking');
      const lockedBytes = await page.saved('lock');
      page.part('lock').dispatchEvent({ type: 'drop', preventDefault() {}, dataTransfer: { files: [new File([lockedBytes], 'locked.lockwell')] } });
      await until(() => page.part('open').hidden === false, 'the move to Open');
      page.type('open-password', passphrase);
      page.part('open-button').click();
      await until(() => page.said('opened'), 'opening');
      assert.equal(page.part('kind').textContent, page.part('kind').dataset.files);
      assert.equal(page.part('zip-note').hidden, false);
      assert.equal(page.download('open').download, 'files.zip');
      const names = readZip(await page.saved('open')).map((entry) => entry.name);
      assert.deepEqual(names, ['scan.pdf', 'Scan-2.PDF'], 'names that differ only in case are numbered');
    } finally {
      page.restore();
    }
  });

  it('refuses several files over 200 MB together, and one file over the limit without a save dialog, before any work', async () => {
    const page = open('en');
    try {
      await until(() => Boolean(page.part('passphrase').textContent), 'the passphrase');
      COUNTS.kdf = 0;
      page.part('lock').dispatchEvent({ type: 'drop', preventDefault() {}, dataTransfer: { files: [unread('a.mov', 150 * 1024 ** 2), unread('b.mov', 150 * 1024 ** 2)] } });
      await until(() => page.part('lock-button').disabled === false, 'the files');
      page.part('lock-button').click();
      assert.ok(page.said('bundleTooLarge'));
      assert.match(page.message(), /200 MB/);
      page.part('lock').dispatchEvent({ type: 'drop', preventDefault() {}, dataTransfer: { files: [unread('disk.iso', 2 * 1024 ** 3)] } });
      await until(() => page.part('files').hidden === true, 'the one file');
      page.part('lock-button').click();
      await until(() => page.said('tooLarge'), 'the limit');
      assert.match(page.message(), /1 GB/);
      assert.equal(COUNTS.kdf, 0, 'nothing was derived');
    } finally {
      page.restore();
    }
  });

  it('streams a large file into the file chosen in the save dialog, checks it, and opens it back the same way', async () => {
    const page = open('en');
    const lockTarget = savedFile('locked.lockwell');
    const openTarget = savedFile('big.bin');
    let target = lockTarget;
    const picker = withPicker(async () => target.handle);
    try {
      await until(() => Boolean(page.part('passphrase').textContent), 'the passphrase');
      const passphrase = page.part('passphrase').textContent;
      const content = bytesOf(33 * 1024 * 1024);
      page.part('file').files = [new File([content], 'big.bin')];
      page.part('file').dispatchEvent({ type: 'change' });
      await until(() => page.part('lock-button').disabled === false, 'the file');
      page.part('lock-button').click();
      assert.deepEqual(picker.calls, [{ suggestedName: 'locked.lockwell', types: [{ description: 'Lockwell', accept: { 'application/octet-stream': ['.lockwell'] } }] }], 'the dialog opens with the click');
      await until(() => page.part('progress-box').hidden === false, 'the progress bar');
      await until(() => page.said('locked'), 'locking');
      assert.equal(page.part('progress-box').hidden, true);
      assert.equal(page.part('lock-saved').hidden, false);
      assert.equal(page.part('lock-save').hidden, true, 'no download link: the file is already saved');
      assert.equal(page.part('verified').textContent, page.part('verified').dataset.full);
      const lockedFile = new File([/** @type {Blob} */ (lockTarget.state.written)], 'big.bin.lockwell');
      assert.ok(lockedFile.size > content.length);

      target = openTarget;
      page.choose('mode', 'open');
      page.part('locked-file').files = [lockedFile];
      page.part('locked-file').dispatchEvent({ type: 'change' });
      page.type('open-password', 'not the password');
      page.part('open-button').click();
      await until(() => page.said('wrongPassword'), 'the wrong password');
      assert.equal(picker.calls.length, 1, 'no dialog for a wrong password');
      page.type('open-password', passphrase);
      page.part('open-button').click();
      await until(() => page.said('opened'), 'opening');
      assert.deepEqual(picker.calls.at(-1), { suggestedName: 'big.bin' }, 'the dialog suggests the name locked inside');
      assert.equal(page.part('open-saved').hidden, false);
      assert.deepEqual(new Uint8Array(await /** @type {Blob} */ (openTarget.state.written).arrayBuffer()), content);
    } finally {
      picker.remove();
      page.restore();
    }
  });

  it('stops on Cancel and leaves nothing half-written in the chosen file', async () => {
    const page = open('en');
    const target = savedFile('locked.lockwell');
    const picker = withPicker(async () => target.handle);
    try {
      await until(() => Boolean(page.part('passphrase').textContent), 'the passphrase');
      page.part('file').files = [new File([bytesOf(40 * 1024 * 1024)], 'big.bin')];
      page.part('file').dispatchEvent({ type: 'change' });
      await until(() => page.part('lock-button').disabled === false, 'the file');
      page.part('lock-button').click();
      await until(() => /** @type {number} */ (/** @type {unknown} */ (page.part('progress').value)) > 0, 'the first batch');
      page.part('cancel').click();
      await until(() => page.said('cancelled'), 'the cancel');
      assert.equal(target.state.aborted, 1, 'the writes were discarded');
      assert.equal(target.state.written, null, 'nothing was committed');
      assert.equal(page.part('locked').hidden, true);
    } finally {
      picker.remove();
      page.restore();
    }
  });

  it('says writing failed, not reading, when the chosen file can’t be written (review C13)', async () => {
    const page = open('en');
    const target = savedFile('locked.lockwell');
    const createWritable = target.handle.createWritable.bind(target.handle);
    target.handle.createWritable = async () => {
      const writable = await createWritable();
      let writes = 0;
      return {
        ...writable,
        async write(/** @type {Uint8Array<ArrayBuffer>} */ bytes) {
          writes += 1;
          if (writes > 2) throw new DOMException('The disk is full.', 'QuotaExceededError');
          return writable.write(bytes);
        },
      };
    };
    const picker = withPicker(async () => target.handle);
    const error = console.error;
    console.error = () => {};
    try {
      await until(() => Boolean(page.part('passphrase').textContent), 'the passphrase');
      page.part('file').files = [new File([bytesOf(40 * 1024 * 1024)], 'big.bin')];
      page.part('file').dispatchEvent({ type: 'change' });
      await until(() => page.part('lock-button').disabled === false, 'the file');
      page.part('lock-button').click();
      await until(() => page.said('writeFailed'), 'the failed write');
      assert.equal(target.state.aborted, 1);
      assert.equal(page.part('locked').hidden, true);
    } finally {
      console.error = error;
      picker.remove();
      page.restore();
    }
  });

  it('empties the chosen file when the job is cancelled during the check (review C4)', async () => {
    const page = open('en');
    const target = savedFile('locked.lockwell');
    const picker = withPicker(async () => target.handle);
    try {
      await until(() => Boolean(page.part('passphrase').textContent), 'the passphrase');
      page.part('file').files = [new File([bytesOf(33 * 1024 * 1024)], 'big.bin')];
      page.part('file').dispatchEvent({ type: 'change' });
      await until(() => page.part('lock-button').disabled === false, 'the file');
      page.part('lock-button').click();
      await until(() => page.said('checking'), 'the check');
      page.part('cancel').click();
      await until(() => page.said('cancelled'), 'the cancel');
      await until(() => target.state.writers === 2, 'the file to be emptied');
      assert.equal(/** @type {Blob} */ (target.state.written).size, 0, '"Nothing was saved" is true: no unchecked file is left');
      assert.equal(page.part('locked').hidden, true);
    } finally {
      picker.remove();
      page.restore();
    }
  });

  it('calls a locked text too long to read too large, and anything else that long not locked (review C12)', async () => {
    const page = open('en');
    try {
      const filler = new Uint8Array(46 * 1024 * 1024).fill(0x41);
      page.choose('mode', 'open');
      page.part('locked-file').files = [new File([`${ARMOUR_BEGIN}\n`, filler], 'long.txt')];
      page.part('locked-file').dispatchEvent({ type: 'change' });
      page.type('open-password', 'any password at all');
      page.part('open-button').click();
      await until(() => !page.said('opening'), 'opening');
      assert.ok(page.said('tooLarge'), page.message());
      page.part('locked-file').files = [new File([filler], 'other.txt')];
      page.part('locked-file').dispatchEvent({ type: 'change' });
      page.part('open-button').click();
      await until(() => !page.said('opening'), 'opening');
      assert.ok(page.said('notLocked'), page.message());
    } finally {
      page.restore();
    }
  });

  it('opens a file claiming several files as a ZIP, warns about a risky name for any kind, and never uses the claimed type (review C6)', async () => {
    const page = open('en');
    try {
      const password = 'a long and private sentence';
      const forged = await sealBytes({ password, meta: { kind: KIND.files, name: 'invoice.pdf.exe', type: 'text/html' }, content: new TextEncoder().encode('<script>1</script>') });
      page.choose('mode', 'open');
      page.part('locked-file').files = [new File([forged], 'invoice.lockwell')];
      page.part('locked-file').dispatchEvent({ type: 'change' });
      page.type('open-password', password);
      page.part('open-button').click();
      await until(() => page.said('opened'), 'opening');
      assert.equal(page.download('open').getAttribute('download') ?? page.download('open').download, 'files.zip');
      const blob = resolveObjectURL(page.download('open').getAttribute('href') ?? '');
      assert.equal(blob?.type, 'application/octet-stream');
      assert.equal(page.part('zip-note').hidden, false);

      const named = await sealBytes({ password, meta: { kind: KIND.file, name: 'invoice.pdf.exe', type: 'text/html' }, content: new Uint8Array(4) });
      page.part('locked-file').files = [new File([named], 'invoice2.lockwell')];
      page.part('locked-file').dispatchEvent({ type: 'change' });
      page.type('open-password', password);
      page.part('open-button').click();
      await until(() => page.said('opened') && page.part('risky').hidden === false, 'opening the second');
      assert.equal(resolveObjectURL(page.download('open').getAttribute('href') ?? '')?.type, 'application/octet-stream');
    } finally {
      page.restore();
    }
  });

  it('asks for another press when the save dialog can no longer open after the password check, then opens it first', async () => {
    const page = open('en');
    const content = bytesOf(33 * 1024 * 1024);
    const { sealBytes, KIND } = await import('../src/client/lockbox.mjs');
    const lockedBytes = await sealBytes({ password: 'a long test password', meta: { kind: KIND.file, name: 'big.bin', type: '' }, content, iterations: 100_000 });
    const target = savedFile('big.bin');
    let refuse = true;
    const picker = withPicker(async () => {
      if (refuse) throw Object.assign(new Error('Must be handling a user gesture'), { name: 'SecurityError' });
      return target.handle;
    });
    try {
      page.choose('mode', 'open');
      page.part('locked-file').files = [new File([lockedBytes], 'big.bin.lockwell')];
      page.part('locked-file').dispatchEvent({ type: 'change' });
      page.type('open-password', 'a long test password');
      page.part('open-button').click();
      await until(() => page.said('pressAgain'), 'the request for another press');
      refuse = false;
      COUNTS.kdf = 0;
      page.part('open-button').click();
      assert.equal(picker.calls.length, 2, 'the dialog opens with the click, before the key derivation');
      assert.equal(picker.calls[1].suggestedName, 'big.bin');
      await until(() => page.said('opened'), 'opening');
      assert.deepEqual(new Uint8Array(await /** @type {Blob} */ (target.state.written).arrayBuffer()), content);
    } finally {
      picker.remove();
      page.restore();
    }
  });

  it('hides the exact size when asked: the locked file is Padmé-rounded and opens back to the exact bytes', async () => {
    const { sealedSize, KIND } = await import('../src/client/lockbox.mjs');
    const page = open('en');
    try {
      await until(() => Boolean(page.part('passphrase').textContent), 'the passphrase');
      const passphrase = page.part('passphrase').textContent;
      const content = bytesOf(1_000_000);
      page.part('pad').checked = true;
      page.part('file').files = [new File([content], 'scan.pdf', { type: 'application/pdf' })];
      page.part('file').dispatchEvent({ type: 'change' });
      await until(() => page.part('lock-button').disabled === false, 'the file');
      page.part('lock-button').click();
      await until(() => page.said('locked'), 'locking');
      const lockedBytes = await page.saved('lock');
      const meta = { kind: KIND.file, size: content.length, name: 'scan.pdf', type: 'application/pdf' };
      assert.equal(lockedBytes.length, sealedSize(meta, { pad: true }));
      assert.ok(lockedBytes.length > sealedSize(meta), 'larger than without padding');
      page.choose('mode', 'open');
      page.part('locked-file').files = [new File([lockedBytes], 'scan.pdf.lockwell')];
      page.part('locked-file').dispatchEvent({ type: 'change' });
      page.type('open-password', passphrase);
      page.part('open-button').click();
      await until(() => page.said('opened'), 'opening');
      assert.equal(page.part('size').textContent, '977 KB', 'the exact size, from inside');
      assert.deepEqual(await page.saved('open'), content);
    } finally {
      page.restore();
    }
  });

  it('shows a disguised name with its direction control written out, and warns with a link to the attachment checker', async () => {
    const page = open('en');
    try {
      await until(() => Boolean(page.part('passphrase').textContent), 'the passphrase');
      const passphrase = page.part('passphrase').textContent;
      page.part('file').files = [new File([bytesOf(100)], 'invoice‮fdp.exe')];
      page.part('file').dispatchEvent({ type: 'change' });
      await until(() => page.part('lock-button').disabled === false, 'the file');
      page.part('lock-button').click();
      await until(() => page.said('locked'), 'locking');
      const lockedBytes = await page.saved('lock');
      page.choose('mode', 'open');
      page.part('locked-file').files = [new File([lockedBytes], 'x.lockwell')];
      page.part('locked-file').dispatchEvent({ type: 'change' });
      page.type('open-password', passphrase);
      page.part('open-button').click();
      await until(() => page.said('opened'), 'opening');
      assert.equal(page.part('name').textContent, 'invoice⟨RLO⟩fdp.exe');
      assert.equal(page.part('risky').hidden, false);
      assert.match(/** @type {PageElement} */ (page.part('risky').querySelector('a')).getAttribute('href') ?? '', /\/tools\/attachment-checker\/$/);
      assert.equal(page.download('open').download, 'invoicefdp.exe', 'saved without the direction control');
    } finally {
      page.restore();
    }
  });
});

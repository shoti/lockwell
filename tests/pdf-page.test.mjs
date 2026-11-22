// @ts-check
/**
 * @file Tests for the PDF tools page: the built panel in both languages, in a small DOM made from its HTML, driven
 * through the page's own module (plan §11 "Page wiring" and "Page content"), and the containment of PDF.js (§5.3,
 * corrected by milestone 0). Node has no PDF.js worker, so pdf-view.mjs reports no preview here: these tests are also
 * the board working without previews.
 */
import assert from 'node:assert/strict';
import { resolveObjectURL } from 'node:buffer';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { build } from '../src/build/build.mjs';
import { COUNTS, openPdf } from '../src/client/pdf-file.mjs';
import { pageList } from '../src/client/pdf-pages.mjs';
import { PDFJS_VERSION } from '../src/client/pdf-view.mjs';
import { BOARD_LIMIT, examplePdf, init, insertBlanks, interleaveHalves, movePages, removePages, rotatePages } from '../src/client/tool-pdf.mjs';
import { readZip } from '../src/client/zip.mjs';
import { pdfFile, simplePdf } from './build-files.mjs';
import { installDom } from './fake-dom.mjs';
import { PageElement, toolSection } from './page-dom.mjs';

/** @typedef {import('../src/client/pdf-build.mjs').PlanPage} PlanPage */

/** @type {string} */
let dir;
/** @type {Record<string, string>} */
const pages = {};

before(async () => {
  dir = await mkdtemp(join(tmpdir(), 'lockwell-pdf-'));
  await build({ outDir: join(dir, 'dist'), siteUrl: 'https://example.org/' });
  for (const [lang, path] of [['en', 'en/tools/pdf-tools/index.html'], ['ka', 'tools/pdf-tools/index.html']]) pages[lang] = await readFile(join(dir, 'dist', path), 'utf8');
});
after(async () => {
  if (dir) await rm(dir, { recursive: true, force: true });
});

/** @param {() => boolean} done @param {string} what */
async function until(done, what) {
  for (let i = 0; i < 500; i += 1) {
    if (done()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Timed out waiting for ${what}`);
}

/** @param {'en' | 'ka'} lang */
function open(lang) {
  const tool = toolSection(pages[lang]);
  const dom = installDom();
  dom.root.setAttribute('lang', lang);
  Object.assign(dom.root, { lang });
  const g = /** @type {Record<string, unknown>} */ (globalThis);
  Object.assign(g, { HTMLElement: PageElement, HTMLInputElement: PageElement });
  Object.assign(globalThis.document, { createElement: (/** @type {string} */ tag) => new PageElement(tag) });
  Object.defineProperty(globalThis.document, 'activeElement', { configurable: true, get: () => PageElement.active });
  PageElement.active = null;
  const quiet = console.error;
  console.error = () => {}; // pdf-view.mjs reports once that PDF.js cannot start in Node
  init(/** @type {HTMLElement} */ (/** @type {unknown} */ (tool)));
  /** @param {string} name */
  const part = (name) => /** @type {PageElement} */ (tool.querySelector(`[data-js="pdf-${name}"]`));
  /** The cards on the board, in order (the template's own card is not on the board). */
  const cards = () => part('cards').children;
  const said = (/** @type {string} */ key) => {
    const template = part('message').dataset[key] ?? '';
    const pattern = template.split(/\{\w+\}/).map((piece) => piece.replace(/[.*+?^$()|[\]\\]/g, '\\$&')).join('.*');
    return Boolean(template) && new RegExp(`^${pattern}$`).test(part('message').textContent);
  };
  /** @param {Uint8Array} bytes @param {string} [name] */
  const add = async (bytes, name = 'report.pdf') => {
    const before = cards().length;
    part('message').textContent = '';
    part('file').files = [new File([/** @type {Uint8Array<ArrayBuffer>} */ (bytes)], name, { type: 'application/pdf' })];
    part('file').dispatchEvent({ type: 'change' });
    await until(() => cards().length !== before || /damaged|unsupported|locked|tooMany|tooLarge/.test(Object.keys(part('message').dataset).find((key) => said(key)) ?? ''), 'the file to be read');
  };
  /** @param {string} name */
  const press = (name) => part(name).click();
  /** @param {number} i */
  const check = (i) => {
    const box = /** @type {PageElement} */ (cards()[i].querySelector('[data-js="pdf-card-check"]'));
    box.checked = !box.checked;
    box.dispatchEvent({ type: 'change' });
  };
  /** The pages the board shows, as "source page" numbers (b for blank) with their turns. */
  const board = () => cards().map((card) => /** @type {PageElement} */ (card.querySelector('[data-js="pdf-card-source"]')).textContent.replace(/^.* · /, '') || 'b');
  /** @param {string} value */
  const choose = (value) => {
    for (const radio of tool.querySelectorAll('[data-js="pdf-make"]')) radio.checked = radio.value === value;
    /** @type {PageElement} */ (tool.querySelectorAll('[data-js="pdf-make"]').find((radio) => radio.value === value)).dispatchEvent({ type: 'change' });
  };
  const saved = async () => {
    await until(() => part('result').hidden === false, 'the result');
    const link = /** @type {PageElement} */ (part('result').querySelector('[data-js="save-download"]'));
    const blob = resolveObjectURL(link.getAttribute('href') ?? '');
    assert.ok(blob, 'a file is offered');
    return { bytes: new Uint8Array(await blob.arrayBuffer()), name: link.download };
  };
  return {
    tool,
    part,
    cards,
    said,
    add,
    press,
    check,
    board,
    choose,
    saved,
    status: () => part('status').textContent,
    restore() {
      console.error = quiet;
      dom.restore();
      delete g.HTMLInputElement;
    },
  };
}

/** The names the module looks up: find('…'), button('…'), input('…'), and the card parts. */
const SOURCE = readFileSync(new URL('../src/client/tool-pdf.mjs', import.meta.url), 'utf8');
const NAMES = new Set([...SOURCE.matchAll(/\b(?:find|input|button)\('([a-z-]+)'/g)].map((match) => match[1]));
const LISTED = [...SOURCE.matchAll(/for \(const name of \[([^\]]+)\]\)/g)].flatMap((match) => [...match[1].matchAll(/'([a-z-]+)'/g)].map((m) => m[1]));

describe('PDF tools page: content', () => {
  it('has every element the module looks for and every message in both languages, and no style attributes', () => {
    for (const lang of /** @type {const} */ (['en', 'ka'])) {
      const tool = toolSection(pages[lang]);
      for (const name of [...NAMES, ...LISTED, 'card', 'card-check', 'card-canvas', 'card-source', 'card-number', 'card-grip', 'card-action', 'save', 'make']) {
        assert.ok(tool.querySelector(`[data-js="pdf-${name}"]`) ?? tool.querySelector(`[data-js="${name}"]`), `${lang}: pdf-${name}`);
      }
      const message = /** @type {PageElement} */ (tool.querySelector('[data-js="pdf-message"]'));
      for (const key of ['added', 'addedOne', 'unsupported', 'damaged', 'tooLarge', 'tooMany', 'locked', 'repaired', 'noPreview', 'buildFailed', 'nothingSelected', 'cancelled', 'badRanges', 'badEvery', 'badPosition', 'saved', 'busy']) {
        assert.ok(message.dataset[key], `${lang}: message ${key}`);
      }
      const units = /** @type {PageElement} */ (tool.querySelector('[data-js="pdf-units"]'));
      for (const unit of ['b', 'kb', 'mb', 'gb']) assert.match(units.dataset[unit] ?? '', /\{n\}/, `${lang}: unit ${unit}`);
      for (const key of ['bookmarks', 'pageLabels', 'articles', 'structure', 'scripts', 'attachments', 'encryption']) assert.ok(tool.querySelector(`[data-key="${key}"]`), `${lang}: dropped ${key}`);
      assert.doesNotMatch(pages[lang], /\sstyle="/);
      for (const element of tool.descendants()) {
        if (!element.classList.contains('button--icon') && !/button--icon/.test(element.getAttribute('class') ?? '')) continue;
        assert.ok(element.getAttribute('aria-label') && element.getAttribute('title'), `${lang}: icon-only control ${element.dataset.js ?? element.tagName} has aria-label and title`);
      }
    }
    assert.notEqual(toolSection(pages.en).querySelector('[data-js="pdf-file"]')?.getAttribute('multiple'), null, 'several files at once');
  });
});

describe('PDF tools page: organising', () => {
  it('adds a file, selects, moves, rotates, deletes, and undoes and redoes, by buttons (English)', async () => {
    const page = open('en');
    try {
      assert.equal(page.part('work').hidden, true, 'nothing shown before a file');
      await page.add(simplePdf(4), 'contract 2026-01-05.pdf');
      assert.equal(page.part('work').hidden, false);
      assert.deepEqual(page.board(), ['1', '2', '3', '4']);
      assert.equal(page.status(), '4 pages, 0 selected');
      assert.equal(page.part('name').value, 'contract 2026-01-05', 'the name starts from the file');
      page.check(2);
      assert.equal(page.status(), '4 pages, 1 selected');
      page.press('move-start');
      assert.deepEqual(page.board(), ['3', '1', '2', '4']);
      assert.equal(page.status(), 'Page 3 moved to position 1.', 'the move is announced');
      page.press('rotate-right');
      page.press('remove');
      assert.deepEqual(page.board(), ['1', '2', '4']);
      page.press('undo');
      assert.deepEqual(page.board(), ['3', '1', '2', '4']);
      page.press('undo');
      page.press('undo');
      assert.deepEqual(page.board(), ['1', '2', '3', '4']);
      page.press('redo');
      assert.deepEqual(page.board(), ['3', '1', '2', '4']);
      page.part('position').value = '9';
      page.press('position-move');
      assert.ok(page.said('badPosition'));
    } finally {
      page.restore();
    }
  });

  it('works by keyboard: arrows, Space, Alt with an arrow, R, Delete and Ctrl+Z (Georgian page)', async () => {
    const page = open('ka');
    try {
      await page.add(simplePdf(3));
      /** @param {number} i @param {Record<string, unknown>} event */
      const key = (i, event) => page.part('cards').dispatchEvent({ type: 'keydown', target: page.cards()[i], preventDefault() {}, ...event });
      key(0, { code: 'ArrowRight' });
      key(1, { code: 'Space' });
      assert.match(page.status(), /მონიშნულია 1$/);
      key(1, { code: 'ArrowRight', altKey: true });
      assert.deepEqual(page.board(), ['1', '3', '2']);
      key(2, { code: 'KeyR' });
      key(2, { code: 'Delete' });
      assert.deepEqual(page.board(), ['1', '3']);
      key(0, { code: 'KeyZ', ctrlKey: true });
      assert.deepEqual(page.board(), ['1', '3', '2']);
      key(0, { code: 'KeyA', metaKey: true });
      assert.match(page.status(), /მონიშნულია 3$/);
      const before = page.board();
      page.part('cards').dispatchEvent({ type: 'keydown', target: page.part('range'), code: 'Delete', preventDefault() {} });
      assert.deepEqual(page.board(), before, 'keys typed in a field do nothing to the board');
    } finally {
      page.restore();
    }
  });

  it('keeps the keyboard on the board: Space then Alt with an arrow moves the page (keys go to the focused element)', async () => {
    const page = open('en');
    try {
      await page.add(simplePdf(3));
      page.cards()[0].focus();
      /** @param {Record<string, unknown>} event */
      const key = (event) => page.part('cards').dispatchEvent({ type: 'keydown', target: PageElement.active, preventDefault() {}, ...event });
      key({ code: 'Space' });
      assert.equal(PageElement.active, page.cards()[0], 'the card keeps focus after it is selected');
      key({ code: 'ArrowRight', altKey: true });
      assert.deepEqual(page.board(), ['2', '1', '3']);
      assert.equal(PageElement.active, page.cards()[1], 'focus moves with the page');
      key({ code: 'KeyR' });
      assert.equal(PageElement.active, page.cards()[1], 'and stays after a turn');
    } finally {
      page.restore();
    }
  });

  it('duplicates, inserts blank pages, reverses, interleaves and selects by typed ranges', async () => {
    const page = open('en');
    try {
      await page.add(simplePdf(4));
      page.part('range').value = '2-3';
      page.press('range-select');
      assert.equal(page.status(), '4 pages, 2 selected');
      page.press('duplicate');
      assert.deepEqual(page.board(), ['1', '2', '2', '3', '3', '4']);
      page.press('select-none');
      page.check(0);
      page.press('blank');
      assert.deepEqual(page.board(), ['1', 'b', '2', '2', '3', '3', '4']);
      page.press('reverse');
      assert.deepEqual(page.board(), ['4', '3', '3', '2', '2', 'b', '1']);
      page.part('range').value = 'x';
      page.press('range-select');
      assert.ok(page.said('badRanges'));
    } finally {
      page.restore();
    }
  });

  it('moves cards by dragging them by their grip', async () => {
    const page = open('en');
    const g = /** @type {Record<string, unknown>} */ (globalThis);
    try {
      await page.add(simplePdf(3));
      const [first, , third] = page.cards();
      Object.assign(/** @type {Record<string, unknown>} */ (/** @type {unknown} */ (document)), { elementFromPoint: () => third });
      const grip = /** @type {PageElement} */ (first.querySelector('[data-js="pdf-card-grip"]'));
      grip.dispatchEvent({ type: 'pointerdown', button: 0, pointerId: 1 });
      grip.dispatchEvent({ type: 'pointermove', pointerId: 1, clientX: 90, clientY: 10 });
      assert.ok(third.classList.contains('is-drop-after'));
      grip.dispatchEvent({ type: 'pointerup', pointerId: 1 });
      assert.deepEqual(page.board(), ['2', '3', '1']);
      void g;
    } finally {
      page.restore();
    }
  });

  it('moves no PDF data while organising: no object is parsed and nothing decoded', async () => {
    const page = open('en');
    try {
      await page.add(simplePdf(20));
      const before = { ...COUNTS };
      page.check(5);
      for (const name of ['move-start', 'move-right', 'rotate-left', 'duplicate', 'move-end', 'remove', 'undo', 'redo']) page.press(name);
      assert.deepEqual({ ...COUNTS }, before);
    } finally {
      page.restore();
    }
  });

  it('says why a file is not added: not a PDF, damaged, password-protected; and refuses more than the board holds', async () => {
    const page = open('en');
    try {
      await page.add(new TextEncoder().encode('just text'), 'notes.pdf');
      assert.ok(page.said('unsupported'));
      await page.add(new TextEncoder().encode('%PDF-1.7\nnothing\n%%EOF'), 'broken.pdf');
      assert.ok(page.said('damaged'));
      const locked = pdfFile({ objects: [
        { num: 1, body: '<< /Type /Catalog /Pages 2 0 R >>' },
        { num: 2, body: '<< /Type /Pages /Kids [3 0 R] /Count 1 >>' },
        { num: 3, body: '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 10 10] >>' },
        { num: 4, body: '<< /Filter /Standard /V 1 /R 2 >>' },
      ], trailer: '/Encrypt 4 0 R' });
      await page.add(locked, 'secret.pdf');
      assert.ok(page.said('locked'));
      assert.equal(page.cards().length, 0);
      assert.equal(BOARD_LIMIT, 5000);
    } finally {
      page.restore();
    }
  });

  it('starts again only after asking', async () => {
    const page = open('en');
    try {
      await page.add(simplePdf(2));
      page.press('restart-ask');
      assert.equal(page.part('restart').hidden, false);
      page.press('restart-no');
      assert.equal(page.cards().length, 2);
      page.press('restart-ask');
      page.press('restart-yes');
      assert.equal(page.cards().length, 0);
      assert.equal(page.part('work').hidden, true);
    } finally {
      page.restore();
    }
  });

  it('builds the example without a file', async () => {
    const page = open('en');
    try {
      page.press('example');
      await until(() => page.cards().length === 3, 'the example');
      assert.equal(page.part('name').value, 'example');
    } finally {
      page.restore();
    }
  });
});

describe('PDF tools page: saving', () => {
  it('saves one PDF with every page, in the board\'s order and turns, and says what it left out', async () => {
    const page = open('en');
    try {
      await page.add(simplePdf(3), 'a.pdf');
      await page.add(pdfFile({ objects: [
        { num: 1, body: '<< /Type /Catalog /Pages 2 0 R /Outlines 9 0 R >>' },
        { num: 2, body: '<< /Type /Pages /Kids [3 0 R] /Count 1 >>' },
        { num: 3, body: '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 300] >>' },
        { num: 9, body: '<< /Type /Outlines /First 10 0 R /Last 10 0 R >>' },
        { num: 10, body: '<< /Title (One) /Parent 9 0 R >>' },
      ] }), 'b.pdf');
      page.check(3);
      page.press('move-start');
      page.press('rotate-right');
      page.press('create');
      const { bytes, name } = await page.saved();
      assert.equal(name, 'a.pdf', 'named after the first file, as the name field says');
      const list = pageList(await openPdf(bytes));
      assert.equal(list.length, 4);
      assert.deepEqual(list.map((info) => info.mediaBox[2]), [300, 612, 612, 612]);
      assert.deepEqual(list.map((info) => info.rotate), [90, 0, 0, 0]);
      const dropped = page.tool.querySelectorAll('[data-js="pdf-dropped-item"]').filter((item) => !item.hidden).map((item) => item.dataset.key);
      assert.deepEqual(dropped, ['bookmarks']);
      assert.equal(page.part('dropped').hidden, false);
      assert.match(page.part('result-line').textContent, /^4 pages, /);
    } finally {
      page.restore();
    }
  });

  it('says "1 page", not "1 pages", when a file or the result has one page', async () => {
    const page = open('en');
    try {
      await page.add(simplePdf(2), 'first.pdf');
      await until(() => page.said('noPreview'), 'the one notice that previews are unavailable here');
      page.press('select-all');
      page.press('remove');
      await page.add(simplePdf(1), 'note.pdf');
      assert.equal(page.part('message').textContent, 'note.pdf: 1 page added.');
      assert.equal(page.status(), '1 page, 0 selected');
      page.press('create');
      await page.saved();
      assert.match(page.part('result-line').textContent, /^1 page, /);
    } finally {
      page.restore();
    }
  });

  it('saves one PDF per page as a ZIP of PDFs', async () => {
    const page = open('en');
    try {
      await page.add(simplePdf(3), 'scan.pdf');
      page.choose('single');
      page.press('create');
      const { bytes, name } = await page.saved();
      assert.equal(name, 'scan.zip');
      const entries = readZip(bytes);
      assert.deepEqual(entries.map((entry) => entry.name), ['scan-1.pdf', 'scan-2.pdf', 'scan-3.pdf']);
      for (const entry of entries) assert.equal(pageList(await openPdf(entry.data)).length, 1);
      assert.equal(page.part('files').hidden, false);
      assert.equal(page.part('files').children.length, 3);
    } finally {
      page.restore();
    }
  });

  it('splits by typed ranges and every N pages, and saves only the selected pages; refuses what does not read', async () => {
    const page = open('en');
    try {
      await page.add(simplePdf(5), 'book.pdf');
      page.choose('ranges');
      assert.equal(page.part('ranges').disabled, false);
      page.part('ranges').value = '1-2, 9';
      page.press('create');
      assert.ok(page.said('badRanges'));
      page.part('ranges').value = '1-2, 4-';
      page.press('create');
      let entries = readZip((await page.saved()).bytes);
      assert.deepEqual(await Promise.all(entries.map(async (entry) => pageList(await openPdf(entry.data)).length)), [2, 2]);
      page.choose('every');
      page.part('every').value = '0';
      page.press('create');
      assert.ok(page.said('badEvery'));
      page.part('every').value = '2';
      page.press('create');
      await until(() => page.part('result').hidden === true || page.part('files').children.length === 3, 'the new result');
      entries = readZip((await page.saved()).bytes);
      assert.equal(entries.length, 3);
      page.choose('selected');
      page.press('create');
      assert.ok(page.said('nothingSelected'));
      page.check(1);
      page.press('create');
      await until(() => page.part('files').hidden === true, 'one file');
      assert.equal(pageList(await openPdf((await page.saved()).bytes)).length, 1);
    } finally {
      page.restore();
    }
  });

  it('stops when cancelled and offers nothing', async () => {
    const page = open('en');
    try {
      await page.add(simplePdf(60));
      page.press('create');
      assert.equal(page.part('cancel').disabled, false);
      assert.equal(page.part('create').disabled, true, 'one job at a time');
      page.press('cancel');
      await until(() => page.said('cancelled'), 'the stop');
      assert.equal(page.part('result').hidden, true);
      assert.equal(page.part('create').disabled, false);
    } finally {
      page.restore();
    }
  });

  it('clears an offered result as soon as the board changes', async () => {
    const page = open('en');
    try {
      await page.add(simplePdf(2));
      page.press('create');
      await page.saved();
      page.press('reverse');
      assert.equal(page.part('result').hidden, true);
    } finally {
      page.restore();
    }
  });
});

describe('PDF tools: the plan edits', () => {
  /** @param {number[]} keys @returns {PlanPage[]} */
  const plan = (keys) => keys.map((key) => ({ key, origin: { source: 1, index: key }, turn: 0 }));
  /** @param {PlanPage[]} list */
  const keys = (list) => list.map((page) => page.key);

  it('moves runs of selected pages, keeping their order', () => {
    const list = plan([1, 2, 3, 4, 5]);
    assert.deepEqual(keys(movePages(list, new Set([2, 4]), 'left')), [2, 1, 4, 3, 5]);
    assert.deepEqual(keys(movePages(list, new Set([2, 3]), 'right')), [1, 4, 2, 3, 5]);
    assert.deepEqual(keys(movePages(list, new Set([1]), 'left')), [1, 2, 3, 4, 5], 'already first');
    assert.deepEqual(keys(movePages(list, new Set([4, 2]), 'start')), [2, 4, 1, 3, 5]);
    assert.deepEqual(keys(movePages(list, new Set([1, 3]), 'end')), [2, 4, 5, 1, 3]);
    assert.deepEqual(keys(movePages(list, new Set([5]), 2)), [1, 5, 2, 3, 4]);
    assert.deepEqual(keys(movePages(list, new Set([1, 2]), 99)), [3, 4, 5, 1, 2]);
  });

  it('rotates by quarter turns, deletes, inserts blanks and interleaves', () => {
    const list = plan([1, 2, 3, 4, 5]);
    assert.deepEqual(rotatePages(list, new Set([1]), -90)[0].turn, 270);
    assert.deepEqual(rotatePages(rotatePages(list, new Set([1]), 90), new Set([1]), 90)[0].turn, 180);
    assert.deepEqual(keys(removePages(list, new Set([2, 3]))), [1, 4, 5]);
    let next = 10;
    const blanks = insertBlanks(list, new Set([2]), () => ({ width: 100, height: 200 }), () => next++);
    assert.deepEqual(keys(blanks), [1, 2, 10, 3, 4, 5]);
    assert.deepEqual(blanks[2].origin, { blank: { width: 100, height: 200 } });
    assert.deepEqual(keys(interleaveHalves(list, true)), [1, 5, 2, 4, 3]);
    assert.deepEqual(keys(interleaveHalves(list, false)), [1, 4, 2, 5, 3]);
  });

  it('makes an example PDF of three pages that our reader opens', async () => {
    assert.equal(pageList(await openPdf(await examplePdf())).length, 3);
  });
});

describe('PDF tools: PDF.js contained (plan §5.3, corrected by milestone 0)', () => {
  const client = new URL('../src/client/', import.meta.url);
  const vendor = new URL('../src/vendor/pdfjs/', import.meta.url);

  it('is referred to by pdf-view.mjs only', () => {
    for (const name of readdirSync(client).filter((file) => file.endsWith('.mjs'))) {
      const source = readFileSync(new URL(name, client), 'utf8');
      if (name === 'pdf-view.mjs') continue;
      assert.doesNotMatch(source, /vendor\/pdfjs|pdf\.min\.mjs|pdf\.worker/, name);
    }
  });

  it('is given no standard fonts, ICC profiles or outside URLs: its worker, decoders and character maps come from our folder', () => {
    const source = readFileSync(new URL('pdf-view.mjs', client), 'utf8');
    for (const word of ['standardFontDataUrl', 'iccUrl', 'enableScripting: true', 'useWasm: true', 'http://', 'https://', 'innerHTML', 'eval(', 'new Function']) assert.ok(!source.includes(word), word);
    assert.match(source, /const VENDOR = new URL\(`\.\.\/vendor\/pdfjs-\$\{PDFJS_VERSION\}\/`, import\.meta\.url\)\.href;/, 'one same-origin folder');
    assert.match(source, /wasmUrl: VENDOR,/);
    assert.match(source, /cMapUrl: `\$\{VENDOR\}cmaps\/`,/);
    assert.match(source, /useWorkerFetch: false,/);
    assert.match(source, /if \(url !== WORKER\) throw/, 'the Trusted Types policy allows only the worker');
    assert.deepEqual([...source.matchAll(/\bfetch\(/g)].length, 1, 'fetch appears only as the method PDF.js calls');
    assert.match(source, /async fetch\(\{ kind, filename \}\) \{\n\s+if \(kind !== 'cMapUrl'[^\n]*\n\s+const \{ base64 \} = await import\(/, 'and that method only imports a module');
  });

  it('is the vendored release, file for file, as VERSION records', () => {
    const version = readFileSync(new URL('VERSION', vendor), 'utf8');
    assert.equal(/^pdfjs-dist (\S+)$/m.exec(version)?.[1], PDFJS_VERSION);
    const lines = [...version.matchAll(/^([0-9a-f]{64}) {2}(\S+)$/gm)];
    assert.ok(lines.length > 170, 'every file is listed');
    for (const [, hash, path] of lines) assert.equal(createHash('sha256').update(readFileSync(new URL(path, vendor))).digest('hex'), hash, path);
    const [major, minor, patch] = PDFJS_VERSION.split('.').map(Number);
    assert.ok(major > 6 || (major === 6 && (minor > 2 || (minor === 2 && patch >= 108))), 'never below 6.2.108 (CVE-2026-16633)');
  });

  it('is served from the versioned folder under the same strict policy: no connections allowed', async () => {
    for (const file of ['pdf.min.mjs', 'pdf.worker.min.mjs', 'openjpeg_nowasm_fallback.js', 'jbig2_nowasm_fallback.js', 'cmaps/UniJIS-UCS2-H.bcmap.mjs', 'LICENSE']) {
      assert.ok(readFileSync(join(dir, 'dist', 'assets', 'vendor', `pdfjs-${PDFJS_VERSION}`, file)), file);
    }
    for (const lang of ['en', 'ka']) {
      const csp = /<meta http-equiv="Content-Security-Policy" content="([^"]+)"/.exec(pages[lang])?.[1] ?? '';
      assert.match(csp, /connect-src 'none'/, lang);
      assert.match(csp, /require-trusted-types-for 'script'/, lang);
      assert.doesNotMatch(pages[lang], /pdfjs/, `${lang}: the page itself loads nothing of PDF.js`);
    }
    const headers = await readFile(join(dir, 'dist', '_headers'), 'utf8');
    assert.doesNotMatch(headers, /pdf-tools/, 'no page-specific policy for this tool');
  });
});

describe('PDF tools: privacy', () => {
  it('uses no network, storage or URL state in its own modules', () => {
    for (const module of ['tool-pdf', 'pdf-view']) {
      const source = readFileSync(new URL(`../src/client/${module}.mjs`, import.meta.url), 'utf8').replace('async fetch({ kind, filename })', '');
      for (const word of [/\bfetch\(/, /XMLHttpRequest/, /sendBeacon/, /WebSocket/, /localStorage/, /sessionStorage/, /indexedDB/, /\blocation\./, /\bhistory\.(?:pushState|replaceState)/, /\bdocument\.cookie/]) {
        assert.doesNotMatch(source, word, module);
      }
    }
  });
});

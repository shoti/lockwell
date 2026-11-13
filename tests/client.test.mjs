// @ts-check
/**
 * @file Tests for the browser modules and the asset pipeline.
 */
/** Pure logic from the browser modules and the asset pipeline (no DOM needed). */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { contentSecurityPolicy, fontsIn, headersFile, versionImports } from '../src/build/assets.mjs';
import { countDone, formatProgress } from '../src/client/checklist.mjs';
import { parseProgress, serializeProgress } from '../src/client/storage.mjs';

describe('saved progress format (L6)', () => {
  it('round-trips versioned data', () => {
    assert.deepEqual(parseProgress(serializeProgress(['a', 'b'])), ['a', 'b']);
    assert.equal(serializeProgress(['a']), '{"v":1,"done":["a"]}');
  });

  it('treats old, unknown or corrupted data as nothing saved', () => {
    assert.deepEqual(parseProgress(null), []);
    assert.deepEqual(parseProgress('["a","b"]'), []);
    assert.deepEqual(parseProgress('{"v":2,"done":["a"]}'), []);
    assert.deepEqual(parseProgress('{not json'), []);
    assert.deepEqual(parseProgress('{"v":1,"done":["a",3,null]}'), ['a']);
  });
});

describe('progress counting (L4)', () => {
  it('ignores saved ids of items that no longer exist', () => {
    assert.equal(countDone(['a', 'removed', 'c'], new Set(['a', 'b', 'c'])), 2);
  });

  it('formats progress text', () => {
    assert.equal(formatProgress('{done} of {total} done', 2, 6), '2 of 6 done');
  });
});

describe('asset pipeline', () => {
  it('M4: versions every relative module import', () => {
    const source = "import { a } from './storage.mjs';\nimport {\n  b,\n} from \"./tabs.mjs\";\nimport './side.mjs';\nconst x = import('./lazy.mjs');";
    assert.equal(
      versionImports(source, 'abc'),
      "import { a } from './storage.mjs?v=abc';\nimport {\n  b,\n} from \"./tabs.mjs?v=abc\";\nimport './side.mjs?v=abc';\nconst x = import('./lazy.mjs?v=abc');",
    );
  });

  it('L10: takes the font list from the CSS', () => {
    assert.deepEqual(fontsIn('src: url("../fonts/a.woff2") format("woff2"); src: local("Arial");'), ['/fonts/a.woff2']);
  });

  it('L11: CSP has no data: images and no unsafe-inline', () => {
    const csp = contentSecurityPolicy();
    assert.match(csp, /img-src 'self';/);
    assert.doesNotMatch(csp, /data:|unsafe-inline/);
  });

  it('M7: _headers blocks framing and sets security headers', () => {
    const headers = headersFile(contentSecurityPolicy());
    assert.match(headers, /frame-ancestors 'none'/);
    assert.match(headers, /X-Content-Type-Options: nosniff/);
    assert.match(headers, /X-Frame-Options: DENY/);
  });

  it('SEC-4: CSP enforces Trusted Types, so a future innerHTML fails loudly', () => {
    assert.match(contentSecurityPolicy(), /require-trusted-types-for 'script'/);
  });

  it('PERF-4: versioned assets are cached long; unversioned fonts only briefly', () => {
    const headers = headersFile(contentSecurityPolicy());
    assert.match(headers, /\/assets\/\*\n  Cache-Control: public, max-age=31536000, immutable/);
    assert.match(headers, /\/fonts\/\*\n  Cache-Control: public, max-age=86400\n/);
  });
});

describe('final review fixes', async () => {
  const vm = await import('node:vm');
  const { HEAD_SCRIPT } = await import('../src/build/assets.mjs');
  const { applyChange } = await import('../src/client/checklist.mjs');
  const { readProgress } = await import('../src/client/storage.mjs');

  /**
   * Runs the inline head script against a fake page.
   * @param {{ modules: boolean, storage?: Record<string, string>, session?: Record<string, string>, ua?: string, touchPoints?: number, barcode?: boolean, share?: boolean, brave?: boolean }} options
   */
  function runHead({ modules, storage = {}, session = {}, ua = 'Mozilla/5.0 (Macintosh)', touchPoints = 0, barcode = false, share = false, brave = false }) {
    /** @type {(() => void)[]} */
    const timers = [];
    const root = { className: 'no-js', dataset: /** @type {Record<string, string>} */ ({}) };
    vm.runInNewContext(HEAD_SCRIPT, {
      document: { documentElement: root },
      HTMLScriptElement: { prototype: modules ? { noModule: false } : {} },
      localStorage: { getItem: (/** @type {string} */ key) => storage[key] ?? null },
      sessionStorage: { getItem: (/** @type {string} */ key) => session[key] ?? null },
      navigator: { userAgent: ua, maxTouchPoints: touchPoints, ...(share ? { share: () => Promise.resolve() } : {}), ...(brave ? { brave: {} } : {}) },
      setTimeout: (/** @type {() => void} */ fn) => timers.push(fn),
      ...(barcode ? { BarcodeDetector: class {} } : {}),
    });
    return { root, timers };
  }

  it('marks the browser family before first paint, so the browser check shows its own advice at once', () => {
    const cases = [
      ['Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:150.0) Gecko/20100101 Firefox/150.0', 'firefox'],
      ['Mozilla/5.0 (Windows NT 10.0; rv:128.0) Gecko/20100101 Firefox/128.0', 'firefox'], // Tor Browser says it is Firefox
      ['Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.1 Safari/605.1.15', 'safari'],
      ['Mozilla/5.0 (iPhone; CPU iPhone OS 26_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.1 Mobile/15E148 Safari/604.1', 'safari'],
      ['Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/157.0.0.0 Safari/537.36', 'chromium'],
      ['Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/157.0.0.0 Safari/537.36 Edg/157.0.0.0', 'chromium'],
      ['Mozilla/5.0 (Linux; Android 14; SM-A546B; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/130.0.0.0 Mobile Safari/537.36', 'chromium'],
      ['Mozilla/5.0 (iPhone; CPU iPhone OS 26_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/157.0 Mobile/15E148 Safari/604.1', 'other'],
      ['Mozilla/5.0 (iPhone; CPU iPhone OS 26_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [FBAN/FBIOS;FBAV/500.0]', 'other'],
      ['Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 DuckDuckGo/7 Safari/605.1.15', 'other'],
    ];
    for (const [ua, family] of cases) assert.equal(runHead({ modules: true, ua }).root.dataset.browser, family, ua);
    assert.equal(runHead({ modules: true, ua: cases[4][0], brave: true }).root.dataset.browser, 'brave');
  });

  it('makes one kind of request in all its scripts: the opt-in IP lookup to its own host', async () => {
    const dir = new URL('../src/client/', import.meta.url);
    const { readdir, readFile } = await import('node:fs/promises');
    /** @type {string[]} */
    const requests = [];
    for (const name of (await readdir(dir)).filter((file) => file.endsWith('.mjs'))) {
      const source = await readFile(new URL(name, dir), 'utf8');
      assert.doesNotMatch(source, /XMLHttpRequest|sendBeacon|EventSource|WebSocket|RTCPeerConnection|\.src\s*=|new Image\(|<link|importScripts/, name);
      for (const match of source.matchAll(/\bfetch\(([^,)]*)/g)) requests.push(`${name}: ${match[1]}`);
    }
    assert.deepEqual(requests, ['tool-browser.mjs: TRACE_URL']);
  });

  it('marks browsers that can share (Web Share API) before first paint, so share buttons don’t pop in', () => {
    assert.equal(runHead({ modules: true, share: true }).root.dataset.share, '1');
    assert.equal(runHead({ modules: true }).root.dataset.share, undefined);
  });

  it('marks browsers with a built-in QR code reader before first paint, so the link checker’s picture field doesn’t pop in', () => {
    // A data attribute, not a class: startFeatures() rewrites the class list once the page is ready.
    const reader = runHead({ modules: true, barcode: true }).root;
    assert.equal(reader.dataset.qr, '1');
    assert.equal(reader.className, 'js');
    assert.equal(runHead({ modules: true }).root.dataset.qr, undefined);
    assert.equal(runHead({ modules: false, barcode: true }).root.dataset.qr, undefined);
  });

  it('R3: uses the JS layout only in browsers that run ES modules', () => {
    assert.equal(runHead({ modules: true }).root.className, 'js');
    const old = runHead({ modules: false });
    assert.equal(old.root.className, 'no-js');
    assert.equal(old.timers.length, 0);
  });

  it('R3: falls back to the no-JS layout if main.mjs never starts', () => {
    const { root, timers } = runHead({ modules: true });
    timers.forEach((fn) => fn());
    assert.equal(root.className, 'no-js');
  });

  it('R3: keeps the JS layout once main.mjs has started', () => {
    const { root, timers } = runHead({ modules: true });
    root.className = 'js js-ready';
    timers.forEach((fn) => fn());
    assert.equal(root.className, 'js js-ready');
  });

  it('head script applies a saved theme before first paint, and nothing else as a theme', () => {
    assert.equal(runHead({ modules: true, storage: { 'lockwell:theme': 'dark' } }).root.dataset.theme, 'dark');
    assert.equal(runHead({ modules: true, storage: { 'lockwell:theme': 'light' } }).root.dataset.theme, 'light');
    assert.equal(runHead({ modules: true }).root.dataset.theme, undefined, 'no choice saved: the system setting decides');
    assert.equal(runHead({ modules: true, storage: { 'lockwell:theme': 'pink" onload="x' } }).root.dataset.theme, undefined);
  });

  it('head script still picks a platform when storage is blocked', () => {
    const root = { className: 'no-js', dataset: /** @type {Record<string, string>} */ ({}) };
    const blocked = { getItem: () => { throw new Error('SecurityError'); } };
    vm.runInNewContext(HEAD_SCRIPT, {
      document: { documentElement: root },
      HTMLScriptElement: { prototype: { noModule: false } },
      localStorage: blocked,
      sessionStorage: blocked,
      navigator: { userAgent: 'Mozilla/5.0 (Linux; Android 14)', maxTouchPoints: 5 },
      setTimeout: () => 0,
    });
    assert.equal(root.className, 'js');
    assert.equal(root.dataset.platform, 'android');
    assert.equal(root.dataset.theme, undefined);
  });

  it('head script picks the saved platform, else guesses from the user agent', () => {
    assert.equal(runHead({ modules: true, storage: { 'lockwell:platform': 'android' } }).root.dataset.platform, 'android');
    assert.equal(runHead({ modules: true, ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0)' }).root.dataset.platform, 'ios');
    assert.equal(runHead({ modules: true, storage: { 'lockwell:platform': 'evil' } }).root.dataset.platform, 'desktop');
  });

  it('PRV-1: a platform picked on a session-only guide (sessionStorage) wins over the saved one', () => {
    const both = runHead({ modules: true, storage: { 'lockwell:platform': 'desktop' }, session: { 'lockwell:platform': 'android' } });
    assert.equal(both.root.dataset.platform, 'android');
  });

  it('PRV-1: platform choices on session-only guides are kept for this tab only', async () => {
    const { platformArea } = await import('../src/client/tabs.mjs');
    assert.equal(platformArea({ dataset: { storage: 'session' } }), 'session');
    assert.equal(platformArea({ dataset: { storage: 'local' } }), 'local');
    assert.equal(platformArea(null), 'local', 'pages without a checklist');
  });

  it('BUG-8: treats an iPad (Mac user agent with a touch screen) as iOS, and a Mac as desktop', () => {
    const ipad = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15';
    assert.equal(runHead({ modules: true, ua: ipad, touchPoints: 5 }).root.dataset.platform, 'ios');
    assert.equal(runHead({ modules: true, ua: ipad, touchPoints: 0 }).root.dataset.platform, 'desktop');
  });

  it('ARC-1: the head script accepts exactly the platform keys the build allows', async () => {
    const { PLATFORM_KEYS } = await import('../src/build/guide.mjs');
    for (const key of PLATFORM_KEYS) {
      assert.equal(runHead({ modules: true, storage: { 'lockwell:platform': key } }).root.dataset.platform, key);
    }
  });

  it('R2: with storage unavailable, ticking an item keeps the other ticked items', () => {
    const ids = new Set(['a', 'b', 'c']);
    let done = applyChange(new Set(), null, ids, 'a', true);
    done = applyChange(done, null, ids, 'b', true);
    assert.deepEqual([...done].sort(), ['a', 'b']);
  });

  it('R2/L5: with storage available, changes start from what is saved (other tabs win)', () => {
    const ids = new Set(['a', 'b', 'c']);
    const done = applyChange(new Set(['a']), ['b', 'gone'], ids, 'c', true);
    assert.deepEqual([...done].sort(), ['b', 'c']);
  });

  it('R2: readProgress returns null (not []) when storage throws', () => {
    const throwing = { getItem: () => { throw new Error('SecurityError'); } };
    const empty = { getItem: () => null };
    const originalWarn = console.warn;
    const globals = /** @type {Record<string, unknown>} */ (/** @type {unknown} */ (globalThis));
    try {
      console.warn = () => {};
      globals.window = { localStorage: throwing, sessionStorage: empty };
      assert.equal(readProgress('g1', 'local'), null);
      assert.deepEqual(readProgress('g1', 'session'), []);
    } finally {
      console.warn = originalWarn;
      delete globals.window;
    }
  });
});

describe('startup (BUG-1, BUG-9)', async () => {
  const { startFeatures } = await import('../src/client/start.mjs');
  const quiet = () => {};

  /** @param {string[]} calls @param {string} [failing] */
  const features = (calls, failing) =>
    ['theme', 'tabs', 'checklist'].map((name) => ({
      name,
      layout: name === 'tabs',
      init: () => {
        calls.push(name);
        if (name === failing) throw new Error(`${name} broke`);
      },
    }));

  it('runs every feature and marks the page ready', () => {
    const root = { className: 'js' };
    /** @type {string[]} */
    const calls = [];
    startFeatures(features(calls), root, quiet);
    assert.deepEqual(calls, ['theme', 'tabs', 'checklist']);
    assert.equal(root.className, 'js js-ready');
  });

  it('keeps going when one feature throws, and logs it', () => {
    const root = { className: 'js' };
    /** @type {string[]} */
    const calls = [];
    /** @type {unknown[][]} */
    const logged = [];
    startFeatures(features(calls, 'theme'), root, (...args) => logged.push(args));
    assert.deepEqual(calls, ['theme', 'tabs', 'checklist']);
    assert.equal(root.className, 'js js-ready');
    assert.match(String(logged[0][0]), /theme/);
  });

  it('falls back to the no-JS layout when a layout feature throws, so no steps stay hidden', () => {
    const root = { className: 'js' };
    startFeatures(features([], 'tabs'), root, quiet);
    assert.equal(root.className, 'no-js js-ready');
  });

  it('stays in the no-JS layout if the head script fallback already fired (no second jump)', () => {
    const root = { className: 'no-js' };
    /** @type {string[]} */
    const calls = [];
    startFeatures(features(calls), root, quiet);
    assert.deepEqual(calls, ['theme', 'checklist'], 'layout features are skipped');
    assert.equal(root.className, 'no-js js-ready');
  });
});

describe('theme toggle (BUG-1, BUG-6, BUG-14)', async () => {
  const { FakeButton, installDom } = await import('./fake-dom.mjs');
  const { initTheme } = await import('../src/client/theme.mjs');

  it('starts in browsers whose MediaQueryList has only addListener (Safari 13)', () => {
    /** @type {unknown[]} */
    const legacy = [];
    const dom = installDom({
      select: { '[data-js="theme-toggle"]': [new FakeButton()] },
      matchMedia: () => ({ matches: false, addListener: (/** @type {unknown} */ fn) => legacy.push(fn) }),
    });
    try {
      assert.doesNotThrow(() => initTheme());
      assert.equal(legacy.length, 1, 'listens for system theme changes the old way');
    } finally {
      dom.restore();
    }
  });

  it('follows a theme picked in another tab', () => {
    const button = new FakeButton();
    const dom = installDom({ select: { '[data-js="theme-toggle"]': [button] } });
    try {
      initTheme();
      dom.local.setItem('lockwell:theme', 'dark');
      dom.window.dispatchEvent({ type: 'storage', key: 'lockwell:theme' });
      assert.equal(dom.root.dataset.theme, 'dark');
      assert.equal(button.getAttribute('aria-pressed'), 'true');
      dom.local.removeItem('lockwell:theme');
      dom.window.dispatchEvent({ type: 'storage', key: null });
      assert.equal(dom.root.dataset.theme, undefined);
    } finally {
      dom.restore();
    }
  });

  it('re-reads the saved theme when the page comes back from the back/forward cache', () => {
    const dom = installDom({ select: { '[data-js="theme-toggle"]': [new FakeButton()] } });
    try {
      dom.root.dataset.theme = 'dark';
      initTheme();
      dom.window.dispatchEvent({ type: 'pageshow', persisted: true });
      assert.equal(dom.root.dataset.theme, undefined, 'data was cleared on another page');
    } finally {
      dom.restore();
    }
  });
});

describe('checklist state (BUG-6, BUG-7)', async () => {
  const { FakeElement, installDom } = await import('./fake-dom.mjs');
  const { createProgress, initCardProgress, initChecklist } = await import('../src/client/checklist.mjs');

  /** @param {string[] | null} saved */
  const store = (saved) => {
    /** @type {string[][]} */
    const writes = [];
    return { writes, read: () => saved, write: (/** @type {string[]} */ done) => (writes.push(done), true) };
  };

  it('BUG-7: when saving fails, later ticks keep the earlier ones (memory-only from then on)', () => {
    const ids = new Set(['a', 'b', 'c']);
    // Reading works and returns "nothing saved", but every save fails (quota, hardened modes).
    const progress = createProgress(ids, { read: () => [], write: () => false });
    progress.change('a', true);
    progress.change('b', true);
    assert.deepEqual([...progress.done].sort(), ['a', 'b']);
  });

  it('starts each change from what is saved, so other tabs win (L5)', () => {
    const s = store(['b', 'gone']);
    const progress = createProgress(new Set(['a', 'b', 'c']), s);
    progress.change('c', true);
    assert.deepEqual([...progress.done].sort(), ['b', 'c']);
    assert.deepEqual(s.writes.at(-1)?.sort(), ['b', 'c']);
  });

  /** A guide page with two checklist items. */
  const guidePage = () => {
    const checks = ['a', 'b'].map((id) => Object.assign(new FakeElement('input', { js: 'item-check' }), { value: id }));
    const root = new FakeElement('div', { js: 'checklist', guide: 'g1', storage: 'local' });
    root.select['input[data-js="item-check"]'] = checks;
    return { root, checks };
  };

  it('follows this guide\'s progress from another tab, and ignores other keys', () => {
    const { root, checks } = guidePage();
    const dom = installDom({ select: { '[data-js="checklist"]': [root] } });
    try {
      initChecklist();
      dom.local.setItem('lockwell:progress:g1', '{"v":1,"done":["a"]}');
      dom.window.dispatchEvent({ type: 'storage', key: 'lockwell:progress:other' });
      assert.equal(checks[0].checked, false, 'another guide changed: this page is left alone');
      dom.window.dispatchEvent({ type: 'storage', key: 'lockwell:theme' });
      assert.equal(checks[0].checked, false);
      dom.window.dispatchEvent({ type: 'storage', key: 'lockwell:progress:g1' });
      assert.equal(checks[0].checked, true);
      dom.local.removeItem('lockwell:progress:g1');
      dom.window.dispatchEvent({ type: 'storage', key: null }); // storage.clear() in another tab
      assert.equal(checks[0].checked, false);
    } finally {
      dom.restore();
    }
  });

  it('BUG-6: re-reads progress when the page comes back from the back/forward cache', () => {
    const { root, checks } = guidePage();
    const dom = installDom({ select: { '[data-js="checklist"]': [root] } });
    try {
      dom.local.setItem('lockwell:progress:g1', '{"v":1,"done":["a"]}');
      initChecklist();
      assert.equal(checks[0].checked, true);
      dom.local.removeItem('lockwell:progress:g1'); // "Clear saved data" on another page
      dom.window.dispatchEvent({ type: 'pageshow', persisted: false });
      assert.equal(checks[0].checked, true, 'a normal load is left alone');
      dom.window.dispatchEvent({ type: 'pageshow', persisted: true });
      assert.equal(checks[0].checked, false);
    } finally {
      dom.restore();
    }
  });

  it('step lists on the guides index mark finished steps and clear them again', () => {
    /** @param {string} id */
    const step = (id) => {
      const doneText = new FakeElement('span', { js: 'toc-done', text: '(done)' });
      const link = new FakeElement('a', { js: 'toc-link', item: id });
      link.select['[data-js="toc-done"]'] = [doneText];
      return { link, doneText };
    };
    const a = step('a');
    const b = step('b');
    const list = new FakeElement('ol', { js: 'guide-contents', guide: 'g1', storage: 'session' });
    list.select['[data-js="toc-link"]'] = [a.link, b.link];
    const dom = installDom({ select: { '[data-js="guide-contents"]': [list] } });
    try {
      dom.session.setItem('lockwell:progress:g1', '{"v":1,"done":["b"]}');
      initCardProgress();
      assert.deepEqual([a.link.classList.contains('is-done'), b.link.classList.contains('is-done')], [false, true]);
      assert.deepEqual([a.doneText.textContent, b.doneText.textContent], ['', '(done)']);
      dom.session.map.clear();
      dom.document.dispatchEvent({ type: 'lockwell:cleared' });
      assert.equal(b.link.classList.contains('is-done'), false);
      assert.equal(b.doneText.textContent, '');
    } finally {
      dom.restore();
    }
  });

  it('sidebar marks follow ticks on the page at once, and tell a started guide from a finished one', () => {
    const card = Object.assign(new FakeElement('span', { js: 'card-progress', guide: 'g1', storage: 'local', items: 'a b' }));
    const text = new FakeElement('span', { js: 'progress-text', template: '{done} of {total} done' });
    card.select = { '[data-js="progress-text"]': [text], '[data-js="progress-bar"]': [] };
    const reset = new FakeElement('button', { js: 'progress-reset' });
    const dom = installDom({ select: { '[data-js="card-progress"]': [card], '[data-js="progress-reset"]': [reset] } });
    const state = () => [card.classList.contains('is-visible'), card.classList.contains('is-complete'), text.textContent];
    try {
      initCardProgress();
      assert.deepEqual(state(), [false, false, '0 of 2 done']);
      // The checklist saves on "change" before this listener runs; here the save is done by hand.
      dom.local.setItem('lockwell:progress:g1', '{"v":1,"done":["a"]}');
      dom.document.dispatchEvent({ type: 'change' });
      assert.deepEqual(state(), [true, false, '1 of 2 done'], 'started');
      dom.local.setItem('lockwell:progress:g1', '{"v":1,"done":["a","b"]}');
      dom.document.dispatchEvent({ type: 'change' });
      assert.deepEqual(state(), [true, true, '2 of 2 done'], 'finished');
      dom.local.removeItem('lockwell:progress:g1');
      reset.click();
      assert.deepEqual(state(), [false, false, '0 of 2 done'], '"Clear my progress" on the page');
    } finally {
      dom.restore();
    }
  });

  it('BUG-6: guide cards refresh when the page comes back from the back/forward cache', () => {
    const card = new FakeElement('span', { js: 'card-progress', guide: 'g1', storage: 'local', items: 'a b' });
    const dom = installDom({ select: { '[data-js="card-progress"]': [card] } });
    try {
      dom.local.setItem('lockwell:progress:g1', '{"v":1,"done":["a"]}');
      initCardProgress();
      assert.equal(card.classList.contains('is-visible'), true);
      dom.local.removeItem('lockwell:progress:g1');
      dom.window.dispatchEvent({ type: 'pageshow', persisted: true });
      assert.equal(card.classList.contains('is-visible'), false);
    } finally {
      dom.restore();
    }
  });
});

describe('accessibility wiring (UI-4, UI-6)', async () => {
  const { FakeButton, FakeElement, installDom } = await import('./fake-dom.mjs');
  const { initClearData } = await import('../src/client/clear-data.mjs');
  const { initChecklist } = await import('../src/client/checklist.mjs');

  it('UI-4: clearing data keeps the button usable and announces the result', () => {
    const button = Object.assign(new FakeButton({ js: 'clear-data', done: 'Saved data cleared' }), { textContent: 'Clear saved data' });
    const status = new FakeElement('span', { js: 'clear-data-status' });
    const dom = installDom({ select: { '[data-js="clear-data"]': [button], '[data-js="clear-data-status"]': [status] } });
    try {
      dom.local.setItem('lockwell:theme', 'dark');
      initClearData();
      button.click();
      assert.equal(dom.local.getItem('lockwell:theme'), null);
      assert.equal(button.disabled, false, 'a disabled button would drop keyboard focus');
      assert.equal(status.textContent, 'Saved data cleared');
    } finally {
      dom.restore();
    }
  });

  it('UI-6: finished items in the contents list say so to screen readers', () => {
    const check = Object.assign(new FakeElement('input', { js: 'item-check' }), { value: 'a' });
    const doneText = new FakeElement('span', { js: 'toc-done', text: '(done)' });
    const link = new FakeElement('a', { js: 'toc-link', item: 'a' });
    link.select['[data-js="toc-done"]'] = [doneText];
    const root = new FakeElement('div', { js: 'checklist', guide: 'g1', storage: 'local' });
    root.select['input[data-js="item-check"]'] = [check];
    root.select['[data-js="toc-link"]'] = [link];
    const dom = installDom({ select: { '[data-js="checklist"]': [root] } });
    try {
      initChecklist();
      assert.equal(doneText.textContent, '');
      dom.local.setItem('lockwell:progress:g1', '{"v":1,"done":["a"]}');
      dom.window.dispatchEvent({ type: 'storage', key: 'lockwell:progress:g1' });
      assert.equal(doneText.textContent, '(done)');
    } finally {
      dom.restore();
    }
  });
});

describe('continue where you left off', async () => {
  const { FakeElement, installDom } = await import('./fake-dom.mjs');
  const { initContinue, pickContinue } = await import('../src/client/continue.mjs');

  it('offers the first unfinished guide, but only after something was ticked', () => {
    assert.equal(pickContinue([{ done: 0, total: 6 }, { done: 0, total: 6 }]), -1, 'new visitor');
    assert.equal(pickContinue([{ done: 2, total: 6 }, { done: 0, total: 6 }]), 0, 'in progress');
    assert.equal(pickContinue([{ done: 6, total: 6 }, { done: 0, total: 6 }]), 1, 'first one finished: the next guide');
    assert.equal(pickContinue([{ done: 0, total: 6 }, { done: 1, total: 6 }]), 0, 'skipped the first guide: still offer it');
    assert.equal(pickContinue([{ done: 6, total: 6 }, { done: 6, total: 6 }]), -1, 'everything finished');
  });

  it('on a page with two tracks, stays inside the tracks the visitor has worked on', () => {
    const everyone = (/** @type {number} */ done) => ({ done, total: 6, track: 'everyone' });
    const risk = (/** @type {number} */ done) => ({ done, total: 6, track: 'high-risk' });
    assert.equal(pickContinue([everyone(0), everyone(0), risk(0), risk(2)]), 2, 'only high-risk started: its first unfinished guide');
    assert.equal(pickContinue([everyone(0), everyone(1), risk(0), risk(0)]), 0, 'only everyone started: unchanged');
    assert.equal(pickContinue([everyone(6), everyone(6), risk(1), risk(0)]), 2, 'everyone finished: carry on with high-risk');
    assert.equal(pickContinue([everyone(6), everyone(6), risk(0), risk(0)]), -1, 'nothing started in the other track');
  });

  it('fills the link from saved progress and empties it again when data is cleared', () => {
    const title = new FakeElement('span');
    const count = new FakeElement('span');
    const link = new FakeElement('a');
    const guides = [
      new FakeElement('span', { guide: 'g1', storage: 'local', items: 'a b', href: '/guides/one/', title: 'One' }),
      new FakeElement('span', { guide: 'g2', storage: 'local', items: 'c d', href: '/guides/two/', title: 'Two' }),
    ];
    link.select = { '[data-js="continue-title"]': [title], '[data-js="continue-count"]': [count], '[data-js="continue-guide"]': guides };
    const dom = installDom({ select: { '[data-js="continue"]': [link] } });
    try {
      initContinue();
      assert.equal(link.classList.contains('is-visible'), false, 'nothing saved: stays invisible');
      assert.equal(link.getAttribute('href'), null);

      dom.local.setItem('lockwell:progress:g1', '{"v":1,"done":["a","b"]}');
      dom.local.setItem('lockwell:progress:g2', '{"v":1,"done":["c"]}');
      dom.window.dispatchEvent({ type: 'storage', key: 'lockwell:progress:g2' });
      assert.equal(link.getAttribute('href'), '/guides/two/');
      assert.deepEqual([title.textContent, count.textContent], ['Two', '1/2']);
      assert.equal(link.classList.contains('is-visible'), true);

      dom.local.map.clear();
      dom.document.dispatchEvent({ type: 'lockwell:cleared' });
      assert.equal(link.classList.contains('is-visible'), false);
      assert.equal(link.getAttribute('href'), null);
    } finally {
      dom.restore();
    }
  });
});

describe('step filters', async () => {
  const { FakeButton, FakeElement, installDom } = await import('./fake-dom.mjs');
  const { hiddenItems, initFilters } = await import('../src/client/filters.mjs');

  const ITEMS = [
    { id: 'a', priority: 'essential', done: true },
    { id: 'b', priority: 'essential', done: false },
    { id: 'c', priority: 'advanced', done: false },
  ];

  it('hides non-essential items, finished items, or both', () => {
    assert.deepEqual([...hiddenItems(ITEMS, { essentialOnly: false, hideDone: false })], []);
    assert.deepEqual([...hiddenItems(ITEMS, { essentialOnly: true, hideDone: false })], ['c']);
    assert.deepEqual([...hiddenItems(ITEMS, { essentialOnly: false, hideDone: true })], ['a']);
    assert.deepEqual([...hiddenItems(ITEMS, { essentialOnly: true, hideDone: true })], ['a', 'c']);
  });

  /** Builds a fake guide page with the three ITEMS. */
  function page() {
    const checks = ITEMS.map((item) => Object.assign(new FakeElement('input'), { checked: item.done }));
    const items = ITEMS.map((item, i) => {
      const element = Object.assign(new FakeElement('article', { priority: item.priority }), { id: item.id, hidden: false });
      element.select = { '[data-js="item-check"]': [checks[i]] };
      return element;
    });
    const essential = new FakeButton({ filter: 'essentialOnly' });
    const hideDone = new FakeButton({ filter: 'hideDone' });
    const status = new FakeElement('p', { template: 'Showing {shown} of {total} steps' });
    const empty = Object.assign(new FakeElement('p'), { hidden: true });
    const reset = new FakeButton();
    const bar = new FakeElement('div');
    bar.select = { '[data-js="filter"]': [essential, hideDone], '[data-js="filter-status"]': [status] };
    const checklist = new FakeElement('div');
    checklist.select = { '[data-js="item"]': items, '[data-js="filter-empty"]': [empty], '[data-js="progress-reset"]': [reset] };
    const dom = installDom({ select: { '[data-js="filters"]': [bar], '[data-js="checklist"]': [checklist] } });
    /** @returns {boolean[]} */
    const hidden = () => items.map((item) => item.hidden);
    return { dom, checks, essential, hideDone, status, empty, reset, hidden };
  }

  it('pressing a filter hides items, marks the button pressed and says how many are shown', () => {
    const { dom, essential, hideDone, status, hidden } = page();
    try {
      initFilters();
      assert.deepEqual(hidden(), [false, false, false], 'a guide always opens complete');
      essential.click();
      assert.equal(essential.getAttribute('aria-pressed'), 'true');
      assert.deepEqual(hidden(), [false, false, true]);
      assert.equal(status.textContent, 'Showing 2 of 3 steps');
      hideDone.click();
      assert.deepEqual(hidden(), [true, false, true]);
      essential.click();
      hideDone.click();
      assert.deepEqual(hidden(), [false, false, false]);
      assert.equal(status.textContent, '', 'no status when no filter is on');
    } finally {
      dom.restore();
    }
  });

  it('an item ticked while "Hide done" is on stays until a filter changes; an empty list gets a message', () => {
    const { dom, checks, essential, hideDone, empty, reset, hidden } = page();
    try {
      initFilters();
      hideDone.click();
      checks[1].checked = true;
      assert.deepEqual(hidden(), [true, false, false], 'ticking does not make the item vanish');
      checks[2].checked = true;
      essential.click();
      assert.deepEqual(hidden(), [true, true, true]);
      assert.equal(empty.hidden, false);

      checks.forEach((check) => {
        check.checked = false;
      });
      reset.click();
      assert.deepEqual(hidden(), [false, false, true], 'after clearing progress nothing is "done" any more');
      assert.equal(empty.hidden, true);
    } finally {
      dom.restore();
    }
  });
});

describe('search', async () => {
  const { FakeElement, installDom } = await import('./fake-dom.mjs');
  const { initSearch, matchEntries, normalize } = await import('../src/client/search.mjs');

  const ENTRIES = [
    { title: 'secure your accounts and passwords', text: 'a password manager and two-step verification' },
    { title: 'use a password manager', text: 'install bitwarden' },
    { title: 'make your messaging apps private', text: 'whatsapp telegram signal linked devices' },
    { title: 'დაიცავით მიმოწერა მესენჯერებში', text: 'დაკავშირებული მოწყობილობები' },
  ];

  it('finds entries that contain every word, in titles or text, whatever the case', () => {
    assert.deepEqual(matchEntries(ENTRIES, 'Bitwarden'), [1]);
    assert.deepEqual(matchEntries(ENTRIES, '  linked   DEVICES '), [2]);
    assert.deepEqual(matchEntries(ENTRIES, 'password telegram'), []);
    assert.deepEqual(matchEntries(ENTRIES, 'მოწყობილობები'), [3], 'Georgian');
    assert.equal(normalize('  Signal '), 'signal');
  });

  it('compacted search text matches exactly the same queries as the full text', async () => {
    const { compactSearchText } = await import('../src/build/search.mjs');
    const full = [
      { title: 'turn on lockdown mode', text: 'open settings → privacy & security → lockdown mode, then turn on lockdown mode. lock the phone; locking helps. lockdown mode limits attachments.' },
      { title: 'ჩართეთ lockdown mode', text: 'გახსენით settings → privacy & security. ჩართეთ, ჩართეთ და გადატვირთეთ ტელეფონი ტელეფონი.' },
    ];
    const compact = full.map(({ title, text }) => ({ title, text: compactSearchText(text, title) }));
    assert.ok(compact[0].text.length < full[0].text.length, 'repeats and contained words are dropped');
    const words = new Set(full.flatMap(({ title, text }) => `${title} ${text}`.split(/\s+/)));
    /** @type {string[]} */
    const queries = ['missing', 'lock zzz', 'privacy lockdown'];
    for (const word of words) for (let i = 0; i < word.length; i++) for (let j = i + 1; j <= word.length; j++) queries.push(word.slice(i, j));
    for (const query of queries) assert.deepEqual(matchEntries(compact, query), matchEntries(full, query), query);
  });

  it('ranks title matches first and shows everything for an empty query', () => {
    assert.deepEqual(matchEntries(ENTRIES, 'password manager'), [1, 0], 'both words in the title beat one');
    assert.equal(matchEntries(ENTRIES, '   '), null);
  });

  it('typing hides other entries, moves the best match first and reports the count', () => {
    const items = ENTRIES.map((entry) => Object.assign(new FakeElement('li', entry), { hidden: false }));
    const input = new FakeElement('input');
    const list = new FakeElement('ul');
    list.select = { '[data-js="search-entry"]': items };
    const status = new FakeElement('p', { template: 'Results: {n}' });
    const empty = Object.assign(new FakeElement('p'), { hidden: true });
    const dom = installDom({
      select: {
        '[data-js="search-input"]': [input],
        '[data-js="search-results"]': [list],
        '[data-js="search-status"]': [status],
        '[data-js="search-empty"]': [empty],
      },
    });
    try {
      initSearch();
      input.value = 'password manager';
      input.dispatchEvent({ type: 'input' });
      assert.deepEqual(items.map((item) => item.hidden), [false, false, true, true]);
      assert.deepEqual(list.children, [items[1], items[0]]);
      assert.equal(status.textContent, 'Results: 2');

      input.value = 'zzz';
      input.dispatchEvent({ type: 'input' });
      assert.equal(empty.hidden, false);
      assert.equal(status.textContent, 'Results: 0');

      input.value = '';
      input.dispatchEvent({ type: 'input' });
      assert.deepEqual(items.map((item) => item.hidden), [false, false, false, false]);
      assert.deepEqual(list.children, items, 'back in the page’s own order');
      assert.equal(status.textContent, '');
      assert.equal(empty.hidden, true);
    } finally {
      dom.restore();
    }
  });
});

describe('contents list on small screens', async () => {
  const { FakeElement, installDom } = await import('./fake-dom.mjs');
  const { initToc } = await import('../src/client/checklist.mjs');

  /**
   * Runs initToc against an open contents list.
   * @param {{ wide: boolean, breakpoint?: string }} options
   */
  function run({ wide, breakpoint = '64rem' }) {
    const toc = Object.assign(new FakeElement('details', { js: 'toc' }), { open: true });
    /** @type {string[]} */
    const queries = [];
    const dom = installDom({
      select: { '[data-js="toc"]': [toc] },
      matchMedia: (query) => (queries.push(query), { matches: wide }),
    });
    const g = /** @type {Record<string, unknown>} */ (globalThis);
    const saved = { HTMLDetailsElement: g.HTMLDetailsElement, getComputedStyle: g.getComputedStyle };
    g.HTMLDetailsElement = FakeElement;
    // The width is read from the list itself, so each list can have its own (CSS sets --bp-wide on it).
    g.getComputedStyle = (/** @type {unknown} */ element) => ({ getPropertyValue: (/** @type {string} */ name) => (element === toc && name === '--bp-wide' ? ` ${breakpoint} ` : '') });
    try {
      initToc();
    } finally {
      Object.assign(g, saved);
      dom.restore();
    }
    return { toc, queries };
  }

  it('closes the list below the wide breakpoint and leaves it open above it', () => {
    const narrow = run({ wide: false });
    assert.equal(narrow.toc.open, false);
    assert.equal(narrow.toc.dataset.ready, '', 'CSS stops hiding the list once the script has decided');
    const wide = run({ wide: true });
    assert.equal(wide.toc.open, true);
    assert.equal(wide.toc.dataset.ready, '');
  });

  it('handles every sidebar list on the page, and only real <details> elements', () => {
    const lists = [0, 1].map(() => Object.assign(new FakeElement('details', { js: 'toc' }), { open: true }));
    const other = Object.assign(new FakeElement('div', { js: 'toc' }), { open: true });
    // A 70rem-wide window: wide enough for "All guides" (64rem), not for a guide's own contents list (80rem).
    const dom = installDom({ select: { '[data-js="toc"]': [...lists, other] }, matchMedia: (query) => ({ matches: query === '(min-width: 64rem)' }) });
    const g = /** @type {Record<string, unknown>} */ (globalThis);
    const saved = { HTMLDetailsElement: g.HTMLDetailsElement, getComputedStyle: g.getComputedStyle };
    // Only elements created as <details> count as HTMLDetailsElement here.
    g.HTMLDetailsElement = class {
      static [Symbol.hasInstance](/** @type {{ tagName?: string }} */ value) {
        return value?.tagName === 'DETAILS';
      }
    };
    g.getComputedStyle = (/** @type {unknown} */ element) => ({ getPropertyValue: () => (element === lists[1] ? '80rem' : '64rem') });
    try {
      initToc();
    } finally {
      Object.assign(g, saved);
      dom.restore();
    }
    assert.deepEqual(lists.map((toc) => [toc.open, toc.dataset.ready]), [[true, ''], [false, '']], 'each list is judged by its own width');
    assert.deepEqual([other.open, other.dataset.ready], [true, undefined]);
  });

  it('brings the guide being read into view inside the sidebar, without moving a guide that is already visible', async () => {
    const { initGuideNav, scrollToShow } = await import('../src/client/checklist.mjs');
    const box = { top: 100, bottom: 700 };
    assert.equal(scrollToShow({ top: 300, bottom: 340 }, box), 0, 'fully visible');
    assert.equal(scrollToShow({ top: 100, bottom: 140 }, box), 0, 'visible at the very top');
    assert.equal(scrollToShow({ top: 1500, bottom: 1540 }, box), 1120, 'below: scroll down until it is in the middle');
    assert.equal(scrollToShow({ top: -200, bottom: -160 }, box), -580, 'above: scroll up');
    assert.equal(scrollToShow({ top: 680, bottom: 720 }, box), 300, 'half cut off at the bottom counts as hidden');

    const dom = installDom();
    try {
      assert.doesNotThrow(initGuideNav, 'a page without the sidebar');
    } finally {
      dom.restore();
    }
  });

  it('the sidebar keeps its scroll position from page to page, per track, in this tab only', async () => {
    const { initGuideNav, parseScroll, parseScrolls } = await import('../src/client/checklist.mjs');
    assert.deepEqual(['412', '412.6', '0', '-5', '', 'abc', 'Infinity', null].map(parseScroll), [412, 413, 0, 0, 0, 0, 0, 0]);
    assert.deepEqual(['50 412', '412', '', 'x 7', null].map(parseScrolls), [[50, 412], [412], [], [0, 7], []], 'one position per track, in page order; the old single value is the first track');

    const rect = (/** @type {number} */ top, /** @type {number} */ bottom) => () => ({ top, bottom });
    /**
     * A sidebar 600px tall with both tracks, `selected` shown, whose current guide (if any) sits at `itemTop`
     * (viewport position, as the browser reports it after scrolling).
     * @param {number} selected @param {number | null} itemTop
     */
    const page = (selected, itemTop) => {
      const panels = [0, 1].map((i) => {
        const panel = new FakeElement('section', { js: 'nav-track' });
        if (i === selected) panel.classList.add('is-selected');
        return panel;
      });
      const tabs = [0, 1].map((i) => {
        const tab = new FakeElement('button', { js: 'nav-tab' });
        tab.setAttribute('aria-selected', String(i === selected));
        return tab;
      });
      const scroller = Object.assign(new FakeElement('div', { js: 'nav-scroll' }), { getBoundingClientRect: rect(100, 700), scrollTop: 0 });
      const bar = Object.assign(new FakeElement('div', { js: 'nav-tabs' }), { getBoundingClientRect: () => ({ height: 44 }) });
      scroller.select = { '[data-js="nav-track"]': panels, '[data-js="nav-tab"]': tabs, '[data-js="nav-tabs"]': [bar] };
      const current = itemTop === null ? null : Object.assign(new FakeElement('a', { js: 'nav-current' }), { getBoundingClientRect: rect(itemTop, itemTop + 40) });
      /** @type {Record<string, InstanceType<typeof FakeElement>[]>} */
      const select = { '[data-js="nav-scroll"]': [scroller], ...(current ? { '[data-js="nav-current"]': [current] } : {}) };
      return { panels, tabs, scroller, select };
    };
    const shown = (/** @type {ReturnType<typeof page>} */ p) => p.panels.map((panel, i) => [panel.classList.contains('is-selected'), p.tabs[i].getAttribute('aria-selected'), p.tabs[i].getAttribute('tabindex')]);

    // First visit, on a guide of the second track that sits far down its list.
    const first = page(1, 1500);
    const dom = installDom({ select: first.select });
    /** @param {ReturnType<typeof page>} p */
    const open = (p) => {
      /** @type {any} */ (dom.document).querySelector = (/** @type {string} */ s) => p.select[s]?.[0] ?? null;
      initGuideNav();
    };
    try {
      initGuideNav();
      assert.equal(first.scroller.scrollTop, 1098, 'brought to the middle of what the switch above it leaves visible');

      // The visitor scrolls that list, then switches to the other track: it starts where it was left (the top).
      first.scroller.scrollTop = 412;
      first.tabs[0].click();
      assert.deepEqual(shown(first), [[true, 'true', '0'], [false, 'false', '-1']]);
      assert.equal(first.scroller.scrollTop, 0);
      first.scroller.scrollTop = 50;
      first.tabs[1].click();
      assert.equal(first.scroller.scrollTop, 412, 'each track comes back where it was');
      first.tabs[0].click();

      dom.window.dispatchEvent({ type: 'pagehide' });
      assert.equal(dom.session.getItem('lockwell:nav-scroll'), '50 412', 'positions only, by track order: no names');
      assert.equal(dom.local.getItem('lockwell:nav-scroll'), null, 'never kept after the tab is closed');

      // The guides list shows the first track: its own position, not the other list's.
      const list = page(0, null);
      open(list);
      assert.equal(list.scroller.scrollTop, 50);
      list.tabs[1].click();
      assert.equal(list.scroller.scrollTop, 412);

      // Keyboard: arrows move between the two tabs and wrap; Home and End go to the ends.
      /** @type {string[]} */
      const prevented = [];
      const key = (/** @type {InstanceType<typeof FakeElement>} */ tab, /** @type {string} */ k) => tab.dispatchEvent({ type: 'keydown', key: k, preventDefault: () => prevented.push(k) });
      key(list.tabs[1], 'ArrowRight');
      assert.deepEqual(shown(list).map(([on]) => on), [true, false]);
      key(list.tabs[0], 'ArrowLeft');
      assert.deepEqual(shown(list).map(([on]) => on), [false, true]);
      key(list.tabs[1], 'Home');
      assert.deepEqual(shown(list).map(([on]) => on), [true, false]);
      key(list.tabs[0], 'End');
      assert.deepEqual(shown(list).map(([on]) => on), [false, true]);
      key(list.tabs[1], 'a');
      key(list.tabs[1], 'constructor');
      assert.deepEqual(prevented, ['ArrowRight', 'ArrowLeft', 'Home', 'End'], 'other keys keep their default');

      // A value saved by the earlier version (one number) still restores the first track.
      dom.session.setItem('lockwell:nav-scroll', '300');
      const old = page(0, null);
      open(old);
      assert.equal(old.scroller.scrollTop, 300);

      // A guide whose link sits right under the switch (box top 100, switch 44px tall) is out of view.
      dom.session.removeItem('lockwell:nav-scroll');
      const hidden = page(1, 120);
      open(hidden);
      assert.equal(hidden.scroller.scrollTop, -282, 'scrolled until it is in the middle');
    } finally {
      dom.restore();
    }
  });
});

describe('features do nothing on pages without their elements', async () => {
  const { FakeElement, installDom } = await import('./fake-dom.mjs');

  it('search: a page with only the input, or only the list, is left alone', async () => {
    const { initSearch } = await import('../src/client/search.mjs');
    /** @type {Record<string, InstanceType<typeof FakeElement>[]>[]} */
    const pages = [{ '[data-js="search-input"]': [new FakeElement('input')] }, { '[data-js="search-results"]': [new FakeElement('ul')] }, {}];
    for (const select of pages) {
      const dom = installDom({ select });
      try {
        assert.doesNotThrow(initSearch);
      } finally {
        dom.restore();
      }
    }
  });
});

describe('copy buttons', async () => {
  const { FakeButton, FakeElement, installDom } = await import('./fake-dom.mjs');
  const { initCopy } = await import('../src/client/copy.mjs');

  /**
   * A tool panel with one copy button, and a clipboard that records what it is given.
   * @param {{ text: string, clipboardFails?: boolean }} options
   */
  function panel({ text, clipboardFails = false }) {
    const button = new FakeButton({ js: 'copy', copyFrom: 'out', status: 'out-status', done: 'Copied', failed: 'Copy it yourself' });
    const source = Object.assign(new FakeElement('p'), { textContent: text });
    const status = new FakeElement('p');
    const root = new FakeElement('section');
    root.select = { '[data-js="copy"]': [button], '[data-js="out"]': [source], '[data-js="out-status"]': [status] };
    /** @type {string[]} */
    const written = [];
    const clipboard = {
      writeText: async (/** @type {string} */ value) => {
        if (clipboardFails) throw new Error('NotAllowedError');
        written.push(value);
      },
    };
    return { button, status, root, written, clipboard };
  }

  /**
   * Clicks the button with a fake clipboard and console in place, then lets the async handler finish.
   * @param {ReturnType<typeof panel>} p
   */
  async function click(p) {
    const dom = installDom();
    const navigatorBefore = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
    const warn = console.warn;
    Object.defineProperty(globalThis, 'navigator', { value: { clipboard: p.clipboard }, configurable: true });
    console.warn = () => {};
    try {
      initCopy(/** @type {any} */ (p.root));
      p.button.click();
      await new Promise((resolve) => setImmediate(resolve));
    } finally {
      console.warn = warn;
      if (navigatorBefore) Object.defineProperty(globalThis, 'navigator', navigatorBefore);
      dom.restore();
    }
  }

  it('copies the text of the element it names and says so', async () => {
    const p = panel({ text: 'Ls$Ns0Bn#7' });
    await click(p);
    assert.deepEqual(p.written, ['Ls$Ns0Bn#7']);
    assert.equal(p.status.textContent, 'Copied');
  });

  it('asks the visitor to copy by hand when the clipboard refuses', async () => {
    const p = panel({ text: 'Ls$Ns0Bn#7', clipboardFails: true });
    await click(p);
    assert.deepEqual(p.written, []);
    assert.equal(p.status.textContent, 'Copy it yourself');
  });

  it('does nothing while there is no result to copy', async () => {
    const p = panel({ text: '' });
    await click(p);
    assert.deepEqual(p.written, []);
    assert.equal(p.status.textContent, '', 'no "Copied" for an empty result');
  });
});

describe('tool loader', async () => {
  const { FakeElement, installDom } = await import('./fake-dom.mjs');
  const { initTools } = await import('../src/client/tools.mjs');

  it('a tool that fails to start is replaced by the "needs JavaScript" notice', async () => {
    // A panel without any of the tool's controls: its init() throws.
    const root = Object.assign(new FakeElement('section', { js: 'tool', tool: 'links' }), { hidden: false });
    const fallback = new FakeElement('p', { js: 'tool-fallback' });
    const dom = installDom({ select: { '[data-js="tool"]': [root], '[data-js="tool-fallback"]': [fallback] } });
    const error = console.error;
    /** @type {unknown[][]} */
    const logged = [];
    console.error = (...args) => logged.push(args);
    try {
      initTools();
      for (let i = 0; i < 50 && logged.length === 0; i += 1) await new Promise((resolve) => setTimeout(resolve, 10));
      assert.equal(root.hidden, true, 'controls that do nothing are not left on the page');
      assert.equal(fallback.classList.contains('is-visible'), true);
      assert.match(String(logged[0]?.[0]), /"links" tool failed to start/);
    } finally {
      console.error = error;
      dom.restore();
    }
  });

  it('ignores a page without a tool, or with a tool it does not know', () => {
    /** @type {Record<string, InstanceType<typeof FakeElement>[]>[]} */
    const pages = [{}, { '[data-js="tool"]': [new FakeElement('section', { js: 'tool', tool: 'nope' })] }];
    for (const select of pages) {
      const dom = installDom({ select });
      try {
        assert.doesNotThrow(initTools);
      } finally {
        dom.restore();
      }
    }
  });
});

describe('file chooser (UX-8)', async () => {
  const { FakeElement, installDom } = await import('./fake-dom.mjs');
  const { receiveFiles } = await import('../src/client/files.mjs');

  /** @param {{ paste?: boolean }} [options] */
  function setup(options) {
    const name = Object.assign(new FakeElement('span', { js: 'file-name', empty: 'No file chosen' }), { textContent: 'No file chosen' });
    const input = Object.assign(new FakeElement('input'), { files: /** @type {{ name: string }[]} */ ([]) });
    const root = new FakeElement('section');
    root.select = { '[data-js="file-name"]': [name], 'input[type="file"]': [input] };
    /** @type {{ name: string }[]} */
    const opened = [];
    const dom = installDom();
    const g = /** @type {Record<string, unknown>} */ (globalThis);
    const before = g.HTMLInputElement;
    g.HTMLInputElement = FakeElement;
    receiveFiles(/** @type {any} */ (root), (file) => opened.push(file), options);
    const restore = () => {
      g.HTMLInputElement = before;
      dom.restore();
    };
    return { name, input, root, opened, dom, restore };
  }

  it('shows the chosen file\'s name, and the "no file" text again when the choice is cleared', () => {
    const t = setup();
    try {
      t.input.files = [{ name: 'IMG_2041.jpg' }];
      t.input.dispatchEvent({ type: 'change' });
      assert.equal(t.name.textContent, 'IMG_2041.jpg');
      assert.deepEqual(t.opened, [], 'the tool opens a chosen file itself; it must not be opened twice');
      t.input.files = [];
      t.input.dispatchEvent({ type: 'change' });
      assert.equal(t.name.textContent, 'No file chosen');
    } finally {
      t.restore();
    }
  });

  it('opens a dropped file, shows its name and keeps the browser from navigating to it', () => {
    const t = setup();
    try {
      let prevented = 0;
      const event = (/** @type {string} */ type, /** @type {{ name: string }[]} */ files) => ({ type, preventDefault: () => (prevented += 1), dataTransfer: { files } });
      t.root.dispatchEvent(event('dragover', []));
      assert.equal(t.root.classList.contains('is-dropping'), true);
      t.root.dispatchEvent(event('drop', [{ name: 'report.docx' }]));
      assert.equal(prevented, 2);
      assert.equal(t.root.classList.contains('is-dropping'), false);
      assert.deepEqual(t.opened, [{ name: 'report.docx' }]);
      assert.equal(t.name.textContent, 'report.docx');
      t.root.dispatchEvent(event('drop', []));
      assert.equal(t.opened.length, 1, 'dropped text or a link is not a file');
    } finally {
      t.restore();
    }
  });

  it('takes a pasted file only where the tool asked for it, and leaves pasted text alone', () => {
    const off = setup();
    try {
      off.dom.document.dispatchEvent({ type: 'paste', preventDefault: () => {}, clipboardData: { files: [{ name: 'shot.png' }] } });
      assert.deepEqual(off.opened, []);
    } finally {
      off.restore();
    }
    const on = setup({ paste: true });
    try {
      let prevented = 0;
      on.dom.document.dispatchEvent({ type: 'paste', preventDefault: () => (prevented += 1), clipboardData: { files: [] } });
      assert.equal(prevented, 0, 'pasting text into a field still works');
      on.dom.document.dispatchEvent({ type: 'paste', preventDefault: () => (prevented += 1), clipboardData: { files: [{ name: 'shot.png' }] } });
      assert.equal(prevented, 1);
      assert.deepEqual(on.opened, [{ name: 'shot.png' }]);
      assert.equal(on.name.textContent, 'shot.png');
    } finally {
      on.restore();
    }
  });

  it('lets text win when a paste carries text and a picture (copied from Word, Excel or Outlook)', () => {
    const on = setup({ paste: true });
    try {
      let prevented = 0;
      const text = (/** @type {string} */ type) => (type === 'text/plain' ? 'Your parcel: gpost-ge.info/track' : '');
      on.dom.document.dispatchEvent({ type: 'paste', preventDefault: () => (prevented += 1), clipboardData: { files: [{ name: 'image.png' }], types: ['text/plain', 'Files'], getData: text } });
      assert.equal(prevented, 0, 'the text reaches the box');
      assert.deepEqual(on.opened, []);
      const html = (/** @type {string} */ type) => (type === 'text/html' ? '<p>Hi</p>' : '');
      on.dom.document.dispatchEvent({ type: 'paste', preventDefault: () => (prevented += 1), clipboardData: { files: [{ name: 'image.png' }], types: ['text/html', 'Files'], getData: html } });
      assert.deepEqual(on.opened, []);
      // "Copy image" in a browser adds HTML that is only the picture's tag: the picture is what was copied.
      const picture = (/** @type {string} */ type) => (type === 'text/html' ? '<meta charset="utf-8"><img src="https://example.org/a.png">' : '');
      on.dom.document.dispatchEvent({ type: 'paste', preventDefault: () => (prevented += 1), clipboardData: { files: [{ name: 'image.png' }], types: ['text/html', 'Files'], getData: picture } });
      assert.deepEqual(on.opened, [{ name: 'image.png' }]);
    } finally {
      on.restore();
    }
  });
});

describe('values from files, links and the browser', () => {
  it('are put into sentences with a function replacement, so "$&" in a value is shown as written', async () => {
    const { readdir, readFile } = await import('node:fs/promises');
    const folder = new URL('../src/client/', import.meta.url);
    for (const name of await readdir(folder)) {
      if (!name.endsWith('.mjs')) continue;
      const source = await readFile(new URL(name, folder), 'utf8');
      assert.doesNotMatch(source, /\.replace\(\s*['"`]\{/, `${name}: use fillText or fillInto`);
    }
  });
});

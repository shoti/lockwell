// @ts-check
/**
 * @file Tests for the photo editor page: its wiring, driven end to end with a small fake DOM.
 */
/**
 * Each element is made the first time the page looks for it. Canvases count
 * what is drawn on them, encoding takes a little time as in a browser, and
 * animation frames run only when a test lets them (`frames()`), so a test can
 * count how many draws a burst of events asks for.
 */
import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';

/** @param {number} ms */
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** @typedef {Record<string, unknown> & { type: string }} FakeEvent */

/** What the fake browser can do; tests change it before opening a page. */
const browser = {
  /** Formats toBlob can't write: it hands back a PNG instead, as browsers do. @type {Set<string>} */
  cannotEncode: new Set(),
  /** The page reads back the pixels it drew (false: as Tor Browser does until allowed). */
  readBack: true,
  /** A size the encoded copy decodes to instead of its own, to play a broken encoder. @type {{ width: number, height: number } | null} */
  decodeAs: null,
  /** How many times the page encoded a picture. */
  encodes: 0,
};

class Element {
  /** @param {string} [tag] */
  constructor(tag = 'div') {
    this.tag = tag;
    this.hidden = false;
    /** @type {Record<string, string>} */
    this.dataset = {};
    this.textContent = '';
    this.value = '';
    this.checked = false;
    this.disabled = false;
    this.width = 0;
    this.height = 0;
    /** Pictures drawn onto this canvas. */
    this.draws = 0;
    this.focused = 0;
    /** @type {File[]} */
    this.files = [];
    this.scrollLeft = 0;
    this.scrollTop = 0;
    this.clientWidth = 100;
    this.clientHeight = 100;
    this.scrollWidth = 100;
    this.scrollHeight = 100;
    /** @type {Record<string, string>} */
    this.attributes = {};
    /** @type {Map<string, Element | Element[]>} */
    this.children = new Map();
    /** @type {Record<string, ((event: FakeEvent) => unknown)[]>} */
    this.listeners = {};
    this.classList = { add() {}, remove() {}, toggle() {} };
  }

  /** @param {string} type @param {(event: FakeEvent) => unknown} listener */
  addEventListener(type, listener) {
    (this.listeners[type] ??= []).push(listener);
  }

  /** @param {string} type @param {Record<string, unknown>} [init] */
  async fire(type, init = {}) {
    await Promise.all((this.listeners[type] ?? []).map((listener) => listener({ type, preventDefault() {}, currentTarget: this, ...init })));
  }

  /** @param {string} selector */
  querySelector(selector) {
    if (!this.children.has(selector)) this.children.set(selector, new Element());
    return /** @type {Element} */ (this.children.get(selector));
  }

  /** @param {string} selector */
  querySelectorAll(selector) {
    const lists = {
      '[data-js="editor-tool"]': () => ['crop', 'resize'].map((tool) => Object.assign(new Element('button'), { dataset: { tool } })),
      '[data-js="editor-panel"]': () => ['crop', 'resize'].map((tool) => Object.assign(new Element(), { dataset: { tool } })),
      '[data-js="editor-format"]': () => ['image/jpeg', 'image/png', 'image/webp'].map((value) => Object.assign(new Element('input'), { value })),
      '[data-js="editor-long"]': () => ['1080', '1600'].map((size) => Object.assign(new Element('button'), { dataset: { size } })),
    };
    if (!this.children.has(`all ${selector}`)) this.children.set(`all ${selector}`, lists[/** @type {keyof typeof lists} */ (selector)]?.() ?? []);
    return /** @type {Element[]} */ (this.children.get(`all ${selector}`));
  }

  /** @param {string} name @param {string} value */
  setAttribute(name, value) {
    this.attributes[name] = value;
  }
  /** @param {string} name */
  removeAttribute(name) {
    delete this.attributes[name];
  }
  /** @param {string} name */
  getAttribute(name) {
    return this.attributes[name] ?? null;
  }
  focus() {
    this.focused += 1;
    activeElement = this;
  }
  setPointerCapture() {}
  scrollBy() {}
  getBoundingClientRect() {
    return { left: 0, top: 0, width: 800, height: 600 };
  }
  getContext() {
    const canvas = this;
    return {
      /** @param {number} _x @param {number} _y @param {number} width @param {number} height */
      getImageData: (_x, _y, width, height) => {
        const data = new Uint8ClampedArray(width * height * 4);
        // The probe of canReadBack: a black pixel, then a red one.
        if (browser.readBack && width === 2 && height === 1) data.set([0, 0, 0, 255, 255, 0, 0, 255]);
        return { data };
      },
      drawImage: () => {
        canvas.draws += 1;
      },
      setTransform() {},
      clearRect() {},
      fillRect() {},
      strokeRect() {},
      beginPath() {},
      moveTo() {},
      lineTo() {},
      stroke() {},
    };
  }
  /** @param {(blob: Blob) => void} done @param {string} type */
  toBlob(done, type) {
    browser.encodes += 1;
    const written = browser.cannotEncode.has(type) ? 'image/png' : type;
    const blob = new Blob(['x'.repeat(2048)], { type: written });
    const size = browser.decodeAs ?? { width: this.width, height: this.height };
    setTimeout(() => done(Object.assign(blob, { decodedSize: size })), 20);
  }
}

/** @type {Element | null} */
let activeElement = null;
/** Animation frames asked for and not yet run. @type {(() => void)[]} */
const queued = [];
/** Runs the animation frames asked for so far. */
const frames = () => {
  for (const callback of queued.splice(0)) callback();
};

const g = /** @type {Record<string, unknown>} */ (/** @type {unknown} */ (globalThis));
Object.assign(g, {
  HTMLElement: Element,
  HTMLInputElement: Element,
  document: {
    createElement: () => new Element('canvas'),
    addEventListener() {},
    documentElement: { lang: 'en' },
    get activeElement() {
      return activeElement;
    },
  },
  getComputedStyle: () => ({ getPropertyValue: () => '' }),
  requestAnimationFrame: (/** @type {() => void} */ callback) => queued.push(callback),
  createImageBitmap: async (/** @type {Blob & { decodedSize?: { width: number, height: number } }} */ blob) => ({ ...(blob.decodedSize ?? { width: 4000, height: 3000 }), close() {} }),
});

const { init } = await import('../src/client/tool-editor.mjs');

/** A fresh page with a picture open. */
async function page() {
  const root = new Element();
  /** @param {string} name */
  const q = (name) => root.querySelector(`[data-js="editor-${name}"]`);
  // What the page's HTML holds before the code starts.
  q('status').dataset.template = '{w} × {h}';
  q('lock').checked = true;
  q('quality').value = '92';
  q('aspect').value = 'free';
  for (const name of ['editor', 'replace', 'result']) q(name).hidden = true;
  Object.assign(q('message').dataset, { blocked: 'blocked', encodeFailed: 'encode failed', unsupported: 'unsupported' });
  Object.assign(q('format-note').dataset, { noWebp: 'no webp' });
  Object.assign(q('size-note').dataset, { enlarged: 'enlarged', limit: 'limit {w} × {h}' });
  Object.assign(q('result-info').dataset, { kb: '{n} KB', mb: '{n} MB' });
  init(/** @type {HTMLElement} */ (/** @type {unknown} */ (root)));
  const all = (/** @type {string} */ name) => root.querySelectorAll(`[data-js="editor-${name}"]`);
  const canvas = q('canvas');
  /** @param {number} id @param {number} x @param {number} y @param {string} [type] @param {Record<string, unknown>} [extra] */
  const pointer = (id, x, y, type = 'mouse', extra = {}) => ({ pointerId: id, isPrimary: true, button: 0, clientX: x, clientY: y, pointerType: type, ...extra });
  /** @param {string} name */
  const choose = async (name) => {
    q('file').files = [new File(['a'], name, { type: 'image/png' })];
    await q('file').fire('change');
    await sleep(10);
    frames();
  };
  /** Presses a button and lets the page redraw. @param {string} name */
  const press = async (name) => {
    await q(name).fire('click');
    frames();
  };
  await choose('shot.png');
  return { q, all, canvas, pointer, choose, press, saveBox: q('result').querySelector('[data-js="save"]') };
}

describe('photo editor page', () => {
  beforeEach(() => {
    Object.assign(browser, { cannotEncode: new Set(), readBack: true, decodeAs: null, encodes: 0 });
    queued.length = 0;
  });

  it('opens a picture and shows the copy’s size', async () => {
    const { q } = await page();
    assert.equal(q('editor').hidden, false);
    assert.equal(q('status').textContent, '4000 × 3000');
    assert.equal(q('undo').disabled, true);
    assert.equal(q('message').textContent, '');
  });

  it('turns, mirrors, undoes and redoes', async () => {
    const { q, press } = await page();
    await press('rotate-right');
    assert.equal(q('status').textContent, '3000 × 4000');
    assert.equal(q('undo').disabled, false);
    await press('flip-h');
    await press('undo');
    await press('undo');
    assert.equal(q('status').textContent, '4000 × 3000');
    assert.equal(q('undo').disabled, true);
    await press('redo');
    assert.equal(q('status').textContent, '3000 × 4000');
    await press('reset');
    assert.equal(q('status').textContent, '4000 × 3000', 'start again');
    await press('undo');
    assert.equal(q('status').textContent, '3000 × 4000', 'and starting again can be undone');
  });

  it('switches tools: one panel at a time, the pressed button marked', async () => {
    const { all, press, q } = await page();
    const [cropButton, resizeButton] = all('tool');
    const [cropPanel, resizePanel] = all('panel');
    await resizeButton.fire('click');
    frames();
    assert.equal(cropPanel.hidden, true);
    assert.equal(resizePanel.hidden, false);
    assert.equal(resizeButton.attributes['aria-pressed'], 'true');
    assert.equal(cropButton.attributes['aria-pressed'], 'false');
    await press('rotate-left'); // still works from the other tool's panel being hidden
    assert.equal(q('status').textContent, '3000 × 4000');
  });

  it('resizes by width with the proportions kept, by percent, by the longer side, and back', async () => {
    const { q, all, press } = await page();
    q('width').value = '2000';
    await q('width').fire('change');
    frames();
    assert.equal(q('status').textContent, '2000 × 1500');
    q('lock').checked = false;
    q('height').value = '1000';
    await q('height').fire('change');
    frames();
    assert.equal(q('status').textContent, '2000 × 1000', 'unlocked: only the height changes');
    q('percent').value = '50';
    await q('percent').fire('change');
    frames();
    assert.equal(q('status').textContent, '2000 × 1500');
    await all('long')[0].fire('click');
    frames();
    assert.equal(q('status').textContent, '1080 × 810');
    await press('original');
    assert.equal(q('status').textContent, '4000 × 3000');
    q('lock').checked = true;
    q('width').value = '4400';
    await q('width').fire('change');
    frames();
    assert.equal(q('status').textContent, '4400 × 3300');
    assert.equal(q('size-note').textContent, 'enlarged');
    q('width').value = '8000';
    await q('width').fire('change');
    frames();
    assert.equal(q('size-note').textContent, 'enlarged limit 4618 × 3464', 'beyond what a canvas holds: scaled down, and said so');
    assert.equal(q('status').textContent, '4618 × 3464');
  });

  it('crops by dragging a corner handle, and the copy follows', async () => {
    const { q, canvas, pointer } = await page();
    await canvas.fire('pointerdown', pointer(1, 800, 600));
    await canvas.fire('pointermove', pointer(1, 400, 300));
    await canvas.fire('pointerup', pointer(1, 400, 300));
    frames();
    assert.equal(q('status').textContent, '2000 × 1500');
    assert.equal(q('uncrop').disabled, false);
    await q('uncrop').fire('click');
    frames();
    assert.equal(q('status').textContent, '4000 × 3000');
  });

  it('keeps chosen proportions while dragging, and straightening shrinks the crop to fit', async () => {
    const { q, canvas, pointer } = await page();
    q('aspect').value = '1:1';
    await q('aspect').fire('change');
    frames();
    assert.equal(q('status').textContent, '3000 × 3000');
    await canvas.fire('pointerdown', pointer(1, 700, 600));
    await canvas.fire('pointermove', pointer(1, 500, 450));
    await canvas.fire('pointerup', pointer(1, 500, 450));
    frames();
    const [w, h] = q('status').textContent.split(' × ').map(Number);
    assert.equal(w, h, 'still square');
    q('angle-number').value = '10';
    await q('angle-number').fire('change');
    frames();
    const [w2, h2] = q('status').textContent.split(' × ').map(Number);
    assert.ok(w2 < w && Math.abs(w2 - h2) <= 1, `smaller and still square: ${q('status').textContent}`);
  });

  it('asks before a new picture throws an edit away', async () => {
    const { q, choose, press } = await page();
    await press('rotate-right');
    await choose('other.png');
    assert.equal(q('replace').hidden, false);
    assert.equal(activeElement, q('replace-no'));
    assert.equal(q('status').textContent, '3000 × 4000', 'the edit is still there');
    await q('replace-yes').fire('click');
    await sleep(10);
    frames();
    assert.equal(q('status').textContent, '4000 × 3000');
  });

  it('asks for one draw however many pointer moves arrive before the next frame', async () => {
    const { canvas, pointer } = await page();
    await canvas.fire('pointerdown', pointer(1, 400, 300));
    frames();
    assert.equal(queued.length, 0);
    for (let step = 0; step < 10; step += 1) await canvas.fire('pointermove', pointer(1, 400 + step, 300 + step));
    assert.equal(queued.length, 1);
    await canvas.fire('pointerup', pointer(1, 410, 310));
  });

  it('keeps a format the browser can’t write switched off, and says why', async () => {
    browser.cannotEncode.add('image/webp');
    const { q, all } = await page();
    await sleep(50);
    const webp = all('format').find((format) => format.value === 'image/webp');
    assert.equal(webp?.disabled, true);
    assert.equal(q('format-note').textContent, 'no webp');
  });

  it('offers no copy when the browser would hand back made-up pixels', async () => {
    browser.readBack = false;
    const { q } = await page();
    assert.match(q('message').textContent, /blocked/);
    assert.equal(q('create').disabled, true);
    await q('create').fire('click');
    await sleep(60);
    assert.equal(q('result').hidden, true);
    assert.equal(browser.encodes, 1, 'only the start-up WebP probe encoded anything');
  });

  it('offers the copy only after it opened again at the right size', async () => {
    const { q, saveBox, press } = await page();
    await press('rotate-right');
    await q('create').fire('click');
    await sleep(60);
    assert.equal(q('result').hidden, false);
    assert.equal(saveBox.hidden, false, 'offered for saving');
    assert.match(q('result-info').textContent, /^3000 × 4000 · PNG · 2 KB$/);
    browser.decodeAs = { width: 10, height: 10 };
    await press('rotate-left');
    assert.equal(q('result').hidden, true, 'an edit hides the old copy');
    await q('create').fire('click');
    await sleep(60);
    assert.equal(q('result').hidden, true);
    assert.equal(q('message').textContent, 'encode failed');
  });

  it('drops a copy whose edit changed while it was being made', async () => {
    const { q, press } = await page();
    const making = q('create').fire('click');
    await press('rotate-right');
    await making;
    await sleep(60);
    assert.equal(q('result').hidden, true);
  });
});

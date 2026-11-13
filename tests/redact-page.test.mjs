// @ts-check
/**
 * @file Tests for the image redaction page: its wiring, driven end to end with a small fake DOM.
 */
/**
 * Built from the probe that the review of 2026-11-13 used (review-redact-browser/harness.mjs):
 * each element is made the first time the page looks for it, canvases count
 * what is painted on them, and encoding takes a little time, as it does in a
 * browser.
 */
import assert from 'node:assert/strict';
import { before, describe, it } from 'node:test';

/** @param {number} ms */
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** @typedef {Record<string, unknown> & { type: string }} FakeEvent */

class Element {
  /** @param {string} [tag] */
  constructor(tag = 'div') {
    this.tag = tag;
    this.hidden = false;
    /** @type {Record<string, string>} */
    this.dataset = {};
    this.textContent = '';
    this.value = '4';
    this.checked = false;
    this.disabled = false;
    this.width = 0;
    this.height = 0;
    /** Fills since the picture was last drawn: one per box. */
    this.fills = 0;
    this.focused = 0;
    /** @type {File[]} */
    this.files = [];
    this.scrollLeft = 0;
    this.scrollTop = 0;
    this.clientWidth = 100;
    this.clientHeight = 100;
    this.scrollWidth = 100;
    this.scrollHeight = 100;
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
    if (!this.children.has(`all ${selector}`)) {
      this.children.set(`all ${selector}`, ['box', 'ellipse', 'marker', 'crop'].map((mode) => Object.assign(new Element('button'), { dataset: { mode } })));
    }
    return /** @type {Element[]} */ (this.children.get(`all ${selector}`));
  }

  setAttribute() {}
  removeAttribute() {}
  getAttribute() {
    return null;
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
      getImageData: (_x, _y, width, height) => ({ data: new Uint8ClampedArray(width * height * 4) }),
      fillRect: () => {
        canvas.fills += 1;
      },
      drawImage: () => {
        canvas.fills = 0;
      },
      strokeRect() {},
      setLineDash() {},
      beginPath() {},
      ellipse() {},
      arc() {},
      fill() {},
      stroke() {},
      moveTo() {},
      lineTo() {},
    };
  }
  /** @param {(blob: Blob) => void} done @param {string} type */
  toBlob(done, type) {
    encoded.push(this.fills);
    setTimeout(() => done(new Blob(['x'], { type })), 50);
  }
}

/** How many boxes each encoded copy held. @type {number[]} */
const encoded = [];
/** @type {Element | null} */
let activeElement = null;

const g = /** @type {Record<string, unknown>} */ (/** @type {unknown} */ (globalThis));
Object.assign(g, {
  HTMLElement: Element,
  HTMLInputElement: Element,
  document: { createElement: () => new Element('canvas'), addEventListener() {} },
  getComputedStyle: () => ({ getPropertyValue: () => '' }),
  createImageBitmap: async () => ({ width: 4000, height: 3000, close() {} }),
});

const { init } = await import('../src/client/tool-redact.mjs');

/** A fresh page with a picture open. */
async function page() {
  const root = new Element();
  init(/** @type {HTMLElement} */ (/** @type {unknown} */ (root)));
  /** @param {string} name */
  const q = (name) => root.querySelector(`[data-js="redact-${name}"]`);
  q('count').dataset.template = 'Covered areas: {n}.';
  const canvas = q('canvas');
  /** @param {number} id @param {number} x @param {number} y @param {string} [type] @param {Record<string, unknown>} [extra] */
  const pointer = (id, x, y, type = 'mouse', extra = {}) => ({ pointerId: id, isPrimary: true, button: 0, clientX: x, clientY: y, pointerType: type, ...extra });
  /** @param {number} x1 @param {number} y1 @param {number} x2 @param {number} y2 */
  const drag = async (x1, y1, x2, y2) => {
    await canvas.fire('pointerdown', pointer(1, x1, y1));
    await canvas.fire('pointermove', pointer(1, x2, y2));
    await canvas.fire('pointerup', pointer(1, x2, y2));
  };
  /** @param {string} name */
  const choose = async (name) => {
    q('file').files = [new File(['a'], name, { type: 'image/png' })];
    await q('file').fire('change');
    await sleep(10);
  };
  await choose('shot.png');
  return { q, canvas, pointer, drag, choose, saveBox: q('result').querySelector('[data-js="save"]') };
}

describe('image redaction page', () => {
  before(() => {
    encoded.length = 0;
  });

  it('shows a check whose picture and covering stayed the same', async () => {
    const { q, drag } = await page();
    await drag(100, 100, 300, 300);
    await q('check').fire('click');
    await sleep(100);
    assert.equal(q('result').hidden, false);
  });

  it('4.1 drops a check when the covering changed while the copy was made', async () => {
    const { q, drag } = await page();
    await drag(100, 100, 300, 300);
    const checking = q('check').fire('click');
    await drag(400, 100, 600, 300); // one more thing covered while the copy is encoded
    await checking;
    await sleep(100);
    assert.equal(q('count').textContent, 'Covered areas: 2.');
    assert.equal(encoded.at(-1), 1, 'the copy being checked held one box');
    assert.equal(q('result').hidden, true, 'that copy is not offered');
  });

  it('4.1 drops a check when another picture was opened meanwhile', async () => {
    const { q, drag, choose } = await page();
    await drag(100, 100, 300, 300);
    const checking = q('check').fire('click');
    await choose('other.png'); // asks first: covering is unsaved
    await q('replace-yes').fire('click');
    await sleep(10);
    await checking;
    await sleep(100);
    assert.equal(q('result').hidden, true);
  });

  it('4.3 keeps the zoom when one finger of a pinch lifts', async () => {
    const { q, canvas, pointer } = await page();
    await canvas.fire('pointerdown', pointer(11, 100, 100, 'touch'));
    await canvas.fire('pointerdown', pointer(12, 200, 100, 'touch', { isPrimary: false }));
    await canvas.fire('pointermove', pointer(12, 400, 100, 'touch', { isPrimary: false }));
    assert.equal(q('view').dataset.zoom, '3', 'spread three times as far');
    await canvas.fire('pointerup', pointer(12, 400, 100, 'touch', { isPrimary: false }));
    await canvas.fire('pointermove', pointer(11, 101, 100, 'touch'));
    assert.equal(q('view').dataset.zoom, '3');
    await canvas.fire('pointerup', pointer(11, 101, 100, 'touch'));
  });

  it('4.4 puts the focus on "Keep" when a new picture would throw work away, and Keep forgets the file', async () => {
    const { q, drag, choose } = await page();
    await drag(100, 100, 300, 300);
    await choose('other.png');
    assert.equal(q('replace').hidden, false);
    assert.equal(activeElement, q('replace-no'));
    assert.equal(q('replace-yes').focused, 0);
    await q('replace-no').fire('click');
    assert.equal(q('file').value, '', 'the same file can be chosen again');
  });

  it('a right-click whose release never arrives does not turn later touches into pans', async () => {
    const { q, canvas, pointer } = await page();
    await canvas.fire('pointerdown', pointer(1, 50, 50, 'mouse', { button: 2 }));
    await canvas.fire('pointerdown', pointer(21, 100, 400, 'touch'));
    await canvas.fire('pointermove', pointer(21, 300, 550, 'touch'));
    await canvas.fire('pointerup', pointer(21, 300, 550, 'touch'));
    assert.equal(q('count').textContent, 'Covered areas: 1.');
  });
});

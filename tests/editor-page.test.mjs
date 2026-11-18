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

/** The editor's tools, in the page's order. */
const TOOLS = ['crop', 'resize', 'adjust', 'filters', 'text', 'draw'];

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
  /** How many times the page read pixels back to work out colours (the read-back probe not counted). */
  reads: 0,
  /** Canvases the page made, in order: the first two are its photo layer and its colour layer. @type {Element[]} */
  made: [],
  /** Pixels in each read back to work out colours. @type {number[]} */
  readSizes: [],
  /** Each encode: the canvas encoded and the type asked for. @type {{ canvas: Element, type: string }[]} */
  encoded: [],
  /** Names of the decoded pictures the page closed. @type {string[]} */
  closed: [],
  /** Milliseconds an encode takes. */
  encodeDelay: 20,
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
    /** Pictures drawn onto this canvas, and the last one. */
    this.draws = 0;
    /** @type {unknown} */
    this.lastDrawn = null;
    /** Text and shapes drawn since the canvas was last cleared. @type {string[]} */
    this.ops = [];
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
      '[data-js="editor-tool"]': () => TOOLS.map((tool) => Object.assign(new Element('button'), { dataset: { tool } })),
      '[data-js="editor-panel"]': () => TOOLS.map((tool) => Object.assign(new Element(), { dataset: { tool } })),
      '[data-js="editor-format"]': () => ['image/jpeg', 'image/png', 'image/webp'].map((value) => Object.assign(new Element('input'), { value })),
      '[data-js="editor-long"]': () => ['1080', '1600'].map((size) => Object.assign(new Element('button'), { dataset: { size } })),
      '[data-js="editor-adjust"]': () => ['contrast', 'vignette'].map((key) => Object.assign(new Element('input'), { dataset: { key }, value: '0' })),
      '[data-js="editor-adjust-number"]': () => ['contrast', 'vignette'].map((key) => Object.assign(new Element('input'), { dataset: { key }, value: '0' })),
      '[data-js="editor-adjust-reset"]': () => ['contrast', 'vignette'].map((key) => Object.assign(new Element('button'), { dataset: { key } })),
      '[data-js="editor-preset"]': () => ['none', 'mono'].map((preset) => Object.assign(new Element('button'), { dataset: { preset } })),
      '[data-js="editor-shape"]': () => ['pen', 'rect', 'arrow'].map((shape) => Object.assign(new Element('button'), { dataset: { shape } })),
      '[data-js="editor-swatch"]': () => [Object.assign(new Element('button'), { dataset: { for: 'stroke', color: '#1e88e5' } })],
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
  select() {}
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
        if (!(width === 2 && height === 1)) {
          browser.reads += 1;
          browser.readSizes.push(width * height);
        }
        // The probe of canReadBack: a black pixel, then a red one.
        if (browser.readBack && width === 2 && height === 1) data.set([0, 0, 0, 255, 255, 0, 0, 255]);
        return { data };
      },
      /** @param {Element} source */
      drawImage: (source) => {
        canvas.draws += 1;
        canvas.lastDrawn = source;
      },
      putImageData() {},
      createRadialGradient: () => ({ addColorStop() {} }),
      save() {},
      restore() {},
      translate() {},
      rotate() {},
      closePath() {},
      fill() {},
      arc() {},
      ellipse: () => canvas.ops.push('ellipse'),
      rect: () => canvas.ops.push('rect'),
      /** @param {string} text */
      fillText: (text) => canvas.ops.push(`text:${text}`),
      strokeText() {},
      /** @param {string} text */
      measureText: (text) => ({ width: text.length * 10 }),
      setTransform() {},
      clearRect: () => {
        canvas.ops = [];
      },
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
    browser.encoded.push({ canvas: this, type });
    const written = browser.cannotEncode.has(type) ? 'image/png' : type;
    const blob = new Blob(['x'.repeat(2048)], { type: written });
    const size = browser.decodeAs ?? { width: this.width, height: this.height };
    setTimeout(() => done(Object.assign(blob, { decodedSize: size })), browser.encodeDelay);
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
  ImageData: class {
    /** @param {Uint8ClampedArray} data @param {number} width @param {number} height */
    constructor(data, width, height) {
      Object.assign(this, { data, width, height });
    }
  },
  document: {
    createElement: () => {
      const made = new Element('canvas');
      browser.made.push(made);
      return made;
    },
    addEventListener() {},
    documentElement: { lang: 'en' },
    get activeElement() {
      return activeElement;
    },
  },
  getComputedStyle: () => ({ getPropertyValue: () => '' }),
  requestAnimationFrame: (/** @type {() => void} */ callback) => queued.push(callback),
  /** A file can say what it decodes to, how long that takes, and that it fails. */
  createImageBitmap: async (/** @type {Blob & { name?: string, decodedSize?: { width: number, height: number }, decodeDelay?: number, broken?: boolean }} */ blob) => {
    if (blob.decodeDelay) await sleep(blob.decodeDelay);
    if (blob.broken) throw new Error('not a picture');
    const name = blob.name ?? 'copy';
    return { ...(blob.decodedSize ?? { width: 4000, height: 3000 }), name, close: () => browser.closed.push(name) };
  },
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
  Object.assign(q('selected').dataset, { none: 'none', text: 'text', drawing: 'drawing' });
  q('text').dataset.newText = 'Text';
  for (const [name, value] of [['text-size', '60'], ['text-opacity', '100'], ['stroke-width', '6'], ['stroke-opacity', '100'], ['font', 'site'], ['align', 'center'], ['text-color', '#ffffff'], ['stroke', '#e53935']]) q(name).value = value;
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
    Object.assign(browser, { cannotEncode: new Set(), readBack: true, decodeAs: null, encodes: 0, reads: 0, made: [], readSizes: [], encoded: [], closed: [], encodeDelay: 20 });
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

  it('works out colours once per slider step, on a small copy, and makes one step when let go', async () => {
    const { q, all, press } = await page();
    const [contrast] = all('adjust');
    const [, colours] = browser.made;
    browser.reads = 0;
    contrast.value = '40';
    await contrast.fire('input');
    frames();
    assert.equal(browser.reads, 1, 'one slider step: one read');
    assert.ok(colours.width * colours.height <= 500_000, `a small copy while dragging: ${colours.width} × ${colours.height}`);
    assert.equal(q('undo').disabled, true, 'dragging is not a step yet');
    await contrast.fire('change');
    frames();
    assert.equal(colours.width, browser.made[0].width, 'full size once let go');
    assert.equal(q('undo').disabled, false);
    assert.equal(q('compare').disabled, false);
    await press('undo');
    assert.equal(q('compare').disabled, true, 'nothing to compare with');
  });

  it('works out colours zero times while the crop frame moves', async () => {
    const { all, canvas, pointer } = await page();
    const [contrast] = all('adjust');
    contrast.value = '40';
    await contrast.fire('change');
    frames();
    browser.reads = 0;
    await canvas.fire('pointerdown', pointer(1, 400, 300));
    for (let step = 0; step < 5; step += 1) {
      await canvas.fire('pointermove', pointer(1, 400 - step * 10, 300));
      frames();
    }
    await canvas.fire('pointerup', pointer(1, 360, 300));
    frames();
    assert.equal(browser.reads, 0);
  });

  it('shows the picture without colours while "Hold to see the original" is pressed', async () => {
    const { q, all, canvas } = await page();
    const [photo, colours] = browser.made;
    const [contrast] = all('adjust');
    contrast.value = '40';
    await contrast.fire('change');
    frames();
    assert.equal(canvas.lastDrawn, colours);
    await q('compare').fire('pointerdown');
    frames();
    assert.equal(canvas.lastDrawn, photo);
    await q('compare').fire('pointerup');
    frames();
    assert.equal(canvas.lastDrawn, colours);
    await q('compare').fire('keydown', { key: ' ' });
    frames();
    assert.equal(canvas.lastDrawn, photo, 'Space works too');
    await q('compare').fire('keyup', { key: ' ' });
  });

  it('chooses a filter, marks it, and can reset one slider or all of them', async () => {
    const { q, all, press } = await page();
    const [none, mono] = all('preset');
    await mono.fire('click');
    frames();
    assert.equal(mono.attributes['aria-pressed'], 'true');
    assert.equal(none.attributes['aria-pressed'], 'false');
    const [contrast] = all('adjust');
    const [contrastAmount] = all('adjust-number');
    contrastAmount.value = '250';
    await contrastAmount.fire('change');
    frames();
    assert.equal(contrast.value, '100', 'kept within the slider’s range');
    const [contrastReset] = all('adjust-reset');
    assert.equal(contrastReset.disabled, false);
    await contrastReset.fire('click');
    frames();
    assert.equal(contrast.value, '0');
    contrast.value = '30';
    await contrast.fire('change');
    await press('reset-all');
    assert.equal(contrast.value, '0');
    assert.equal(mono.attributes['aria-pressed'], 'true', 'reset all leaves the filter');
  });

  it('saves a copy with colours through the banded drawing', async () => {
    const { q, all } = await page();
    const [, vignette] = all('adjust');
    vignette.value = '50';
    await vignette.fire('change');
    const [contrast] = all('adjust');
    contrast.value = '20';
    await contrast.fire('change');
    frames();
    browser.reads = 0;
    await q('create').fire('click');
    await sleep(200);
    assert.equal(q('result').hidden, false);
    assert.ok(browser.reads >= 12, `the 4000 × 3000 copy was read in bands of about a megapixel: ${browser.reads}`);
  });

  /** Chooses a tool by its button. @param {ReturnType<typeof page> extends Promise<infer P> ? P : never} p @param {string} name */
  const chooseTool = async (p, name) => {
    const button = p.all('tool').find((other) => other.dataset.tool === name);
    await button?.fire('click');
    frames();
  };
  /** @param {string} key @param {Record<string, unknown>} [extra] */
  const keyEvent = (key, extra = {}) => ({ key, code: key, shiftKey: false, ctrlKey: false, metaKey: false, altKey: false, ...extra });

  it('adds text, types into it, moves and deletes it, and reads no pixels doing so', async () => {
    const p = await page();
    const { q, canvas, press } = p;
    const [contrast] = p.all('adjust');
    contrast.value = '30';
    await contrast.fire('change');
    frames();
    await chooseTool(p, 'text');
    assert.equal(q('object').hidden, false, 'the object controls show for the Text tool');
    assert.equal(q('layer-left').disabled, true, 'off until something is selected');
    browser.reads = 0;
    await press('add-text');
    assert.equal(q('selected').textContent, 'text');
    assert.ok(canvas.ops.includes('text:Text'), canvas.ops.join());
    q('text').value = 'Hi\nthere';
    await q('text').fire('input');
    frames();
    assert.ok(canvas.ops.includes('text:Hi') && canvas.ops.includes('text:there'), 'one line each');
    await canvas.fire('keydown', keyEvent('ArrowRight'));
    await canvas.fire('keydown', keyEvent('ArrowUp', { shiftKey: true }));
    frames();
    assert.equal(q('selected').textContent, 'text', 'still selected after moving and resizing');
    await canvas.fire('keydown', keyEvent('Delete'));
    frames();
    assert.equal(q('selected').textContent, 'none');
    assert.ok(!canvas.ops.includes('text:Hi'));
    await press('undo');
    assert.ok(canvas.ops.includes('text:Hi'), 'undo brings it back');
    assert.equal(browser.reads, 0, 'adding, typing, moving and deleting text work out no colours');
    await chooseTool(p, 'crop');
    assert.equal(q('object').hidden, true);
  });

  it('draws a box by dragging, drops a slip, and selects what it drew', async () => {
    const p = await page();
    const { q, canvas, pointer } = p;
    await chooseTool(p, 'draw');
    await p.all('shape')[1].fire('click');
    await canvas.fire('pointerdown', pointer(1, 100, 100));
    await canvas.fire('pointermove', pointer(1, 300, 250));
    await canvas.fire('pointerup', pointer(1, 300, 250));
    frames();
    assert.equal(q('selected').textContent, 'drawing');
    assert.equal(canvas.ops.filter((op) => op === 'rect').length, 1);
    await canvas.fire('keydown', keyEvent('Escape'));
    frames();
    assert.equal(q('selected').textContent, 'none');
    await canvas.fire('pointerdown', pointer(2, 500, 500));
    await canvas.fire('pointermove', pointer(2, 503, 502));
    await canvas.fire('pointerup', pointer(2, 503, 502));
    frames();
    assert.equal(canvas.ops.filter((op) => op === 'rect').length, 1, 'a slip of a few pixels draws nothing');
    await canvas.fire('pointerdown', pointer(3, 200, 175));
    await canvas.fire('pointerup', pointer(3, 200, 175));
    frames();
    assert.equal(q('selected').textContent, 'drawing', 'a tap on it selects it');
    await p.all('swatch')[0].fire('click');
    frames();
    assert.equal(q('stroke').value, '#1e88e5');
    await canvas.fire('keydown', keyEvent('Enter'));
    frames();
    assert.equal(canvas.ops.filter((op) => op === 'rect').length, 2, 'Enter adds one in the middle');
    await p.press('duplicate');
    assert.equal(canvas.ops.filter((op) => op === 'rect').length, 3);
    await p.press('backward');
    await p.press('delete');
    assert.equal(canvas.ops.filter((op) => op === 'rect').length, 2);
  });

  it('turning the photo keeps what was drawn, and undo after a turn keeps the selection only if it still exists', async () => {
    const p = await page();
    const { q, canvas, press } = p;
    await chooseTool(p, 'text');
    await press('add-text');
    await press('rotate-right');
    assert.ok(canvas.ops.includes('text:Text'));
    assert.equal(q('status').textContent, '3000 × 4000');
    await press('undo');
    await press('undo');
    assert.equal(q('selected').textContent, 'none', 'the text it pointed to is gone');
  });

  /**
   * A file that decodes to a given size, after a delay, or not at all.
   * @param {string} name @param {{ width?: number, height?: number, delay?: number, broken?: boolean }} [how]
   */
  const picture = (name, { width = 4000, height = 3000, delay = 0, broken = false } = {}) =>
    Object.assign(new File(['a'], name, { type: 'image/png' }), { decodedSize: { width, height }, decodeDelay: delay, broken });

  /** Where the photo layer's last picture came from: the decoded file's name, through the smaller screen copy if any. */
  const drawnFrom = () => {
    /** @type {unknown} */
    let source = browser.made[0].lastDrawn;
    while (source instanceof Element) source = source.lastDrawn;
    return /** @type {{ name?: string } | null} */ (source)?.name;
  };

  it('opens the picture chosen last when two are chosen quickly, and closes the other', async () => {
    const { q } = await page();
    const file = q('file');
    file.files = [picture('big.jpg', { width: 4898, height: 3265, delay: 40 })];
    const first = file.fire('change');
    file.files = [picture('small.png', { width: 800, height: 600 })];
    await file.fire('change');
    await first;
    await sleep(60); // the slow decode has finished too
    frames();
    assert.equal(q('status').textContent, '800 × 600', 'the size line is the last choice');
    assert.equal(drawnFrom(), 'small.png', 'and so is the picture on screen');
    assert.ok(browser.closed.includes('big.jpg'), 'the earlier picture is closed');

    file.files = [picture('slow.png', { width: 800, height: 600, delay: 40 })];
    const slow = file.fire('change');
    file.files = [picture('fast.jpg', { width: 4898, height: 3265 })];
    await file.fire('change');
    await slow;
    await sleep(60);
    frames();
    assert.equal(q('status').textContent, '4898 × 3265', 'a slow earlier choice does not replace a later one');
    assert.equal(drawnFrom(), 'fast.jpg');
  });

  it('keeps the open picture when the next file can’t be opened', async () => {
    const { q } = await page();
    q('file').files = [picture('photo.heic', { broken: true })];
    await q('file').fire('change');
    await sleep(10);
    frames();
    assert.equal(q('message').textContent, 'unsupported');
    assert.equal(q('editor').hidden, false, 'the editor still shows the picture');
    assert.equal(q('status').textContent, '4000 × 3000');
    assert.deepEqual(browser.closed, [], 'nothing was closed');
  });

  it('works out colours again at the new size after zooming in', async () => {
    const { q, all, press } = await page();
    const [contrast] = all('adjust');
    contrast.value = '40';
    await contrast.fire('change');
    frames();
    const [photo, colours] = browser.made;
    await press('zoom-in');
    frames();
    assert.equal(colours.width, photo.width, `colour layer ${colours.width} wide, photo layer ${photo.width}`);
    assert.equal(colours.height, photo.height);
  });

  it('straightens on a small copy while the slider is dragged, with colours on', async () => {
    const { q, all } = await page();
    const [contrast] = all('adjust');
    contrast.value = '40';
    await contrast.fire('change');
    frames();
    browser.readSizes = [];
    for (const angle of ['2', '4', '6']) {
      q('angle').value = angle;
      await q('angle').fire('input');
      frames();
    }
    assert.ok(browser.readSizes.length > 0 && browser.readSizes.every((pixels) => pixels <= 500_000), `reads while dragging: ${browser.readSizes.join(', ')}`);
    await q('angle').fire('change');
    frames();
    assert.equal(browser.made[1].width, browser.made[0].width, 'full size once let go');
  });

  it('encodes the copy drawn for the format asked for, when quality changes while the format changes', async () => {
    const { q, all } = await page();
    await q('create').fire('click');
    await sleep(60);
    const pngCanvas = browser.encoded.at(-1)?.canvas;
    // The JPEG copy takes longer than the wait before a quality change re-encodes, as a large picture does.
    browser.encodeDelay = 600;
    const [jpeg] = all('format');
    for (const format of all('format')) format.checked = format === jpeg;
    const switching = jpeg.fire('change');
    await sleep(20);
    q('quality').value = '50';
    await q('quality').fire('input');
    browser.encodeDelay = 20;
    await switching;
    await sleep(1000);
    const last = browser.encoded.at(-1);
    assert.equal(last?.type, 'image/jpeg');
    assert.notEqual(last?.canvas, pngCanvas, 'a JPEG is not encoded from the canvas drawn for PNG (no white under transparency)');
    assert.match(q('result-info').textContent, /JPEG/);
  });

  it('makes the copy in the format chosen while the first copy was being made', async () => {
    const { q, all } = await page();
    const create = q('create').fire('click');
    const [jpeg] = all('format');
    for (const format of all('format')) format.checked = format === jpeg;
    await jpeg.fire('change');
    await create;
    await sleep(120);
    assert.equal(q('result').hidden, false);
    assert.match(q('result-info').textContent, /JPEG/, q('result-info').textContent);
  });

  it('zooms with + and − in the Text and Draw tools too', async () => {
    const p = await page();
    await chooseTool(p, 'text');
    await p.canvas.fire('keydown', { key: '+', code: 'Equal' });
    frames();
    assert.equal(p.q('zoom-value').textContent, '150%');
    await p.canvas.fire('keydown', { key: '-', code: 'Minus' });
    frames();
    assert.equal(p.q('zoom-value').textContent, '100%');
  });

  it('keeps the copy when Ctrl+Z has nothing to undo', async () => {
    const { q, canvas } = await page();
    await q('create').fire('click');
    await sleep(60);
    assert.equal(q('result').hidden, false);
    await canvas.fire('keydown', { key: 'z', code: 'KeyZ', ctrlKey: true });
    frames();
    assert.equal(q('result').hidden, false);
  });

  it('writes the live lines only when they change, and the size once a drag ends', async () => {
    const { q, canvas, pointer } = await page();
    /** Counts writes to an element's text. @param {Element} element */
    const count = (element) => {
      let text = element.textContent;
      const writes = { n: 0 };
      Object.defineProperty(element, 'textContent', {
        get: () => text,
        set: (value) => {
          writes.n += 1;
          text = value;
        },
      });
      return writes;
    };
    const [status, selected, sizeNote] = [count(q('status')), count(q('selected')), count(q('size-note'))];
    await canvas.fire('pointerdown', pointer(1, 790, 590));
    for (let step = 1; step <= 5; step += 1) {
      await canvas.fire('pointermove', pointer(1, 790 - step * 20, 590 - step * 20));
      frames();
    }
    assert.equal(status.n, 0, 'the size line waits for the drag to end');
    assert.equal(selected.n, 0);
    assert.equal(sizeNote.n, 0);
    await canvas.fire('pointerup', pointer(1, 690, 490));
    frames();
    assert.equal(status.n, 1);
    assert.notEqual(q('status').textContent, '4000 × 3000');
  });
});

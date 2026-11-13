// @ts-check
/**
 * @file A deliberately tiny fake DOM for testing client modules.
 */
/**
 * A deliberately tiny fake DOM for testing client wiring without a browser
 * dependency. It implements only what src/client uses; extend it as needed.
 */

/** @typedef {{ type: string, [key: string]: unknown }} FakeEvent */

export class FakeEventTarget {
  constructor() {
    /** @type {Map<string, ((event: FakeEvent) => void)[]>} */
    this.listeners = new Map();
  }

  /** @param {string} type @param {(event: FakeEvent) => void} fn */
  addEventListener(type, fn) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), fn]);
  }

  /** @param {FakeEvent} event */
  dispatchEvent(event) {
    for (const fn of this.listeners.get(event.type) ?? []) fn(event);
    return true;
  }
}

export class FakeElement extends FakeEventTarget {
  /** @param {string} tag @param {Record<string, string>} [dataset] */
  constructor(tag, dataset = {}) {
    super();
    this.tagName = tag.toUpperCase();
    /** @type {Record<string, string>} */
    this.dataset = { ...dataset };
    /** @type {Record<string, string>} */
    this.attributes = {};
    this.textContent = '';
    this.disabled = false;
    this.checked = false;
    this.value = '';
    /** @type {Record<string, FakeElement[]>} what querySelector/querySelectorAll return inside this element */
    this.select = {};
    this.className = '';
    /** @type {FakeElement[]} */
    this.children = [];
    const classes = new Set();
    this.classList = {
      /** @param {string} c @param {boolean} [force] */
      toggle: (c, force) => ((force ?? !classes.has(c)) ? classes.add(c) : classes.delete(c), classes.has(c)),
      /** @param {string} c */
      contains: (c) => classes.has(c),
      /** @param {string} c */
      add: (c) => classes.add(c),
      /** @param {string} c */
      remove: (c) => classes.delete(c),
    };
  }

  /** @param {string} name @param {string} value */
  setAttribute(name, value) {
    this.attributes[name] = String(value);
  }

  /** @param {string} name */
  getAttribute(name) {
    return this.attributes[name] ?? null;
  }

  /** @param {string} name */
  removeAttribute(name) {
    delete this.attributes[name];
  }

  click() {
    this.dispatchEvent({ type: 'click' });
  }

  /** @param {string} s */
  querySelector(s) {
    return this.select[s]?.[0] ?? null;
  }

  /** @param {string} s */
  querySelectorAll(s) {
    return this.select[s] ?? [];
  }

  focus() {}

  /** Records what was appended, in order (re-appending moves an element to the end, as in a real DOM). @param {FakeElement} child */
  append(child) {
    this.children = [...this.children.filter((c) => c !== child), child];
  }
}

export class FakeButton extends FakeElement {
  constructor(/** @type {Record<string, string>} */ dataset = {}) {
    super('button', dataset);
  }
}

/** A Storage-like object backed by a Map. Set `broken` to make every call throw. */
export class FakeStorage {
  constructor() {
    /** @type {Map<string, string>} */
    this.map = new Map();
    this.failReads = false;
    this.failWrites = false;
  }

  get length() {
    return this.map.size;
  }

  /** @param {number} i */
  key(i) {
    return [...this.map.keys()][i] ?? null;
  }

  /** @param {string} k */
  getItem(k) {
    if (this.failReads) throw new Error('SecurityError');
    return this.map.get(k) ?? null;
  }

  /** @param {string} k @param {string} v */
  setItem(k, v) {
    if (this.failWrites) throw new Error('QuotaExceededError');
    this.map.set(k, String(v));
  }

  /** @param {string} k */
  removeItem(k) {
    if (this.failWrites) throw new Error('QuotaExceededError');
    this.map.delete(k);
  }
}

/**
 * Installs fake `window`, `document` and element classes on globalThis.
 * `select` maps a selector to what querySelector/querySelectorAll return.
 * @param {{ select?: Record<string, FakeElement[]>, matchMedia?: (query: string) => object }} [options]
 * @returns {{ window: FakeEventTarget, document: FakeEventTarget, root: FakeElement, local: FakeStorage, session: FakeStorage, restore: () => void }}
 */
export function installDom({ select = {}, matchMedia } = {}) {
  const g = /** @type {Record<string, unknown>} */ (globalThis);
  const saved = Object.fromEntries(['window', 'document', 'HTMLElement', 'HTMLButtonElement', 'CustomEvent'].map((k) => [k, g[k]]));
  const root = new FakeElement('html');
  const local = new FakeStorage();
  const session = new FakeStorage();
  const document = Object.assign(new FakeEventTarget(), {
    documentElement: root,
    /** @param {string} s */
    querySelector: (s) => select[s]?.[0] ?? null,
    /** @param {string} s */
    querySelectorAll: (s) => select[s] ?? [],
  });
  const window = Object.assign(new FakeEventTarget(), {
    localStorage: local,
    sessionStorage: session,
    matchMedia: matchMedia ?? (() => Object.assign(new FakeEventTarget(), { matches: false })),
    setTimeout: () => 0,
    clearTimeout: () => {},
  });
  Object.assign(g, {
    window,
    document,
    HTMLElement: FakeElement,
    HTMLButtonElement: FakeButton,
    CustomEvent: class {
      /** @param {string} type @param {{ detail?: unknown }} [init] */
      constructor(type, init = {}) {
        this.type = type;
        this.detail = init.detail;
      }
    },
  });
  return {
    window,
    document,
    root,
    local,
    session,
    restore: () => {
      for (const [k, v] of Object.entries(saved)) {
        if (v === undefined) delete g[k];
        else g[k] = v;
      }
    },
  };
}

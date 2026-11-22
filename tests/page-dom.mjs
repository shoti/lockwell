// @ts-check
/**
 * @file A small DOM built from a tool page's real HTML, for page tests: descendant selectors, attributes, templates,
 * form state and text. The page's own module is then driven through it, so every selector the client uses must exist
 * in the page it really gets.
 */
import { FakeEventTarget } from './fake-dom.mjs';

const ENTITIES = /** @type {Record<string, string>} */ ({ amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'", '#x27': "'" });
/** @param {string} text */
const decode = (text) => text.replace(/&(amp|lt|gt|quot|#39|#x27);/g, (_, name) => ENTITIES[name]);
const VOID = new Set(['input', 'br', 'img', 'meta', 'link', 'hr', 'path', 'rect', 'circle', 'line', 'polyline', 'polygon']);

/** An element of the page, with real descendant lookups and text. */
export class PageElement extends FakeEventTarget {
  /** The focused element (document.activeElement), or null for the page itself. @type {PageElement | null} */
  static active = null;

  /** @param {string} tag */
  constructor(tag) {
    super();
    this.tagName = tag.toUpperCase();
    /** @type {Record<string, string>} */
    this.dataset = {};
    /** @type {Record<string, string>} */
    this.attributes = {};
    this.hidden = false;
    this.disabled = false;
    this.checked = false;
    this.readOnly = false;
    this.value = '';
    /** An input's type, read from its attribute. */
    this.type = '';
    /** A link's download name. */
    this.download = '';
    /** @type {File[] | null} A file input's chosen files. */
    this.files = null;
    this.lang = '';
    this.translate = true;
    this.dir = '';
    this.dateTime = '';
    this.className = '';
    /** @type {{ width: number, height: number } | undefined} A canvas's size once set. */
    this.size = undefined;
    /** @type {PageElement | null} */
    this.parent = null;
    /** @type {(PageElement | string)[]} */
    this.nodes = [];
    this.ownText = '';
    const classes = new Set();
    this.classList = {
      add: (/** @type {string} */ c) => classes.add(c),
      remove: (/** @type {string} */ c) => classes.delete(c),
      contains: (/** @type {string} */ c) => classes.has(c),
      toggle: (/** @type {string} */ c, /** @type {boolean | undefined} */ force) => ((force ?? !classes.has(c)) ? classes.add(c) : classes.delete(c), classes.has(c)),
    };
  }

  click() {
    this.dispatchEvent({ type: 'click' });
  }

  /** Focus, as a browser keeps it: one element at a time, lost when that element is taken out of the page. */
  focus() {
    PageElement.active = this;
  }

  /** Selecting an input's text: nothing to track here. */
  select() {}

  /** @returns {PageElement | null} */
  get parentElement() {
    return this.parent;
  }

  /** The element itself or its nearest ancestor that matches. @param {string} selector @returns {PageElement | null} */
  closest(selector) {
    for (let at = /** @type {PageElement | null} */ (this); at; at = at.parent) if (at.matches(selector)) return at;
    return null;
  }

  /** A canvas's size: its attribute until set, as in a real DOM. */
  get width() {
    return this.size?.width ?? Number(this.getAttribute('width') ?? 0);
  }

  set width(value) {
    this.size = { width: Number(value), height: this.height };
  }

  get height() {
    return this.size?.height ?? Number(this.getAttribute('height') ?? 0);
  }

  set height(value) {
    this.size = { width: this.width, height: Number(value) };
  }

  /** No layout here: every element is a 100 × 140 box at the origin. */
  getBoundingClientRect() {
    return { top: 0, left: 0, right: 100, bottom: 140, width: 100, height: 140 };
  }

  setPointerCapture() {}

  /** A link's address is its attribute, as in a real DOM (removeAttribute clears it). */
  get href() {
    return this.getAttribute('href') ?? '';
  }

  set href(value) {
    this.setAttribute('href', String(value));
  }

  /** @returns {string} */
  get textContent() {
    return this.nodes.map((node) => (typeof node === 'string' ? node : node.textContent)).join('') || this.ownText;
  }

  set textContent(value) {
    this.nodes = [];
    this.ownText = String(value);
  }

  /** @returns {PageElement[]} */
  get children() {
    return /** @type {PageElement[]} */ (this.nodes.filter((node) => typeof node !== 'string'));
  }

  get content() {
    return { firstElementChild: this.children[0] };
  }

  /** @param {...(PageElement | string)} nodes */
  replaceChildren(...nodes) {
    const active = PageElement.active;
    if (active && this.children.some((child) => child === active || child.descendants().includes(active))) PageElement.active = null;
    this.ownText = '';
    this.nodes = nodes.map((node) => (typeof node === 'string' ? node : Object.assign(node, { parent: this })));
  }

  /** @param {...(PageElement | string)} nodes */
  append(...nodes) {
    this.nodes.push(...nodes.map((node) => (typeof node === 'string' ? node : Object.assign(node, { parent: this }))));
  }

  /** @param {PageElement | null} node */
  contains(node) {
    return node === this || this.descendants().includes(/** @type {PageElement} */ (node));
  }

  /** @returns {PageElement[]} */
  descendants() {
    return this.children.flatMap((child) => [child, ...child.descendants()]);
  }

  /** "tag[attr]" or "[attr="value"]…", one compound selector. @param {string} selector */
  matches(selector) {
    const tag = /^[a-z]+/.exec(selector)?.[0];
    if (tag && this.tagName.toLowerCase() !== tag) return false;
    for (const [, name, value] of selector.matchAll(/\[([\w-]+)(?:="([^"]*)")?\]/g)) {
      const actual = this.getAttribute(name);
      if (actual === null || (value !== undefined && actual !== value)) return false;
    }
    return true;
  }

  /** @param {string} selector */
  querySelectorAll(selector) {
    const parts = selector.trim().split(/\s+/);
    return this.descendants().filter((element) => {
      if (!element.matches(/** @type {string} */ (parts.at(-1)))) return false;
      let at = /** @type {PageElement | null} */ (element.parent);
      for (let i = parts.length - 2; i >= 0; i -= 1) {
        while (at && at !== this && !at.matches(parts[i])) at = at.parent;
        if (!at || at === this) return false;
        at = at.parent;
      }
      return true;
    });
  }

  /** @param {string} selector */
  querySelector(selector) {
    return this.querySelectorAll(selector)[0] ?? null;
  }

  /** @param {string} name @param {string} value */
  setAttribute(name, value) {
    this.attributes[name] = value;
    if (name.startsWith('data-')) this.dataset[name.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = value;
    if (name === 'hidden') this.hidden = true;
    if (name === 'disabled') this.disabled = true;
    if (name === 'checked') this.checked = true;
    if (name === 'readonly') this.readOnly = true;
    if (name === 'value') this.value = value;
    if (name === 'type') this.type = value;
  }

  /** @param {string} name */
  removeAttribute(name) {
    delete this.attributes[name];
    if (name.startsWith('data-')) delete this.dataset[name.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase())];
    if (name === 'hidden') this.hidden = false;
    if (name === 'disabled') this.disabled = false;
  }

  /** @param {string} name */
  getAttribute(name) {
    if (name === 'hidden') return this.hidden ? '' : null;
    if (name.startsWith('data-')) {
      const key = name.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
      if (key in this.dataset) return this.dataset[key];
    }
    return this.attributes[name] ?? null;
  }

  /** @returns {PageElement} */
  cloneNode() {
    const copy = new PageElement(this.tagName.toLowerCase());
    for (const [name, value] of Object.entries(this.attributes)) copy.setAttribute(name, value);
    copy.dataset = { ...this.dataset };
    copy.hidden = this.hidden;
    copy.disabled = this.disabled;
    copy.checked = this.checked;
    copy.ownText = this.ownText;
    copy.replaceChildren(...this.nodes.map((node) => (typeof node === 'string' ? node : node.cloneNode())));
    return copy;
  }
}

/**
 * Builds elements from the page's own HTML (the build's output, so well formed and quoted).
 * @param {string} html
 */
export function parse(html) {
  const root = new PageElement('div');
  /** @type {PageElement[]} */
  const stack = [root];
  for (const [token, close, tag, attributes] of html.matchAll(/<!--[\s\S]*?-->|<(\/?)([a-zA-Z][\w-]*)([^>]*)>|[^<]+/g)) {
    const parent = /** @type {PageElement} */ (stack.at(-1));
    if (token.startsWith('<!--')) continue;
    if (!tag) {
      parent.append(decode(token));
      continue;
    }
    if (close) {
      stack.pop();
      continue;
    }
    const element = new PageElement(tag.toLowerCase());
    for (const [, name, value] of attributes.matchAll(/([^\s=/]+)(?:="([^"]*)")?/g)) element.setAttribute(name, decode(value ?? ''));
    parent.append(element);
    if (!VOID.has(tag.toLowerCase()) && !attributes.trim().endsWith('/')) stack.push(element);
  }
  return root;
}

/**
 * The tool's section (data-js="tool") from a built page.
 * @param {string} page
 */
export function toolSection(page) {
  const section = /<section class="tool js-only" data-js="tool"[\s\S]*?<\/section>\s*(?=<section class="prose|<section class="tool-guides)/.exec(page)?.[0] ?? '';
  return /** @type {PageElement} */ (parse(section).children[0]);
}

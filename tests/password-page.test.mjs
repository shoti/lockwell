// @ts-check
/**
 * @file Tests for the password generator page: its wiring, driven with a small fake DOM.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

/** @param {number} ms */
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

class Element {
  constructor() {
    this.hidden = false;
    this.textContent = '';
    this.value = '16';
    this.checked = true;
    this.min = '';
    this.max = '';
    /** @type {Record<string, string>} */
    this.dataset = {};
    this.style = { setProperty() {} };
    /** @type {Record<string, ((event: { type: string }) => unknown)[]>} */
    this.listeners = {};
  }

  /** @param {string} type @param {(event: { type: string }) => unknown} listener */
  addEventListener(type, listener) {
    (this.listeners[type] ??= []).push(listener);
  }

  /** @param {string} type */
  fire(type) {
    for (const listener of this.listeners[type] ?? []) listener({ type });
  }

  setAttribute() {}
  getAttribute() {
    return null;
  }
  querySelector() {
    return null;
  }
}

/** The page: every data-js element made on first use; the three type radios. */
function page() {
  /** @type {Map<string, Element>} */
  const elements = new Map();
  const modes = ['password', 'passphrase', 'pin'].map((value) => Object.assign(new Element(), { value, checked: value === 'password' }));
  const root = {
    /** @param {string} selector */
    querySelector(selector) {
      if (selector.endsWith(':checked')) return null;
      const name = /data-js="([^"]+)"/.exec(selector)?.[1] ?? selector;
      if (!elements.has(name)) elements.set(name, new Element());
      return elements.get(name);
    },
    querySelectorAll: () => modes,
  };
  return { root, modes, find: (/** @type {string} */ name) => /** @type {Element} */ (root.querySelector(`[data-js="${name}"]`)) };
}

Object.assign(globalThis, { document: { documentElement: { lang: 'en' } } });
const { init } = await import('../src/client/tool-password.mjs');

describe('password generator page', () => {
  it('shows what the chosen type makes, even when the type changes while the word list loads', async () => {
    const { root, modes, find } = page();
    init(/** @type {HTMLElement} */ (/** @type {unknown} */ (root)));
    /** @param {number} index */
    const choose = (index) => {
      modes.forEach((mode, at) => (mode.checked = at === index));
      modes[index].fire('change');
    };
    choose(1); // passphrase: starts loading the word list
    choose(0); // back to password before it has loaded
    await sleep(50);
    const shown = find('password-output').textContent;
    assert.doesNotMatch(shown, /^[a-z]+(?:-[a-z]+){3,}/, `a passphrase shown under "Password": ${shown}`);
    assert.equal([...shown].length, 16);
  });
});

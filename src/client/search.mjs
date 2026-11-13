// @ts-check
/**
 * @file Filters the search page in memory as the visitor types; nothing leaves the browser.
 */

import { fillText } from './fill.mjs';

/**
 * Lowercases a query or text so they compare equal however they were typed.
 * @param {string} text
 */
export const normalize = (text) => text.normalize('NFC').toLowerCase().trim();

/**
 * Entries that contain every word of the query, best first: more query words
 * in the title rank higher, and ties keep the page's own order.
 * @param {{ title: string, text: string }[]} entries  Already lowercase.
 * @param {string} query
 * @returns {number[] | null}  Indexes into `entries`, or null for an empty query (show everything).
 */
export function matchEntries(entries, query) {
  const words = normalize(query).split(/\s+/).filter(Boolean);
  if (words.length === 0) return null;
  return entries
    .map((entry, index) => ({
      index,
      inTitle: words.filter((word) => entry.title.includes(word)).length,
      matches: words.every((word) => entry.title.includes(word) || entry.text.includes(word)),
    }))
    .filter((entry) => entry.matches)
    .sort((a, b) => b.inTitle - a.inTitle || a.index - b.index)
    .map((entry) => entry.index);
}

/**
 * Search page: narrows the list of everything on the site as the visitor
 * types. It all happens here in the page; the query is never put in the URL,
 * saved or sent anywhere.
 */
export function initSearch() {
  const input = document.querySelector('[data-js="search-input"]');
  const list = document.querySelector('[data-js="search-results"]');
  if (!(input instanceof HTMLElement) || !(list instanceof HTMLElement)) return;

  const field = /** @type {HTMLInputElement} */ (input);
  const items = /** @type {HTMLElement[]} */ ([...list.querySelectorAll('[data-js="search-entry"]')]);
  const entries = items.map((item) => ({ title: item.dataset.title ?? '', text: item.dataset.text ?? '' }));
  const status = document.querySelector('[data-js="search-status"]');
  const empty = document.querySelector('[data-js="search-empty"]');

  const update = () => {
    const found = matchEntries(entries, field.value);
    const order = found ?? items.map((_, index) => index);
    const shown = new Set(order);
    items.forEach((item, index) => {
      item.hidden = !shown.has(index);
    });
    // Appending an element that is already in the list moves it: best matches first.
    order.forEach((index) => list.append(items[index]));
    if (status instanceof HTMLElement) {
      status.textContent = found ? fillText(status.dataset.template, { n: String(found.length) }) : '';
    }
    if (empty instanceof HTMLElement) empty.hidden = order.length > 0;
  };

  field.addEventListener('input', update);
  // The browser may restore typed text when coming back to the page.
  if (field.value) update();
  field.focus({ preventScroll: true });
}

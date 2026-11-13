// @ts-check
/**
 * @file Step filters on guide pages (by priority and completion).
 */
import { CLEARED_EVENT } from './storage.mjs';

/**
 * @typedef {object} FilterState
 * @property {boolean} essentialOnly
 * @property {boolean} hideDone
 */

/**
 * Which items the active filters hide.
 * @param {{ id: string, priority: string, done: boolean }[]} items
 * @param {FilterState} filters
 * @returns {Set<string>}  Ids of hidden items.
 */
export function hiddenItems(items, { essentialOnly, hideDone }) {
  return new Set(
    items.filter((item) => (essentialOnly && item.priority !== 'essential') || (hideDone && item.done)).map((item) => item.id),
  );
}

/**
 * "Essential only" and "Hide done" on guide pages. The choice isn't saved:
 * a guide always opens complete.
 *
 * Filters are applied when a button is pressed, not while ticking: with
 * "Hide done" on, an item you just ticked stays where it is (so a slip is easy
 * to undo) and leaves the next time a filter changes.
 */
export function initFilters() {
  const bar = document.querySelector('[data-js="filters"]');
  const checklist = document.querySelector('[data-js="checklist"]');
  if (!(bar instanceof HTMLElement) || !(checklist instanceof HTMLElement)) return;

  const buttons = /** @type {HTMLElement[]} */ ([...bar.querySelectorAll('[data-js="filter"]')]);
  const status = bar.querySelector('[data-js="filter-status"]');
  const empty = checklist.querySelector('[data-js="filter-empty"]');
  const items = /** @type {HTMLElement[]} */ ([...checklist.querySelectorAll('[data-js="item"]')]);
  const tocLinks = /** @type {HTMLElement[]} */ ([...checklist.querySelectorAll('[data-js="toc-link"]')]);
  /** @type {FilterState} */
  const state = { essentialOnly: false, hideDone: false };

  const apply = () => {
    const hidden = hiddenItems(
      items.map((item) => {
        const check = /** @type {HTMLInputElement | null} */ (item.querySelector('[data-js="item-check"]'));
        return { id: item.id, priority: item.dataset.priority ?? '', done: Boolean(check?.checked) };
      }),
      state,
    );
    items.forEach((item) => {
      item.hidden = hidden.has(item.id);
    });
    tocLinks.forEach((link) => {
      if (link.parentElement) link.parentElement.hidden = hidden.has(link.dataset.item ?? '');
    });
    const shown = items.length - hidden.size;
    const active = state.essentialOnly || state.hideDone;
    if (status instanceof HTMLElement) {
      status.textContent = active
        ? (status.dataset.template ?? '').replace('{shown}', String(shown)).replace('{total}', String(items.length))
        : '';
    }
    if (empty instanceof HTMLElement) empty.hidden = shown > 0;
  };

  buttons.forEach((button) => {
    button.addEventListener('click', () => {
      const name = button.dataset.filter;
      if (name !== 'essentialOnly' && name !== 'hideDone') return;
      state[name] = !state[name];
      button.setAttribute('aria-pressed', String(state[name]));
      apply();
    });
  });

  // Progress was wiped (here or from the footer): done items are no longer done.
  // Both listeners run after the checklist's own, which unticks the boxes first.
  document.addEventListener(CLEARED_EVENT, apply);
  checklist.querySelector('[data-js="progress-reset"]')?.addEventListener('click', apply);
}

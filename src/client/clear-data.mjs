// @ts-check
/**
 * @file The "Clear saved data" button: removes everything the site stored in this browser.
 */
import { CLEARED_EVENT, clearAll } from './storage.mjs';

/** How long the button shows its "cleared" confirmation. */
const CONFIRM_MS = 3000;

/**
 * Footer button that removes everything this site saved in the browser.
 * The button stays enabled (disabling a focused button drops keyboard focus);
 * the result is announced through a status region next to it.
 */
export function initClearData() {
  const button = document.querySelector('[data-js="clear-data"]');
  if (!(button instanceof HTMLButtonElement)) return;
  const status = document.querySelector('[data-js="clear-data-status"]');
  const label = button.textContent ?? '';
  let timer = 0;

  button.addEventListener('click', () => {
    clearAll();
    document.dispatchEvent(new CustomEvent(CLEARED_EVENT));
    const done = button.dataset.done ?? label;
    button.textContent = done;
    if (status) status.textContent = done;
    window.clearTimeout(timer);
    timer = window.setTimeout(() => {
      button.textContent = label;
      if (status) status.textContent = '';
    }, CONFIRM_MS);
  });
}

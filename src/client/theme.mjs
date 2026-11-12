// @ts-check
// SPDX-FileCopyrightText: 2026 Shota Mtvarelishvili <mtvarelishvili@proton.me>
// SPDX-License-Identifier: MIT
/**
 * @file Light/dark theme toggle.
 * @author Shota Mtvarelishvili <mtvarelishvili@proton.me> (https://shoti.github.io/)
 */
import { CLEARED_EVENT, PREFIX, read, write } from './storage.mjs';

const STORAGE_KEY = 'theme';

/**
 * Light/dark toggle. The page follows the system setting until the visitor
 * picks a theme; the choice is applied before first paint by the inline
 * head script. The browser UI color (<meta name="theme-color">) follows too.
 */
export function initTheme() {
  const button = document.querySelector('[data-js="theme-toggle"]');
  if (!(button instanceof HTMLButtonElement)) return;

  const root = document.documentElement;
  const systemDark = window.matchMedia('(prefers-color-scheme: dark)');
  const metas = /** @type {HTMLMetaElement[]} */ ([...document.querySelectorAll('meta[data-js="theme-color"]')]);
  const isDark = () => (root.dataset.theme ? root.dataset.theme === 'dark' : systemDark.matches);

  const sync = () => {
    button.setAttribute('aria-pressed', String(isDark()));
    const chosen = root.dataset.theme;
    metas.forEach((meta) => {
      // With a manual choice both tags carry its color; otherwise each keeps its own media query's color.
      const ownTheme = meta.media.includes('dark') ? 'dark' : 'light';
      meta.content = (chosen === 'dark' || chosen === 'light' ? meta.dataset[chosen] : meta.dataset[ownTheme]) ?? meta.content;
    });
  };

  /** Applies the saved choice (or none), e.g. after another tab or page changed it. */
  const reload = () => {
    const saved = read(STORAGE_KEY);
    if (saved === 'light' || saved === 'dark') root.dataset.theme = saved;
    else delete root.dataset.theme;
    sync();
  };

  button.addEventListener('click', () => {
    const next = isDark() ? 'light' : 'dark';
    root.dataset.theme = next;
    write(STORAGE_KEY, next);
    sync();
  });

  // Safari before 14 only has the older addListener().
  if (typeof systemDark.addEventListener === 'function') systemDark.addEventListener('change', sync);
  else systemDark.addListener(sync);

  document.addEventListener(CLEARED_EVENT, () => {
    delete root.dataset.theme;
    sync();
  });
  // Another tab changed the theme or cleared all data (key === null).
  window.addEventListener('storage', (event) => {
    if (event.key === null || event.key === PREFIX + STORAGE_KEY) reload();
  });
  // A page restored from the back/forward cache missed changes made elsewhere.
  window.addEventListener('pageshow', (event) => {
    if (event.persisted) reload();
  });

  sync();
}

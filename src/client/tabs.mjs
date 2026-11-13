// @ts-check
/**
 * @file Platform tabs on guide pages, remembering the chosen platform.
 */
import { write } from './storage.mjs';

/**
 * Turns each item's platform sections (iPhone / Android / Computer …) into
 * accessible tabs, following the WAI-ARIA tabs pattern. Without JS the
 * sections are simply shown one after another.
 *
 * The inline head script picks the platform before first paint
 * (<html data-platform>), and CSS already shows only that panel, so building
 * the tabs here doesn't move anything on screen.
 *
 * Clicking a tab with a shared key (e.g. "ios") selects it in every item and
 * is remembered. Arrow keys only move within one item's tabs.
 */

const STORAGE_KEY = 'platform';
const CHANGE_EVENT = 'lockwell:platform';

/**
 * Where to remember the platform choice. On session-only guides it stays in
 * this tab, so a closed tab leaves no trace that the site was used.
 * @param {{ dataset: DOMStringMap | Record<string, string | undefined> } | null} checklist
 * @returns {import('./storage.mjs').Area}
 */
export const platformArea = (checklist) => (checklist?.dataset.storage === 'session' ? 'session' : 'local');

export function initTabs() {
  const groups = document.querySelectorAll('[data-js="platforms"]');
  const preferred = document.documentElement.dataset.platform ?? 'desktop';
  const checklist = document.querySelector('[data-js="checklist"]');
  const area = platformArea(checklist instanceof HTMLElement ? checklist : null);
  const overflow = watchOverflow();
  groups.forEach((group) => {
    if (group instanceof HTMLElement) createTabs(group, preferred, area, overflow);
  });
}

/**
 * @param {HTMLElement} group
 * @param {string} preferred
 * @param {import('./storage.mjs').Area} area
 * @param {(tablist: HTMLElement) => void} watch
 */
function createTabs(group, preferred, area, watch) {
  const panels = /** @type {HTMLElement[]} */ ([...group.querySelectorAll(':scope > [data-js="platform"]')]);
  if (panels.length < 2) return;

  const tablist = document.createElement('div');
  tablist.className = 'tablist';
  tablist.setAttribute('role', 'tablist');
  tablist.setAttribute('aria-label', group.dataset.label ?? '');

  const tabs = panels.map((panel) => {
    const tab = document.createElement('button');
    tab.type = 'button';
    tab.className = 'tab';
    tab.id = `${panel.id}-tab`;
    tab.textContent = panel.querySelector('.platform__title')?.textContent ?? '';
    tab.setAttribute('role', 'tab');
    tab.setAttribute('aria-controls', panel.id);
    panel.setAttribute('role', 'tabpanel');
    panel.setAttribute('aria-labelledby', tab.id);
    panel.tabIndex = 0;
    tablist.append(tab);
    return tab;
  });

  /**
   * @param {number} index
   * @param {{ focus?: boolean }} [options]
   */
  const select = (index, { focus = false } = {}) => {
    tabs.forEach((tab, i) => {
      const selected = i === index;
      tab.setAttribute('aria-selected', String(selected));
      tab.tabIndex = selected ? 0 : -1;
      panels[i].hidden = !selected;
    });
    if (focus) tabs[index].focus();
  };

  /** @param {string} key */
  const indexOfKey = (key) => panels.findIndex((panel) => panel.dataset.platform === key);

  tabs.forEach((tab, index) => {
    tab.addEventListener('click', () => {
      select(index);
      const key = panels[index].dataset.platform;
      if (!key) return;
      write(STORAGE_KEY, key, area);
      document.documentElement.dataset.platform = key;
      document.dispatchEvent(new CustomEvent(CHANGE_EVENT, { detail: { key, source: group } }));
    });
  });

  tablist.addEventListener('keydown', (event) => {
    const current = tabs.findIndex((tab) => tab.getAttribute('aria-selected') === 'true');
    const last = tabs.length - 1;
    /** @type {Record<string, number>} */
    const moves = { ArrowRight: current === last ? 0 : current + 1, ArrowLeft: current === 0 ? last : current - 1, Home: 0, End: last };
    if (!(event.key in moves)) return;
    event.preventDefault();
    select(moves[event.key], { focus: true });
  });

  document.addEventListener(CHANGE_EVENT, (event) => {
    const { key, source } = /** @type {CustomEvent<{ key: string, source: HTMLElement }>} */ (event).detail;
    const index = indexOfKey(key);
    if (source !== group && index !== -1) select(index);
  });

  group.prepend(tablist);
  group.classList.add('platforms--tabs');
  select(Math.max(0, indexOfKey(preferred)));
  watch(tablist);
}

/**
 * Fades the end of a tab bar when there are more tabs than fit, so it's
 * clear the bar can be scrolled (the scrollbar itself is hidden).
 * One ResizeObserver serves every tab bar: it runs after layout, batched,
 * instead of one resize listener per bar each forcing a fresh layout.
 * @returns {(tablist: HTMLElement) => void}  Starts watching a tab bar.
 */
function watchOverflow() {
  /** @param {Element} tablist */
  const update = (tablist) => {
    const hiddenRight = tablist.scrollWidth - tablist.clientWidth - tablist.scrollLeft > 1;
    tablist.classList.toggle('tablist--more', hiddenRight);
  };
  /** @type {HTMLElement[]} */
  const watched = [];
  const observer =
    typeof ResizeObserver === 'function' ? new ResizeObserver((entries) => entries.forEach((entry) => update(entry.target))) : null;
  if (!observer) window.addEventListener('resize', () => watched.forEach(update), { passive: true });

  return (tablist) => {
    watched.push(tablist);
    tablist.addEventListener('scroll', () => update(tablist), { passive: true });
    if (observer) observer.observe(tablist);
    else update(tablist);
  };
}

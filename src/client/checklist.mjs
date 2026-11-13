// @ts-check
/**
 * @file Checklist progress (ticks, counts, saving through storage.mjs) and the lists that show it.
 */
import { CLEARED_EVENT, PREFIX, progressKey, readProgress, writeProgress } from './storage.mjs';
import { fillText } from './fill.mjs';

/**
 * Saves which checklist items are done, per guide, in this browser only.
 * The guide key and item ids are the same in every language, so progress
 * carries over when switching languages. Guides marked `progress: session`
 * keep it only until the tab is closed.
 */

/**
 * @param {string} template  e.g. "{done} of {total} done"
 * @param {number} done
 * @param {number} total
 */
export const formatProgress = (template, done, total) =>
  fillText(template, { done: String(done), total: String(total) });

/**
 * Counts saved ids that still exist in the guide (items can be removed later).
 * @param {string[]} saved
 * @param {Set<string>} ids
 */
export const countDone = (saved, ids) => saved.filter((id) => ids.has(id)).length;

/**
 * The finished items after one checkbox change. Starts from what storage holds
 * (so changes made in another tab are kept), or from what the page shows when
 * storage is unavailable.
 * @param {Set<string>} current  Finished items as shown on this page.
 * @param {string[] | null} saved  Saved ids, or null if storage is unavailable.
 * @param {Set<string>} ids  Item ids that exist in this guide.
 * @param {string} id  The item that changed.
 * @param {boolean} checked
 * @returns {Set<string>}
 */
export function applyChange(current, saved, ids, id, checked) {
  const next = new Set(saved === null ? current : saved.filter((savedId) => ids.has(savedId)));
  if (checked) next.add(id);
  else next.delete(id);
  return next;
}

/**
 * @typedef {object} ProgressStore
 * @property {() => string[] | null} read  Saved ids, or null when storage is unavailable.
 * @property {(done: string[]) => boolean} write  false when storage refused the save.
 */

/**
 * A guide's finished items, kept in sync with storage. If storage can't be read
 * or refuses a save, it keeps working from memory for the rest of the visit, so
 * a failed save never makes earlier ticks disappear.
 * @param {Set<string>} ids  Item ids that exist in this guide.
 * @param {ProgressStore} store
 */
export function createProgress(ids, store) {
  /** @type {Set<string>} */
  let done = new Set();
  let memoryOnly = false;

  /** @param {string[]} next */
  const save = (next) => {
    if (!memoryOnly && !store.write(next)) memoryOnly = true;
  };

  return {
    get done() {
      return done;
    },
    /** Replaces the state with what is saved (another tab, a restored page). */
    load() {
      if (memoryOnly) return;
      const saved = store.read();
      if (saved === null) memoryOnly = true;
      else done = new Set(saved.filter((id) => ids.has(id)));
    },
    /** @param {string} id @param {boolean} checked */
    change(id, checked) {
      done = applyChange(done, memoryOnly ? null : store.read(), ids, id, checked);
      save([...done]);
    },
    reset() {
      done = new Set();
      save([]);
    },
    /** Storage was already cleared elsewhere; only forget the in-memory state. */
    forget() {
      done = new Set();
    },
  };
}

/**
 * @param {HTMLElement} element
 * @returns {import('./storage.mjs').Area}
 */
export const areaOf = (element) => (element.dataset.storage === 'session' ? 'session' : 'local');

/**
 * Updates progress bars and texts inside `root`.
 * @param {ParentNode} root
 * @param {number} done
 * @param {number} total
 */
function renderProgress(root, done, total) {
  root.querySelectorAll('[data-js="progress-bar"]').forEach((bar) => {
    if (bar instanceof HTMLElement) bar.style.setProperty('--progress', String(total ? done / total : 0));
  });
  root.querySelectorAll('[data-js="progress-text"]').forEach((text) => {
    if (text instanceof HTMLElement) text.textContent = formatProgress(text.dataset.template ?? '', done, total);
  });
}

/**
 * Marks finished steps in a list of links to them (the contents list on a
 * guide page).
 * @param {ParentNode} root
 * @param {Set<string>} done
 */
function renderDoneLinks(root, done) {
  root.querySelectorAll('[data-js="toc-link"]').forEach((link) => {
    if (!(link instanceof HTMLElement)) return;
    const isDone = done.has(link.dataset.item ?? '');
    link.classList.toggle('is-done', isDone);
    // The check mark is visual only; screen readers get the text.
    const doneText = link.querySelector('[data-js="toc-done"]');
    if (doneText instanceof HTMLElement) doneText.textContent = isDone ? (doneText.dataset.text ?? '') : '';
  });
}

/** Progress on guide pages. */
export function initChecklist() {
  const root = document.querySelector('[data-js="checklist"]');
  if (!(root instanceof HTMLElement) || !root.dataset.guide) return;

  const guide = root.dataset.guide;
  const area = areaOf(root);
  const checks = /** @type {HTMLInputElement[]} */ ([...root.querySelectorAll('input[data-js="item-check"]')]);
  const widgets = /** @type {HTMLElement[]} */ ([...document.querySelectorAll('[data-js="progress"]')]);
  const live = document.querySelector('[data-js="progress-live"]');
  const template = root.querySelector('[data-js="progress-text"]');
  const ids = new Set(checks.map((check) => check.value));
  const progress = createProgress(ids, {
    read: () => readProgress(guide, area),
    write: (done) => writeProgress(guide, area, done),
  });

  /** @param {{ announce?: boolean }} [options] */
  const render = ({ announce = false } = {}) => {
    const done = progress.done;
    checks.forEach((check) => {
      check.checked = done.has(check.value);
    });
    widgets.forEach((widget) => renderProgress(widget, done.size, checks.length));
    renderDoneLinks(root, done);
    if (announce && live && template instanceof HTMLElement) {
      live.textContent = formatProgress(template.dataset.template ?? '', done.size, checks.length);
    }
  };

  root.addEventListener('change', (event) => {
    const check = event.target;
    if (!(check instanceof HTMLInputElement) || check.dataset.js !== 'item-check') return;
    progress.change(check.value, check.checked);
    render({ announce: true });
  });

  root.querySelector('[data-js="progress-reset"]')?.addEventListener('click', () => {
    progress.reset();
    render({ announce: true });
  });

  // Another tab changed this guide's progress (only fires for localStorage).
  window.addEventListener('storage', (event) => {
    if (event.key === null || event.key === PREFIX + progressKey(guide)) {
      progress.load();
      render();
    }
  });

  // Restored from the back/forward cache: storage may have changed meanwhile
  // (e.g. "Clear saved data" on another page), and frozen pages get no events.
  window.addEventListener('pageshow', (event) => {
    if (event.persisted) {
      progress.load();
      render();
    }
  });

  document.addEventListener(CLEARED_EVENT, () => {
    progress.forget();
    render({ announce: true });
  });

  progress.load();
  render();
}

/**
 * Saved progress on guide cards (home page and guides list).
 */
export function initCardProgress() {
  const cards = /** @type {HTMLElement[]} */ ([...document.querySelectorAll('[data-js="card-progress"]')]);
  if (cards.length === 0) return;

  const update = () => {
    cards.forEach((card) => {
      if (!card.dataset.guide) return;
      const ids = new Set((card.dataset.items ?? '').split(' ').filter(Boolean));
      const done = countDone(readProgress(card.dataset.guide, areaOf(card)) ?? [], ids);
      renderProgress(card, done, ids.size);
      card.classList.toggle('is-visible', done > 0);
      card.classList.toggle('is-complete', ids.size > 0 && done === ids.size);
    });
  };

  document.addEventListener(CLEARED_EVENT, update);
  window.addEventListener('storage', update);
  window.addEventListener('pageshow', (event) => {
    if (event.persisted) update();
  });
  update();
}

/**
 * Sidebar lists (a guide's contents) start open, so desktop never shifts. On small screens CSS keeps them hidden until
 * this runs and closes them, so there is no jump there either.
 */
export function initToc() {
  for (const toc of document.querySelectorAll('[data-js="toc"]')) {
    if (!(toc instanceof HTMLDetailsElement)) continue;
    // Each list says in CSS from which width it has room to stay open (--bp-wide).
    const breakpoint = getComputedStyle(toc).getPropertyValue('--bp-wide').trim() || '64rem';
    if (!window.matchMedia(`(min-width: ${breakpoint})`).matches) toc.open = false;
    toc.dataset.ready = '';
  }
}

/**
 * The step being read: the last one whose top has passed the reading line, or
 * the last one once the page can't scroll further (a short last step never
 * reaches the line). -1 above the first step.
 * @param {number[]} tops  Viewport top of each shown step, in page order.
 * @param {number} line  Viewport position of the reading line.
 * @param {boolean} atEnd  Scrolled to the bottom of the page.
 */
export function pickCurrent(tops, line, atEnd) {
  if (atEnd && tops.length > 0) return tops.length - 1;
  let current = -1;
  tops.forEach((top, i) => {
    if (top <= line) current = i;
  });
  return current;
}

/**
 * Marks the step being read in the guide's contents list (aria-current), as
 * the visitor scrolls. It only changes the link's look: nothing moves. Steps
 * hidden by the filters are skipped.
 */
export function initStepSpy() {
  const links = /** @type {HTMLElement[]} */ ([...document.querySelectorAll('[data-js="toc-link"]')]);
  const items = /** @type {HTMLElement[]} */ ([...document.querySelectorAll('[data-js="item"]')]);
  if (links.length === 0 || items.length === 0) return;
  const linkFor = new Map(links.map((link) => [link.dataset.item, link]));
  /** @type {HTMLElement | undefined} */
  let current;
  let queued = false;

  const update = () => {
    queued = false;
    const shown = items.map((item) => ({ item, box: item.getBoundingClientRect() })).filter(({ box }) => box.height > 0);
    const root = document.documentElement;
    const atEnd = window.innerHeight + window.scrollY >= root.scrollHeight - 2;
    const at = pickCurrent(shown.map(({ box }) => box.top), window.innerHeight * 0.3, atEnd);
    const next = at === -1 ? undefined : linkFor.get(shown[at].item.id);
    if (next === current) return;
    current?.removeAttribute('aria-current');
    next?.setAttribute('aria-current', 'location');
    current = next;
  };
  const queue = () => {
    if (queued) return;
    queued = true;
    window.requestAnimationFrame(update);
  };

  window.addEventListener('scroll', queue, { passive: true });
  window.addEventListener('resize', queue);
  // The filters ("Essential only", "Hide done") show and hide steps.
  document.addEventListener('change', queue);
  update();
}

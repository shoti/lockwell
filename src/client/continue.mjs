// @ts-check
/**
 * @file The "continue where you left off" link built from saved progress.
 */
import { areaOf, countDone } from './checklist.mjs';
import { CLEARED_EVENT, readProgress } from './storage.mjs';

/**
 * Which guide to offer under "Continue": the first one that isn't finished,
 * but only once the visitor has ticked something somewhere. A new visitor
 * sees nothing (the "Start here" button already covers them).
 * When the page lists more than one track, it only looks inside tracks the
 * visitor has worked on: someone who started only high-risk guides isn't sent
 * back to the first guide for everyone.
 * @param {{ done: number, total: number, track?: string }[]} guides  In the order they are listed.
 * @returns {number}  Index of the guide, or -1 for none.
 */
export function pickContinue(guides) {
  for (const { track } of guides.filter((guide) => guide.done > 0)) {
    const index = guides.findIndex((guide) => guide.track === track && guide.done < guide.total);
    if (index !== -1) return index;
  }
  return -1;
}

/**
 * Home page and guides list: a link back to the guide the visitor was working on. Its line is
 * reserved by CSS and only toggles visibility, so nothing moves when it fills in.
 */
export function initContinue() {
  const link = document.querySelector('[data-js="continue"]');
  if (!(link instanceof HTMLElement)) return;
  const title = link.querySelector('[data-js="continue-title"]');
  const count = link.querySelector('[data-js="continue-count"]');
  const cards = /** @type {HTMLElement[]} */ ([...link.querySelectorAll('[data-js="continue-guide"]')]);

  const update = () => {
    const guides = cards.map((card) => {
      const ids = new Set((card.dataset.items ?? '').split(' ').filter(Boolean));
      const saved = card.dataset.guide ? readProgress(card.dataset.guide, areaOf(card)) : null;
      return { done: countDone(saved ?? [], ids), total: ids.size, track: card.dataset.track, target: card.dataset.href, name: card.dataset.title };
    });
    const guide = guides[pickContinue(guides)];
    link.classList.toggle('is-visible', Boolean(guide?.target));
    if (!guide?.target) {
      // Without href the link can't be focused or followed while it is invisible.
      link.removeAttribute('href');
      return;
    }
    link.setAttribute('href', guide.target);
    if (title) title.textContent = guide.name ?? '';
    if (count) count.textContent = `${guide.done}/${guide.total}`;
  };

  document.addEventListener(CLEARED_EVENT, update);
  window.addEventListener('storage', update);
  window.addEventListener('pageshow', (event) => {
    if (event.persisted) update();
  });
  update();
}

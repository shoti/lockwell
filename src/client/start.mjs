// @ts-check
// SPDX-FileCopyrightText: 2026 Shota Mtvarelishvili <mtvarelishvili@proton.me>
// SPDX-License-Identifier: MIT
/**
 * @file Starts each feature in isolation and keeps the JS layout only if all layout features started.
 * @author Shota Mtvarelishvili <mtvarelishvili@proton.me> (https://shoti.github.io/)
 */

/**
 * @typedef {object} Feature
 * @property {string} name  For error messages.
 * @property {() => void} init
 * @property {boolean} [layout]  Needed by the JS layout (e.g. tabs). If it fails, the page
 *   must fall back to the no-JS layout, or content that CSS hides for the tabs stays hidden.
 */

/** @param {string} className */
const hasJsClass = (className) => /(^|\s)js(\s|$)/.test(className);

/**
 * Starts every feature on its own, so one failure can't stop the others, then
 * tells the head script's failsafe that the page is ready ("js-ready").
 *
 * The page keeps the JS layout only if every layout feature started. If the
 * failsafe already switched to "no-js" (this script was slow), the page stays
 * in the no-JS layout and layout features are skipped: switching back would
 * move everything a second time.
 * @param {Feature[]} features
 * @param {{ className: string }} root  document.documentElement
 * @param {(...args: unknown[]) => void} [logError]
 */
export function startFeatures(features, root, logError = console.error) {
  let jsLayout = hasJsClass(root.className);
  for (const feature of features) {
    if (feature.layout && !jsLayout) continue;
    try {
      feature.init();
    } catch (error) {
      logError(`[lockwell] "${feature.name}" failed to start.${feature.layout ? ' Using the no-JS layout so no content stays hidden.' : ''}`, error);
      if (feature.layout) jsLayout = false;
    }
  }
  root.className = jsLayout ? 'js js-ready' : 'no-js js-ready';
}

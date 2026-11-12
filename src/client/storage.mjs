// @ts-check
// SPDX-FileCopyrightText: 2026 Shota Mtvarelishvili <mtvarelishvili@proton.me>
// SPDX-License-Identifier: MIT
/**
 * @file Browser storage wrapper that degrades to in-memory state when storage is unavailable.
 * @author Shota Mtvarelishvili <mtvarelishvili@proton.me> (https://shoti.github.io/)
 */
/**
 * Browser storage wrapper. Storage can be unavailable (private mode, blocked
 * site data), so every call is guarded and the site keeps working without it.
 * Everything stays on this device: nothing here is ever sent anywhere.
 *
 * Keys (all prefixed "lockwell:"; the inline head script in
 * src/build/assets.mjs reads "theme" and "platform" too):
 *   theme              "light" | "dark"
 *   platform           "ios" | "android" | "desktop" (sessionStorage on session-only guides)
 *   progress:<guide>   {"v":1,"done":["item-id", …]}, <guide> is a short id derived
 *                      from the slug. It isn't the guide's name, but it isn't secret
 *                      either: the page's HTML shows which guide it belongs to.
 */

export const PREFIX = 'lockwell:';
const PROGRESS_VERSION = 1;

/** @typedef {'local' | 'session'} Area */

/**
 * @param {Area} area
 * @returns {Storage}
 */
function storageFor(area) {
  return area === 'session' ? window.sessionStorage : window.localStorage;
}

/**
 * Reads a value, telling "nothing saved" (null) apart from "storage unavailable" (undefined).
 * @param {string} key
 * @param {Area} [area]
 * @returns {string | null | undefined}
 */
export function tryRead(key, area = 'local') {
  try {
    return storageFor(area).getItem(PREFIX + key);
  } catch (error) {
    console.warn(`[lockwell] Could not read "${key}" from ${area}Storage; saved state will not be restored.`, error);
    return undefined;
  }
}

/**
 * @param {string} key
 * @param {Area} [area]
 * @returns {string | null}  null when nothing is saved or storage is unavailable.
 */
export function read(key, area = 'local') {
  return tryRead(key, area) ?? null;
}

/**
 * @param {string} key
 * @param {string} value
 * @param {Area} [area]
 * @returns {boolean}  false when the value could not be saved.
 */
export function write(key, value, area = 'local') {
  try {
    storageFor(area).setItem(PREFIX + key, value);
    return true;
  } catch (error) {
    console.warn(`[lockwell] Could not save "${key}" to ${area}Storage; it will be lost on reload.`, error);
    return false;
  }
}

/**
 * @param {string} key
 * @param {Area} [area]
 * @returns {boolean}  false when the value could not be removed.
 */
export function remove(key, area = 'local') {
  try {
    storageFor(area).removeItem(PREFIX + key);
    return true;
  } catch (error) {
    console.warn(`[lockwell] Could not remove "${key}" from ${area}Storage.`, error);
    return false;
  }
}

/** @param {string} guide */
export const progressKey = (guide) => `progress:${guide}`;

/**
 * Parses saved progress. Anything unexpected (old format, corrupted data)
 * counts as "nothing saved" rather than breaking the page.
 * @param {string | null} value
 * @returns {string[]}
 */
export function parseProgress(value) {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    if (parsed?.v !== PROGRESS_VERSION || !Array.isArray(parsed.done)) return [];
    return parsed.done.filter((/** @type {unknown} */ id) => typeof id === 'string');
  } catch {
    return [];
  }
}

/** @param {string[]} done */
export const serializeProgress = (done) => JSON.stringify({ v: PROGRESS_VERSION, done });

/**
 * @param {string} guide
 * @param {Area} area
 * @returns {string[] | null}  Saved item ids, or null if storage is unavailable
 *   (so callers keep what they have in memory instead of treating it as "nothing done").
 */
export function readProgress(guide, area) {
  const value = tryRead(progressKey(guide), area);
  return value === undefined ? null : parseProgress(value);
}

/**
 * @param {string} guide
 * @param {Area} area
 * @param {string[]} done  An empty list removes the entry entirely.
 * @returns {boolean}  false when storage refused the change.
 */
export function writeProgress(guide, area, done) {
  return done.length ? write(progressKey(guide), serializeProgress(done), area) : remove(progressKey(guide), area);
}

/** Removes everything this site stored, in both storage areas. */
export function clearAll() {
  for (const area of /** @type {Area[]} */ (['local', 'session'])) {
    try {
      const storage = storageFor(area);
      const keys = Array.from({ length: storage.length }, (_, i) => storage.key(i)).filter(
        (key) => key !== null && key.startsWith(PREFIX),
      );
      keys.forEach((key) => storage.removeItem(/** @type {string} */ (key)));
    } catch (error) {
      console.warn(`[lockwell] Could not clear ${area}Storage.`, error);
    }
  }
}

/** Fired on document after clearAll(), so every feature can reset its UI. */
export const CLEARED_EVENT = 'lockwell:cleared';

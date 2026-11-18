// @ts-check
/**
 * @file Undo and redo over a list of steps, whatever a step holds. Shared by the image tools.
 */

/**
 * @template T
 * @typedef {{ entries: T[], index: number, tag: string }} History
 */

const HISTORY_LIMIT = 100;

/** @template T @param {T} entry @returns {History<T>} */
export const createHistory = (entry) => ({ entries: [entry], index: 0, tag: '' });

/**
 * Adds a step. Steps with the same non-empty tag in a row (a run of arrow
 * key presses on one shape) count as one, so undo takes the whole run back.
 * @template T
 * @param {History<T>} history
 * @param {T} entry
 * @param {string} [tag]
 * @returns {History<T>}
 */
export function commit(history, entry, tag = '') {
  const merge = tag !== '' && tag === history.tag;
  const kept = history.entries.slice(0, history.index + (merge ? 0 : 1));
  const entries = [...kept, entry].slice(-HISTORY_LIMIT);
  return { entries, index: entries.length - 1, tag };
}

/** @template T @param {History<T>} history @returns {History<T>} */
export const undo = (history) => ({ ...history, index: Math.max(0, history.index - 1), tag: '' });

/** @template T @param {History<T>} history @returns {History<T>} */
export const redo = (history) => ({ ...history, index: Math.min(history.entries.length - 1, history.index + 1), tag: '' });

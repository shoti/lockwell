// @ts-check
/**
 * @file Helpers for long-form articles: reading time and article-specific checks.
 */
/** Helpers for long-form articles (content/<lang>/articles/*.md). */

/** @typedef {import('./markdown.mjs').BlockNode} BlockNode */

/**
 * Careful reading speed for explanatory text. Georgian words are longer than
 * English ones, so one modest figure serves both languages.
 */
const WORDS_PER_MINUTE = 180;

/**
 * @param {BlockNode[]} nodes
 * @returns {number}
 */
function countWords(nodes) {
  let words = 0;
  for (const node of nodes) {
    if (node.type === 'callout') words += countWords(node.children);
    else if (node.type === 'list') words += node.items.reduce((sum, item) => sum + wordsIn(item.text), 0);
    else if (node.type === 'figure') words += wordsIn(node.caption);
    else words += wordsIn(node.text);
  }
  return words;
}

/** @param {string} text */
const wordsIn = (text) => text.split(/\s+/).filter(Boolean).length;

/**
 * Estimated reading time, computed from the text so it never goes stale.
 * @param {BlockNode[]} nodes
 * @returns {number}  Whole minutes, at least 1.
 */
export function readingMinutes(nodes) {
  return Math.max(1, Math.round(countWords(nodes) / WORDS_PER_MINUTE));
}

// @ts-check
// SPDX-FileCopyrightText: 2026 Shota Mtvarelishvili <mtvarelishvili@proton.me>
// SPDX-License-Identifier: MIT
/**
 * @file Turns a guide's parsed Markdown into checklist items, platform tabs and priorities.
 * @author Shota Mtvarelishvili <mtvarelishvili@proton.me> (https://shoti.github.io/)
 */
/**
 * Turns a guide's parsed Markdown into checklist items.
 *   Text before the first "##"            → intro
 *   "## Title {#stable-id .priority}"     → a checklist item
 *   "### Platform {.optional-key}"        → step-by-step instructions for one platform/app
 */
import { ContentError } from './errors.mjs';

/** @typedef {import('./markdown.mjs').BlockNode} BlockNode */

export const PRIORITIES = /** @type {const} */ (['essential', 'recommended', 'advanced']);

/**
 * Shared platform keys ("### iPhone {.ios}"). Choosing one tab selects it in every item,
 * and the head script pre-selects the visitor's platform. The head script
 * (assets.mjs) and the CSS (06-guide.css) must support every key listed here;
 * tests check both.
 */
export const PLATFORM_KEYS = /** @type {const} */ (['ios', 'android', 'desktop']);

/** @typedef {typeof PRIORITIES[number]} Priority */

/**
 * @typedef {object} Platform
 * @property {string} label  Visible tab label, e.g. "iPhone" or "WhatsApp".
 * @property {string | null} key  Optional shared key (e.g. "ios") so one tab choice applies to all items.
 * @property {BlockNode[]} body
 */

/**
 * @typedef {object} GuideItem
 * @property {string} id  Stable id. Saved progress depends on it, so never change it once published.
 * @property {string} title
 * @property {Priority} priority
 * @property {number} line
 * @property {BlockNode[]} body
 * @property {Platform[]} platforms
 */

/**
 * @param {BlockNode[]} nodes
 * @param {string} file
 * @returns {{ intro: BlockNode[], items: GuideItem[] }}
 */
export function splitGuide(nodes, file) {
  /** @type {BlockNode[]} */
  const intro = [];
  /** @type {GuideItem[]} */
  const items = [];
  /** @type {GuideItem | null} */
  let item = null;
  /** @type {Platform | null} */
  let platform = null;

  for (const node of nodes) {
    if (node.type === 'heading' && node.level === 2) {
      item = createItem(node, file, items);
      items.push(item);
      platform = null;
      continue;
    }
    if (node.type === 'heading' && node.level === 3) {
      if (!item) throw new ContentError(file, node.line, '"###" platform headings must come after a "##" checklist item.');
      platform = { label: node.text, key: platformKey(node, file), body: [] };
      item.platforms.push(platform);
      continue;
    }
    if (platform) platform.body.push(node);
    else if (item) item.body.push(node);
    else intro.push(node);
  }

  if (items.length === 0) {
    throw new ContentError(file, 0, 'A guide needs at least one checklist item: a "## Title {#id .essential}" heading.');
  }
  for (const entry of items) {
    const emptyPlatform = entry.platforms.find((p) => p.body.length === 0);
    if (emptyPlatform) {
      throw new ContentError(file, entry.line, `Platform "${emptyPlatform.label}" in item "${entry.id}" has no instructions.`);
    }
  }
  return { intro, items };
}

/**
 * @param {import('./markdown.mjs').HeadingNode} node  A "###" platform heading.
 * @param {string} file
 * @returns {string | null}
 */
function platformKey(node, file) {
  const { classes } = node.attrs;
  if (classes.length > 1) {
    throw new ContentError(file, node.line, `Platform "${node.text}" can have only one platform key, found ${classes.map((c) => `.${c}`).join(' ')}.`);
  }
  const [key] = classes;
  if (key === undefined) return null;
  if (!PLATFORM_KEYS.some((known) => known === key)) {
    throw new ContentError(
      file,
      node.line,
      `Unknown platform key ".${key}". Use ${PLATFORM_KEYS.map((k) => `.${k}`).join(', ')}, or no key for app tabs such as WhatsApp.`,
    );
  }
  return key;
}

/**
 * @param {import('./markdown.mjs').HeadingNode} node
 * @param {string} file
 * @param {GuideItem[]} existing
 * @returns {GuideItem}
 */
function createItem(node, file, existing) {
  const { id, classes } = node.attrs;
  if (!id) {
    throw new ContentError(file, node.line, `Checklist item "${node.text}" needs a stable id, e.g. "## ${node.text} {#short-id .essential}".`);
  }
  if (existing.some((entry) => entry.id === id)) {
    throw new ContentError(file, node.line, `Duplicate item id "${id}". Each item in a guide needs a unique id.`);
  }
  const priority = PRIORITIES.find((p) => classes.includes(p));
  if (!priority) {
    throw new ContentError(file, node.line, `Item "${id}" needs a priority class: ${PRIORITIES.map((p) => `.${p}`).join(', ')}.`);
  }
  return { id, title: node.text, priority, line: node.line, body: [], platforms: [] };
}

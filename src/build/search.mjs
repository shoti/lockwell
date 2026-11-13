// @ts-check
// SPDX-FileCopyrightText: 2026 Shota Mtvarelishvili <mtvarelishvili@proton.me>
// SPDX-License-Identifier: MIT
/**
 * @file Builds the entries listed on the search page: guides, steps, articles and tools.
 * @author Shota Mtvarelishvili <mtvarelishvili@proton.me> (https://shoti.github.io/)
 */
/**
 * What the search page lists: every guide, every checklist step, every
 * article and every tool of one language. The page is plain HTML (a complete index without
 * JavaScript); src/client/search.mjs filters it as the visitor types, so no
 * index file is fetched and no query ever leaves the browser.
 */
import { plainText, strongTexts } from './markdown.mjs';
import { TOOLS, toolRoute } from './tools.mjs';

/** @typedef {import('./markdown.mjs').BlockNode} BlockNode */
/** @typedef {import('./content.mjs').Content} Content */

/**
 * @typedef {object} SearchEntry
 * @property {'guide' | 'step' | 'article' | 'tool'} kind
 * @property {string} title  Plain text.
 * @property {string | null} context  For a step: the guide it belongs to.
 * @property {string | null} summary  Shown under the title.
 * @property {string} route  Language-neutral route.
 * @property {string} hash  Anchor id without "#", or "".
 * @property {string} text  Everything else that should be searchable (never shown).
 */

/**
 * @param {BlockNode[]} nodes
 * @returns {string}
 */
export function blocksText(nodes) {
  return nodes
    .map((node) => {
      if (node.type === 'callout') return blocksText(node.children);
      if (node.type === 'list') return node.items.map((item) => plainText(item.text)).join(' ');
      // A figure restates the text around it; leaving it out keeps the search page small.
      if (node.type === 'figure') return '';
      return plainText(node.text);
    })
    .join(' ');
}

/**
 * The bold text (menu and setting names) in some blocks.
 * @param {BlockNode[]} nodes
 * @returns {string}
 */
export function blocksStrong(nodes) {
  return nodes
    .flatMap((node) => {
      if (node.type === 'callout') return [blocksStrong(node.children)];
      if (node.type === 'list') return node.items.flatMap((item) => strongTexts(item.text));
      if (node.type === 'figure') return [];
      return strongTexts(node.text);
    })
    .join(' ');
}

/**
 * Shrinks an entry's searchable text without changing what it matches.
 * The client (src/client/search.mjs) checks each query word separately with
 * `includes`, and a query word never contains whitespace. So a word matches
 * the text exactly when it is part of one of its words: repeated words, and
 * words already contained in a longer word or in the title, can be dropped.
 * @param {string} text  Lowercase.
 * @param {string} title  Lowercase.
 * @returns {string}
 */
export function compactSearchText(text, title) {
  const words = [...new Set(text.split(/\s+/).filter(Boolean))].sort((a, b) => b.length - a.length);
  /** @type {string[]} */
  const kept = [];
  for (const word of words) {
    if (title.includes(word) || kept.some((longer) => longer.includes(word))) continue;
    kept.push(word);
  }
  return kept.join(' ');
}

/**
 * @param {Content} content
 * @param {string} lang
 * @param {import('./i18n.mjs').Translate} t  UI strings of `lang`, for the tools.
 * @returns {SearchEntry[]}
 */
export function searchEntries(content, lang, t) {
  /** @type {SearchEntry[]} */
  const entries = [];
  for (const guide of content.guides[lang]) {
    entries.push({
      kind: 'guide',
      title: guide.title,
      context: null,
      summary: guide.summary,
      route: guide.route,
      hash: '',
      text: `${guide.description} ${blocksText(guide.intro)}`,
    });
    for (const item of guide.items) {
      entries.push({
        kind: 'step',
        title: plainText(item.title),
        context: guide.title,
        summary: null,
        route: guide.route,
        hash: item.id,
        // Platform tabs add only their name and the menu and setting names they use: their full
        // text would make the search page too heavy, as every guide is listed on it.
        text: [blocksText(item.body), ...item.platforms.map((platform) => `${platform.label} ${blocksStrong(platform.body)}`)].join(' '),
      });
    }
  }
  for (const article of content.articles[lang]) {
    entries.push({
      kind: 'article',
      title: article.title,
      context: null,
      summary: article.summary,
      route: article.route,
      hash: '',
      text: `${article.description} ${blocksText(article.body)}`,
    });
  }
  for (const tool of TOOLS) {
    entries.push({
      kind: 'tool',
      title: t(`tools.items.${tool.key}.title`),
      context: null,
      summary: t(`tools.items.${tool.key}.summary`),
      route: toolRoute(tool),
      hash: '',
      text: t(`tools.items.${tool.key}.description`),
    });
  }
  return entries;
}

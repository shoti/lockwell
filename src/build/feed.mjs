// @ts-check
// SPDX-FileCopyrightText: 2026 Shota Mtvarelishvili <mtvarelishvili@proton.me>
// SPDX-License-Identifier: MIT
/**
 * @file Atom feed of published guides and articles, one per language.
 * @author Shota Mtvarelishvili <mtvarelishvili@proton.me> (https://shoti.github.io/)
 */
/**
 * Atom feed of published guides and articles, one per language, so readers
 * can follow new content in a feed reader without giving anyone an address.
 */
import { escapeHtml } from './html.mjs';
import { absoluteUrl, localePath } from './site.mjs';

/** @typedef {import('./site.mjs').Site} Site */
/** @typedef {import('./content.mjs').Content} Content */

/**
 * @typedef {object} FeedEntry
 * @property {string} title
 * @property {string} summary
 * @property {string} route  Language-neutral route.
 * @property {string} updated  YYYY-MM-DD
 * @property {string} [published]  YYYY-MM-DD
 */

/** Site path of a language's feed, e.g. "/feed.xml" or "/en/feed.xml". */
export const feedPath = (/** @type {Site} */ site, /** @type {string} */ lang) => localePath(site, lang, '/feed.xml');

/**
 * Published guides and articles of one language, most recently changed first.
 * Drafts are left out, so a language with only drafts has no feed.
 * @param {Content} content
 * @param {string} lang
 * @returns {FeedEntry[]}
 */
export function feedEntries(content, lang) {
  const guides = content.guides[lang]
    .filter((guide) => !guide.draft)
    .map((guide) => ({ title: guide.title, summary: guide.description, route: guide.route, updated: guide.reviewed }));
  const articles = content.articles[lang]
    .filter((article) => !article.draft)
    .map((article) => ({
      title: article.title,
      summary: article.description,
      route: article.route,
      updated: article.updated ?? article.published,
      published: article.published,
    }));
  return [...articles, ...guides].sort((a, b) => b.updated.localeCompare(a.updated) || a.route.localeCompare(b.route));
}

/** Content dates have no time of day; feeds need one. @param {string} date */
const timestamp = (date) => `${date}T00:00:00Z`;

/**
 * @param {Site} site
 * @param {object} feed
 * @param {string} feed.lang
 * @param {string} feed.title
 * @param {string} feed.subtitle
 * @param {FeedEntry[]} feed.entries  At least one, newest first.
 * @returns {string}
 */
export function atomFeed(site, { lang, title, subtitle, entries }) {
  const self = absoluteUrl(site, feedPath(site, lang));
  const home = absoluteUrl(site, localePath(site, lang, '/'));
  const items = entries.map((entry) => {
    const url = escapeHtml(absoluteUrl(site, localePath(site, lang, entry.route)));
    return [
      '  <entry>',
      `    <title>${escapeHtml(entry.title)}</title>`,
      `    <link rel="alternate" type="text/html" href="${url}"/>`,
      `    <id>${url}</id>`,
      entry.published ? `    <published>${timestamp(entry.published)}</published>` : '',
      `    <updated>${timestamp(entry.updated)}</updated>`,
      `    <summary>${escapeHtml(entry.summary)}</summary>`,
      '  </entry>',
    ]
      .filter(Boolean)
      .join('\n');
  });
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<feed xmlns="http://www.w3.org/2005/Atom" xml:lang="${escapeHtml(lang)}">`,
    `  <title>${escapeHtml(title)}</title>`,
    `  <subtitle>${escapeHtml(subtitle)}</subtitle>`,
    `  <link rel="self" type="application/atom+xml" href="${escapeHtml(self)}"/>`,
    `  <link rel="alternate" type="text/html" href="${escapeHtml(home)}"/>`,
    `  <id>${escapeHtml(self)}</id>`,
    `  <updated>${timestamp(entries[0].updated)}</updated>`,
    site.author
      ? `  <author><name>${escapeHtml(site.author.name)}</name><uri>${escapeHtml(site.author.url)}</uri></author>`
      : `  <author><name>${escapeHtml(title)}</name></author>`,
    ...(site.author && site.copyrightYear ? [`  <rights>© ${site.copyrightYear} ${escapeHtml(site.author.name)}</rights>`] : []),
    ...items,
    '</feed>',
    '',
  ].join('\n');
}

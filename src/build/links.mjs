// @ts-check
// SPDX-FileCopyrightText: 2026 Shota Mtvarelishvili <mtvarelishvili@proton.me>
// SPDX-License-Identifier: MIT
/**
 * @file Validates Markdown link targets and turns language-neutral internal links into localised hrefs.
 * @author Shota Mtvarelishvili <mtvarelishvili@proton.me> (https://shoti.github.io/)
 */
import { ContentError } from './errors.mjs';
import { escapeHtml } from './html.mjs';
import { href, localePath } from './site.mjs';

/** @typedef {import('./site.mjs').Site} Site */

/**
 * @typedef {object} InternalLink
 * @property {string} path  Language-specific path the link points to.
 * @property {string} hash  Anchor id without "#", or "" for none.
 * @property {string} file
 * @property {number} line
 */

/**
 * Validates a Markdown link target and returns its final href.
 * Internal links ("/guides/x/") are written language-neutral and point to the
 * same language as the page they appear on. Internal links and "#anchor"
 * links are recorded in `links` so the build can check that the page and the
 * anchor exist.
 * @param {Site} site
 * @param {string} lang
 * @param {string} target
 * @param {{ file: string, line: number }} at
 * @param {InternalLink[]} links
 * @param {string} route  Language-neutral route of the page containing the link (for "#anchor").
 * @returns {string}
 */
export function resolveLink(site, lang, target, at, links, route) {
  if (/^https?:\/\//.test(target)) {
    try {
      new URL(target);
    } catch {
      throw new ContentError(at.file, at.line, `Invalid URL "${target}".`);
    }
    return target;
  }
  if (target.startsWith('mailto:')) return target;
  if (target.startsWith('#')) {
    links.push({ path: localePath(site, lang, route), hash: target.slice(1), ...at });
    return target;
  }
  if (target.startsWith('/') && !target.startsWith('//')) {
    const hashIndex = target.indexOf('#');
    const path = hashIndex === -1 ? target : target.slice(0, hashIndex);
    const hash = hashIndex === -1 ? '' : target.slice(hashIndex);
    if (!path.endsWith('/')) {
      throw new ContentError(at.file, at.line, `Internal links must end with "/", e.g. "/guides/messaging/". Got "${target}".`);
    }
    const localized = localePath(site, lang, path);
    links.push({ path: localized, hash: hash.slice(1), ...at });
    return href(site, localized) + hash;
  }
  throw new ContentError(at.file, at.line, `Unsupported link "${target}". Use https://…, mailto:…, /internal/path/ or #anchor.`);
}

/**
 * Fails on links to pages that don't exist, or to anchors missing on their page.
 * @param {InternalLink[]} links
 * @param {Map<string, string>} pages  Every generated page path and its HTML.
 */
export function checkInternalLinks(links, pages) {
  for (const link of links) {
    const page = pages.get(link.path);
    if (page === undefined) {
      throw new ContentError(link.file, link.line, `Broken internal link: no page exists at "${link.path}".`);
    }
    if (link.hash && !page.includes(` id="${escapeHtml(link.hash)}"`)) {
      throw new ContentError(link.file, link.line, `Broken link: "${link.path}" has no "#${link.hash}". Check the item or heading id.`);
    }
  }
}

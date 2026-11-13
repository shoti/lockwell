// @ts-check
// SPDX-FileCopyrightText: 2026 Shota Mtvarelishvili <mtvarelishvili@proton.me>
// SPDX-License-Identifier: MIT
/**
 * @file Project paths, site configuration (content/site.json) and URL helpers.
 * @author Shota Mtvarelishvili <mtvarelishvili@proton.me> (https://shoti.github.io/)
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = fileURLToPath(new URL('../../', import.meta.url));

export const PATHS = {
  content: join(ROOT, 'content'),
  styles: join(ROOT, 'src', 'styles'),
  client: join(ROOT, 'src', 'client'),
  public: join(ROOT, 'src', 'public'),
  dist: join(ROOT, 'dist'),
};

/**
 * @typedef {object} Site
 * @property {string} origin  e.g. "https://lockwell.org"
 * @property {string} basePath  Always starts and ends with "/", e.g. "/" or "/lockwell/".
 * @property {string} repo  Public repository URL, or "" if not published yet.
 * @property {string} defaultLang
 * @property {string[]} languages  Default language first.
 * @property {Author | null} [author]  Credited in the footer, meta tags and structured data; null if not set.
 * @property {number} [copyrightYear]
 */

/**
 * @typedef {object} Author
 * @property {string} name
 * @property {string} email
 * @property {string} url  Full https:// URL.
 * @property {boolean} inFooter  Name the author in the footer; false shows the site name instead. Meta tags, structured data and the feed credit the author either way.
 */

/**
 * Loads content/site.json. `siteUrl` overrides the configured URL (used by CI
 * for preview deployments and by the dev server).
 * @param {{ siteUrl?: string, contentDir?: string }} [options]
 * @returns {Promise<Site>}
 */
export async function loadSite({ siteUrl, contentDir = PATHS.content } = {}) {
  const file = join(contentDir, 'site.json');
  /** @type {{ url?: string, repo?: string, defaultLang?: string, languages?: string[], author?: Partial<Author>, copyrightYear?: number }} */
  const config = JSON.parse(await readFile(file, 'utf8'));

  const rawUrl = siteUrl || config.url;
  if (!rawUrl) throw new Error(`No site URL. Set "url" in ${file} or the SITE_URL environment variable.`);
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error(`Invalid site URL "${rawUrl}" (from ${siteUrl ? 'SITE_URL' : file}). Use a full URL like https://lockwell.org/.`);
  }

  const languages = config.languages ?? [];
  if (!config.defaultLang || languages[0] !== config.defaultLang) {
    throw new Error(`${file}: "languages" must list the default language ("defaultLang") first.`);
  }

  const repo = (config.repo ?? '').replace(/\/+$/, '');
  if (repo !== '' && !/^https:\/\/[^\s/]+\/\S+$/.test(repo)) {
    throw new Error(`${file}: "repo" must be a full https:// URL (e.g. https://github.com/<user>/lockwell) or "", got "${repo}".`);
  }

  const author = parseAuthor(config.author, file);
  const thisYear = new Date().getFullYear();
  const copyrightYear = config.copyrightYear ?? thisYear;
  if (!Number.isInteger(copyrightYear) || copyrightYear < 2000 || copyrightYear > thisYear + 1) {
    throw new Error(`${file}: "copyrightYear" must be a year such as 2026, got "${config.copyrightYear}".`);
  }

  return {
    origin: url.origin,
    basePath: url.pathname.endsWith('/') ? url.pathname : `${url.pathname}/`,
    repo,
    defaultLang: config.defaultLang,
    languages,
    author,
    copyrightYear,
  };
}

/**
 * Validates the optional "author" block of site.json.
 * @param {Partial<Author> | undefined} value
 * @param {string} file
 * @returns {Author | null}
 */
function parseAuthor(value, file) {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${file}: "author" must be an object with "name", "email" and "url".`);
  }
  const { name, email, url, inFooter = true } = value;
  if (typeof inFooter !== 'boolean') throw new Error(`${file}: "author.inFooter" must be true or false, got "${inFooter}".`);
  if (typeof name !== 'string' || !name.trim()) throw new Error(`${file}: "author.name" must be a non-empty string.`);
  if (typeof email !== 'string' || !/^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/.test(email)) {
    throw new Error(`${file}: "author.email" must be a plain email address, got "${email}".`);
  }
  let parsed;
  try {
    parsed = new URL(typeof url === 'string' ? url : '');
  } catch {
    parsed = null;
  }
  if (!parsed || parsed.protocol !== 'https:') {
    throw new Error(`${file}: "author.url" must be a full https:// URL such as https://example.org/, got "${url}".`);
  }
  return { name: name.trim(), email, url: parsed.href, inFooter };
}

/**
 * Language-specific path for a route. The default language lives at the root.
 *   localePath(site, 'ka', '/guides/') → '/guides/'
 *   localePath(site, 'en', '/guides/') → '/en/guides/'
 * @param {Site} site
 * @param {string} lang
 * @param {string} route  Starts and ends with "/".
 */
export function localePath(site, lang, route) {
  return lang === site.defaultLang ? route : `/${lang}${route}`;
}

/**
 * URL path including the base path, for href/src attributes.
 * @param {Site} site
 * @param {string} path  Starts with "/".
 */
export function href(site, path) {
  return site.basePath.slice(0, -1) + path;
}

/**
 * Absolute URL, for canonical links, sitemap and social tags.
 * @param {Site} site
 * @param {string} path  Starts with "/".
 */
export function absoluteUrl(site, path) {
  return site.origin + href(site, path);
}

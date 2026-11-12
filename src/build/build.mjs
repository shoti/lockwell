// @ts-check
// SPDX-FileCopyrightText: 2026 Shota Mtvarelishvili <mtvarelishvili@proton.me>
// SPDX-License-Identifier: MIT
/**
 * @file Build entry point: renders content/ and src/ into dist/ through a temp folder that replaces dist/ only on success.
 * @author Shota Mtvarelishvili <mtvarelishvili@proton.me> (https://shoti.github.io/)
 */
/**
 * Builds the static site: content/ + src/ → dist/.
 * Usage: node src/build/build.mjs   (env: SITE_URL to override content/site.json "url")
 *
 * The site is built in a temporary folder and swapped in only when every step
 * succeeds, so a content error never leaves dist/ half-written or empty.
 */
import { mkdir, mkdtemp, rename, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { headersFile, writeAssets } from './assets.mjs';
import { loadContent } from './content.mjs';
import { ContentError } from './errors.mjs';
import { atomFeed, feedEntries, feedPath } from './feed.mjs';
import { createTranslator } from './i18n.mjs';
import { checkInternalLinks, resolveLink } from './links.mjs';
import { collectRoutes } from './routes.mjs';
import { alternatesFor, robotsTxt, sitemapXml } from './seo.mjs';
import { PATHS, href, loadSite, localePath } from './site.mjs';
import { layout } from './templates/layout.mjs';
import { notFoundPage } from './templates/not-found.mjs';

/** @typedef {import('./site.mjs').Site} Site */
/** @typedef {import('./content.mjs').Content} Content */
/** @typedef {import('./templates/layout.mjs').Assets} Assets */
/** @typedef {import('./templates/layout.mjs').Ctx} Ctx */
/** @typedef {import('./links.mjs').InternalLink} InternalLink */
/** @typedef {import('./seo.mjs').SitemapEntry} SitemapEntry */

/**
 * @typedef {object} BuildOptions
 * @property {string} [outDir]  Defaults to dist/.
 * @property {string} [siteUrl]  Overrides content/site.json "url".
 * @property {string} [contentDir]  Defaults to content/ (tests use a copy).
 * @property {Date} [now]  "Today", for the review-date check.
 */

/**
 * @typedef {object} BuildResult
 * @property {number} pages
 * @property {string[]} warnings
 * @property {string} outDir
 */

/**
 * @param {BuildOptions} [options]
 * @returns {Promise<BuildResult>}
 */
export async function build({ outDir = PATHS.dist, siteUrl, contentDir = PATHS.content, now } = {}) {
  const site = await loadSite({ siteUrl, contentDir });
  const content = await loadContent(site, { contentDir, now });

  const parent = dirname(resolve(outDir));
  await mkdir(parent, { recursive: true });
  const tempDir = await mkdtemp(join(parent, `.${basename(outDir)}-build-`));
  try {
    const pages = await renderSite(tempDir, site, content);
    await swapIn(tempDir, outDir);
    return { pages, warnings: [...content.warnings, ...siteWarnings(site)], outDir };
  } catch (error) {
    await rm(tempDir, { recursive: true, force: true });
    throw error;
  }
}

/**
 * Replaces `outDir` with `newDir`. The old folder is moved aside first and
 * deleted afterwards, so `outDir` is missing only between two renames (the
 * dev server would otherwise answer 404 while a large folder is deleted).
 * @param {string} newDir
 * @param {string} outDir
 */
async function swapIn(newDir, outDir) {
  const old = `${newDir}-old`;
  let moved = true;
  try {
    await rename(outDir, old);
  } catch (error) {
    if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
    moved = false;
  }
  try {
    await rename(newDir, outDir);
  } catch (error) {
    if (moved) await rename(old, outDir);
    throw error;
  }
  if (moved) await rm(old, { recursive: true, force: true });
}

/**
 * @param {Site} site
 * @returns {string[]}
 */
function siteWarnings(site) {
  if (site.basePath === '/') return [];
  return [
    `The site lives under ${site.basePath}, so search engines ignore its robots.txt (they only read /robots.txt at the domain root) and won't find the sitemap from it. Submit ${site.basePath}sitemap.xml in Google Search Console, or use a custom domain.`,
  ];
}

/**
 * Writes the whole site into `dir`.
 * @param {string} dir
 * @param {Site} site
 * @param {Content} content
 * @returns {Promise<number>}  Number of HTML pages written.
 */
async function renderSite(dir, site, content) {
  const assets = await writeAssets(dir, site);
  const routes = collectRoutes(site, content);

  /** @type {InternalLink[]} */
  const links = [];
  /** @type {Map<string, string>} */
  const pages = new Map();
  /** @type {SitemapEntry[]} */
  const sitemap = [];

  for (const lang of site.languages) {
    const ctx = createContext(site, lang, content, assets, links);
    for (const { route, available, render } of routes.filter((r) => r.available(lang))) {
      const page = render(ctx);
      const alternates = alternatesFor(site, route, available);
      const path = localePath(site, lang, route);
      pages.set(path, layout(ctx, { ...page, route, alternates }).toString());
      if (!page.noindex) sitemap.push({ path, alternates, lastmod: page.lastmod });
    }
  }

  checkInternalLinks(links, pages);

  for (const lang of site.languages) {
    const entries = feedEntries(content, lang);
    if (entries.length === 0) continue;
    const t = createTranslator(content.strings[lang], lang);
    const file = join(dir, feedPath(site, lang));
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, atomFeed(site, { lang, title: t('siteName'), subtitle: t('siteTagline'), entries }));
  }

  for (const [path, doc] of pages) {
    const file = join(dir, path, 'index.html');
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, doc);
  }

  const defaultCtx = createContext(site, site.defaultLang, content, assets, links);
  const notFound = notFoundPage(defaultCtx);
  const notFoundDoc = layout(defaultCtx, { ...notFound, route: '/404/', noindex: true, alternates: [{ lang: site.defaultLang, path: '/404/' }] });
  await writeFile(join(dir, '404.html'), notFoundDoc.toString());

  await writeFile(join(dir, 'sitemap.xml'), sitemapXml(site, sitemap));
  await writeFile(join(dir, 'robots.txt'), robotsTxt(site));
  await writeFile(join(dir, '_headers'), headersFile(assets.csp));
  await writeFile(join(dir, '.nojekyll'), '');

  return pages.size + 1;
}

/**
 * @param {Site} site
 * @param {string} lang
 * @param {Content} content
 * @param {Assets} assets
 * @param {InternalLink[]} links  Collects internal links for checking.
 * @returns {Ctx}
 */
function createContext(site, lang, content, assets, links) {
  /** @type {Record<string, import('./i18n.mjs').Translate>} */
  const translators = Object.fromEntries(site.languages.map((l) => [l, createTranslator(content.strings[l], l)]));
  const t = translators[lang];
  return {
    site,
    lang,
    t,
    tFor: (other) => translators[other],
    content,
    assets,
    url: (route) => href(site, localePath(site, lang, route)),
    feed: feedEntries(content, lang).length > 0 ? href(site, feedPath(site, lang)) : null,
    markdown: (file, route) => ({
      file,
      calloutLabel: (kind) => t(`callout.${kind}`),
      resolveLink: (target, line) => resolveLink(site, lang, target, { file, line }, links, route),
    }),
  };
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isMain) {
  const started = performance.now();
  try {
    const result = await build({ siteUrl: process.env.SITE_URL });
    for (const warning of result.warnings) console.warn(`⚠ ${warning}`);
    console.log(`✓ Built ${result.pages} pages into ${result.outDir} in ${Math.round(performance.now() - started)} ms`);
  } catch (error) {
    console.error(`✗ Build failed: ${error instanceof Error ? error.message : error}`);
    if (!(error instanceof ContentError) && error instanceof Error) console.error(error.stack);
    process.exitCode = 1;
  }
}

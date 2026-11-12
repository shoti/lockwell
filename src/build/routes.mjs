// @ts-check
// SPDX-FileCopyrightText: 2026 Shota Mtvarelishvili <mtvarelishvili@proton.me>
// SPDX-License-Identifier: MIT
/**
 * @file The list of language-neutral routes and the template that renders each.
 * @author Shota Mtvarelishvili <mtvarelishvili@proton.me> (https://shoti.github.io/)
 */
/**
 * The list of language-neutral routes and how to render each one.
 * Adding a new kind of page means adding entries here; build.mjs stays the same.
 */
import { articlePage } from './templates/article.mjs';
import { articlesIndexPage } from './templates/articles-index.mjs';
import { contentPage } from './templates/page.mjs';
import { guidePage } from './templates/guide.mjs';
import { guidesIndexPage } from './templates/guides-index.mjs';
import { homePage } from './templates/home.mjs';
import { searchPage } from './templates/search.mjs';
import { toolPage } from './templates/tool.mjs';
import { toolsIndexPage } from './templates/tools-index.mjs';
import { TOOLS, toolRoute } from './tools.mjs';

/** @typedef {import('./content.mjs').Content} Content */
/** @typedef {import('./site.mjs').Site} Site */
/** @typedef {import('./templates/layout.mjs').Ctx} Ctx */
/** @typedef {import('./templates/layout.mjs').PageContent} PageContent */

/**
 * @typedef {object} Route
 * @property {string} route  e.g. "/guides/messaging/"
 * @property {(lang: string) => boolean} available  Whether this language has the page.
 * @property {(ctx: Ctx) => PageContent} render  Called only for available languages.
 */

/**
 * @template T
 * @param {T | undefined} value
 * @param {string} what
 * @returns {T}
 */
function required(value, what) {
  if (value === undefined) throw new Error(`Route rendered for a language without ${what}; this is a build bug.`);
  return value;
}

/**
 * @param {Site} site
 * @param {Content} content
 * @returns {Route[]}
 */
export function collectRoutes(site, content) {
  /** @type {Route[]} */
  const routes = [];
  /** @param {string} slug */
  const findPage = (slug) => (/** @type {string} */ lang) => content.pages[lang].find((p) => p.slug === slug);
  /** @param {string} slug */
  const findGuide = (slug) => (/** @type {string} */ lang) => content.guides[lang].find((g) => g.slug === slug);
  /** @param {string} slug */
  const findArticle = (slug) => (/** @type {string} */ lang) => content.articles[lang].find((a) => a.slug === slug);

  const home = findPage('home');
  routes.push({
    route: '/',
    available: (lang) => Boolean(home(lang)),
    render: (ctx) => homePage(ctx, required(home(ctx.lang), 'a home page')),
  });

  routes.push({ route: '/guides/', available: () => true, render: guidesIndexPage });

  for (const slug of unique(site.languages.flatMap((lang) => content.guides[lang].map((g) => g.slug)))) {
    const guide = findGuide(slug);
    routes.push({
      route: `/guides/${slug}/`,
      available: (lang) => Boolean(guide(lang)),
      render: (ctx) => guidePage(ctx, required(guide(ctx.lang), `guide "${slug}"`)),
    });
  }

  // A language gets the articles section only once it has an article.
  routes.push({ route: '/articles/', available: (lang) => content.articles[lang].length > 0, render: articlesIndexPage });

  for (const slug of unique(site.languages.flatMap((lang) => content.articles[lang].map((a) => a.slug)))) {
    const article = findArticle(slug);
    routes.push({
      route: `/articles/${slug}/`,
      available: (lang) => Boolean(article(lang)),
      render: (ctx) => articlePage(ctx, required(article(ctx.lang), `article "${slug}"`)),
    });
  }

  routes.push({ route: '/tools/', available: () => true, render: toolsIndexPage });
  for (const tool of TOOLS) {
    routes.push({ route: toolRoute(tool), available: () => true, render: (ctx) => toolPage(ctx, tool) });
  }

  routes.push({ route: '/search/', available: () => true, render: searchPage });

  const pageSlugs = site.languages.flatMap((lang) => content.pages[lang].map((p) => p.slug));
  for (const slug of unique(pageSlugs).filter((s) => s !== 'home')) {
    const page = findPage(slug);
    routes.push({
      route: `/${slug}/`,
      available: (lang) => Boolean(page(lang)),
      render: (ctx) => contentPage(ctx, required(page(ctx.lang), `page "${slug}"`)),
    });
  }

  return routes;
}

/**
 * @param {string[]} values
 * @returns {string[]}
 */
function unique(values) {
  return [...new Set(values)];
}

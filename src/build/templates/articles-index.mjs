// @ts-check
/**
 * @file Template for the articles list page.
 */
import { html } from '../html.mjs';
import { breadcrumbJsonLd } from '../seo.mjs';
import { localePath } from '../site.mjs';
import { articleCard, breadcrumbs } from './components.mjs';

/** @typedef {import('./layout.mjs').Ctx} Ctx */

/**
 * Every article in this language, newest first. The list starts right
 * after the breadcrumb; the title is there for screen readers and search only.
 * @param {Ctx} ctx
 * @returns {import('./layout.mjs').PageContent}
 */
export function articlesIndexPage(ctx) {
  const { site, lang, t, content } = ctx;
  const title = t('articles.title');

  const body = html`<div class="container page">
  ${breadcrumbs(ctx, [{ name: t('nav.home'), route: '/' }, { name: title }])}
  <h1 class="visually-hidden">${title}</h1>
  <div class="card-grid">
    ${content.articles[lang].map((article) => articleCard(ctx, article, 2))}
  </div>
</div>`;

  return {
    title: `${title} — ${t('siteName')}`,
    description: t('articles.description'),
    body,
    jsonLd: [
      breadcrumbJsonLd(site, [
        { name: t('nav.home'), path: localePath(site, lang, '/') },
        { name: title, path: localePath(site, lang, '/articles/') },
      ]),
    ],
  };
}

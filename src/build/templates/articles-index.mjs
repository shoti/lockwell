// @ts-check
// SPDX-FileCopyrightText: 2026 Shota Mtvarelishvili <mtvarelishvili@proton.me>
// SPDX-License-Identifier: MIT
/**
 * @file Template for the articles list page.
 * @author Shota Mtvarelishvili <mtvarelishvili@proton.me> (https://shoti.github.io/)
 */
import { html } from '../html.mjs';
import { breadcrumbJsonLd } from '../seo.mjs';
import { localePath } from '../site.mjs';
import { articleCard, breadcrumbs } from './components.mjs';

/** @typedef {import('./layout.mjs').Ctx} Ctx */

/**
 * Every article in this language, newest first.
 * @param {Ctx} ctx
 * @returns {import('./layout.mjs').PageContent}
 */
export function articlesIndexPage(ctx) {
  const { site, lang, t, content } = ctx;
  const title = t('articles.title');

  const body = html`<div class="container page">
  ${breadcrumbs(ctx, [{ name: t('nav.home'), route: '/' }, { name: title }])}
  <header class="page-header">
    <h1 class="page-header__title">${title}</h1>
    <p class="lead">${t('articles.lead')}</p>
  </header>
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

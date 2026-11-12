// @ts-check
// SPDX-FileCopyrightText: 2026 Shota Mtvarelishvili <mtvarelishvili@proton.me>
// SPDX-License-Identifier: MIT
/**
 * @file Template for a single article page.
 * @author Shota Mtvarelishvili <mtvarelishvili@proton.me> (https://shoti.github.io/)
 */
import { html } from '../html.mjs';
import { formatDate } from '../i18n.mjs';
import { renderBlocks } from '../markdown.mjs';
import { articleJsonLd, breadcrumbJsonLd } from '../seo.mjs';
import { localePath } from '../site.mjs';
import { breadcrumbs, contentFooter, draftNotice, printButton } from './components.mjs';
import { icons } from './icons.mjs';

/** @typedef {import('./layout.mjs').Ctx} Ctx */
/** @typedef {import('../content.mjs').Article} Article */

/**
 * A long-form article: a header, the text, and a link to the next (older) article.
 * @param {Ctx} ctx
 * @param {Article} article
 * @returns {import('./layout.mjs').PageContent}
 */
export function articlePage(ctx, article) {
  const { site, lang, t, content } = ctx;
  const articles = content.articles[lang];
  const next = articles[articles.indexOf(article) + 1];
  const dateLocale = t('dateLocale');

  const body = html`<div class="container page">
  ${breadcrumbs(ctx, [
    { name: t('nav.home'), route: '/' },
    { name: t('nav.articles'), route: '/articles/' },
    { name: article.title },
  ])}
  <article class="article">
    <header class="page-header">
      ${article.draft ? draftNotice(ctx, 'article') : null}
      <h1 class="page-header__title">${article.title}</h1>
      <p class="lead">${article.summary}</p>
      <ul class="meta" role="list">
        <li>${icons.calendar}<span>${t('article.published')} <time datetime="${article.published}">${formatDate(article.published, dateLocale)}</time></span></li>
        ${article.updated
          ? html`<li><span>${t('article.updated')} <time datetime="${article.updated}">${formatDate(article.updated, dateLocale)}</time></span></li>`
          : null}
        <li>${icons.clock}<span>${t('article.readingTime', { n: article.minutes })}</span></li>
        ${printButton(ctx)}
      </ul>
    </header>
    <div class="prose prose--article">${renderBlocks(article.body, ctx.markdown(article.file, article.route))}</div>
    ${contentFooter(ctx, article, next ? { label: t('article.next'), title: next.title, route: next.route } : null)}
  </article>
</div>`;

  const path = localePath(site, lang, article.route);
  const modified = article.updated ?? article.published;
  return {
    title: `${article.title} — ${t('siteName')}`,
    description: article.description,
    body,
    noindex: article.draft,
    ogType: 'article',
    lastmod: modified,
    jsonLd: [
      articleJsonLd(site, {
        title: article.title,
        description: article.description,
        lang,
        path,
        siteName: t('siteName'),
        published: article.published,
        modified,
      }),
      breadcrumbJsonLd(site, [
        { name: t('nav.home'), path: localePath(site, lang, '/') },
        { name: t('nav.articles'), path: localePath(site, lang, '/articles/') },
        { name: article.title, path },
      ]),
    ],
  };
}

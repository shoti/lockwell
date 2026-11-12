// @ts-check
// SPDX-FileCopyrightText: 2026 Shota Mtvarelishvili <mtvarelishvili@proton.me>
// SPDX-License-Identifier: MIT
/**
 * @file Template for the 404 page.
 * @author Shota Mtvarelishvili <mtvarelishvili@proton.me> (https://shoti.github.io/)
 */
import { html } from '../html.mjs';
import { href, localePath } from '../site.mjs';

/** @typedef {import('./layout.mjs').Ctx} Ctx */

/**
 * GitHub Pages serves a single /404.html for every language, so the page
 * offers a way home in each language.
 * @param {Ctx} ctx
 */
export function notFoundPage(ctx) {
  const { site, t } = ctx;
  const body = html`<div class="container page not-found">
  <p class="not-found__code" aria-hidden="true">404</p>
  ${site.languages.map((lang) => {
    const tLang = ctx.tFor(lang);
    const primary = lang === ctx.lang;
    return html`<section class="not-found__lang" lang="${lang}">
    ${primary ? html`<h1 class="page-header__title">${tLang('notFound.title')}</h1>` : html`<h2 class="not-found__alt-title">${tLang('notFound.title')}</h2>`}
    <p>${tLang('notFound.text')}</p>
    <p><a class="button${primary ? '' : ' button--ghost'}" href="${href(site, localePath(site, lang, '/'))}">${tLang('notFound.back')}</a></p>
  </section>`;
  })}
</div>`;

  return {
    title: `${t('notFound.title')} — ${t('siteName')}`,
    description: t('notFound.text'),
    body,
  };
}

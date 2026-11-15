// @ts-check
/**
 * @file Template for the search page, a complete list that client JS filters.
 */
import { html } from '../html.mjs';
import { compactSearchText, searchEntries } from '../search.mjs';
import { breadcrumbs } from './components.mjs';

/** @typedef {import('./layout.mjs').Ctx} Ctx */

/**
 * The search page. Without JavaScript it is a list of everything on the site;
 * with it, the list narrows as the visitor types (src/client/search.mjs).
 * @param {Ctx} ctx
 * @returns {import('./layout.mjs').PageContent}
 */
export function searchPage(ctx) {
  const { lang, t, url, content } = ctx;
  const title = t('search.title');

  const body = html`<div class="container page">
  ${breadcrumbs(ctx, [{ name: t('nav.home'), route: '/' }, { name: title }])}
  <header class="page-header">
    <h1 class="page-header__title">${title}</h1>
    <p class="lead">${t('search.lead')}</p>
  </header>
  <div class="search js-only" role="search">
    <label class="search__label" for="search__input">${t('search.label')}</label>
    <input class="search__input" id="search__input" type="search" autocomplete="off" autocapitalize="off" spellcheck="false" enterkeyhint="search" data-js="search-input">
    <p class="search__hint">${t('search.hint')} <a href="${ctx.url('/privacy/#requests')}">${t('footer.privacyDetails')}</a></p>
  </div>
  <p class="search__status js-only" role="status" data-js="search-status" data-template="${t('search.results')}"></p>
  <h2 class="visually-hidden">${t('search.all')}</h2>
  <ul class="search-results" role="list" data-js="search-results">
    ${searchEntries(content, lang, t).map(
      (entry) => html`<li class="search-result" data-js="search-entry" data-title="${entry.title.toLowerCase()}" data-text="${compactSearchText(entry.text.toLowerCase(), entry.title.toLowerCase())}">
      <p class="search-result__kind">${t(`search.kind.${entry.kind}`)}${entry.context ? html` · ${entry.context}` : null}</p>
      <a class="search-result__link" href="${url(entry.route)}${entry.hash ? `#${entry.hash}` : ''}">${entry.title}</a>
      ${entry.summary ? html`<p class="search-result__summary">${entry.summary}</p>` : null}
    </li>`,
    )}
  </ul>
  <p class="search__empty" data-js="search-empty" hidden>${t('search.none')}</p>
</div>`;

  return {
    title: `${title} — ${t('siteName')}`,
    description: t('search.description'),
    body,
    // A list of links to pages that are indexed themselves.
    noindex: true,
  };
}

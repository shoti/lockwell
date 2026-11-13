// @ts-check
/**
 * @file Template for the tools list page.
 */
import { html } from '../html.mjs';
import { breadcrumbJsonLd } from '../seo.mjs';
import { localePath } from '../site.mjs';
import { TOOLS } from '../tools.mjs';
import { breadcrumbs, toolCard } from './components.mjs';

/** @typedef {import('./layout.mjs').Ctx} Ctx */

/**
 * @param {Ctx} ctx
 * @returns {import('./layout.mjs').PageContent}
 */
export function toolsIndexPage(ctx) {
  const { site, lang, t } = ctx;
  const title = t('tools.title');

  const body = html`<div class="container page">
  ${breadcrumbs(ctx, [{ name: t('nav.home'), route: '/' }, { name: title }])}
  <header class="page-header">
    <h1 class="page-header__title">${title}</h1>
    <p class="lead">${t('tools.lead')}</p>
  </header>
  <div class="card-grid">
    ${TOOLS.map((tool) => toolCard(ctx, tool, 2))}
  </div>
</div>`;

  return {
    title: `${title} — ${t('siteName')}`,
    description: t('tools.description'),
    body,
    jsonLd: [
      breadcrumbJsonLd(site, [
        { name: t('nav.home'), path: localePath(site, lang, '/') },
        { name: title, path: localePath(site, lang, '/tools/') },
      ]),
    ],
  };
}

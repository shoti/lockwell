// @ts-check
/**
 * @file Template for the tools list page.
 */
import { html } from '../html.mjs';
import { breadcrumbJsonLd } from '../seo.mjs';
import { localePath } from '../site.mjs';
import { TOOLS, TOOL_GROUPS } from '../tools.mjs';
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
  ${TOOL_GROUPS.map(
    (group) => html`<section class="tool-group" aria-labelledby="tools__${group.key}">
    <h2 class="tool-group__title" id="tools__${group.key}">${t(`tools.groups.${group.key}`)}</h2>
    <div class="card-grid">
      ${group.tools.map((key) => toolCard(ctx, /** @type {import('../tools.mjs').Tool} */ (TOOLS.find((tool) => tool.key === key)), 3))}
    </div>
  </section>`,
  )}
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

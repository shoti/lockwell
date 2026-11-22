// @ts-check
/**
 * @file Template for a single tool page.
 */
import { html } from '../html.mjs';
import { breadcrumbJsonLd } from '../seo.mjs';
import { absoluteUrl, localePath } from '../site.mjs';
import { toolRoute } from '../tools.mjs';
import { breadcrumbs } from './components.mjs';
import { icons } from './icons.mjs';
import { INTROS, PANELS } from './tool-panels.mjs';

/** @typedef {import('./layout.mjs').Ctx} Ctx */
/** @typedef {import('../tools.mjs').Tool} Tool */

/**
 * One tool: what it does, the tool itself (needs JavaScript) and a few plain
 * paragraphs on how it works and what its limits are. Without JavaScript the
 * page says so and still explains the tool.
 * @param {Ctx} ctx
 * @param {Tool} tool
 * @returns {import('./layout.mjs').PageContent}
 */
export function toolPage(ctx, tool) {
  const { site, lang, t } = ctx;
  const name = t(`tools.items.${tool.key}.title`);
  const description = t(`tools.items.${tool.key}.description`);
  const path = localePath(site, lang, toolRoute(tool));
  // Guides whose text links to this tool, so the page can point back to them.
  const guides = ctx.content.guides[lang].filter((guide) => JSON.stringify([guide.intro, guide.items]).includes(`](${toolRoute(tool)}`));

  const body = html`<div class="container page">
  ${breadcrumbs(ctx, [{ name: t('nav.home'), route: '/' }, { name: t('nav.tools'), route: '/tools/' }, { name }])}
  <div class="tool-page${tool.wide ? ' tool-page--wide' : ''}">
    <header class="page-header">
      <h1 class="page-header__title">${name}</h1>
      <p class="lead">${t(`tools.items.${tool.key}.summary`)}</p>
    </header>
    ${INTROS[tool.key]?.(ctx) ?? null}
    <p class="draft-notice no-js-only" data-js="tool-fallback">${icons.alert}<span>${t('tools.needsJs')}</span></p>
    <section class="tool js-only" data-js="tool" data-tool="${tool.key}" aria-label="${name}">
      ${PANELS[tool.key](ctx)}
      <p class="tool__local">${icons.eyeOff}<span>${t(tool.requests ? `tools.items.${tool.key}.local` : 'tools.local')} <a href="${ctx.url('/privacy/#requests')}">${t('footer.privacyDetails')}</a></span></p>
    </section>
    ${guides.length
      ? html`<section class="tool-guides" aria-labelledby="tool__guides">
      <h2 class="tool-guides__title" id="tool__guides">${t('tools.guidesHeading')}</h2>
      <ul class="tool-guides__list">
        ${guides.map((guide) => html`<li><a href="${ctx.url(guide.route)}">${guide.title}</a></li>`)}
      </ul>
    </section>`
      : null}
    <section class="prose prose--article tool-notes" aria-labelledby="tool__notes">
      <h2 id="tool__notes">${t('tools.notesHeading')}</h2>
      ${Array.from({ length: tool.notes }, (_, i) => html`<p>${t(`tools.items.${tool.key}.note${i + 1}`)}</p>`)}
      ${tool.ai
        ? html`<h2 id="tool__ai">${t('tools.aiHeading')}</h2>
      ${Array.from({ length: tool.ai }, (_, i) => html`<p>${t(`tools.items.${tool.key}.ai${i + 1}`)}</p>`)}`
        : null}
    </section>
  </div>
</div>`;

  return {
    title: `${name} — ${t('siteName')}`,
    description,
    body,
    ...(tool.requests ? { connect: /** @type {const} */ ('self') } : {}),
    jsonLd: [
      {
        '@context': 'https://schema.org',
        '@type': 'WebApplication',
        name,
        description,
        url: absoluteUrl(site, path),
        inLanguage: lang,
        applicationCategory: 'SecurityApplication',
        operatingSystem: 'Any',
        offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
      },
      breadcrumbJsonLd(site, [
        { name: t('nav.home'), path: localePath(site, lang, '/') },
        { name: t('nav.tools'), path: localePath(site, lang, '/tools/') },
        { name, path },
      ]),
    ],
  };
}

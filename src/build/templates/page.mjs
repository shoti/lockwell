// @ts-check
/**
 * @file Template for plain content pages such as About.
 */
import { html } from '../html.mjs';
import { renderBlocks } from '../markdown.mjs';
import { breadcrumbJsonLd } from '../seo.mjs';
import { localePath } from '../site.mjs';
import { breadcrumbs } from './components.mjs';

/** @typedef {import('./layout.mjs').Ctx} Ctx */

/**
 * A plain content page such as "About".
 * @param {Ctx} ctx
 * @param {import('../content.mjs').Page} page
 */
export function contentPage(ctx, page) {
  const { site, lang, t } = ctx;
  const heading = page.heading ?? page.title;

  const body = html`<div class="container page">
  ${breadcrumbs(ctx, [{ name: t('nav.home'), route: '/' }, { name: heading }])}
  <article class="prose prose--page">
    <h1>${heading}</h1>
    ${renderBlocks(page.body, ctx.markdown(page.file, page.route))}
  </article>
</div>`;

  return {
    // Don't repeat the site name when the title already contains it ("About Lockwell …").
    title: page.title.includes(t('siteName')) ? page.title : `${page.title} — ${t('siteName')}`,
    description: page.description,
    body,
    jsonLd: [
      breadcrumbJsonLd(site, [
        { name: t('nav.home'), path: localePath(site, lang, '/') },
        { name: heading, path: localePath(site, lang, page.route) },
      ]),
    ],
  };
}

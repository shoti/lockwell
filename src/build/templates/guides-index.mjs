// @ts-check
/**
 * @file Template for the guides list page, grouped by audience track.
 */
import { html } from '../html.mjs';
import { breadcrumbJsonLd } from '../seo.mjs';
import { localePath } from '../site.mjs';
import { icons } from './icons.mjs';
import { breadcrumbs, continueLink, guideCard, guideTracks } from './components.mjs';

/** @typedef {import('./layout.mjs').Ctx} Ctx */

/**
 * "New here? Start with: <first guide> · 60 min". It shares the line of the
 * "Continue" link and shows only while that one doesn't (see 05-components.css),
 * so the line is never empty and never moves. Plain HTML: it works without JS.
 * @param {Ctx} ctx
 * @param {import('../content.mjs').Guide} guide  The first guide of the first track.
 */
function startLink(ctx, guide) {
  const { t, url } = ctx;
  return html`<a class="continue continue--start" href="${url(guide.route)}"><span>${t('guides.startWith')}</span> <span class="continue__title">${guide.title}</span> <span class="continue__count">${t('guide.minutes', { n: guide.time })}</span>${icons.arrowRight}</a>`;
}

/**
 * The guides list: every guide by track and topic group, as a grid of cards
 * like the home page and the tools list.
 * @param {Ctx} ctx
 */
export function guidesIndexPage(ctx) {
  const { site, lang, t } = ctx;
  const title = t('guides.title');
  const tracks = guideTracks(ctx);

  const body = html`<div class="container page">
  <div class="guide-layout guide-layout--index">
    <div class="guide-head">
  ${breadcrumbs(ctx, [{ name: t('nav.home'), route: '/' }, { name: title }])}
  <header class="page-header guides-header">
    <h1 class="page-header__title">${title}</h1>
    <p class="lead">${t('guides.lead')}</p>
    ${tracks.length ? html`<p class="page-header__continue page-header__continue--start">${continueLink(ctx)}${startLink(ctx, tracks[0].guides[0])}</p>` : null}
    ${tracks.length > 1
      ? html`<nav class="track-nav" aria-label="${t('guides.tracksLabel')}">
      <ul role="list">
        ${tracks.map(
          (track) => html`<li><a class="track-nav__link" href="#${track.audience}">${track.title} <span class="track-nav__count" aria-hidden="true">${track.guides.length}</span><span class="visually-hidden">${t('guides.trackCount', { n: track.guides.length })}</span></a></li>`,
        )}
      </ul>
    </nav>`
      : null}
  </header>
    </div>
    <div class="guide-main">
      ${tracks.map(
        (track) => html`<section class="guide-group" id="${track.audience}" aria-labelledby="${track.audience}__title">
        <h2 class="section__title" id="${track.audience}__title">${track.title}</h2>
        <p class="guide-group__lead">${track.lead}</p>
        ${track.groups.map(
          (group) => html`<h3 class="guide-group__topic" id="group-${group.key}">${group.title}</h3>
        <div class="card-grid card-grid--three">
          ${group.guides.map((guide) => guideCard(ctx, guide, 4))}
        </div>`,
        )}
      </section>`,
      )}
    </div>
  </div>
</div>`;

  return {
    title: `${title} — ${t('siteName')}`,
    description: t('guides.description'),
    body,
    jsonLd: [
      breadcrumbJsonLd(site, [
        { name: t('nav.home'), path: localePath(site, lang, '/') },
        { name: title, path: localePath(site, lang, '/guides/') },
      ]),
    ],
  };
}

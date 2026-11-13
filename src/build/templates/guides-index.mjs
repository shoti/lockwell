// @ts-check
/**
 * @file Template for the guides list page, grouped by audience track.
 */
import { html } from '../html.mjs';
import { breadcrumbJsonLd } from '../seo.mjs';
import { localePath } from '../site.mjs';
import { breadcrumbs, continueLink, guideNav, guideRow, guideTracks } from './components.mjs';

/** @typedef {import('./layout.mjs').Ctx} Ctx */

/**
 * The guides list: every guide by track and topic group, with a sidebar that
 * shows the same structure at a glance.
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
    <p class="page-header__continue js-only">${continueLink(ctx)}</p>
    ${tracks.length > 1
      ? html`<nav class="track-nav" aria-label="${t('guides.tracksLabel')}">
      <ul role="list">
        ${tracks.map(
          (track) => html`<li><a class="track-nav__link" href="#${track.audience}">${track.title}<span class="track-nav__count">${track.guides.length}</span></a></li>`,
        )}
      </ul>
    </nav>`
      : null}
  </header>
    </div>
    <aside class="guide-aside guide-aside--nav">
      <div class="guide-aside__inner" data-js="nav-scroll">
        ${guideNav(ctx)}
      </div>
    </aside>
    <div class="guide-main">
      ${tracks.map(
        (track) => html`<section class="guide-group" id="${track.audience}" aria-labelledby="${track.audience}__title">
        <h2 class="section__title" id="${track.audience}__title">${track.title}</h2>
        <p class="guide-group__lead">${track.lead}</p>
        ${track.groups.map(
          (group) => html`<h3 class="guide-group__topic" id="group-${group.key}">${group.title}</h3>
        <ol class="guide-list" role="list" aria-labelledby="group-${group.key}">
          ${group.guides.map((guide) => guideRow(ctx, guide))}
        </ol>`,
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

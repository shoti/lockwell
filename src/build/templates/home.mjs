// @ts-check
// SPDX-FileCopyrightText: 2026 Shota Mtvarelishvili <mtvarelishvili@proton.me>
// SPDX-License-Identifier: MIT
/**
 * @file Template for the home page.
 * @author Shota Mtvarelishvili <mtvarelishvili@proton.me> (https://shoti.github.io/)
 */
import { html } from '../html.mjs';
import { renderBlocks } from '../markdown.mjs';
import { personJsonLd } from '../seo.mjs';
import { absoluteUrl, localePath } from '../site.mjs';
import { FEATURED_TOOLS, TOOLS } from '../tools.mjs';
import { articleCard, continueLink, guideCard, toolCard } from './components.mjs';
import { START_GUIDE } from './guide.mjs';
import { icons } from './icons.mjs';

/** @typedef {import('./layout.mjs').Ctx} Ctx */
/** @typedef {import('../content.mjs').Page} Page */

/** The site's promises, shown in one line under the hero; the About page explains them. */
const PROMISES = [
  { key: 'tracking', icon: icons.eyeOff },
  { key: 'device', icon: icons.device },
  { key: 'open', icon: icons.code },
];

/** How many of the newest articles the home page shows. */
const LATEST_ARTICLES = 3;

/** How many guides of the "everyone" track the home page shows: the path to start on. */
const START_GUIDES = 3;

/** Guides linked from the hero for someone who needs help right now. */
const URGENT_GUIDES = ['hacked', 'harassment-doxxing'];

/**
 * @param {Ctx} ctx
 * @param {Page} page
 * @returns {import('./layout.mjs').PageContent}
 */
export function homePage(ctx, page) {
  const { site, lang, t, url, content } = ctx;
  const allGuides = content.guides[lang];
  const guides = allGuides.filter((guide) => guide.audience === 'everyone');
  const first = guides[0];
  const plan = allGuides.find((guide) => guide.slug === START_GUIDE && guide.audience === 'high-risk');
  const urgent = URGENT_GUIDES.flatMap((slug) => allGuides.filter((guide) => guide.slug === slug));
  const articles = content.articles[lang].slice(0, LATEST_ARTICLES);

  const body = html`<section class="hero">
  <div class="container">
    ${page.eyebrow ? html`<p class="eyebrow">${page.eyebrow}</p>` : null}
    <h1 class="hero__title">${page.heading ?? page.title}</h1>
    <div class="hero__lead prose">${renderBlocks(page.body, ctx.markdown(page.file, page.route))}</div>
    <div class="hero__actions">
      ${first ? html`<a class="button" href="${url(first.route)}">${t('home.cta')}${icons.arrowRight}</a>` : null}
      <a class="button button--ghost" href="${url('/guides/')}">${t('home.allGuides')}</a>
    </div>
    <p class="hero__continue js-only">
      ${continueLink(ctx)}
    </p>
    ${urgent.length
      ? html`<p class="hero__urgent"><span class="hero__urgent-label">${icons.alert}<span>${t('home.urgent')}</span></span>${urgent.map((guide) => html`<a href="${url(guide.route)}">${guide.title}</a>`)}</p>`
      : null}
    <ul class="hero__trust" role="list">
      ${PROMISES.map(({ key, icon }) => html`<li>${icon}<span>${t(`home.promises.${key}.title`)}</span></li>`)}
    </ul>
  </div>
</section>

<section class="section" aria-labelledby="home__guides">
  <div class="container">
    <div class="section__head">
      <h2 class="section__title" id="home__guides">${t('home.guidesHeading')}</h2>
      <a class="section__more" href="${url('/guides/')}">${t('home.allGuidesCount', { n: allGuides.length })}${icons.arrowRight}</a>
    </div>
    <div class="card-grid card-grid--three">
      ${guides.slice(0, START_GUIDES).map((guide) => guideCard(ctx, guide, 3))}
    </div>
    ${plan
      ? html`<div class="path-card">
      <div class="path-card__text">
        <h3 class="path-card__title">${t('home.highRisk.title')}</h3>
        <p>${t('home.highRisk.text')}</p>
      </div>
      <div class="path-card__actions">
        <a class="button" href="${url(plan.route)}">${t('home.highRisk.cta')}${icons.arrowRight}</a>
        <a class="section__more" href="${url('/guides/')}#high-risk">${t('home.highRiskGuides')}${icons.arrowRight}</a>
      </div>
    </div>`
      : null}
  </div>
</section>

${articles.length
    ? html`<section class="section section--follow" aria-labelledby="home__articles">
  <div class="container">
    <div class="section__head">
      <h2 class="section__title" id="home__articles">${t('home.articlesHeading')}</h2>
      <a class="section__more" href="${url('/articles/')}">${t('home.allArticles')}${icons.arrowRight}</a>
    </div>
    <div class="card-grid">
      ${articles.map((article) => articleCard(ctx, article, 3))}
    </div>
  </div>
</section>`
    : null}

<section class="section section--follow" aria-labelledby="home__tools">
  <div class="container">
    <div class="section__head">
      <h2 class="section__title" id="home__tools">${t('tools.homeHeading')}</h2>
      <a class="section__more" href="${url('/tools/')}">${t('tools.all')}${icons.arrowRight}</a>
    </div>
    <div class="card-grid card-grid--four">
      ${TOOLS.slice(0, FEATURED_TOOLS).map((tool) => toolCard(ctx, tool, 3))}
    </div>
  </div>
</section>`;

  const homeUrl = absoluteUrl(site, localePath(site, lang, '/'));
  return {
    title: page.title,
    description: page.description,
    body,
    jsonLd: [
      {
        '@context': 'https://schema.org',
        '@type': 'WebSite',
        name: t('siteName'),
        url: homeUrl,
        inLanguage: lang,
        description: page.description,
        ...(ctx.site.author
          ? { author: personJsonLd(ctx.site.author), copyrightHolder: personJsonLd(ctx.site.author), copyrightYear: ctx.site.copyrightYear }
          : {}),
      },
    ],
  };
}

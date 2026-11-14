// @ts-check
/**
 * @file Template for the home page.
 */
import { html } from '../html.mjs';
import { personJsonLd } from '../seo.mjs';
import { absoluteUrl, localePath } from '../site.mjs';
import { FEATURED_TOOLS, TOOLS } from '../tools.mjs';
import { articleCard, continueLink, guideCard, toolCard } from './components.mjs';
import { START_GUIDE } from './guide.mjs';
import { hedgehogBall } from './hedgehog.mjs';
import { icons } from './icons.mjs';

/** @typedef {import('./layout.mjs').Ctx} Ctx */
/** @typedef {import('../content.mjs').Page} Page */

/** How many of the newest articles the home page shows. */
const LATEST_ARTICLES = 3;

/** How many guides of the "everyone" track the home page shows: the path to start on. */
const START_GUIDES = 3;

/**
 * A small scene beside the hero title: a hedgehog guards a message while two
 * nosy eyes peek in. Curled into a ball it shows only spines and the message
 * stays hidden; uncurled, everyone can read it. The whole drawing is the label
 * of a real checkbox, so tapping the hedgehog (or pressing Space on it) curls
 * and uncurls it, without any script: `:checked` picks the state in CSS. The
 * drawing is decoration: the checkbox carries the name and the state, and the
 * scene keeps its size in both states, so nothing moves (rule 4).
 * @param {Ctx} ctx
 */
function heroDemo(ctx) {
  const { t } = ctx;
  return html`<div class="hero-demo">
      <input class="hero-demo__input" type="checkbox" id="hero-demo" checked>
      <label class="hero-demo__scene" for="hero-demo">
        <span class="visually-hidden">${t('home.demo.toggle')}</span>
        <svg class="hero-demo__art" viewBox="0 0 360 290" width="360" height="290" aria-hidden="true" focusable="false">
          <circle class="hero-demo__blob" cx="180" cy="158" r="128"/>
          <path class="hero-demo__spark hero-demo__only-on" d="M62 96c2 9 5 12 14 14-9 2-12 5-14 14-2-9-5-12-14-14 9-2 12-5 14-14Z"/>
          <path class="hero-demo__spark hero-demo__spark--late hero-demo__only-on" d="M300 196c1.5 7 4 9.5 11 11-7 1.5-9.5 4-11 11-1.5-7-4-9.5-11-11 7-1.5 9.5-4 11-11Z"/>
          <g class="hero-demo__snoop hero-demo__snoop--one">
            <circle class="hero-demo__eyeball" cx="306" cy="92" r="27"/>
            <circle class="hero-demo__pupil" cx="297" cy="97" r="11"/>
            <circle class="hero-demo__glint" cx="293" cy="93" r="3.5"/>
            <path class="hero-demo__lid hero-demo__only-on" d="M279 92a27 27 0 0 1 54 0Z"/>
            <text class="hero-demo__mark hero-demo__only-on" x="336" y="62" text-anchor="middle">?</text>
            <text class="hero-demo__mark hero-demo__mark--bad hero-demo__only-off" x="336" y="62" text-anchor="middle">!</text>
          </g>
          <g class="hero-demo__snoop hero-demo__snoop--two">
            <circle class="hero-demo__eyeball" cx="48" cy="226" r="21"/>
            <circle class="hero-demo__pupil" cx="56" cy="231" r="8.5"/>
            <circle class="hero-demo__glint" cx="53" cy="228" r="2.5"/>
            <path class="hero-demo__lid hero-demo__only-on" d="M27 226a21 21 0 0 1 42 0Z"/>
          </g>
          <g class="hero-demo__note">
            <path class="hero-demo__paper" d="M96 12h148a16 16 0 0 1 16 16v34a16 16 0 0 1-16 16h-52l-12 14-12-14H96a16 16 0 0 1-16-16V28a16 16 0 0 1 16-16Z"/>
            <g class="hero-demo__only-on">
              <circle class="hero-demo__dot" cx="128" cy="45" r="6"/>
              <circle class="hero-demo__dot" cx="154" cy="45" r="6"/>
              <circle class="hero-demo__dot" cx="180" cy="45" r="6"/>
              <circle class="hero-demo__dot" cx="206" cy="45" r="6"/>
              <circle class="hero-demo__dot" cx="232" cy="45" r="6"/>
            </g>
            <text class="hero-demo__hello hero-demo__only-off" x="170" y="53" text-anchor="middle">${t('home.demo.hello')}</text>
          </g>
          <g class="hero-demo__hog">
            ${hedgehogBall}
            <g class="hero-demo__open">
              <polygon class="hero-demo__spines" points="126.3,223 99.6,222.5 119.3,204.4 94.1,195.5 118.5,184.5 97.4,168.1 124,165.4 109.2,143.1 135.3,149.1 128.3,123.2 151.2,137.1 152.8,110.4 170.1,130.8 180,106 189.9,130.8 207.2,110.4 208.8,137.1 231.7,123.2 224.7,149.1 250.8,143.1 236,165.4 262.6,168.1 241.5,184.5 265.9,195.5 240.7,204.4 260.4,222.5 233.7,223"/>
              <circle class="hero-demo__fur" cx="140" cy="158" r="12"/>
              <circle class="hero-demo__fur" cx="220" cy="158" r="12"/>
              <circle class="hero-demo__cheek" cx="140" cy="158" r="5.5"/>
              <circle class="hero-demo__cheek" cx="220" cy="158" r="5.5"/>
              <ellipse class="hero-demo__fur" cx="162" cy="250" rx="13" ry="8"/>
              <ellipse class="hero-demo__fur" cx="198" cy="250" rx="13" ry="8"/>
              <ellipse class="hero-demo__fur" cx="180" cy="204" rx="55" ry="48"/>
              <circle class="hero-demo__cheek" cx="146" cy="212" r="8"/>
              <circle class="hero-demo__cheek" cx="214" cy="212" r="8"/>
              <g class="hero-demo__eyes">
                <circle class="hero-demo__ink" cx="161" cy="194" r="6"/>
                <circle class="hero-demo__ink" cx="199" cy="194" r="6"/>
                <circle class="hero-demo__glint" cx="163" cy="192" r="2"/>
                <circle class="hero-demo__glint" cx="201" cy="192" r="2"/>
              </g>
              <ellipse class="hero-demo__ink" cx="180" cy="207" rx="6.5" ry="5"/>
              <path class="hero-demo__smile" d="M170 218q10 9 20 0"/>
            </g>
          </g>
        </svg>
      </label>
    </div>`;
}

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
  const articles = content.articles[lang].slice(0, LATEST_ARTICLES);

  const body = html`<section class="hero">
  <div class="container hero__grid">
    <div class="hero__text">
      <h1 class="hero__title">${page.heading ?? page.title}</h1>
      <div class="hero__actions">
        ${first ? html`<a class="button" href="${url(first.route)}">${t('home.cta')}${icons.arrowRight}</a>` : null}
        <a class="button button--ghost" href="${url('/guides/')}">${t('home.allGuides')}</a>
      </div>
      <p class="hero__continue js-only">
        ${continueLink(ctx)}
      </p>
    </div>
    ${heroDemo(ctx)}
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

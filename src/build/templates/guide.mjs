// @ts-check
/**
 * @file Template for a single guide page with its checklist, tabs and progress.
 */
import { formatDate } from '../i18n.mjs';
import { html } from '../html.mjs';
import { renderBlocks, renderInline } from '../markdown.mjs';
import { localePath } from '../site.mjs';
import { articleJsonLd, breadcrumbJsonLd } from '../seo.mjs';
import { badge, breadcrumbs, contentFooter, draftNotice, guideMeta, guideNav, printButton, progressAttrs } from './components.mjs';

/** The high-risk guide every other high-risk guide points to first. */
export const START_GUIDE = 'threat-modelling';
import { icons } from './icons.mjs';

/** @typedef {import('./layout.mjs').Ctx} Ctx */
/** @typedef {import('../content.mjs').Guide} Guide */
/** @typedef {import('../guide.mjs').GuideItem} GuideItem */
/** @typedef {import('../markdown.mjs').RenderContext} RenderContext */

/**
 * Ids generated for parts of an item. Item ids can't contain "__", so these
 * can never collide with an item id or a heading id from content.
 * @param {string} itemId
 */
export const itemIds = (itemId) => ({
  title: `${itemId}__title`,
  check: `${itemId}__check`,
  label: `${itemId}__label`,
  /** @param {number} index */
  panel: (index) => `${itemId}__p${index + 1}`,
});

/**
 * A guide: header, progress + table of contents, and the checklist items.
 * Works without JavaScript; client JS adds saved progress and platform tabs.
 * JS-only widgets are laid out from the first paint (see .js-only in CSS),
 * so nothing moves when the script runs.
 * @param {Ctx} ctx
 * @param {Guide} guide
 */
export function guidePage(ctx, guide) {
  const { site, lang, t, content } = ctx;
  const md = ctx.markdown(guide.file, guide.route);
  const guides = content.guides[lang];
  const following = guides[guides.indexOf(guide) + 1];
  const next = following?.audience === guide.audience ? following : undefined;
  const reviewed = formatDate(guide.reviewed, t('dateLocale'));
  const progressTemplate = t('guide.progress');
  const initialProgress = t('guide.progress', { done: 0, total: guide.items.length });

  const body = html`<div class="progress-strip js-only" data-js="progress">
  <div class="progress-strip__bar" data-js="progress-bar"></div>
</div>
<div class="container page">
  <div class="guide-layout guide-layout--guide" data-js="checklist" ${progressAttrs(guide)}>
    <div class="guide-head">
  ${breadcrumbs(ctx, [
    { name: t('nav.home'), route: '/' },
    { name: t('nav.guides'), route: '/guides/' },
    { name: guide.title },
  ])}
  <header class="page-header guide-header">
    ${guide.draft ? draftNotice(ctx, 'guide') : null}
    <h1 class="page-header__title">${guide.title}</h1>
    <p class="lead">${guide.summary}</p>
    ${guide.audience === 'high-risk' ? highRiskNotice(ctx, guide) : null}
    <ul class="meta" role="list">
      ${guideMeta(ctx, guide)}
      <li>${icons.calendar}<span>${t('guide.reviewed')} <time datetime="${guide.reviewed}">${reviewed}</time></span></li>
      ${printButton(ctx)}
    </ul>
  </header>
    </div>
    <aside class="guide-aside guide-aside--nav guide-aside--page">
      <div class="guide-aside__inner" data-js="nav-scroll">
        ${guideNav(ctx, guide)}
      </div>
    </aside>
    <aside class="guide-aside guide-aside--rail" aria-label="${t('guide.inThisGuide')}">
      <div class="guide-aside__inner">
        <div class="progress js-only" data-js="progress">
          <p class="progress__label">
            <span>${t('guide.progressLabel')}</span>
            <span class="progress__count" data-js="progress-text" data-template="${progressTemplate}">${initialProgress}</span>
          </p>
          <div class="progress__track"><div class="progress__bar" data-js="progress-bar"></div></div>
          <p class="progress__note">${t(guide.progress === 'session' ? 'guide.privacyNoteSession' : 'guide.privacyNote')}</p>
          <button class="link-button" type="button" data-js="progress-reset">${t('guide.resetProgress')}</button>
        </div>
        <details class="toc toc--rail" data-js="toc" open>
          <summary class="toc__summary">${t('guide.inThisGuide')}</summary>
          <ol class="toc__list" role="list">
            ${guide.items.map(
              (item) => html`<li><a class="toc__link" href="#${item.id}" data-js="toc-link" data-item="${item.id}">
              <span class="dot dot--${item.priority}" aria-hidden="true"></span><span class="toc__text">${renderInline(item.title, md, item.line)}</span><span class="visually-hidden" data-js="toc-done" data-text="${t('guide.doneLabel')}"></span>
            </a></li>`,
            )}
          </ol>
        </details>
      </div>
    </aside>

    <div class="guide-main">
      ${guide.intro.length ? html`<div class="prose guide-intro">${renderBlocks(guide.intro, md)}</div>` : null}
      <p class="visually-hidden" data-js="progress-live" aria-live="polite"></p>
      ${itemFilters(ctx, guide)}
      <div class="items">
        ${guide.items.map((item) => itemCard(ctx, item, md))}
      </div>
      <p class="items__empty" data-js="filter-empty" hidden>${t('guide.filters.empty')}</p>
      ${contentFooter(ctx, guide, next ? { label: t('guide.next'), title: next.title, route: next.route } : null)}
    </div>
  </div>
</div>`;

  const path = localePath(site, lang, guide.route);
  return {
    title: `${guide.title} — ${t('siteName')}`,
    description: guide.description,
    body,
    noindex: guide.draft,
    ogType: /** @type {const} */ ('article'),
    lastmod: guide.reviewed,
    jsonLd: [
      articleJsonLd(site, { title: guide.title, description: guide.description, lang, path, siteName: t('siteName'), modified: guide.reviewed }),
      breadcrumbJsonLd(site, [
        { name: t('nav.home'), path: localePath(site, lang, '/') },
        { name: t('nav.guides'), path: localePath(site, lang, '/guides/') },
        { name: guide.title, path },
      ]),
    ],
  };
}

/**
 * Fixed notice on every high-risk guide: no checklist is a guarantee, and the
 * threat-modelling guide comes first.
 * @param {Ctx} ctx
 * @param {Guide} guide
 */
function highRiskNotice(ctx, guide) {
  const { lang, t, url, content } = ctx;
  const start = content.guides[lang].find((g) => g.slug === START_GUIDE);
  return html`<p class="notice">${icons.alert}<span>${t('guide.highRiskNotice')}${start && start !== guide ? html` <a href="${url(start.route)}">${t('guide.highRiskStart')}</a>` : null}</span></p>`;
}

/**
 * Toggles above the checklist (JS only; see src/client/filters.mjs).
 * "Essential only" is offered when it would actually hide something.
 * @param {Ctx} ctx
 * @param {Guide} guide
 */
function itemFilters(ctx, guide) {
  const { t } = ctx;
  const essential = guide.items.filter((item) => item.priority === 'essential').length;
  /** @param {string} name @param {string} label */
  const toggle = (name, label) =>
    html`<button class="chip" type="button" data-js="filter" data-filter="${name}" aria-pressed="false">${label}</button>`;
  return html`<div class="item-filters js-only" data-js="filters" role="group" aria-label="${t('guide.filters.label')}">
        ${essential > 0 && essential < guide.items.length ? toggle('essentialOnly', t('guide.filters.essential')) : null}
        ${toggle('hideDone', t('guide.filters.hideDone'))}
        <p class="item-filters__status" data-js="filter-status" role="status" data-template="${t('guide.filters.showing')}"></p>
      </div>`;
}

/**
 * Classes for an item's platform group. `platforms--has-<key>` tells CSS which
 * shared platform keys the group contains, so it can show the visitor's
 * platform before JS runs without needing :has().
 * @param {GuideItem} item
 */
function platformsClass(item) {
  const classes = ['platforms'];
  if (item.platforms.length > 1) classes.push('platforms--multi');
  for (const platform of item.platforms) {
    if (platform.key) classes.push(`platforms--has-${platform.key}`);
  }
  return classes.join(' ');
}

/**
 * One checklist item. The checkbox works without JS; JS saves its state.
 * @param {Ctx} ctx
 * @param {GuideItem} item
 * @param {RenderContext} md
 */
function itemCard(ctx, item, md) {
  const { t } = ctx;
  const ids = itemIds(item.id);
  return html`<article class="item item--${item.priority}" id="${item.id}" data-js="item" data-priority="${item.priority}">
  <div class="item__head">
    ${badge(ctx, item.priority)}
    <div class="item__row">
      <input class="checkbox item__check" type="checkbox" id="${ids.check}" value="${item.id}" data-js="item-check" aria-labelledby="${ids.title} ${ids.label}">
      <h2 class="item__title" id="${ids.title}"><label for="${ids.check}">${renderInline(item.title, md, item.line)}</label></h2>
    </div>
    <span class="visually-hidden" id="${ids.label}">${t('guide.markDone')}</span>
  </div>
  <div class="item__body">
    ${item.body.length ? html`<div class="prose">${renderBlocks(item.body, md)}</div>` : null}
    ${item.platforms.length
      ? html`<div class="${platformsClass(item)}" data-js="platforms" data-label="${t('guide.platformsLabel')}">
      ${item.platforms.map(
        (platform, index) => html`<section class="platform" id="${ids.panel(index)}" data-js="platform"${platform.key ? html` data-platform="${platform.key}"` : null}>
        <h3 class="platform__title">${platform.label}</h3>
        <div class="prose">${renderBlocks(platform.body, md)}</div>
      </section>`,
      )}
    </div>`
      : null}
  </div>
</article>`;
}

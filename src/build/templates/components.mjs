// @ts-check
/**
 * @file Shared page components: breadcrumbs, badges, cards and similar fragments.
 */
import { AUDIENCES, GROUPS } from '../frontmatter.mjs';
import { html } from '../html.mjs';
import { formatDate } from '../i18n.mjs';
import { renderInline } from '../markdown.mjs';
import { toolRoute } from '../tools.mjs';
import { icons } from './icons.mjs';

/** @typedef {import('./layout.mjs').Ctx} Ctx */
/** @typedef {import('../content.mjs').Guide} Guide */
/** @typedef {import('../content.mjs').Article} Article */
/** @typedef {import('../tools.mjs').Tool} Tool */

/**
 * @param {Ctx} ctx
 * @param {string} priority
 */
export function badge(ctx, priority) {
  return html`<span class="badge badge--${priority}">${ctx.t(`priority.${priority}`)}</span>`;
}

/** @param {Ctx} ctx */
export function draftBadge(ctx) {
  return html`<span class="badge badge--draft">${ctx.t('content.draftBadge')}</span>`;
}

/**
 * Warning shown at the top of a draft guide or article.
 * @param {Ctx} ctx
 * @param {'guide' | 'article'} kind
 */
export function draftNotice(ctx, kind) {
  return html`<p class="draft-notice">${icons.alert}<span>${ctx.t(`${kind}.draftNotice`)}</span></p>`;
}

/**
 * A card title at the right heading level for where the card is used.
 * @param {number} level  2 or 3
 * @param {import('../html.mjs').SafeHtml} content
 */
function cardTitle(level, content) {
  return level === 2 ? html`<h2 class="card__title">${content}</h2>` : html`<h3 class="card__title">${content}</h3>`;
}

/**
 * "Print or save as PDF", as an entry of a .meta list.
 * @param {Ctx} ctx
 */
export function printButton(ctx) {
  return html`<li class="js-only"><button class="link-button print-button" type="button" data-js="print">${icons.printer}<span>${ctx.t('content.print')}</span></button></li>`;
}

/**
 * Time and step count for a guide.
 * @param {Ctx} ctx
 * @param {Guide} guide
 */
export function guideMeta(ctx, guide) {
  const { t } = ctx;
  return html`<li>${icons.clock}<span>${t('guide.minutes', { n: guide.time })}</span></li>
<li>${icons.list}<span>${t('guide.items', { n: guide.items.length })}</span></li>`;
}

/**
 * Data attributes the client needs to find a guide's saved progress.
 * @param {Guide} guide
 */
export function progressAttrs(guide) {
  return html`data-guide="${guide.storageKey}" data-storage="${guide.progress}"`;
}

/**
 * Card linking to a guide. Saved progress is filled in by client JS in the
 * top row, which has a fixed height, so it never moves the card's content.
 * @param {Ctx} ctx
 * @param {Guide} guide
 * @param {number} headingLevel
 */
export function guideCard(ctx, guide, headingLevel) {
  const { t, url } = ctx;
  const essential = guide.items.filter((item) => item.priority === 'essential').length;
  const title = html`<a class="card__link" href="${url(guide.route)}">${guide.title}</a>`;
  return html`<article class="card">
  <div class="card__top">
    <span class="guide-card__number" aria-hidden="true">${String(guide.order).padStart(2, '0')}</span>
    ${guide.draft ? draftBadge(ctx) : null}
    <span class="card-progress" data-js="card-progress" ${progressAttrs(guide)} data-items="${guide.items.map((item) => item.id).join(' ')}">
      <span class="card-progress__track" aria-hidden="true"><span class="card-progress__bar" data-js="progress-bar"></span></span>
      <span class="card-progress__text" data-js="progress-text" data-template="{done}/{total}" aria-hidden="true"></span>
      <span class="visually-hidden" data-js="progress-text" data-template="${t('guide.progress')}"></span>
    </span>
  </div>
  ${cardTitle(headingLevel, title)}
  <p class="card__summary">${guide.summary}</p>
  <ul class="meta" role="list">
    ${guideMeta(ctx, guide)}
    ${essential ? html`<li><span class="dot dot--essential" aria-hidden="true"></span><span>${t('guide.essentialCount', { n: essential })}</span></li>` : null}
  </ul>
</article>`;
}

/** UI strings key of each track, under `guides.`. */
const TRACK_STRINGS = { everyone: 'everyone', 'high-risk': 'highRisk' };

/**
 * The language's guides as the lists show them: tracks, each split into its
 * topic groups, in reading order. Tracks and groups without guides are left out.
 * @param {Ctx} ctx
 */
export function guideTracks(ctx) {
  const all = ctx.content.guides[ctx.lang];
  return AUDIENCES.map((audience) => {
    const guides = all.filter((guide) => guide.audience === audience);
    return {
      audience,
      title: ctx.t(`guides.${TRACK_STRINGS[audience]}.title`),
      lead: ctx.t(`guides.${TRACK_STRINGS[audience]}.lead`),
      guides,
      groups: GROUPS[audience]
        .map((key) => ({ key, title: ctx.t(`guides.groups.${key}`), guides: guides.filter((guide) => guide.group === key) }))
        .filter((group) => group.guides.length > 0),
    };
  }).filter((track) => track.guides.length > 0);
}

/**
 * "All guides": every guide by track and topic, for the left sidebar of the
 * guides list and of every guide (where the current guide is marked). It
 * starts open; checklist.mjs closes it on small screens.
 *
 * The tracks are a native accordion (<details> sharing a name): the track of
 * the guide being read is open, or the first one on the guides list, and
 * opening the other closes it. One open track fits a laptop screen, so the
 * sidebar can stay in view without scrolling inside it.
 * Saved progress shows as "3/7" in space every link reserves, so all titles
 * wrap the same way.
 * @param {Ctx} ctx
 * @param {Guide} [current]  The guide being read, on a guide page.
 */
export function guideNav(ctx, current) {
  const { t, url } = ctx;
  const label = t('guides.navLabel');
  const tracks = guideTracks(ctx);
  const openTrack = current?.audience ?? tracks[0]?.audience;
  return html`<details class="toc guide-nav" data-js="toc" open>
  <summary class="toc__summary">${label}</summary>
  <nav class="toc__list guide-nav__body" aria-label="${label}">
    ${tracks.map(
      (track) => html`<details class="guide-nav__track" name="guide-tracks" data-track="${track.audience}"${track.audience === openTrack ? html` open` : null}>
    <summary class="guide-nav__track-title">${track.title}</summary>
    ${track.groups.map(
      (group) => html`<p class="guide-nav__group" id="guide-nav__${group.key}">${group.title}</p>
    <ul role="list" aria-labelledby="guide-nav__${group.key}">
      ${group.guides.map(
        (guide) => html`<li><a class="toc__link guide-nav__link" href="${url(guide.route)}"${guide === current ? html` aria-current="page" data-js="nav-current"` : null}>
        <span class="guide-nav__text">${guide.title}</span><span class="card-progress guide-nav__progress" data-js="card-progress" ${progressAttrs(guide)} data-items="${guide.items.map((item) => item.id).join(' ')}"><span class="card-progress__text" data-js="progress-text" data-template="{done}/{total}" aria-hidden="true"></span><span class="visually-hidden" data-js="progress-text" data-template="${t('guide.progress')}"></span></span>
      </a></li>`,
      )}
    </ul>`,
    )}
    </details>`,
    )}
  </nav>
</details>`;
}

/**
 * A row on the guides list: what the guide is for, what it costs in time, and
 * all of its steps behind a native <details>, so the list stays short but a
 * reader can see what a guide covers without opening it. Saved progress and
 * finished steps are filled in by client JS in space that is always reserved.
 * @param {Ctx} ctx
 * @param {Guide} guide
 */
export function guideRow(ctx, guide) {
  const { t, url } = ctx;
  const essential = guide.items.filter((item) => item.priority === 'essential').length;
  const md = ctx.markdown(guide.file, guide.route);
  const titleId = `guide-${guide.slug}__title`;
  return html`<li class="guide-row">
  <div class="guide-row__main">
    <h4 class="guide-row__title" id="${titleId}"><a class="guide-row__link" href="${url(guide.route)}">${guide.title}</a></h4>
    <span class="card-progress guide-row__progress" data-js="card-progress" ${progressAttrs(guide)} data-items="${guide.items.map((item) => item.id).join(' ')}">
      <span class="card-progress__track" aria-hidden="true"><span class="card-progress__bar" data-js="progress-bar"></span></span>
      <span class="card-progress__text" data-js="progress-text" data-template="{done}/{total}" aria-hidden="true"></span>
      <span class="visually-hidden" data-js="progress-text" data-template="${t('guide.progress')}"></span>
    </span>
    <p class="guide-row__summary">${guide.summary}</p>
    <ul class="meta guide-row__meta" role="list">
      <li>${icons.clock}<span>${t('guide.minutes', { n: guide.time })}</span></li>
      ${essential ? html`<li><span class="dot dot--essential" aria-hidden="true"></span><span>${t('guide.essentialCount', { n: essential })}</span></li>` : null}
      ${guide.draft ? html`<li>${draftBadge(ctx)}</li>` : null}
    </ul>
  </div>
  <details class="guide-row__steps">
    <summary class="guide-row__toggle" aria-describedby="${titleId}">${t('guides.showSteps', { n: guide.items.length })}</summary>
    <ol class="step-list" role="list" data-js="guide-contents" ${progressAttrs(guide)}>
      ${guide.items.map(
        (item) => html`<li><a class="step-list__link" href="${url(guide.route)}#${item.id}" data-js="toc-link" data-item="${item.id}">
        <span class="dot dot--${item.priority}" aria-hidden="true"></span><span class="step-list__text">${renderInline(item.title, md, item.line)}</span><span class="visually-hidden" data-js="toc-done" data-text="${t('guide.doneLabel')}"></span>
      </a></li>`,
      )}
    </ol>
  </details>
</li>`;
}

/**
 * "Continue: <guide> 3/8", pointing at the guide the visitor was working on.
 * Starts without href and invisible; continue.mjs fills it from saved progress.
 * It carries every guide of the language (in listed order, by track), so it
 * works the same whichever cards the page happens to show.
 * The wrapper around it must reserve its line.
 * @param {Ctx} ctx
 */
export function continueLink(ctx) {
  const { t, url, lang, content } = ctx;
  return html`<a class="continue" data-js="continue"><span>${t('home.continue')}</span><span class="continue__title" data-js="continue-title"></span><span class="continue__count" data-js="continue-count"></span>${icons.arrowRight}${content.guides[lang].map(
    (guide) => html`<span hidden data-js="continue-guide" ${progressAttrs(guide)} data-track="${guide.audience}" data-href="${url(guide.route)}" data-title="${guide.title}" data-items="${guide.items.map((item) => item.id).join(' ')}"></span>`,
  )}</a>`;
}

/**
 * Card linking to an article.
 * @param {Ctx} ctx
 * @param {Article} article
 * @param {number} headingLevel
 */
export function articleCard(ctx, article, headingLevel) {
  const { t, url } = ctx;
  return html`<article class="card">
  <div class="card__top">
    <time class="card__date" datetime="${article.published}">${formatDate(article.published, t('dateLocale'))}</time>
    ${article.draft ? draftBadge(ctx) : null}
  </div>
  ${cardTitle(headingLevel, html`<a class="card__link" href="${url(article.route)}">${article.title}</a>`)}
  <p class="card__summary">${article.summary}</p>
  <ul class="meta" role="list">
    <li>${icons.clock}<span>${t('article.readingTime', { n: article.minutes })}</span></li>
  </ul>
</article>`;
}

/**
 * Card linking to a tool.
 * @param {Ctx} ctx
 * @param {Tool} tool
 * @param {number} headingLevel
 */
export function toolCard(ctx, tool, headingLevel) {
  const { t, url } = ctx;
  return html`<article class="card">
  <span class="card__icon">${icons[tool.icon]}</span>
  ${cardTitle(headingLevel, html`<a class="card__link" href="${url(toolRoute(tool))}">${t(`tools.items.${tool.key}.title`)}</a>`)}
  <p class="card__summary">${t(`tools.items.${tool.key}.summary`)}</p>
</article>`;
}

/**
 * Footer of a guide or an article: a link to suggest an edit (once the
 * repository is public) and a large link to the next entry, if there is one.
 * @param {Ctx} ctx
 * @param {{ file: string }} entry
 * @param {{ label: string, title: string, route: string } | null} next
 */
export function contentFooter(ctx, entry, next) {
  const { site, t, url } = ctx;
  if (!site.repo && !next) return null;
  return html`<footer class="content-footer">
  ${site.repo
    ? html`<a class="content-footer__edit" href="${site.repo}/blob/main/${entry.file}" rel="external noreferrer">${icons.edit}<span>${t('content.suggestEdit')}</span></a>`
    : null}
  ${next
    ? html`<a class="next-link" href="${url(next.route)}">
    <span class="next-link__label">${next.label}</span>
    <span class="next-link__title">${next.title}${icons.arrowRight}</span>
  </a>`
    : null}
</footer>`;
}

/**
 * @param {Ctx} ctx
 * @param {{ name: string, route?: string }[]} trail  The last entry is the current page (no route).
 */
export function breadcrumbs(ctx, trail) {
  return html`<nav class="breadcrumbs" aria-label="${ctx.t('breadcrumbs')}">
  <ol role="list">
    ${trail.map((crumb) =>
      crumb.route
        ? html`<li><a href="${ctx.url(crumb.route)}">${crumb.name}</a></li>`
        : html`<li><span aria-current="page">${crumb.name}</span></li>`,
    )}
  </ol>
</nav>`;
}

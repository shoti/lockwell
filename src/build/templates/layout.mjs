// @ts-check
/**
 * @file Page layout: head, meta and Open Graph tags, header, footer and the page shell.
 */
import { html, raw } from '../html.mjs';
import { jsonLdScripts } from '../seo.mjs';
import { absoluteUrl, href } from '../site.mjs';
import { icons, logo } from './icons.mjs';

/** @typedef {import('../html.mjs').SafeHtml} SafeHtml */
/** @typedef {import('../seo.mjs').Alternate} Alternate */

/**
 * @typedef {object} Assets
 * @property {string} css  Stylesheet href (with cache-busting version).
 * @property {string} js  Entry module href.
 * @property {string[]} fonts  Font hrefs to preload.
 * @property {string} headScript  Tiny inline script that runs before first paint (see assets.mjs).
 * @property {string} csp  Content-Security-Policy value.
 * @property {string} cspSelf  The same, but letting the page connect to its own host (see PageContent.connect).
 * @property {Record<string, string | null>} ogImages  Social preview image path per language.
 */

/**
 * @typedef {object} Ctx
 * @property {import('../site.mjs').Site} site
 * @property {string} lang
 * @property {import('../i18n.mjs').Translate} t  UI strings in the current language.
 * @property {(lang: string) => import('../i18n.mjs').Translate} tFor  UI strings in another language.
 * @property {import('../content.mjs').Content} content
 * @property {Assets} assets
 * @property {(file: string, route: string) => import('../markdown.mjs').RenderContext} markdown  Rendering context for a content file shown at `route`.
 * @property {(route: string) => string} url  Localized href for a route in the current language.
 * @property {string | null} feed  Href of this language's feed, or null while it has nothing published.
 */

/**
 * What a page template returns.
 * @typedef {object} PageContent
 * @property {string} title  Full <title>.
 * @property {string} description
 * @property {SafeHtml} body
 * @property {object[]} [jsonLd]
 * @property {boolean} [noindex]
 * @property {'website' | 'article'} [ogType]
 * @property {string} [lastmod]
 * @property {'self'} [connect]  The page may connect to its own host (only the browser check's opt-in IP lookup).
 */

/**
 * @typedef {PageContent & { route: string, alternates: Alternate[] }} PageDescriptor
 *   route: language-neutral route; alternates: every language version, including this one.
 */

/** Browser UI colors per theme; must match --color-bg in 02-tokens.css. */
const THEME_COLORS = { light: '#fbfaf7', dark: '#0f1622' };

/**
 * Full HTML document.
 * @param {Ctx} ctx
 * @param {PageDescriptor} page
 */
export function layout(ctx, page) {
  const { site, lang, t, assets } = ctx;
  const self = page.alternates.find((alt) => alt.lang === lang);
  if (!self) throw new Error(`Page ${page.route} has no ${lang} alternate; this is a build bug.`);
  const canonical = absoluteUrl(site, self.path);
  const xDefault = page.alternates.find((alt) => alt.lang === site.defaultLang);
  const ogImage = assets.ogImages[lang];

  return html`<!doctype html>
<html lang="${lang}" dir="ltr" class="no-js">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="${raw(page.connect === 'self' ? assets.cspSelf : assets.csp)}">
<meta name="referrer" content="no-referrer">
<title>${page.title}</title>
<meta name="description" content="${page.description}">
${site.author ? html`<meta name="author" content="${site.author.name}">
` : null}${page.noindex ? html`<meta name="robots" content="noindex">` : html`<link rel="canonical" href="${canonical}">`}
${page.alternates.length > 1
    ? [
        page.alternates.map((alt) => html`<link rel="alternate" hreflang="${alt.lang}" href="${absoluteUrl(site, alt.path)}">\n`),
        xDefault ? html`<link rel="alternate" hreflang="x-default" href="${absoluteUrl(site, xDefault.path)}">` : null,
      ]
    : null}
<meta property="og:type" content="${page.ogType ?? 'website'}">
<meta property="og:site_name" content="${t('siteName')}">
<meta property="og:title" content="${page.title}">
<meta property="og:description" content="${page.description}">
${page.ogType === 'article' && site.author ? html`<meta property="article:author" content="${site.author.url}">
` : null}${page.noindex ? null : html`<meta property="og:url" content="${canonical}">\n`}<meta property="og:locale" content="${t('locale')}">
${page.alternates
    .filter((alt) => alt.lang !== lang)
    .map((alt) => html`<meta property="og:locale:alternate" content="${ctx.tFor(alt.lang)('locale')}">\n`)}${ogImage
    ? html`<meta property="og:image" content="${absoluteUrl(site, ogImage)}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="${t('siteName')} — ${t('siteTagline')}">
<meta name="twitter:card" content="summary_large_image">`
    : null}
<meta name="theme-color" content="${THEME_COLORS.light}" media="(prefers-color-scheme: light)" data-js="theme-color" data-light="${THEME_COLORS.light}" data-dark="${THEME_COLORS.dark}">
<meta name="theme-color" content="${THEME_COLORS.dark}" media="(prefers-color-scheme: dark)" data-js="theme-color" data-light="${THEME_COLORS.light}" data-dark="${THEME_COLORS.dark}">
${ctx.feed ? html`<link rel="alternate" type="application/atom+xml" title="${t('siteName')}" href="${ctx.feed}">
` : null}<link rel="icon" href="${href(site, '/favicon.svg')}" type="image/svg+xml">
<link rel="apple-touch-icon" href="${href(site, '/apple-touch-icon.png')}">
${assets.fonts.map((font) => html`<link rel="preload" href="${font}" as="font" type="font/woff2" crossorigin>\n`)}<link rel="stylesheet" href="${assets.css}">
<script>${raw(assets.headScript)}</script>
<script type="module" src="${assets.js}"></script>
${page.jsonLd ? jsonLdScripts(page.jsonLd) : null}
</head>
<body>
<a class="skip-link" href="#main">${t('skipToContent')}</a>
${header(ctx, page)}
<main id="main" class="site-main" tabindex="-1">
${page.body}
</main>
${footer(ctx)}
</body>
</html>
`;
}

/**
 * @param {Ctx} ctx
 * @param {PageDescriptor} page
 */
function header(ctx, page) {
  const { site, lang, t, url, content } = ctx;
  const links = [
    { route: '/guides/', label: t('nav.guides') },
    // Only languages that have articles get the section (see routes.mjs).
    ...(content.articles[lang].length ? [{ route: '/articles/', label: t('nav.articles') }] : []),
    { route: '/tools/', label: t('nav.tools') },
    // Four links don't fit a phone's header row: "About" is left to the footer there.
    { route: '/about/', label: t('nav.about'), wideOnly: true },
  ];
  /** @param {string} route */
  const current = (route) => {
    if (page.route === route) return html` aria-current="page"`;
    return page.route.startsWith(route) ? html` aria-current="true"` : null;
  };
  const others = site.languages.filter((l) => l !== lang);

  return html`<header class="site-header">
  <div class="container site-header__inner">
    <a class="brand" href="${url('/')}" aria-label="${t('siteName')} — ${t('nav.home')}">
      ${logo}<span class="brand__name">${t('siteName')}</span>
    </a>
    <nav class="site-nav" aria-label="${t('nav.label')}">
      <ul class="site-nav__list" role="list">
        ${links.map(
          ({ route, label, wideOnly }) =>
            html`<li${wideOnly ? html` class="site-nav__item--wide"` : null}><a class="site-nav__link" href="${url(route)}"${current(route)}>${label}</a></li>`,
        )}
      </ul>
    </nav>
    <div class="site-header__actions">
      ${others.map((other) => {
        const target = page.alternates.find((alt) => alt.lang === other)?.path ?? (other === site.defaultLang ? '/' : `/${other}/`);
        const tOther = ctx.tFor(other);
        return html`<a class="lang-switch" href="${href(site, target)}" hreflang="${other}" lang="${other}">
        <span aria-hidden="true">${tOther('languageShort')}</span><span class="visually-hidden">${tOther('languageName')}</span>
      </a>`;
      })}
      <a class="icon-button" href="${url('/search/')}"${current('/search/')}>${icons.search}<span class="visually-hidden">${t('nav.search')}</span></a>
      <button class="icon-button js-only" type="button" data-js="theme-toggle" aria-pressed="false">
        <span class="icon-button__on">${icons.moon}</span><span class="icon-button__off">${icons.sun}</span>
        <span class="visually-hidden">${t('theme.toggle')}</span>
      </button>
      ${site.repo ? html`<a class="icon-button site-header__repo" href="${site.repo}" target="_blank" rel="external noopener noreferrer">${icons.github}<span class="visually-hidden">${t('nav.source')}</span></a>` : null}
    </div>
  </div>
</header>`;
}

/** @param {Ctx} ctx */
function footer(ctx) {
  const { site, t, url } = ctx;
  // The legal row is the copyright line, the Privacy and Terms links, plus the About link on screens too narrow for it in the header (below 50rem).
  // TODO(next-iteration: hosting logs): "footer.promise" ("No tracking…") is out of scope this iteration; don't reword it.
  return html`<footer class="site-footer">
  <div class="container site-footer__inner">
    <div class="site-footer__brand">
      <a class="brand brand--small" href="${url('/')}">${logo}<span class="brand__name">${t('siteName')}</span></a>
      <p class="site-footer__tagline">${t('siteTagline')}</p>
    </div>
    <div class="site-footer__privacy">
      <p class="site-footer__promise">${icons.eyeOff}<span>${t('footer.promise')}</span></p>
      <p class="site-footer__storage js-only">
        <span>${t('footer.storageNote')}</span>
        <button class="link-button" type="button" data-js="clear-data" data-done="${t('footer.cleared')}">${t('footer.clearData')}</button>
        <span class="visually-hidden" role="status" data-js="clear-data-status"></span>
        <a href="${url('/privacy/#storage')}">${t('footer.storageDetails')}</a>
      </p>
    </div>
    <p class="site-footer__legal">
      ${site.author?.inFooter
        ? html`<span>${t('footer.copyright', { year: site.copyrightYear ?? '' })} <a href="${site.author.url}" target="_blank" rel="author external noopener noreferrer">${site.author.name}</a></span>`
        : html`<span>${t('footer.copyright', { year: site.copyrightYear ?? '' })} ${t('siteName')}</span>`}
      <a href="${url('/privacy/')}">${t('footer.privacy')}</a>
      <a href="${url('/terms/')}">${t('footer.terms')}</a>
      <a class="site-footer__about" href="${url('/about/')}">${t('nav.about')}</a>
    </p>
  </div>
</footer>`;
}

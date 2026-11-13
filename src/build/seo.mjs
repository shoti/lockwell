// @ts-check
/**
 * @file SEO helpers: structured data (JSON-LD), breadcrumbs and alternate-language links.
 */
import { escapeHtml, raw } from './html.mjs';
import { absoluteUrl, localePath } from './site.mjs';

/** @typedef {import('./site.mjs').Site} Site */

/**
 * @typedef {object} Alternate
 * @property {string} lang
 * @property {string} path  Language-specific path, e.g. "/en/guides/messaging/".
 */

/**
 * Embeds structured data. "<" is escaped so content can never close the script tag.
 * @param {object[]} items
 */
export function jsonLdScripts(items) {
  return raw(
    items
      .map((item) => `<script type="application/ld+json">${JSON.stringify(item).replace(/</g, '\\u003c')}</script>`)
      .join('\n'),
  );
}

/**
 * @param {Site} site
 * @param {{ name: string, path: string }[]} trail  From the home page to the current page.
 */
export function breadcrumbJsonLd(site, trail) {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: trail.map((crumb, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      name: crumb.name,
      item: absoluteUrl(site, crumb.path),
    })),
  };
}

/**
 * Structured data for a guide or an article.
 * @param {Site} site
 * @param {object} entry
 * @param {string} entry.title
 * @param {string} entry.description
 * @param {string} entry.lang
 * @param {string} entry.path  Language-specific path of the page.
 * @param {string} entry.siteName
 * @param {string} entry.modified  YYYY-MM-DD
 * @param {string} [entry.published]  YYYY-MM-DD
 */
export function articleJsonLd(site, { title, description, lang, path, siteName, modified, published }) {
  return {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: title,
    description,
    inLanguage: lang,
    ...(published ? { datePublished: published } : {}),
    dateModified: modified,
    mainEntityOfPage: absoluteUrl(site, path),
    author: site.author
      ? personJsonLd(site.author)
      : { '@type': 'Organization', name: siteName, url: absoluteUrl(site, localePath(site, lang, '/')) },
    ...(site.author ? { copyrightHolder: personJsonLd(site.author), copyrightYear: site.copyrightYear } : {}),
  };
}

/**
 * The site's author as a schema.org Person.
 * @param {import('./site.mjs').Author} author
 */
export function personJsonLd(author) {
  return { '@type': 'Person', name: author.name, url: author.url, email: `mailto:${author.email}` };
}

/**
 * @typedef {object} SitemapEntry
 * @property {Alternate[]} alternates  All language versions of one page (including itself).
 * @property {string} path
 * @property {string} [lastmod]  YYYY-MM-DD
 */

/**
 * Sitemap with hreflang alternates for every language version.
 * @param {Site} site
 * @param {SitemapEntry[]} entries
 */
export function sitemapXml(site, entries) {
  const urls = entries.map((entry) => {
    const links = entry.alternates.map(
      (alt) => `    <xhtml:link rel="alternate" hreflang="${alt.lang}" href="${escapeHtml(absoluteUrl(site, alt.path))}"/>`,
    );
    const fallback = entry.alternates.find((alt) => alt.lang === site.defaultLang);
    if (fallback) {
      links.push(`    <xhtml:link rel="alternate" hreflang="x-default" href="${escapeHtml(absoluteUrl(site, fallback.path))}"/>`);
    }
    return [
      '  <url>',
      `    <loc>${escapeHtml(absoluteUrl(site, entry.path))}</loc>`,
      entry.lastmod ? `    <lastmod>${entry.lastmod}</lastmod>` : '',
      ...(entry.alternates.length > 1 ? links : []),
      '  </url>',
    ]
      .filter(Boolean)
      .join('\n');
  });
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">',
    ...urls,
    '</urlset>',
    '',
  ].join('\n');
}

/** @param {Site} site */
export function robotsTxt(site) {
  return `User-agent: *\nAllow: /\n\nSitemap: ${absoluteUrl(site, '/sitemap.xml')}\n`;
}

/**
 * All language versions available for a route.
 * @param {Site} site
 * @param {string} route
 * @param {(lang: string) => boolean} exists
 * @returns {Alternate[]}
 */
export function alternatesFor(site, route, exists) {
  return site.languages.filter(exists).map((lang) => ({ lang, path: localePath(site, lang, route) }));
}

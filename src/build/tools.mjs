// @ts-check
/**
 * @file The interactive tools under /tools/: their slugs, strings, icons and routes.
 */
/**
 * The interactive tools under /tools/. Each has a page (templates/tool.mjs),
 * a panel of controls (templates/tool-panels.mjs), UI strings under
 * "tools.items.<key>" and a browser module src/client/tool-<module>.mjs,
 * loaded only on its own page (src/client/tools.mjs).
 */

/**
 * @typedef {object} Tool
 * @property {string} slug  URL: /tools/<slug>/
 * @property {'password' | 'links' | 'check' | 'photo' | 'redact' | 'document' | 'hidden' | 'browser'} key  UI strings group, panel and client module.
 * @property {'key' | 'link' | 'shield' | 'image' | 'marker' | 'file' | 'eye' | 'monitor'} icon
 * @property {number} notes  How many "tools.items.<key>.note<N>" paragraphs explain the tool.
 * @property {number} ai  How many "tools.items.<key>.ai<N>" paragraphs say how the tool compares with asking an AI service (0: no such section).
 */

/** How many tools the home page shows (the first ones in TOOLS). */
export const FEATURED_TOOLS = 4;

/** @type {Tool[]} */
export const TOOLS = [
  { slug: 'password-generator', key: 'password', icon: 'key', notes: 3, ai: 1 },
  { slug: 'link-checker', key: 'check', icon: 'shield', notes: 3, ai: 1 },
  { slug: 'photo-metadata', key: 'photo', icon: 'image', notes: 4, ai: 2 },
  { slug: 'browser-check', key: 'browser', icon: 'monitor', notes: 3, ai: 0 },
  { slug: 'link-cleaner', key: 'links', icon: 'link', notes: 3, ai: 0 },
  { slug: 'image-redaction', key: 'redact', icon: 'marker', notes: 4, ai: 2 },
  { slug: 'document-metadata', key: 'document', icon: 'file', notes: 4, ai: 1 },
  { slug: 'hidden-characters', key: 'hidden', icon: 'eye', notes: 3, ai: 2 },
];

/** @param {Tool} tool */
export const toolRoute = (tool) => `/tools/${tool.slug}/`;

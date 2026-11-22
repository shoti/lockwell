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
 * @property {'password' | 'links' | 'check' | 'photo' | 'video' | 'attachment' | 'email' | 'encrypt' | 'redact' | 'editor' | 'document' | 'hidden' | 'browser'} key  UI strings group, panel and client module.
 * @property {'key' | 'link' | 'shield' | 'image' | 'film' | 'paperclip' | 'mail' | 'lock' | 'marker' | 'sliders' | 'file' | 'eye' | 'monitor'} icon
 * @property {number} notes  How many "tools.items.<key>.note<N>" paragraphs explain the tool.
 * @property {number} ai  How many "tools.items.<key>.ai<N>" paragraphs say how the tool compares with asking an AI service (0: no such section).
 * @property {boolean} [requests]  The tool can make a request to its own host when the visitor asks (the browser
 *   check's IP lookup): its page allows connect-src 'self' and says so in "tools.items.<key>.local".
 * @property {boolean} [wide]  The tool needs room (a picture beside its controls): its section may use the page's
 *   full width from 64rem, while the text around it keeps the reading width.
 */

/** How many tools the home page shows (the first ones in TOOLS). */
export const FEATURED_TOOLS = 4;

/** @type {Tool[]} */
export const TOOLS = [
  { slug: 'password-generator', key: 'password', icon: 'key', notes: 4, ai: 1 },
  { slug: 'link-checker', key: 'check', icon: 'shield', notes: 3, ai: 1 },
  { slug: 'photo-metadata', key: 'photo', icon: 'image', notes: 5, ai: 2 },
  { slug: 'browser-check', key: 'browser', icon: 'monitor', notes: 3, ai: 0, requests: true },
  { slug: 'link-cleaner', key: 'links', icon: 'link', notes: 3, ai: 0 },
  { slug: 'image-redaction', key: 'redact', icon: 'marker', notes: 5, ai: 2 },
  { slug: 'image-editor', key: 'editor', icon: 'sliders', notes: 5, ai: 2, wide: true },
  { slug: 'document-metadata', key: 'document', icon: 'file', notes: 4, ai: 1 },
  { slug: 'file-encryption', key: 'encrypt', icon: 'lock', notes: 5, ai: 1 },
  { slug: 'hidden-characters', key: 'hidden', icon: 'eye', notes: 3, ai: 2 },
  { slug: 'video-metadata', key: 'video', icon: 'film', notes: 5, ai: 1 },
  { slug: 'attachment-checker', key: 'attachment', icon: 'paperclip', notes: 4, ai: 1 },
  { slug: 'email-headers', key: 'email', icon: 'mail', notes: 5, ai: 2 },
];

/**
 * How the tools index groups the tools, by what the visitor wants to do. Each tool is in one group.
 * @type {{ key: 'share' | 'suspicious' | 'device', tools: Tool['key'][] }[]}
 */
export const TOOL_GROUPS = [
  { key: 'share', tools: ['photo', 'video', 'redact', 'editor', 'document', 'encrypt', 'links', 'hidden'] },
  { key: 'suspicious', tools: ['check', 'attachment', 'email'] },
  { key: 'device', tools: ['password', 'browser'] },
];

/** @param {Tool} tool */
export const toolRoute = (tool) => `/tools/${tool.slug}/`;

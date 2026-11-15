// @ts-check
/**
 * @file Static audit of the built site (dist/) and the content sources: links and anchors, page structure and
 *   meta tags, source leaks, unicode hygiene, glued text, and Georgian/English parity.
 */
import { existsSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { parseFrontMatter } from '../../src/build/frontmatter.mjs';
import {
  attrValues,
  duplicateIds,
  gluedText,
  headingSkips,
  labelMismatch,
  markdownLinks,
  mixedScriptWords,
  numberDiff,
  numbersIn,
  sectionsById,
  sourceLeaks,
  visibleText,
} from './lib.mjs';

/** @typedef {import('./lib.mjs').Finding} Finding */

/** Front matter keys that must be equal in both languages. */
const SHARED_KEYS = ['audience', 'group', 'icon', 'order', 'time', 'progress', 'legal', 'reviewed', 'published', 'updated', 'status'];

/**
 * @param {string} dir
 * @returns {Promise<string[]>}
 */
async function filesIn(dir) {
  const entries = await readdir(dir, { recursive: true, withFileTypes: true });
  return entries.filter((entry) => entry.isFile()).map((entry) => join(entry.parentPath, entry.name));
}

/**
 * Checks every page in dist/.
 * @param {string} dist
 * @returns {Promise<Finding[]>}
 */
export async function auditPages(dist) {
  /** @type {Finding[]} */
  const findings = [];
  const pages = (await filesIn(dist)).filter((file) => file.endsWith('.html'));
  /** @type {Map<string, Set<string>>} page path → ids */
  const idsByPage = new Map();
  /** @type {Map<string, string>} */
  const html = new Map();
  for (const file of pages) {
    const text = await readFile(file, 'utf8');
    const path = `/${relative(dist, file).replace(/index\.html$/, '')}`;
    html.set(path, text);
    idsByPage.set(path, new Set(attrValues(text, '*', 'id')));
  }

  for (const [path, text] of html) {
    /** @param {'error' | 'warning'} level @param {string} check @param {string} message */
    const add = (level, check, message) => findings.push({ level, check, where: path, message });

    const lang = /<html\b[^>]*\slang="([^"]+)"/.exec(text)?.[1];
    if (!lang) add('error', 'meta', '<html> has no lang attribute');
    if (!/<meta name="robots" content="noindex">/.test(text)) {
      if (!/<link rel="canonical" href="https:\/\/[^"]+"/.test(text)) add('error', 'meta', 'no canonical link');
      const alternates = [...text.matchAll(/<link rel="alternate" hreflang="([^"]+)" href="([^"]+)"/g)];
      if (alternates.length < 2) add('warning', 'meta', 'fewer than two hreflang alternates');
      for (const [, , href] of alternates) {
        const target = new URL(href).pathname;
        if (!html.has(target)) add('error', 'meta', `hreflang points to ${target}, which isn't built`);
      }
    }
    for (const image of attrValues(text, 'meta', 'content').filter((value) => /\.(png|jpe?g|webp)$/.test(value))) {
      const file = join(dist, new URL(image, 'https://x/').pathname);
      if (!existsSync(file)) add('error', 'meta', `share image ${image} is missing`);
    }
    for (const id of duplicateIds(text)) add('error', 'html', `id "${id}" is used more than once`);
    for (const skip of headingSkips(text)) add('warning', 'headings', `heading level skipped: ${skip}`);
    if ((text.match(/<h1\b/g) ?? []).length !== 1) add('error', 'headings', 'a page needs exactly one <h1>');

    for (const href of attrValues(text, 'a', 'href')) {
      if (!href.startsWith('/') && !href.startsWith('#')) continue;
      if (href.startsWith('//')) {
        add('error', 'links', `protocol-relative link ${href}`);
        continue;
      }
      const [rawPath, hash] = href.split('#');
      const target = rawPath === '' ? path : rawPath.split('?')[0];
      const targetIds = idsByPage.get(target);
      if (!targetIds) {
        if (!existsSync(join(dist, target))) add('error', 'links', `link to ${href}: no such page or file`);
        continue;
      }
      if (hash && !targetIds.has(decodeURIComponent(hash))) add('error', 'links', `link to ${href}: no element with id "${hash}"`);
    }

    const visible = visibleText(text);
    for (const leak of sourceLeaks(visible)) add('error', 'leaks', `visible text contains ${leak}`);
    for (const glued of new Set(gluedText(visible))) add('warning', 'glued', `text runs together: "${glued}"`);
  }
  return findings;
}

/**
 * Checks content sources: unicode, glued text, link labels, and ka/en parity.
 * @param {string} contentDir
 * @returns {Promise<Finding[]>}
 */
export async function auditContent(contentDir) {
  /** @type {Finding[]} */
  const findings = [];
  const sources = (await filesIn(contentDir)).filter((file) => /\.(md|svg|json)$/.test(file));
  for (const file of sources) {
    const text = await readFile(file, 'utf8');
    const where = relative(process.cwd(), file);
    text.split('\n').forEach((line, index) => {
      for (const { word, codePoints } of mixedScriptWords(line)) {
        findings.push({ level: 'error', check: 'unicode', where: `${where}:${index + 1}`, message: `"${word}" mixes Georgian with ${codePoints.join(', ')}` });
      }
      if (file.endsWith('.md') && !line.startsWith('<!--')) {
        for (const glued of gluedText(line.replace(/`[^`]*`|\]\([^)]*\)/g, ' '))) {
          findings.push({ level: 'warning', check: 'glued', where: `${where}:${index + 1}`, message: `text runs together: "${glued}"` });
        }
      }
    });
    if (file.endsWith('.md')) {
      for (const { label, href } of markdownLinks(text)) {
        const why = labelMismatch(label, href);
        if (why) findings.push({ level: 'warning', check: 'link-label', where, message: `[${label}](${href}): ${why}` });
      }
    }
  }
  findings.push(...(await auditParity(contentDir)));
  return findings;
}

/**
 * Georgian and English versions of each guide, article and page must agree on front matter, item ids and
 * priorities, external sources, and (as a warning) the numbers in each section.
 * @param {string} contentDir
 * @returns {Promise<Finding[]>}
 */
export async function auditParity(contentDir) {
  /** @type {Finding[]} */
  const findings = [];
  for (const kind of ['guides', 'articles', 'pages']) {
    const enDir = join(contentDir, 'en', kind);
    const kaDir = join(contentDir, 'ka', kind);
    if (!existsSync(enDir) || !existsSync(kaDir)) continue;
    const names = new Set([...(await readdir(enDir)), ...(await readdir(kaDir))].filter((name) => name.endsWith('.md')));
    for (const name of names) {
      const where = `${kind}/${name}`;
      /** @param {'error' | 'warning'} level @param {string} message */
      const add = (level, message) => findings.push({ level, check: 'parity', where, message });
      if (!existsSync(join(enDir, name)) || !existsSync(join(kaDir, name))) {
        add('error', 'exists in only one language');
        continue;
      }
      const [en, ka] = await Promise.all([readFile(join(enDir, name), 'utf8'), readFile(join(kaDir, name), 'utf8')]);
      const enDoc = parseFrontMatter(en, join(enDir, name));
      const kaDoc = parseFrontMatter(ka, join(kaDir, name));
      for (const key of SHARED_KEYS) {
        if (String(enDoc.data[key] ?? '') !== String(kaDoc.data[key] ?? '')) add('error', `"${key}" differs: en ${enDoc.data[key] ?? '(none)'}, ka ${kaDoc.data[key] ?? '(none)'}`);
      }
      const priorities = (/** @type {string} */ body) =>
        [...body.matchAll(/^##\s.*\{#([\w-]+)([^}]*)\}\s*$/gm)].map((match) => `${match[1]}${/\.(essential|recommended|optional)\b/.exec(match[2])?.[0] ?? ''}`);
      if (priorities(enDoc.body).join(' ') !== priorities(kaDoc.body).join(' ')) add('error', 'item ids or priorities differ');

      const enLinks = new Set(markdownLinks(enDoc.body).map((link) => link.href));
      const kaLinks = new Set(markdownLinks(kaDoc.body).map((link) => link.href));
      const onlyEn = [...enLinks].filter((href) => !kaLinks.has(href));
      const onlyKa = [...kaLinks].filter((href) => !enLinks.has(href));
      if (onlyEn.length || onlyKa.length) add('warning', `sources differ: only en ${JSON.stringify(onlyEn)}, only ka ${JSON.stringify(onlyKa)}`);

      const enSections = sectionsById(enDoc.body);
      const kaSections = sectionsById(kaDoc.body);
      for (const [id, enText] of enSections) {
        const { onlyA, onlyB } = numberDiff(numbersIn(stripLinks(enText)), numbersIn(stripLinks(kaSections.get(id) ?? '')));
        if (onlyA.length || onlyB.length) add('warning', `#${id}: numbers differ (only en ${onlyA.join(', ') || '-'}; only ka ${onlyB.join(', ') || '-'})`);
      }
    }
  }
  return findings;
}

/** Link targets carry numbers (article ids, dates in URLs) that aren't part of the text. */
const stripLinks = (/** @type {string} */ text) => text.replace(/\]\([^)]*\)/g, ']').replace(/`[^`]*`/g, '');

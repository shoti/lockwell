// @ts-check
/**
 * @file Loads and validates all guides, articles, pages and UI strings for every language.
 */
import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { readingMinutes } from './article.mjs';
import { ContentError } from './errors.mjs';
import { loadFigures } from './figures.mjs';
import { AUDIENCES, GROUPS, parseFrontMatter, validateFrontMatter } from './frontmatter.mjs';
import { splitGuide } from './guide.mjs';
import { missingKeys } from './i18n.mjs';
import { assertUniqueIds, parseBlocks } from './markdown.mjs';
import { ROOT } from './site.mjs';

/** @typedef {import('./markdown.mjs').BlockNode} BlockNode */
/** @typedef {import('./guide.mjs').GuideItem} GuideItem */
/** @typedef {import('./i18n.mjs').Strings} Strings */
/** @typedef {import('./site.mjs').Site} Site */

/** @typedef {typeof AUDIENCES[number]} Audience */

/**
 * @typedef {object} Guide
 * @property {string} lang
 * @property {string} slug  Shared by all translations.
 * @property {string} file  Repo-relative path.
 * @property {string} route  e.g. "/guides/messaging/"
 * @property {string} title
 * @property {string} description  Meta description for search results.
 * @property {string} summary  One line shown under the title and on cards.
 * @property {Audience} audience  The track the guide is listed under.
 * @property {string} group  The topic group inside the track (see GROUPS in frontmatter.mjs).
 * @property {typeof import('./frontmatter.mjs').GUIDE_ICONS[number]} icon  Subject icon on its card (see GUIDE_ICONS).
 * @property {number} order  Position within its track.
 * @property {number} time  Estimated minutes.
 * @property {string} reviewed  YYYY-MM-DD
 * @property {boolean} draft  Drafts show a notice and are hidden from search engines.
 * @property {'local' | 'session'} progress  Where checklist progress is kept: until cleared, or only until the tab closes.
 * @property {boolean} legal  Steps that may carry legal risk: the page shows a fixed "not legal advice" notice.
 * @property {string} storageKey  Short id for saved progress, so storage keys don't spell out the topic (not secret; see storageKeyFor).
 * @property {BlockNode[]} intro
 * @property {GuideItem[]} items
 */

/**
 * A long-form article: prose without a checklist.
 * @typedef {object} Article
 * @property {string} lang
 * @property {string} slug  Shared by all translations.
 * @property {string} file  Repo-relative path.
 * @property {string} route  e.g. "/articles/end-to-end-encryption/"
 * @property {string} title
 * @property {string} description  Meta description for search results.
 * @property {string} summary  One line shown under the title and on cards.
 * @property {typeof import('./frontmatter.mjs').ARTICLE_ICONS[number]} icon  Subject icon on its card and above its title (see ARTICLE_ICONS).
 * @property {string} published  YYYY-MM-DD
 * @property {string | undefined} updated  YYYY-MM-DD, when the text last changed in substance.
 * @property {boolean} draft  Drafts show a notice and are hidden from search engines.
 * @property {number} minutes  Estimated reading time.
 * @property {BlockNode[]} body
 */

/**
 * @typedef {object} Page
 * @property {string} lang
 * @property {string} slug
 * @property {string} file
 * @property {string} route
 * @property {string} title
 * @property {string} description
 * @property {string | undefined} heading  Optional visible h1 when it should differ from the SEO title.
 * @property {string | undefined} eyebrow  Optional short line above the h1.
 * @property {BlockNode[]} body
 */

/**
 * @typedef {object} Content
 * @property {Record<string, Strings>} strings  UI strings per language.
 * @property {Record<string, Guide[]>} guides  Per language, sorted by track, then `order`.
 * @property {Record<string, Article[]>} articles  Per language, newest first.
 * @property {Record<string, Page[]>} pages
 * @property {Record<string, Map<string, import('./figures.mjs').Figure>>} figures  Per language, by name.
 * @property {string[]} warnings  Non-fatal issues to print after the build.
 */

/**
 * @typedef {object} LoadOptions
 * @property {string} contentDir
 * @property {Date} [now]  "Today", for the review-date check. Defaults to the current date.
 */

const SLUG = /^[a-z0-9][a-z0-9-]*$/;
const REQUIRED_PAGES = ['home', 'about'];
/** Guides not reviewed for this long produce a build warning. */
const REVIEW_MAX_DAYS = 365;

/** @type {Record<string, import('./frontmatter.mjs').FieldType>} */
const GUIDE_FIELDS = {
  title: 'text',
  description: 'text',
  summary: 'text',
  audience: 'audience',
  group: 'group',
  icon: 'icon',
  order: 'int',
  time: 'int',
  reviewed: 'date',
  status: 'status?',
  progress: 'progress?',
  legal: 'legal?',
};

/** @type {Record<string, import('./frontmatter.mjs').FieldType>} */
const ARTICLE_FIELDS = {
  title: 'text',
  description: 'text',
  summary: 'text',
  icon: 'articleIcon',
  published: 'date',
  updated: 'date?',
  status: 'status?',
};

/** @type {Record<string, import('./frontmatter.mjs').FieldType>} */
const PAGE_FIELDS = {
  title: 'text',
  description: 'text',
  heading: 'text?',
  eyebrow: 'text?',
};

/**
 * Loads and validates all content for every configured language.
 * @param {Site} site
 * @param {LoadOptions} options
 * @returns {Promise<Content>}
 */
export async function loadContent(site, { contentDir, now = new Date() }) {
  /** @type {Content} */
  const content = { strings: {}, guides: {}, articles: {}, pages: {}, figures: {}, warnings: [] };

  for (const lang of site.languages) {
    content.strings[lang] = await loadStrings(contentDir, lang);
    content.guides[lang] = await loadGuides(contentDir, lang, site);
    content.articles[lang] = await loadArticles(contentDir, lang);
    content.pages[lang] = await loadPages(contentDir, lang, site);
    content.figures[lang] = await loadFigures(contentDir, lang);
  }

  checkStrings(site, content);
  checkTranslations(site, content);
  checkFigures(site, content);
  checkDescriptions(site, content);
  checkReviewDates(site, content, now);
  return content;
}

/**
 * @param {string} contentDir
 * @param {string} lang
 * @returns {Promise<Strings>}
 */
async function loadStrings(contentDir, lang) {
  const file = join(contentDir, 'i18n', `${lang}.json`);
  try {
    return JSON.parse(await readFile(file, 'utf8'));
  } catch (error) {
    throw new Error(`Could not read UI strings ${relative(ROOT, file)}: ${error instanceof Error ? error.message : error}`);
  }
}

/**
 * @param {string} dir
 * @returns {Promise<{ slug: string, file: string, source: string }[]>}
 */
async function readMarkdownFiles(dir) {
  let names;
  try {
    names = await readdir(dir);
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return [];
    throw error;
  }
  const files = [];
  for (const name of names.filter((n) => n.endsWith('.md')).sort()) {
    const path = join(dir, name);
    const slug = name.slice(0, -3);
    const file = relative(ROOT, path);
    if (!SLUG.test(slug)) throw new ContentError(file, 0, `File names must be lowercase letters, digits and dashes (e.g. "my-guide.md"). Rename "${name}".`);
    files.push({ slug, file, source: await readFile(path, 'utf8') });
  }
  return files;
}

/**
 * Short id derived from the slug, the same in every language. Storage keys
 * then don't spell out the guide's topic at a glance. This is not secrecy:
 * anyone can match the id to a guide from the site's HTML. Real protection
 * for sensitive guides is `progress: session`.
 * @param {string} slug
 */
function storageKeyFor(slug) {
  return `g${createHash('sha256').update(slug).digest('hex').slice(0, 10)}`;
}

/**
 * @param {string} contentDir
 * @param {string} lang
 * @param {Site} site
 * @returns {Promise<Guide[]>}
 */
async function loadGuides(contentDir, lang, site) {
  const files = await readMarkdownFiles(join(contentDir, lang, 'guides'));
  const guides = files.map(({ slug, file, source }) => {
    const frontMatter = parseFrontMatter(source, file);
    const meta = validateFrontMatter(frontMatter, GUIDE_FIELDS, file);
    const nodes = parseBlocks(frontMatter.body, file, frontMatter.bodyLine);
    assertUniqueIds(nodes, file);
    const { intro, items } = splitGuide(nodes, file);
    // Someone at risk shouldn't leave a record of what they read on a phone that may be taken.
    if (meta.audience === 'high-risk' && meta.progress !== 'session') {
      throw new ContentError(file, frontMatter.lines.progress ?? frontMatter.lines.audience ?? 0, 'A guide with "audience: high-risk" must also set "progress: session", so its progress is not kept on the device.');
    }
    const audience = /** @type {Audience} */ (meta.audience);
    if (!GROUPS[audience].includes(String(meta.group))) {
      throw new ContentError(file, frontMatter.lines.group ?? 0, `"group: ${meta.group}" is not a group of the "${audience}" track. Use one of: ${GROUPS[audience].join(', ')}.`);
    }
    return {
      lang,
      slug,
      file,
      route: `/guides/${slug}/`,
      title: String(meta.title),
      description: String(meta.description),
      summary: String(meta.summary),
      audience,
      group: String(meta.group),
      icon: /** @type {Guide['icon']} */ (meta.icon),
      order: Number(meta.order),
      time: Number(meta.time),
      reviewed: String(meta.reviewed),
      draft: meta.status === 'draft',
      progress: /** @type {'local' | 'session'} */ (meta.progress ?? 'local'),
      legal: meta.legal === 'true',
      storageKey: storageKeyFor(slug),
      intro,
      items,
    };
  });
  if (guides.length === 0 && lang === site.defaultLang) {
    throw new Error(`No guides found in content/${lang}/guides/. Add at least one.`);
  }
  guides.sort((a, b) => AUDIENCES.indexOf(a.audience) - AUDIENCES.indexOf(b.audience) || a.order - b.order);
  // "order" is the reading order of a track: the lists, "Next guide" and "Continue" all follow it.
  guides.forEach((guide, i) => {
    const previous = guides[i - 1];
    if (previous?.audience !== guide.audience) return;
    if (previous.order === guide.order) {
      throw new ContentError(guide.file, 0, `"order: ${guide.order}" is already used by ${previous.file}. Give each guide in a track its own order number.`);
    }
    // Groups are listed one after another, so the reading order must not jump between them.
    const groups = GROUPS[guide.audience];
    if (groups.indexOf(guide.group) < groups.indexOf(previous.group)) {
      throw new ContentError(guide.file, 0, `"group: ${guide.group}" comes before "${previous.group}" (${previous.file}), but its "order" is higher. Number the guides group by group: ${groups.join(', ')}.`);
    }
  });
  return guides;
}

/**
 * @param {string} contentDir
 * @param {string} lang
 * @returns {Promise<Article[]>}
 */
async function loadArticles(contentDir, lang) {
  const files = await readMarkdownFiles(join(contentDir, lang, 'articles'));
  const articles = files.map(({ slug, file, source }) => {
    const frontMatter = parseFrontMatter(source, file);
    const meta = validateFrontMatter(frontMatter, ARTICLE_FIELDS, file);
    const body = parseBlocks(frontMatter.body, file, frontMatter.bodyLine);
    assertUniqueIds(body, file);
    if (body.length === 0) throw new ContentError(file, frontMatter.bodyLine, 'This article has no text below the front matter.');
    const published = String(meta.published);
    const updated = /** @type {string | undefined} */ (meta.updated);
    if (updated !== undefined && updated < published) {
      throw new ContentError(file, frontMatter.lines.updated ?? 0, `"updated" (${updated}) can't be earlier than "published" (${published}).`);
    }
    return {
      lang,
      slug,
      file,
      route: `/articles/${slug}/`,
      title: String(meta.title),
      description: String(meta.description),
      summary: String(meta.summary),
      icon: /** @type {Article['icon']} */ (meta.icon),
      published,
      updated,
      draft: meta.status === 'draft',
      minutes: readingMinutes(body),
      body,
    };
  });
  return articles.sort((a, b) => b.published.localeCompare(a.published) || a.slug.localeCompare(b.slug));
}

/**
 * @param {string} contentDir
 * @param {string} lang
 * @param {Site} site
 * @returns {Promise<Page[]>}
 */
async function loadPages(contentDir, lang, site) {
  const files = await readMarkdownFiles(join(contentDir, lang, 'pages'));
  const reserved = new Set(['guides', 'articles', 'tools', 'search', 'assets', 'fonts', ...site.languages]);
  const pages = files.map(({ slug, file, source }) => {
    if (reserved.has(slug)) throw new ContentError(file, 0, `"${slug}" is a reserved URL. Rename the page.`);
    const frontMatter = parseFrontMatter(source, file);
    const meta = validateFrontMatter(frontMatter, PAGE_FIELDS, file);
    const body = parseBlocks(frontMatter.body, file, frontMatter.bodyLine);
    assertUniqueIds(body, file);
    return {
      lang,
      slug,
      file,
      route: slug === 'home' ? '/' : `/${slug}/`,
      title: String(meta.title),
      description: String(meta.description),
      heading: /** @type {string | undefined} */ (meta.heading),
      eyebrow: /** @type {string | undefined} */ (meta.eyebrow),
      body,
    };
  });
  for (const required of REQUIRED_PAGES) {
    if (!pages.some((page) => page.slug === required)) {
      throw new Error(`Missing required page content/${lang}/pages/${required}.md.`);
    }
  }
  return pages;
}

/**
 * Every language must have the same UI string keys as the default language.
 * @param {Site} site
 * @param {Content} content
 */
function checkStrings(site, content) {
  const base = content.strings[site.defaultLang];
  for (const lang of site.languages.slice(1)) {
    const other = content.strings[lang];
    const missing = missingKeys(base, other);
    const extra = missingKeys(other, base);
    if (missing.length || extra.length) {
      throw new Error(
        `content/i18n/${lang}.json does not match ${site.defaultLang}.json.` +
          (missing.length ? ` Missing or a different kind (text vs. plural): ${missing.join(', ')}.` : '') +
          (extra.length ? ` Not in ${site.defaultLang}.json (or a different kind): ${extra.join(', ')}.` : ''),
      );
    }
  }
}

/**
 * Translations must share item ids and the progress setting, because saved
 * progress is keyed by them and should survive switching languages.
 * Missing translations are warnings.
 * @param {Site} site
 * @param {Content} content
 */
function checkTranslations(site, content) {
  const [base, ...others] = site.languages;
  for (const lang of others) {
    for (const guide of content.guides[lang]) {
      const original = content.guides[base].find((g) => g.slug === guide.slug);
      if (!original) {
        content.warnings.push(`${guide.file}: no ${base} version exists. Add content/${base}/guides/${guide.slug}.md.`);
        continue;
      }
      const ids = guide.items.map((i) => i.id).join(',');
      const originalIds = original.items.map((i) => i.id).join(',');
      if (ids !== originalIds) {
        throw new ContentError(guide.file, 0, `Item ids must match ${original.file} in the same order.\n  ${base}: ${originalIds}\n  ${lang}: ${ids}`);
      }
      if (guide.progress !== original.progress) {
        throw new ContentError(guide.file, 0, `"progress" must match ${original.file} (${original.progress}).`);
      }
      if (guide.audience !== original.audience) {
        throw new ContentError(guide.file, 0, `"audience" must match ${original.file} (${original.audience}).`);
      }
      if (guide.group !== original.group) {
        throw new ContentError(guide.file, 0, `"group" must match ${original.file} (${original.group}).`);
      }
      if (guide.icon !== original.icon) {
        throw new ContentError(guide.file, 0, `"icon" must match ${original.file} (${original.icon}).`);
      }
      if (guide.order !== original.order) {
        throw new ContentError(guide.file, 0, `"order" must match ${original.file} (${original.order}), so guides have the same number in every language.`);
      }
    }
    for (const article of content.articles[lang]) {
      const original = content.articles[base].find((a) => a.slug === article.slug);
      if (!original) {
        content.warnings.push(`${article.file}: no ${base} version exists. Add content/${base}/articles/${article.slug}.md.`);
      } else if (article.icon !== original.icon) {
        throw new ContentError(article.file, 0, `"icon" must match ${original.file} (${original.icon}).`);
      }
    }
    for (const kind of /** @type {const} */ (['guides', 'articles', 'pages'])) {
      for (const entry of content[kind][base]) {
        if (!content[kind][lang].some((translation) => translation.slug === entry.slug)) {
          content.warnings.push(`${entry.file}: not translated to ${lang} yet.`);
        }
      }
    }
  }
}

/**
 * The figures placed in some blocks, in order.
 * @param {BlockNode[]} nodes
 * @returns {import('./markdown.mjs').FigureNode[]}
 */
function figuresIn(nodes) {
  return nodes.filter((node) => node.type === 'figure');
}

/**
 * The parts of a guide that can hold figures: the intro, then each item with its tabs.
 * @param {Guide} guide
 * @returns {{ part: string, nodes: BlockNode[] }[]}
 */
function guideParts(guide) {
  return [
    { part: 'intro', nodes: guide.intro },
    ...guide.items.map((item) => ({ part: item.id, nodes: [...item.body, ...item.platforms.flatMap((platform) => platform.body)] })),
  ];
}

/**
 * Every figure placed in content must exist in that language, and appear once
 * per page (its ids must be unique). A translated guide places the same
 * figures in the same items, so both languages explain the same things.
 * Figure files nobody uses are warnings.
 * @param {Site} site
 * @param {Content} content
 */
function checkFigures(site, content) {
  for (const lang of site.languages) {
    const figures = content.figures[lang];
    const used = new Set();
    /** @type {{ file: string, nodes: BlockNode[] }[]} */
    const documents = [
      ...content.guides[lang].map((guide) => ({ file: guide.file, nodes: guideParts(guide).flatMap((p) => p.nodes) })),
      ...content.articles[lang].map((article) => ({ file: article.file, nodes: article.body })),
      ...content.pages[lang].map((page) => ({ file: page.file, nodes: page.body })),
    ];
    for (const { file, nodes } of documents) {
      const seen = new Set();
      for (const node of figuresIn(nodes)) {
        if (!figures.has(node.name)) {
          throw new ContentError(file, node.line, `Figure "${node.name}" doesn't exist. Add content/${lang}/figures/${node.name}.svg.`);
        }
        if (seen.has(node.name)) throw new ContentError(file, node.line, `Figure "${node.name}" is already on this page. Each figure can appear once per page.`);
        seen.add(node.name);
        used.add(node.name);
      }
    }
    for (const [name, figure] of figures) {
      if (!used.has(name)) content.warnings.push(`${figure.file}: not used in any ${lang} content.`);
    }
  }

  const [base, ...others] = site.languages;
  for (const lang of others) {
    for (const guide of content.guides[lang]) {
      const original = content.guides[base].find((g) => g.slug === guide.slug);
      if (!original) continue;
      // Item ids already match in the same order (checkTranslations), so the parts line up.
      const theirs = guideParts(original);
      for (const [i, { part, nodes }] of guideParts(guide).entries()) {
        const names = figuresIn(nodes).map((node) => node.name).join(', ');
        const expected = figuresIn(theirs[i].nodes).map((node) => node.name).join(', ');
        if (names !== expected) {
          throw new ContentError(guide.file, 0, `Figures in "${part}" must match ${original.file}.\n  ${base}: ${expected || '(none)'}\n  ${lang}: ${names || '(none)'}`);
        }
      }
    }
  }
}

/**
 * Search engines cut descriptions at roughly 155–160 characters.
 * @param {Site} site
 * @param {Content} content
 */
function checkDescriptions(site, content) {
  for (const lang of site.languages) {
    for (const entry of [...content.guides[lang], ...content.articles[lang], ...content.pages[lang]]) {
      if (entry.description.length > 170) {
        content.warnings.push(`${entry.file}: description is ${entry.description.length} characters; search results show about 160.`);
      }
    }
  }
}

/**
 * Privacy advice goes out of date quickly; flag guides nobody has rechecked.
 * @param {Site} site
 * @param {Content} content
 * @param {Date} now
 */
function checkReviewDates(site, content, now) {
  const dayMs = 24 * 60 * 60 * 1000;
  for (const lang of site.languages) {
    for (const guide of content.guides[lang]) {
      const age = Math.floor((now.getTime() - Date.parse(`${guide.reviewed}T00:00:00Z`)) / dayMs);
      if (age > REVIEW_MAX_DAYS) {
        content.warnings.push(`${guide.file}: last reviewed ${age} days ago (${guide.reviewed}). Recheck every step and update "reviewed".`);
      }
    }
  }
}

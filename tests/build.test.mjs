// @ts-check
// SPDX-FileCopyrightText: 2026 Shota Mtvarelishvili <mtvarelishvili@proton.me>
// SPDX-License-Identifier: MIT
/**
 * @file End-to-end tests: builds the real content and checks the output.
 * @author Shota Mtvarelishvili <mtvarelishvili@proton.me> (https://shoti.github.io/)
 */
/** End-to-end: builds the real content into a temp folder and checks the output. */
import assert from 'node:assert/strict';
import { appendFile, cp, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { gzipSync } from 'node:zlib';
import { build } from '../src/build/build.mjs';
import { PATHS } from '../src/build/site.mjs';
import { TOOLS } from '../src/build/tools.mjs';

/** @type {string} */
let outDir;
/** @type {string} */
let workDir;

/** @param {string} path */
const read = (path) => readFile(join(outDir, path), 'utf8');

/** Every built HTML page, as [path, html]. */
async function allPages() {
  const files = /** @type {string[]} */ (await readdir(outDir, { recursive: true })).filter((f) => f.endsWith('.html'));
  return Promise.all(files.map(async (file) => /** @type {[string, string]} */ ([file, await read(file)])));
}

/** Copies the real content so a test can modify it. */
async function contentCopy() {
  const dir = await mkdtemp(join(workDir, 'content-'));
  await cp(PATHS.content, dir, { recursive: true });
  return dir;
}

/** Turns every guide in a content copy back into a draft. @param {string} contentDir */
async function draftAllGuides(contentDir) {
  for (const lang of ['ka', 'en']) {
    const folder = join(contentDir, lang, 'guides');
    for (const name of await readdir(folder)) {
      const file = join(folder, name);
      const source = await readFile(file, 'utf8');
      assert.match(source, /^status: .+$/m, `${file} has a status line to change`);
      await writeFile(file, source.replace(/^status: .+$/m, 'status: draft'));
    }
  }
}

describe('site build', () => {
  before(async () => {
    workDir = await mkdtemp(join(tmpdir(), 'lockwell-test-'));
    outDir = join(workDir, 'dist');
    await build({ outDir, siteUrl: 'https://example.org/sub/' });
  });

  after(async () => {
    await rm(workDir, { recursive: true, force: true });
  });

  it('writes Georgian at the root and English under /en/', async () => {
    assert.match(await read('index.html'), /<html lang="ka"/);
    assert.match(await read('en/index.html'), /<html lang="en"/);
  });

  it('links the GitHub repository from site.json with an icon right after the theme toggle', async () => {
    for (const [path, label] of [['index.html', 'წყაროს კოდი GitHub-ზე'], ['en/index.html', 'Source code on GitHub']]) {
      const actions = /<div class="site-header__actions">([\s\S]*?)<\/div>/.exec(await read(path))?.[1] ?? '';
      const link = /<\/button>\s*(<a class="icon-button site-header__repo" href="https:\/\/github\.com\/shoti\/lockwell" rel="external noreferrer"><svg [^>]*aria-hidden="true"[^>]*><path d="M8 0c[^"]+"\/><\/svg><span class="visually-hidden">([^<]+)<\/span><\/a>)\s*$/.exec(actions);
      assert.ok(link, `${path}: GitHub link is the last header action, after the theme toggle`);
      assert.equal(link[2], label, `${path}: accessible name`);
    }
    // Below 360px four action buttons squeeze the logo out (measured in WebKit at 320px).
    assert.match(await read('assets/site.css'), /@media \(max-width: 22\.49rem\) \{\s*\.site-header__repo \{\s*display: none;/);
  });

  it('leaves the GitHub link out while site.json has no repo', async () => {
    const contentDir = await contentCopy();
    const siteFile = join(contentDir, 'site.json');
    await writeFile(siteFile, JSON.stringify({ ...JSON.parse(await readFile(siteFile, 'utf8')), repo: '' }));
    const plainOut = join(workDir, 'no-repo');
    await build({ outDir: plainOut, contentDir, siteUrl: 'https://example.org/' });
    const page = await readFile(join(plainOut, 'en/index.html'), 'utf8');
    const header = /<header class="site-header">[\s\S]*?<\/header>/.exec(page)?.[0] ?? '';
    assert.doesNotMatch(header, /github\.com|site-header__repo/);
    assert.match(header, /data-js="theme-toggle"/, 'the rest of the header is still there');
  });

  it('respects the base path in links and assets', async () => {
    const page = await read('guides/index.html');
    assert.match(page, /href="\/sub\/guides\/accounts\/"/);
    assert.match(page, /href="\/sub\/assets\/site\.css\?v=[0-9a-f]{10}"/);
    assert.doesNotMatch(page, /href="\/guides\//);
  });

  it('adds hreflang alternates, og:locale:alternate and a canonical link', async () => {
    const page = await read('en/guides/index.html');
    assert.match(page, /<link rel="canonical" href="https:\/\/example\.org\/sub\/en\/guides\/">/);
    assert.match(page, /hreflang="ka" href="https:\/\/example\.org\/sub\/guides\/"/);
    assert.match(page, /hreflang="x-default" href="https:\/\/example\.org\/sub\/guides\/"/);
    assert.match(page, /<meta property="og:locale:alternate" content="ka_GE">/);
  });

  it('keeps drafts out of search engines and the sitemap', async () => {
    assert.doesNotMatch(await read('guides/accounts/index.html'), /<meta name="robots" content="noindex">/, 'published guides are indexed');
    assert.match(await read('sitemap.xml'), /<loc>https:\/\/example\.org\/sub\/guides\/accounts\/<\/loc>/);

    const contentDir = await contentCopy();
    await draftAllGuides(contentDir);
    const draftsDir = join(workDir, 'drafts');
    await build({ outDir: draftsDir, contentDir, siteUrl: 'https://example.org/sub/' });
    assert.match(await readFile(join(draftsDir, 'guides/accounts/index.html'), 'utf8'), /<meta name="robots" content="noindex">/);
    const sitemap = await readFile(join(draftsDir, 'sitemap.xml'), 'utf8');
    assert.doesNotMatch(sitemap, /guides\/accounts/);
    assert.match(sitemap, /<loc>https:\/\/example\.org\/sub\/<\/loc>/);
  });

  it('renders checklist items with matching ids in both languages', async () => {
    /** @param {string} html */
    const ids = (html) => [...html.matchAll(/data-js="item-check" aria-labelledby="([a-z0-9-]+)__title/g)].map((m) => m[1]);
    const ka = ids(await read('guides/messaging/index.html'));
    assert.ok(ka.length > 0);
    assert.deepEqual(ka, ids(await read('en/guides/messaging/index.html')));
  });

  it('M5: every id on every page is unique', async () => {
    for (const [path, html] of await allPages()) {
      const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]);
      const duplicates = ids.filter((id, i) => ids.indexOf(id) !== i);
      assert.deepEqual(duplicates, [], `${path} has duplicate ids`);
    }
  });

  it('every page closes exactly the elements it opens', async () => {
    const tags = ['section', 'div', 'details', 'ul', 'ol', 'li', 'nav', 'aside', 'main', 'article', 'header', 'footer', 'a', 'span', 'p', 'button', 'label', 'svg'];
    for (const [path, html] of await allPages()) {
      for (const tag of tags) {
        const opened = html.match(new RegExp(`<${tag}[\\s>]`, 'g'))?.length ?? 0;
        const closed = html.match(new RegExp(`</${tag}>`, 'g'))?.length ?? 0;
        assert.equal(closed, opened, `${path}: <${tag}> opened ${opened} times, closed ${closed}`);
      }
    }
  });

  it('home page rows with a fixed column count hold exactly that many cards, so no column stays empty', async () => {
    for (const path of ['index.html', 'en/index.html']) {
      const page = await read(path);
      for (const [name, count] of /** @type {[string, number][]} */ ([['three', 3], ['four', 4]])) {
        const row = page.match(new RegExp(`<div class="card-grid card-grid--${name}">([\\s\\S]*?)</section>`))?.[1];
        assert.ok(row, `${path} has a card-grid--${name} row`);
        assert.equal(row.match(/<article[\s>]/g)?.length, count, `${path}: cards in the card-grid--${name} row`);
      }
    }
  });

  it('credits the author from site.json in the footer, meta tags and structured data', async () => {
    for (const path of ['index.html', 'en/index.html']) {
      const page = await read(path);
      assert.match(page, /<meta name="author" content="Shota Mtvarelishvili">/);
      const legal = /<p class="site-footer__legal">([\s\S]*?)<\/p>/.exec(page)?.[1].trim() ?? '';
      assert.equal(legal, '<span>© 2026 <a href="https://github.com/shoti" rel="author external noreferrer">Shota Mtvarelishvili</a></span>', `${path}: the legal row is the copyright line only`);
      assert.doesNotMatch(/<footer class="site-footer">[\s\S]*?<\/footer>/.exec(page)?.[0] ?? '', /mailto:|@proton/, `${path}: no email address in the footer`);
      assert.match(page, /"copyrightHolder":\{"@type":"Person","name":"Shota Mtvarelishvili"/);
    }
    const guide = await read('en/guides/accounts/index.html');
    assert.match(guide, /<meta property="article:author" content="https:\/\/github\.com\/shoti">/);
    assert.match(guide, /"author":\{"@type":"Person","name":"Shota Mtvarelishvili"/);
  });

  it('falls back to the site name when site.json has no author', async () => {
    const contentDir = await contentCopy();
    const file = join(contentDir, 'site.json');
    const config = JSON.parse(await readFile(file, 'utf8'));
    delete config.author;
    await writeFile(file, JSON.stringify(config));
    const plainDir = join(workDir, 'no-author');
    await build({ outDir: plainDir, contentDir, siteUrl: 'https://example.org/' });
    const home = await readFile(join(plainDir, 'en/index.html'), 'utf8');
    assert.doesNotMatch(home, /<meta name="author"|mailto:|copyrightHolder/);
    const guide = await readFile(join(plainDir, 'en/guides/accounts/index.html'), 'utf8');
    assert.doesNotMatch(guide, /article:author/);
    assert.match(guide, /"author":\{"@type":"Organization","name":"Lockwell"/);
    assert.match(await readFile(join(plainDir, 'en/feed.xml'), 'utf8'), /<author><name>Lockwell<\/name><\/author>/);
  });

  it('L16: loads nothing from other origins (scripts, styles, images, fonts, CSS urls)', async () => {
    for (const [path, html] of await allPages()) {
      const tags = [...html.matchAll(/<(script|link|img|source|iframe|video|audio)\b[^>]*>/g)].map((m) => m[0]);
      const external = tags
        .flatMap((tag) => [...tag.matchAll(/\s(?:src|href)="([^"]*)"/g)].map((m) => m[1]))
        .filter((url) => /^(https?:)?\/\//.test(url) && !url.startsWith('https://example.org/'));
      assert.deepEqual(external, [], `${path} loads external resources`);
    }
    const css = await read('assets/site.css');
    const cssUrls = [...css.matchAll(/url\(\s*["']?([^"')]+)/g)].map((m) => m[1]).filter((url) => /^(https?:)?\/\//.test(url));
    assert.deepEqual(cssUrls, [], 'CSS loads external resources');
  });

  it('allows the inline head script through the CSP by hash only', async () => {
    const page = await read('index.html');
    assert.match(page, /script-src 'self' 'sha256-[A-Za-z0-9+/=]+'/);
    assert.doesNotMatch(page, /unsafe-inline/);
  });

  it('M4: versions every module import so old and new JS never mix', async () => {
    const main = await read('assets/js/main.mjs');
    const imports = [...main.matchAll(/from '(\.\/[^']+)'/g)].map((m) => m[1]);
    assert.ok(imports.length >= 3);
    for (const specifier of imports) assert.match(specifier, /\.mjs\?v=[0-9a-f]{10}$/);
    const version = /main\.mjs\?v=([0-9a-f]{10})/.exec(await read('index.html'))?.[1];
    assert.ok(imports.every((specifier) => specifier.endsWith(`?v=${version}`)), 'imports use the same version as the entry');
  });

  it('H1: JS-only widgets are laid out by CSS, not revealed by script', async () => {
    const guide = await read('en/guides/messaging/index.html');
    // The hidden attribute itself, not an item id such as "hidden-apps" inside data-items.
    assert.doesNotMatch(guide, /data-js="(progress|card-progress|theme-toggle)"(?:\s+[\w-]+="[^"]*")*\s+hidden[\s>=]/);
    assert.match(guide, /class="progress js-only"/);
    assert.match(guide, /data-js="progress-text"[^>]*>0 of 8 done</, 'progress text is filled in before JS');
    assert.match(guide, /d\.dataset\.platform=/, 'the head script picks the platform before first paint');
    const css = await read('assets/site.css');
    assert.match(css, /\.no-js \.js-only/);
    assert.match(css, /\.js\[data-platform="android"\] \.platforms--multi:not\(\.platforms--tabs\) > \.platform\[data-platform="android"\]/);
  });

  it('H2: progress uses neutral storage keys and the clear-data button exists', async () => {
    const guide = await read('en/guides/messaging/index.html');
    const key = /data-js="checklist" data-guide="([^"]+)"/.exec(guide)?.[1] ?? '';
    assert.match(key, /^g[0-9a-f]{10}$/);
    assert.doesNotMatch(guide, /data-guide="messaging"/);
    assert.match(guide, /data-js="clear-data"/);
  });

  it('L13 + L14: theme-color can follow the toggle, and the logo has no var() in SVG attributes', async () => {
    const page = await read('index.html');
    assert.match(page, /<meta name="theme-color"[^>]+data-light="#fbfaf7" data-dark="#0f1622">/);
    assert.doesNotMatch(page, /="var\(/);
  });

  it('writes robots.txt, _headers, 404 and .nojekyll', async () => {
    assert.match(await read('robots.txt'), /Sitemap: https:\/\/example\.org\/sub\/sitemap\.xml/);
    assert.match(await read('_headers'), /frame-ancestors 'none'/);
    assert.match(await read('404.html'), /noindex/);
    assert.doesNotMatch(await read('404.html'), /og:url/, 'BUG-13: no og:url for a page that has no URL of its own');
    assert.equal(await read('.nojekyll'), '');
  });
});

describe('build safety and options', () => {
  before(async () => {
    workDir = await mkdtemp(join(tmpdir(), 'lockwell-test-'));
    outDir = join(workDir, 'dist');
  });

  after(async () => {
    await rm(workDir, { recursive: true, force: true });
  });

  it('M1: a failed build keeps the previous output and leaves no temp folders', async () => {
    await build({ outDir, siteUrl: 'https://example.org/' });
    const contentDir = await contentCopy();
    await appendFile(join(contentDir, 'en', 'pages', 'about.md'), '\nSee [x](/guides/missing/).\n');
    await assert.rejects(build({ outDir, contentDir, siteUrl: 'https://example.org/' }), /Broken internal link/);
    assert.match(await read('index.html'), /<html lang="ka"/, 'previous build is still there');
    const leftovers = (await readdir(workDir)).filter((name) => name.includes('-build-'));
    assert.deepEqual(leftovers, []);
  });

  it('H2: a guide with "progress: session" stores progress for this tab only', async () => {
    const contentDir = await contentCopy();
    for (const lang of ['ka', 'en']) {
      const file = join(contentDir, lang, 'guides', 'messaging.md');
      const source = await readFile(file, 'utf8');
      await writeFile(file, source.replace(/^status: .+$/m, (line) => `${line}\nprogress: session`));
    }
    await build({ outDir, contentDir, siteUrl: 'https://example.org/' });
    const guide = await read('en/guides/messaging/index.html');
    assert.match(guide, /data-js="checklist" data-guide="g[0-9a-f]{10}" data-storage="session"/);
    assert.match(guide, /forgotten when you close this tab/);
    assert.match(await read('en/index.html'), /data-js="card-progress" data-guide="g[0-9a-f]{10}" data-storage="session"/);
  });

  it('places figures as accessible inline SVG in both languages, and checks them', async () => {
    await build({ outDir, siteUrl: 'https://example.org/' });
    for (const path of ['guides/messaging/index.html', 'en/guides/messaging/index.html']) {
      const page = await read(path);
      const figure = /<figure class="figure" id="figure-account-takeover"><svg class="figure__art" [^>]*role="img" aria-labelledby="figure-account-takeover-title"[^>]*><title id="figure-account-takeover-title">[^<]+<\/title>/.exec(page);
      assert.ok(figure, `${path} has the account-takeover figure`);
      assert.match(page, /<figcaption class="figure__caption">[^<]+<\/figcaption><\/figure>/);
    }

    const missing = await contentCopy();
    await appendFile(join(missing, 'en', 'pages', 'about.md'), '\n![Caption](figure:nope)\n');
    await assert.rejects(build({ outDir, contentDir: missing, siteUrl: 'https://example.org/' }), /about\.md:\d+ — Figure "nope" doesn't exist/);

    const mismatch = await contentCopy();
    const file = join(mismatch, 'en', 'guides', 'messaging.md');
    await writeFile(file, (await readFile(file, 'utf8')).replace(/\n!\[[^\]]+\]\(figure:account-takeover\)\n/, '\n'));
    await assert.rejects(build({ outDir, contentDir: mismatch, siteUrl: 'https://example.org/' }), /Figures in "account-pin" must match/);

    const unused = await contentCopy();
    await cp(join(unused, 'en', 'figures', 'risk-grid.svg'), join(unused, 'en', 'figures', 'spare.svg'));
    const result = await build({ outDir, contentDir: unused, siteUrl: 'https://example.org/' });
    assert.ok(result.warnings.some((w) => /spare\.svg: not used/.test(w)), result.warnings.join('\n'));
  });

  it('BUG-11: warns that robots.txt is ignored when the site lives under a subpath', async () => {
    const sub = await build({ outDir, siteUrl: 'https://example.org/sub/' });
    assert.ok(sub.warnings.some((w) => /robots\.txt.*\/sub\//.test(w)), sub.warnings.join('\n'));
    const root = await build({ outDir, siteUrl: 'https://example.org/' });
    assert.ok(!root.warnings.some((w) => /robots\.txt/.test(w)));
  });

  it('L19: warns when a guide has not been reviewed for over a year', async () => {
    const result = await build({ outDir, siteUrl: 'https://example.org/', now: new Date('2028-01-01T00:00:00Z') });
    assert.ok(result.warnings.some((w) => /accounts\.md: last reviewed \d+ days ago/.test(w)), result.warnings.join('\n'));
    const fresh = await build({ outDir, siteUrl: 'https://example.org/', now: new Date('2026-12-01T00:00:00Z') });
    assert.ok(!fresh.warnings.some((w) => /last reviewed/.test(w)));
  });
});

describe('continue link and print button', () => {
  before(async () => {
    workDir = await mkdtemp(join(tmpdir(), 'lockwell-test-'));
    outDir = join(workDir, 'dist');
    await build({ outDir, siteUrl: 'https://example.org/' });
  });

  after(async () => {
    await rm(workDir, { recursive: true, force: true });
  });

  it('the home page reserves an empty continue link and tells it where each guide is', async () => {
    const home = await read('en/index.html');
    assert.match(home, /<p class="hero__continue js-only">\s*<a class="continue" data-js="continue">/, 'no href until JS finds saved progress');
    assert.match(home, /<span hidden data-js="continue-guide" data-guide="g[0-9a-f]{10}" data-storage="local" data-track="everyone" data-href="\/en\/guides\/accounts\/" data-title="Secure your accounts and passwords"/);
    const css = await read('assets/site.css');
    assert.match(css, /\.hero__continue \{[^}]*min-height: var\(--tap\);/, 'the line is reserved');
    assert.match(css, /\.continue \{[^}]*visibility: hidden;/);
  });

  it('the continue link carries every guide, by track, whichever cards the page shows', async () => {
    const guides = (await readdir(join('content', 'en', 'guides'))).filter((f) => f.endsWith('.md'));
    for (const path of ['en/index.html', 'en/guides/index.html']) {
      const page = await read(path);
      assert.equal(page.match(/data-js="continue-guide"/g)?.length, guides.length, path);
      assert.match(page, /data-storage="session" data-track="high-risk" data-href="\/en\/guides\/threat-modelling\/"/, path);
    }
    assert.doesNotMatch(await read('en/index.html'), /data-js="card-progress"[^>]*data-href/, 'cards only show progress');
  });

  it('the guides list reserves the same continue link', async () => {
    const page = await read('en/guides/index.html');
    assert.match(page, /<p class="page-header__continue js-only"><a class="continue" data-js="continue">/, 'no href until JS finds saved progress');
    const css = await read('assets/site.css');
    assert.match(css, /\.page-header__continue \{[^}]*min-height: var\(--tap\);/, 'the line is reserved');
  });

  it('guides and articles have a JS-only print button that is left out of the printout', async () => {
    const button = /<li class="js-only"><button class="link-button print-button" type="button" data-js="print">/;
    assert.match(await read('en/guides/messaging/index.html'), button);
    assert.match(await read('en/articles/end-to-end-encryption/index.html'), button);
    assert.doesNotMatch(await read('en/about/index.html'), /data-js="print"/);
    const print = (await read('assets/site.css')).split('@media print')[1];
    assert.match(print, /\.print-button,/);
  });
});

describe('step filters', () => {
  before(async () => {
    workDir = await mkdtemp(join(tmpdir(), 'lockwell-test-'));
    outDir = join(workDir, 'dist');
  });

  after(async () => {
    await rm(workDir, { recursive: true, force: true });
  });

  it('guides get JS-only filter toggles, and every item says its priority', async () => {
    await build({ outDir, siteUrl: 'https://example.org/' });
    const guide = await read('en/guides/messaging/index.html');
    assert.match(guide, /<div class="item-filters js-only" data-js="filters" role="group" aria-label="Filter steps">/);
    assert.match(guide, /data-js="filter" data-filter="essentialOnly" aria-pressed="false">Essential only</);
    assert.match(guide, /data-js="filter" data-filter="hideDone" aria-pressed="false">Hide done</);
    assert.match(guide, /id="account-pin" data-js="item" data-priority="essential"/);
    assert.match(guide, /<p class="items__empty" data-js="filter-empty" hidden>/);
  });

  it('leaves out "Essential only" when every item is essential', async () => {
    const contentDir = await contentCopy();
    for (const lang of ['ka', 'en']) {
      const file = join(contentDir, lang, 'guides', 'messaging.md');
      await writeFile(file, (await readFile(file, 'utf8')).replace(/\.(recommended|advanced)\}/g, '.essential}'));
    }
    await build({ outDir, contentDir, siteUrl: 'https://example.org/' });
    const guide = await read('en/guides/messaging/index.html');
    assert.doesNotMatch(guide, /data-filter="essentialOnly"/);
    assert.match(guide, /data-filter="hideDone"/);
  });
});

describe('search page', () => {
  before(async () => {
    workDir = await mkdtemp(join(tmpdir(), 'lockwell-test-'));
    outDir = join(workDir, 'dist');
    await build({ outDir, siteUrl: 'https://example.org/' });
  });

  after(async () => {
    await rm(workDir, { recursive: true, force: true });
  });

  it('lists every guide, step and article as plain links, so it works without JavaScript', async () => {
    const page = await read('en/search/index.html');
    assert.match(page, /<a class="search-result__link" href="\/en\/guides\/messaging\/">Make your messaging apps private<\/a>/);
    assert.match(page, /<p class="search-result__kind">Step · Make your messaging apps private<\/p>\s*<a class="search-result__link" href="\/en\/guides\/messaging\/#linked-devices">/);
    assert.match(page, /<a class="search-result__link" href="\/en\/articles\/end-to-end-encryption\/">/);
    const guideDir = join(PATHS.content, 'en', 'guides');
    const guideFiles = (await readdir(guideDir)).filter((name) => name.endsWith('.md'));
    const sources = await Promise.all(guideFiles.map((name) => readFile(join(guideDir, name), 'utf8')));
    const steps = sources.reduce((sum, source) => sum + (source.match(/^## /gm) ?? []).length, 0);
    const articles = (await readdir(join(PATHS.content, 'en', 'articles'))).filter((name) => name.endsWith('.md')).length;
    assert.ok(steps > guideFiles.length, 'guides have steps');
    assert.equal((page.match(/data-js="search-entry"/g) ?? []).length, guideFiles.length + steps + articles + TOOLS.length, 'every guide, step, article and tool');
    assert.match(page, /<div class="search js-only" role="search">/, 'the input needs JS; the list does not');
    assert.match(await read('search/index.html'), /<html lang="ka"/);
  });

  it('makes step instructions searchable, in lowercase, without showing them', async () => {
    const page = await read('en/search/index.html');
    const entry = /<li class="search-result" data-js="search-entry" data-title="check which devices are linked" data-text="([^"]*)">/.exec(page);
    assert.ok(entry, 'entry for the linked-devices step');
    // The client matches each query word on its own, so every word of the menu path must be there.
    for (const word of ['settings', 'account', 'desktop', 'tablets']) assert.ok(entry[1].includes(word), word);
    assert.doesNotMatch(entry[1], /\*\*/, 'no Markdown marks');
  });

  it('is linked from every header, is not indexed, and never puts the query in a URL', async () => {
    assert.match(await read('en/index.html'), /<a class="icon-button" href="\/en\/search\/">/);
    const page = await read('en/search/index.html');
    assert.match(page, /<a class="icon-button" href="\/en\/search\/" aria-current="page">/);
    assert.match(page, /<meta name="robots" content="noindex">/);
    assert.doesNotMatch(await read('sitemap.xml'), /search/);
    assert.doesNotMatch(page, /<form/, 'no form, so nothing is submitted');
    const client = await read('assets/js/search.mjs');
    assert.doesNotMatch(client, /location|history|URLSearchParams|fetch\(|Storage/, 'the query stays in memory');
  });

  it('stays within the page weight budget as sent (compressed)', async () => {
    for (const path of ['search/index.html', 'en/search/index.html']) {
      const bytes = gzipSync(await read(path)).length;
      assert.ok(bytes < 100_000, `${path} is ${bytes} bytes compressed; over 100 KB, trim the searchable text`);
    }
  });
});

describe('feed', () => {
  before(async () => {
    workDir = await mkdtemp(join(tmpdir(), 'lockwell-test-'));
    outDir = join(workDir, 'dist');
  });

  after(async () => {
    await rm(workDir, { recursive: true, force: true });
  });

  /** Publishes the given content files (removes "status: draft"). @param {string} contentDir @param {string[]} files */
  async function publish(contentDir, files) {
    for (const path of files) {
      const file = join(contentDir, path);
      await writeFile(file, (await readFile(file, 'utf8')).replace('status: draft\n', ''));
    }
  }

  it('writes no feed, and links to none, while everything is a draft', async () => {
    const contentDir = await contentCopy();
    await draftAllGuides(contentDir);
    await build({ outDir, contentDir, siteUrl: 'https://example.org/' });
    await assert.rejects(read('feed.xml'), /ENOENT/);
    await assert.rejects(read('en/feed.xml'), /ENOENT/);
    assert.doesNotMatch(await read('index.html'), /atom\+xml|feed\.xml/);
  });

  it('lists published guides and articles per language, newest first, and leaves drafts out', async () => {
    const contentDir = await contentCopy();
    await draftAllGuides(contentDir);
    await publish(contentDir, ['en/guides/accounts.md', 'ka/guides/accounts.md', 'en/articles/end-to-end-encryption.md']);
    await build({ outDir, contentDir, siteUrl: 'https://example.org/sub/' });

    const feed = await read('en/feed.xml');
    assert.match(feed, /^<\?xml version="1\.0" encoding="UTF-8"\?>\n<feed xmlns="http:\/\/www\.w3\.org\/2005\/Atom" xml:lang="en">/);
    assert.match(feed, /<link rel="self" type="application\/atom\+xml" href="https:\/\/example\.org\/sub\/en\/feed\.xml"\/>/);
    assert.match(feed, /<updated>2026-11-11T00:00:00Z<\/updated>\n {2}<author>/, 'feed date is the newest entry');
    assert.match(feed, /<author><name>Shota Mtvarelishvili<\/name><uri>https:\/\/github\.com\/shoti<\/uri><\/author>\n {2}<rights>© 2026 Shota Mtvarelishvili<\/rights>/);
    const ids = [...feed.matchAll(/<id>([^<]+)<\/id>/g)].map((m) => m[1]);
    assert.deepEqual(ids, [
      'https://example.org/sub/en/feed.xml',
      'https://example.org/sub/en/articles/end-to-end-encryption/',
      'https://example.org/sub/en/guides/accounts/',
    ]);
    assert.doesNotMatch(feed, /messaging/, 'drafts stay out');
    assert.match(feed, /<title>What end-to-end encryption means, and what it doesn&#39;t<\/title>/, 'text is escaped');
    assert.match(feed, /<published>2026-11-11T00:00:00Z<\/published>/);

    const ka = await read('feed.xml');
    assert.match(ka, /xml:lang="ka"/);
    assert.doesNotMatch(ka, /end-to-end-encryption/, 'the Georgian article is still a draft');

    const page = await read('en/about/index.html');
    assert.match(page, /<link rel="alternate" type="application\/atom\+xml" title="Lockwell" href="\/sub\/en\/feed\.xml">/);
    const footer = /<footer class="site-footer">[\s\S]*?<\/footer>/.exec(page)?.[0] ?? '';
    assert.doesNotMatch(footer, /feed\.xml/, 'the feed is found through <head>, not a footer link');
  });
});

describe('articles', () => {
  before(async () => {
    workDir = await mkdtemp(join(tmpdir(), 'lockwell-test-'));
    outDir = join(workDir, 'dist');
  });

  after(async () => {
    await rm(workDir, { recursive: true, force: true });
  });

  /**
   * Rewrites one front matter line of the sample article.
   * @param {string} contentDir
   * @param {string} lang
   * @param {string} from
   * @param {string} to
   */
  async function editArticle(contentDir, lang, from, to) {
    const file = join(contentDir, lang, 'articles', 'end-to-end-encryption.md');
    const source = await readFile(file, 'utf8');
    assert.ok(source.includes(from), `${from} not found in ${file}`);
    await writeFile(file, source.replace(from, to));
  }

  it('builds each article and the index in both languages, linked from the header and the home page', async () => {
    await build({ outDir, siteUrl: 'https://example.org/' });
    const article = await read('en/articles/end-to-end-encryption/index.html');
    assert.match(article, /<html lang="en"/);
    assert.match(article, /<div class="prose prose--article"><p>/);
    assert.match(article, /<time datetime="2026-11-11">11 November 2026<\/time>/);
    assert.match(article, /\d+ min read/);
    assert.match(article, /<a class="site-nav__link" href="\/en\/articles\/" aria-current="true">Articles<\/a>/);
    assert.match(article, /class="lang-switch" href="\/articles\/end-to-end-encryption\/" hreflang="ka"/, 'the language switch points to the translation');
    assert.match(article, /"datePublished":"2026-11-11","dateModified":"2026-11-11"/);
    assert.match(await read('articles/end-to-end-encryption/index.html'), /<html lang="ka"/);

    assert.match(await read('en/articles/index.html'), /<h2 class="card__title"><a class="card__link" href="\/en\/articles\/end-to-end-encryption\/">/);
    const home = await read('en/index.html');
    assert.match(home, /aria-labelledby="home__articles"/);
    assert.match(home, /<h3 class="card__title"><a class="card__link" href="\/en\/articles\/end-to-end-encryption\/">/);
  });

  it('keeps draft articles out of search engines, and lists published ones in the sitemap with their last change', async () => {
    await build({ outDir, siteUrl: 'https://example.org/' });
    assert.match(await read('articles/end-to-end-encryption/index.html'), /<meta name="robots" content="noindex">/);
    assert.doesNotMatch(await read('sitemap.xml'), /end-to-end-encryption/);

    const contentDir = await contentCopy();
    for (const lang of ['ka', 'en']) await editArticle(contentDir, lang, 'status: draft', 'updated: 2026-12-01');
    await build({ outDir, contentDir, siteUrl: 'https://example.org/' });
    const page = await read('en/articles/end-to-end-encryption/index.html');
    assert.doesNotMatch(page, /noindex/);
    assert.match(page, /Updated <time datetime="2026-12-01">/);
    assert.match(page, /"datePublished":"2026-11-11","dateModified":"2026-12-01"/);
    assert.match(await read('sitemap.xml'), /<loc>https:\/\/example\.org\/en\/articles\/end-to-end-encryption\/<\/loc>\s*<lastmod>2026-12-01<\/lastmod>/);
  });

  it('a language without articles gets no articles section, and the build says what is untranslated', async () => {
    const contentDir = await contentCopy();
    await rm(join(contentDir, 'en', 'articles'), { recursive: true });
    const guide = join(contentDir, 'en', 'guides', 'messaging.md');
    await writeFile(guide, (await readFile(guide, 'utf8')).replace(/\[([^\]]+)\]\(\/articles\/[^)]+\)/g, '$1'));
    const result = await build({ outDir, contentDir, siteUrl: 'https://example.org/' });
    assert.ok(result.warnings.some((w) => /ka\/articles\/end-to-end-encryption\.md: not translated to en yet/.test(w)), result.warnings.join('\n'));
    const home = await read('en/index.html');
    assert.doesNotMatch(home, /\/en\/articles\//);
    assert.doesNotMatch(home, /home__articles/);
    await assert.rejects(read('en/articles/index.html'), /ENOENT/);
    const ka = await read('articles/end-to-end-encryption/index.html');
    assert.match(ka, /class="lang-switch" href="\/en\/"/, 'the switch falls back to the other language’s home page');
    assert.doesNotMatch(ka, /hreflang="x-default"/, 'no alternates for a page that exists in one language');
  });

  it('rejects an "updated" date before "published", and a page that would take the /articles/ URL', async () => {
    const contentDir = await contentCopy();
    await editArticle(contentDir, 'en', 'status: draft', 'updated: 2026-11-10');
    await assert.rejects(build({ outDir, contentDir, siteUrl: 'https://example.org/' }), /end-to-end-encryption\.md:\d+ — "updated" \(2026-11-10\) can't be earlier than "published"/);

    const other = await contentCopy();
    await cp(join(other, 'en', 'pages', 'about.md'), join(other, 'en', 'pages', 'articles.md'));
    await assert.rejects(build({ outDir, contentDir: other, siteUrl: 'https://example.org/' }), /"articles" is a reserved URL/);
  });
});

describe('guide order', () => {
  before(async () => {
    workDir = await mkdtemp(join(tmpdir(), 'lockwell-test-'));
    outDir = join(workDir, 'dist');
  });

  after(async () => {
    await rm(workDir, { recursive: true, force: true });
  });

  /**
   * @param {string} contentDir
   * @param {string} lang
   */
  async function setMessagingOrder(contentDir, lang) {
    const file = join(contentDir, lang, 'guides', 'messaging.md');
    await writeFile(file, (await readFile(file, 'utf8')).replace('order: 3', 'order: 1'));
  }

  it('rejects two guides with the same order (cards would show the same number)', async () => {
    const contentDir = await contentCopy();
    for (const lang of ['ka', 'en']) await setMessagingOrder(contentDir, lang);
    await assert.rejects(build({ outDir, contentDir, siteUrl: 'https://example.org/' }), /ka\/guides\/messaging\.md — "order: 1" is already used by \S+ka\/guides\/accounts\.md/);
  });

  it('rejects a translation whose order differs from the original', async () => {
    const contentDir = await contentCopy();
    const file = join(contentDir, 'en', 'guides', 'hacked.md');
    await writeFile(file, (await readFile(file, 'utf8')).replace('order: 12', 'order: 30'));
    await assert.rejects(build({ outDir, contentDir, siteUrl: 'https://example.org/' }), /en\/guides\/hacked\.md — "order" must match \S+ka\/guides\/hacked\.md \(12\)/);
  });
});

describe('home page', () => {
  before(async () => {
    workDir = await mkdtemp(join(tmpdir(), 'lockwell-test-'));
    outDir = join(workDir, 'dist');
    await build({ outDir, siteUrl: 'https://example.org/' });
  });

  after(async () => {
    await rm(workDir, { recursive: true, force: true });
  });

  it('shows only the first three guides for everyone, and links to all of them with the count', async () => {
    const home = await read('en/index.html');
    const cards = [...home.matchAll(/<h3 class="card__title"><a class="card__link" href="\/en\/guides\/([a-z0-9-]+)\/">/g)].map((m) => m[1]);
    const order = async (/** @type {string} */ slug) => Number(/^order: (\d+)$/m.exec(await readFile(join('content', 'en', 'guides', `${slug}.md`), 'utf8'))?.[1]);
    assert.deepEqual(await Promise.all(cards.map(order)), [1, 2, 3]);
    const guides = (await readdir(join('content', 'en', 'guides'))).filter((f) => f.endsWith('.md'));
    assert.match(home, new RegExp(`<a class="section__more" href="/en/guides/">All ${guides.length} guides`));
  });

  it('gives people at higher risk their own way in: the security plan and their track', async () => {
    const home = await read('en/index.html');
    const card = /<div class="path-card">([\s\S]*?)<\/div>\s*<\/div>/.exec(home)?.[1] ?? '';
    assert.match(card, /<h3 class="path-card__title">At higher risk\?<\/h3>/);
    assert.match(card, /<a class="button" href="\/en\/guides\/threat-modelling\/">Make your security plan/);
    assert.match(card, /href="\/en\/guides\/#high-risk">For people at higher risk/);
    const homeKa = await read('index.html');
    assert.match(homeKa, /<h3 class="path-card__title">მეტი რისკის ქვეშ ხართ\?<\/h3>/);
    // The button has its own short label: the Georgian guide title wraps to two lines on a phone.
    assert.match(homeKa, /<a class="button" href="\/guides\/threat-modelling\/">უსაფრთხოების გეგმა</);
  });

  it('links straight to help for someone hacked or harassed right now', async () => {
    const line = /<p class="hero__urgent">([\s\S]*?)<\/p>/.exec(await read('en/index.html'))?.[1] ?? '';
    // The question is one element (icon and text) that takes its own row; the links follow it.
    assert.match(line, /^<span class="hero__urgent-label"><svg[\s\S]*?<\/svg><span>Hacked or harassed right now\?<\/span><\/span><a /);
    assert.deepEqual([...line.matchAll(/href="([^"]+)"/g)].map((m) => m[1]), ['/en/guides/hacked/', '/en/guides/harassment-doxxing/']);
  });

  it('names the promises once on the home page; the About page explains them', async () => {
    for (const [home, about, heading] of [['en/index.html', 'en/about/index.html', 'How this site respects your privacy'], ['index.html', 'about/index.html', 'როგორ იცავს ეს საიტი თქვენს კონფიდენციალურობას']]) {
      const page = await read(home);
      assert.equal((page.match(/<ul class="hero__trust"/g) ?? []).length, 1);
      assert.doesNotMatch(page, /class="promise|section--tinted/, 'no second, longer copy further down');
      assert.ok((await read(about)).includes(`>${heading}</h2>`), `${about} still explains the promises`);
    }
  });

  it('states the site\'s three promises under the hero', async () => {
    const trust = /<ul class="hero__trust" role="list">([\s\S]*?)<\/ul>/.exec(await read('en/index.html'))?.[1] ?? '';
    assert.deepEqual([...trust.matchAll(/<span>([^<]+)<\/span>/g)].map((m) => m[1]), ['No tracking', 'Stays on your device', 'Open and free']);
  });
});

describe('guides list rows', () => {
  before(async () => {
    workDir = await mkdtemp(join(tmpdir(), 'lockwell-test-'));
    outDir = join(workDir, 'dist');
    await build({ outDir, siteUrl: 'https://example.org/' });
  });

  after(async () => {
    await rm(workDir, { recursive: true, force: true });
  });

  /**
   * The rows of the English guides list, keyed by slug.
   * @returns {Promise<Map<string, string>>}
   */
  async function rows() {
    const page = await read('en/guides/index.html');
    const found = new Map();
    for (const row of page.split('<li class="guide-row">').slice(1)) {
      const slug = /href="\/en\/guides\/([a-z0-9-]+)\/"/.exec(row)?.[1];
      assert.ok(slug, 'every row links to its guide');
      found.set(slug, row);
    }
    return found;
  }

  it('lists every guide once, as a row in an ordered list per topic group, not as cards', async () => {
    const page = await read('en/guides/index.html');
    const guides = (await readdir(join('content', 'en', 'guides'))).filter((f) => f.endsWith('.md'));
    assert.equal((await rows()).size, guides.length);
    const { GROUPS } = await import('../src/build/frontmatter.mjs');
    const lists = [...page.matchAll(/<h3 class="guide-group__topic" id="group-([a-z]+)">[^<]+<\/h3>\s*<ol class="guide-list" role="list" aria-labelledby="group-\1">/g)].map((m) => m[1]);
    assert.deepEqual(lists, Object.values(GROUPS).flat(), 'one labelled list per group, tracks and groups in their fixed order');
    assert.equal(page.match(/<ol class="guide-list"/g)?.length, lists.length, 'no list without a heading');
    assert.doesNotMatch(page, /guide-row__number/, 'rows are not numbered: the groups carry the order');
    assert.doesNotMatch(page, /class="card"/);
    assert.match(await read('en/index.html'), /<h3 class="card__title">/, 'the home page keeps its cards');
  });

  it('each row lists all of its steps, in order, linking into the guide', async () => {
    for (const [slug, row] of await rows()) {
      const ids = /data-items="([^"]+)"/.exec(row)?.[1].split(' ') ?? [];
      const steps = [...row.matchAll(/<a class="step-list__link" href="\/en\/guides\/([a-z0-9-]+)\/#([a-z][a-z0-9-]*)" data-js="toc-link" data-item="\2">/g)];
      assert.ok(ids.length > 0, slug);
      assert.deepEqual(steps.map((m) => m[2]), ids, `${slug}: same steps as the guide, same order`);
      assert.ok(steps.every((m) => m[1] === slug), `${slug}: links point into its own guide`);
      assert.match(row, new RegExp(`<summary class="guide-row__toggle" aria-describedby="guide-${slug}__title">See all ${ids.length} steps</summary>`));
    }
  });

  it('the steps start collapsed and work without JavaScript', async () => {
    const page = await read('en/guides/index.html');
    assert.match(page, /<details class="guide-row__steps">/);
    assert.doesNotMatch(page, /<details class="guide-row__steps" open/);
    assert.doesNotMatch(page, /class="guide-row__steps[^"]*js-only/);
  });

  it('step lists know where their guide keeps progress, so finished steps can be marked', async () => {
    const all = await rows();
    assert.match(all.get('accounts') ?? '', /<ol class="step-list" role="list" data-js="guide-contents" data-guide="g[0-9a-f]{10}" data-storage="local">/);
    assert.match(all.get('protest') ?? '', /data-js="guide-contents" data-guide="g[0-9a-f]{10}" data-storage="session">/);
    assert.match(all.get('accounts') ?? '', /<span class="visually-hidden" data-js="toc-done" data-text="\(done\)"><\/span>/);
  });

  it('jump links lead to both tracks with their guide counts', async () => {
    const page = await read('en/guides/index.html');
    const count = (/** @type {string} */ track) => {
      const start = page.indexOf(`<section class="guide-group" id="${track}"`);
      const end = page.indexOf('</section>', start);
      return page.slice(start, end).split('<li class="guide-row">').length - 1;
    };
    const nav = /<nav class="track-nav" aria-label="Guide groups">([\s\S]*?)<\/nav>/.exec(page)?.[1] ?? '';
    assert.match(nav, new RegExp(`href="#everyone">For everyone<span class="track-nav__count">${count('everyone')}</span>`));
    assert.match(nav, new RegExp(`href="#high-risk">For people at higher risk<span class="track-nav__count">${count('high-risk')}</span>`));
    assert.match(await read('guides/index.html'), /aria-label="გზამკვლევების ჯგუფები"/);
  });

  it('the row link covers the row, but the steps toggle stays above it', async () => {
    const css = await read('assets/site.css');
    assert.match(css, /\.guide-row \{[^}]*position: relative;/);
    assert.match(css, /\.guide-row__link::after \{[^}]*inset: 0;/);
    assert.match(css, /\.guide-row__steps \{[^}]*position: relative;\s*z-index: 1;/);
    assert.doesNotMatch(/\.guide-list \{[^}]*\}/.exec(css)?.[0] ?? '', /overflow/, 'overflow would clip focus rings');
  });
});

describe('guide tracks', () => {
  before(async () => {
    workDir = await mkdtemp(join(tmpdir(), 'lockwell-test-'));
    outDir = join(workDir, 'dist');
  });

  after(async () => {
    await rm(workDir, { recursive: true, force: true });
  });

  /**
   * Rewrites a guide's front matter in a content copy.
   * @param {string} contentDir
   * @param {string} lang
   * @param {string} slug
   * @param {(source: string) => string} change
   * @param {string} [from]  Slug to copy the source from.
   */
  async function editGuide(contentDir, lang, slug, change, from = slug) {
    const source = await readFile(join(contentDir, lang, 'guides', `${from}.md`), 'utf8');
    await writeFile(join(contentDir, lang, 'guides', `${slug}.md`), change(source));
  }

  /** @param {number} order */
  const highRisk = (order) => (/** @type {string} */ source) =>
    source
      .replace(/^audience: .+$/m, 'audience: high-risk')
      .replace(/^group: .+$/m, 'group: teams')
      .replace(/^order: \d+$/m, `order: ${order}`)
      .replace(/^progress: .+\n/m, '')
      .replace(/^status: .+$/m, (line) => `${line}\nprogress: session`);

  /** A content copy with an extra high-risk guide, "zz-fixture", after the real ones. */
  async function withHighRiskGuides() {
    const contentDir = await contentCopy();
    for (const lang of ['ka', 'en']) {
      await editGuide(contentDir, lang, 'zz-fixture', highRisk(902), 'accounts');
    }
    return contentDir;
  }

  it('lists the two tracks as labelled sections, "For everyone" first', async () => {
    await build({ outDir, contentDir: await withHighRiskGuides(), siteUrl: 'https://example.org/' });
    const page = await read('en/guides/index.html');
    const everyone = page.indexOf('<section class="guide-group" id="everyone"');
    const risk = page.indexOf('<section class="guide-group" id="high-risk"');
    assert.ok(everyone > 0 && risk > everyone, 'both sections, in order');
    assert.match(page, /<h2 class="section__title" id="everyone__title">For everyone<\/h2>/);
    assert.match(page, /<h2 class="section__title" id="high-risk__title">For people at higher risk<\/h2>/);
    const accounts = page.indexOf('<a class="guide-row__link" href="/en/guides/accounts/"');
    assert.ok(accounts > everyone && accounts < risk, 'an everyone guide sits in the first section');
    assert.ok(page.indexOf('<a class="guide-row__link" href="/en/guides/zz-fixture/"') > risk, 'a high-risk guide sits in the second section');
    assert.match(page, /<h4 class="guide-row__title" id="guide-accounts__title">/, 'rows sit below the track (h2) and topic (h3) headings');
    assert.match(await read('guides/index.html'), /id="high-risk__title">მათთვის, ვინც მეტი რისკის ქვეშაა<\/h2>/);
  });

  it('leaves out a track that has no guides', async () => {
    const contentDir = await contentCopy();
    for (const lang of ['ka', 'en']) {
      for (const name of await readdir(join(contentDir, lang, 'guides'))) {
        const file = join(contentDir, lang, 'guides', name);
        if (/^audience: high-risk$/m.test(await readFile(file, 'utf8'))) await rm(file);
      }
    }
    await build({ outDir, contentDir, siteUrl: 'https://example.org/' });
    assert.doesNotMatch(await read('en/guides/index.html'), /id="high-risk"/);
    assert.doesNotMatch(await read('en/guides/index.html'), /class="track-nav"/, 'no jump links for a single track');
    assert.doesNotMatch(await read('en/index.html'), /#high-risk/);
    assert.doesNotMatch(await read('en/index.html'), /class="path-card"/);
    assert.doesNotMatch(await read('en/index.html'), /harassment-doxxing/, 'an urgent link to a missing guide is left out');
    assert.match(await read('en/index.html'), /<p class="hero__urgent">[\s\S]*?href="\/en\/guides\/hacked\/"/);
  });

  it('shows the fixed notice on high-risk guides only, linking to the threat-modelling guide', async () => {
    await build({ outDir, contentDir: await withHighRiskGuides(), siteUrl: 'https://example.org/' });
    const guide = await read('en/guides/zz-fixture/index.html');
    assert.match(guide, /<p class="notice">.*No checklist makes anyone fully safe.* <a href="\/en\/guides\/threat-modelling\/">Start here: work out your risks\.<\/a><\/span><\/p>/s);
    assert.match(guide, /data-js="checklist" data-guide="g[0-9a-f]{10}" data-storage="session"/);
    const start = await read('en/guides/threat-modelling/index.html');
    assert.match(start, /<p class="notice">/);
    assert.doesNotMatch(start, /Start here: work out your risks/, 'the start guide does not link to itself');
    assert.doesNotMatch(await read('en/guides/accounts/index.html'), /class="notice"/);
    assert.match(await read('guides/zz-fixture/index.html'), /<a href="\/guides\/threat-modelling\/">დაიწყეთ აქედან/);
  });

  it('keeps the home page to the "everyone" track, with a link to the other', async () => {
    await build({ outDir, contentDir: await withHighRiskGuides(), siteUrl: 'https://example.org/' });
    const home = await read('en/index.html');
    assert.match(home, /class="card__link" href="\/en\/guides\/accounts\/"/);
    assert.doesNotMatch(home, /class="card__link" href="\/en\/guides\/zz-fixture\//, 'no card for a high-risk guide');
    assert.match(home, /<a class="section__more" href="\/en\/guides\/#high-risk">For people at higher risk/);
  });

  it('numbers each track on its own, and "next guide" stays inside the track', async () => {
    const contentDir = await withHighRiskGuides();
    for (const lang of ['ka', 'en']) {
      await editGuide(contentDir, lang, 'zz-last', (source) => source.replace(/^order: \d+$/m, 'order: 902').replace(/^group: .+$/m, 'group: recovery'), 'accounts');
    }
    await build({ outDir, contentDir, siteUrl: 'https://example.org/' });
    assert.doesNotMatch(await read('en/guides/zz-last/index.html'), /class="next-link"/, 'last "everyone" guide does not lead into the high-risk track');
    assert.match(await read('en/guides/threat-modelling/index.html'), /<a class="next-link" href="\/en\/guides\/phone-hardening\/">/);
    assert.doesNotMatch(await read('en/guides/zz-fixture/index.html'), /class="next-link"/, 'last high-risk guide has no next link');
  });

  it('rejects a high-risk guide that keeps progress on the device', async () => {
    const contentDir = await withHighRiskGuides();
    for (const lang of ['ka', 'en']) {
      await editGuide(contentDir, lang, 'zz-fixture', (source) => source.replace('progress: session', 'progress: local'));
    }
    await assert.rejects(build({ outDir, contentDir, siteUrl: 'https://example.org/' }), /guides\/zz-fixture\.md:\d+ — A guide with "audience: high-risk" must also set "progress: session"/);
  });

  it('rejects a guide without an audience, and a translation in another track', async () => {
    const missing = await contentCopy();
    await editGuide(missing, 'ka', 'accounts', (source) => source.replace(/^audience: .+\n/m, ''));
    await assert.rejects(build({ outDir, contentDir: missing, siteUrl: 'https://example.org/' }), /ka\/guides\/accounts\.md:\d+ — Missing required front matter key "audience"/);

    const mismatch = await withHighRiskGuides();
    await editGuide(mismatch, 'en', 'zz-fixture', (source) => source.replace('audience: high-risk', 'audience: everyone').replace('group: teams', 'group: recovery'));
    await assert.rejects(build({ outDir, contentDir: mismatch, siteUrl: 'https://example.org/' }), /en\/guides\/zz-fixture\.md — "audience" must match \S+ka\/guides\/zz-fixture\.md \(high-risk\)/);
  });
});

describe('final review fixes (output)', () => {
  /** The temp folder this suite owns; the only thing its cleanup may delete. @type {string | undefined} */
  let work;
  /** @type {string} */
  let dir;
  /** @param {string} path */
  const readOut = (path) => readFile(join(dir, path), 'utf8');

  before(async () => {
    work = await mkdtemp(join(tmpdir(), 'lockwell-final-'));
    dir = join(work, 'dist');
    await build({ outDir: dir, siteUrl: 'https://example.org/' });
  });

  // Never a path worked out from `dir`: when the build failed, "the parent of
  // dir" used to be the system temp folder itself.
  after(async () => {
    if (work) await rm(work, { recursive: true, force: true });
  });

  it('R1, R4, R6, R8, R9, R10, R11: CSS rules are in place', async () => {
    const css = await readOut('assets/site.css');
    assert.match(css, /\.guide-aside \{\s*align-self: stretch;/, 'R1 sidebar spans the row so it can stick');
    assert.equal((css.match(/font-display: optional;/g) ?? []).length, 2, 'R4 both fonts use optional');
    assert.doesNotMatch(css, /font-display: swap/);
    assert.match(css, /\.tab:focus-visible \{\s*outline-offset: -3px;/, 'R6 tab ring drawn inside');
    assert.doesNotMatch(css, /scroll-padding-top/, 'R8 no double scroll offset');
    assert.doesNotMatch(css, /\.card:focus-within/, 'R9 no ring after mouse clicks');
    assert.match(css, /\.hero \.hero__lead \{\s*max-width: 38rem;/, 'R10 hero width wins over .prose');
    assert.match(css, /\.not-found > \* \{\s*max-width: 40rem;/, 'R11 404 aligned with header');
  });

  it('a wide tab bar scrolls inside its item instead of widening the page on phones', async () => {
    const css = await readOut('assets/site.css');
    for (const selector of ['.items', '.item', '.item__body']) {
      const rule = new RegExp(`\\n  ${selector.replace('.', '\\.')} \\{[^}]*grid-template-columns: minmax\\(0, 1fr\\);`);
      assert.match(css, rule, `${selector} must not grow with its content`);
    }
  });

  it('R5: cards show a compact count, with the full sentence for screen readers', async () => {
    const page = await readOut('en/index.html');
    assert.match(page, /class="card-progress__text" data-js="progress-text" data-template="\{done\}\/\{total\}" aria-hidden="true"/);
    assert.match(page, /class="visually-hidden" data-js="progress-text" data-template="\{done\} of \{total\} done"/);
  });

  it('R7: the theme icon follows the theme in CSS, not aria-pressed', async () => {
    const css = await readOut('assets/site.css');
    assert.doesNotMatch(css, /aria-pressed="(true|false)"\] \.icon-button/);
    assert.match(css, /:root\[data-theme="dark"\] \.icon-button__off/);
  });

  it('R12: the badge sits above a row with the checkbox and the title', async () => {
    const page = await readOut('en/guides/messaging/index.html');
    assert.match(page, /<div class="item__head">\s*<span class="badge[^"]*">[^<]*<\/span>\s*<div class="item__row">\s*<input class="checkbox item__check"[^>]*>\s*<h2 class="item__title"/);
  });

  it('R13: titles are short and don’t repeat the site name', async () => {
    assert.match(await readOut('en/about/index.html'), /<title>About Lockwell — free privacy guides for Georgia<\/title>/);
    assert.match(await readOut('about/index.html'), /<title>Lockwell-ის შესახებ — უფასო გზამკვლევები<\/title>/);
    const kaHome = /<title>([^<]*)<\/title>/.exec(await readOut('index.html'))?.[1] ?? '';
    assert.ok(kaHome.length <= 50, `Georgian home title is ${kaHome.length} characters`);
  });

  it('R14: platform groups name their platforms, and the CSS needs no :has() for them', async () => {
    const page = await readOut('en/guides/messaging/index.html');
    assert.match(page, /class="platforms platforms--multi platforms--has-ios platforms--has-android platforms--has-desktop"/);
    const css = await readOut('assets/site.css');
    assert.doesNotMatch(css, /platforms--multi:not\(\.platforms--tabs\):has/);
  });

  it('UI-4, UI-5, UI-6: labels, status and done text are in the HTML', async () => {
    const page = await readOut('en/guides/messaging/index.html');
    assert.match(page, /<h2 class="item__title" id="account-pin__title"><label for="account-pin__check">/, 'UI-5 title is the label');
    assert.match(page, /<span class="visually-hidden" data-js="toc-done" data-text="\(done\)"><\/span>/, 'UI-6');
    assert.match(page, /role="status" data-js="clear-data-status"/, 'UI-4');
    assert.match(await readOut('guides/messaging/index.html'), /data-js="toc-done" data-text="\(შესრულებულია\)"/);
  });

  it('ARC-1: the CSS can show every platform key before JS runs', async () => {
    const { PLATFORM_KEYS } = await import('../src/build/guide.mjs');
    const css = await readOut('assets/site.css');
    for (const key of PLATFORM_KEYS) {
      assert.ok(css.includes(`.js[data-platform="${key}"] .platforms--multi:not(.platforms--tabs) > .platform[data-platform="${key}"]`), `show rule for ${key}`);
      assert.ok(css.includes(`.js[data-platform="${key}"] .platforms--has-${key}:not(.platforms--tabs)`), `hide-first rule for ${key}`);
    }
  });
});

describe('UX review 2026-11-12', () => {
  /** The temp folder this suite owns; the only thing its cleanup may delete. @type {string | undefined} */
  let work;
  /** @type {string} */
  let dir;
  /** @param {string} path */
  const readOut = (path) => readFile(join(dir, path), 'utf8');

  before(async () => {
    work = await mkdtemp(join(tmpdir(), 'lockwell-ux-'));
    dir = join(work, 'dist');
    await build({ outDir: dir, siteUrl: 'https://example.org/' });
  });

  // Never a path worked out from `dir`: when the build failed, "the parent of
  // dir" used to be the system temp folder itself.
  after(async () => {
    if (work) await rm(work, { recursive: true, force: true });
  });

  it('UX-2: only "About" leaves the header on narrow screens, and the header becomes one row where three Georgian links fit', async () => {
    for (const [page, about] of [['index.html', '/about/'], ['en/index.html', '/en/about/']]) {
      const nav = /<ul class="site-nav__list" role="list">([\s\S]*?)<\/ul>/.exec(await readOut(page))?.[1] ?? '';
      const items = [...nav.matchAll(/<li( class="site-nav__item--wide")?><a class="site-nav__link" href="([^"]+)"/g)].map((m) => [m[2], Boolean(m[1])]);
      assert.equal(items.length, 4, page);
      assert.deepEqual(items.filter(([, wide]) => wide), [[about, true]], page);
      assert.deepEqual(items.at(-1), [about, true], 'the link that can disappear is the last one');
    }
    const css = await readOut('assets/site.css');
    assert.match(css, /@media \(max-width: 49\.99rem\) \{\s*\.site-nav__item--wide \{\s*display: none;/);
    assert.match(css, /@media \(min-width: 45rem\) \{\s*\.site-header__inner \{[^}]*grid-template-areas: "brand nav actions";/);
    // 40rem was too early: four Georgian links wrapped to a second row between 640 and 790px.
    assert.doesNotMatch(css, /@media \(min-width: 40rem\) \{\s*\.site-(header|nav)/);
  });

  it('UX-4: the dark colors are for screens only, so a printed guide is always dark text on white', async () => {
    const css = await readOut('assets/site.css');
    const darkBlocks = [...css.matchAll(/color-scheme: dark;/g)].map((m) => m.index);
    assert.equal(darkBlocks.length, 2, 'the system setting and the manual toggle');
    for (const at of darkBlocks) {
      const media = css.slice(css.lastIndexOf('@media', at), at);
      assert.match(media, /^@media screen( and \(prefers-color-scheme: dark\))? \{\s*:root[^{]*\{\s*$/, 'the dark block sits directly inside a screen-only media query');
    }
    assert.doesNotMatch(css, /@media \(prefers-color-scheme: dark\) \{\s*:root:not\(\[data-theme="light"\]\) \{\s*color-scheme/);
  });

  it('decorative numbers, icons and the logo are hidden from screen readers', async () => {
    const guides = await readOut('en/guides/index.html');
    const numbers = (await readOut('en/index.html')).match(/<span class="guide-card__number"[^>]*>/g) ?? [];
    assert.ok(numbers.length > 0);
    assert.ok(numbers.every((tag) => tag.includes('aria-hidden="true"')));
    const icons = guides.match(/<svg class="(icon|logo)"[^>]*>/g) ?? [];
    assert.ok(icons.length > 0);
    assert.deepEqual(icons.filter((tag) => !tag.includes('aria-hidden="true"')), []);
  });

  it('share previews call guides and articles "article" and everything else "website"', async () => {
    const type = async (/** @type {string} */ page) => /<meta property="og:type" content="([^"]+)">/.exec(await readOut(page))?.[1];
    assert.equal(await type('en/index.html'), 'website');
    assert.equal(await type('en/guides/index.html'), 'website');
    assert.equal(await type('en/tools/password-generator/index.html'), 'website');
    assert.equal(await type('en/guides/messaging/index.html'), 'article');
  });
});

describe('guides by topic, and the "All guides" sidebar', () => {
  /** @type {string} */
  let work;
  /** @type {string} */
  let dir;
  /** @param {string} path */
  const readOut = (path) => readFile(join(dir, path), 'utf8');

  before(async () => {
    work = await mkdtemp(join(tmpdir(), 'lockwell-nav-'));
    dir = join(work, 'dist');
    await build({ outDir: dir, siteUrl: 'https://example.org/' });
  });

  after(async () => {
    await rm(work, { recursive: true, force: true });
  });

  /** The front matter value of `key` in an English guide. @param {string} slug @param {string} key */
  const meta = async (slug, key) => new RegExp(`^${key}: (.+)$`, 'm').exec(await readFile(join('content', 'en', 'guides', `${slug}.md`), 'utf8'))?.[1];

  /**
   * The sidebar of a page as [track, group, slug, current?] per link, in order.
   * @param {string} page
   */
  function sidebar(page) {
    const nav = /<nav class="toc__list guide-nav__body" aria-label="[^"]+">([\s\S]*?)<\/nav>/.exec(page)?.[1] ?? '';
    /** @type {[string, string, string, boolean][]} */
    const links = [];
    let track = '';
    let group = '';
    for (const m of nav.matchAll(/<details class="guide-nav__track" name="guide-tracks" data-track="([a-z-]+)"(?: open)?>|<p class="guide-nav__group" id="guide-nav__([a-z]+)">|<a class="toc__link guide-nav__link" href="\/en\/guides\/([a-z0-9-]+)\/"( aria-current="page" data-js="nav-current")?>/g)) {
      if (m[1]) track = m[1];
      else if (m[2]) group = m[2];
      else links.push([track, group, m[3], Boolean(m[4])]);
    }
    return links;
  }

  it('the guides list has a sidebar with every guide once, under its own track and topic', async () => {
    const links = sidebar(await readOut('en/guides/index.html'));
    const guides = (await readdir(join('content', 'en', 'guides'))).filter((f) => f.endsWith('.md')).map((f) => f.replace('.md', ''));
    assert.deepEqual(links.map(([, , slug]) => slug).sort(), guides.sort());
    for (const [track, group, slug, current] of links) {
      assert.equal(track, await meta(slug, 'audience'), `${slug}: track`);
      assert.equal(group, await meta(slug, 'group'), `${slug}: group`);
      assert.equal(current, false, 'no guide is "the current page" on the list itself');
    }
  });

  it('the sidebar and the rows list the guides in the same order: the reading order', async () => {
    const page = await readOut('en/guides/index.html');
    const fromSidebar = sidebar(page).map(([, , slug]) => slug);
    const fromRows = [...page.matchAll(/<a class="guide-row__link" href="\/en\/guides\/([a-z0-9-]+)\/"/g)].map((m) => m[1]);
    assert.deepEqual(fromSidebar, fromRows);
    const next = async (/** @type {string} */ slug) => /<a class="next-link" href="\/en\/guides\/([a-z0-9-]+)\/">/.exec(await readOut(`en/guides/${slug}/index.html`))?.[1];
    for (let i = 0; i < fromRows.length - 1; i += 1) {
      const sameTrack = (await meta(fromRows[i], 'audience')) === (await meta(fromRows[i + 1], 'audience'));
      assert.equal(await next(fromRows[i]), sameTrack ? fromRows[i + 1] : undefined, `"Next guide" after ${fromRows[i]}`);
    }
  });

  /** Which tracks of a page's sidebar start open. @param {string} page */
  const openTracks = (page) => [...page.matchAll(/<details class="guide-nav__track" name="guide-tracks" data-track="([a-z-]+)" open>/g)].map((m) => m[1]);

  it('the same sidebar is on the guides list and on every guide, open, with the guide being read marked', async () => {
    const open = /<details class="toc guide-nav" data-js="toc" open>\s*<summary class="toc__summary">All guides<\/summary>/;
    const list = await readOut('en/guides/index.html');
    assert.match(list, open);
    assert.deepEqual(openTracks(list), ['everyone'], 'on the list the first track is open');
    assert.match(list, /<aside class="guide-aside guide-aside--nav">/, 'shown on phones too, where the script closes it');

    const guide = await readOut('en/guides/protest/index.html');
    assert.match(guide, open, 'not collapsed: the overview stays in view while reading');
    assert.deepEqual(openTracks(guide), ['high-risk'], 'the track of the guide being read is open');
    assert.deepEqual(openTracks(await readOut('en/guides/accounts/index.html')), ['everyone']);
    assert.match(guide, /<summary class="guide-nav__track-title">For people at higher risk<\/summary>/);
    // Sharing a name makes the browser close one track when the other is opened: never both, so the list stays short.
    assert.equal((guide.match(/<details class="guide-nav__track" name="guide-tracks"/g) ?? []).length, 2);
    assert.deepEqual(sidebar(guide).filter(([, , , current]) => current).map(([, , slug]) => slug), ['protest']);
    assert.deepEqual(sidebar(guide).map(([, , slug]) => slug), sidebar(list).map(([, , slug]) => slug), 'same guides, same order');
    assert.match(guide, /<a class="toc__link guide-nav__link" href="\/en\/guides\/protest\/" aria-current="page" data-js="nav-current">/, 'the script can bring it into view');
    assert.match(guide, /<aside class="guide-aside guide-aside--nav guide-aside--page">\s*<div class="guide-aside__inner" data-js="nav-scroll">/);
    const css = await readOut('assets/site.css');
    assert.match(css, /@media \(max-width: 63\.99rem\) \{\s*\.guide-aside--page \{\s*display: none;/, 'on a phone a guide starts with the guide; the breadcrumb leads to the overview');
    assert.match(await readOut('guides/index.html'), /<summary class="toc__summary">ყველა გზამკვლევი<\/summary>/);
  });

  it('a guide page reads in order: title, "All guides", its own progress and steps, then the text', async () => {
    const guide = await readOut('en/guides/protest/index.html');
    const order = ['<div class="guide-head">', '<h1 class="page-header__title">', '<aside class="guide-aside guide-aside--nav guide-aside--page">', '<aside class="guide-aside guide-aside--rail" aria-label="In this guide">', '<div class="progress js-only" data-js="progress">', '<details class="toc toc--rail" data-js="toc" open>', '<div class="guide-main">'].map((part) => guide.indexOf(part));
    assert.ok(order.every((at) => at !== -1), `every part is on the page: ${order}`);
    assert.deepEqual(order, [...order].sort((x, y) => x - y), 'in this order, which is also the keyboard order');
    assert.equal((guide.match(/data-js="toc"/g) ?? []).length, 2);
    const css = await readOut('assets/site.css');
    // The contents list is open only where it has its own column; the script reads this width from the element.
    assert.match(css, /\.toc--rail \{\s*--bp-wide: 80rem;/);
    assert.match(css, /@media \(min-width: 80rem\) \{\s*\.guide-layout--guide \{[^}]*grid-template-areas:\s*"nav head rail"\s*"nav main rail";/);
    assert.match(css, /@media \(max-width: 79\.99rem\) \{\s*\.js \.toc--rail:not\(\[data-ready\]\) > \.toc__list \{\s*display: none;/, 'no jump while the script closes it');
  });

  it('the sidebar is a cell of the same grid on the list and on a guide, so it never changes place between pages', async () => {
    for (const page of ['en/guides/index.html', 'en/guides/protest/index.html', 'en/guides/accounts/index.html']) {
      const html = await readOut(page);
      // Nothing of varying height (breadcrumb, title, summary) may sit between the container and the grid.
      assert.match(html, /<div class="container page">\s*<div class="guide-layout guide-layout--(index|guide)"[^>]*>\s*<div class="guide-head">\s*<nav class="breadcrumbs"/, `${page}: the title block is a cell of the grid`);
      assert.match(html, /<\/header>\s*<\/div>\s*<aside class="guide-aside guide-aside--nav[^"]*">\s*<div class="guide-aside__inner" data-js="nav-scroll">/, `${page}: the sidebar follows it in the page, and the grid puts it on the left`);
    }
    const css = await readOut('assets/site.css');
    assert.match(css, /\.guide-layout \{[^}]*grid-template-areas:\s*"nav head"\s*"nav main";/);
    assert.match(css, /\.guide-layout \{\s*display: grid;\s*grid-template-columns: minmax\(0, 1fr\);/, 'on phones a long line must not widen the page');
    assert.match(css, /\.guide-layout--guide \{[^}]*grid-template-areas:\s*"nav head"\s*"nav rail"\s*"nav main";/);
  });

  it('moving between pages cross-fades the content while the header and the sidebar stay put, without script', async () => {
    const css = await readOut('assets/site.css');
    assert.match(css, /@media \(prefers-reduced-motion: no-preference\) \{\s*@view-transition \{\s*navigation: auto;\s*\}\s*\}/, 'and not at all for people who asked for less motion');
    assert.equal((css.match(/@view-transition/g) ?? []).length, 1);
    assert.match(css, /\.site-header \{\s*view-transition-name: site-header;/);
    assert.match(css, /\.guide-aside--nav \{\s*view-transition-name: guide-nav;/);
    // A name may be used once per page, or the browser skips the transition.
    for (const page of ['en/guides/index.html', 'en/guides/protest/index.html', 'en/index.html']) {
      const html = await readOut(page);
      assert.equal((html.match(/<header class="site-header">/g) ?? []).length, 1, page);
      assert.ok((html.match(/class="guide-aside guide-aside--nav/g) ?? []).length <= 1, page);
    }
    // Navigation stays plain links: no script fetches or swaps pages (the CSP forbids both).
    const { contentSecurityPolicy } = await import('../src/build/assets.mjs');
    assert.match(contentSecurityPolicy(), /connect-src 'none'/);
    assert.match(await readOut('en/guides/protest/index.html'), /<a class="toc__link guide-nav__link" href="\/en\/guides\/accounts\/">/);
  });

  it('every page has the same width from header to footer, so nothing shifts sideways between pages', async () => {
    const files = /** @type {string[]} */ (await readdir(dir, { recursive: true })).filter((f) => f.endsWith('.html'));
    assert.ok(files.length > 80);
    for (const file of files) {
      const html = await readOut(file);
      assert.match(html, /<div class="container site-header__inner">/, file);
      assert.match(html, /<div class="container site-footer__inner">/, file);
      assert.doesNotMatch(html, /container--/, `${file}: no page-specific width`);
    }
    const css = await readOut('assets/site.css');
    assert.equal((css.match(/--page-max:/g) ?? []).length, 1, 'one width, defined once');
    assert.doesNotMatch(css, /\.container--/);
  });

  it('every sidebar link carries its guide\'s saved progress, as a mark that takes no room from the title', async () => {
    const guide = await readOut('en/guides/accounts/index.html');
    const nav = /<nav class="toc__list guide-nav__body"[\s\S]*?<\/nav>/.exec(guide)?.[0] ?? '';
    const marked = [...nav.matchAll(/href="\/en\/guides\/([a-z0-9-]+)\/"(?: aria-current="page" data-js="nav-current")?>\s*<span class="guide-nav__text">[^<]+<\/span><span class="card-progress guide-nav__progress" data-js="card-progress" data-guide="g[0-9a-f]{10}" data-storage="(?:local|session)" data-items="[^"]+">/g)].map((m) => m[1]);
    assert.deepEqual(marked, sidebar(guide).map(([, , slug]) => slug), 'the guide being read too: every link is built the same, so every title wraps the same');
    assert.match(nav, /data-storage="session"/, 'high-risk guides are read from this tab\'s storage');
    assert.match(nav, /<span class="visually-hidden" data-js="progress-text" data-template="\{done\} of \{total\} done"><\/span>/, 'screen readers get the count');
    const css = await readOut('assets/site.css');
    assert.match(css, /\.guide-nav__progress \{\s*position: absolute;/, 'out of the text flow');
    assert.match(css, /\.guide-nav__progress\.is-complete \{/, 'a finished guide gets a tick');
    const current = /\.guide-nav__link\[aria-current\] \{([^}]*)\}/.exec(css)?.[1] ?? '';
    assert.match(current, /background:/);
    assert.doesNotMatch(current, /font-weight/, 'a bolder current link is wider and wraps differently from page to page');
  });

  it('every group has a name in both languages', async () => {
    const { GROUPS } = await import('../src/build/frontmatter.mjs');
    for (const lang of ['ka', 'en']) {
      const names = JSON.parse(await readFile(join('content', 'i18n', `${lang}.json`), 'utf8')).guides.groups;
      assert.deepEqual(Object.keys(names).sort(), Object.values(GROUPS).flat().sort(), lang);
    }
  });

  /**
   * Builds a copy of the content after changing one guide's front matter.
   * @param {string} lang
   * @param {string} slug
   * @param {(source: string) => string} change
   */
  async function buildWith(lang, slug, change) {
    const contentDir = await mkdtemp(join(work, 'content-'));
    await cp(PATHS.content, contentDir, { recursive: true });
    const langs = lang === 'both' ? ['ka', 'en'] : [lang];
    for (const l of langs) {
      const file = join(contentDir, l, 'guides', `${slug}.md`);
      const source = await readFile(file, 'utf8');
      const changed = change(source);
      assert.notEqual(changed, source, 'the fixture change applied');
      await writeFile(file, changed);
    }
    return build({ outDir: join(work, 'dist-bad'), contentDir, siteUrl: 'https://example.org/' });
  }

  it('rejects a guide without a group, with an unknown group, or with a group of the other track', async () => {
    await assert.rejects(buildWith('both', 'phone', (s) => s.replace(/^group: .+\n/m, '')), /guides\/phone\.md:\d+ — Missing required front matter key "group"/);
    await assert.rejects(buildWith('both', 'phone', (s) => s.replace('group: start', 'group: misc')), /guides\/phone\.md:\d+ — "group" must be one of: start, habits, devices, recovery, plan, basics, situations, threats, teams\. Got "misc"/);
    await assert.rejects(buildWith('both', 'phone', (s) => s.replace('group: start', 'group: threats')), /guides\/phone\.md:\d+ — "group: threats" is not a group of the "everyone" track\. Use one of: start, habits, devices, recovery\./);
  });

  it('rejects an order that jumps back to an earlier group, and a translation in another group', async () => {
    // "wifi" is in the third group; as a member of the second it would sit after "computer" and "backups".
    await assert.rejects(buildWith('both', 'wifi', (s) => s.replace('group: devices', 'group: habits')), /guides\/wifi\.md — "group: habits" comes before "devices" \(\S+guides\/backups\.md\), but its "order" is higher/);
    // Moving the last guide of a group to the next group keeps the order valid, so only the translation check objects.
    await assert.rejects(buildWith('en', 'messaging', (s) => s.replace('group: start', 'group: habits')), /en\/guides\/messaging\.md — "group" must match \S+ka\/guides\/messaging\.md \(start\)/);
  });
});

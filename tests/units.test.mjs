// @ts-check
/**
 * @file Unit tests for build helpers: front matter, links, i18n and more.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readingMinutes } from '../src/build/article.mjs';
import { parseFrontMatter, validateFrontMatter } from '../src/build/frontmatter.mjs';
import { splitGuide } from '../src/build/guide.mjs';
import { html, raw } from '../src/build/html.mjs';
import { createTranslator, formatDate, missingKeys } from '../src/build/i18n.mjs';
import { parseBlocks, plainText } from '../src/build/markdown.mjs';
import { blocksText } from '../src/build/search.mjs';

describe('html template', () => {
  it('escapes interpolated values', () => {
    const name = '<img src=x onerror="alert(1)">';
    assert.equal(html`<p title="${name}">${name}</p>`.toString(), '<p title="&lt;img src=x onerror=&quot;alert(1)&quot;&gt;">&lt;img src=x onerror=&quot;alert(1)&quot;&gt;</p>');
  });

  it('keeps trusted HTML, joins arrays and drops null/false', () => {
    const items = ['a', 'b'].map((x) => html`<li>${x}</li>`);
    assert.equal(html`<ul>${items}</ul>${null}${false}${raw('<hr>')}`.toString(), '<ul><li>a</li><li>b</li></ul><hr>');
  });
});

describe('front matter', () => {
  it('parses key/value pairs and reports the body start line', () => {
    const { data, body, bodyLine } = parseFrontMatter('---\ntitle: "Hello: world"\norder: 2\n---\n\nBody', 'x.md');
    assert.deepEqual(data, { title: 'Hello: world', order: '2' });
    assert.equal(body, '\nBody\n');
    assert.equal(bodyLine, 5);
  });

  it('rejects values that are not valid YAML, so GitHub can show the file (it reads front matter as YAML)', () => {
    /** @param {string} line */
    const parse = (line) => parseFrontMatter(`---\n${line}\n---\n`, 'x.md').data;
    assert.throws(() => parse('title: Lock your phone: the basics'), /x\.md:2 — "title" has ": " in it.*Put the whole value in quotes/s);
    assert.throws(() => parse('title: Ends with a colon:'), /x\.md:2 — "title"/);
    assert.throws(() => parse('title: Tools #1'), /x\.md:2 — "title" has " #" in it/);
    assert.throws(() => parse('title: "Hacked" accounts'), /x\.md:2 — "title" starts with/);
    assert.throws(() => parse('title: [draft] Phones'), /x\.md:2 — "title" starts with/);
    assert.throws(() => parse('title: "He said "no": fine"'), /x\.md:2 — "title" is in double quotes/);
    assert.throws(() => parse("title: 'It's here: now'"), /x\.md:2 — "title" is in single quotes/);
    assert.deepEqual(parse("title: 'Lock your phone: the basics'"), { title: 'Lock your phone: the basics' });
    assert.deepEqual(parse('title: "It\'s here: now"'), { title: "It's here: now" });
    assert.deepEqual(parse('title: Many accounts are never "hacked", and it\'s common'), { title: 'Many accounts are never "hacked", and it\'s common' });
    assert.deepEqual(parse('order: 2'), { order: '2' });
    assert.deepEqual(parse('title: Time 10:30 and a-b'), { title: 'Time 10:30 and a-b' });
  });

  it('rejects missing or unclosed front matter and duplicate keys', () => {
    assert.throws(() => parseFrontMatter('title: x', 'x.md'), /Missing front matter/);
    assert.throws(() => parseFrontMatter('---\ntitle: x\n', 'x.md'), /not closed/);
    assert.throws(() => parseFrontMatter('---\na: 1\na: 2\n---\n', 'x.md'), /x\.md:3 — Duplicate/);
  });

  it('validates types and unknown keys', () => {
    const spec = /** @type {const} */ ({ title: 'text', order: 'int', reviewed: 'date', status: 'status?', progress: 'progress?' });
    /** @param {Record<string, string>} data */
    const check = (data) => validateFrontMatter({ data, lines: {}, body: '', bodyLine: 1 }, spec, 'x.md');
    assert.deepEqual(check({ title: 'T', order: '3', reviewed: '2026-11-09', progress: 'session' }), {
      title: 'T',
      order: 3,
      reviewed: '2026-11-09',
      progress: 'session',
    });
    assert.throws(() => check({ title: 'T', order: 'three', reviewed: '2026-11-09' }), /whole number/);
    assert.throws(() => check({ title: 'T', order: '1', reviewed: '09.11.2026' }), /YYYY-MM-DD/);
    assert.throws(() => check({ title: 'T', order: '1', reviewed: '2026-02-30' }), /YYYY-MM-DD/, 'BUG-5: impossible date');
    assert.throws(() => check({ title: 'T', order: '1', reviewed: '2026-13-01' }), /YYYY-MM-DD/);
    assert.doesNotThrow(() => check({ title: 'T', order: '1', reviewed: '2028-02-29' }), 'leap day');
    assert.throws(() => check({ title: 'T', order: '1', reviewed: '2026-11-09', tilte: 'x' }), /Unknown front matter key "tilte"/);
    assert.throws(() => check({ order: '1', reviewed: '2026-11-09' }), /Missing required front matter key "title"/);
    assert.throws(() => check({ title: 'T', order: '1', reviewed: '2026-11-09', progress: 'forever' }), /must be one of: local, session/);
  });

  it('accepts an optional date, and still checks it when present', () => {
    const spec = /** @type {const} */ ({ published: 'date', updated: 'date?' });
    /** @param {Record<string, string>} data */
    const check = (data) => validateFrontMatter({ data, lines: {}, body: '', bodyLine: 1 }, spec, 'x.md');
    assert.deepEqual(check({ published: '2026-11-11' }), { published: '2026-11-11' });
    assert.deepEqual(check({ published: '2026-11-11', updated: '2026-12-01' }), { published: '2026-11-11', updated: '2026-12-01' });
    assert.throws(() => check({ published: '2026-11-11', updated: 'soon' }), /"updated" must be a date/);
  });

  it('requires a guide audience from the fixed list', () => {
    const spec = /** @type {const} */ ({ title: 'text', audience: 'audience' });
    /** @param {Record<string, string>} data */
    const check = (data) => validateFrontMatter({ data, lines: {}, body: '', bodyLine: 1 }, spec, 'x.md');
    assert.deepEqual(check({ title: 'T', audience: 'high-risk' }), { title: 'T', audience: 'high-risk' });
    assert.throws(() => check({ title: 'T' }), /Missing required front matter key "audience"/);
    assert.throws(() => check({ title: 'T', audience: 'experts' }), /"audience" must be one of: everyone, high-risk\. Got "experts"/);
  });

  it('L3: reports the line of the offending key', () => {
    const parsed = parseFrontMatter('---\ntitle: T\norder: three\nreviewed: 2026-11-09\n---\n', 'x.md');
    assert.throws(() => validateFrontMatter(parsed, { title: 'text', order: 'int', reviewed: 'date' }, 'x.md'), /x\.md:3 — "order" must be a whole number/);
  });
});

describe('splitGuide', () => {
  const source = [
    'Intro text.',
    '',
    '## Use a PIN {#pin .essential}',
    'Why it matters.',
    '### iPhone {.ios}',
    '1. Step',
    '### Android',
    '1. Step',
    '## Hide number {#number .advanced}',
    'Text.',
  ].join('\n');

  it('splits intro, items and platforms', () => {
    const { intro, items } = splitGuide(parseBlocks(source, 'g.md'), 'g.md');
    assert.equal(intro.length, 1);
    assert.deepEqual(items.map((i) => [i.id, i.priority, i.platforms.map((p) => [p.label, p.key])]), [
      ['pin', 'essential', [['iPhone', 'ios'], ['Android', null]]],
      ['number', 'advanced', []],
    ]);
  });

  it('requires ids, priorities and unique ids', () => {
    assert.throws(() => splitGuide(parseBlocks('## No id {.essential}', 'g.md'), 'g.md'), /needs a stable id/);
    assert.throws(() => splitGuide(parseBlocks('## No priority {#x}', 'g.md'), 'g.md'), /needs a priority class/);
    assert.throws(() => splitGuide(parseBlocks('## A {#x .essential}\n## B {#x .essential}', 'g.md'), 'g.md'), /Duplicate item id "x"/);
    assert.throws(() => splitGuide(parseBlocks('Only text', 'g.md'), 'g.md'), /at least one checklist item/);
    assert.throws(() => splitGuide(parseBlocks('### Orphan', 'g.md'), 'g.md'), /must come after/);
  });

  it('BUG-4: rejects unknown or extra platform keys', () => {
    const guide = (/** @type {string} */ heading) => splitGuide(parseBlocks(`## A {#a .essential}\n${heading}\n1. Step`, 'g.md'), 'g.md');
    assert.throws(() => guide('### iPhone {.iso}'), /g\.md:2 — Unknown platform key "\.iso"/);
    assert.throws(() => guide('### Signal {.essential}'), /Unknown platform key "\.essential"/);
    assert.throws(() => guide('### iPhone {.ios .android}'), /only one platform key/);
    assert.equal(guide('### iPhone {.ios}').items[0].platforms[0].key, 'ios');
  });
});

describe('plain text for search', () => {
  it('drops formatting marks and keeps link text, code and escaped characters', () => {
    assert.equal(plainText('Open **Settings → [Linked *devices*](/guides/messaging/)** and dial `*#21#` \\* now'), 'Open Settings → Linked devices and dial *#21# * now');
  });

  it('collects the text of paragraphs, lists and callouts', () => {
    const nodes = parseBlocks(['## A **title**', '', 'Text.', '', '1. One', '2. Two', '', '> [!tip]', '> Inside.'].join('\n'), 's.md');
    assert.equal(blocksText(nodes), 'A title Text. One Two Inside.');
  });
});

describe('article reading time', () => {
  /** @param {number} n */
  const words = (n) => Array.from({ length: n }, () => 'word').join(' ');

  it('counts words in paragraphs, headings, lists and callouts', () => {
    const source = [`## ${words(90)}`, '', words(90), '', `- ${words(90)}`, `- ${words(90)}`, '', '> [!note]', `> ${words(180)}`].join('\n');
    assert.equal(readingMinutes(parseBlocks(source, 'a.md')), 3);
  });

  it('never shows less than one minute', () => {
    assert.equal(readingMinutes(parseBlocks('Short.', 'a.md')), 1);
  });
});

describe('i18n', () => {
  const t = createTranslator({ guide: { items: { one: '{n} step', other: '{n} steps' }, title: 'Hi {name}' } }, 'en');

  it('interpolates and pluralizes', () => {
    assert.equal(t('guide.items', { n: 1 }), '1 step');
    assert.equal(t('guide.items', { n: 6 }), '6 steps');
    assert.equal(t('guide.title', { name: 'Ana' }), 'Hi Ana');
  });

  it('fails loudly on missing keys', () => {
    assert.throws(() => t('guide.missing'), /Missing UI string "guide.missing" for language "en"/);
  });

  it('finds missing keys between languages', () => {
    assert.deepEqual(missingKeys({ a: 'x', b: { c: 'y', d: 'z' } }, { a: 'x', b: { c: 'y' } }), ['b.d']);
  });

  it('BUG-12: reports a key that is text in one language and a plural/group in the other', () => {
    assert.deepEqual(missingKeys({ a: 'x' }, { a: { one: 'x', other: 'xs' } }), ['a']);
    assert.deepEqual(missingKeys({ a: { one: 'x', other: 'xs' } }, { a: 'x' }), ['a']);
  });

  it('formats Georgian and English dates', () => {
    assert.equal(formatDate('2026-11-09', 'ka-GE'), '9 ნოემბერი, 2026');
    assert.equal(formatDate('2026-11-09', 'en-GB'), '9 November 2026');
  });
});

describe('serial (M3: dev rebuilds never overlap)', async () => {
  const { serial } = await import('../src/build/serial.mjs');

  it('never runs two tasks at once and collapses calls made during a run into one re-run', async () => {
    let active = 0;
    let maxActive = 0;
    let runs = 0;
    const run = serial(async () => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      runs += 1;
      await new Promise((resolve) => setTimeout(resolve, 20));
      active -= 1;
    });
    await Promise.all([run(), run(), run(), run()]);
    assert.equal(maxActive, 1);
    assert.equal(runs, 2, 'first call runs, the three during it collapse into one');
    await run();
    assert.equal(runs, 3, 'a call after it finished runs again');
  });
});

describe('site config (SEC-3)', async () => {
  const { mkdtemp, rm, writeFile } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { loadSite } = await import('../src/build/site.mjs');

  /**
   * @param {string} repo
   * @param {object} [extra]  More site.json keys.
   */
  async function load(repo, extra = {}) {
    const dir = await mkdtemp(join(tmpdir(), 'lockwell-site-'));
    try {
      await writeFile(join(dir, 'site.json'), JSON.stringify({ url: 'https://lockwell.org/', repo, defaultLang: 'ka', languages: ['ka', 'en'], ...extra }));
      return await loadSite({ contentDir: dir });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }

  it('accepts an empty repo or an https URL, and drops a trailing slash', async () => {
    assert.equal((await load('')).repo, '');
    assert.equal((await load('https://github.com/x/lockwell/')).repo, 'https://github.com/x/lockwell');
  });

  it('requires the default language, listed first', async () => {
    assert.equal((await load('')).defaultLang, 'ka');
    await assert.rejects(load('', { languages: ['en', 'ka'] }), /must list the default language \("defaultLang"\) first/);
    await assert.rejects(load('', { defaultLang: undefined }), /must list the default language/);
    await assert.rejects(load('', { languages: undefined }), /must list the default language/);
  });

  it('rejects a repo that is not an https URL', async () => {
    await assert.rejects(load('github.com/x/lockwell'), /"repo" must be a full https:\/\/ URL/);
    await assert.rejects(load('javascript:alert(1)'), /"repo" must be a full https:\/\/ URL/);
  });

  it('reads an optional author and copyright year, and rejects unsafe values', async () => {
    assert.equal((await load('')).author, null);
    const author = { name: 'A Person', email: 'a@example.org', url: 'https://example.org/' };
    const site = await load('', { author, copyrightYear: 2026 });
    assert.deepEqual(site.author, { ...author, inFooter: true }, 'named in the footer unless "inFooter" is false');
    assert.equal((await load('', { author: { ...author, inFooter: false } })).author?.inFooter, false);
    await assert.rejects(load('', { author: { ...author, inFooter: 'false' } }), /"author.inFooter" must be true or false/);
    assert.equal(site.copyrightYear, 2026);
    await assert.rejects(load('', { author: { ...author, name: ' ' } }), /"author.name" must be a non-empty string/);
    await assert.rejects(load('', { author: { ...author, email: 'a@b" onload="x' } }), /"author.email" must be a plain email/);
    await assert.rejects(load('', { author: { ...author, url: 'javascript:alert(1)' } }), /"author.url" must be a full https:\/\/ URL/);
    await assert.rejects(load('', { copyrightYear: '2026' }), /"copyrightYear" must be a year/);
    await assert.rejects(load('', { copyrightYear: 99999 }), /"copyrightYear" must be a year/);
    assert.equal((await load('', { author: null })).author, null);
    await assert.rejects(load('', { author: { ...author, name: 42 } }), /"author.name" must be a non-empty string/);
    await assert.rejects(load('', { author: 'me' }), /"author" must be an object/);
    assert.equal((await load('', { author: { ...author, url: 'https://example.org' } })).author?.url, 'https://example.org/', 'normalised');
  });
});

describe('internal links and anchors (BUG-10)', async () => {
  const { checkInternalLinks, resolveLink } = await import('../src/build/links.mjs');
  const site = { origin: 'https://x.org', basePath: '/', repo: '', defaultLang: 'ka', languages: ['ka', 'en'] };
  const at = { file: 'content/en/pages/about.md', line: 3 };
  const pages = new Map([
    ['/en/guides/messaging/', '<article id="account-pin">'],
    ['/en/about/', '<h2 id="why">'],
  ]);

  /** @param {string} target */
  const check = (target) => {
    /** @type {import('../src/build/links.mjs').InternalLink[]} */
    const links = [];
    const href = resolveLink(site, 'en', target, at, links, '/about/');
    checkInternalLinks(links, pages);
    return href;
  };

  it('accepts anchors that exist on the target page', () => {
    assert.equal(check('/guides/messaging/#account-pin'), '/en/guides/messaging/#account-pin');
    assert.equal(check('#why'), '#why');
  });

  it('fails on anchors that do not exist, with the file and line', () => {
    assert.throws(() => check('/guides/messaging/#acount-pin'), /about\.md:3 — Broken link: "\/en\/guides\/messaging\/" has no "#acount-pin"/);
    assert.throws(() => check('#nope'), /about\.md:3 — Broken link: "\/en\/about\/" has no "#nope"/);
  });

  it('still fails on missing pages', () => {
    assert.throws(() => check('/guides/missing/'), /Broken internal link: no page exists at "\/en\/guides\/missing\/"/);
  });
});

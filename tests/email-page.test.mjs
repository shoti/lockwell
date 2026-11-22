// @ts-check
/**
 * @file Tests for the email header analyzer page: the built panel in both languages is turned into a small fake DOM
 * (descendant selectors, templates, text) and driven through the page's own module, so every selector the client
 * uses must exist in the page it really gets.
 */
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { build } from '../src/build/build.mjs';
import { CHECK_METHODS, FINDINGS, KNOWN_RESULTS, exampleMessages, init } from '../src/client/tool-email.mjs';
import { FakeEventTarget, installDom } from './fake-dom.mjs';

const ENTITIES = /** @type {Record<string, string>} */ ({ amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'", '#x27': "'" });
/** @param {string} text */
const decode = (text) => text.replace(/&(amp|lt|gt|quot|#39|#x27);/g, (_, name) => ENTITIES[name]);
const VOID = new Set(['input', 'br', 'img', 'meta', 'link', 'hr', 'path', 'rect', 'circle', 'line', 'polyline', 'polygon']);

/** An element of the page, with real descendant lookups and text. */
class PageElement extends FakeEventTarget {
  /** @param {string} tag */
  constructor(tag) {
    super();
    this.tagName = tag.toUpperCase();
    /** @type {Record<string, string>} */
    this.dataset = {};
    /** @type {Record<string, string>} */
    this.attributes = {};
    this.hidden = false;
    this.value = '';
    this.lang = '';
    this.translate = true;
    this.dir = '';
    this.dateTime = '';
    this.className = '';
    /** @type {PageElement | null} */
    this.parent = null;
    /** @type {(PageElement | string)[]} */
    this.nodes = [];
    this.ownText = '';
    const classes = new Set();
    this.classList = { add: (/** @type {string} */ c) => classes.add(c), remove: (/** @type {string} */ c) => classes.delete(c), contains: (/** @type {string} */ c) => classes.has(c) };
  }

  click() {
    this.dispatchEvent({ type: 'click' });
  }

  focus() {}

  /** @returns {string} */
  get textContent() {
    return this.nodes.map((node) => (typeof node === 'string' ? node : node.textContent)).join('') || this.ownText;
  }

  set textContent(value) {
    this.nodes = [];
    this.ownText = String(value);
  }

  /** @returns {PageElement[]} */
  get children() {
    return /** @type {PageElement[]} */ (this.nodes.filter((node) => typeof node !== 'string'));
  }

  get content() {
    return { firstElementChild: this.children[0] };
  }

  /** @param {...(PageElement | string)} nodes */
  replaceChildren(...nodes) {
    this.ownText = '';
    this.nodes = nodes.map((node) => (typeof node === 'string' ? node : Object.assign(node, { parent: this })));
  }

  /** @param {...(PageElement | string)} nodes */
  append(...nodes) {
    this.nodes.push(...nodes.map((node) => (typeof node === 'string' ? node : Object.assign(node, { parent: this }))));
  }

  /** @returns {PageElement[]} */
  descendants() {
    return this.children.flatMap((child) => [child, ...child.descendants()]);
  }

  /** "tag[attr]" or "[attr="value"]…", one compound selector. @param {string} selector */
  matches(selector) {
    const tag = /^[a-z]+/.exec(selector)?.[0];
    if (tag && this.tagName.toLowerCase() !== tag) return false;
    for (const [, name, value] of selector.matchAll(/\[([\w-]+)(?:="([^"]*)")?\]/g)) {
      const actual = this.getAttribute(name);
      if (actual === null || (value !== undefined && actual !== value)) return false;
    }
    return true;
  }

  /** @param {string} selector */
  querySelectorAll(selector) {
    const parts = selector.trim().split(/\s+/);
    return this.descendants().filter((element) => {
      if (!element.matches(/** @type {string} */ (parts.at(-1)))) return false;
      let at = /** @type {PageElement | null} */ (element.parent);
      for (let i = parts.length - 2; i >= 0; i -= 1) {
        while (at && at !== this && !at.matches(parts[i])) at = at.parent;
        if (!at || at === this) return false;
        at = at.parent;
      }
      return true;
    });
  }

  /** @param {string} selector */
  querySelector(selector) {
    return this.querySelectorAll(selector)[0] ?? null;
  }

  /** @param {string} name @param {string} value */
  setAttribute(name, value) {
    this.attributes[name] = value;
    if (name.startsWith('data-')) this.dataset[name.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = value;
    if (name === 'hidden') this.hidden = true;
  }

  /** @param {string} name */
  getAttribute(name) {
    if (name === 'hidden') return this.hidden ? '' : null;
    if (name.startsWith('data-')) {
      const key = name.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
      if (key in this.dataset) return this.dataset[key];
    }
    return this.attributes[name] ?? null;
  }

  /** @returns {PageElement} */
  cloneNode() {
    const copy = new PageElement(this.tagName.toLowerCase());
    for (const [name, value] of Object.entries(this.attributes)) copy.setAttribute(name, value);
    copy.dataset = { ...this.dataset };
    copy.hidden = this.hidden;
    copy.ownText = this.ownText;
    copy.replaceChildren(...this.nodes.map((node) => (typeof node === 'string' ? node : node.cloneNode())));
    return copy;
  }
}

/**
 * Builds elements from the page's own HTML (the build's output, so well formed and quoted).
 * @param {string} html
 */
function parse(html) {
  const root = new PageElement('div');
  /** @type {PageElement[]} */
  const stack = [root];
  for (const [token, close, tag, attributes] of html.matchAll(/<!--[\s\S]*?-->|<(\/?)([a-zA-Z][\w-]*)([^>]*)>|[^<]+/g)) {
    const parent = /** @type {PageElement} */ (stack.at(-1));
    if (token.startsWith('<!--')) continue;
    if (!tag) {
      parent.append(decode(token));
      continue;
    }
    if (close) {
      stack.pop();
      continue;
    }
    const element = new PageElement(tag.toLowerCase());
    for (const [, name, value] of attributes.matchAll(/([^\s=/]+)(?:="([^"]*)")?/g)) element.setAttribute(name, decode(value ?? ''));
    parent.append(element);
    if (!VOID.has(tag.toLowerCase()) && !attributes.trim().endsWith('/')) stack.push(element);
  }
  return root;
}

/** @type {string} */
let dir;
/** @type {Record<string, string>} */
const pages = {};

before(async () => {
  dir = await mkdtemp(join(tmpdir(), 'lockwell-email-'));
  await build({ outDir: join(dir, 'dist'), siteUrl: 'https://example.org/' });
  for (const [lang, path] of [['en', 'en/tools/email-headers/index.html'], ['ka', 'tools/email-headers/index.html']]) pages[lang] = await readFile(join(dir, 'dist', path), 'utf8');
});
after(async () => {
  if (dir) await rm(dir, { recursive: true, force: true });
});

/**
 * The tool's section from a built page, in a fake DOM, with the module started.
 * @param {'en' | 'ka'} lang
 */
function open(lang) {
  const section = /<section class="tool js-only" data-js="tool"[\s\S]*?<\/section>\s*(?=<section class="prose|<section class="tool-guides)/.exec(pages[lang])?.[0] ?? '';
  const tool = /** @type {PageElement} */ (parse(section).children[0]);
  const dom = installDom();
  dom.root.setAttribute('lang', lang);
  Object.assign(dom.root, { lang });
  Object.assign(globalThis.document, { createElement: (/** @type {string} */ tag) => new PageElement(tag) });
  Object.assign(globalThis, { HTMLInputElement: class {} });
  init(/** @type {HTMLElement} */ (/** @type {unknown} */ (tool)));
  /** @param {string} name */
  const part = (name) => /** @type {PageElement} */ (tool.querySelector(`[data-js="email-${name}"]`));
  return {
    tool,
    part,
    restore() {
      dom.restore();
      delete (/** @type {Record<string, unknown>} */ (globalThis)).HTMLInputElement;
    },
  };
}

/** @param {PageElement} tool */
const shownFindings = (tool) => tool.querySelectorAll('[data-js="email-findings"] [data-finding]').filter((item) => !item.hidden).map((item) => item.dataset.finding);

describe('email header analyzer page', () => {
  it('checks the spoof example and fills every section from the page’s own words (English)', () => {
    const page = open('en');
    try {
      const { tool, part } = page;
      assert.equal(part('report').hidden, true, 'nothing shows before the visitor acts');
      tool.querySelectorAll('[data-js="email-example"]')[0].click();
      assert.equal(part('report').hidden, false);
      assert.equal(part('message').textContent, '');
      assert.match(part('verdict').textContent, /^This message has warning signs: 3\./);
      assert.equal(part('verdict-card').dataset.state, 'warn');
      assert.deepEqual(shownFindings(tool), ['dmarcFail', 'replyElsewhere', 'lookalikeDomain', 'plainHop', 'messageIdElsewhere']);
      const lookalike = tool.querySelector('[data-finding="lookalikeDomain"]');
      assert.match(lookalike?.textContent ?? '', /^Warning: The domain tbcbank-ge\.example looks like the name “tbcbank”/);
      /** @param {string} row */
      const identity = (row) => /** @type {PageElement} */ (tool.querySelector(`[data-js="email-identity"] [data-row="${row}"]`));
      assert.equal(identity('name').textContent, 'Shown nameTBC Bank Security');
      assert.equal(part('address').textContent, 'security@tbcbank-ge.example');
      assert.equal(part('address').querySelector('strong')?.textContent, 'tbcbank-ge.example');
      assert.equal(identity('replyTo').hidden, false);
      assert.match(identity('replyTo').textContent, /A different organisation/);
      assert.equal(identity('sender').hidden, true);
      assert.match(identity('handoff').textContent, /mailer\.example\.net · 203\.0\.113\.45an address reserved for examples/);
      assert.match(part('receiver').textContent, /^Recorded by: mx1\.inbox\.test\./);
      const checks = part('checks').children;
      assert.deepEqual(checks.map((item) => item.dataset.state), ['pass', 'other', 'fail', 'claimed', 'claimed', 'claimed']);
      assert.equal(checks[2].querySelector('[data-js="email-check-meaning"]')?.textContent, 'The address you see doesn’t match any domain that passed SPF or DKIM.');
      assert.equal(checks[0].querySelector('[data-js="email-check-domain"]')?.textContent, 'About: mailer.example.net, a different organisation from the address you see.');
      assert.equal(checks[3].querySelector('[data-js="email-check-claimed"]')?.hidden, false);
      assert.equal(checks[0].querySelector('[data-js="email-check-claimed"]')?.hidden, true);
      const hops = part('route').children;
      assert.deepEqual(hops.map((hop) => hop.dataset.state), ['claimed', 'trusted', 'trusted']);
      assert.equal(hops[0].querySelector('[data-js="email-hop-path"]')?.textContent, '[198.51.100.23] → mailer.example.net', 'no looked-up name: the one the sender gave');
      assert.equal(hops[1].querySelector('[data-js="email-hop-path"]')?.textContent, 'mailer.example.net → mx1.inbox.test');
      assert.equal(hops[1].querySelector('[data-js="email-hop-protocol"]')?.textContent, 'ESMTP: not encrypted');
      assert.equal(hops[0].querySelector('[data-js="email-hop-protocol"]')?.textContent, 'ESMTPSA: encrypted, the sender was signed in');
      assert.equal(hops[1].querySelector('[data-js="email-hop-delay"]')?.textContent, '1 s after the previous step');
      assert.match(hops[1].querySelector('time')?.textContent ?? '', /UTC \(your time: /);
      assert.equal(part('filter').hidden, true);
      assert.equal(part('headers').children.length, 14);
      assert.equal(part('headers-count').textContent, 'Every header (14)');
      const summary = part('summary-text').textContent.split('\n');
      assert.equal(summary[0], part('verdict').textContent);
      assert.equal(summary.length, 6);
      assert.match(summary[1], /^- Warning: Your provider’s DMARC check failed for tbcbank-ge\.example/);
    } finally {
      page.restore();
    }
  });

  it('shows the other two examples, in Georgian, with no approving colour for "no warning signs"', () => {
    const page = open('ka');
    try {
      const { tool, part } = page;
      const [, scam, newsletter] = tool.querySelectorAll('[data-js="email-example"]');
      scam.click();
      assert.match(part('verdict').textContent, /^ამ წერილში საეჭვო ნიშნებია: 1\./);
      assert.deepEqual(shownFindings(tool), ['replyElsewhere', 'fakeReply', 'encryptedInTransit']);
      newsletter.click();
      assert.match(part('verdict').textContent, /^სათაურებში საეჭვო ნიშნები არ ჩანს\./);
      assert.equal(part('verdict-card').dataset.state, 'ok');
      assert.deepEqual(shownFindings(tool), ['spfFail', 'forwarded', 'bulkSender', 'messageIdElsewhere', 'encryptedInTransit']);
      assert.equal(part('checks').children.find((item) => item.querySelector('[data-js="email-check-method"]')?.textContent === 'ARC')?.querySelector('[data-js="email-check-meaning"]')?.textContent, 'გადაგზავნის ჩანაწერი მთელია: იმის წაკითხვა, რაც წინა შუამავლებმა ჩაწერეს, შეიძლება.');
    } finally {
      page.restore();
    }
  });

  it('says what is wrong with empty input or text that isn’t headers, and Clear hides the report', () => {
    const page = open('en');
    try {
      const { part } = page;
      part('check').click();
      assert.equal(part('message').textContent, 'Paste the headers first, or choose a saved message.');
      assert.equal(part('report').hidden, true);
      part('input').value = 'Dear customer, your parcel is waiting.';
      part('check').click();
      assert.match(part('message').textContent, /^This doesn’t look like email headers\./);
      part('input').value = exampleMessages()[1];
      part('check').click();
      assert.equal(part('report').hidden, false);
      part('clear').click();
      assert.equal(part('input').value, '');
      assert.equal(part('report').hidden, true);
    } finally {
      page.restore();
    }
  });

  it('reads a dropped .eml file', async () => {
    const page = open('en');
    try {
      const { tool, part } = page;
      tool.dispatchEvent({ type: 'drop', preventDefault() {}, dataTransfer: { files: [new File([exampleMessages()[2]], 'news.eml', { type: 'message/rfc822' })] } });
      for (let i = 0; i < 100 && part('report').hidden; i += 1) await new Promise((resolve) => setTimeout(resolve, 5));
      assert.equal(part('report').hidden, false);
      assert.equal(part('input').value, exampleMessages()[2]);
      assert.deepEqual(shownFindings(tool), ['spfFail', 'forwarded', 'bulkSender', 'messageIdElsewhere', 'encryptedInTransit']);
    } finally {
      page.restore();
    }
  });
});

describe('email header analyzer page content', () => {
  for (const lang of /** @type {const} */ (['en', 'ka'])) {
    it(`has every label, finding, meaning and message in ${lang}`, () => {
      const page = parse(pages[lang]);
      /** @param {string} selector */
      const one = (selector) => {
        const found = page.querySelector(selector);
        assert.ok(found, `${lang}: ${selector}`);
        return /** @type {PageElement} */ (found);
      };
      for (const [key, level] of Object.entries(FINDINGS)) {
        const item = one(`[data-finding="${key}"]`);
        assert.equal(item.getAttribute('data-level'), level, `${lang} ${key} level`);
        assert.equal(item.hidden, true);
        assert.ok(item.querySelector('[data-js="email-finding-text"]')?.getAttribute('data-template'), `${lang} ${key} text`);
      }
      for (const [key, variants] of Object.entries({ replyElsewhere: ['free'], lookalikeDomain: ['script'], noChecks: ['claimed', 'none'], dateOdd: ['future', 'old'] })) {
        for (const variant of variants) assert.ok(one(`[data-finding="${key}"]`).querySelector('[data-js="email-finding-text"]')?.getAttribute(`data-${variant}`), `${lang} ${key} ${variant}`);
      }
      const meaning = one('[data-js="email-check-meaning"]');
      for (const method of CHECK_METHODS) {
        assert.ok(one('[data-js="email-check-method"]').getAttribute(`data-${method}`), `${lang} method ${method}`);
        for (const result of KNOWN_RESULTS[method]) assert.ok(meaning.getAttribute(`data-${method}-${result}`), `${lang} meaning ${method} ${result}`);
      }
      for (const message of ['empty', 'not-headers', 'too-large', 'read-failed']) assert.ok(one('[data-js="email-message"]').getAttribute(`data-${message}`), `${lang} message ${message}`);
      for (const verdict of ['warn', 'unchecked', 'none']) assert.ok(one('[data-js="email-verdict"]').getAttribute(`data-${verdict}`), `${lang} verdict ${verdict}`);
      for (const name of ['public', 'private', 'documentation', 'link-local', 'unique-local', 'six-to-four', 'invalid']) {
        const attribute = name === 'invalid' ? 'data-invalid' : `data-class-${name}`;
        assert.ok(one('[data-js="email-hop-address"]').getAttribute(attribute), `${lang} ${attribute}`);
      }
      assert.equal(page.querySelectorAll('[data-js="email-example"]').length, 3);
      assert.match(pages[lang], /<input class="file__input" type="file" id="email__file" accept="\.eml,\.msg,message\/rfc822" data-js="email-file">/);
      assert.doesNotMatch(/<section class="tool js-only"[\s\S]*?<\/section>/.exec(pages[lang])?.[0] ?? '', /\sstyle=/, 'no style attributes');
      assert.match(/Content-Security-Policy" content="([^"]+)"/.exec(pages[lang])?.[1] ?? '', /connect-src 'none'/, 'the page makes no requests');
      const prefix = lang === 'en' ? '/en' : '';
      for (const link of ['/guides/phishing/#pause', '/guides/phishing/#report', '/tools/link-checker/', '/tools/attachment-checker/', '/guides/sensitive-email/#what-email-reveals']) {
        assert.ok(pages[lang].includes(`href="${prefix}${link}"`), `${lang} link ${link}`);
      }
    });
  }
});

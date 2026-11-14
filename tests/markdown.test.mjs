// @ts-check
/**
 * @file Tests for the Markdown subset parser and renderer.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ContentError } from '../src/build/errors.mjs';
import { assertUniqueIds, parseBlocks, renderBlocks, renderInline as renderInlineSafe, strongTexts } from '../src/build/markdown.mjs';

/** @type {(text: string, c: typeof ctx, line: number) => string} */
const renderInline = (text, c, line) => renderInlineSafe(text, c, line).toString();

/** @type {import('../src/build/markdown.mjs').RenderContext} */
const ctx = {
  file: 'test.md',
  resolveLink: (target) => {
    if (target.startsWith('javascript:')) throw new ContentError('test.md', 1, 'unsupported');
    return target;
  },
  calloutLabel: (kind) => kind.toUpperCase(),
};

/** @param {string} source */
const render = (source) => renderBlocks(parseBlocks(source, 'test.md'), ctx).toString();

describe('parseBlocks', () => {
  it('parses headings with id and classes', () => {
    const [node] = parseBlocks('## Use a PIN {#account-pin .essential}', 'test.md');
    assert.deepEqual(node, {
      type: 'heading',
      level: 2,
      text: 'Use a PIN',
      attrs: { id: 'account-pin', classes: ['essential'] },
      line: 1,
    });
  });

  it('joins paragraph lines and keeps line numbers', () => {
    const nodes = parseBlocks('\n\nFirst line\nsecond line\n\nNext', 'test.md', 10);
    assert.equal(nodes.length, 2);
    assert.deepEqual(nodes[0], { type: 'paragraph', text: 'First line second line', line: 12 });
    assert.equal(nodes[1].line, 15);
  });

  it('parses ordered lists, continuation lines and single blank lines between items', () => {
    const [list] = parseBlocks('1. One\n   still one\n\n2. Two', 'test.md');
    assert.equal(list.type, 'list');
    assert.ok(list.type === 'list' && list.ordered);
    assert.deepEqual(list.type === 'list' && list.items.map((i) => i.text), ['One still one', 'Two']);
  });

  it('parses callouts with nested blocks', () => {
    const [callout] = parseBlocks('> [!warning]\n> Never share codes.\n>\n> - Not even friends', 'test.md');
    assert.equal(callout.type, 'callout');
    assert.ok(callout.type === 'callout' && callout.kind === 'warning');
    assert.deepEqual(callout.type === 'callout' && callout.children.map((c) => c.type), ['paragraph', 'list']);
  });

  it('rejects unsupported syntax with the line number', () => {
    assert.throws(() => parseBlocks('ok\n\n```\ncode\n```', 'test.md'), /test\.md:3 — Code blocks/);
    assert.throws(() => parseBlocks('<div>hi</div>', 'test.md'), /Raw HTML is not allowed/);
    assert.throws(() => parseBlocks('- a\n  - nested', 'test.md'), /Nested lists/);
    assert.throws(() => parseBlocks('> plain quote', 'test.md'), /Blockquotes must be callouts/);
    assert.throws(() => parseBlocks('> [!danger]\n> x', 'test.md'), /Unknown callout type "danger"/);
    assert.throws(() => parseBlocks('##### Too deep', 'test.md'), /deeper than ####/);
    assert.deepEqual(parseBlocks('#### Deepest allowed', 'test.md').map((b) => [b.type, /** @type {{ level?: number }} */ (b).level]), [['heading', 4]]);
    assert.throws(() => parseBlocks('## Title {#Bad_Id}', 'test.md'), /Invalid heading attribute/);
  });
});

describe('renderInline', () => {
  it('renders bold, italic, code and links', () => {
    assert.equal(
      renderInline('**Settings → Account** and *this* `code` [site](https://signal.org)', ctx, 1),
      '<strong>Settings → Account</strong> and <em>this</em> <code>code</code> <a href="https://signal.org" target="_blank" rel="external noopener noreferrer">site</a>',
    );
  });

  it('handles Georgian suffixes after bold text', () => {
    assert.equal(renderInline('დააჭირეთ **Turn on**-ს', ctx, 1), 'დააჭირეთ <strong>Turn on</strong>-ს');
  });

  it('escapes HTML everywhere, including inside code and link text', () => {
    assert.equal(renderInline('<script>alert(1)</script>', ctx, 1), '&lt;script&gt;alert(1)&lt;/script&gt;');
    assert.equal(renderInline('`<b>`', ctx, 1), '<code>&lt;b&gt;</code>');
    assert.equal(renderInline('[<img onerror=x>](https://a.b/?q="x")', ctx, 1), '<a href="https://a.b/?q=&quot;x&quot;" target="_blank" rel="external noopener noreferrer">&lt;img onerror=x&gt;</a>');
  });

  it('lets the link resolver reject dangerous URLs', () => {
    assert.throws(() => renderInline('[x](javascript:alert)', ctx, 1));
    assert.throws(() => renderInline('[x](javascript:alert(1))', ctx, 1));
  });

  it('supports backslash escapes', () => {
    assert.equal(renderInline('\\*not italic\\*', ctx, 1), '*not italic*');
  });
});

describe('review fixes', () => {
  it('L1: links may contain balanced parentheses', () => {
    assert.equal(
      renderInline('[Signal](https://en.wikipedia.org/wiki/Signal_(software))', ctx, 1),
      '<a href="https://en.wikipedia.org/wiki/Signal_(software)" target="_blank" rel="external noopener noreferrer">Signal</a>',
    );
  });

  it('L1: a link that cannot be parsed fails instead of rendering as text', () => {
    assert.throws(() => renderInline('[broken](https://a.b/x y)', ctx, 7), /test\.md:7 — Could not read a link/);
  });

  it('L2: an indented list item right after a paragraph fails instead of merging', () => {
    assert.throws(() => parseBlocks('Some text\n  - looks like a list', 'test.md'), /test\.md:2 — Indented list items are not supported/);
  });

  it('M5: rejects ids reserved by the layout', () => {
    assert.throws(() => parseBlocks('## Main {#main .essential}', 'test.md'), /"main" is used by the page layout/);
  });

  it('M5: rejects duplicate heading ids on a page', () => {
    assert.throws(() => assertUniqueIds(parseBlocks('## A {#x}\n\n### B {#x}', 'test.md'), 'test.md'), /test\.md:3 — Duplicate id "x" \(also used on line 1\)/);
  });

  it('L7: renderers return trusted SafeHtml, not plain strings', () => {
    assert.equal(renderInlineSafe('a', ctx, 1).constructor.name, 'SafeHtml');
    assert.equal(renderBlocks(parseBlocks('a', 'test.md'), ctx).constructor.name, 'SafeHtml');
  });
});

describe('renderBlocks', () => {
  it('renders a callout with its label', () => {
    assert.equal(
      render('> [!tip]\n> Use **Signal**.'),
      '<aside class="callout callout--tip" role="note"><p class="callout__title">TIP</p><p>Use <strong>Signal</strong>.</p></aside>',
    );
  });

  it('rejects h1 in content', () => {
    assert.throws(() => render('# Title'), /page title comes from the "title" front matter/);
  });
});

describe('asterisks never change what a step says (BUG-2)', () => {
  it('fails on a phone code written as plain text, pointing to backticks', () => {
    assert.throws(() => renderInline('Dial *#21# to check call forwarding', ctx, 4), /test\.md:4 — Stray "\*"/);
    assert.throws(() => renderInline('Dial *21* now', ctx, 1), /Stray "\*"/);
    assert.throws(() => renderInline('2 * 3', ctx, 1), /Stray "\*"/);
  });

  it('renders phone codes in backticks or with escapes literally', () => {
    assert.equal(renderInline('Dial `*#21#`', ctx, 1), 'Dial <code>*#21#</code>');
    assert.equal(renderInline('Dial \\*#21#', ctx, 1), 'Dial *#21#');
  });

  it('still renders normal emphasis, including Georgian and nested italics', () => {
    assert.equal(renderInline('means *padlock* here', ctx, 1), 'means <em>padlock</em> here');
    assert.equal(renderInline('*ბოქლომი*-ს', ctx, 1), '<em>ბოქლომი</em>-ს');
    assert.equal(renderInline('Use **bold *and* more**', ctx, 1), 'Use <strong>bold <em>and</em> more</strong>');
    assert.equal(renderInline('Tap **+** to save', ctx, 1), 'Tap <strong>+</strong> to save');
  });
});

describe('lists keep their numbers (BUG-3)', () => {
  it('fails when an ordered list does not count 1, 2, 3…', () => {
    assert.throws(() => parseBlocks('3. third\n4. fourth', 'test.md'), /test\.md:1 — List numbers must count 1, 2, 3/);
    assert.throws(() => parseBlocks('1. a\n3. c', 'test.md'), /test\.md:2 — List numbers must count/);
    assert.throws(() => parseBlocks('1. a\n2. b\n\n> [!note]\n> x\n\n3. c', 'test.md'), /test\.md:7 — List numbers must count/);
  });

  it('accepts "1)" style and numbering kept across single blank lines', () => {
    assert.doesNotThrow(() => parseBlocks('1) a\n2) b', 'test.md'));
    assert.doesNotThrow(() => parseBlocks('1. a\n\n2. b', 'test.md'));
  });

  it('fails on an unindented line right after a list item instead of making it a paragraph', () => {
    assert.throws(() => parseBlocks('1. Open Settings\nthen tap Account', 'test.md'), /test\.md:2 — .*indent/i);
    assert.doesNotThrow(() => parseBlocks('1. Open Settings\n   then tap Account', 'test.md'));
    assert.doesNotThrow(() => parseBlocks('- a\n## Next {#n}', 'test.md'), 'a heading may follow directly');
  });
});

describe('parser speed (PERF-3)', () => {
  it('parses a heading with very long whitespace in linear time', () => {
    const started = performance.now();
    assert.throws(() => parseBlocks(`## x${' \t'.repeat(25000)}y {#bad id}`, 'test.md'));
    assert.ok(performance.now() - started < 1000, 'was about 4 s before the fix');
  });
});

describe('strongTexts', () => {
  it('returns the bold parts as plain text, including bold inside links and emphasis', () => {
    assert.deepEqual(strongTexts('Open **Settings → Privacy** and tap **`Advanced`**, then [**Save**](/x/).'), ['Settings → Privacy', 'Advanced', 'Save']);
    assert.deepEqual(strongTexts('No bold here, only *emphasis* and `code`.'), []);
  });
});

describe('figures in Markdown', () => {
  /** @type {import('../src/build/markdown.mjs').RenderContext} */
  const withFigures = { ...ctx, figure: (name, caption) => `<figure data-name="${name}">${caption}</figure>` };

  it('parses a figure on a line of its own, keeping the caption for rendering', () => {
    const nodes = parseBlocks('Intro text.\n![The **site** is at the end](figure:link-anatomy)\nMore text.', 'test.md');
    assert.deepEqual(nodes.map((n) => n.type), ['paragraph', 'figure', 'paragraph']);
    assert.deepEqual(nodes[1], { type: 'figure', name: 'link-anatomy', caption: 'The **site** is at the end', line: 2 });
  });

  it('renders the caption as escaped inline Markdown and hands it to the figure resolver', () => {
    const out = renderBlocks(parseBlocks('![Use <b> **this**](figure:x)', 'test.md'), withFigures).toString();
    assert.equal(out, '<figure data-name="x">Use &lt;b&gt; <strong>this</strong></figure>');
  });

  it('rejects other image syntax, empty captions and figures inside callouts', () => {
    assert.throws(() => parseBlocks('![photo](https://example.org/a.png)', 'test.md'), /test\.md:1 — Images must be figures/);
    assert.throws(() => parseBlocks('![](figure:x)', 'test.md'), /Images must be figures/);
    assert.throws(() => parseBlocks('![A](figure:Bad_Name)', 'test.md'), /Images must be figures/);
    assert.throws(() => parseBlocks('![A](figure:x) and text', 'test.md'), /Images must be figures/);
    assert.throws(() => parseBlocks('> [!note]\n> ![A](figure:x)', 'test.md'), /Callouts may only contain paragraphs and lists/);
  });

  it('ends a list before a figure', () => {
    const nodes = parseBlocks('1. One\n![A](figure:x)', 'test.md');
    assert.deepEqual(nodes.map((n) => n.type), ['list', 'figure']);
  });

  it('fails where no figures are available', () => {
    assert.throws(() => render('![A](figure:x)'), /Figures are not supported here/);
  });
});

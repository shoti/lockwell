// @ts-check
/**
 * @file Tests for the pre-launch audit checks (scripts/audit/lib.mjs) and for security.txt.
 */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { describe, it } from 'node:test';
import {
  daysLeft,
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
} from '../scripts/audit/lib.mjs';

describe('audit: unicode hygiene', () => {
  it('finds a Hebrew letter hidden inside a Georgian word', () => {
    // "კოდზე" typed with Hebrew vav (U+05D5) and dalet (U+05D3) in place of ო and დ.
    assert.deepEqual(mixedScriptWords('კოდის კודზე'), [{ word: 'კודზე', codePoints: ['U+05D5', 'U+05D3'] }]);
  });

  it('finds Cyrillic and Greek look-alikes, and leaves Latin names with a hyphenated ending alone', () => {
    assert.equal(mixedScriptWords('პაროლа').length, 1);
    assert.equal(mixedScriptWords('οა').length, 1);
    assert.deepEqual(mixedScriptWords('Lockwell-ის **Log out**-ს iPhone-ზე'), []);
  });
});

describe('audit: glued text', () => {
  it('finds digits and colons stuck to Georgian words', () => {
    assert.deepEqual(gluedText('ყველასთვის12 და დაიწყეთ:დაიცავით'), ['ყველასთვის12', 'დაიწყეთ:დაიცავით']);
  });

  it('accepts spaced text and hyphenated number endings', () => {
    assert.deepEqual(gluedText('ყველასთვის 12. დაიწყეთ: დაიცავით 1-ელი 2026 წელს'), []);
  });
});

describe('audit: link text vs address', () => {
  it('flags a publisher acronym that points at another site', () => {
    assert.match(labelMismatch('WOWT', 'https://www.wcax.com/2022/story') ?? '', /WOWT.*wcax\.com/);
  });

  it('accepts acronyms on their own domain and known aliases', () => {
    assert.equal(labelMismatch('CISA', 'https://www.cisa.gov/resources'), null);
    assert.equal(labelMismatch('FPF', 'https://freedom.press/digisec/'), null);
    assert.equal(labelMismatch('Signal support', 'https://support.signal.org/'), null);
  });

  it('flags a domain in the text that differs from the address', () => {
    assert.match(labelMismatch('see example.org', 'https://evil.test/') ?? '', /example\.org/);
    assert.equal(labelMismatch('support.apple.com', 'https://support.apple.com/en-us/102649'), null);
  });

  it('reads links out of Markdown', () => {
    assert.deepEqual(markdownLinks('See [EFF](https://ssd.eff.org/) and [guide](/guides/x/).'), [{ label: 'EFF', href: 'https://ssd.eff.org/' }]);
  });
});

describe('audit: rendered pages', () => {
  const page = `<html lang="en"><head><title>T</title><meta property="og:title" content="x"></head><body>
    <h1>Title</h1><h2 id="a">A</h2><h4 id="a">Deep</h4>
    <svg role="img"><text>Drawing words</text></svg><p>Visible <strong>text</strong></p></body></html>`;

  it('extracts what a reader sees, without the head or drawings', () => {
    const text = visibleText(page);
    assert.match(text, /Visible text/);
    assert.doesNotMatch(text, /Drawing words|og:title/);
  });

  it('finds duplicate ids and skipped heading levels', () => {
    assert.deepEqual(duplicateIds(page), ['a']);
    assert.deepEqual(headingSkips(page), ['h2 → h4: Deep']);
  });

  it('finds source syntax that reached the page', () => {
    assert.deepEqual(sourceLeaks('Fine text.\nAnother line'), []);
    assert.deepEqual(sourceLeaks('---\ntitle: Leaked'), ['a front matter fence (---)', 'front matter or meta keys']);
    assert.deepEqual(sourceLeaks('Use **Settings'), ['unparsed **bold** markers']);
    assert.deepEqual(sourceLeaks('TODO(author): x'), ['an editor TODO marker']);
  });
});

describe('audit: language parity helpers', () => {
  it('compares the numbers in two texts, ignoring thousands separators', () => {
    assert.deepEqual(numbersIn('1,000 users in 2026 and 30 days'), ['1000', '2026', '30']);
    assert.deepEqual(numberDiff(numbersIn('30 days, 7 days'), numbersIn('30 დღე, 14 დღე')), { onlyA: ['7'], onlyB: ['14'] });
  });

  it('splits a body into sections by item id', () => {
    const sections = sectionsById('Intro text\n## One {#one .essential}\nBody 1\n## Two {#two}\nBody 2');
    assert.deepEqual([...sections.keys()], ['intro', 'one', 'two']);
    assert.match(sections.get('one') ?? '', /Body 1/);
  });
});

describe('audit: claims registry', () => {
  it('counts the days until a claim must be checked again', () => {
    const now = new Date('2026-11-15T12:00:00Z');
    assert.equal(daysLeft({ checked_on: '2026-11-15', expires_in_days: 30 }, now), 29);
    assert.ok(daysLeft({ checked_on: '2026-01-01', expires_in_days: 30 }, now) < 0);
  });
});

describe('security.txt', () => {
  it('names a contact and the canonical address, and does not expire within 30 days', async () => {
    const text = await readFile(new URL('../src/public/.well-known/security.txt', import.meta.url), 'utf8');
    assert.match(text, /^Contact: (mailto:|https:\/\/)/m);
    assert.match(text, /^Canonical: https:\/\/lockwell\.org\/\.well-known\/security\.txt$/m);
    assert.match(text, /^Preferred-Languages: en, ka$/m);
    const expires = Date.parse(/^Expires: (.+)$/m.exec(text)?.[1] ?? '');
    assert.ok(expires - Date.now() > 30 * 86_400_000, 'security.txt expires within 30 days: set a new "Expires" (at most a year ahead)');
    // RFC 9116 recommends less than a year.
    assert.ok(expires - Date.now() < 366 * 86_400_000, 'security.txt "Expires" should be less than a year ahead');
  });
});

describe('audit: fewer false alarms', () => {
  it('accepts Georgian abbreviations and technical acronyms', () => {
    assert.deepEqual(gluedText('ე.წ. ფიშინგი'), []);
    assert.equal(labelMismatch('PQXDH', 'https://signal.org/docs/specifications/pqxdh/'), null);
  });

  it('keeps separate spans apart in visible text', () => {
    assert.match(visibleText('<body><span>ჩართულია.</span><span>ამ</span></body>'), /ჩართულია\. ამ/);
  });
});

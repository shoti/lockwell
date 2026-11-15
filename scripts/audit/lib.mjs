// @ts-check
/**
 * @file Pure checks used by the pre-launch audit (scripts/audit/*.mjs). Node built-ins only; tested in tests/audit.test.mjs.
 */

const GEORGIAN = '\\u10A0-\\u10FF\\u1C90-\\u1CBF\\u2D00-\\u2D2F';
const GEORGIAN_LETTER = new RegExp(`[${GEORGIAN}]`);
/** Letters of scripts that never belong inside a Georgian word and look alike in some fonts. */
const FOREIGN_LETTER = /[Ͱ-ϿЀ-ӿ԰-֏֐-׿؀-ۿ]/;

/**
 * @typedef {object} Finding
 * @property {'error' | 'warning'} level
 * @property {string} check   Short name of the check, e.g. "unicode".
 * @property {string} where   File, page or URL, with a line number when known.
 * @property {string} message What is wrong and what to look at.
 */

/**
 * Words that mix Georgian letters with letters of another script (Hebrew, Cyrillic, Greek, Armenian, Arabic):
 * these are typing or copy-paste accidents that look right on screen but break search and screen readers.
 * @param {string} text
 * @returns {{ word: string, codePoints: string[] }[]}
 */
export function mixedScriptWords(text) {
  /** @type {{ word: string, codePoints: string[] }[]} */
  const found = [];
  for (const word of text.split(/[\s.,;:!?„“"'()[\]{}*_/<>=#|`~@&%+…—–-]+/u)) {
    if (!GEORGIAN_LETTER.test(word)) continue;
    const foreign = [...word].filter((char) => FOREIGN_LETTER.test(char));
    if (foreign.length) {
      found.push({ word, codePoints: foreign.map((char) => `U+${(char.codePointAt(0) ?? 0).toString(16).toUpperCase().padStart(4, '0')}`) });
    }
  }
  return found;
}

/**
 * Text run together in Georgian prose: a digit stuck to a Georgian letter ("ყველასთვის12"), a colon or
 * sentence end with no space before the next Georgian word ("დაიწყეთ:დაიცავით").
 * Georgian endings after numbers are written with a hyphen ("1-ელი"), so they don't match.
 * @param {string} text
 * @returns {string[]}  The glued fragments.
 */
export function gluedText(text) {
  const pattern = new RegExp(
    `[${GEORGIAN}]+\\d+|\\d+[${GEORGIAN}]+|[${GEORGIAN}]+[:.!?][${GEORGIAN}]+`,
    'gu',
  );
  return [...text.matchAll(pattern)].map((match) => match[0]).filter((glued) => !ABBREVIATIONS.has(glued));
}

/** Georgian abbreviations written with a full stop and no space: "ე.წ." (so-called), "ა.შ." (and so on). */
const ABBREVIATIONS = new Set(['ე.წ', 'ა.შ', 'ძვ.წ', 'ახ.წ', 'მაგ.მ']);

/**
 * Publisher names that link somewhere other than their own domain on purpose (a known alias).
 * Keys are the label as written; values are hosts that are fine for it.
 */
export const LABEL_ALIASES = /** @type {Record<string, string[]>} */ ({
  FPF: ['freedom.press'],
  FBI: ['fbi.gov', 'ic3.gov'],
  EFF: ['eff.org'],
  NCSC: ['ncsc.gov.uk'],
  CISA: ['cisa.gov'],
  NSA: ['nsa.gov', 'defense.gov'],
  CPJ: ['cpj.org'],
  NBER: ['nber.org'],
  HIBP: ['haveibeenpwned.com', 'troyhunt.com'],
  DBIR: ['verizon.com'],
});

/** Acronyms that name a thing, not a publisher, so they may link anywhere. */
const TECHNICAL_TERMS = new Set(['FAQ', 'PDF', 'PQXDH', 'X3DH', 'VPN', 'DNS', 'SMS', 'PIN', 'API', 'RFC', 'HTML', 'EXIF', 'GPS', 'IMSI', 'MFA', 'SIM', 'USB', 'NFC', 'QR']);

/**
 * A link whose text names a publisher (an acronym like "WOWT", or a domain like "example.org") that its
 * address doesn't belong to. Heuristic: callers report these as warnings for a human to look at.
 * @param {string} label
 * @param {string} href
 * @returns {string | null}  Why it looks wrong, or null.
 */
export function labelMismatch(label, href) {
  let host;
  try {
    host = new URL(href).hostname.replace(/^www\./, '');
  } catch {
    return null;
  }
  const domain = /\b([a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:com|org|net|gov|edu|io|me|ge|uk|press|ai))\b/i.exec(label)?.[1]?.toLowerCase().replace(/^www\./, '');
  if (domain && !host.endsWith(domain) && !domain.endsWith(host)) return `text names ${domain} but the link goes to ${host}`;
  const acronym = /^[A-Z][A-Z0-9]{2,5}$/.test(label.trim()) && !TECHNICAL_TERMS.has(label.trim()) ? label.trim() : null;
  if (acronym) {
    const allowed = LABEL_ALIASES[acronym] ?? [acronym.toLowerCase()];
    if (!allowed.some((name) => host.includes(name))) return `text "${acronym}" but the link goes to ${host}`;
  }
  return null;
}

/**
 * The text a reader sees, roughly: drops the head, scripts, styles, templates and SVG drawings (figures are
 * announced through their title and description), then tags. One line per block element.
 * @param {string} html
 * @returns {string}
 */
export function visibleText(html) {
  return html
    .replace(/<head[\s\S]*?<\/head>/i, '')
    // Separate cells and alternatives (one shown at a time) are separate on screen.
    .replace(/<\/span>\s*<span\b/gi, ' <span')
    .replace(/<(script|style|template|svg)\b[\s\S]*?<\/\1>/gi, '')
    .replace(/<(?:br|\/p|\/h[1-6]|\/li|\/div|\/dt|\/dd|\/td|\/th|\/tr|\/section|\/article|\/header|\/footer|\/nav|\/figcaption)\b[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n+/g, '\n');
}

/** Source syntax that should never reach a rendered page. */
const LEAKS = [
  { pattern: /^\s*---\s*$/m, what: 'a front matter fence (---)' },
  { pattern: /\bmeta-og:|^\s*canonical:|^\s*(?:title|description|reviewed|status):\s/m, what: 'front matter or meta keys' },
  { pattern: /\{#[a-z][\w-]*[^}]*\}/, what: 'an unparsed {#id} attribute' },
  { pattern: /\*\*\S/, what: 'unparsed **bold** markers' },
  { pattern: /\]\((?:https?:|\/)/, what: 'an unparsed [link](url)' },
  { pattern: /\[!(?:note|warning|tip)\]/i, what: 'an unparsed callout marker' },
  { pattern: /TODO\(/, what: 'an editor TODO marker' },
];

/**
 * @param {string} text  Visible text of a page.
 * @returns {string[]}  What leaked.
 */
export function sourceLeaks(text) {
  return LEAKS.filter(({ pattern }) => pattern.test(text)).map(({ what }) => what);
}

/**
 * Every value of an attribute on matching tags.
 * @param {string} html
 * @param {string} tag    Tag name, or "*" for any.
 * @param {string} attr
 * @returns {string[]}
 */
export function attrValues(html, tag, attr) {
  const tagPattern = tag === '*' ? '[a-zA-Z][\\w-]*' : tag;
  const pattern = new RegExp(`<${tagPattern}\\b[^>]*?\\s${attr}="([^"]*)"`, 'g');
  return [...html.matchAll(pattern)].map((match) => match[1]);
}

/**
 * Ids used more than once in a page.
 * @param {string} html
 * @returns {string[]}
 */
export function duplicateIds(html) {
  const seen = new Set();
  const twice = new Set();
  for (const id of attrValues(html, '*', 'id')) {
    if (seen.has(id)) twice.add(id);
    seen.add(id);
  }
  return [...twice];
}

/**
 * Headings that skip a level going down (h2 straight to h4), which breaks the outline for screen readers.
 * Going back up any number of levels is fine.
 * @param {string} html
 * @returns {string[]}  e.g. ["h2 → h4: Title"]
 */
export function headingSkips(html) {
  const body = html.replace(/<(svg|template)\b[\s\S]*?<\/\1>/gi, '');
  /** @type {string[]} */
  const skips = [];
  let previous = 0;
  for (const match of body.matchAll(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi)) {
    const level = Number(match[1]);
    if (previous && level > previous + 1) skips.push(`h${previous} → h${level}: ${match[2].replace(/<[^>]+>/g, '').trim().slice(0, 60)}`);
    previous = level;
  }
  return skips;
}

/**
 * Numbers in a piece of text, as a sorted list (for comparing two languages). Thousands separators and
 * decimal commas differ between languages, so separators are dropped and only digit runs are kept.
 * @param {string} text
 * @returns {string[]}
 */
export function numbersIn(text) {
  return [...text.replace(/(\d)[ ,.  ](?=\d{3}\b)/g, '$1').matchAll(/\d+/g)].map((match) => match[0]).sort();
}

/**
 * The difference between two sorted lists of numbers, as "only in A" / "only in B".
 * @param {string[]} a
 * @param {string[]} b
 * @returns {{ onlyA: string[], onlyB: string[] }}
 */
export function numberDiff(a, b) {
  const rest = [...b];
  /** @type {string[]} */
  const onlyA = [];
  for (const n of a) {
    const index = rest.indexOf(n);
    if (index === -1) onlyA.push(n);
    else rest.splice(index, 1);
  }
  return { onlyA, onlyB: rest };
}

/**
 * Splits a guide or article body into sections by "## Heading {#id …}", keeping the text before the first one as "intro".
 * @param {string} body
 * @returns {Map<string, string>}
 */
export function sectionsById(body) {
  /** @type {Map<string, string>} */
  const sections = new Map();
  let id = 'intro';
  let lines = [];
  for (const line of body.split('\n')) {
    const heading = /^##\s.*\{#([\w-]+)[^}]*\}\s*$/.exec(line);
    if (heading) {
      sections.set(id, lines.join('\n'));
      id = heading[1];
      lines = [];
    } else {
      lines.push(line);
    }
  }
  sections.set(id, lines.join('\n'));
  return sections;
}

/**
 * External links in Markdown, in order.
 * @param {string} markdown
 * @returns {{ label: string, href: string }[]}
 */
export function markdownLinks(markdown) {
  return [...markdown.matchAll(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g)].map((match) => ({ label: match[1], href: match[2] }));
}

/**
 * Whether a claim in the registry needs rechecking.
 * @param {{ checked_on: string, expires_in_days: number }} claim
 * @param {Date} now
 * @returns {number}  Days left; negative when expired.
 */
export function daysLeft(claim, now) {
  const checked = Date.parse(`${claim.checked_on}T00:00:00Z`);
  return Math.floor((checked + claim.expires_in_days * 86_400_000 - now.getTime()) / 86_400_000);
}

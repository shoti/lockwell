// @ts-check
/**
 * @file Tool "Hidden character detector": finds invisible and look-alike characters in text.
 */
/**
 * Hidden character detector: finds invisible characters, unusual spaces and
 * look-alike letters in pasted text, shows where they are and offers a clean
 * version. Such characters can mark one copy of a text so a leak can be traced.
 *
 * Characters that a writing system or an emoji needs are left alone: joiners
 * in Arabic and Indic scripts and inside emoji, the selector that makes a
 * symbol an emoji, the tags of a regional flag, direction marks in text that
 * is written right to left.
 *
 * Nothing is sent or stored: the text only exists in the page.
 */

/** @typedef {'zeroWidth' | 'bidi' | 'tags' | 'softHyphen' | 'spaces' | 'trailing' | 'lookalike'} Kind */
/**
 * @typedef {object} Mark  A place in the text (UTF-16 offsets).
 * @property {number} start
 * @property {number} end
 * @property {Kind} kind
 * @property {string} label  What to show for an invisible character, e.g. "U+200B ×3"; "" for a visible letter.
 */
/**
 * @typedef {object} Scan
 * @property {Record<Kind, number>} counts  Characters found, except: lines for "trailing", words for "lookalike".
 * @property {number} total
 * @property {Mark[]} marks  In text order, not overlapping.
 * @property {string} clean
 * @property {string} secret  Text carried by tag characters, if any.
 */

/** @type {Kind[]} */
export const KINDS = ['zeroWidth', 'bidi', 'tags', 'softHyphen', 'spaces', 'trailing', 'lookalike'];

const ZERO_WIDTH = new Set([0x034f, 0x115f, 0x1160, 0x17b4, 0x17b5, 0x180e, 0x200b, 0x200c, 0x200d, 0x2060, 0x2061, 0x2062, 0x2063, 0x2064, 0x3164, 0xfeff, 0xffa0]);
/** Marks that right-to-left text legitimately uses. */
const DIRECTION_MARKS = new Set([0x061c, 0x200e, 0x200f]);
/** Embeddings, overrides and isolates: these reorder text and have no place in plain prose. */
const DIRECTION_CONTROLS = new Set([0x202a, 0x202b, 0x202c, 0x202d, 0x202e, 0x2066, 0x2067, 0x2068, 0x2069]);
const SPACES = new Set([0x00a0, 0x1680, 0x2000, 0x2001, 0x2002, 0x2003, 0x2004, 0x2005, 0x2006, 0x2007, 0x2008, 0x2009, 0x200a, 0x202f, 0x205f, 0x2800, 0x3000]);
/** Line breaks other than the usual ones; the clean text gets a plain line break. */
const LINE_BREAKS = new Set([0x0085, 0x2028, 0x2029]);

const JOINER_SCRIPT =
  /[\p{Script=Arabic}\p{Script=Syriac}\p{Script=Devanagari}\p{Script=Bengali}\p{Script=Gurmukhi}\p{Script=Gujarati}\p{Script=Oriya}\p{Script=Tamil}\p{Script=Telugu}\p{Script=Kannada}\p{Script=Malayalam}\p{Script=Sinhala}\p{Script=Khmer}\p{Script=Myanmar}\p{Script=Tibetan}\p{Script=Mongolian}]/u;
const RIGHT_TO_LEFT = /[\p{Script=Hebrew}\p{Script=Arabic}\p{Script=Syriac}\p{Script=Thaana}]/u;
const PICTOGRAPH = /\p{Extended_Pictographic}/u;
const EMOJI_BASE = /\p{Emoji}/u;
const EAST_ASIAN = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;
const SELECTOR_BASE = /[\p{Script=Han}\p{Script=Myanmar}\p{Sm}]/u;

const isTag = (/** @type {number} */ cp) => cp >= 0xe0000 && cp <= 0xe007f;
const isSelector = (/** @type {number} */ cp) => (cp >= 0xfe00 && cp <= 0xfe0f) || (cp >= 0xe0100 && cp <= 0xe01ef);
const isControl = (/** @type {number} */ cp) => (cp < 0x20 && cp !== 0x09 && cp !== 0x0a && cp !== 0x0d) || (cp >= 0x7f && cp <= 0x9f && cp !== 0x85);

/** @param {number} cp */
const codeLabel = (cp) => `U+${cp.toString(16).toUpperCase().padStart(4, '0')}`;

/**
 * Whether an invisible character is doing its ordinary job here.
 * @param {number} cp
 * @param {string} prev  The character before it ("" at the start).
 * @param {string} next  The character after it ("" at the end).
 * @param {boolean} rightToLeft  The text contains right-to-left writing.
 */
function expected(cp, prev, next, rightToLeft) {
  // Emoji: "this symbol is a picture", and the joiner between the parts of one emoji.
  if (cp === 0xfe0f || cp === 0xfe0e) return EMOJI_BASE.test(prev);
  if (cp === 0x200d && PICTOGRAPH.test(next) && (PICTOGRAPH.test(prev) || /[\u{fe0f}\u{1f3fb}-\u{1f3ff}\u{e007f}]/u.test(prev))) return true;
  // Scripts whose letters join: these control the shape of the letters.
  if (cp === 0x200c || cp === 0x200d) return JOINER_SCRIPT.test(prev);
  if (isSelector(cp)) return SELECTOR_BASE.test(prev);
  if (DIRECTION_MARKS.has(cp)) return rightToLeft;
  if (cp === 0x3000) return EAST_ASIAN.test(prev) || EAST_ASIAN.test(next);
  return false;
}

/**
 * @param {number} cp
 * @returns {Kind | null}
 */
function kindOf(cp) {
  if (isTag(cp)) return 'tags';
  if (ZERO_WIDTH.has(cp) || isSelector(cp) || isControl(cp)) return 'zeroWidth';
  if (DIRECTION_MARKS.has(cp) || DIRECTION_CONTROLS.has(cp)) return 'bidi';
  if (cp === 0x00ad) return 'softHyphen';
  if (SPACES.has(cp) || LINE_BREAKS.has(cp)) return 'spaces';
  return null;
}

const SCRIPTS = /** @type {const} */ ([
  ['latin', /\p{Script=Latin}/u],
  ['cyrillic', /\p{Script=Cyrillic}/u],
  ['greek', /\p{Script=Greek}/u],
]);

/**
 * Letters of a word that come from a different alphabet than the rest of it,
 * among Latin, Cyrillic and Greek (the alphabets with look-alike letters).
 * Returns their offsets in the word (UTF-16), or [] for an ordinary word.
 * @param {string} word
 */
export function foreignLetters(word) {
  /** @type {Record<string, number[]>} */
  const found = {};
  let offset = 0;
  for (const char of word) {
    const script = SCRIPTS.find(([, pattern]) => pattern.test(char))?.[0];
    if (script) (found[script] ??= []).push(offset);
    offset += char.length;
  }
  const groups = Object.entries(found);
  if (groups.length < 2) return [];
  // The alphabet with the most letters is the word's own; on a tie, Latin is.
  const own = groups.reduce((best, group) => (group[1].length > best[1].length || (group[1].length === best[1].length && group[0] === 'latin') ? group : best));
  return groups
    .filter((group) => group !== own)
    .flatMap(([, offsets]) => offsets)
    .sort((a, b) => a - b);
}

/**
 * @param {string} text
 * @returns {Scan}
 */
export function scanText(text) {
  /** @type {Record<Kind, number>} */
  const counts = { zeroWidth: 0, bidi: 0, tags: 0, softHyphen: 0, spaces: 0, trailing: 0, lookalike: 0 };
  /** @type {Mark[]} */
  const marks = [];
  const rightToLeft = RIGHT_TO_LEFT.test(text);
  const chars = Array.from(text);
  let clean = '';
  let secret = '';

  /**
   * Adds an invisible character, joining it to the mark before it when it
   * continues the same run ("U+200B ×3").
   * @param {number} start @param {number} end @param {Kind} kind @param {number} cp
   */
  const hide = (start, end, kind, cp) => {
    counts[kind] += 1;
    const name = kind === 'tags' ? 'U+E00xx' : codeLabel(cp);
    const last = marks.at(-1);
    const run = last && last.end === start && last.kind === kind ? /^(.+?)(?: ×(\d+))?$/.exec(last.label) : null;
    if (last && run && run[1] === name) {
      last.end = end;
      last.label = `${name} ×${Number(run[2] ?? 1) + 1}`;
    } else {
      marks.push({ start, end, kind, label: name });
    }
  };

  let at = 0;
  for (let index = 0; index < chars.length; index += 1) {
    const char = chars[index];
    const cp = /** @type {number} */ (char.codePointAt(0));
    const start = at;
    at += char.length;

    // A black flag followed by tag letters and a closing tag is a regional flag emoji.
    if (cp === 0x1f3f4) {
      let end = index + 1;
      while (end < chars.length && isTag(/** @type {number} */ (chars[end].codePointAt(0))) && chars[end] !== '\u{e007f}') end += 1;
      if (end > index + 1 && chars[end] === '\u{e007f}') {
        const flag = chars.slice(index, end + 1).join('');
        clean += flag;
        at += flag.length - char.length;
        index = end;
        continue;
      }
    }

    const kind = kindOf(cp);
    if (kind === null || expected(cp, chars[index - 1] ?? '', chars[index + 1] ?? '', rightToLeft)) {
      clean += char;
      continue;
    }
    hide(start, at, kind, cp);
    if (kind === 'spaces') clean += LINE_BREAKS.has(cp) ? '\n' : ' ';
    // Tag characters are ASCII moved to an invisible range.
    if (kind === 'tags' && cp >= 0xe0020 && cp <= 0xe007e) secret += String.fromCharCode(cp - 0xe0000);
  }

  // Ordinary spaces and tabs at the end of a line: one finding per line.
  for (const match of text.matchAll(/[ \t]+(?=\r?\n|$)/g)) {
    counts.trailing += 1;
    const name = match[0].startsWith('\t') ? 'U+0009' : 'U+0020';
    marks.push({ start: match.index, end: match.index + match[0].length, kind: 'trailing', label: match[0].length > 1 ? `${name} ×${match[0].length}` : name });
  }
  // Also drops spaces that only became the end of a line once invisible characters were removed.
  clean = clean.replace(/[ \t]+(?=\r?\n|$)/g, '');

  // Words that mix alphabets: one finding per word, each foreign letter marked.
  for (const match of text.matchAll(/[\p{L}\p{M}]+/gu)) {
    const offsets = foreignLetters(match[0]);
    if (offsets.length === 0) continue;
    counts.lookalike += 1;
    for (const offset of offsets) {
      const letter = String.fromCodePoint(/** @type {number} */ (match[0].codePointAt(offset)));
      marks.push({ start: match.index + offset, end: match.index + offset + letter.length, kind: 'lookalike', label: '' });
    }
  }

  marks.sort((a, b) => a.start - b.start);
  const total = KINDS.reduce((sum, kind) => sum + counts[kind], 0);
  return { counts, total, marks, clean, secret };
}

/** More marks than this are not drawn (the count and the clean text still cover everything). */
export const MAX_MARKS = 2000;

/**
 * The text cut into plain pieces and marks, for display.
 * @param {string} text
 * @param {Mark[]} marks
 * @returns {{ text: string, mark?: Mark }[]}
 */
export function pieces(text, marks) {
  /** @type {{ text: string, mark?: Mark }[]} */
  const result = [];
  let at = 0;
  for (const mark of marks.slice(0, MAX_MARKS)) {
    if (mark.start > at) result.push({ text: text.slice(at, mark.start) });
    result.push({ text: mark.label || text.slice(mark.start, mark.end), mark });
    at = mark.end;
  }
  if (at < text.length) result.push({ text: text.slice(at) });
  return result;
}

/** @param {HTMLElement} root  The tool's panel. */
export function init(root) {
  /** @param {string} name */
  const find = (name) => /** @type {HTMLElement} */ (root.querySelector(`[data-js="hidden-${name}"]`));
  const input = /** @type {HTMLTextAreaElement} */ (find('input'));
  const result = find('result');
  const summary = find('summary');
  const details = find('details');
  const secret = find('secret');
  const truncated = find('truncated');
  const marked = find('marked');
  const clean = find('clean');
  const rows = /** @type {HTMLElement[]} */ ([...root.querySelectorAll('[data-row]')]);
  const titles = Object.fromEntries(rows.map((row) => [row.dataset.row, row.querySelector('[data-js="hidden-name"]')?.textContent ?? '']));

  const update = () => {
    const text = input.value;
    result.hidden = text === '';
    if (text === '') return;

    const scan = scanText(text);
    summary.textContent = (scan.total ? (summary.dataset.found ?? '').replace('{n}', String(scan.total)) : summary.dataset.none) ?? '';
    result.dataset.state = scan.total ? 'warn' : 'ok';
    details.hidden = scan.total === 0;
    if (scan.total === 0) return;

    rows.forEach((row) => {
      const count = scan.counts[/** @type {Kind} */ (row.dataset.row)];
      row.hidden = count === 0;
      const badge = row.querySelector('[data-js="hidden-count"]');
      if (badge) badge.textContent = String(count);
    });
    secret.hidden = scan.secret === '';
    secret.textContent = (secret.dataset.template ?? '').replace('{text}', scan.secret);
    truncated.hidden = scan.marks.length <= MAX_MARKS;

    marked.replaceChildren(
      ...pieces(text, scan.marks).map((piece) => {
        if (!piece.mark) return document.createTextNode(piece.text);
        const element = document.createElement('mark');
        element.className = piece.mark.label ? 'marked__code' : 'marked__letter';
        element.title = titles[piece.mark.kind] ?? '';
        element.textContent = piece.text;
        return element;
      }),
    );
    clean.textContent = scan.clean;
  };

  input.addEventListener('input', update);
  update();
}

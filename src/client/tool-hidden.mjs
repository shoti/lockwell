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
import { receiveFiles } from './files.mjs';
import { fillInto, fillText } from './fill.mjs';

/**
 * @typedef {'zeroWidth' | 'bidi' | 'tags' | 'softHyphen' | 'spaces' | 'trailing' | 'lookalike'
 *   | 'doubleSpace' | 'quotes' | 'dashes' | 'fullwidth' | 'mathLetters' | 'compatibility' | 'composition' | 'dotless' | 'georgianCase'} Kind
 *   From doubleSpace on they are visible variations: they stay in the clean text unless it is normalised.
 */
/**
 * @typedef {object} Mark  A place in the text (UTF-16 offsets).
 * @property {number} start
 * @property {number} end
 * @property {Kind} kind
 * @property {string} label  What to show for an invisible character, e.g. "U+200B ×3"; "" for a visible letter.
 * @property {Kind[]} [also]  Other kinds found at the same place (one mark is shown for all of them).
 */
/**
 * @typedef {object} Scan
 * @property {Record<Kind, number>} counts  Characters found, except: lines for "trailing", words for "lookalike".
 * @property {number} total
 * @property {Mark[]} marks  In text order, not overlapping.
 * @property {string} clean
 * @property {string} secret  Text carried by tag characters or by a run of variation selectors, if any.
 */

/** @type {Kind[]} */
export const KINDS = ['zeroWidth', 'bidi', 'tags', 'softHyphen', 'spaces', 'trailing', 'lookalike', 'doubleSpace', 'quotes', 'dashes', 'fullwidth', 'mathLetters', 'compatibility', 'composition', 'dotless', 'georgianCase'];

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
/** Letters of a right-to-left script (not its format characters, which would otherwise excuse themselves). */
const RIGHT_TO_LEFT = /(?=\p{L})[\p{Script=Hebrew}\p{Script=Arabic}\p{Script=Syriac}\p{Script=Thaana}]/u;
/** Every invisible or format character (Unicode properties); the uses a script needs are excused in `expected`. */
const INVISIBLE = /[\p{Default_Ignorable_Code_Point}\p{Cf}]/u;
/** Format characters that belong to one script, with the letters they go with. */
const SCRIPT_FORMATS = /** @type {const} */ ([
  [/[\u0600-\u0605\u06dd\u0890\u0891\u08e2]/u, /[\p{Script=Arabic}\p{Nd}]/u],
  [/\u070f/u, /\p{Script=Syriac}/u],
  [/[\u180b-\u180d\u180f]/u, /\p{Script=Mongolian}/u],
  [/[\u{110bd}\u{110cd}]/u, /[\p{Script=Kaithi}\p{Nd}]/u],
  [/[\u{13430}-\u{1343f}]/u, /\p{Script=Egyptian_Hieroglyphs}/u],
  [/[\u{1bca0}-\u{1bca3}]/u, /\p{Script=Duployan}/u],
  [/[\u{1d173}-\u{1d17a}]/u, /[\u{1d100}-\u{1d1ff}]/u],
]);
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
  // Emoji: "this symbol is a picture", and the joiner between the parts of one emoji. Digits, # and * count
  // as emoji only in a keycap, where U+20E3 follows.
  if (cp === 0xfe0f || cp === 0xfe0e) return /^[0-9#*]$/.test(prev) ? next === '\u20e3' : EMOJI_BASE.test(prev);
  if (cp === 0x200d && PICTOGRAPH.test(next) && (PICTOGRAPH.test(prev) || /[\u{fe0f}\u{1f3fb}-\u{1f3ff}\u{e007f}]/u.test(prev))) return true;
  // Scripts whose letters join: these control the shape of the letters.
  if (cp === 0x200c || cp === 0x200d) return JOINER_SCRIPT.test(prev);
  if (isSelector(cp)) return SELECTOR_BASE.test(prev);
  if (DIRECTION_MARKS.has(cp)) return rightToLeft;
  if (cp === 0x3000) return EAST_ASIAN.test(prev) || EAST_ASIAN.test(next);
  const char = String.fromCodePoint(cp);
  const format = SCRIPT_FORMATS.find(([own]) => own.test(char));
  if (format) return format[1].test(prev) || format[1].test(next);
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
  if (INVISIBLE.test(String.fromCodePoint(cp))) return 'zeroWidth';
  return null;
}

const SCRIPTS = /** @type {const} */ ([
  ['latin', /\p{Script=Latin}/u],
  ['cyrillic', /\p{Script=Cyrillic}/u],
  ['greek', /\p{Script=Greek}/u],
  ['armenian', /\p{Script=Armenian}/u],
]);

/**
 * Letters that look like one Latin letter, each followed by it. From Unicode's confusables.txt (UTS #39,
 * version 18.0.0, read 2026-11-13): every entry from a single Cyrillic, Greek or Armenian letter to a single
 * ASCII letter. Two letters look alike when they look like the same Latin letter.
 */
const TWINS = [
  'αa ΑA ΒB ϲc ϹC ΕE ϜF ΗH ιi ϳj ͿJ ΚK Ιl ΜM ϺM ΝN οo σo ΟO ρp ϱp ϸp ΡP ᴦr ΤT υu νv ΧX γy ΥY ϒY ΖZ',
  'аa АA Ьb ВB сc ᲃc СC ԁd еe ҽe ЕE ԌG һh Һh НH іi ꙇi јj ЈJ КK Іl ӏl Ӏl МM оo ᲂo ОO рp РP ԛq ԚQ гr ѕs ЅS ТT ѵv ѴV ѡw шw ԝw ԜW хx ХX уy үy УY ҮY',
  'քf ցg հh ւi յj ոn ռn օo ՕO գq զq ՏS սu ՍU աw',
].flatMap((list) => list.split(' '));
/** Each look-alike letter and the Latin letter it looks like; Latin letters look like themselves. */
const SKELETON = new Map(TWINS.map((pair) => [pair.slice(0, -1), pair.slice(-1)]));
/** @param {string} letter */
const skeleton = (letter) => (/^[a-zA-Z]$/.test(letter) ? letter : SKELETON.get(letter));

/** @param {string} char @returns {string | undefined} */
const scriptOf = (char) => SCRIPTS.find(([, pattern]) => pattern.test(char))?.[0];

/**
 * The alphabet most of a text's letters are in, or null when that is one without look-alikes (Georgian, say).
 * @param {string} text
 */
function mainAlphabet(text) {
  /** @type {Record<string, number>} */
  const counts = {};
  for (const [letter] of text.matchAll(/\p{L}/gu)) {
    const script = scriptOf(letter) ?? 'other';
    counts[script] = (counts[script] ?? 0) + 1;
  }
  const [main] = Object.entries(counts).sort((a, b) => b[1] - a[1] || (a[0] === 'latin' ? -1 : 1))[0] ?? [];
  return main && main !== 'other' ? main : null;
}

/**
 * Whether a word is written entirely in another alphabet than the text's, with letters that all have twins in
 * the text's alphabet, so it passes for a word of the text: a Cyrillic "а" for the English "a".
 * @param {string} word
 * @param {string | null} main  See mainAlphabet.
 * @param {Set<string>} available  The Latin letters the text's alphabet has twins of.
 */
function passesFor(word, main, available) {
  const letters = [...word].filter((char) => /\p{L}/u.test(char));
  if (!main || letters.length === 0) return false;
  const script = scriptOf(letters[0]);
  if (!script || script === main || letters.some((letter) => scriptOf(letter) !== script)) return false;
  return letters.every((letter) => {
    const latin = skeleton(letter);
    return latin !== undefined && available.has(latin);
  });
}

/** The Latin letters an alphabet has twins of. @param {string | null} main */
function twinsIn(main) {
  if (main === 'latin') return new Set([...'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ']);
  return new Set(TWINS.filter((pair) => scriptOf(pair[0]) === main).map((pair) => pair.slice(-1)));
}

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

/* ---------- Visible variations ---------- */

/** Letters only Turkish and Azerbaijani use besides the dotless ı: text with them is written in those languages. */
const TURKIC = /[şğçöüİƏəŞĞÇÖÜ]/u;
const GEORGIAN = /\p{Script=Georgian}/u;
const MKHEDRULI = /[\u10d0-\u10ff]/u;
const MTAVRULI = /[\u1c90-\u1cbf]/gu;
const DOUBLE_QUOTES = /["“”„«»]/g;
const SINGLE_QUOTES = /['‘’‚]/g;
/** A hyphen-minus and the characters that look almost the same: hyphen, non-breaking hyphen, minus sign. */
const HYPHENS = /[-\u2010\u2011\u2212]/g;
/**
 * Typography that compatibility normalisation would also turn into ASCII but that is ordinary in prose:
 * the ellipsis, superscript and subscript digits, fractions, trade marks, circled numbers, squared units.
 */
const ORDINARY_TYPOGRAPHY = /[\u2026\u00b2\u00b3\u00b9\u00bc-\u00be\u2070-\u209f\u2150-\u215f\u2189\u2120\u2122\u2460-\u24ff\u3371-\u33df]/u;
/** Already reported as another kind. */
const HANDLED_ELSEWHERE = /[\uff01-\uff5e\u{1d400}-\u{1d7ff}]/u;

/**
 * @typedef {object} Variant  A visible variation: where it is and what the normalised text has instead.
 * @property {number} start
 * @property {number} end
 * @property {Kind} kind
 * @property {string} replacement
 * @property {string} label  As for a Mark.
 */

/**
 * Straight and typographic quotes mixed in one text: the less common style
 * (straight on a tie), with what the more common style writes instead.
 * @param {string} text
 * @param {RegExp} pattern  All quotes of one kind (double or single).
 * @param {string} straight
 * @param {(opening: boolean) => string} typographic
 * @returns {Variant[]}
 */
function mixedQuotes(text, pattern, straight, typographic) {
  const found = [...text.matchAll(pattern)];
  const plain = found.filter((match) => match[0] === straight);
  const curly = found.filter((match) => match[0] !== straight);
  if (plain.length === 0 || curly.length === 0) return [];
  const minority = curly.length < plain.length ? curly : plain;
  return minority.map((match) => {
    const before = text[match.index - 1] ?? '';
    const opening = before === '' || /[\s([{]/.test(before);
    const replacement = match[0] === straight ? typographic(opening) : straight;
    return { start: match.index, end: match.index + 1, kind: /** @type {Kind} */ ('quotes'), replacement, label: '' };
  });
}

/**
 * One character used where the text mostly uses a look-alike of it (hyphens): the less common characters,
 * with the most common one as the replacement. On a tie the plain one wins.
 * @param {string} text
 * @param {RegExp} pattern
 * @param {string} plain
 * @param {Kind} kind
 * @returns {Variant[]}
 */
function mixedForms(text, pattern, plain, kind) {
  const found = [...text.matchAll(pattern)];
  /** @type {Map<string, number>} */
  const counts = new Map();
  for (const [char] of found) counts.set(char, (counts.get(char) ?? 0) + 1);
  if (counts.size < 2) return [];
  const [usual] = [...counts].sort((a, b) => b[1] - a[1] || (a[0] === plain ? -1 : b[0] === plain ? 1 : 0))[0];
  return found.filter((match) => match[0] !== usual).map((match) => ({ start: match.index, end: match.index + 1, kind, replacement: usual, label: '' }));
}

/**
 * The modifier letter apostrophe ʼ beside ordinary apostrophes: it looks the same, so it can mark a copy.
 * @param {string} text
 * @param {Variant[]} quotes  Already found, so a place is not reported twice.
 * @returns {Variant[]}
 */
function mixedApostrophes(text, quotes) {
  const modifier = [...text.matchAll(/\u02bc/g)];
  const others = [...text.matchAll(/['’]/g)];
  if (modifier.length === 0 || others.length === 0) return [];
  const taken = new Set(quotes.map((variant) => variant.start));
  if (modifier.length <= others.length) {
    const usual = others.filter((match) => match[0] === "'").length * 2 >= others.length ? "'" : '’';
    return modifier.map((match) => ({ start: match.index, end: match.index + 1, kind: /** @type {Kind} */ ('quotes'), replacement: usual, label: '' }));
  }
  return others.filter((match) => !taken.has(match.index)).map((match) => ({ start: match.index, end: match.index + 1, kind: /** @type {Kind} */ ('quotes'), replacement: '\u02bc', label: '' }));
}

/**
 * Accented letters stored as one character in some places and as a letter plus a combining accent in
 * others: the decomposed ones are marked, and become single characters (NFC) when normalised.
 * @param {string} text
 * @returns {Variant[]}
 */
function mixedComposition(text) {
  const decomposed = [...text.matchAll(/\P{M}\p{M}+/gu)].filter((match) => match[0].normalize('NFC') !== match[0]);
  if (decomposed.length === 0) return [];
  const composed = [...text].some((char) => /\p{L}/u.test(char) && char.normalize('NFD') !== char);
  if (!composed) return [];
  return decomposed.map((match) => ({ start: match.index, end: match.index + match[0].length, kind: /** @type {Kind} */ ('composition'), replacement: match[0].normalize('NFC'), label: '' }));
}

/**
 * Symbols that stand in for ordinary letters or punctuation: a ligature, a Roman numeral, ℓ, the one-dot
 * leader, the Greek question mark. Found as characters whose compatibility form (NFKC) is plain ASCII.
 * @param {string} text
 * @returns {Variant[]}
 */
function compatibilityForms(text) {
  /** @type {Variant[]} */
  const found = [];
  let at = 0;
  for (const char of text) {
    const plain = char.normalize('NFKC');
    const cp = /** @type {number} */ (char.codePointAt(0));
    if (plain !== char && /^[\x21-\x7e]+$/.test(plain) && !ORDINARY_TYPOGRAPHY.test(char) && !HANDLED_ELSEWHERE.test(char) && kindOf(cp) === null) {
      found.push({ start: at, end: at + char.length, kind: 'compatibility', replacement: plain, label: '' });
    }
    at += char.length;
  }
  return found;
}

/**
 * Visible variations that can mark one copy of a text: spacing, quotes and
 * letter forms. Characters a language needs are left alone (full-width
 * letters in East Asian text, ı in Turkish, capitals in a Georgian title).
 * @param {string} text
 * @returns {Variant[]}
 */
export function variations(text) {
  /** @type {Variant[]} */
  const found = [];
  for (const match of text.matchAll(/(?<=\S) {2,}(?=\S)/g)) {
    found.push({ start: match.index, end: match.index + match[0].length, kind: 'doubleSpace', replacement: ' ', label: `U+0020 ×${match[0].length}` });
  }
  const georgian = GEORGIAN.test(text);
  const quotes = [
    ...mixedQuotes(text, DOUBLE_QUOTES, '"', (opening) => (georgian ? (opening ? '„' : '“') : opening ? '“' : '”')),
    ...mixedQuotes(text, SINGLE_QUOTES, "'", (opening) => (opening ? '‘' : '’')),
  ];
  found.push(...quotes, ...mixedApostrophes(text, quotes), ...mixedForms(text, HYPHENS, '-', 'dashes'), ...compatibilityForms(text), ...mixedComposition(text));
  if (!EAST_ASIAN.test(text)) {
    for (const match of text.matchAll(/[\uff01-\uff5e]/g)) found.push({ start: match.index, end: match.index + 1, kind: 'fullwidth', replacement: match[0].normalize('NFKC'), label: '' });
  }
  for (const match of text.matchAll(/[\u{1d400}-\u{1d7ff}]/gu)) {
    found.push({ start: match.index, end: match.index + match[0].length, kind: 'mathLetters', replacement: match[0].normalize('NFKC'), label: '' });
  }
  const turkic = TURKIC.test(text);
  for (const word of text.matchAll(/[\p{L}\p{M}]+/gu)) {
    if (!turkic && word[0].includes('ı') && /^[a-zA-Zı]+$/.test(word[0]) && /[a-zA-Z]/.test(word[0])) {
      for (const letter of word[0].matchAll(/ı/g)) found.push({ start: word.index + letter.index, end: word.index + letter.index + 1, kind: 'dotless', replacement: 'i', label: '' });
    }
    if (MKHEDRULI.test(word[0])) {
      for (const capital of word[0].matchAll(MTAVRULI)) {
        found.push({ start: word.index + capital.index, end: word.index + capital.index + 1, kind: 'georgianCase', replacement: capital[0].toLowerCase(), label: '' });
      }
    }
  }
  return found.sort((a, b) => a.start - b.start);
}

/**
 * The text with its visible variations made uniform.
 * @param {string} text
 */
export function normalise(text) {
  let out = '';
  let at = 0;
  for (const variant of variations(text)) {
    if (variant.start < at) continue; // a place already changed by another variation
    out += text.slice(at, variant.start) + variant.replacement;
    at = variant.end;
  }
  return out + text.slice(at);
}

/**
 * Bytes carried by runs of variation selectors after one character: 0–15 as
 * U+FE00–FE0F, 16–255 as U+E0100–E01EF. A single selector is ordinary (it
 * picks an emoji's look); two or more in a row only carry data.
 * @param {string[]} chars
 */
function selectorData(chars) {
  /** @type {string[]} */
  const messages = [];
  let run = [];
  for (const char of [...chars, '']) {
    const cp = char.codePointAt(0) ?? 0;
    if (char !== '' && isSelector(cp)) {
      run.push(cp < 0xe0100 ? cp - 0xfe00 : cp - 0xe0100 + 16);
      continue;
    }
    if (run.length > 1) {
      // Control characters (such as a presentation selector read as byte 15) are not part of a message.
      const text = new TextDecoder().decode(Uint8Array.from(run)).replace(/[\u0000-\u001f\u007f\ufffd]/g, '');
      if (text) messages.push(text);
    }
    run = [];
  }
  return messages.join(' ');
}

/**
 * @param {string} text
 * @param {{ normalise?: boolean }} [options]  normalise: also make the visible variations uniform in the clean text.
 * @returns {Scan}
 */
export function scanText(text, options = {}) {
  /** @type {Record<Kind, number>} */
  const counts = /** @type {Record<Kind, number>} */ (Object.fromEntries(KINDS.map((kind) => [kind, 0])));
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

  // Words that mix alphabets, and whole words in another alphabet that pass for the text's own:
  // one finding per word, each foreign letter marked.
  const main = mainAlphabet(text);
  const available = twinsIn(main);
  for (const match of text.matchAll(/[\p{L}\p{M}]+/gu)) {
    const offsets = passesFor(match[0], main, available) ? [...match[0]].map((_, index, chars) => chars.slice(0, index).join('').length) : foreignLetters(match[0]);
    if (offsets.length === 0) continue;
    counts.lookalike += 1;
    for (const offset of offsets) {
      const letter = String.fromCodePoint(/** @type {number} */ (match[0].codePointAt(offset)));
      marks.push({ start: match.index + offset, end: match.index + offset + letter.length, kind: 'lookalike', label: '' });
    }
  }

  // Spacing, quotes and letter forms: marked in place, changed in the clean text only on request.
  for (const variant of variations(text)) {
    counts[variant.kind] += 1;
    marks.push({ start: variant.start, end: variant.end, kind: variant.kind, label: variant.label });
  }
  if (options.normalise) clean = normalise(clean);

  const carried = selectorData(chars);
  if (carried) secret = secret ? `${secret} ${carried}` : carried;

  const total = KINDS.reduce((sum, kind) => sum + counts[kind], 0);
  return { counts, total, marks: merged(marks), clean, secret };
}

/**
 * Marks in text order, those at the same place joined into one, so no character is shown twice. The joined
 * mark keeps the kind listed first in KINDS and names the others in `also`.
 * @param {Mark[]} marks
 * @returns {Mark[]}
 */
function merged(marks) {
  /** @type {Mark[]} */
  const out = [];
  for (const mark of [...marks].sort((a, b) => a.start - b.start || KINDS.indexOf(a.kind) - KINDS.indexOf(b.kind))) {
    const last = out.at(-1);
    if (!last || mark.start >= last.end) {
      out.push({ ...mark });
      continue;
    }
    last.end = Math.max(last.end, mark.end);
    if (mark.kind !== last.kind && !last.also?.includes(mark.kind)) last.also = [...(last.also ?? []), mark.kind];
    if (!last.label) last.label = mark.label;
  }
  return out;
}

/* ---------- Comparing two copies ---------- */

/** Words, runs of white space, and every other character on its own (punctuation, invisible characters). */
const TOKEN = /[\p{L}\p{M}\p{N}]+|\s+|[\s\S]/gu;
/** Copies longer than this many pieces are not compared (the comparison would take too long). */
const MAX_TOKENS = 20_000;
/** Copies that differ in more places than this are too different to compare piece by piece. */
const MAX_EDITS = 2_000;

/**
 * @typedef {{ kind: 'same' | 'removed' | 'added', text: string }} DiffPiece
 * @typedef {{ status: 'ok', differences: number, pieces: DiffPiece[] } | { status: 'tooLong' | 'tooDifferent' }} Comparison
 */

/**
 * The pieces of the shortest way from one list to the other (Myers, "An O(ND)
 * Difference Algorithm and Its Variations", 1986).
 * @param {string[]} a
 * @param {string[]} b
 * @returns {DiffPiece[] | null}  null when there are more than MAX_EDITS changes.
 */
function diff(a, b) {
  const max = a.length + b.length;
  const offset = max + 1;
  let v = new Int32Array(2 * max + 3);
  /** @type {Int32Array[]} */
  const trace = [];
  let found = false;
  for (let d = 0; d <= Math.min(max, MAX_EDITS) && !found; d += 1) {
    trace.push(v.slice(offset - d - 1, offset + d + 2));
    const next = v.slice();
    for (let k = -d; k <= d; k += 2) {
      let x = k === -d || (k !== d && v[offset + k - 1] < v[offset + k + 1]) ? v[offset + k + 1] : v[offset + k - 1] + 1;
      let y = x - k;
      while (x < a.length && y < b.length && a[x] === b[y]) {
        x += 1;
        y += 1;
      }
      next[offset + k] = x;
      if (x >= a.length && y >= b.length) found = true;
    }
    v = next;
  }
  if (!found) return null;

  /** @type {DiffPiece[]} */
  const pieces = [];
  let [x, y] = [a.length, b.length];
  for (let d = trace.length - 1; d >= 0; d -= 1) {
    const saved = trace[d];
    /** @param {number} k */
    const at = (k) => saved[k + d + 1];
    const k = x - y;
    const down = k === -d || (k !== d && at(k - 1) < at(k + 1));
    const previousK = down ? k + 1 : k - 1;
    const previousX = d === 0 ? 0 : at(previousK);
    const previousY = previousX - previousK;
    while (x > previousX && y > previousY) {
      x -= 1;
      y -= 1;
      pieces.push({ kind: 'same', text: a[x] });
    }
    if (d > 0) {
      if (down) pieces.push({ kind: 'added', text: b[previousY] });
      else pieces.push({ kind: 'removed', text: a[previousX] });
    }
    [x, y] = [previousX, previousY];
  }
  return pieces.reverse();
}

/**
 * Compares two copies of a text piece by piece: words, spacing, punctuation
 * and invisible characters. Copies of a leaked text that were made different
 * on purpose differ in exactly these.
 * @param {string} first
 * @param {string} second
 * @returns {Comparison}
 */
export function compareTexts(first, second) {
  const a = first.match(TOKEN) ?? [];
  const b = second.match(TOKEN) ?? [];
  if (a.length > MAX_TOKENS || b.length > MAX_TOKENS) return { status: 'tooLong' };
  const raw = diff(a, b);
  if (!raw) return { status: 'tooDifferent' };

  /** @type {DiffPiece[]} */
  const pieces = [];
  let differences = 0;
  let changing = false;
  // In each run of changes, what was removed comes before what was added.
  for (let index = 0; index < raw.length; ) {
    if (raw[index].kind === 'same') {
      const last = pieces.at(-1);
      if (last?.kind === 'same') last.text += raw[index].text;
      else pieces.push({ ...raw[index] });
      changing = false;
      index += 1;
      continue;
    }
    let end = index;
    while (end < raw.length && raw[end].kind !== 'same') end += 1;
    const run = raw.slice(index, end);
    for (const kind of /** @type {const} */ (['removed', 'added'])) {
      const text = run.filter((piece) => piece.kind === kind).map((piece) => piece.text);
      // Each removed or added piece stays separate, so a changed space reads as one.
      for (const piece of text) pieces.push({ kind, text: piece });
    }
    if (!changing) differences += 1;
    changing = true;
    index = end;
  }
  return { status: 'ok', differences, pieces };
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

/** Waits this long after the last keystroke before scanning again, so long pastes stay smooth. */
const TYPING_PAUSE_MS = 200;
/** Text files larger than this are not opened (paste the part to check instead). */
const MAX_FILE_BYTES = 5 * 1024 * 1024;

/**
 * What to show for a piece of a comparison: spaces and invisible characters
 * made visible, everything else as it is.
 * @param {string} text
 */
export function visiblePiece(text) {
  if (/^\s+$/.test(text)) return text.replace(/ /g, '·').replace(/\t/g, '→').replace(/\r?\n/g, '↵\n').replace(/[^\S\n]/g, (char) => codeLabel(/** @type {number} */ (char.codePointAt(0))));
  const cp = /** @type {number} */ (text.codePointAt(0));
  return [...text].length === 1 && kindOf(cp) !== null ? codeLabel(cp) : text;
}

/** @param {HTMLElement} root  The tool's panel. */
export function init(root) {
  /** @param {string} name */
  const find = (name) => /** @type {HTMLElement} */ (root.querySelector(`[data-js="hidden-${name}"]`));
  const input = /** @type {HTMLTextAreaElement} */ (find('input'));
  const other = /** @type {HTMLTextAreaElement} */ (find('other'));
  const normaliseBox = /** @type {HTMLInputElement} */ (find('normalise'));
  const result = find('result');
  const summary = find('summary');
  const details = find('details');
  const secret = find('secret');
  const truncated = find('truncated');
  const marked = find('marked');
  const markInfo = find('mark-info');
  const markHint = markInfo.textContent ?? '';
  const clean = find('clean');
  const compareSummary = find('compare-summary');
  const compared = find('compare');
  const fileMessage = find('file-message');
  const fileHint = fileMessage.textContent ?? '';
  const rows = /** @type {HTMLElement[]} */ ([...root.querySelectorAll('[data-row]')]);
  const titles = Object.fromEntries(rows.map((row) => [row.dataset.row, row.querySelector('[data-js="hidden-name"]')?.textContent ?? '']));
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let pending;

  const scan = () => {
    const text = input.value;
    result.hidden = text === '';
    if (text === '') return;

    const found = scanText(text, { normalise: normaliseBox.checked });
    summary.textContent = (found.total ? fillText(summary.dataset.found, { n: String(found.total) }) : summary.dataset.none) ?? '';
    result.dataset.state = found.total ? 'warn' : 'ok';
    details.hidden = found.total === 0;
    if (found.total === 0) return;

    rows.forEach((row) => {
      const count = found.counts[/** @type {Kind} */ (row.dataset.row)];
      row.hidden = count === 0;
      const badge = row.querySelector('[data-js="hidden-count"]');
      if (badge) badge.textContent = String(count);
    });
    secret.hidden = found.secret === '';
    // The hidden message may come from a file: kept apart from the sentence's own direction.
    fillInto(secret, secret.dataset.template ?? '', { text: found.secret });
    truncated.hidden = found.marks.length <= MAX_MARKS;

    markInfo.textContent = markHint;
    marked.replaceChildren(
      ...pieces(text, found.marks).map((piece) => {
        if (!piece.mark) return document.createTextNode(piece.text);
        const element = document.createElement('mark');
        element.className = piece.mark.label ? 'marked__code' : 'marked__letter';
        const names = [piece.mark.kind, ...(piece.mark.also ?? [])].map((kind) => titles[kind] ?? '').join(', ');
        element.title = names;
        element.dataset.names = names;
        element.textContent = piece.text;
        // The kind in words for screen readers; the title alone reaches only a mouse.
        const spoken = document.createElement('span');
        spoken.className = 'visually-hidden';
        spoken.textContent = ` (${names})`;
        element.append(spoken);
        return element;
      }),
    );
    clean.textContent = found.clean;
  };

  const compare = () => {
    compared.hidden = true;
    if (other.value === '') {
      compareSummary.textContent = '';
      return;
    }
    if (input.value === '') {
      compareSummary.textContent = compareSummary.dataset.needsFirst ?? '';
      return;
    }
    const comparison = compareTexts(input.value, other.value);
    if (comparison.status !== 'ok') {
      compareSummary.textContent = compareSummary.dataset[comparison.status] ?? '';
      return;
    }
    compareSummary.textContent = comparison.differences ? fillText(compareSummary.dataset.found, { n: String(comparison.differences) }) : (compareSummary.dataset.same ?? '');
    if (comparison.differences === 0) return;
    compared.hidden = false;
    compared.replaceChildren(
      ...comparison.pieces.map((piece) => {
        if (piece.kind === 'same') return document.createTextNode(piece.text);
        const element = document.createElement(piece.kind === 'removed' ? 'del' : 'ins');
        element.className = piece.kind === 'removed' ? 'marked__removed' : 'marked__added';
        element.textContent = visiblePiece(piece.text);
        return element;
      }),
    );
  };

  const update = () => {
    clearTimeout(pending);
    scan();
    compare();
  };
  const later = () => {
    clearTimeout(pending);
    pending = setTimeout(update, TYPING_PAUSE_MS);
  };

  /** @param {File | undefined} file */
  const open = async (file) => {
    if (!file) return;
    if (file.size > MAX_FILE_BYTES) {
      fileMessage.textContent = fileMessage.dataset.tooLarge ?? '';
      return;
    }
    if (!/^text\//.test(file.type) && !/\.(txt|md|csv)$/i.test(file.name)) {
      fileMessage.textContent = fileMessage.dataset.unsupported ?? '';
      return;
    }
    const text = await file.text();
    // A text file has no NUL bytes; a Word or PDF file renamed to .txt does.
    if (text.includes('\u0000')) {
      fileMessage.textContent = fileMessage.dataset.unsupported ?? '';
      return;
    }
    fileMessage.textContent = fileHint;
    input.value = text;
    update();
  };

  // A tap or click on a mark says what it is, for those without a mouse to hover.
  marked.addEventListener('click', (event) => {
    const mark = event.target instanceof Element ? event.target.closest('mark') : null;
    if (mark instanceof HTMLElement) markInfo.textContent = `${mark.firstChild?.textContent ?? ''}: ${mark.dataset.names ?? ''}`;
  });
  input.addEventListener('input', later);
  other.addEventListener('input', later);
  normaliseBox.addEventListener('change', update);
  find('example').addEventListener('click', () => {
    input.value = find('example').dataset.example ?? '';
    update();
  });
  const file = /** @type {HTMLInputElement} */ (find('file'));
  file.addEventListener('change', () => open(file.files?.[0]));
  receiveFiles(root, open);
  update();
}

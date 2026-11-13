// @ts-check
/**
 * @file Loads explanatory figures (a small SVG subset), validates them and renders them inline.
 */
/**
 * Figures live in content/<lang>/figures/<name>.svg, one file per language, and
 * are placed in Markdown with `![Caption](figure:name)`. They are drawn into
 * the page as inline SVG, so they use the site's font, follow the light and dark
 * themes and print with the guide.
 *
 * Nothing in a figure file reaches the page as written. The file is parsed into
 * a tree of allowed elements and attributes, and the tree is written out again
 * with every value escaped. Anything outside the subset fails the build:
 * scripts, links, styles, ids, external references and unknown classes alike.
 * Colours come only from the classes in FIGURE_CLASSES (styled in
 * 05-components.css), so a figure can't break the CSP or the themes.
 */
import { readdir, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { ContentError } from './errors.mjs';
import { escapeHtml } from './html.mjs';
import { ROOT } from './site.mjs';

/**
 * @typedef {object} FigureElement
 * @property {string} name
 * @property {[string, string][]} attrs  In source order.
 * @property {FigureNode[]} children
 * @property {number} line
 */
/** @typedef {FigureElement | string} FigureNode */

/**
 * @typedef {object} Figure
 * @property {string} name  File name without ".svg"; the same in every language.
 * @property {string} file  Repo-relative path.
 * @property {number} width  From the viewBox.
 * @property {number} height
 * @property {string} title  Accessible name.
 * @property {string} desc  Longer text alternative ('' if none).
 * @property {FigureNode[]} body  Drawing elements after <title> and <desc>.
 */

/**
 * Every class a figure may use. Shapes: box*, line*, fill-*; text: t*.
 * Styled in 05-components.css; a test checks that each one has a rule.
 */
export const FIGURE_CLASSES = /** @type {const} */ ([
  'box',
  'box-soft',
  'box-good',
  'box-bad',
  'box-warn',
  'box-info',
  'line',
  'line-good',
  'line-bad',
  'line-warn',
  'line-info',
  'line-dash',
  'line-thin',
  'fill-ink',
  'fill-muted',
  'fill-good',
  'fill-bad',
  'fill-warn',
  'fill-info',
  'fill-bg',
  'fill-good-soft',
  'fill-bad-soft',
  't',
  't-sm',
  't-lg',
  't-b',
  't-muted',
  't-good',
  't-bad',
  't-warn',
  't-info',
  't-on',
]);

const NUMBER = /^-?(?:\d+\.?\d*|\.\d+)$/;
const PATH_DATA = /^[MmLlHhVvCcSsQqTtAaZz0-9.,\s-]+$/;
const POINTS = /^[0-9.,\s-]+$/;
const TRANSFORM = /^(?:\s*(?:translate|rotate|scale)\(\s*-?[\d.]+(?:[\s,]+-?[\d.]+){0,2}\s*\)\s*)+$/;

/** @type {Record<string, RegExp>} */
const VALUE = {
  x: NUMBER,
  y: NUMBER,
  dx: NUMBER,
  dy: NUMBER,
  x1: NUMBER,
  y1: NUMBER,
  x2: NUMBER,
  y2: NUMBER,
  cx: NUMBER,
  cy: NUMBER,
  r: NUMBER,
  rx: NUMBER,
  ry: NUMBER,
  width: NUMBER,
  height: NUMBER,
  d: PATH_DATA,
  points: POINTS,
  transform: TRANSFORM,
  'text-anchor': /^(?:start|middle|end)$/,
  class: /^[a-z-]+(?: [a-z-]+)*$/,
};

/** Allowed attributes per drawing element. */
/** @type {Record<string, string[]>} */
const ELEMENTS = {
  g: ['class', 'transform'],
  rect: ['x', 'y', 'width', 'height', 'rx', 'ry', 'class', 'transform'],
  circle: ['cx', 'cy', 'r', 'class'],
  ellipse: ['cx', 'cy', 'rx', 'ry', 'class'],
  line: ['x1', 'y1', 'x2', 'y2', 'class'],
  polyline: ['points', 'class'],
  polygon: ['points', 'class', 'transform'],
  path: ['d', 'class', 'transform'],
  text: ['x', 'y', 'dx', 'dy', 'class', 'text-anchor', 'transform'],
  tspan: ['x', 'y', 'dx', 'dy', 'class', 'text-anchor'],
};

/** Elements that hold text; everything else holds only elements. */
const TEXT_ELEMENTS = new Set(['text', 'tspan', 'title', 'desc']);

/**
 * Characters in the site's FiraGO subset (scripts/subset-fonts.sh). Figure text
 * outside it would fall back to another font, so it fails the build instead.
 */
const FONT_RANGES = [
  [0x20, 0xff], [0x131, 0x131], [0x152, 0x153], [0x2c6, 0x2c6], [0x2da, 0x2da], [0x2dc, 0x2dc],
  [0x2000, 0x206f], [0x20ac, 0x20ac], [0x20be, 0x20be], [0x2122, 0x2122], [0x2190, 0x2193],
  [0x2212, 0x2212], [0x2713, 0x2713], [0x10a0, 0x10ff], [0x1c90, 0x1cbf],
];

/** @param {string} text */
function charsOutsideFont(text) {
  const missing = new Set();
  for (const ch of text) {
    const code = /** @type {number} */ (ch.codePointAt(0));
    if (!FONT_RANGES.some(([from, to]) => code >= from && code <= to)) missing.add(ch);
  }
  return [...missing];
}

/** @type {Record<string, string>} */
const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

/**
 * @param {string} text
 * @param {(message: string) => ContentError} error
 */
function decodeEntities(text, error) {
  return text.replace(/&([a-z]*);?/g, (whole, name) => {
    if (!whole.endsWith(';') || !(name in ENTITIES)) throw error(`Unsupported "&" near "${whole}". Write "&amp;" for an ampersand; other entities aren't supported.`);
    return ENTITIES[name];
  });
}

/**
 * Parses and validates one figure file.
 * @param {string} source
 * @param {string} file  Repo-relative path, for error messages.
 * @param {string} name
 * @returns {Figure}
 */
export function parseFigure(source, file, name) {
  let pos = 0;
  /** @param {string} message @param {number} [at] */
  const error = (message, at = pos) => new ContentError(file, source.slice(0, at).split('\n').length, message);

  /** @type {FigureElement} */
  const root = { name: '#root', attrs: [], children: [], line: 1 };
  /** @type {FigureElement[]} */
  const stack = [root];
  source = source.replace(/^\uFEFF/, '');

  while (pos < source.length) {
    const parent = stack[stack.length - 1];
    if (source.startsWith('<!--', pos)) {
      const end = source.indexOf('-->', pos + 4);
      if (end === -1) throw error('Unclosed comment.');
      pos = end + 3;
      continue;
    }
    if (source.startsWith('<?xml', pos)) {
      if (pos !== 0) throw error('The XML declaration must come first.');
      const end = source.indexOf('?>', pos);
      if (end === -1) throw error('Unclosed XML declaration.');
      pos = end + 2;
      continue;
    }
    if (source.startsWith('<!', pos) || source.startsWith('<?', pos)) throw error('DOCTYPE, CDATA and processing instructions are not allowed in figures.');
    if (source.startsWith('</', pos)) {
      const match = /^<\/([a-zA-Z]+)\s*>/.exec(source.slice(pos));
      if (!match) throw error('Malformed closing tag.');
      if (match[1] !== parent.name) throw error(`Closing </${match[1]}> doesn't match <${parent.name}>.`);
      stack.pop();
      pos += match[0].length;
      continue;
    }
    if (source[pos] === '<') {
      const match = /^<([a-zA-Z]+)((?:\s+[a-zA-Z][a-zA-Z0-9:-]*="[^"<]*")*)\s*(\/?)>/.exec(source.slice(pos));
      if (!match) throw error('Malformed tag. Attributes need double quotes: name="value".');
      const line = source.slice(0, pos).split('\n').length;
      const attrs = /** @type {[string, string][]} */ ([...match[2].matchAll(/([a-zA-Z][a-zA-Z0-9:-]*)="([^"]*)"/g)].map((m) => [m[1], decodeEntities(m[2], error)]));
      /** @type {FigureElement} */
      const element = { name: match[1], attrs, children: [], line };
      parent.children.push(element);
      pos += match[0].length;
      if (!match[3]) stack.push(element);
      continue;
    }
    const end = source.indexOf('<', pos);
    const chunk = source.slice(pos, end === -1 ? source.length : end);
    if (chunk.includes('>')) throw error('Stray ">" in text. Write "&gt;".');
    parent.children.push(decodeEntities(chunk, error));
    pos += chunk.length;
  }
  if (stack.length > 1) throw error(`<${stack[stack.length - 1].name}> is never closed.`);

  return validate(root, file, name);
}

/**
 * @param {FigureElement} root
 * @param {string} file
 * @param {string} name
 * @returns {Figure}
 */
function validate(root, file, name) {
  /** @param {number} line @param {string} message */
  const error = (line, message) => new ContentError(file, line, message);
  const elements = root.children.filter((child) => typeof child !== 'string' || child.trim() !== '');
  const svg = elements[0];
  if (elements.length !== 1 || typeof svg === 'string' || svg.name !== 'svg') throw error(1, 'A figure file must hold exactly one <svg> element.');

  for (const [attr] of svg.attrs) {
    if (attr !== 'viewBox' && attr !== 'xmlns') throw error(svg.line, `<svg> may only have viewBox and xmlns; "${attr}" is not allowed. Sizes and styles come from the site's CSS.`);
  }
  const viewBox = svg.attrs.find(([attr]) => attr === 'viewBox')?.[1] ?? '';
  const box = /^0 0 (\d+(?:\.\d+)?) (\d+(?:\.\d+)?)$/.exec(viewBox.trim());
  if (!box) throw error(svg.line, '<svg> needs viewBox="0 0 width height".');

  const children = svg.children.filter((child) => typeof child !== 'string' || child.trim() !== '');
  const [first, second] = children;
  if (typeof first === 'string' || first?.name !== 'title') throw error(svg.line, 'The first element inside <svg> must be <title>: the name a screen reader reads out.');
  const title = textOnly(first, error);
  if (title === '') throw error(first.line, '<title> is empty.');
  const hasDesc = typeof second !== 'string' && second?.name === 'desc';
  const desc = hasDesc ? textOnly(second, error) : '';
  const body = children.slice(hasDesc ? 2 : 1);
  for (const node of body) checkNode(node, svg.line, error);

  return { name, file, width: Number(box[1]), height: Number(box[2]), title, desc, body };
}

/**
 * @param {FigureElement} element
 * @param {(line: number, message: string) => ContentError} error
 */
function textOnly(element, error) {
  if (element.attrs.length) throw error(element.line, `<${element.name}> takes no attributes.`);
  if (element.children.some((child) => typeof child !== 'string')) throw error(element.line, `<${element.name}> may only hold text.`);
  const value = element.children.join('').replace(/\s+/g, ' ').trim();
  checkFont(value, element.line, error);
  return value;
}

/**
 * @param {string} text
 * @param {number} line
 * @param {(line: number, message: string) => ContentError} error
 */
function checkFont(text, line, error) {
  const missing = charsOutsideFont(text);
  if (missing.length) {
    throw error(line, `The site font has no ${missing.map((ch) => `"${ch}" (U+${(ch.codePointAt(0) ?? 0).toString(16).toUpperCase().padStart(4, '0')})`).join(', ')}. Use another character, or add it to scripts/subset-fonts.sh and to FONT_RANGES in figures.mjs.`);
  }
}

/**
 * @param {FigureNode} node
 * @param {number} parentLine
 * @param {(line: number, message: string) => ContentError} error
 * @param {string} [parentName]
 */
function checkNode(node, parentLine, error, parentName = 'svg') {
  if (typeof node === 'string') {
    if (node.trim() === '') return;
    if (!TEXT_ELEMENTS.has(parentName)) throw error(parentLine, `Text "${node.trim().slice(0, 40)}" must be inside <text>.`);
    checkFont(node, parentLine, error);
    return;
  }
  const allowed = ELEMENTS[node.name];
  if (!allowed) {
    throw error(node.line, `<${node.name}> is not allowed in figures. Use ${Object.keys(ELEMENTS).map((e) => `<${e}>`).join(', ')}.`);
  }
  if (node.name === 'tspan' && parentName !== 'text') throw error(node.line, '<tspan> must be inside <text>.');
  if (node.name === 'text' && parentName === 'text') throw error(node.line, '<text> can\'t be inside <text>; use <tspan>.');
  const seen = new Set();
  for (const [attr, value] of node.attrs) {
    if (!allowed.includes(attr)) {
      throw error(node.line, `Attribute "${attr}" is not allowed on <${node.name}>. Allowed: ${allowed.join(', ')}. Colours and sizes come from classes.`);
    }
    if (seen.has(attr)) throw error(node.line, `Duplicate attribute "${attr}".`);
    seen.add(attr);
    if (!VALUE[attr].test(value)) throw error(node.line, `Invalid ${attr}="${value}" on <${node.name}>.`);
    if (attr === 'class') {
      const unknown = value.split(' ').filter((token) => !FIGURE_CLASSES.some((known) => known === token));
      if (unknown.length) throw error(node.line, `Unknown figure class ${unknown.map((c) => `"${c}"`).join(', ')}. Use: ${FIGURE_CLASSES.join(', ')}.`);
    }
  }
  if (!TEXT_ELEMENTS.has(node.name) && node.children.some((child) => typeof child === 'string' && child.trim() !== '')) {
    throw error(node.line, `<${node.name}> can't hold text; put it in <text>.`);
  }
  if (node.name !== 'g' && !TEXT_ELEMENTS.has(node.name) && node.children.length) throw error(node.line, `<${node.name}> can't have child elements.`);
  for (const child of node.children) checkNode(child, node.line, error, node.name);
}

/**
 * @param {FigureNode} node
 * @param {boolean} inText  Inside <text>: keep single spaces between words and tspans.
 * @returns {string}
 */
function serialize(node, inText) {
  if (typeof node === 'string') {
    if (!inText) return '';
    return escapeHtml(node.replace(/\s+/g, ' '));
  }
  const attrs = node.attrs.map(([attr, value]) => ` ${attr}="${escapeHtml(value)}"`).join('');
  const text = inText || node.name === 'text';
  let inner = node.children.map((child) => serialize(child, text)).join('');
  if (node.name === 'text') inner = inner.replace(/^ | $/g, '');
  return `<${node.name}${attrs}>${inner}</${node.name}>`;
}

/**
 * The figure as an HTML string, built only from the validated tree.
 * @param {Figure} figure
 * @param {string} caption  Already-rendered caption HTML.
 * @returns {string}
 */
export function renderFigure(figure, caption) {
  const id = `figure-${figure.name}`;
  const described = figure.desc ? ` aria-describedby="${id}-desc"` : '';
  const desc = figure.desc ? `<desc id="${id}-desc">${escapeHtml(figure.desc)}</desc>` : '';
  const body = figure.body.map((node) => serialize(node, false)).join('');
  const svg =
    `<svg class="figure__art" viewBox="0 0 ${figure.width} ${figure.height}" width="${figure.width}" height="${figure.height}" role="img" aria-labelledby="${id}-title"${described}>` +
    `<title id="${id}-title">${escapeHtml(figure.title)}</title>${desc}${body}</svg>`;
  return `<figure class="figure" id="${id}">${svg}<figcaption class="figure__caption">${caption}</figcaption></figure>`;
}

/**
 * Loads every figure of one language.
 * @param {string} contentDir
 * @param {string} lang
 * @returns {Promise<Map<string, Figure>>}
 */
export async function loadFigures(contentDir, lang) {
  const dir = join(contentDir, lang, 'figures');
  /** @type {string[]} */
  let names;
  try {
    names = await readdir(dir);
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return new Map();
    throw error;
  }
  /** @type {Map<string, Figure>} */
  const figures = new Map();
  for (const entry of names.sort()) {
    const path = join(dir, entry);
    const file = relative(ROOT, path);
    if (!entry.endsWith('.svg')) throw new ContentError(file, 0, 'Only .svg files belong in a figures folder.');
    const name = entry.slice(0, -4);
    if (!/^[a-z0-9][a-z0-9-]*$/.test(name)) throw new ContentError(file, 0, `Figure file names must be lowercase letters, digits and dashes. Rename "${entry}".`);
    figures.set(name, parseFigure(await readFile(path, 'utf8'), file, name));
  }
  return figures;
}

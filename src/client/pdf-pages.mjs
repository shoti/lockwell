// @ts-check
/**
 * @file The page tree flattened into a list (ISO 32000-1 §7.7.3), with the inheritable attributes of Table 30
 * made explicit, and the visible box of a page as a viewer shows it. Where the standard leaves room, the rules
 * follow PDF.js, which draws the previews, so that our sizes match what the visitor sees (log §14): a missing
 * MediaBox is US Letter, a /Rotate that is not a multiple of 90 is 0, an empty crop box falls back to the
 * MediaBox, and Resources found at several levels are merged with the nearest winning.
 */
import { PdfDict, PdfError, PdfRef, isName } from './pdf-syntax.mjs';

/** @typedef {import('./pdf-syntax.mjs').PdfObject} PdfObject */
/** @typedef {import('./pdf-file.mjs').PdfFile} PdfFile */
/** @typedef {[number, number, number, number]} Rect  [left, bottom, right, top], normalised. */

/**
 * @typedef {object} PageInfo
 * @property {PdfRef | null} ref  The page object, or null for a page written directly inside a Kids array.
 * @property {PdfDict} dict
 * @property {Rect} mediaBox
 * @property {Rect} cropBox  Already clipped to the MediaBox.
 * @property {0 | 90 | 180 | 270} rotate
 * @property {number} userUnit
 * @property {PdfObject} resources  As found (a reference stays a reference, so shared resources stay shared), or a
 *   merged dictionary when several levels have one; null when none does.
 */

/** Page-tree depth accepted (plan §6.3). */
export const MAX_TREE_DEPTH = 64;
/** Pages read from one file; the board's own limit is lower. */
export const MAX_PAGES = 100_000;
/** US Letter in points, PDF.js's default for a page without a MediaBox. */
export const LETTER = /** @type {Rect} */ ([0, 0, 612, 792]);

const INHERITED = ['Resources', 'MediaBox', 'CropBox', 'Rotate'];

/**
 * Every page in order. A node listed again below itself is skipped, as qpdf and Poppler do, so the pages around
 * the loop still open. A page listed twice is listed twice, as viewers show it. No page at all: `damaged`.
 * @param {PdfFile} file
 * @returns {PageInfo[]}
 * @throws {PdfError}
 */
export function pageList(file) {
  const root = file.catalog().get('Pages');
  /** @type {PageInfo[]} */
  const pages = [];
  /** @type {Set<PdfDict>} */
  const path = new Set();
  let steps = 0;
  /**
   * @param {PdfObject | undefined} node
   * @param {Map<string, PdfObject[]>} inherited  Values of the inheritable keys from the ancestors, nearest first.
   * @param {number} depth
   */
  const walk = (node, inherited, depth) => {
    steps += 1;
    if (steps > file.entries.size + MAX_PAGES) throw new PdfError('tooLarge', 'page tree too large');
    const dict = file.resolve(node);
    if (!(dict instanceof PdfDict)) return;
    if (path.has(dict)) return;
    const kids = file.resolve(dict.get('Kids'));
    const isNode = isName(dict.get('Type'), 'Pages') || (!isName(dict.get('Type'), 'Page') && Array.isArray(kids));
    if (!isNode) {
      if (pages.length >= MAX_PAGES) throw new PdfError('tooLarge', `more than ${MAX_PAGES} pages`);
      pages.push(pageInfo(file, node instanceof PdfRef ? node : null, dict, inherited));
      return;
    }
    if (depth >= MAX_TREE_DEPTH) throw new PdfError('tooLarge', `page tree deeper than ${MAX_TREE_DEPTH}`);
    if (!Array.isArray(kids)) return;
    const below = new Map(inherited);
    for (const key of INHERITED) {
      if (dict.has(key)) below.set(key, [/** @type {PdfObject} */ (dict.get(key)), ...(inherited.get(key) ?? [])]);
    }
    path.add(dict);
    for (const kid of kids) walk(kid, below, depth + 1);
    path.delete(dict);
  };
  walk(root, new Map(), 0);
  if (pages.length === 0) throw new PdfError('damaged', 'no pages');
  return pages;
}

/**
 * @param {PdfFile} file
 * @param {PdfRef | null} ref
 * @param {PdfDict} dict
 * @param {Map<string, PdfObject[]>} inherited
 * @returns {PageInfo}
 */
function pageInfo(file, ref, dict, inherited) {
  /** The page's own value first, then its ancestors'. @param {string} key */
  const levels = (key) => [...(dict.has(key) ? [/** @type {PdfObject} */ (dict.get(key))] : []), ...(inherited.get(key) ?? [])];
  /** @param {string} key */
  const box = (key) => {
    for (const value of levels(key)) {
      const rect = rectOf(file, value);
      if (rect) return rect;
      if (value !== null) break; // an invalid box at the nearest level is not replaced by an ancestor's (PDF.js)
    }
    return null;
  };
  const mediaBox = box('MediaBox') ?? LETTER;
  const crop = box('CropBox');
  const cropBox = crop ? intersect(crop, mediaBox) ?? mediaBox : mediaBox;
  const turn = file.resolve(levels('Rotate')[0]);
  const userUnit = file.resolve(dict.get('UserUnit'));
  return {
    ref,
    dict,
    mediaBox,
    cropBox,
    rotate: normaliseRotation(typeof turn === 'number' ? turn : 0),
    userUnit: typeof userUnit === 'number' && userUnit > 0 ? userUnit : 1,
    resources: mergedResources(file, levels('Resources')),
  };
}

/**
 * A rotation as PDF.js reads it: a multiple of 90 brought into 0–270, anything else 0.
 * @param {number} degrees
 * @returns {0 | 90 | 180 | 270}
 */
export function normaliseRotation(degrees) {
  if (!Number.isInteger(degrees) || degrees % 90 !== 0) return 0;
  return /** @type {0 | 90 | 180 | 270} */ (((degrees % 360) + 360) % 360);
}

/**
 * A rectangle from an array of four numbers (references followed), normalised; null when it is not one or has no
 * area.
 * @param {PdfFile} file
 * @param {PdfObject} value
 * @returns {Rect | null}
 */
export function rectOf(file, value) {
  const array = file.resolve(value);
  if (!Array.isArray(array) || array.length !== 4) return null;
  const n = array.map((item) => file.resolve(item));
  if (!n.every((x) => typeof x === 'number' && Number.isFinite(x))) return null;
  const [a, b, c, d] = /** @type {number[]} */ (n);
  const rect = /** @type {Rect} */ ([Math.min(a, c), Math.min(b, d), Math.max(a, c), Math.max(b, d)]);
  return rect[2] > rect[0] && rect[3] > rect[1] ? rect : null;
}

/** @param {Rect} a @param {Rect} b @returns {Rect | null} */
export function intersect(a, b) {
  const rect = /** @type {Rect} */ ([Math.max(a[0], b[0]), Math.max(a[1], b[1]), Math.min(a[2], b[2]), Math.min(a[3], b[3])]);
  return rect[2] > rect[0] && rect[3] > rect[1] ? rect : null;
}

/**
 * The Resources a page uses: the one found, as it is; several (page and ancestors) merged into a new dictionary,
 * nearest first, as PDF.js reads them.
 * @param {PdfFile} file
 * @param {PdfObject[]} levels
 * @returns {PdfObject}
 */
function mergedResources(file, levels) {
  const found = levels.filter((value) => file.resolve(value) instanceof PdfDict);
  if (found.length === 0) return null;
  if (found.length === 1) return found[0];
  const merged = new PdfDict();
  for (const value of found) {
    for (const [key, item] of /** @type {PdfDict} */ (file.resolve(value)).entries()) if (!merged.has(key)) merged.set(key, item);
  }
  return merged;
}

/**
 * The visible part of a page (its crop box) and its size as shown: rotated, in points of 1/72 inch times UserUnit.
 * @param {PageInfo} page
 * @returns {{ box: Rect, width: number, height: number }}
 */
export function pageBox(page) {
  const [left, bottom, right, top] = page.cropBox;
  const width = (right - left) * page.userUnit;
  const height = (top - bottom) * page.userUnit;
  const sideways = page.rotate === 90 || page.rotate === 270;
  return { box: page.cropBox, width: sideways ? height : width, height: sideways ? width : height };
}

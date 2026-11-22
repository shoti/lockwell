// @ts-check
/**
 * @file Copying pages out of a source PDF into the output (plan §6.5): everything a kept page reaches, renumbered,
 * streams byte for byte; never the source's page tree, catalog, metadata, scripts or attachments. One table of rules
 * (`CARRY`) drives this module, the save report and the tests.
 */
import { pause, BATCH } from './pdf-write.mjs';
import { PdfDict, PdfError, PdfName, PdfRef, PdfStream, PdfString, isName, textOf } from './pdf-syntax.mjs';

/** @typedef {import('./pdf-syntax.mjs').PdfObject} PdfObject */
/** @typedef {import('./pdf-file.mjs').PdfFile} PdfFile */
/** @typedef {import('./pdf-pages.mjs').PageInfo} PageInfo */
/** @typedef {import('./pdf-write.mjs').PdfWriter} PdfWriter */

/**
 * What the result line says (plan §6.5). `dropped`: listed under "Not carried over". `kept`: things people may not
 * expect to travel. `warnings`: said before saving and in the result.
 * @typedef {'bookmarks' | 'pageLabels' | 'articles' | 'structure' | 'scripts' | 'attachments' | 'encryption'} Dropped
 * @typedef {'comments' | 'fields' | 'layers'} Kept
 * @typedef {'signatures' | 'annotationsOnce'} Warning
 * @typedef {{ dropped: Set<Dropped>, kept: Set<Kept>, warnings: Set<Warning>, linksRemoved: number }} Report
 */

/** @returns {Report} */
export const newReport = () => ({ dropped: new Set(), kept: new Set(), warnings: new Set(), linksRemoved: 0 });

/** Keys never copied, wherever they appear: metadata, page-piece data, structure links, automatic actions. */
export const DROPPED_KEYS = new Set(['Metadata', 'PieceInfo', 'LastModified', 'StructParent', 'StructParents', 'AA']);

/** Page keys written on the new page; everything else on a source page (thumbnails, beads, measurement and
 * presentation data, associated files…) is left behind. */
export const PAGE_KEYS = ['BleedBox', 'TrimBox', 'ArtBox', 'Contents', 'Group', 'Tabs'];

/** Actions kept (ISO 32000-1 §12.6.4). Scripts, launching programs, other files, submitting forms, media: never. */
export const ACTIONS = new Set(['URI', 'GoTo', 'Named', 'SetOCGState', 'Hide', 'ResetForm']);

/** Annotations that carry a file or media: never carried (attachments). */
export const MEDIA = new Set(['FileAttachment', 'Sound', 'Movie', 'Screen', 'RichMedia', '3D']);

/** Arrays in which a reference to something not copied is removed rather than left as null. */
const LISTS = new Set(['Kids', 'Annots', 'Fields', 'CO', 'OCGs', 'ON', 'OFF', 'Locked']);

/** Most field-tree and name-tree nodes walked in one source. */
const MAX_NODES = 200_000;

/** Copies objects of one source into the writer; each source object is written at most once. */
export class SourceCopier {
  /**
   * @param {PdfFile} file
   * @param {PdfWriter} writer
   * @param {Map<number, PdfRef>} pages  Source page object number → the output page that is its first copy.
   */
  constructor(file, writer, pages) {
    this.file = file;
    this.writer = writer;
    this.pages = pages;
    /** @type {Map<number, PdfRef | null>} */
    this.map = new Map();
    /** @type {number[]} */
    this.queue = [];
    /** Objects that must not be copied: references to them become null. @type {Set<number>} */
    this.blocked = new Set();
    /** Keys left out of particular objects (a signature field's value). @type {Map<number, Set<string>>} */
    this.without = new Map();
    /** Named destinations, read once. @type {Map<string, PdfObject> | null} */
    this.names = null;
    this.report = newReport();
  }

  /**
   * The output reference for a source object, queued for copying the first time. A page becomes its first copy
   * in the output, or null when it is not kept; page-tree nodes and the catalog are never copied.
   * @param {number} num
   * @returns {PdfRef | null}
   */
  refFor(num) {
    const known = this.map.get(num);
    if (known !== undefined) return known;
    let out = null;
    const value = this.file.get(num);
    const type = value instanceof PdfDict ? value.get('Type') : null;
    if (isName(type, 'Page')) out = this.pages.get(num) ?? null;
    else if (isName(type, 'Pages') || isName(type, 'Catalog') || this.blocked.has(num) || value === null) out = null;
    else {
      out = this.writer.reserve();
      this.queue.push(num);
    }
    this.map.set(num, out);
    return out;
  }

  /**
   * A value rewritten for the output: references renumbered (and queued), dropped keys left out, actions and
   * destinations checked.
   * @param {PdfObject | undefined} value
   * @param {string} [key]  The key it is stored under.
   * @param {Set<string>} [skip]  More keys to leave out of this dictionary.
   * @returns {PdfObject}
   */
  copy(value, key = '', skip) {
    if (value === undefined) return null;
    if (value instanceof PdfRef) return this.refFor(value.num);
    if (Array.isArray(value)) {
      const items = value.map((item) => this.copy(item));
      return LISTS.has(key) ? items.filter((item, i) => item !== null || value[i] === null) : items;
    }
    if (value instanceof PdfDict) {
      const out = new PdfDict();
      for (const [name, item] of value.entries()) {
        if (DROPPED_KEYS.has(name) || skip?.has(name)) continue;
        if (name === 'A' || name === 'PA') {
          const action = this.action(item);
          if (action !== null) out.set(name, action);
          continue;
        }
        if (name === 'Next') continue; // chained actions are not followed
        if (name === 'Dest') {
          const dest = this.destination(item);
          if (dest !== null) out.set(name, dest);
          continue;
        }
        out.set(name, this.copy(item, name));
      }
      return out;
    }
    return value;
  }

  /**
   * An action kept as a direct dictionary, or null: only the kinds in `ACTIONS`, and a GoTo only when its target
   * page is in the output.
   * @param {PdfObject | undefined} value
   * @returns {PdfObject}
   */
  action(value) {
    const dict = this.file.resolve(value);
    if (!(dict instanceof PdfDict)) return null;
    const kind = dict.get('S');
    if (!(kind instanceof PdfName) || !ACTIONS.has(kind.value)) {
      this.report.dropped.add('scripts');
      return null;
    }
    if (kind.value === 'GoTo') {
      const dest = this.destination(dict.get('D'));
      if (dest === null) return null;
      return new PdfDict([['S', kind], ['D', dest]]);
    }
    return this.copy(new PdfDict([...dict.entries()].filter(([name]) => name !== 'Next')));
  }

  /**
   * A destination made explicit ([page /XYZ …]) with the output page, or null when the page is not in the output.
   * Named destinations are looked up in the catalog's /Dests and /Names /Dests (§12.3.2.3).
   * @param {PdfObject | undefined} value
   * @returns {PdfObject}
   */
  destination(value) {
    let dest = this.file.resolve(value);
    if (dest instanceof PdfName || dest instanceof PdfString) dest = this.file.resolve(this.named(dest instanceof PdfName ? dest.value : textOf(dest)));
    if (dest instanceof PdfDict) dest = this.file.resolve(dest.get('D'));
    if (!Array.isArray(dest) || !(dest[0] instanceof PdfRef)) return null;
    const page = this.pages.get(dest[0].num);
    if (!page) return null;
    return [page, ...dest.slice(1).map((item) => this.copy(item))];
  }

  /** @param {string} name */
  named(name) {
    if (!this.names) {
      this.names = new Map();
      const catalog = this.file.catalog();
      const old = this.file.resolve(catalog.get('Dests'));
      if (old instanceof PdfDict) for (const [key, item] of old.entries()) this.names.set(key, item);
      const tree = this.file.resolve(this.file.resolve(catalog.get('Names')) instanceof PdfDict ? /** @type {PdfDict} */ (this.file.resolve(catalog.get('Names'))).get('Dests') : null);
      nameTree(this.file, tree, (key, item) => {
        if (!this.names?.has(key)) this.names?.set(key, item);
      });
    }
    return this.names.get(name) ?? null;
  }

  /**
   * Copies everything queued: streams with their data as stored (no filter undone), other objects rewritten.
   * @param {() => boolean} [isCancelled]
   */
  async drain(isCancelled = () => false) {
    let done = 0;
    while (this.queue.length > 0) {
      const num = /** @type {number} */ (this.queue.shift());
      const ref = /** @type {PdfRef} */ (this.map.get(num));
      const value = this.file.get(num);
      const skip = this.without.get(num);
      if (value instanceof PdfStream) {
        const dict = /** @type {PdfDict} */ (this.copy(value.dict, '', STREAM_SKIP));
        await this.writer.setStream(ref, new PdfStream(dict, value.data));
      } else {
        this.writer.set(ref, this.copy(value, '', skip));
      }
      done += 1;
      if (done % BATCH === 0) {
        await pause();
        if (isCancelled()) throw new PdfError('cancelled');
      }
    }
  }
}

/** /Length is written by the writer; the source's may be a reference to an object that is not needed. */
const STREAM_SKIP = new Set(['Length']);

/**
 * Calls back for every key and value of a name tree (§7.9.6), with a visited set and a node limit.
 * @param {PdfFile} file
 * @param {PdfObject} root
 * @param {(key: string, value: PdfObject) => void} each
 */
export function nameTree(file, root, each) {
  const seen = new Set();
  const stack = [root];
  while (stack.length > 0 && seen.size < MAX_NODES) {
    const node = file.resolve(stack.pop());
    if (!(node instanceof PdfDict) || seen.has(node)) continue;
    seen.add(node);
    const names = file.resolve(node.get('Names'));
    if (Array.isArray(names)) {
      for (let i = 0; i + 1 < names.length; i += 2) {
        const key = file.resolve(names[i]);
        if (key instanceof PdfString) each(textOf(key), names[i + 1]);
      }
    }
    const kids = file.resolve(node.get('Kids'));
    if (Array.isArray(kids)) stack.push(...kids.slice().reverse());
  }
}

/**
 * The page dictionary written for one copy of a source page: the inherited attributes made explicit (Resources,
 * MediaBox, CropBox, Rotate with the visitor's turn added, UserUnit), the keys of `PAGE_KEYS`, and, on the first
 * copy only, the annotations that may travel.
 * @param {SourceCopier} copier
 * @param {PageInfo} page
 * @param {0 | 90 | 180 | 270} turn
 * @param {boolean} first  The first copy of this source page in the output.
 */
export function pageDictionary(copier, page, turn, first) {
  const dict = new PdfDict([['Type', new PdfName('Page')], ['MediaBox', page.mediaBox.slice()]]);
  const sameBox = page.cropBox.every((n, i) => n === page.mediaBox[i]);
  if (!sameBox) dict.set('CropBox', page.cropBox.slice());
  const rotate = (page.rotate + turn) % 360;
  if (rotate !== 0) dict.set('Rotate', rotate);
  if (page.userUnit !== 1) dict.set('UserUnit', page.userUnit);
  dict.set('Resources', page.resources === null ? new PdfDict() : copier.copy(page.resources, 'Resources'));
  for (const key of PAGE_KEYS) if (page.dict.has(key)) dict.set(key, copier.copy(page.dict.get(key), key));
  const annots = copier.file.resolve(page.dict.get('Annots'));
  if (Array.isArray(annots) && annots.length > 0) {
    if (!first) {
      copier.report.warnings.add('annotationsOnce');
    } else {
      const kept = annotations(copier, annots);
      if (kept.length > 0) dict.set('Annots', kept);
    }
  }
  return dict;
}

/**
 * The annotations of a page that travel (plan §6.5): comments with their popups, links whose target is kept,
 * form widgets; never files or media. What is left behind is blocked, so no other path copies it.
 * @param {SourceCopier} copier
 * @param {PdfObject[]} annots
 */
function annotations(copier, annots) {
  const { file, report } = copier;
  /** @type {Set<number>} */
  const keptNums = new Set();
  /** @type {[PdfObject, PdfDict][]} */
  const popups = [];
  /** @type {PdfObject[]} */
  const out = [];
  /** @param {PdfObject} item */
  const block = (item) => {
    if (item instanceof PdfRef) copier.blocked.add(item.num);
  };
  for (const item of annots) {
    const dict = file.resolve(item);
    if (!(dict instanceof PdfDict)) continue;
    const subtype = dict.get('Subtype');
    const kind = subtype instanceof PdfName ? subtype.value : '';
    if (MEDIA.has(kind)) {
      report.dropped.add('attachments');
      block(item);
      continue;
    }
    if (kind === 'Popup') {
      popups.push([item, dict]);
      continue;
    }
    if (kind === 'Link') {
      const action = file.resolve(dict.get('A'));
      const goes = dict.has('Dest') || (action instanceof PdfDict && isName(action.get('S'), 'GoTo'));
      if (goes && copier.destination(dict.get('Dest') ?? /** @type {PdfDict} */ (action).get('D')) === null) {
        report.linksRemoved += 1;
        block(item);
        continue;
      }
      if (action instanceof PdfDict && !goes && copier.action(action) === null) {
        block(item);
        continue;
      }
    } else if (kind !== 'Widget') {
      report.kept.add('comments');
    }
    if (item instanceof PdfRef) keptNums.add(item.num);
    out.push(item);
  }
  for (const [item, dict] of popups) {
    const parent = dict.get('Parent');
    if (parent instanceof PdfRef && keptNums.has(parent.num)) out.push(item);
    else block(item);
  }
  return out.map((item) => copier.copy(item, 'Annots')).filter((item) => item !== null);
}

/* ---------- Forms (plan §6.5; research log §15) ---------- */

/**
 * The fields of a source that travel: those with a widget on a kept page, and their ancestors. Every other node of
 * the field tree is blocked. Signature fields keep their appearance but lose their value (the signature).
 * @param {SourceCopier} copier
 * @param {Set<number>} widgets  Widget annotations on the first copies of kept pages.
 * @returns {{ roots: PdfRef[], form: PdfDict } | null}
 */
export function planFields(copier, widgets) {
  const { file } = copier;
  const form = file.resolve(file.catalog().get('AcroForm'));
  if (!(form instanceof PdfDict)) return null;
  const fields = file.resolve(form.get('Fields'));
  if (!Array.isArray(fields)) return null;
  /** @type {Map<number, number | null>} */
  const parents = new Map();
  /** @type {[PdfObject, number | null][]} */
  const stack = fields.map((field) => [field, null]);
  while (stack.length > 0 && parents.size < MAX_NODES) {
    const [item, parent] = /** @type {[PdfObject, number | null]} */ (stack.pop());
    if (!(item instanceof PdfRef) || parents.has(item.num)) continue;
    parents.set(item.num, parent);
    const node = file.resolve(item);
    const kids = node instanceof PdfDict ? file.resolve(node.get('Kids')) : null;
    if (Array.isArray(kids)) for (const kid of kids) stack.push([kid, item.num]);
  }
  /** @type {Set<number>} */
  const allowed = new Set();
  for (const widget of widgets) {
    for (let num = /** @type {number | null | undefined} */ (widget), steps = 0; num !== null && num !== undefined && !allowed.has(num) && steps < 64; steps += 1) {
      allowed.add(num);
      num = parents.has(num) ? parents.get(num) : parentOf(file, num);
    }
  }
  for (const num of parents.keys()) if (!allowed.has(num)) copier.blocked.add(num);
  /** @type {PdfRef[]} */
  const roots = [];
  for (const field of fields) if (field instanceof PdfRef && allowed.has(field.num)) roots.push(field);
  for (const num of allowed) {
    if (fieldType(file, num) === 'Sig') {
      copier.without.set(num, new Set(['V', 'Lock', 'SV']));
      copier.report.warnings.add('signatures');
    }
  }
  if (roots.length > 0) copier.report.kept.add('fields');
  return { roots, form };
}

/** @param {PdfFile} file @param {number} num */
function parentOf(file, num) {
  const dict = file.get(num);
  const parent = dict instanceof PdfDict ? dict.get('Parent') : null;
  return parent instanceof PdfRef ? parent.num : null;
}

/** A field's type, inherited from its ancestors (§12.7.3.1). @param {PdfFile} file @param {number} num */
function fieldType(file, num) {
  for (let current = /** @type {number | null} */ (num), steps = 0; current !== null && steps < 64; steps += 1) {
    const dict = file.get(current);
    if (!(dict instanceof PdfDict)) return '';
    const type = dict.get('FT');
    if (type instanceof PdfName) return type.value;
    current = parentOf(file, current);
  }
  return '';
}

/* ---------- Layers (optional content, §8.11) ---------- */

/**
 * The layers of a source: every group, and which are off by default. Dropping them would show hidden layers, so
 * they always travel (plan §6.5).
 * @param {PdfFile} file
 * @returns {{ ocgs: PdfObject[], off: PdfObject[], order: PdfObject[], locked: PdfObject[], rbGroups: PdfObject[], usage: PdfObject[] } | null}
 */
export function layersOf(file) {
  const properties = file.resolve(file.catalog().get('OCProperties'));
  if (!(properties instanceof PdfDict)) return null;
  const ocgs = file.resolve(properties.get('OCGs'));
  if (!Array.isArray(ocgs) || ocgs.length === 0) return null;
  const config = file.resolve(properties.get('D'));
  const d = config instanceof PdfDict ? config : new PdfDict();
  /** @param {string} key @returns {PdfObject[]} */
  const list = (key) => {
    const value = file.resolve(d.get(key));
    return Array.isArray(value) ? value : [];
  };
  const on = new Set(list('ON').map((item) => (item instanceof PdfRef ? item.num : -1)));
  const off = isName(d.get('BaseState'), 'OFF')
    ? ocgs.filter((item) => item instanceof PdfRef && !on.has(item.num))
    : list('OFF');
  return { ocgs, off, order: list('Order'), locked: list('Locked'), rbGroups: list('RBGroups'), usage: list('AS') };
}

/* ---------- What a source has that does not travel ---------- */

/**
 * The document-level things of a source that are not carried, for the report.
 * @param {PdfFile} file
 * @param {Report} report
 */
export function documentLosses(file, report) {
  const catalog = file.catalog();
  const has = (/** @type {string} */ key) => {
    const value = file.resolve(catalog.get(key));
    return value !== null && !(Array.isArray(value) && value.length === 0);
  };
  const outlines = file.resolve(catalog.get('Outlines'));
  if (outlines instanceof PdfDict && outlines.has('First')) report.dropped.add('bookmarks');
  if (has('PageLabels')) report.dropped.add('pageLabels');
  if (has('Threads')) report.dropped.add('articles');
  if (has('StructTreeRoot')) report.dropped.add('structure');
  if (has('OpenAction') || has('AA')) report.dropped.add('scripts');
  if (has('Collection')) report.dropped.add('attachments');
  const names = file.resolve(catalog.get('Names'));
  if (names instanceof PdfDict) {
    if (names.has('JavaScript')) report.dropped.add('scripts');
    if (names.has('EmbeddedFiles')) report.dropped.add('attachments');
  }
  const form = file.resolve(catalog.get('AcroForm'));
  if (form instanceof PdfDict && form.has('XFA')) report.dropped.add('scripts');
  if (file.encrypted) report.dropped.add('encryption');
}

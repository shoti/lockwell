// @ts-check
/**
 * @file Building a PDF from a plan (plan §5.5, §6.4–6.6, §6.9): the one path every result takes. Pages are copied
 * from their sources by pdf-copy.mjs, written by pdf-write.mjs, and the result is opened again and checked before
 * it is offered. Also the pure helpers that turn a save choice into groups of pages.
 */
import { PdfError, openPdf } from './pdf-file.mjs';
import { SourceCopier, documentLosses, layersOf, newReport, pageDictionary, planFields } from './pdf-copy.mjs';
import { compressImages } from './pdf-compress.mjs';
import { applyOverlays, shownSize } from './pdf-overlay.mjs';
import { normaliseRotation, pageBox, pageList } from './pdf-pages.mjs';
import { IMAGE_PAGE, imageLayout, imageStream, jpegHasExtras } from './pdf-image.mjs';
import { PdfWriter, pause } from './pdf-write.mjs';
import { PdfDict, PdfName, PdfRef, PdfStream, PdfString, formatNumber, isName, textOf } from './pdf-syntax.mjs';
import { stillThere } from './tool-photo.mjs';

/** @typedef {import('./pdf-syntax.mjs').PdfObject} PdfObject */
/** @typedef {import('./pdf-file.mjs').PdfFile} PdfFile */
/** @typedef {import('./pdf-pages.mjs').PageInfo} PageInfo */
/** @typedef {import('./pdf-copy.mjs').Report} Report */
/** @typedef {import('./pdf-image.mjs').Picture} Picture */
/** @typedef {import('./pdf-image.mjs').ImagePageOptions} ImagePageOptions */
/** @typedef {import('./tool-photo.mjs').Findings} Findings */
/** @typedef {import('./pdf-overlay.mjs').Overlay} Overlay */

/**
 * @typedef {{ source: number, index: number } | { blank: { width: number, height: number } }} PageOrigin
 * @typedef {{ key: number, origin: PageOrigin, turn: 0 | 90 | 180 | 270, overlays?: Overlay[] }} PlanPage
 * @typedef {{ file: PdfFile, pages: PageInfo[] }} PdfSource
 * @typedef {{ picture: Picture, findings: Findings | null }} ImageSource  A picture added by the visitor; `findings`
 *   is what the photo tool found in the original, searched for in the result.
 * @typedef {{ pages: number, size: number, dropped: string[], kept: string[], warnings: string[], linksRemoved: number,
 *   pictures: import('./pdf-compress.mjs').PictureCount | null }} Result  `pictures`: when pictures were made smaller.
 * @typedef {{ level: import('./pdf-compress.mjs').Level, recode: import('./pdf-compress.mjs').Recoder }} Compress
 */

/** Information-dictionary entries read as the sources' known secrets (plan §6.9). */
const INFO_KEYS = ['Title', 'Author', 'Subject', 'Keywords', 'Creator', 'Producer'];
/** Shorter strings than this are too common to search for. */
const MIN_SECRET = 4;

/**
 * Builds one PDF.
 * @param {{ pages: PlanPage[], sources: Map<number, PdfSource | ImageSource>, imagePage?: ImagePageOptions,
 *   compress?: Compress | null, id?: Uint8Array, isCancelled?: () => boolean, onProgress?: (done: number, total: number) => void }} job
 * @returns {Promise<{ bytes: Uint8Array, report: Result }>}
 * @throws {PdfError}  `locked` for an encrypted source (until milestone 7), `cancelled`, `buildFailed`.
 */
export async function build({ pages, sources, imagePage = IMAGE_PAGE, compress = null, id, isCancelled = () => false, onProgress }) {
  if (pages.length === 0) throw new PdfError('buildFailed', 'no pages');
  const writer = new PdfWriter();
  const pageRefs = pages.map(() => writer.reserve());
  const tree = writer.reserve();

  // The first copy of each source page is the one that links, bookmarks-to-be and fields point to.
  /** @type {Map<number, Map<number, PdfRef>>} */
  const firsts = new Map();
  /** @type {Set<PlanPage>} */
  const firstCopies = new Set();
  pages.forEach((page, i) => {
    if (!('source' in page.origin) || isImage(sources, page.origin.source)) return;
    const { source, index } = page.origin;
    const ref = sourceOf(sources, source).pages[index]?.ref;
    if (!ref) {
      firstCopies.add(page);
      return;
    }
    const map = firsts.get(source) ?? new Map();
    firsts.set(source, map);
    if (!map.has(ref.num)) {
      map.set(ref.num, pageRefs[i]);
      firstCopies.add(page);
    }
  });

  /** @type {Map<number, SourceCopier>} */
  const copiers = new Map();
  /** @type {Map<number, { roots: PdfRef[], form: PdfDict } | null>} */
  const forms = new Map();
  for (const [num, map] of firsts) {
    const { file } = sourceOf(sources, num);
    if (file.encrypted && !file.unlocked) throw new PdfError('locked', 'encrypted source');
    const copier = new SourceCopier(file, writer, map, sourceOf(sources, num).pages);
    copiers.set(num, copier);
    documentLosses(file, copier.report);
    forms.set(num, planFields(copier, widgetsOn(sources, num, pages, firstCopies)));
  }
  for (const page of pages) {
    if ('source' in page.origin && !isImage(sources, page.origin.source) && !copiers.has(page.origin.source)) {
      // A source whose pages are all written directly in Kids: nothing can refer to them.
      const { file } = sourceOf(sources, page.origin.source);
      if (file.encrypted && !file.unlocked) throw new PdfError('locked', 'encrypted source');
      const copier = new SourceCopier(file, writer, new Map(), sourceOf(sources, page.origin.source).pages);
      documentLosses(file, copier.report);
      copiers.set(page.origin.source, copier);
    }
  }

  /** Each picture's image object, written once however many pages show it. @type {Map<number, PdfRef>} */
  const images = new Map();
  let signed = false;
  for (let i = 0; i < pages.length; i += 1) {
    const page = pages[i];
    let dict;
    if ('blank' in page.origin) {
      const { width, height } = page.origin.blank;
      dict = new PdfDict([['Type', new PdfName('Page')], ['MediaBox', [0, 0, width, height]], ['Resources', new PdfDict()]]);
      if (page.turn !== 0) dict.set('Rotate', page.turn);
    } else if (isImage(sources, page.origin.source)) {
      const { picture } = /** @type {ImageSource} */ (sources.get(page.origin.source));
      let image = images.get(page.origin.source);
      if (!image) {
        image = writer.reserve();
        await writer.setStream(image, imageStream(picture));
        images.set(page.origin.source, image);
      }
      dict = await picturePage(writer, picture, image, imagePage);
      if (page.turn !== 0) dict.set('Rotate', page.turn);
    } else {
      const copier = /** @type {SourceCopier} */ (copiers.get(page.origin.source));
      const info = sourceOf(sources, page.origin.source).pages[page.origin.index];
      if (!info) throw new PdfError('buildFailed', `no page ${page.origin.index} in source ${page.origin.source}`);
      dict = pageDictionary(copier, info, page.turn, firstCopies.has(page));
      await copier.drain(isCancelled);
    }
    if (page.overlays?.length) {
      await applyOverlays(writer, dict, shownPageOf(page, sources, imagePage), page.overlays);
      if (page.overlays.some((overlay) => overlay.type === 'ink' || overlay.type === 'picture')) signed = true;
    }
    dict.set('Parent', tree);
    writer.set(pageRefs[i], dict);
    onProgress?.(i + 1, pages.length);
    await pause();
    if (isCancelled()) throw new PdfError('cancelled');
  }
  writer.set(tree, new PdfDict([['Type', new PdfName('Pages')], ['Kids', pageRefs], ['Count', pages.length]]));

  const catalog = new PdfDict([['Type', new PdfName('Catalog')], ['Pages', tree]]);
  const form = await formDictionary(writer, copiers, forms, isCancelled);
  if (form) catalog.set('AcroForm', form);
  const layers = await layerDictionary(copiers, isCancelled);
  if (layers) catalog.set('OCProperties', layers);
  await carryFirst(catalog, copiers, isCancelled);
  const root = writer.add(catalog);

  const pictures = compress
    ? await compressImages(writer, pages.map((page, i) => ({ ref: pageRefs[i], ...shownSize(shownPageOf(page, sources, imagePage)) })), compress.level, compress.recode, isCancelled)
    : null;
  if (isCancelled()) throw new PdfError('cancelled');
  const bytes = await writer.write({ root, id, isCancelled });
  const report = newReport();
  for (const copier of copiers.values()) {
    for (const key of copier.report.dropped) report.dropped.add(key);
    for (const key of copier.report.kept) report.kept.add(key);
    for (const key of copier.report.warnings) report.warnings.add(key);
    report.linksRemoved += copier.report.linksRemoved;
  }
  if (layers) report.kept.add('layers');
  if (images.size > 0) report.kept.add('pictures');
  if (signed) report.warnings.add('signaturePicture');
  const findings = [...images.keys()].flatMap((num) => /** @type {ImageSource} */ (sources.get(num)).findings ?? []);
  await checkResult(bytes, { pages: pages.length, secrets: secretsOf([...copiers.values()].map((copier) => copier.file)), findings });
  return {
    bytes,
    report: { pages: pages.length, size: bytes.length, dropped: [...report.dropped].sort(), kept: [...report.kept].sort(), warnings: [...report.warnings].sort(), linksRemoved: report.linksRemoved, pictures },
  };
}

/** @param {Map<number, PdfSource | ImageSource>} sources @param {number} num @returns {PdfSource} */
function sourceOf(sources, num) {
  const source = sources.get(num);
  if (!source || 'picture' in source) throw new PdfError('buildFailed', `no PDF source ${num}`);
  return source;
}

/**
 * The page as the visitor saw it when placing overlays: its visible box in user space and its total rotation.
 * @param {PlanPage} page @param {Map<number, PdfSource | ImageSource>} sources @param {ImagePageOptions} imagePage
 * @returns {import('./pdf-overlay.mjs').ShownPage}
 */
function shownPageOf(page, sources, imagePage) {
  if ('blank' in page.origin) return { box: [0, 0, page.origin.blank.width, page.origin.blank.height], rotate: page.turn };
  const source = sources.get(page.origin.source);
  if (source && 'picture' in source) {
    const { width, height } = imageLayout(source.picture, imagePage);
    return { box: [0, 0, width, height], rotate: page.turn };
  }
  const info = sourceOf(sources, page.origin.source).pages[page.origin.index];
  return { box: pageBox(info).box, rotate: normaliseRotation(info.rotate + page.turn) };
}

/** @param {Map<number, PdfSource | ImageSource>} sources @param {number} num */
const isImage = (sources, num) => {
  const source = sources.get(num);
  if (!source) throw new PdfError('buildFailed', `no source ${num}`);
  return 'picture' in source;
};

/**
 * A page that shows one picture: its box, the picture drawn by one matrix (camera orientation included), nothing else.
 * @param {PdfWriter} writer @param {Picture} picture @param {PdfRef} image @param {ImagePageOptions} options
 */
async function picturePage(writer, picture, image, options) {
  const { width, height, matrix } = imageLayout(picture, options);
  const content = writer.reserve();
  const text = `q ${matrix.map(formatNumber).join(' ')} cm /Im1 Do Q\n`;
  await writer.setStream(content, new PdfStream(new PdfDict(), Uint8Array.from(text, (char) => char.charCodeAt(0))));
  return new PdfDict([
    ['Type', new PdfName('Page')],
    ['MediaBox', [0, 0, Number(formatNumber(width)), Number(formatNumber(height))]],
    ['Resources', new PdfDict([['XObject', new PdfDict([['Im1', image]])]])],
    ['Contents', content],
  ]);
}

/**
 * Widget annotations on the first copies of a source's kept pages.
 * @param {Map<number, PdfSource | ImageSource>} sources @param {number} num @param {PlanPage[]} pages @param {Set<PlanPage>} firstCopies
 */
function widgetsOn(sources, num, pages, firstCopies) {
  const { file, pages: info } = sourceOf(sources, num);
  /** @type {Set<number>} */
  const widgets = new Set();
  for (const page of pages) {
    if (!('source' in page.origin) || page.origin.source !== num || !firstCopies.has(page)) continue;
    const annots = file.resolve(info[page.origin.index]?.dict.get('Annots'));
    if (!Array.isArray(annots)) continue;
    for (const item of annots) {
      const dict = file.resolve(item);
      if (item instanceof PdfRef && dict instanceof PdfDict && dict.get('Subtype') instanceof PdfName && /** @type {PdfName} */ (dict.get('Subtype')).value === 'Widget') widgets.add(item.num);
    }
  }
  return widgets;
}

/**
 * The output's interactive form: every source's kept fields under their own names, a top-level name already used
 * by an earlier source getting "+1", "+2"… as qpdf does (research log §15). /NeedAppearances if any source asks for
 * it; each source's /DA and /Q written on its top-level fields, and the first source's also on the form; /DR merged,
 * the earlier source winning a name. No /SigFlags: signatures are not carried.
 * @param {PdfWriter} writer
 * @param {Map<number, SourceCopier>} copiers
 * @param {Map<number, { roots: PdfRef[], form: PdfDict } | null>} forms
 * @param {() => boolean} isCancelled
 */
async function formDictionary(writer, copiers, forms, isCancelled) {
  /** @type {PdfObject[]} */
  const fields = [];
  const used = new Set();
  const out = new PdfDict();
  const resources = new PdfDict();
  for (const [num, plan] of forms) {
    if (!plan || plan.roots.length === 0) continue;
    const copier = /** @type {SourceCopier} */ (copiers.get(num));
    const { form } = plan;
    for (const root of plan.roots) {
      const ref = copier.refFor(root.num);
      if (ref) fields.push(ref);
    }
    const appearances = copier.file.resolve(form.get('NeedAppearances'));
    if (appearances === true) out.set('NeedAppearances', true);
    for (const key of ['DA', 'Q']) if (!out.has(key) && form.has(key)) out.set(key, copier.copy(form.get(key), key));
    const dr = copier.file.resolve(form.get('DR'));
    if (dr instanceof PdfDict) {
      for (const [kind, value] of dr.entries()) {
        const group = copier.file.resolve(value);
        if (!(group instanceof PdfDict)) continue;
        const target = /** @type {PdfDict} */ (resources.get(kind) ?? new PdfDict());
        for (const [name, item] of group.entries()) if (!target.has(name)) target.set(name, copier.copy(item));
        resources.set(kind, target);
      }
    }
    await copier.drain(isCancelled);
    // Each source's form-wide defaults go onto its own top-level fields (fields inherit /DA and /Q: ISO 32000-1 Table 222), so
    // fields keep their look next to another source's defaults. Then rename top-level fields whose name an
    // earlier source already used.
    const names = new Set();
    for (const root of plan.roots) {
      const ref = copier.map.get(root.num);
      const dict = ref ? writer.get(ref) : null;
      if (!(dict instanceof PdfDict)) continue;
      for (const key of ['DA', 'Q']) if (!dict.has(key) && form.has(key)) dict.set(key, copier.copy(form.get(key), key));
      const title = dict.get('T');
      if (!(title instanceof PdfString)) continue;
      const text = textOf(title);
      if (used.has(text)) {
        let k = 1;
        while (used.has(`${text}+${k}`) || names.has(`${text}+${k}`)) k += 1;
        dict.set('T', appended(title, `+${k}`));
        names.add(`${text}+${k}`);
      } else {
        names.add(text);
      }
    }
    for (const name of names) used.add(name);
  }
  if (fields.length === 0) return null;
  out.set('Fields', fields);
  if (resources.size > 0) out.set('DR', resources);
  return out;
}

/**
 * A text string with ASCII text added in the same encoding.
 * @param {PdfString} string @param {string} suffix
 */
function appended(string, suffix) {
  const { bytes } = string;
  const utf16 = bytes[0] === 0xfe && bytes[1] === 0xff;
  const extra = utf16 ? Array.from(suffix).flatMap((char) => [0, char.charCodeAt(0)]) : Array.from(suffix, (char) => char.charCodeAt(0));
  return new PdfString(Uint8Array.from([...bytes, ...extra]), string.hex);
}

/**
 * The output's layers: every source's groups, the hidden ones still hidden, their order and locks
 * (plan §6.5: dropping layers would show what a source hid).
 * @param {Map<number, SourceCopier>} copiers
 * @param {() => boolean} isCancelled
 */
async function layerDictionary(copiers, isCancelled) {
  /** @type {Record<string, PdfObject[]>} */
  const lists = { OCGs: [], OFF: [], Order: [], Locked: [], RBGroups: [], AS: [] };
  for (const copier of copiers.values()) {
    const layers = layersOf(copier.file);
    if (!layers) continue;
    /** @param {string} key @param {PdfObject[]} items */
    const add = (key, items) => {
      for (const item of /** @type {PdfObject[]} */ (copier.copy(items, key))) lists[key].push(item);
    };
    add('OCGs', layers.ocgs);
    add('OFF', layers.off);
    add('Order', layers.order.length > 0 ? layers.order : layers.ocgs);
    add('Locked', layers.locked);
    add('RBGroups', layers.rbGroups);
    add('AS', layers.usage);
    await copier.drain(isCancelled);
  }
  if (lists.OCGs.length === 0) return null;
  const config = new PdfDict();
  for (const key of ['OFF', 'Order', 'Locked', 'RBGroups', 'AS']) if (lists[key].length > 0) config.set(key, lists[key]);
  return new PdfDict([['OCGs', lists.OCGs], ['D', config]]);
}

/* ---------- The check before a result is offered (plan §6.9) ---------- */

/** Keys whose presence means something was carried that never may be. */
const FORBIDDEN = new Set(['Metadata', 'JavaScript', 'JS', 'OpenAction', 'AA', 'EmbeddedFiles', 'PieceInfo', 'AF', 'EF', 'RF', 'ByteRange']);
/** Object types never in a result: a carried file, a signature (review P3, P6). */
const FORBIDDEN_TYPES = new Set(['EmbeddedFile', 'Sig']);
/** Strings where the visitor's own words may repeat a title or a name: comments, field values and names. */
const OWN_WORDS = new Set(['Contents', 'V', 'DV', 'RV', 'RC', 'T', 'TU', 'TM', 'Subj']);
/** Strings that are a document's working parts, not its metadata: links, layer names, choices, annotation names
 * and appearances. A link to "Report.html" in a file titled "Report" is ordinary (review P9). */
const NOT_METADATA = new Set(['URI', 'Name', 'Opt', 'NM', 'DA', 'D', 'Dest']);

/**
 * The sources' information-dictionary strings: what a result must not repeat.
 * @param {PdfFile[]} files
 */
export function secretsOf(files) {
  /** @type {Set<string>} */
  const secrets = new Set();
  for (const file of files) {
    const info = file.resolve(file.trailer.get('Info'));
    if (!(info instanceof PdfDict)) continue;
    for (const key of INFO_KEYS) {
      const value = file.resolve(info.get(key));
      if (value instanceof PdfString) {
        const text = textOf(value).trim();
        if (text.length >= MIN_SECRET) secrets.add(text);
      }
    }
  }
  return secrets;
}

/**
 * Opens a result again and checks it: no repair needed, the planned number of pages, a box and resources on every
 * page, no /Info and nothing in `FORBIDDEN`, no source secret in any string outside the visitor's own words, and
 * nothing the photo tool found in an added picture (its location, names, numbers) anywhere in the bytes.
 * @param {Uint8Array} bytes
 * @param {{ pages: number, secrets: Set<string>, findings?: Findings[] }} expected
 * @throws {PdfError}  `buildFailed`, saying what failed.
 */
export async function checkResult(bytes, { pages, secrets, findings = [] }) {
  /** @param {string} why */
  const fail = (why) => new PdfError('buildFailed', why);
  let file;
  try {
    file = await openPdf(bytes);
  } catch (error) {
    throw fail(`does not open: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (file.repaired) throw fail('needed repair');
  if (findings.some((found) => stillThere(bytes, found))) throw fail("a picture's location or camera details are in the file");
  if (file.trailer.has('Info') || file.trailer.has('Encrypt')) throw fail('trailer has /Info or /Encrypt');
  const list = pageList(file);
  if (list.length !== pages) throw fail(`${list.length} pages instead of ${pages}`);
  for (const page of list) {
    if (!page.dict.has('MediaBox') || !page.dict.has('Resources')) throw fail('a page without its box or resources');
    // An array inside the contents array is drawn by no reader: the page would come out empty (review P1).
    const contents = file.resolve(page.dict.get('Contents'));
    if (Array.isArray(contents) && contents.some((item) => Array.isArray(file.resolve(item)))) throw fail('a page’s contents hold an array');
  }
  /** @param {PdfObject | undefined} value @param {string} key @param {number} depth */
  const visit = (value, key, depth) => {
    if (depth > 100) return;
    if (value instanceof PdfString) {
      if (!OWN_WORDS.has(key) && !NOT_METADATA.has(key) && secrets.size > 0) {
        const text = textOf(value);
        for (const secret of secrets) if (text.includes(secret)) throw fail(`a source's ${secret.length}-character metadata string is still in the file`);
      }
    } else if (Array.isArray(value)) {
      for (const item of value) visit(item, key, depth + 1);
    } else if (value instanceof PdfDict) {
      const type = value.get('Type');
      if (type instanceof PdfName && FORBIDDEN_TYPES.has(type.value)) throw fail(`a /${type.value} object is in the file`);
      for (const [name, item] of value.entries()) {
        if (FORBIDDEN.has(name)) throw fail(`/${name} is in the file`);
        visit(item, name, depth + 1);
      }
    } else if (value instanceof PdfStream) {
      visit(value.dict, key, depth + 1);
      const filter = file.resolve(value.dict.get('Filter'));
      if ((isName(filter, 'DCTDecode') || isName(filter, 'DCT')) && jpegHasExtras(value.data)) throw fail('a picture still carries metadata');
    }
  };
  for (const num of file.entries.keys()) visit(file.get(num), '', 0);
}

/**
 * From the first PDF source, what says how the whole document is read and printed: its language, which screen
 * readers use, and its output intents, the printing conditions it was made for (review P11).
 * @param {PdfDict} catalog
 * @param {Map<number, SourceCopier>} copiers
 * @param {() => boolean} isCancelled
 */
async function carryFirst(catalog, copiers, isCancelled) {
  const [copier] = copiers.values();
  if (!copier) return;
  const source = copier.file.catalog();
  const lang = copier.file.resolve(source.get('Lang'));
  if (lang instanceof PdfString) catalog.set('Lang', lang);
  const intents = copier.file.resolve(source.get('OutputIntents'));
  if (Array.isArray(intents) && intents.length > 0) {
    catalog.set('OutputIntents', copier.copy(intents, 'OutputIntents'));
    await copier.drain(isCancelled);
  }
}

/* ---------- Save choices → groups of pages (plan §9 item 6) ---------- */

/**
 * @typedef {{ kind: 'all' } | { kind: 'selected', keys: Set<number> } | { kind: 'ranges', ranges: [number, number][] }
 *   | { kind: 'every', n: number } | { kind: 'single' } | { kind: 'source' }} SplitRule
 */

/**
 * The page groups a save choice makes; each group is one file. Empty groups are left out.
 * @param {PlanPage[]} pages
 * @param {SplitRule} rule
 * @returns {PlanPage[][]}
 */
export function splitPages(pages, rule) {
  switch (rule.kind) {
    case 'all':
      return pages.length > 0 ? [pages] : [];
    case 'selected': {
      const chosen = pages.filter((page) => rule.keys.has(page.key));
      return chosen.length > 0 ? [chosen] : [];
    }
    case 'ranges':
      return rule.ranges.map(([from, to]) => pages.slice(from - 1, Math.min(to, pages.length))).filter((group) => group.length > 0);
    case 'every': {
      const groups = [];
      for (let i = 0; i < pages.length; i += rule.n) groups.push(pages.slice(i, i + rule.n));
      return groups;
    }
    case 'single':
      return pages.map((page) => [page]);
    case 'source': {
      /** @type {Map<string, PlanPage[]>} */
      const groups = new Map();
      for (const page of pages) {
        const key = 'source' in page.origin ? `s${page.origin.source}` : 'blank';
        groups.set(key, [...(groups.get(key) ?? []), page]);
      }
      return [...groups.values()];
    }
    default:
      return [];
  }
}

/**
 * Page ranges as typed: "1-3, 5, 8-" (an open end runs to the last page), separated by commas or semicolons;
 * en dashes accepted. Null when something does not read as a range of pages that exist.
 * @param {string} text
 * @param {number} count  Pages on the board.
 * @returns {[number, number][] | null}
 */
export function parseRanges(text, count) {
  const parts = text.split(/[,;]/).map((part) => part.trim()).filter(Boolean);
  if (parts.length === 0) return null;
  /** @type {[number, number][]} */
  const ranges = [];
  for (const part of parts) {
    const match = /^(\d+)\s*(?:[-–]\s*(\d*))?$/.exec(part);
    if (!match) return null;
    const from = Number(match[1]);
    const to = match[2] === undefined ? from : match[2] === '' ? count : Number(match[2]);
    if (from < 1 || to < from || to > count) return null;
    ranges.push([from, to]);
  }
  return ranges;
}

/**
 * Two runs of pages woven together, first, second, first…: for a stack scanned front sides first and back sides
 * after, the second run usually reversed.
 * @param {PlanPage[]} first @param {PlanPage[]} second @param {boolean} reverse
 */
export function interleave(first, second, reverse) {
  const other = reverse ? [...second].reverse() : second;
  const out = [];
  for (let i = 0; i < Math.max(first.length, other.length); i += 1) {
    if (i < first.length) out.push(first[i]);
    if (i < other.length) out.push(other[i]);
  }
  return out;
}

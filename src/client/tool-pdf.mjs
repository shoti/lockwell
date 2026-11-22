// @ts-check
/**
 * @file The PDF tools page (plan docs/tools-plan/pdf-toolkit.md §9): PDFs and pictures added to a board of page cards,
 * selected, reordered (buttons, keys or dragging), rotated, duplicated, deleted, with undo; saved as one PDF or
 * split by a rule, every result built by pdf-build.mjs and checked before it is offered. Previews come from
 * pdf-view.mjs; without them the board still works with outline cards. Every label is in the panel template.
 */
import { canReadBack } from './canvas.mjs';
import { receiveFiles } from './files.mjs';
import { commit, createHistory, redo, undo } from './history.mjs';
import { build, interleave, parseRanges, splitPages } from './pdf-build.mjs';
import { PdfError, openPdf } from './pdf-file.mjs';
import { IMAGE_PAGE, imageLayout, jpegPicture, pngPicture } from './pdf-image.mjs';
import { pageBox, pageList } from './pdf-pages.mjs';
import { decodePicture, drawOverlays, drawPicturePage, rasterPicture, thumbnailOf } from './pdf-raster.mjs';
import { initStage } from './pdf-stage.mjs';
import { turnOverlays } from './pdf-overlay.mjs';
import { PdfDict, PdfName, PdfStream } from './pdf-syntax.mjs';
import { closePreview, drawPage, openPreview } from './pdf-view.mjs';
import { PdfWriter } from './pdf-write.mjs';
import { initSave } from './save.mjs';
import { PhotoError, detectType as photoType, inspectPhoto } from './tool-photo.mjs';
import { cleanArchive } from './zip.mjs';

/** @typedef {import('./pdf-build.mjs').PlanPage} PlanPage */
/** @typedef {import('./pdf-build.mjs').SplitRule} SplitRule */
/** @typedef {import('./pdf-pages.mjs').PageInfo} PageInfo */
/** @typedef {import('./pdf-view.mjs').Preview} Preview */
/** @typedef {import('./pdf-image.mjs').Picture} Picture */
/** @typedef {import('./pdf-image.mjs').ImagePageOptions} ImagePageOptions */
/** @typedef {import('./tool-photo.mjs').Findings} Findings */

/** Pages the board holds (plan §6.3). */
export const BOARD_LIMIT = 5000;
/** Largest file read, on a computer and on a phone (plan §6.3; to be set from phone measurements, research item 10). */
export const FILE_LIMITS = { computer: 300 * 1024 ** 2, phone: 100 * 1024 ** 2 };
/** Previews drawn at the same time. */
const DRAWS_AT_ONCE = 2;
/** Card widths, in rem, for data-size 1–5 (as in the CSS), to size previews before layout is known. */
const CARD_REM = [6, 7.5, 9, 12, 16];
/** Neutral names, used when the visitor chooses them in the save box. */
const FALLBACK = 'document';

/* ---------- The plan: pure edits, each giving a new list ---------- */

/**
 * Moves the pages whose keys are in `keys`, keeping their order: to the start or end, one place back or forward
 * (each run of selected pages steps past its neighbour), or so the first of them lands at a 1-based position.
 * @param {PlanPage[]} pages @param {Set<number>} keys @param {'start' | 'end' | 'left' | 'right' | number} to
 */
export function movePages(pages, keys, to) {
  const chosen = pages.filter((page) => keys.has(page.key));
  const rest = pages.filter((page) => !keys.has(page.key));
  if (to === 'start') return [...chosen, ...rest];
  if (to === 'end') return [...rest, ...chosen];
  if (typeof to === 'number') {
    const at = Math.max(0, Math.min(rest.length, Math.round(to) - 1));
    return [...rest.slice(0, at), ...chosen, ...rest.slice(at)];
  }
  const out = pages.slice();
  const swap = (/** @type {number} */ i, /** @type {number} */ j) => ([out[i], out[j]] = [out[j], out[i]]);
  if (to === 'left') {
    for (let i = 1; i < out.length; i += 1) if (keys.has(out[i].key) && !keys.has(out[i - 1].key)) swap(i - 1, i);
  } else {
    for (let i = out.length - 2; i >= 0; i -= 1) if (keys.has(out[i].key) && !keys.has(out[i + 1].key)) swap(i, i + 1);
  }
  return out;
}

/**
 * Turns pages a quarter; what was added to a page turns with it.
 * @param {PlanPage[]} pages @param {Set<number>} keys @param {90 | -90} delta
 * @param {(page: PlanPage) => { width: number, height: number }} [sizeOf]  The page's size as shown before the turn.
 */
export function rotatePages(pages, keys, delta, sizeOf) {
  return pages.map((page) => {
    if (!keys.has(page.key)) return page;
    const turned = { ...page, turn: /** @type {PlanPage['turn']} */ ((((page.turn + delta) % 360) + 360) % 360) };
    return page.overlays?.length && sizeOf ? { ...turned, overlays: turnOverlays(page.overlays, delta, sizeOf(page)) } : turned;
  });
}

/**
 * Each chosen page followed by a copy of itself under a new key.
 * @param {PlanPage[]} pages @param {Set<number>} keys @param {() => number} nextKey
 */
export function duplicatePages(pages, keys, nextKey) {
  return pages.flatMap((page) => (keys.has(page.key) ? [page, { ...page, key: nextKey() }] : [page]));
}

/** @param {PlanPage[]} pages @param {Set<number>} keys */
export const removePages = (pages, keys) => pages.filter((page) => !keys.has(page.key));

/**
 * A blank page of a size after each chosen page.
 * @param {PlanPage[]} pages @param {Set<number>} keys @param {(page: PlanPage) => { width: number, height: number }} size
 * @param {() => number} nextKey
 */
export function insertBlanks(pages, keys, size, nextKey) {
  return pages.flatMap((page) => (keys.has(page.key) ? [page, { key: nextKey(), origin: { blank: size(page) }, turn: /** @type {const} */ (0) }] : [page]));
}

/** @param {PlanPage[]} pages */
export const reversePages = (pages) => pages.slice().reverse();

/**
 * The first half woven with the second (front sides, then back sides of a scanned stack): the larger half first.
 * @param {PlanPage[]} pages @param {boolean} reversed  The second half was scanned from the last sheet.
 */
export function interleaveHalves(pages, reversed) {
  const half = Math.ceil(pages.length / 2);
  return interleave(pages.slice(0, half), pages.slice(half), reversed);
}

/* ---------- Sizes and text from templates ---------- */

/**
 * A size in bytes as a unit key and a number in the page's language, as the encryption tool shows them.
 * @param {number} bytes @param {string} lang
 */
export function sizeParts(bytes, lang) {
  const units = /** @type {const} */ (['b', 'kb', 'mb', 'gb']);
  let value = bytes;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i += 1;
  }
  const n = new Intl.NumberFormat(lang, { maximumFractionDigits: i === 0 || value >= 10 ? 0 : 1 }).format(value);
  return { unit: units[i], n };
}

/** @param {string} template @param {Record<string, string | number>} values */
const fill = (template, values) => template.replace(/\{(\w+)\}/g, (_, key) => String(values[key] ?? ''));

/** A file's name without its extension. @param {string} name */
const baseName = (name) => name.replace(/\.[^.]*$/, '') || FALLBACK;

/**
 * Files added together, in name order ("scan 2" before "scan 10"), so a batch of photos or scans lands as numbered.
 * @template {{ name: string }} T @param {T[]} files
 */
export const byName = (files) => files.slice().sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));

/**
 * Whether a file is a picture rather than a PDF: by its first bytes (the formats the photo tool reads, GIF, BMP), or
 * by the type the browser gives it when the bytes say nothing a PDF would.
 * @param {Uint8Array} bytes @param {string} type
 */
export function isPicture(bytes, type) {
  if (photoType(bytes)) return true;
  const head = String.fromCharCode(...bytes.subarray(0, 6));
  if (head.startsWith('GIF8') || head.startsWith('BM')) return true;
  return type.startsWith('image/') && !String.fromCharCode(...bytes.subarray(0, 1024)).includes('%PDF-');
}

/* ---------- The example ---------- */

/**
 * A three-page example PDF made here, so "Try an example" needs no file and no network: big numbers on coloured
 * pages, nothing in any language.
 */
export async function examplePdf() {
  const writer = new PdfWriter();
  const tree = writer.reserve();
  const font = writer.add(new PdfDict([['Type', new PdfName('Font')], ['Subtype', new PdfName('Type1')], ['BaseFont', new PdfName('Helvetica-Bold')]]));
  const colours = ['0.86 0.93 0.92', '0.97 0.91 0.82', '0.88 0.89 0.97'];
  const kids = [];
  for (let i = 0; i < 3; i += 1) {
    const content = writer.reserve();
    const text = `${colours[i]} rg 40 40 515 762 re f 0.1 0.2 0.25 rg BT /F1 320 Tf 210 300 Td (${i + 1}) Tj ET 0.1 0.2 0.25 RG 6 w 80 700 m 515 700 l S`;
    await writer.setStream(content, new PdfStream(new PdfDict(), Uint8Array.from(text, (char) => char.charCodeAt(0))));
    const resources = new PdfDict([['Font', new PdfDict([['F1', font]])]]);
    kids.push(writer.add(new PdfDict([['Type', new PdfName('Page')], ['Parent', tree], ['MediaBox', [0, 0, 595, 842]], ['Resources', resources], ['Contents', content]])));
  }
  writer.set(tree, new PdfDict([['Type', new PdfName('Pages')], ['Kids', kids], ['Count', kids.length]]));
  const root = writer.add(new PdfDict([['Type', new PdfName('Catalog')], ['Pages', tree]]));
  return writer.write({ root });
}

/* ---------- The page ---------- */

/**
 * A file on the board: a PDF with its pages, or a picture that makes one page.
 * @typedef {{ kind: 'pdf', id: number, name: string, size: number, bytes: Uint8Array, file: import('./pdf-file.mjs').PdfFile,
 *   pages: PageInfo[], preview: Promise<Preview | null> | null }} PdfSourceView
 * @typedef {{ kind: 'image', id: number, name: string, size: number, picture: Picture, findings: Findings | null,
 *   thumb: ImageBitmap | null }} ImageSourceView
 * @typedef {PdfSourceView | ImageSourceView} Source
 */

/** @param {HTMLElement} root */
export function init(root) {
  /** @param {string} name */
  const find = (name) => /** @type {HTMLElement} */ (root.querySelector(`[data-js="pdf-${name}"]`));
  /** @param {string} name */
  const button = (name) => /** @type {HTMLButtonElement} */ (find(name));
  /** @param {string} name */
  const input = (name) => /** @type {HTMLInputElement} */ (find(name));
  const lang = document.documentElement.lang || 'en';
  const message = find('message');
  const work = find('work');
  const cards = find('cards');
  const status = find('status');
  const template = /** @type {HTMLTemplateElement} */ (find('card-template'));
  const units = find('units');
  const progress = /** @type {HTMLProgressElement} */ (find('progress'));
  const result = find('result');
  const save = initSave(/** @type {HTMLElement} */ (result.querySelector('[data-js="save"]')));

  /** @type {Map<number, Source>} */
  const sources = new Map();
  let history = createHistory(/** @type {PlanPage[]} */ ([]));
  /** @type {Set<number>} */
  let selected = new Set();
  /** @type {number | null} */
  let focusKey = null;
  let anchorKey = /** @type {number | null} */ (null);
  let nextKey = 1;
  let nextSource = 1;
  let busy = false;
  let cancelled = false;
  let size = 3;
  let previewsUnavailable = false;
  /** @type {ImagePageOptions} */
  let imagePage = { ...IMAGE_PAGE };
  /** @type {boolean | null} */
  let readBack = null;
  const key = () => nextKey++;
  const pages = () => history.entries[history.index];

  /** @param {string} name @param {Record<string, string | number>} [values] */
  const say = (name, values = {}) => {
    message.textContent = fill(message.dataset[name] ?? '', values);
  };
  /** @param {number} bytes */
  const sizeText = (bytes) => {
    const { unit, n } = sizeParts(bytes, lang);
    return fill(units.dataset[unit] ?? '{n}', { n });
  };
  const phone = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches && !matchMedia('(pointer: fine)').matches;
  const fileLimit = phone ? FILE_LIMITS.phone : FILE_LIMITS.computer;

  /* ----- Cards ----- */

  /**
   * @typedef {{ element: HTMLElement, canvas: HTMLCanvasElement, check: HTMLInputElement, drawn: string, task: { cancel: () => void } | null, visible: boolean }} Card
   * @type {Map<number, Card>}
   */
  const cardViews = new Map();

  /** The shown size of a planned page, in points. @param {PlanPage} page */
  const shownSize = (page) => {
    if ('blank' in page.origin) {
      const { width, height } = page.origin.blank;
      return page.turn % 180 === 0 ? { width, height } : { width: height, height: width };
    }
    const source = sources.get(page.origin.source);
    const info = source?.kind === 'pdf' ? source.pages[page.origin.index] : null;
    const { width, height } = source?.kind === 'image' ? imageLayout(source.picture, imagePage) : info ? pageBox(info) : { width: 612, height: 792 };
    return page.turn % 180 === 0 ? { width, height } : { width: height, height: width };
  };
  /** @param {PlanPage} page */
  const isImagePage = (page) => 'source' in page.origin && sources.get(page.origin.source)?.kind === 'image';
  /** What a card was drawn for: picture pages also depend on the page settings. @param {PlanPage} page */
  const drawKey = (page) => `${isImagePage(page) ? `${page.turn}:${size}:${imagePage.size}:${imagePage.margin}` : `${page.turn}:${size}`}${overlayKey(page)}`;
  /** Each list of overlays a number, so a card is drawn again when what is on it changed. @type {WeakMap<object, number>} */
  const overlayIds = new WeakMap();
  let nextOverlayId = 1;
  /** @param {PlanPage} page */
  const overlayKey = (page) => {
    if (!page.overlays?.length) return '';
    let id = overlayIds.get(page.overlays);
    if (!id) {
      id = nextOverlayId++;
      overlayIds.set(page.overlays, id);
    }
    return `:o${id}`;
  };

  /**
   * Draws a page as shown, without what was added to it, `width` CSS pixels wide. False when it cannot be shown.
   * @param {PlanPage} page @param {HTMLCanvasElement} canvas @param {number} width @param {number} ratio
   * @param {(task: { cancel: () => void } | null) => void} [onTask]  Gets the drawing while it runs, to cancel it.
   */
  const drawPlain = async (page, canvas, width, ratio, onTask) => {
    if ('blank' in page.origin) {
      const shown = shownSize(page);
      [canvas.width, canvas.height] = [Math.max(1, Math.round(width * ratio)), Math.max(1, Math.round((width * ratio * shown.height) / shown.width))];
      const context = typeof canvas.getContext === 'function' ? canvas.getContext('2d') : null;
      if (context) {
        context.fillStyle = '#ffffff';
        context.fillRect(0, 0, canvas.width, canvas.height);
      }
      return Boolean(context);
    }
    const source = sources.get(page.origin.source);
    if (!source) return false;
    if (source.kind === 'image') {
      if (!source.thumb) return false;
      drawPicturePage(canvas, source.thumb, imageLayout(source.picture, imagePage), { width, turn: page.turn, ratio });
      return true;
    }
    const preview = await (source.preview ?? null);
    if (!preview) {
      if (!previewsUnavailable) {
        previewsUnavailable = true;
        say('noPreview');
      }
      return false;
    }
    const task = drawPage(preview, page.origin.index, canvas, { width, turn: page.turn, ratio });
    onTask?.(task);
    const ok = await task.done;
    onTask?.(null);
    return ok;
  };

  /** @param {PlanPage} page */
  const cardFor = (page) => {
    const known = cardViews.get(page.key);
    if (known) return known;
    const element = /** @type {HTMLElement} */ (/** @type {HTMLElement} */ (template.content.firstElementChild).cloneNode(true));
    element.dataset.key = String(page.key);
    /** @type {Card} */
    const card = {
      element,
      canvas: /** @type {HTMLCanvasElement} */ (element.querySelector('[data-js="pdf-card-canvas"]')),
      check: /** @type {HTMLInputElement} */ (element.querySelector('[data-js="pdf-card-check"]')),
      drawn: '',
      task: null,
      visible: false,
    };
    card.check.addEventListener('change', () => {
      if (card.check.checked) selected.add(page.key);
      else selected.delete(page.key);
      anchorKey = page.key;
      focusKey = page.key;
      render();
    });
    for (const action of element.querySelectorAll('[data-js="pdf-card-action"]')) {
      action.addEventListener('click', () => {
        const details = element.querySelector('details');
        if (details) /** @type {HTMLDetailsElement} */ (details).open = false;
        act(/** @type {HTMLElement} */ (action).dataset.action ?? '', new Set([Number(element.dataset.key)]));
      });
    }
    startDrag(element);
    cardViews.set(page.key, card);
    observer?.observe(element);
    return card;
  };

  /** Draws what is visible and not drawn yet, two at a time; releases what scrolled far away. */
  const queue = new Set();
  let drawing = 0;
  const pump = () => {
    for (const keyValue of queue) {
      if (drawing >= DRAWS_AT_ONCE) return;
      queue.delete(keyValue);
      const page = pages().find((item) => item.key === keyValue);
      const card = cardViews.get(keyValue);
      if (!page || !card) continue;
      const wanted = drawKey(page);
      if (card.drawn === wanted) continue;
      if ('blank' in page.origin && !page.overlays?.length) {
        card.drawn = wanted;
        continue;
      }
      drawing += 1;
      (async () => {
        const ratio = Math.min(2, globalThis.devicePixelRatio || 1);
        const width = card.canvas.clientWidth || CARD_REM[size - 1] * 16;
        const ok = await drawPlain(page, card.canvas, width, ratio, (task) => {
          card.task = task;
        });
        card.element.classList.toggle('is-outline', !ok);
        if (!ok) return;
        if (page.overlays?.length) drawOverlays(/** @type {CanvasRenderingContext2D} */ (card.canvas.getContext('2d')), page.overlays, card.canvas.width, card.canvas.height);
        card.drawn = wanted;
      })().finally(() => {
        drawing -= 1;
        pump();
      });
    }
  };
  /** @param {number} keyValue */
  const want = (keyValue) => {
    queue.add(keyValue);
    pump();
  };
  /** Releases a card's pixels, keeping its shape. @param {Card} card @param {PlanPage} page */
  const release = (card, page) => {
    card.task?.cancel();
    card.drawn = '';
    placeholder(card, page);
  };
  /** The canvas sized to the page's shape before (or instead of) a preview, so nothing moves. @param {Card} card @param {PlanPage} page */
  const placeholder = (card, page) => {
    const { width, height } = shownSize(page);
    card.canvas.width = 100;
    card.canvas.height = Math.max(20, Math.min(1000, Math.round((100 * height) / width)));
  };

  const observer = typeof IntersectionObserver === 'function'
    ? new IntersectionObserver((entries) => {
      for (const entry of entries) {
        const keyValue = Number(/** @type {HTMLElement} */ (entry.target).dataset.key);
        const card = cardViews.get(keyValue);
        const page = pages().find((item) => item.key === keyValue);
        if (!card || !page) continue;
        card.visible = entry.isIntersecting;
        if (entry.isIntersecting) want(keyValue);
        else if (card.drawn) release(card, page);
      }
    }, { rootMargin: '600px 0px' })
    : null;

  /* ----- Rendering the board ----- */

  const render = () => {
    const list = pages();
    const keys = new Set(list.map((page) => page.key));
    selected = new Set([...selected].filter((value) => keys.has(value)));
    if (focusKey !== null && !keys.has(focusKey)) focusKey = list[0]?.key ?? null;
    for (const [keyValue, card] of cardViews) {
      if (keys.has(keyValue)) continue;
      card.task?.cancel();
      observer?.unobserve(card.element);
      cardViews.delete(keyValue);
    }
    /** @type {HTMLElement[]} */
    const elements = [];
    list.forEach((page, i) => {
      const card = cardFor(page);
      const label = card.check.dataset[('blank' in page.origin) ? 'blank' : 'template'] ?? '';
      const source = 'source' in page.origin ? sources.get(page.origin.source) : null;
      const text = fill(label, { n: i + 1, name: source?.name ?? '', page: 'source' in page.origin ? page.origin.index + 1 : '' });
      card.check.setAttribute('aria-label', text);
      card.element.setAttribute('aria-label', text);
      card.check.checked = selected.has(page.key);
      card.element.classList.toggle('is-selected', selected.has(page.key));
      card.element.setAttribute('tabindex', page.key === (focusKey ?? list[0]?.key) ? '0' : '-1');
      /** @type {HTMLElement} */ (card.element.querySelector('[data-js="pdf-card-number"]')).textContent = String(i + 1);
      /** @type {HTMLElement} */ (card.element.querySelector('[data-js="pdf-card-source"]')).textContent = !source || !('source' in page.origin) ? '' : source.kind === 'image' ? source.name : `${source.name} · ${page.origin.index + 1}`;
      if (card.drawn !== drawKey(page)) {
        if (!card.drawn) placeholder(card, page);
        if (!observer || card.visible) want(page.key);
      }
      elements.push(card.element);
    });
    // Re-inserting a card takes focus away from it, so the board is only rebuilt when its order changed, and then
    // focus goes back to where it was.
    if (elements.length !== cards.children.length || elements.some((element, i) => cards.children[i] !== element)) {
      const focused = document.activeElement;
      cards.replaceChildren(...elements);
      if (focused instanceof HTMLElement && focused !== document.activeElement && cards.contains(focused)) focused.focus();
    }
    cards.dataset.size = String(size);
    status.textContent = fill((list.length === 1 ? status.dataset.templateOne : status.dataset.template) ?? '', { pages: list.length, selected: selected.size });
    work.hidden = sources.size === 0;
    find('pictures').hidden = !list.some(isImagePage);
    button('undo').disabled = history.index === 0;
    button('redo').disabled = history.index === history.entries.length - 1;
    button('smaller').disabled = size === 1;
    button('larger').disabled = size === CARD_REM.length;
    for (const name of ['select-all', 'select-none', 'move-start', 'move-left', 'move-right', 'move-end', 'rotate-left', 'rotate-right', 'duplicate', 'blank', 'sign', 'remove', 'position-move', 'range-select', 'reverse', 'interleave']) {
      button(name).disabled = list.length === 0;
    }
    input('position').max = String(Math.max(1, list.length));
    button('create').disabled = busy || list.length === 0;
    button('cancel').disabled = !busy;
    if (stage.openKey !== null) stage.refresh();
  };

  /** @param {PlanPage[]} next @param {string} [tag] */
  const change = (next, tag = '') => {
    history = commit(history, next, tag);
    clearResult();
    releaseUnused();
    render();
  };

  /** @param {Source} source */
  const letGo = (source) => {
    if (source.kind === 'pdf') void source.preview?.then(closePreview);
    else source.thumb?.close();
  };
  /** Lets go of sources no step of the history refers to. */
  const releaseUnused = () => {
    const used = new Set(history.entries.flatMap((list) => list.flatMap((page) => ('source' in page.origin ? [page.origin.source] : []))));
    for (const [id, source] of sources) {
      if (used.has(id)) continue;
      letGo(source);
      sources.delete(id);
    }
  };

  /* ----- Actions on pages ----- */

  /** The pages an action applies to: the selection, or the focused page when nothing is selected. */
  const targets = () => {
    if (selected.size > 0) return selected;
    return focusKey === null ? new Set() : new Set([focusKey]);
  };

  /**
   * @param {string} action
   * @param {Set<number>} keys
   */
  const act = (action, keys) => {
    if (busy) return say('busy');
    const list = pages();
    if (keys.size === 0) return say('nothingSelected');
    const firstIndex = list.findIndex((page) => keys.has(page.key));
    switch (action) {
      case 'move-start':
      case 'move-end':
      case 'move-left':
      case 'move-right': {
        const next = movePages(list, keys, /** @type {'start' | 'end' | 'left' | 'right'} */ (action.slice(5)));
        change(next, `move:${[...keys].join(',')}`);
        announceMove(keys, firstIndex, next);
        return;
      }
      case 'rotate-left':
      case 'rotate-right':
        change(rotatePages(list, keys, action === 'rotate-left' ? -90 : 90, shownSize), `rotate:${[...keys].join(',')}`);
        return;
      case 'duplicate':
        change(duplicatePages(list, keys, key));
        return;
      case 'blank':
        change(insertBlanks(list, keys, (page) => shownSize({ ...page, turn: 0 }), key));
        return;
      case 'remove':
        change(removePages(list, keys));
        return;
      case 'sign':
        stage.open(list[firstIndex].key);
        return;
      default:
    }
  };

  /** @param {Set<number>} keys @param {number} from @param {PlanPage[]} next */
  const announceMove = (keys, from, next) => {
    const to = next.findIndex((page) => keys.has(page.key));
    if (to === from) return;
    status.textContent = keys.size === 1
      ? fill(status.dataset.moved ?? '', { from: from + 1, to: to + 1 })
      : fill(status.dataset.movedMany ?? '', { count: keys.size, to: to + 1 });
  };

  for (const name of ['move-start', 'move-left', 'move-right', 'move-end', 'rotate-left', 'rotate-right', 'duplicate', 'blank', 'sign', 'remove']) {
    button(name).addEventListener('click', () => act(name, targets()));
  }
  button('position-move').addEventListener('click', () => {
    const list = pages();
    const position = Number(input('position').value);
    if (!Number.isInteger(position) || position < 1 || position > list.length) return say('badPosition', { pages: list.length });
    const keys = targets();
    if (keys.size === 0) return say('nothingSelected');
    const from = list.findIndex((page) => keys.has(page.key));
    const next = movePages(list, keys, position);
    change(next);
    announceMove(keys, from, next);
  });
  button('reverse').addEventListener('click', () => change(reversePages(pages())));
  button('interleave').addEventListener('click', () => change(interleaveHalves(pages(), input('interleave-reversed').checked)));
  button('undo').addEventListener('click', () => step(undo));
  button('redo').addEventListener('click', () => step(redo));
  /** @param {typeof undo} move */
  const step = (move) => {
    if (busy) return;
    history = move(history);
    clearResult();
    render();
  };
  button('select-all').addEventListener('click', () => {
    selected = new Set(pages().map((page) => page.key));
    render();
  });
  button('select-none').addEventListener('click', () => {
    selected = new Set();
    render();
  });
  button('range-select').addEventListener('click', () => {
    const list = pages();
    const ranges = parseRanges(input('range').value, list.length);
    if (!ranges) return say('badRanges');
    selected = new Set(ranges.flatMap(([from, to]) => list.slice(from - 1, to).map((page) => page.key)));
    render();
  });
  button('smaller').addEventListener('click', () => resize(-1));
  button('larger').addEventListener('click', () => resize(1));
  /** @param {number} delta */
  const resize = (delta) => {
    size = Math.max(1, Math.min(CARD_REM.length, size + delta));
    render();
  };

  /* ----- Keyboard on the board (key positions by event.code, so any keyboard layout works) ----- */

  cards.addEventListener('keydown', (event) => {
    const keyEvent = /** @type {KeyboardEvent} */ (event);
    const target = /** @type {HTMLElement} */ (keyEvent.target);
    if (target?.dataset?.js !== 'pdf-card') return; // a checkbox, button or menu keeps its own keys
    const list = pages();
    const index = list.findIndex((page) => page.key === Number(target.dataset.key));
    if (index < 0) return;
    const mod = keyEvent.ctrlKey || keyEvent.metaKey;
    const columns = columnsOf();
    /** @param {number} to */
    const go = (to) => {
      const next = list[Math.max(0, Math.min(list.length - 1, to))];
      if (keyEvent.shiftKey) {
        const anchor = list.findIndex((page) => page.key === (anchorKey ?? list[index].key));
        const [a, b] = [Math.min(anchor, list.indexOf(next)), Math.max(anchor, list.indexOf(next))];
        selected = new Set(list.slice(a, b + 1).map((page) => page.key));
      } else {
        anchorKey = next.key;
      }
      focusKey = next.key;
      render();
      cardViews.get(next.key)?.element.focus();
    };
    const moves = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -columns, ArrowDown: columns, Home: -Infinity, End: Infinity };
    if (keyEvent.code in moves) {
      keyEvent.preventDefault();
      const delta = moves[/** @type {keyof typeof moves} */ (keyEvent.code)];
      if (keyEvent.altKey && (keyEvent.code === 'ArrowLeft' || keyEvent.code === 'ArrowRight')) {
        act(keyEvent.code === 'ArrowLeft' ? 'move-left' : 'move-right', targets());
        cardViews.get(list[index].key)?.element.focus();
        return;
      }
      go(Number.isFinite(delta) ? index + delta : delta < 0 ? 0 : list.length - 1);
      return;
    }
    if (keyEvent.code === 'Space') {
      keyEvent.preventDefault();
      const value = list[index].key;
      if (selected.has(value)) selected.delete(value);
      else selected.add(value);
      anchorKey = value;
      render();
    } else if (keyEvent.code === 'KeyR' && !mod) {
      keyEvent.preventDefault();
      act(keyEvent.shiftKey ? 'rotate-left' : 'rotate-right', targets());
    } else if (keyEvent.code === 'Delete' || keyEvent.code === 'Backspace') {
      keyEvent.preventDefault();
      act('remove', targets());
    } else if (mod && keyEvent.code === 'KeyZ') {
      keyEvent.preventDefault();
      step(keyEvent.shiftKey ? redo : undo);
    } else if (mod && keyEvent.code === 'KeyY') {
      keyEvent.preventDefault();
      step(redo);
    } else if (mod && keyEvent.code === 'KeyA') {
      keyEvent.preventDefault();
      selected = new Set(list.map((page) => page.key));
      render();
    }
  });

  /** Cards in the first row of the board, for up and down. */
  const columnsOf = () => {
    const elements = [...cardViews.values()].map((card) => card.element);
    const top = elements[0]?.getBoundingClientRect?.().top;
    if (top === undefined) return 1;
    return Math.max(1, elements.filter((element) => element.getBoundingClientRect().top === top).length);
  };

  /* ----- Dragging (every drag also has buttons and keys: WCAG 2.5.7) ----- */

  /** @param {HTMLElement} element */
  function startDrag(element) {
    const grip = /** @type {HTMLElement} */ (element.querySelector('[data-js="pdf-card-grip"]'));
    /** @type {{ id: number, keys: Set<number>, over: HTMLElement | null, after: boolean } | null} */
    let drag = null;
    const clear = () => {
      for (const card of cardViews.values()) card.element.classList.remove('is-dragging', 'is-drop-before', 'is-drop-after');
    };
    grip.addEventListener('pointerdown', (event) => {
      const pointer = /** @type {PointerEvent} */ (event);
      if (busy || pointer.button !== 0) return;
      const own = Number(element.dataset.key);
      const keys = selected.has(own) ? new Set(selected) : new Set([own]);
      drag = { id: pointer.pointerId, keys, over: null, after: false };
      grip.setPointerCapture?.(pointer.pointerId);
      for (const value of keys) cardViews.get(value)?.element.classList.add('is-dragging');
    });
    grip.addEventListener('pointermove', (event) => {
      const pointer = /** @type {PointerEvent} */ (event);
      if (!drag || pointer.pointerId !== drag.id) return;
      const hit = document.elementFromPoint?.(pointer.clientX, pointer.clientY);
      const over = /** @type {HTMLElement | null} */ (hit?.closest?.('[data-js="pdf-card"]') ?? null);
      if (!over || over === drag.over) return;
      const box = over.getBoundingClientRect();
      const after = pointer.clientX > box.left + box.width / 2;
      drag.over?.classList.remove('is-drop-before', 'is-drop-after');
      drag.over = over;
      drag.after = after;
      over.classList.add(after ? 'is-drop-after' : 'is-drop-before');
    });
    const finish = (/** @type {Event} */ event) => {
      const pointer = /** @type {PointerEvent} */ (event);
      if (!drag || pointer.pointerId !== drag.id) return;
      const { keys, over, after } = drag;
      drag = null;
      clear();
      if (event.type !== 'pointerup' || !over || keys.has(Number(over.dataset.key))) return;
      const list = pages();
      const rest = list.filter((page) => !keys.has(page.key));
      const at = rest.findIndex((page) => page.key === Number(over.dataset.key)) + (after ? 1 : 0);
      const from = list.findIndex((page) => keys.has(page.key));
      const next = movePages(list, keys, at + 1);
      change(next);
      announceMove(keys, from, next);
    };
    grip.addEventListener('pointerup', finish);
    grip.addEventListener('pointercancel', finish);
  }

  /* ----- Adding files ----- */

  /** @param {File[]} files */
  const addFiles = async (files) => {
    if (busy) return say('busy');
    busy = true;
    render();
    try {
      for (const file of byName(files)) await addFile(file.name, file.size, () => file.arrayBuffer(), file.type);
    } finally {
      busy = false;
      render();
    }
  };

  /**
   * @param {string} name @param {number} bytesSize @param {() => Promise<ArrayBuffer>} read @param {string} [type]
   */
  const addFile = async (name, bytesSize, read, type = '') => {
    if (bytesSize > fileLimit) return say('tooLarge', { name, limit: sizeText(fileLimit) });
    /** @type {Uint8Array} */
    let bytes;
    let file;
    let list;
    try {
      bytes = new Uint8Array(await read());
      if (isPicture(bytes, type)) return addPicture(name, bytesSize, bytes);
      file = await openPdf(bytes);
      list = pageList(file);
    } catch (error) {
      if (!(error instanceof PdfError)) {
        console.error('[lockwell] A PDF could not be opened.', error);
        return say('damaged', { name });
      }
      return say(error.code === 'unsupported' ? 'unsupported' : error.code === 'tooLarge' ? 'tooLarge' : error.code === 'locked' ? 'locked' : 'damaged', { name, limit: sizeText(fileLimit) });
    }
    if (file.encrypted) return say('locked', { name });
    if (pages().length + list.length > BOARD_LIMIT) return say('tooMany', { name, limit: BOARD_LIMIT });
    const id = nextSource++;
    sources.set(id, { kind: 'pdf', id, name, size: bytesSize, bytes, file, pages: list, preview: openPreview(bytes) });
    const added = list.map((_, index) => ({ key: key(), origin: { source: id, index }, turn: /** @type {const} */ (0) }));
    if (!input('name').value) input('name').value = baseName(name);
    change([...pages(), ...added]);
    say(file.repaired ? 'repaired' : list.length === 1 ? 'addedOne' : 'added', { name, pages: list.length });
  };

  /**
   * A picture as one page (plan §6.8). JPEG and simple PNG go in unchanged once the photo tool has cleaned them; the
   * rest is decoded and drawn again, which carries nothing of the original file.
   * @param {string} name @param {number} bytesSize @param {Uint8Array} bytes
   */
  const addPicture = async (name, bytesSize, bytes) => {
    if (pages().length + 1 > BOARD_LIMIT) return say('tooMany', { name, limit: BOARD_LIMIT });
    const kind = photoType(bytes);
    /** @type {Picture | null} */
    let picture = null;
    /** @type {Findings | null} */
    let findings = null;
    if (kind === 'jpeg' || kind === 'png') {
      try {
        const report = await inspectPhoto(/** @type {Uint8Array<ArrayBuffer>} */ (bytes.slice()), { dropProfile: true });
        findings = report.findings;
        if (report.clean && report.verified) picture = kind === 'jpeg' ? jpegPicture(report.clean, report.orientation) : pngPicture(report.clean);
      } catch (error) {
        // A file the cleaner cannot follow is decoded and drawn again below instead.
        if (!(error instanceof PhotoError)) console.error('[lockwell] A picture could not be read.', error);
      }
    }
    const bitmap = await decodePicture(bytes);
    let scaled = false;
    /** @type {ImageBitmap | null} */
    let thumb = null;
    try {
      if (!picture) {
        if (!bitmap) return say('pictureUnsupported', { name });
        readBack ??= canReadBack();
        if (!readBack) return say('blocked', { name });
        // Photos stay JPEG; drawings, screenshots and the rest are kept without loss.
        ({ picture, scaled } = await rasterPicture(bitmap, { lossless: !['jpeg', 'webp', 'heic', 'avif'].includes(kind ?? '') }));
      }
      if (bitmap) thumb = await thumbnailOf(bitmap);
    } catch (error) {
      console.error('[lockwell] A picture could not be prepared for the PDF.', error);
      return say('pictureUnsupported', { name });
    } finally {
      bitmap?.close();
    }
    const id = nextSource++;
    sources.set(id, { kind: 'image', id, name, size: bytesSize, picture, findings, thumb });
    if (!input('name').value) input('name').value = baseName(name);
    change([...pages(), { key: key(), origin: { source: id, index: 0 }, turn: 0 }]);
    say(scaled ? 'resized' : 'addedOne', { name, pages: 1 });
  };

  receiveFiles(root, (_, all) => void addFiles(all), { paste: true });
  input('file').addEventListener('change', () => {
    const files = [...(input('file').files ?? [])];
    if (files.length) void addFiles(files);
    input('file').value = '';
  });
  button('example').addEventListener('click', async () => {
    if (busy) return say('busy');
    busy = true;
    try {
      const bytes = await examplePdf();
      await addFile('example.pdf', bytes.length, async () => bytes.slice().buffer);
    } finally {
      busy = false;
      render();
    }
  });

  /* ----- Pages for pictures ----- */

  for (const radio of ['size', 'margin'].flatMap((name) => [...root.querySelectorAll(`[data-js="pdf-picture-${name}"]`)])) {
    radio.addEventListener('change', () => {
      const chosen = (/** @type {string} */ name) => /** @type {HTMLInputElement | undefined} */ ([...root.querySelectorAll(`[data-js="pdf-picture-${name}"]`)].find((item) => /** @type {HTMLInputElement} */ (item).checked))?.value;
      const sizeName = chosen('size');
      const margin = Number(chosen('margin'));
      imagePage = {
        size: sizeName === 'a4' || sizeName === 'letter' ? sizeName : 'fit',
        margin: margin === 5 || margin === 10 ? margin : 0,
      };
      clearResult();
      for (const page of pages()) {
        const card = cardViews.get(page.key);
        if (card && isImagePage(page)) placeholder(card, page);
      }
      render();
    });
  }

  /* ----- Sign and stamp ----- */

  const stage = initStage(root, { pages, change, shown: shownSize, drawPage: drawPlain, selected: () => selected, lang });

  /* ----- Starting again ----- */

  const restart = find('restart');
  button('restart-ask').addEventListener('click', () => {
    restart.hidden = false;
    button('restart-no').focus();
  });
  button('restart-no').addEventListener('click', () => {
    restart.hidden = true;
  });
  button('restart-yes').addEventListener('click', () => {
    restart.hidden = true;
    stage.reset();
    for (const source of sources.values()) letGo(source);
    sources.clear();
    for (const card of cardViews.values()) card.task?.cancel();
    cardViews.clear();
    history = createHistory([]);
    selected = new Set();
    focusKey = null;
    input('name').value = '';
    message.textContent = '';
    clearResult();
    render();
  });

  /* ----- Saving ----- */

  const makeRadios = /** @type {HTMLInputElement[]} */ ([...root.querySelectorAll('[data-js="pdf-make"]')]);
  const make = () => makeRadios.find((radio) => radio.checked)?.value ?? 'all';
  for (const radio of makeRadios) {
    radio.addEventListener('change', () => {
      input('ranges').disabled = make() !== 'ranges';
      input('every').disabled = make() !== 'every';
    });
  }

  /** @returns {SplitRule | null} */
  const rule = () => {
    const list = pages();
    switch (make()) {
      case 'selected':
        if (selected.size === 0) {
          say('nothingSelected');
          return null;
        }
        return { kind: 'selected', keys: new Set(selected) };
      case 'ranges': {
        const ranges = parseRanges(input('ranges').value, list.length);
        if (!ranges) say('badRanges');
        return ranges ? { kind: 'ranges', ranges } : null;
      }
      case 'every': {
        const n = Number(input('every').value);
        if (!Number.isInteger(n) || n < 1) {
          say('badEvery');
          return null;
        }
        return { kind: 'every', n };
      }
      case 'single':
        return { kind: 'single' };
      case 'source':
        return { kind: 'source' };
      default:
        return { kind: 'all' };
    }
  };

  const clearResult = () => {
    result.hidden = true;
    save.clear();
  };

  button('cancel').addEventListener('click', () => {
    cancelled = true;
  });

  button('create').addEventListener('click', async () => {
    if (busy) return say('busy');
    const chosen = rule();
    if (!chosen) return;
    const groups = splitPages(pages(), chosen);
    if (groups.length === 0) return say('nothingSelected');
    busy = true;
    cancelled = false;
    clearResult();
    message.textContent = '';
    progress.value = 0;
    progress.hidden = false;
    render();
    /** @type {{ bytes: Uint8Array, report: import('./pdf-build.mjs').Result }[]} */
    const results = [];
    try {
      const inputs = new Map([...sources].map(([id, source]) => [id, source.kind === 'pdf' ? { file: source.file, pages: source.pages } : { picture: source.picture, findings: source.findings }]));
      for (const [i, group] of groups.entries()) {
        results.push(await build({ pages: group, sources: inputs, imagePage, isCancelled: () => cancelled, onProgress: (done, total) => { progress.value = (i + done / total) / groups.length; } }));
      }
    } catch (error) {
      const code = error instanceof PdfError ? error.code : 'buildFailed';
      if (!(error instanceof PdfError)) console.error('[lockwell] A PDF could not be built.', error);
      say(code === 'cancelled' ? 'cancelled' : code === 'locked' ? 'locked' : 'buildFailed', { name: '' });
      return;
    } finally {
      busy = false;
      progress.hidden = true;
      render();
    }
    await showResult(results, groups);
  });

  /**
   * @param {{ bytes: Uint8Array, report: import('./pdf-build.mjs').Result }[]} results
   * @param {PlanPage[][]} groups
   */
  const showResult = async (results, groups) => {
    const base = input('name').value.trim() || FALLBACK;
    const names = results.length === 1 ? [`${base}.pdf`] : results.map((_, i) => `${base}-${i + 1}.pdf`);
    const total = results.reduce((sum, item) => sum + item.bytes.length, 0);
    const usedSources = new Set(groups.flat().flatMap((page) => ('source' in page.origin ? [page.origin.source] : [])));
    const before = [...usedSources].reduce((sum, id) => sum + (sources.get(id)?.size ?? 0), 0);
    const line = find('result-line');
    const pagesCount = groups.reduce((sum, group) => sum + group.length, 0);
    line.textContent = fill(line.dataset[results.length > 1 ? 'many' : pagesCount === 1 ? 'onePage' : 'one'] ?? '', { files: results.length, pages: pagesCount, size: sizeText(total), before: sizeText(before) });
    const dropped = new Set(results.flatMap((item) => item.report.dropped));
    const kept = new Set(results.flatMap((item) => item.report.kept));
    const warnings = new Set(results.flatMap((item) => item.report.warnings));
    const linksRemoved = results.reduce((sum, item) => sum + item.report.linksRemoved, 0);
    /** @param {string} name @param {Set<string>} set */
    const showItems = (name, set) => {
      for (const item of root.querySelectorAll(`[data-js="pdf-${name}"]`)) /** @type {HTMLElement} */ (item).hidden = !set.has(/** @type {HTMLElement} */ (item).dataset.key ?? '');
    };
    showItems('dropped-item', dropped);
    showItems('kept-item', kept);
    showItems('warning-item', warnings);
    const links = find('links-removed');
    links.hidden = linksRemoved === 0;
    links.textContent = fill((linksRemoved === 1 ? links.dataset.one : links.dataset.template) ?? '', { count: linksRemoved });
    find('dropped').hidden = dropped.size === 0 && linksRemoved === 0;
    find('kept').hidden = kept.size === 0;
    find('warnings').hidden = warnings.size === 0;
    const list = find('files');
    list.hidden = results.length < 2;
    list.replaceChildren(...results.map((item, i) => {
      const li = document.createElement('li');
      li.textContent = `${names[i]} (${sizeText(item.bytes.length)})`;
      li.setAttribute('translate', 'no');
      return li;
    }));
    if (results.length === 1) {
      save.offer({ blob: new Blob([/** @type {Uint8Array<ArrayBuffer>} */ (results[0].bytes)], { type: 'application/pdf' }), original: names[0], extension: 'pdf', fallback: FALLBACK, suffix: '' });
    } else {
      const offerAll = () => {
        const neutral = save.isNeutral();
        const archive = cleanArchive(results.map((item, i) => ({ original: names[i], extension: 'pdf', data: item.bytes, neutral })), { fallback: FALLBACK, suffix: '' });
        save.offer({ blob: new Blob([archive], { type: 'application/zip' }), original: `${base}.zip`, extension: 'zip', fallback: `${FALLBACK}s`, suffix: '' });
      };
      offerAll();
      save.onRename(offerAll);
    }
    result.hidden = false;
    say('saved');
    const canvas = /** @type {HTMLCanvasElement} */ (find('result-canvas'));
    const preview = await openPreview(results[0].bytes);
    if (preview) {
      await drawPage(preview, 0, canvas, { width: 192, turn: 0, ratio: Math.min(2, globalThis.devicePixelRatio || 1) }).done;
      await closePreview(preview);
    }
  };

  render();
}

// @ts-check
/**
 * @file Tool "Photo editor": crop, straighten, turn, mirror, resize and convert a photo, in the browser.
 */
/**
 * The saved copy is drawn fresh from the picture's pixels through the edit's
 * description (editor-doc.mjs), so it carries none of the original file's
 * hidden data. The picture never leaves the browser.
 *
 * Drawing is never done straight from an event: every change marks what has
 * to be redrawn (`invalidate`), and one animation frame redraws it.
 */
import { receiveFiles } from './files.mjs';
import { initSave } from './save.mjs';
import { fillText } from './fill.mjs';
import { fitAspect, handleAt, moveBox, resizeFromHandle, resizeWithRatio } from './box.mjs';
import { commit, createHistory, redo, undo } from './history.mjs';
import { ZOOMS, canEncode, canReadBack, downscale, encode, examplePicture, exportSize, isAnimated, pinchZoom, previewSize, release, stepZoom } from './canvas.mjs';
import { multiply, scale } from './editor-matrix.mjs';
import {
  cleanAngle, cropFromView, cropSize, cropToView, effectiveCrop, emptyDoc, fitCrop, flipDoc, isUnchanged, keepLongSide, limitCrop, orientedSize,
  outputSize, rotatedBounds, turnDoc, wholeMatrix, outputMatrix,
} from './editor-doc.mjs';
import { ADJUSTMENTS, colorPlan, isPlain, noAdjust } from './editor-color.mjs';
import { adjustCanvasNow, drawPhoto, drawVignette, renderDoc } from './editor-render.mjs';

/** @typedef {import('./box.mjs').Box} Box */
/** @typedef {import('./box.mjs').Point} Point */
/** @typedef {import('./box.mjs').Handle} Handle */
/** @typedef {import('./editor-doc.mjs').Doc} Doc */
/** @typedef {import('./editor-doc.mjs').Size} Size */
/** @typedef {import('./history.mjs').History<Doc>} History */
/** @typedef {'crop' | 'resize' | 'adjust' | 'filters'} Tool */
/** @typedef {import('./editor-color.mjs').AdjustKey} AdjustKey */
/** @typedef {import('./editor-color.mjs').PresetKey} PresetKey */
/** @typedef {import('./editor-render.mjs').Rect} Rect */

const MAX_BYTES = 40 * 1024 * 1024;
/** The longest side of the smaller copy the screen is drawn from; the saved copy always uses the full picture. */
const SCREEN_SOURCE = 2400;
/** Smallest crop side on screen, in CSS pixels. */
const MIN_SCREEN = 24;
/** How far an arrow key or a move or resize button changes the crop, in CSS pixels on screen. */
const STEP_SCREEN = 8;
/** The largest number the size fields take; the canvas limit applies after it. */
const MAX_TYPED = 100_000;
/** While a slider is dragged, colours are worked out on a copy of at most this many pixels, then stretched. */
const DRAFT_PIXELS = 500_000;
/** Wait after the quality slider stops before encoding again, in milliseconds. */
const REENCODE_DELAY = 250;

/** Crop proportions offered, width ÷ height. `original` is the picture's own, worked out when needed. */
const RATIOS = /** @type {const} */ ({ '1:1': 1, '4:3': 4 / 3, '3:4': 3 / 4, '3:2': 3 / 2, '2:3': 2 / 3, '16:9': 16 / 9, '9:16': 9 / 16 });
/** @type {Record<string, string>} */
const SWAPPED = { '4:3': '3:4', '3:4': '4:3', '3:2': '2:3', '2:3': '3:2', '16:9': '9:16', '9:16': '16:9' };
/** File types the copy can be saved as, with the file name's ending and the name shown. */
const FORMATS = /** @type {const} */ ({ 'image/jpeg': ['jpg', 'JPEG'], 'image/png': ['png', 'PNG'], 'image/webp': ['webp', 'WebP'] });

/** Which way the pointer looks over each handle. */
const CURSORS = { n: 'ns', s: 'ns', e: 'ew', w: 'ew', nw: 'nwse', se: 'nwse', ne: 'nesw', sw: 'nesw' };

/**
 * The aspect ratio a proportions choice stands for, or null for a free crop.
 * @param {string} choice  'free', 'original' or one of RATIOS.
 * @param {Size} oriented  The turned picture's size.
 */
export function ratioOf(choice, oriented) {
  if (choice === 'original') return oriented.width / oriented.height;
  return RATIOS[/** @type {keyof typeof RATIOS} */ (choice)] ?? null;
}

/**
 * A file size in the units people read: whole kilobytes, or megabytes with one decimal.
 * @param {number} bytes
 * @param {string} lang
 * @returns {{ unit: 'kb' | 'mb', n: string }}
 */
export function fileSize(bytes, lang) {
  const format = (/** @type {number} */ value, /** @type {number} */ digits) => new Intl.NumberFormat(lang || 'en', { maximumFractionDigits: digits }).format(value);
  if (bytes < 1024 * 1024) return { unit: 'kb', n: format(Math.max(1, Math.round(bytes / 1024)), 0) };
  return { unit: 'mb', n: format(bytes / 1024 / 1024, 1) };
}

/**
 * A number typed into a size field, or null when it isn't one.
 * @param {string} text
 */
export function typedSize(text) {
  const value = Math.round(Number(text));
  return Number.isFinite(value) && value >= 1 ? Math.min(MAX_TYPED, value) : null;
}

/**
 * True when the edit on screen was neither saved nor copied, so opening
 * another picture would lose it.
 * @param {History} history
 * @param {boolean} saved
 */
export const unsavedWork = (history, saved) => !saved && !isUnchanged(history.entries[history.index]);

/** @param {HTMLElement} root */
export function init(root) {
  /** @template {Element} T @param {string} name @returns {T} */
  const find = (name) => /** @type {T} */ (root.querySelector(`[data-js="editor-${name}"]`));
  /** @param {string} name */
  const button = (name) => /** @type {HTMLButtonElement} */ (find(name));
  /** @param {string} name */
  const input = (name) => /** @type {HTMLInputElement} */ (find(name));
  const file = input('file');
  const message = /** @type {HTMLElement} */ (find('message'));
  const editor = /** @type {HTMLElement} */ (find('editor'));
  const view = /** @type {HTMLElement} */ (find('view'));
  const canvas = /** @type {HTMLCanvasElement} */ (find('canvas'));
  const status = /** @type {HTMLElement} */ (find('status'));
  const zoomValue = /** @type {HTMLElement} */ (find('zoom-value'));
  const replace = /** @type {HTMLElement} */ (find('replace'));
  const aspect = /** @type {HTMLSelectElement} */ (find('aspect'));
  const sizeNote = /** @type {HTMLElement} */ (find('size-note'));
  const formatNote = /** @type {HTMLElement} */ (find('format-note'));
  const qualityValue = /** @type {HTMLElement} */ (find('quality-value'));
  const result = /** @type {HTMLElement} */ (find('result'));
  const resultCanvas = /** @type {HTMLCanvasElement} */ (find('result-canvas'));
  const resultInfo = /** @type {HTMLElement} */ (find('result-info'));
  const resultStatus = /** @type {HTMLElement} */ (find('result-status'));
  const saveBox = /** @type {HTMLElement} */ (result.querySelector('[data-js="save"]'));
  const save = initSave(saveBox);
  const toolButtons = /** @type {HTMLButtonElement[]} */ ([...root.querySelectorAll('[data-js="editor-tool"]')]);
  const panels = /** @type {HTMLElement[]} */ ([...root.querySelectorAll('[data-js="editor-panel"]')]);
  const formats = /** @type {HTMLInputElement[]} */ ([...root.querySelectorAll('[data-js="editor-format"]')]);
  const longSides = /** @type {HTMLButtonElement[]} */ ([...root.querySelectorAll('[data-js="editor-long"]')]);
  const sliders = /** @type {HTMLInputElement[]} */ ([...root.querySelectorAll('[data-js="editor-adjust"]')]);
  const amounts = /** @type {HTMLInputElement[]} */ ([...root.querySelectorAll('[data-js="editor-adjust-number"]')]);
  const resets = /** @type {HTMLButtonElement[]} */ ([...root.querySelectorAll('[data-js="editor-adjust-reset"]')]);
  const presets = /** @type {HTMLButtonElement[]} */ ([...root.querySelectorAll('[data-js="editor-preset"]')]);
  const lang = document.documentElement?.lang ?? 'en';

  /** @type {ImageBitmap | null} */
  let image = null;
  /** A smaller copy of the picture for the screen, when the picture is much larger than the screen needs. */
  /** @type {HTMLCanvasElement | null} */
  let screenSource = null;
  let name = '';
  /** @type {Tool} */
  let tool = 'crop';
  let zoom = 1;
  let history = createHistory(emptyDoc());
  /** A change in progress (a drag, a slider being moved), not yet a step in the history. */
  /** @type {Doc | null} */
  let draft = null;
  /**
   * @type {null
   *   | { kind: 'move', from: Point, start: Box }
   *   | { kind: 'resize', handle: Handle }
   *   | { kind: 'pan', zoom: number, distance: number }}
   */
  let gesture = null;
  /** @type {Map<number, Point>} */
  const pointers = new Map();
  /** The copy on show, kept so it can be copied and encoded again. @type {{ canvas: HTMLCanvasElement, blob: Blob, type: string, doc: Doc } | null} */
  let output = null;
  /** Counts copies being made: one that is no longer the latest, or whose picture or edit changed meanwhile, is dropped. */
  let makes = 0;
  let saved = false;
  /** @type {File | null} */
  let pending = null;
  /** The browser hands back the real pixels of a canvas (see canReadBack). */
  let readable = true;
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let reencode;
  /** "Hold to see the original" is held down. */
  let comparing = false;
  /** A colour slider is being dragged: colours are worked out on a small copy. */
  let drafting = false;

  const doc = () => draft ?? history.entries[history.index];
  const oriented = () => orientedSize(doc(), /** @type {ImageBitmap} */ (image));
  const ratio = () => (image ? ratioOf(aspect.value, oriented()) : null);
  const type = () => formats.find((format) => format.checked)?.value ?? 'image/jpeg';
  const quality = () => Number(input('quality').value) / 100;

  /* ---------- Drawing ---------- */

  /**
   * What has to be redrawn at the next frame. Three layers, each redrawn only
   * when what it shows changed: the photo through the geometry; the photo with
   * its colours; and on screen, that plus the vignette, the crop frame and handles.
   */
  const stale = { photo: false, adjusted: false, screen: false };
  let frame = 0;
  /** The photo as the screen shows it, before colours, outlines and handles. */
  const photo = document.createElement('canvas');
  /** The photo with its colours, soften and sharpen; while a slider is dragged, a smaller copy. */
  const adjusted = document.createElement('canvas');
  /** What the screen layer starts from: the photo, or the adjusted copy. */
  /** @type {HTMLCanvasElement} */
  let shown = photo;
  /** The colour plan of the last description asked for, kept: working it out takes a few hundred steps. */
  /** @type {{ key: string, plan: import('./editor-color.mjs').ColorPlan } | null} */
  let planned = null;

  /** @param {'photo' | 'adjusted' | 'screen'} stage  Each includes the ones after it. */
  const invalidate = (stage) => {
    if (stage === 'photo') stale.photo = true;
    if (stage !== 'screen') stale.adjusted = true;
    stale.screen = true;
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      draw();
    });
  };

  /** Size of the screen canvas: the box around the straightened picture while cropping, else the copy. */
  const stageSize = () => {
    if (!image) return { width: 1, height: 1 };
    if (tool === 'crop') {
      const bounds = rotatedBounds(oriented(), doc().angle);
      return previewSize(Math.round(bounds.width), Math.round(bounds.height), zoom);
    }
    const size = outputSize(doc(), image);
    return previewSize(size.width, size.height, zoom);
  };

  /** Draws the picture onto the photo layer through a matrix, from the smaller copy when that has detail enough. */
  const drawPicture = (/** @type {import('./editor-matrix.mjs').Matrix} */ matrix) => {
    const picture = /** @type {ImageBitmap} */ (image);
    const needed = Math.sqrt(Math.abs(matrix[0] * matrix[3] - matrix[1] * matrix[2]));
    if (screenSource && needed <= screenSource.width / picture.width) {
      drawPhoto(photo, screenSource, multiply(matrix, scale(picture.width / screenSource.width, picture.height / screenSource.height)), { jpeg: false });
    } else {
      drawPhoto(photo, picture, matrix, { jpeg: false });
    }
  };

  const draw = () => {
    if (!image) return;
    if (stale.photo) {
      const size = stageSize();
      if (photo.width !== size.width || photo.height !== size.height) Object.assign(photo, size);
      drawPicture(tool === 'crop' ? wholeMatrix(doc(), image, photo) : outputMatrix(doc(), image, photo));
    }
    if (stale.adjusted) refreshAdjusted();
    stale.photo = false;
    stale.adjusted = false;
    stale.screen = false;
    if (canvas.width !== photo.width || canvas.height !== photo.height) Object.assign(canvas, { width: photo.width, height: photo.height });
    const context = /** @type {CanvasRenderingContext2D} */ (canvas.getContext('2d'));
    context.clearRect(0, 0, canvas.width, canvas.height);
    if (comparing) {
      context.drawImage(photo, 0, 0);
    } else {
      context.drawImage(shown, 0, 0, canvas.width, canvas.height);
      const { vignette } = plan();
      if (vignette) drawVignette(context, copyFrame(canvas), vignette);
    }
    if (tool === 'crop') drawCropFrame(context);
    showState();
  };

  /** The colour plan of the description on screen. */
  const plan = () => {
    const { adjust, preset } = doc();
    const key = JSON.stringify([adjust, preset]);
    if (planned?.key !== key) planned = { key, plan: colorPlan(adjust, preset) };
    return planned.plan;
  };

  /** Where the copy lies on a canvas the size of the screen's: the crop frame while cropping, else all of it. @param {{ width: number, height: number }} on @returns {Rect} */
  const copyFrame = ({ width, height }) => {
    if (tool !== 'crop') return { x: 0, y: 0, w: width, h: height };
    const box = cropBox();
    return { x: box.x * width, y: box.y * height, w: box.w * width, h: box.h * height };
  };

  /**
   * The photo layer with its colours, soften and sharpen. The vignette is
   * drawn on the screen layer instead, so it follows the crop frame as it moves.
   */
  const refreshAdjusted = () => {
    const { vignette, ...rest } = plan();
    const pixels = { ...rest, vignette: 0 };
    if (isPlain(pixels)) {
      shown = photo;
      return;
    }
    // While a slider is dragged, a small copy keeps every frame quick; it is stretched to fit.
    const factor = drafting ? Math.min(1, Math.sqrt(DRAFT_PIXELS / (photo.width * photo.height))) : 1;
    const size = { width: Math.max(1, Math.round(photo.width * factor)), height: Math.max(1, Math.round(photo.height * factor)) };
    if (adjusted.width !== size.width || adjusted.height !== size.height) Object.assign(adjusted, size);
    const context = /** @type {CanvasRenderingContext2D} */ (adjusted.getContext('2d'));
    context.clearRect(0, 0, size.width, size.height);
    context.drawImage(photo, 0, 0, size.width, size.height);
    const frameOn = copyFrame(size);
    adjustCanvasNow(adjusted, pixels, { longSide: Math.max(frameOn.w, frameOn.h) });
    shown = adjusted;
  };

  /** The crop frame, the shade around it, its handles, and thirds while it is being dragged. @param {CanvasRenderingContext2D} context */
  const drawCropFrame = (context) => {
    const box = cropBox();
    const [x, y, w, h] = [box.x * canvas.width, box.y * canvas.height, box.w * canvas.width, box.h * canvas.height];
    // Canvas pixels per screen pixel, so lines and handles look the same at every zoom and picture size.
    const ratio = canvas.width / (canvas.getBoundingClientRect().width || canvas.width);
    const line = 1.5 * ratio;
    const accent = getComputedStyle(root).getPropertyValue('--color-focus').trim() || '#0e6a69';
    context.fillStyle = 'rgba(0, 0, 0, 0.6)';
    context.fillRect(0, 0, canvas.width, y);
    context.fillRect(0, y + h, canvas.width, canvas.height - y - h);
    context.fillRect(0, y, x, h);
    context.fillRect(x + w, y, canvas.width - x - w, h);
    if (gesture && gesture.kind !== 'pan') {
      context.strokeStyle = 'rgba(255, 255, 255, 0.8)';
      context.lineWidth = line;
      context.beginPath();
      for (const part of [1 / 3, 2 / 3]) {
        context.moveTo(x + w * part, y);
        context.lineTo(x + w * part, y + h);
        context.moveTo(x, y + h * part);
        context.lineTo(x + w, y + h * part);
      }
      context.stroke();
    }
    // A line that shows on both light and dark pictures.
    context.lineWidth = line * 2;
    context.strokeStyle = '#fff';
    context.strokeRect(x, y, w, h);
    context.lineWidth = line;
    context.strokeStyle = accent;
    context.strokeRect(x, y, w, h);
    const side = 10 * ratio;
    context.fillStyle = '#fff';
    for (const hx of [x, x + w / 2, x + w]) {
      for (const hy of [y, y + h / 2, y + h]) {
        if (hx === x + w / 2 && hy === y + h / 2) continue;
        context.fillRect(hx - side / 2, hy - side / 2, side, side);
        context.strokeRect(hx - side / 2, hy - side / 2, side, side);
      }
    }
  };

  /** Fills in values and turns controls on or off to match the edit. */
  const showState = () => {
    if (!image) return;
    const current = doc();
    const size = outputSize(current, image);
    const crop = cropSize(current, image);
    status.textContent = fillText(status.dataset.template, { w: String(size.width), h: String(size.height) });
    button('undo').disabled = history.index === 0;
    button('redo').disabled = history.index === history.entries.length - 1;
    button('reset').disabled = isUnchanged(history.entries[history.index]);
    button('zoom-out').disabled = zoom === ZOOMS[0];
    button('zoom-in').disabled = zoom === ZOOMS[ZOOMS.length - 1];
    zoomValue.textContent = `${Math.round(zoom * 100)}%`;
    toolButtons.forEach((other) => other.setAttribute('aria-pressed', String(other.dataset.tool === tool)));
    panels.forEach((panel) => {
      panel.hidden = panel.dataset.tool !== tool;
    });
    // Fields keep what the visitor is typing.
    /** @param {string} field @param {number | string} value */
    const show = (field, value) => {
      const element = input(field);
      if (element !== document.activeElement) element.value = String(value);
    };
    show('angle', current.angle);
    show('angle-number', current.angle);
    show('width', size.width);
    show('height', size.height);
    show('percent', Math.round((size.width / crop.width) * 100));
    button('angle-reset').disabled = current.angle === 0;
    button('uncrop').disabled = current.crop === null;
    button('aspect-swap').disabled = !(aspect.value in SWAPPED);
    button('original').disabled = current.size === null;
    const enlarged = size.width > crop.width || size.height > crop.height;
    const limited = exportSize(current.size?.width ?? crop.width, current.size?.height ?? crop.height).scaled;
    sizeNote.textContent = [enlarged ? sizeNote.dataset.enlarged : '', limited ? fillText(sizeNote.dataset.limit, { w: String(size.width), h: String(size.height) }) : ''].filter(Boolean).join(' ');
    input('quality').disabled = type() === 'image/png';
    qualityValue.textContent = input('quality').value;
    button('create').disabled = !readable;
    for (const [key] of ADJUSTMENTS) {
      for (const field of [...sliders, ...amounts]) if (field.dataset.key === key && field !== document.activeElement) field.value = String(current.adjust[key]);
    }
    resets.forEach((reset) => {
      reset.disabled = current.adjust[/** @type {AdjustKey} */ (reset.dataset.key)] === 0;
    });
    button('reset-all').disabled = ADJUSTMENTS.every(([key]) => current.adjust[key] === 0);
    presets.forEach((other) => other.setAttribute('aria-pressed', String(other.dataset.preset === current.preset)));
    button('compare').disabled = isPlain(plan());
  };

  /* ---------- Changes ---------- */

  const hideResult = () => {
    clearTimeout(reencode);
    if (output) release(output.canvas);
    output = null;
    if (result.hidden) return;
    result.hidden = true;
    save.clear();
  };

  /**
   * A finished change: a new step in the history.
   * @param {Doc} next
   * @param {string} [tag]  Steps with the same tag in a row count as one (see commit).
   * @param {'photo' | 'adjusted' | 'screen'} [stage]  What the change affects: the geometry, only the colours, or only what lies on top.
   */
  const apply = (next, tag = '', stage = 'photo') => {
    draft = null;
    drafting = false;
    if (JSON.stringify(next) === JSON.stringify(history.entries[history.index])) {
      invalidate(stage);
      return;
    }
    history = commit(history, next, tag);
    saved = false;
    hideResult();
    invalidate(stage);
  };

  /** @param {(history: History) => History} step */
  const travel = (step) => {
    history = step(history);
    draft = null;
    saved = false;
    hideResult();
    invalidate('photo');
  };

  /**
   * The same edit with another crop. A chosen size keeps its longer side and takes the crop's proportions.
   * @param {Doc} from
   * @param {Partial<Doc>} change
   * @returns {Doc}
   */
  const recrop = (from, change) => {
    const next = { ...from, ...change };
    return next.size && image ? { ...next, size: keepLongSide(next.size, cropSize(next, image)) } : next;
  };

  /** The crop as a box on the screen canvas while cropping, in fractions of it. */
  const cropBox = () => cropToView(effectiveCrop(doc(), /** @type {ImageBitmap} */ (image)), doc().angle, oriented());

  /**
   * What a new crop changes on screen. While cropping, the whole picture is shown
   * whatever the crop, so only the frame moves; soften and sharpen are measured
   * against the frame's size, though, so with those on, the colours too.
   */
  const cropStage = () => (tool === 'crop' && !plan().soften && !plan().sharpen ? 'screen' : 'photo');

  /** The screen box back to a crop, going only as far as the picture allows. @param {Box} box */
  const placeCrop = (box) => {
    const current = doc();
    const size = oriented();
    const from = effectiveCrop(current, /** @type {ImageBitmap} */ (image));
    return recrop(current, { crop: limitCrop(from, cropFromView(box, current.angle, size), current.angle, size) });
  };

  /** Width ÷ height of the screen canvas while cropping. */
  const viewAspect = () => {
    const bounds = rotatedBounds(oriented(), doc().angle);
    return bounds.width / bounds.height;
  };

  /** A handle dragged to a point, with the chosen proportions kept. @param {Box} box @param {Handle} handle @param {Point} point */
  const dragHandle = (box, handle, point) => {
    const wanted = ratio();
    return wanted === null ? resizeFromHandle(box, handle, point, minBox()) : resizeWithRatio(box, handle, point, wanted, viewAspect(), minBox());
  };

  /** @param {Tool} next */
  const setTool = (next) => {
    tool = next;
    invalidate('photo');
  };

  /** @param {number} next */
  const setZoom = (next) => {
    if (!image || next === zoom) return;
    // Keep the middle of what is on screen in the middle.
    const [cx, cy] = [(view.scrollLeft + view.clientWidth / 2) / view.scrollWidth, (view.scrollTop + view.clientHeight / 2) / view.scrollHeight];
    zoom = next;
    view.dataset.zoom = String(zoom);
    draw();
    stale.photo = true;
    draw();
    view.scrollLeft = cx * view.scrollWidth - view.clientWidth / 2;
    view.scrollTop = cy * view.scrollHeight - view.clientHeight / 2;
  };

  /**
   * A proportions choice: the largest crop of that shape in the middle of the picture.
   * @param {string} choice
   */
  const chooseAspect = (choice) => {
    aspect.value = choice;
    const wanted = ratio();
    if (!image || wanted === null) {
      invalidate('screen');
      return;
    }
    const current = doc();
    const size = oriented();
    const whole = cropToView(fitCrop({ x: 0, y: 0, w: 1, h: 1 }, current.angle, size), current.angle, size);
    const box = fitAspect(whole, wanted, viewAspect());
    apply(recrop(current, { crop: fitCrop(cropFromView(box, current.angle, size), current.angle, size) }));
  };

  /* ---------- Opening a picture ---------- */

  /** @param {File} chosen */
  const open = async (chosen) => {
    // An edit that wasn't saved would be lost: ask first, in the page.
    if (image && unsavedWork(history, saved)) {
      pending = chosen;
      replace.hidden = false;
      // The safe answer has the focus: Enter or Space must not throw the work away.
      button('replace-no').focus();
      return;
    }
    pending = null;
    replace.hidden = true;
    image?.close();
    image = null;
    if (screenSource) release(screenSource);
    screenSource = null;
    editor.hidden = true;
    hideResult();
    message.textContent = '';
    if (chosen.size > MAX_BYTES) {
      message.textContent = message.dataset.tooLarge ?? '';
      return;
    }
    let moving = false;
    try {
      moving = isAnimated(new Uint8Array(await chosen.arrayBuffer()));
      image = await createImageBitmap(chosen);
    } catch (error) {
      console.warn('[lockwell] The chosen file could not be opened as an image.', error);
      message.textContent = message.dataset.unsupported ?? '';
      return;
    }
    name = chosen.name;
    const longest = Math.max(image.width, image.height);
    if (longest > SCREEN_SOURCE) {
      const factor = SCREEN_SOURCE / longest;
      screenSource = downscale(image, Math.max(1, Math.round(image.width * factor)), Math.max(1, Math.round(image.height * factor)));
    }
    readable = canReadBack();
    const size = exportSize(image.width, image.height);
    message.textContent = [
      readable ? '' : (message.dataset.blocked ?? ''),
      size.scaled ? fillText(message.dataset.resized, { w: String(size.width), h: String(size.height) }) : '',
      moving ? (message.dataset.animated ?? '') : '',
    ]
      .filter(Boolean)
      .join(' ');
    // PNG stays PNG (screenshots keep sharp text); everything else is offered as JPEG.
    const keep = chosen.type === 'image/png' ? 'image/png' : 'image/jpeg';
    formats.forEach((format) => {
      format.checked = format.value === keep;
    });
    history = createHistory(emptyDoc());
    draft = null;
    saved = false;
    aspect.value = 'free';
    tool = 'crop';
    zoom = 1;
    view.dataset.zoom = '1';
    editor.hidden = false;
    invalidate('photo');
  };

  file.addEventListener('change', () => {
    const chosen = file.files?.[0];
    if (chosen) open(chosen);
  });
  receiveFiles(root, open, { paste: true });
  button('replace-yes').addEventListener('click', () => {
    const next = pending;
    saved = true; // The visitor chose to let the edit go.
    if (next) open(next);
  });
  button('replace-no').addEventListener('click', () => {
    pending = null;
    replace.hidden = true;
    // Forget the file that wasn't opened: its name no longer shows, and choosing it again fires a change.
    file.value = '';
    canvas.focus();
  });
  button('example').addEventListener('click', async () => {
    try {
      open(new File([await examplePicture()], 'example.png', { type: 'image/png' }));
    } catch (error) {
      console.error('[lockwell] Could not make the example picture.', error);
    }
  });

  /* ---------- Pointer ---------- */

  /** The distance between the first two fingers on the canvas. */
  const spread = () => {
    const [a, b] = [...pointers.values()];
    return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
  };
  /** Where a pointer is, as fractions of the canvas. @param {PointerEvent} event */
  const point = (event) => {
    const area = canvas.getBoundingClientRect();
    return { x: (event.clientX - area.left) / area.width, y: (event.clientY - area.top) / area.height };
  };
  /** A distance on screen as fractions of the canvas. @param {number} pixels  CSS pixels. */
  const onScreen = (pixels) => {
    const area = canvas.getBoundingClientRect();
    return { x: pixels / (area.width || canvas.width || 1), y: pixels / (area.height || canvas.height || 1) };
  };
  const minBox = () => onScreen(MIN_SCREEN);
  /** How close to a handle counts: 24 px across for a mouse (WCAG 2.5.8), more for a fingertip. @param {PointerEvent} event */
  const reach = (event) => onScreen(event.pointerType === 'mouse' ? 12 : 20);
  /** @param {Box} box @param {Point} at */
  const inside = (box, at) => at.x >= box.x && at.x <= box.x + box.w && at.y >= box.y && at.y <= box.y + box.h;

  canvas.addEventListener('pointerdown', (event) => {
    // Only a left button, a pen or a finger: a right-click's release may never reach the canvas.
    if (!image || event.button !== 0) return;
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    try {
      canvas.setPointerCapture(event.pointerId);
    } catch (error) {
      console.warn('[lockwell] Could not follow this pointer outside the picture.', error);
    }
    if (pointers.size > 1) {
      // A second finger: this is a pan or a pinch.
      draft = null;
      gesture = { kind: 'pan', zoom, distance: spread() };
      invalidate('photo');
      return;
    }
    if (!event.isPrimary || tool !== 'crop') return;
    const at = point(event);
    const box = cropBox();
    const handle = handleAt(box, at, reach(event));
    if (handle) gesture = { kind: 'resize', handle };
    else if (inside(box, at)) gesture = { kind: 'move', from: at, start: box };
    invalidate('screen');
  });

  canvas.addEventListener('pointermove', (event) => {
    if (!image) return;
    const at = point(event);
    if (!gesture) {
      // Show what a press here would do.
      if (tool !== 'crop') return;
      const box = cropBox();
      const handle = handleAt(box, at, reach(event));
      canvas.dataset.cursor = handle ? CURSORS[handle] : inside(box, at) ? 'move' : '';
      return;
    }
    const before = pointers.get(event.pointerId);
    if (before) pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (gesture.kind === 'pan') {
      // Each finger contributes half, so two fingers moving together pan one to one.
      if (before) view.scrollBy((before.x - event.clientX) / 2, (before.y - event.clientY) / 2);
      if (pointers.size < 2) return;
      const next = pinchZoom(gesture.zoom, gesture.distance, spread());
      if (next !== zoom) setZoom(next);
      return;
    }
    if (gesture.kind === 'move') {
      draft = placeCrop(moveBox(gesture.start, at.x - gesture.from.x, at.y - gesture.from.y));
    } else {
      draft = placeCrop(dragHandle(cropBox(), gesture.handle, at));
    }
    invalidate('screen');
  });

  /** @param {PointerEvent} event */
  const endGesture = (event) => {
    pointers.delete(event.pointerId);
    const ended = gesture;
    if (!ended) return;
    if (ended.kind === 'pan') {
      if (pointers.size === 0) gesture = null;
      return;
    }
    gesture = null;
    const finished = event.type === 'pointerup' ? draft : null;
    if (finished) {
      apply(finished, '', cropStage());
    } else {
      // An interrupted drag: nothing changes.
      draft = null;
      invalidate('screen');
    }
  };
  canvas.addEventListener('pointerup', endGesture);
  canvas.addEventListener('pointercancel', endGesture);
  // Capture lost without a release (the tab hid, the element changed): the pointer is gone all the same.
  canvas.addEventListener('lostpointercapture', endGesture);

  /* ---------- Keyboard and buttons ---------- */

  /**
   * Moves or resizes the crop by one step: from the arrow keys, and from the
   * buttons for those who can't drag.
   * @param {number} x  -1, 0 or 1.
   * @param {number} y
   * @param {boolean} resize
   */
  const nudge = (x, y, resize) => {
    if (!image) return;
    const step = onScreen(STEP_SCREEN);
    const box = cropBox();
    const [dx, dy] = [x * step.x, y * step.y];
    const next = resize ? dragHandle(box, dx ? 'e' : 's', { x: box.x + box.w + dx, y: box.y + box.h + dy }) : moveBox(box, dx, dy);
    apply(placeCrop(next), resize ? 'resize' : 'move', cropStage());
  };

  const removeCrop = () => {
    aspect.value = 'free';
    apply(recrop(doc(), { crop: null }));
  };

  /** @param {1 | -1} direction */
  const turnPicture = (direction) => {
    // The frame turns with the picture, so fixed proportions turn too.
    if (aspect.value in SWAPPED) aspect.value = SWAPPED[aspect.value];
    apply(turnDoc(doc(), direction));
  };

  /** @param {number} angle  Degrees. @param {boolean} done  False while a slider is still being dragged. */
  const straighten = (angle, done) => {
    const next = recrop(history.entries[history.index], { angle: cleanAngle(angle) });
    if (done) {
      apply(next, 'angle');
    } else {
      draft = next;
      invalidate('photo');
    }
  };

  /** @param {Size | null} size */
  const resize = (size) => apply({ ...doc(), size });

  canvas.addEventListener('keydown', (event) => {
    const arrows = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    // Key positions, not letters: the shortcut is the same on a Georgian keyboard.
    if ((event.ctrlKey || event.metaKey) && (event.code === 'KeyZ' || event.code === 'KeyY')) {
      travel(event.code === 'KeyY' || event.shiftKey ? redo : undo);
    } else if (event.ctrlKey || event.metaKey || event.altKey) {
      return;
    } else if (event.key in arrows && tool === 'crop') {
      const [x, y] = arrows[/** @type {keyof typeof arrows} */ (event.key)];
      nudge(x, y, event.shiftKey);
    } else if ((event.key === 'Delete' || event.key === 'Backspace') && tool === 'crop') {
      removeCrop();
    } else if (event.key === '+' || event.key === '=') {
      setZoom(stepZoom(zoom, 1));
    } else if (event.key === '-') {
      setZoom(stepZoom(zoom, -1));
    } else {
      return;
    }
    event.preventDefault();
  });

  toolButtons.forEach((other) => other.addEventListener('click', () => setTool(/** @type {Tool} */ (other.dataset.tool))));
  button('undo').addEventListener('click', () => travel(undo));
  button('redo').addEventListener('click', () => travel(redo));
  button('reset').addEventListener('click', () => {
    aspect.value = 'free';
    apply(emptyDoc());
  });
  button('zoom-in').addEventListener('click', () => setZoom(stepZoom(zoom, 1)));
  button('zoom-out').addEventListener('click', () => setZoom(stepZoom(zoom, -1)));
  button('rotate-left').addEventListener('click', () => turnPicture(-1));
  button('rotate-right').addEventListener('click', () => turnPicture(1));
  button('flip-h').addEventListener('click', () => apply(flipDoc(doc(), 'x')));
  button('flip-v').addEventListener('click', () => apply(flipDoc(doc(), 'y')));
  input('angle').addEventListener('input', () => straighten(Number(input('angle').value), false));
  input('angle').addEventListener('change', () => straighten(Number(input('angle').value), true));
  input('angle-number').addEventListener('change', () => straighten(Number(input('angle-number').value), true));
  button('angle-reset').addEventListener('click', () => straighten(0, true));
  aspect.addEventListener('change', () => chooseAspect(aspect.value));
  button('aspect-swap').addEventListener('click', () => {
    if (aspect.value in SWAPPED) chooseAspect(SWAPPED[aspect.value]);
  });
  button('uncrop').addEventListener('click', removeCrop);
  for (const [control, x, y, grow] of /** @type {const} */ ([
    ['move-left', -1, 0, false], ['move-right', 1, 0, false], ['move-up', 0, -1, false], ['move-down', 0, 1, false],
    ['narrower', -1, 0, true], ['wider', 1, 0, true], ['shorter', 0, -1, true], ['taller', 0, 1, true],
  ])) {
    button(control).addEventListener('click', () => nudge(x, y, grow));
  }

  /* ---------- Colours ---------- */

  /**
   * A slider's new value: while it is dragged, a draft worked out on a small
   * copy; once let go (or typed), a step in the history.
   * @param {AdjustKey} key
   * @param {number} value
   * @param {boolean} done
   */
  const setAdjust = (key, value, done) => {
    const min = ADJUSTMENTS.find(([name]) => name === key)?.[1] ?? 0;
    const current = history.entries[history.index];
    const clean = Number.isFinite(value) ? Math.round(Math.min(100, Math.max(min, value))) : 0;
    const next = { ...current, adjust: { ...current.adjust, [key]: clean } };
    if (done) {
      apply(next, `adjust:${key}`, 'adjusted');
    } else {
      draft = next;
      drafting = true;
      invalidate('adjusted');
    }
  };

  sliders.forEach((slider) => {
    const key = /** @type {AdjustKey} */ (slider.dataset.key);
    slider.addEventListener('input', () => setAdjust(key, Number(slider.value), false));
    slider.addEventListener('change', () => setAdjust(key, Number(slider.value), true));
    // A double-click puts one slider back to 0.
    slider.addEventListener('dblclick', () => setAdjust(key, 0, true));
  });
  amounts.forEach((amount) => amount.addEventListener('change', () => setAdjust(/** @type {AdjustKey} */ (amount.dataset.key), Number(amount.value), true)));
  resets.forEach((reset) => reset.addEventListener('click', () => setAdjust(/** @type {AdjustKey} */ (reset.dataset.key), 0, true)));
  button('reset-all').addEventListener('click', () => apply({ ...history.entries[history.index], adjust: noAdjust() }, '', 'adjusted'));
  presets.forEach((other) =>
    other.addEventListener('click', () => apply({ ...history.entries[history.index], preset: /** @type {PresetKey} */ (other.dataset.preset) }, '', 'adjusted')),
  );

  // "Hold to see the original": the same picture without colours, as long as it is pressed, by pointer or by Space.
  const compare = button('compare');
  /** @param {boolean} on */
  const setComparing = (on) => {
    if (comparing === on) return;
    comparing = on;
    invalidate('screen');
  };
  compare.addEventListener('pointerdown', () => setComparing(true));
  for (const type of ['pointerup', 'pointerleave', 'pointercancel', 'blur']) compare.addEventListener(type, () => setComparing(false));
  compare.addEventListener('keydown', (event) => {
    if (event.key === ' ' || event.key === 'Enter') {
      event.preventDefault();
      setComparing(true);
    }
  });
  compare.addEventListener('keyup', (event) => {
    if (event.key === ' ' || event.key === 'Enter') setComparing(false);
  });

  /* ---------- Size ---------- */

  /** A typed width or height; with the proportions locked the other side follows the crop's. @param {'width' | 'height'} side */
  const typeSide = (side) => {
    if (!image) return;
    const value = typedSize(input(side).value);
    if (value === null) {
      invalidate('screen'); // Shows the current size again.
      return;
    }
    const crop = cropSize(doc(), image);
    const current = outputSize(doc(), image);
    const other = side === 'width' ? 'height' : 'width';
    const follows = input('lock').checked ? Math.max(1, Math.round((value * crop[other]) / crop[side])) : current[other];
    resize(/** @type {Size} */ ({ [side]: value, [other]: follows }));
  };
  input('width').addEventListener('change', () => typeSide('width'));
  input('height').addEventListener('change', () => typeSide('height'));
  input('percent').addEventListener('change', () => {
    if (!image) return;
    const percent = typedSize(input('percent').value);
    if (percent === null) {
      invalidate('screen');
      return;
    }
    const crop = cropSize(doc(), image);
    resize({ width: Math.max(1, Math.round((crop.width * percent) / 100)), height: Math.max(1, Math.round((crop.height * percent) / 100)) });
  });
  longSides.forEach((other) =>
    other.addEventListener('click', () => {
      if (!image) return;
      const longest = Number(other.dataset.size);
      resize(keepLongSide({ width: longest, height: longest }, cropSize(doc(), image)));
    }),
  );
  button('original').addEventListener('click', () => resize(null));

  /* ---------- Saving ---------- */

  /**
   * Makes the copy: drawn at full size, encoded, then decoded again, and that
   * decoded file is what the result shows.
   * @param {boolean} redraw  False to encode the copy on show again (another quality) without drawing it again.
   */
  const makeCopy = async (redraw) => {
    if (!image || !readable) return;
    const [ticket, picture, steps] = [++makes, image, history];
    const isStale = () => ticket !== makes || image !== picture || history !== steps;
    const current = history.entries[history.index];
    const wanted = type();
    const size = outputSize(current, picture);
    const made = !redraw && output ? output.canvas : document.createElement('canvas');
    resultStatus.textContent = '';
    if (message.textContent === message.dataset.encodeFailed) message.textContent = '';
    /** @type {Blob} */
    let blob;
    try {
      if (made !== output?.canvas) {
        Object.assign(made, { width: size.width, height: size.height });
        // Read back band by band: kept in ordinary memory, or each read waits for the graphics card.
        made.getContext('2d', { willReadFrequently: true });
        // In bands with pauses: a large picture never freezes the page. Stops early if the edit changes meanwhile.
        if (!(await renderDoc(made, picture, current, { jpeg: wanted === 'image/jpeg', stop: isStale }))) throw new Error('stale');
      }
      blob = await encode(made, wanted, quality());
      if (blob.type !== wanted) throw new Error(`The browser wrote ${blob.type || 'nothing'} instead of ${wanted}.`);
      // Show the encoded file itself, not the editor's idea of it.
      const decoded = await createImageBitmap(blob);
      try {
        if (decoded.width !== size.width || decoded.height !== size.height) throw new Error(`The copy opened at ${decoded.width} × ${decoded.height}, not ${size.width} × ${size.height}.`);
        if (isStale()) throw new Error('stale');
        Object.assign(resultCanvas, previewSize(decoded.width, decoded.height, 1));
        resultCanvas.getContext('2d')?.drawImage(decoded, 0, 0, resultCanvas.width, resultCanvas.height);
      } finally {
        decoded.close();
      }
    } catch (error) {
      if (made !== output?.canvas) release(made);
      if (isStale()) return;
      console.error('[lockwell] The edited copy could not be created.', error);
      hideResult();
      message.textContent = message.dataset.encodeFailed ?? '';
      return;
    }
    if (output && output.canvas !== made) release(output.canvas);
    output = { canvas: made, blob, type: wanted, doc: current };
    const [extension, label] = FORMATS[/** @type {keyof typeof FORMATS} */ (wanted)];
    const bytes = fileSize(blob.size, lang);
    resultInfo.textContent = `${size.width} × ${size.height} · ${label} · ${fillText(resultInfo.dataset[bytes.unit], { n: bytes.n })}`;
    save.offer({ blob, original: name, extension, fallback: 'image', suffix: 'edited' });
    const opening = result.hidden;
    result.hidden = false;
    // Not while the visitor is answering whether to open another picture, nor when only the quality changed.
    if (opening && replace.hidden) result.focus();
  };

  button('create').addEventListener('click', () => makeCopy(true));
  formats.forEach((format) =>
    format.addEventListener('change', () => {
      invalidate('screen');
      if (output) makeCopy(true);
    }),
  );
  input('quality').addEventListener('input', () => {
    qualityValue.textContent = input('quality').value;
    clearTimeout(reencode);
    if (output) reencode = setTimeout(() => makeCopy(false), REENCODE_DELAY);
  });

  const copyButton = button('copy');
  copyButton.addEventListener('click', async () => {
    if (!output) return;
    const copy = output;
    let copied = true;
    try {
      // The promise form keeps the copy inside this click on Safari. Clipboards take PNG.
      const png = copy.type === 'image/png' ? Promise.resolve(copy.blob) : encode(copy.canvas, 'image/png');
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': png })]);
    } catch (error) {
      console.warn('[lockwell] Could not copy the image to the clipboard.', error);
      copied = false;
    }
    if (copied) saved = true;
    resultStatus.textContent = (copied ? copyButton.dataset.done : copyButton.dataset.failed) ?? '';
  });
  // Saving or sharing counts as keeping the work, as far as the page can tell.
  for (const control of ['save-download', 'save-share']) {
    saveBox.querySelector(`[data-js="${control}"]`)?.addEventListener('click', () => {
      saved = true;
    });
  }

  // Formats this browser can't write stay in the list, switched off, with a line saying why.
  const webp = formats.find((format) => format.value === 'image/webp');
  if (webp) {
    webp.disabled = true;
    canEncode('image/webp').then((can) => {
      webp.disabled = !can;
      formatNote.textContent = can ? '' : (formatNote.dataset.noWebp ?? '');
    });
  }
}

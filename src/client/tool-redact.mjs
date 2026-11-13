// @ts-check
/**
 * @file Tool "Image redaction": covers parts of a picture with solid blocks and crops it.
 */
/**
 * Image redaction: cover parts of a photo or screenshot with solid shapes
 * (boxes, ellipses, a freehand marker), crop it, check the result and save.
 *
 * The saved copy is drawn fresh from the picture's pixels with the shapes
 * painted over them, so nothing remains underneath and none of the original
 * file's hidden data is carried over. Shapes are solid on purpose: blur and
 * pixelation can sometimes be reversed. The image never leaves the browser.
 */
import { receiveFiles } from './files.mjs';

/**
 * A rectangle as fractions of the image (0 to 1), so it means the same on
 * the small preview and on the full-size copy.
 * @typedef {{ x: number, y: number, w: number, h: number }} Box
 */
/** @typedef {{ x: number, y: number }} Point */
/** @typedef {Box & { type: 'box' | 'ellipse' }} Area */
/**
 * A freehand stroke.
 * @typedef {{ type: 'line', points: Point[], size: number }} Line  `size`: thickness as a fraction of the image's width.
 */
/** @typedef {Area | Line} Shape */
/** @typedef {{ shapes: Shape[], crop: Box | null }} Drawing */
/** @typedef {'nw' | 'ne' | 'se' | 'sw' | 'n' | 'e' | 's' | 'w'} Handle */
/**
 * The part of the image (in image pixels) that is drawn onto a canvas of
 * `width` × `height`.
 * @typedef {{ sx: number, sy: number, sw: number, sh: number, width: number, height: number }} Frame
 */
/** @typedef {{ entries: Drawing[], index: number, tag: string }} History */
/** @typedef {'box' | 'ellipse' | 'marker' | 'crop'} Mode */

/** Smallest box side, as a fraction of the image: smaller drags are slips, not boxes. */
const MIN_SIDE = 0.01;
/** How far an arrow key moves or resizes the selected shape. */
const KEY_STEP = 0.01;
/** Browsers refuse or mangle canvases beyond this many pixels (about 16 megapixels on iPhones). */
const MAX_PIXELS = 16_000_000;
const MAX_BYTES = 40 * 1024 * 1024;
/** Width of the editing preview at 100% zoom; the saved copy always uses the full image. */
const PREVIEW_WIDTH = 1600;
const PREVIEW_PIXELS = 8_000_000;
export const ZOOMS = [1, 1.5, 2, 3, 4];
const HISTORY_LIMIT = 100;
/** Rounding slack: 0.3 × 1000 is 300.00000000000006, which must not count as a 301st pixel. */
const TOLERANCE = 1e-6;

/** @param {number} value */
const clamp = (value) => Math.min(1, Math.max(0, value));

/* ---------- Geometry ---------- */

/**
 * The box between two corners of a drag, kept inside the image.
 * @param {Point} from
 * @param {Point} to
 * @returns {Box | null}  null when the drag was too small to be a box.
 */
export function boxFromDrag(from, to) {
  const [x1, x2] = [clamp(Math.min(from.x, to.x)), clamp(Math.max(from.x, to.x))];
  const [y1, y2] = [clamp(Math.min(from.y, to.y)), clamp(Math.max(from.y, to.y))];
  const box = { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
  return box.w >= MIN_SIDE && box.h >= MIN_SIDE ? box : null;
}

/**
 * @template {Box} T
 * @param {T} box
 * @param {number} dx
 * @param {number} dy
 * @returns {T}  The same size, moved but not past the image's edges.
 */
export function moveBox(box, dx, dy) {
  return { ...box, x: Math.min(1 - box.w, Math.max(0, box.x + dx)), y: Math.min(1 - box.h, Math.max(0, box.y + dy)) };
}

/**
 * @template {Box} T
 * @param {T} box
 * @param {number} dw
 * @param {number} dh
 * @returns {T}  The same corner, resized between the smallest size and the image's edge.
 */
export function resizeBox(box, dw, dh) {
  return { ...box, w: Math.min(1 - box.x, Math.max(MIN_SIDE, box.w + dw)), h: Math.min(1 - box.y, Math.max(MIN_SIDE, box.h + dh)) };
}

/**
 * The handle of a box under a pointer, if any. Corners win over edges.
 * @param {Box} box
 * @param {Point} point
 * @param {Point} reach  How close counts, as fractions of the image in each direction.
 * @returns {Handle | null}
 */
export function handleAt(box, point, reach) {
  const xs = { w: box.x, '': box.x + box.w / 2, e: box.x + box.w };
  const ys = { n: box.y, '': box.y + box.h / 2, s: box.y + box.h };
  for (const handle of /** @type {Handle[]} */ (['nw', 'ne', 'se', 'sw', 'n', 'e', 's', 'w'])) {
    const hx = xs[/** @type {keyof typeof xs} */ (handle.replace(/[ns]/, ''))];
    const hy = ys[/** @type {keyof typeof ys} */ (handle.replace(/[ew]/, ''))];
    if (Math.abs(point.x - hx) <= reach.x && Math.abs(point.y - hy) <= reach.y) return handle;
  }
  return null;
}

/**
 * A box with one handle dragged to a point; the opposite side stays put.
 * @template {Box} T
 * @param {T} box
 * @param {Handle} handle
 * @param {Point} point
 * @returns {T}
 */
export function resizeFromHandle(box, handle, point) {
  let [left, top, right, bottom] = [box.x, box.y, box.x + box.w, box.y + box.h];
  if (handle.includes('w')) left = clamp(Math.min(point.x, right - MIN_SIDE));
  if (handle.includes('e')) right = clamp(Math.max(point.x, left + MIN_SIDE));
  if (handle.includes('n')) top = clamp(Math.min(point.y, bottom - MIN_SIDE));
  if (handle.includes('s')) bottom = clamp(Math.max(point.y, top + MIN_SIDE));
  return { ...box, x: left, y: top, w: right - left, h: bottom - top };
}

/**
 * The rectangle around a shape.
 * @param {Shape} shape
 * @param {number} aspect  Image width ÷ height.
 * @returns {Box}
 */
export function shapeBounds(shape, aspect) {
  if (shape.type !== 'line') return { x: shape.x, y: shape.y, w: shape.w, h: shape.h };
  const xs = shape.points.map((point) => point.x);
  const ys = shape.points.map((point) => point.y);
  // The stroke is as thick vertically as horizontally in pixels, so more as a fraction of a wide image's height.
  const [left, right] = [clamp(Math.min(...xs) - shape.size / 2), clamp(Math.max(...xs) + shape.size / 2)];
  const [top, bottom] = [clamp(Math.min(...ys) - (shape.size / 2) * aspect), clamp(Math.max(...ys) + (shape.size / 2) * aspect)];
  return { x: left, y: top, w: right - left, h: bottom - top };
}

/**
 * Whether a point is on a shape.
 * @param {Shape} shape
 * @param {Point} point
 * @param {number} aspect  Image width ÷ height.
 */
export function hitShape(shape, point, aspect) {
  if (shape.type !== 'line') {
    const inside = point.x >= shape.x && point.x <= shape.x + shape.w && point.y >= shape.y && point.y <= shape.y + shape.h;
    if (shape.type === 'box' || !inside) return inside;
    const [rx, ry] = [shape.w / 2, shape.h / 2];
    return ((point.x - shape.x - rx) / rx) ** 2 + ((point.y - shape.y - ry) / ry) ** 2 <= 1;
  }
  // Distances in units of the image's width, where the stroke is round.
  const flat = (/** @type {Point} */ p) => ({ x: p.x, y: p.y / aspect });
  const target = flat(point);
  const points = shape.points.map(flat);
  return points.some((a, index) => {
    const b = points[index + 1] ?? a;
    const [dx, dy] = [b.x - a.x, b.y - a.y];
    const along = dx || dy ? Math.min(1, Math.max(0, ((target.x - a.x) * dx + (target.y - a.y) * dy) / (dx * dx + dy * dy))) : 0;
    return Math.hypot(target.x - a.x - along * dx, target.y - a.y - along * dy) <= shape.size / 2;
  });
}

/**
 * @template {Shape} T
 * @param {T} shape
 * @param {number} dx
 * @param {number} dy
 * @returns {T}  Moved, but not past the image's edges.
 */
export function moveShape(shape, dx, dy) {
  if (shape.type !== 'line') return /** @type {T} */ (moveBox(/** @type {Area} */ (shape), dx, dy));
  const xs = shape.points.map((point) => point.x);
  const ys = shape.points.map((point) => point.y);
  const mx = Math.min(1 - Math.max(...xs), Math.max(-Math.min(...xs), dx));
  const my = Math.min(1 - Math.max(...ys), Math.max(-Math.min(...ys), dy));
  return { ...shape, points: shape.points.map((point) => ({ x: point.x + mx, y: point.y + my })) };
}

/* ---------- Pixels ---------- */

/**
 * The canvas pixels a box covers. Rounded outwards, so a box never leaves a
 * sliver of what it was drawn over. Empty (w or h 0) when the box lies
 * outside the frame.
 * @param {Box} box
 * @param {number} imageWidth
 * @param {number} imageHeight
 * @param {Frame} frame
 * @returns {Box}
 */
export function frameRect(box, imageWidth, imageHeight, frame) {
  const [kx, ky] = [frame.width / frame.sw, frame.height / frame.sh];
  const x = Math.max(0, Math.floor((box.x * imageWidth - frame.sx) * kx + TOLERANCE));
  const y = Math.max(0, Math.floor((box.y * imageHeight - frame.sy) * ky + TOLERANCE));
  const right = Math.min(frame.width, Math.ceil(((box.x + box.w) * imageWidth - frame.sx) * kx - TOLERANCE));
  const bottom = Math.min(frame.height, Math.ceil(((box.y + box.h) * imageHeight - frame.sy) * ky - TOLERANCE));
  return { x, y, w: Math.max(0, right - x), h: Math.max(0, bottom - y) };
}

/**
 * The pixels a box covers on a canvas showing the whole image.
 * @param {Box} box
 * @param {number} width
 * @param {number} height
 */
export function pixelRect(box, width, height) {
  return frameRect(box, width, height, { sx: 0, sy: 0, sw: width, sh: height, width, height });
}

/**
 * Size of the saved copy: the image's own size, or scaled down to what a
 * canvas can hold.
 * @param {number} width
 * @param {number} height
 * @param {number} [maxPixels]
 * @returns {{ width: number, height: number, scaled: boolean }}
 */
export function exportSize(width, height, maxPixels = MAX_PIXELS) {
  if (width * height <= maxPixels) return { width, height, scaled: false };
  const factor = Math.sqrt(maxPixels / (width * height));
  return { width: Math.floor(width * factor), height: Math.floor(height * factor), scaled: true };
}

/**
 * What the saved copy shows and how large it is. A crop is rounded inwards:
 * the copy never includes a pixel from outside the outlined area.
 * @param {number} imageWidth
 * @param {number} imageHeight
 * @param {Box | null} crop
 * @param {number} [maxPixels]
 * @returns {Frame & { scaled: boolean }}
 */
export function outputFrame(imageWidth, imageHeight, crop, maxPixels = MAX_PIXELS) {
  const area = crop ?? { x: 0, y: 0, w: 1, h: 1 };
  const sx = Math.max(0, Math.min(imageWidth - 1, Math.ceil(area.x * imageWidth - TOLERANCE)));
  const sy = Math.max(0, Math.min(imageHeight - 1, Math.ceil(area.y * imageHeight - TOLERANCE)));
  const sw = Math.max(1, Math.floor((area.x + area.w) * imageWidth + TOLERANCE) - sx);
  const sh = Math.max(1, Math.floor((area.y + area.h) * imageHeight + TOLERANCE) - sy);
  return { sx, sy, sw, sh, ...exportSize(sw, sh, maxPixels) };
}

/**
 * Size of the editing canvas: sharper when zoomed in, never larger than the
 * image or than a canvas can hold.
 * @param {number} imageWidth
 * @param {number} imageHeight
 * @param {number} zoom
 */
export function previewSize(imageWidth, imageHeight, zoom) {
  const width = Math.min(imageWidth, Math.round(PREVIEW_WIDTH * zoom));
  const size = exportSize(width, Math.max(1, Math.round((width * imageHeight) / imageWidth)), PREVIEW_PIXELS);
  return { width: size.width, height: size.height };
}

/**
 * The next zoom level in a direction, or the same one at either end.
 * @param {number} zoom
 * @param {1 | -1} direction
 */
export function stepZoom(zoom, direction) {
  const index = ZOOMS.indexOf(zoom);
  return ZOOMS[Math.min(ZOOMS.length - 1, Math.max(0, (index === -1 ? 0 : index) + direction))];
}

/**
 * "IMG_1234.JPG" → "IMG_1234-redacted.jpg"
 * @param {string} name
 * @param {string} type  MIME type of the saved copy.
 */
export function redactedName(name, type) {
  const base = name.replace(/\.[^.]*$/, '') || 'image';
  return `${base}-redacted.${type === 'image/png' ? 'png' : 'jpg'}`;
}

/* ---------- Undo and redo ---------- */

/** @param {Drawing} drawing @returns {History} */
export const createHistory = (drawing) => ({ entries: [drawing], index: 0, tag: '' });

/** @param {History} history */
export const currentDrawing = (history) => history.entries[history.index];

/**
 * Adds a step. Steps with the same non-empty tag in a row (a run of arrow
 * key presses on one shape) count as one, so undo takes the whole run back.
 * @param {History} history
 * @param {Drawing} drawing
 * @param {string} [tag]
 * @returns {History}
 */
export function commit(history, drawing, tag = '') {
  const merge = tag !== '' && tag === history.tag;
  const kept = history.entries.slice(0, history.index + (merge ? 0 : 1));
  const entries = [...kept, drawing].slice(-HISTORY_LIMIT);
  return { entries, index: entries.length - 1, tag };
}

/** @param {History} history @returns {History} */
export const undo = (history) => ({ ...history, index: Math.max(0, history.index - 1), tag: '' });

/** @param {History} history @returns {History} */
export const redo = (history) => ({ ...history, index: Math.min(history.entries.length - 1, history.index + 1), tag: '' });

/* ---------- Drawing ---------- */

/**
 * Draws the image, or the part of it in `frame`, with the shapes painted over it.
 * @param {HTMLCanvasElement} canvas
 * @param {ImageBitmap} image
 * @param {Shape[]} shapes
 * @param {Frame} [frame]  Defaults to the whole image on the whole canvas.
 */
export function paint(canvas, image, shapes, frame = { sx: 0, sy: 0, sw: image.width, sh: image.height, width: canvas.width, height: canvas.height }) {
  const context = canvas.getContext('2d');
  if (!context) throw new Error('This browser cannot draw on a canvas.');
  // A JPEG has no transparency: without a background, see-through areas would turn black.
  context.fillStyle = '#fff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(image, frame.sx, frame.sy, frame.sw, frame.sh, 0, 0, frame.width, frame.height);
  context.fillStyle = '#000';
  context.strokeStyle = '#000';
  context.lineCap = 'round';
  context.lineJoin = 'round';
  const [kx, ky] = [frame.width / frame.sw, frame.height / frame.sh];
  for (const shape of shapes) {
    if (shape.type === 'line') {
      const points = shape.points.map((point) => ({ x: (point.x * image.width - frame.sx) * kx, y: (point.y * image.height - frame.sy) * ky }));
      const thickness = Math.max(1, shape.size * image.width * kx);
      context.beginPath();
      if (points.length === 1) {
        context.arc(points[0].x, points[0].y, thickness / 2, 0, Math.PI * 2);
        context.fill();
      } else {
        context.lineWidth = thickness;
        points.forEach((point, index) => (index ? context.lineTo(point.x, point.y) : context.moveTo(point.x, point.y)));
        context.stroke();
      }
      continue;
    }
    const { x, y, w, h } = frameRect(shape, image.width, image.height, frame);
    if (w === 0 || h === 0) continue;
    if (shape.type === 'box') {
      context.fillRect(x, y, w, h);
    } else {
      context.beginPath();
      context.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
      context.fill();
    }
  }
}

/** Which way the pointer looks over each handle. */
const CURSORS = { n: 'ns', s: 'ns', e: 'ew', w: 'ew', nw: 'nwse', se: 'nwse', ne: 'nesw', sw: 'nesw' };

/** @param {HTMLElement} root */
export function init(root) {
  /** @template {Element} T @param {string} name @returns {T} */
  const find = (name) => /** @type {T} */ (root.querySelector(`[data-js="redact-${name}"]`));
  const file = /** @type {HTMLInputElement} */ (find('file'));
  const message = /** @type {HTMLElement} */ (find('message'));
  const editor = /** @type {HTMLElement} */ (find('editor'));
  const view = /** @type {HTMLElement} */ (find('view'));
  const canvas = /** @type {HTMLCanvasElement} */ (find('canvas'));
  const count = /** @type {HTMLElement} */ (find('count'));
  const sizeInput = /** @type {HTMLInputElement} */ (find('size'));
  const zoomValue = /** @type {HTMLElement} */ (find('zoom-value'));
  const result = /** @type {HTMLElement} */ (find('result'));
  const resultCanvas = /** @type {HTMLCanvasElement} */ (find('result-canvas'));
  const resultInfo = /** @type {HTMLElement} */ (find('result-info'));
  const resultStatus = /** @type {HTMLElement} */ (find('result-status'));
  const saveLink = /** @type {HTMLAnchorElement} */ (find('download'));
  const modeButtons = /** @type {HTMLButtonElement[]} */ ([...root.querySelectorAll('[data-js="redact-mode"]')]);
  /** @param {string} name */
  const button = (name) => /** @type {HTMLButtonElement} */ (find(name));

  /** @type {ImageBitmap | null} */
  let image = null;
  let name = '';
  let type = 'image/jpeg';
  /** @type {Mode} */
  let mode = 'box';
  let zoom = 1;
  let history = createHistory({ shapes: [], crop: null });
  /** Changes of a drag in progress, not yet a step in the history. */
  /** @type {Drawing | null} */
  let draft = null;
  /** Index of the shape that the handles and the keyboard act on. */
  let selected = -1;
  /**
   * @type {null
   *   | { kind: 'draw', from: Point }
   *   | { kind: 'stroke', line: Line }
   *   | { kind: 'move', from: Point, moved: boolean }
   *   | { kind: 'resize', handle: Handle }
   *   | { kind: 'pan' }}
   */
  let gesture = null;
  /** Fingers on the canvas, to tell a two-finger pan from drawing. @type {Map<number, Point>} */
  const pointers = new Map();
  /** The encoded copy on show, kept so it can be copied as well as saved. @type {HTMLCanvasElement | null} */
  let output = null;

  const drawing = () => draft ?? currentDrawing(history);
  const aspect = () => (image ? image.width / image.height : 1);
  /** The box the handles belong to: the crop in crop mode, else the selected box or ellipse. */
  const target = () => {
    const { shapes, crop } = drawing();
    if (mode === 'crop') return crop;
    const shape = shapes[selected];
    return shape && shape.type !== 'line' ? shape : null;
  };

  const hideResult = () => {
    if (result.hidden) return;
    result.hidden = true;
    URL.revokeObjectURL(saveLink.href);
    saveLink.removeAttribute('href');
    output = null;
  };

  const render = () => {
    if (!image) return;
    const { shapes, crop } = drawing();
    paint(canvas, image, shapes);
    const context = /** @type {CanvasRenderingContext2D} */ (canvas.getContext('2d'));
    // Canvas pixels per screen pixel, so lines and handles look the same at every zoom and image size.
    const scale = canvas.width / (canvas.getBoundingClientRect().width || canvas.width);
    const line = 1.5 * scale;
    const accent = getComputedStyle(root).getPropertyValue('--color-focus').trim() || '#0e6a69';
    /** A line that shows on both light and dark pictures. @param {Box} box @param {number[]} dash */
    const outline = (box, dash) => {
      const { x, y, w, h } = pixelRect(box, canvas.width, canvas.height);
      context.setLineDash([]);
      context.lineWidth = line * 2;
      context.strokeStyle = '#fff';
      context.strokeRect(x, y, w, h);
      context.setLineDash(dash);
      context.lineWidth = line;
      context.strokeStyle = accent;
      context.strokeRect(x, y, w, h);
      context.setLineDash([]);
    };

    if (crop) {
      const { x, y, w, h } = pixelRect(crop, canvas.width, canvas.height);
      context.fillStyle = 'rgba(0, 0, 0, 0.6)';
      context.fillRect(0, 0, canvas.width, y);
      context.fillRect(0, y + h, canvas.width, canvas.height - y - h);
      context.fillRect(0, y, x, h);
      context.fillRect(x + w, y, canvas.width - x - w, h);
      outline(crop, [line * 4, line * 3]);
    }
    const shape = mode === 'crop' ? null : shapes[selected];
    if (shape) outline(shapeBounds(shape, aspect()), shape.type === 'line' ? [line * 2, line * 2] : []);
    const box = target();
    if (box) {
      const { x, y, w, h } = pixelRect(box, canvas.width, canvas.height);
      const side = 10 * scale;
      context.fillStyle = '#fff';
      context.strokeStyle = accent;
      context.lineWidth = line;
      for (const hx of [x, x + w / 2, x + w]) {
        for (const hy of [y, y + h / 2, y + h]) {
          if (hx === x + w / 2 && hy === y + h / 2) continue;
          context.fillRect(hx - side / 2, hy - side / 2, side, side);
          context.strokeRect(hx - side / 2, hy - side / 2, side, side);
        }
      }
    }

    const { index, entries } = history;
    count.textContent = [(count.dataset.template ?? '').replace('{n}', String(shapes.length)), crop ? count.dataset.cropped : ''].filter(Boolean).join(' ');
    button('undo').disabled = index === 0;
    button('redo').disabled = index === entries.length - 1;
    button('remove').disabled = mode === 'crop' || !shapes[selected];
    button('uncrop').disabled = !crop;
    button('clear').disabled = shapes.length === 0 && !crop;
    button('zoom-out').disabled = zoom === ZOOMS[0];
    button('zoom-in').disabled = zoom === ZOOMS[ZOOMS.length - 1];
    zoomValue.textContent = `${Math.round(zoom * 100)}%`;
    sizeInput.disabled = mode !== 'marker';
    modeButtons.forEach((other) => other.setAttribute('aria-pressed', String(other.dataset.mode === mode)));
  };

  /** A finished change: a new step in the history. @param {Drawing} next @param {number} [select] @param {string} [tag] */
  const apply = (next, select = selected, tag = '') => {
    history = commit(history, next, tag);
    draft = null;
    selected = select;
    hideResult();
    render();
  };

  /** @param {(history: History) => History} step */
  const travel = (step) => {
    history = step(history);
    draft = null;
    selected = -1;
    hideResult();
    render();
  };

  /** @param {number} next */
  const setZoom = (next) => {
    if (!image || next === zoom) return;
    // Keep the middle of what is on screen in the middle.
    const [cx, cy] = [(view.scrollLeft + view.clientWidth / 2) / view.scrollWidth, (view.scrollTop + view.clientHeight / 2) / view.scrollHeight];
    zoom = next;
    view.dataset.zoom = String(zoom);
    Object.assign(canvas, previewSize(image.width, image.height, zoom));
    render();
    view.scrollLeft = cx * view.scrollWidth - view.clientWidth / 2;
    view.scrollTop = cy * view.scrollHeight - view.clientHeight / 2;
  };

  /** @param {Mode} next */
  const setMode = (next) => {
    mode = next;
    selected = -1;
    render();
  };

  /** @param {File} chosen */
  const open = async (chosen) => {
    image?.close();
    image = null;
    editor.hidden = true;
    hideResult();
    message.textContent = '';
    if (chosen.size > MAX_BYTES) {
      message.textContent = message.dataset.tooLarge ?? '';
      return;
    }
    try {
      image = await createImageBitmap(chosen);
    } catch (error) {
      console.warn('[lockwell] The chosen file could not be opened as an image.', error);
      message.textContent = message.dataset.unsupported ?? '';
      return;
    }
    name = chosen.name;
    // PNG stays PNG (screenshots keep sharp text); everything else is saved as JPEG.
    type = chosen.type === 'image/png' ? 'image/png' : 'image/jpeg';
    const size = exportSize(image.width, image.height);
    if (size.scaled) message.textContent = (message.dataset.resized ?? '').replace('{w}', String(size.width)).replace('{h}', String(size.height));
    history = createHistory({ shapes: [], crop: null });
    draft = null;
    selected = -1;
    zoom = 1;
    view.dataset.zoom = '1';
    Object.assign(canvas, previewSize(image.width, image.height, zoom));
    editor.hidden = false;
    render();
  };

  file.addEventListener('change', () => {
    const chosen = file.files?.[0];
    if (chosen) open(chosen);
  });
  receiveFiles(root, open, { paste: true });

  /* ---------- Pointer ---------- */

  /** Where a pointer is, as fractions of the image. @param {PointerEvent} event */
  const point = (event) => {
    const area = canvas.getBoundingClientRect();
    return { x: (event.clientX - area.left) / area.width, y: (event.clientY - area.top) / area.height };
  };
  /** How close to a handle counts: a fingertip is less exact than a mouse. @param {PointerEvent} event */
  const reach = (event) => {
    const area = canvas.getBoundingClientRect();
    const pixels = event.pointerType === 'mouse' ? 9 : 20;
    return { x: pixels / area.width, y: pixels / area.height };
  };
  /** The topmost shape under a point. @param {Point} at */
  const shapeAt = (at) => drawing().shapes.findLastIndex((shape) => hitShape(shape, at, aspect()));
  const markerSize = () => Number(sizeInput.value) / 100;

  /** Puts a changed crop or selected shape into the draft. @param {(box: Box) => Box} change */
  const changeTarget = (change) => {
    const { shapes, crop } = currentDrawing(history);
    if (mode === 'crop') draft = { shapes, crop: crop && change(crop) };
    else draft = { crop, shapes: shapes.map((shape, index) => (index === selected && shape.type !== 'line' ? { ...shape, ...change(shape) } : shape)) };
  };

  canvas.addEventListener('pointerdown', (event) => {
    if (!image) return;
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointers.size > 1) {
      // A second finger: this is a pan, not a drawing.
      draft = null;
      gesture = { kind: 'pan' };
      render();
      return;
    }
    if (!event.isPrimary || event.button !== 0) return;
    canvas.setPointerCapture(event.pointerId);
    const at = point(event);
    const box = target();
    const handle = box && handleAt(box, at, reach(event));
    const { crop } = drawing();
    if (handle) {
      gesture = { kind: 'resize', handle };
    } else if (mode === 'crop') {
      gesture = crop && hitShape({ type: 'box', ...crop }, at, aspect()) ? { kind: 'move', from: at, moved: false } : { kind: 'draw', from: at };
    } else if (mode === 'marker') {
      // The marker always draws, so strokes can overlap what is already covered.
      const line = /** @type {Line} */ ({ type: 'line', points: [{ x: clamp(at.x), y: clamp(at.y) }], size: markerSize() });
      gesture = { kind: 'stroke', line };
      selected = -1;
      draft = { ...currentDrawing(history), shapes: [...currentDrawing(history).shapes, line] };
    } else {
      const hit = shapeAt(at);
      selected = hit;
      gesture = hit === -1 ? { kind: 'draw', from: at } : { kind: 'move', from: at, moved: false };
    }
    render();
  });

  canvas.addEventListener('pointermove', (event) => {
    const at = point(event);
    if (!gesture) {
      // Show what a press here would do.
      const box = target();
      const handle = box && handleAt(box, at, reach(event));
      const over = mode === 'crop' ? box && hitShape({ type: 'box', ...box }, at, 1) : mode !== 'marker' && shapeAt(at) !== -1;
      canvas.dataset.cursor = handle ? CURSORS[handle] : over ? 'move' : '';
      return;
    }
    const before = pointers.get(event.pointerId);
    if (before) pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    const { shapes, crop } = currentDrawing(history);
    if (gesture.kind === 'pan') {
      // Each finger contributes half, so two fingers moving together pan one to one.
      if (before) view.scrollBy((before.x - event.clientX) / 2, (before.y - event.clientY) / 2);
      return;
    }
    if (gesture.kind === 'stroke') {
      const { points } = gesture.line;
      const last = points[points.length - 1];
      const next = { x: clamp(at.x), y: clamp(at.y) };
      // Skip movements too small to see: long strokes stay light.
      if (Math.hypot(next.x - last.x, next.y - last.y) < 0.002) return;
      points.push(next);
    } else if (gesture.kind === 'draw') {
      const box = boxFromDrag(gesture.from, at);
      if (mode === 'crop') draft = box ? { shapes, crop: box } : null;
      else draft = box ? { crop, shapes: [...shapes, { type: mode === 'ellipse' ? 'ellipse' : 'box', ...box }] } : null;
    } else if (gesture.kind === 'move') {
      const [dx, dy] = [at.x - gesture.from.x, at.y - gesture.from.y];
      gesture.moved = true;
      if (mode === 'crop') draft = { shapes, crop: crop && moveBox(crop, dx, dy) };
      else draft = { crop, shapes: shapes.map((shape, index) => (index === selected ? moveShape(shape, dx, dy) : shape)) };
    } else {
      const { handle } = gesture;
      changeTarget((box) => resizeFromHandle(box, handle, at));
    }
    render();
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
    if (!finished) {
      // A tap, a slip or an interrupted drag: nothing changes.
      draft = null;
      render();
    } else if (ended.kind === 'draw' && mode !== 'crop') {
      apply(finished, finished.shapes.length - 1);
    } else {
      apply(finished, ended.kind === 'stroke' ? -1 : selected);
    }
  };
  canvas.addEventListener('pointerup', endGesture);
  canvas.addEventListener('pointercancel', endGesture);

  /* ---------- Keyboard and buttons ---------- */

  const removeSelected = () => {
    const { shapes, crop } = currentDrawing(history);
    if (mode === 'crop') {
      if (crop) apply({ shapes, crop: null });
    } else if (shapes[selected]) {
      apply({ crop, shapes: shapes.filter((_, index) => index !== selected) }, -1);
    }
  };

  /** Adds a shape in the middle of the image, for those who can't drag. */
  const addInMiddle = () => {
    const { shapes, crop } = currentDrawing(history);
    if (mode === 'crop') apply({ shapes, crop: { x: 0.1, y: 0.1, w: 0.8, h: 0.8 } });
    else apply({ crop, shapes: [...shapes, { type: mode === 'ellipse' ? 'ellipse' : 'box', x: 0.375, y: 0.4, w: 0.25, h: 0.2 }] }, shapes.length);
  };

  canvas.addEventListener('keydown', (event) => {
    const arrows = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    const { shapes, crop } = currentDrawing(history);
    const shape = mode === 'crop' ? null : shapes[selected];
    // Key positions, not letters: the shortcut is the same on a Georgian keyboard.
    if ((event.ctrlKey || event.metaKey) && (event.code === 'KeyZ' || event.code === 'KeyY')) {
      travel(event.code === 'KeyY' || event.shiftKey ? redo : undo);
    } else if (event.ctrlKey || event.metaKey || event.altKey) {
      return;
    } else if (event.key === 'Enter') {
      addInMiddle();
    } else if (event.key in arrows && (shape || (mode === 'crop' && crop))) {
      const [dx, dy] = arrows[/** @type {keyof typeof arrows} */ (event.key)].map((step) => step * KEY_STEP);
      const tag = `${event.shiftKey ? 'resize' : 'move'}:${mode === 'crop' ? 'crop' : selected}`;
      if (mode === 'crop' && crop) {
        apply({ shapes, crop: event.shiftKey ? resizeBox(crop, dx, dy) : moveBox(crop, dx, dy) }, selected, tag);
      } else if (shape) {
        const changed = event.shiftKey && shape.type !== 'line' ? resizeBox(shape, dx, dy) : moveShape(shape, dx, dy);
        apply({ crop, shapes: shapes.map((other, index) => (index === selected ? changed : other)) }, selected, tag);
      }
    } else if (event.key === 'Delete' || event.key === 'Backspace') {
      removeSelected();
    } else if ((event.key === 'PageDown' || event.key === 'PageUp') && mode !== 'crop' && shapes.length > 0) {
      selected = (selected + (event.key === 'PageDown' ? 1 : -1) + shapes.length + (selected === -1 && event.key === 'PageUp' ? 1 : 0)) % shapes.length;
      render();
    } else if (event.key === 'Escape' && selected !== -1) {
      selected = -1;
      render();
    } else if (event.key === '+' || event.key === '=') {
      setZoom(stepZoom(zoom, 1));
    } else if (event.key === '-') {
      setZoom(stepZoom(zoom, -1));
    } else {
      return;
    }
    event.preventDefault();
  });

  modeButtons.forEach((other) => other.addEventListener('click', () => setMode(/** @type {Mode} */ (other.dataset.mode))));
  button('undo').addEventListener('click', () => travel(undo));
  button('redo').addEventListener('click', () => travel(redo));
  button('remove').addEventListener('click', removeSelected);
  button('uncrop').addEventListener('click', () => apply({ shapes: currentDrawing(history).shapes, crop: null }));
  button('clear').addEventListener('click', () => apply({ shapes: [], crop: null }, -1));
  button('zoom-in').addEventListener('click', () => setZoom(stepZoom(zoom, 1)));
  button('zoom-out').addEventListener('click', () => setZoom(stepZoom(zoom, -1)));

  /* ---------- Result ---------- */

  /** @param {HTMLCanvasElement} source @param {string} mime @returns {Promise<Blob>} */
  const encode = (source, mime) =>
    new Promise((resolve, reject) => {
      source.toBlob((blob) => (blob ? resolve(blob) : reject(new Error(`The browser could not encode the image as ${mime}.`))), mime, 0.92);
    });

  button('check').addEventListener('click', async () => {
    if (!image) return;
    const { shapes, crop } = currentDrawing(history);
    const frame = outputFrame(image.width, image.height, crop);
    const made = document.createElement('canvas');
    made.width = frame.width;
    made.height = frame.height;
    resultStatus.textContent = '';
    try {
      paint(made, image, shapes, frame);
      const blob = await encode(made, type);
      // Show the encoded file itself, not the editor's idea of it.
      const saved = await createImageBitmap(blob);
      Object.assign(resultCanvas, previewSize(saved.width, saved.height, 1));
      resultCanvas.getContext('2d')?.drawImage(saved, 0, 0, resultCanvas.width, resultCanvas.height);
      saved.close();
      URL.revokeObjectURL(saveLink.href);
      saveLink.href = URL.createObjectURL(blob);
      saveLink.download = redactedName(name, type);
    } catch (error) {
      console.error('[lockwell] The covered copy could not be created.', error);
      message.textContent = message.dataset.encodeFailed ?? '';
      return;
    }
    output = made;
    resultInfo.textContent = `${frame.width} × ${frame.height} · ${type === 'image/png' ? 'PNG' : 'JPEG'}`;
    result.hidden = false;
    result.focus();
  });

  const copyButton = button('copy');
  copyButton.addEventListener('click', async () => {
    if (!output) return;
    let copied = true;
    try {
      // Clipboards take PNG. The promise form keeps the copy inside this click on Safari.
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': encode(output, 'image/png') })]);
    } catch (error) {
      console.warn('[lockwell] Could not copy the image to the clipboard.', error);
      copied = false;
    }
    resultStatus.textContent = (copied ? copyButton.dataset.done : copyButton.dataset.failed) ?? '';
  });
}

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
import { initSave } from './save.mjs';
import { fillText } from './fill.mjs';
import { boxFromDrag, clamp, handleAt, moveBox, resizeBox, resizeFromHandle } from './box.mjs';
import { commit, createHistory as historyOf, redo, undo } from './history.mjs';
import { MAX_PIXELS, canReadBack, encode, examplePicture, exportSize, isAnimated, pixelsOf, release } from './canvas.mjs';

// Moved to shared modules for the other image tools; still exported from here.
export { boxFromDrag, commit, exportSize, handleAt, isAnimated, moveBox, redo, resizeBox, resizeFromHandle, undo };

/** @typedef {import('./box.mjs').Box} Box */
/** @typedef {import('./box.mjs').Point} Point */
/** @typedef {Box & { type: 'box' | 'ellipse' }} Area */
/**
 * A freehand stroke.
 * @typedef {{ type: 'line', points: Point[], size: number }} Line  `size`: thickness as a fraction of the image's width.
 */
/** @typedef {Area | Line} Shape */
/** @typedef {{ shapes: Shape[], crop: Box | null }} Drawing */
/** @typedef {import('./box.mjs').Handle} Handle */
/**
 * The part of the image (in image pixels) that is drawn onto a canvas of
 * `width` × `height`.
 * @typedef {{ sx: number, sy: number, sw: number, sh: number, width: number, height: number }} Frame
 */
/** @typedef {import('./history.mjs').History<Drawing>} History */
/** @typedef {'box' | 'ellipse' | 'marker' | 'crop'} Mode */

/** Smallest box side on screen, in CSS pixels: smaller drags are slips, not boxes. */
const MIN_SCREEN = 6;
/** How far an arrow key or a move or resize button changes the selected shape, in CSS pixels on screen. */
const STEP_SCREEN = 8;
const MAX_BYTES = 40 * 1024 * 1024;
/** Width of the editing preview at 100% zoom; the saved copy always uses the full image. */
const PREVIEW_WIDTH = 1600;
const PREVIEW_PIXELS = 8_000_000;
export const ZOOMS = [1, 1.5, 2, 3, 4];
/** Rounding slack: 0.3 × 1000 is 300.00000000000006, which must not count as a 301st pixel. */
const TOLERANCE = 1e-6;

/* ---------- Geometry ---------- */

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
 * @param {number} [grow]  Image pixels added on every side (see previewGrow).
 * @returns {Box}
 */
export function frameRect(box, imageWidth, imageHeight, frame, grow = 0) {
  const [kx, ky] = [frame.width / frame.sw, frame.height / frame.sh];
  const x = Math.max(0, Math.floor((box.x * imageWidth - grow - frame.sx) * kx + TOLERANCE));
  const y = Math.max(0, Math.floor((box.y * imageHeight - grow - frame.sy) * ky + TOLERANCE));
  const right = Math.min(frame.width, Math.ceil(((box.x + box.w) * imageWidth + grow - frame.sx) * kx - TOLERANCE));
  const bottom = Math.min(frame.height, Math.ceil(((box.y + box.h) * imageHeight + grow - frame.sy) * ky - TOLERANCE));
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
 * How far, in image pixels, the editor may show a box beyond its exact
 * edge: one preview pixel at the coarsest zoom, because the preview rounds
 * outwards on its own grid. The saved copy grows its boxes by this much, so
 * it never covers less than the editor showed.
 * @param {number} imageWidth
 * @param {number} imageHeight
 */
export function previewGrow(imageWidth, imageHeight) {
  const preview = previewSize(imageWidth, imageHeight, ZOOMS[0]);
  const ratio = Math.max(imageWidth / preview.width, imageHeight / preview.height);
  // On the same grid both round the same way.
  return ratio > 1 + TOLERANCE ? ratio : 0;
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
 * The zoom step nearest to where two fingers have moved since they touched
 * down: spreading them twice as far doubles the zoom.
 * @param {number} zoom  The zoom when the second finger touched down.
 * @param {number} startDistance  The distance between the fingers then.
 * @param {number} distance  The distance now; 0 once a finger has lifted.
 */
export function pinchZoom(zoom, startDistance, distance) {
  if (startDistance <= 0 || distance <= 0) return zoom;
  const wanted = (zoom * distance) / startDistance;
  return ZOOMS.reduce((best, step) => (Math.abs(Math.log(step / wanted)) < Math.abs(Math.log(best / wanted)) ? step : best));
}

/** Within this angle of level or upright, a straight line is made exactly level or upright. */
const SNAP_DEGREES = 10;

/**
 * Where a straight marker line ends: at the pointer, or level or upright
 * when it is nearly so (lines of text are level).
 * @param {Point} from
 * @param {Point} to
 * @param {number} aspect  Image width / height: fractions of each are not the same length.
 * @returns {Point}
 */
export function straightEnd(from, to, aspect) {
  const end = { x: clamp(to.x), y: clamp(to.y) };
  const angle = (Math.atan2(Math.abs(end.y - from.y), Math.abs(end.x - from.x) * aspect) * 180) / Math.PI;
  if (angle <= SNAP_DEGREES) return { x: end.x, y: from.y };
  if (angle >= 90 - SNAP_DEGREES) return { x: from.x, y: end.y };
  return end;
}

/**
 * True when covering is on screen and was neither saved nor copied, so
 * opening another picture would lose it. Judged by what is drawn, not by the
 * step count: the history forgets its oldest steps.
 * @param {History} history
 * @param {boolean} saved
 */
export const unsavedWork = (history, saved) => {
  const { shapes, crop } = currentDrawing(history);
  return !saved && (shapes.length > 0 || crop !== null);
};

/** A channel above this is too light for a covered pixel (JPEG adds a little noise to black). */
const DARK = 48;
/**
 * How far JPEG lightens the edge of a black area, in pixels. Measured on
 * 2026-11-13 with black boxes of 9 to 40 pixels at every offset to the
 * 8 × 8 blocks, on red, green, blue, magenta, cyan, yellow and white, at the
 * quality this tool saves with (0.92): light pixels reached 2 pixels in, never
 * 3, both in Brave (Chromium's encoder) and in macOS ImageIO, which Safari's
 * canvas uses.
 */
export const JPEG_EDGE = 2;
/** Half a pixel's diagonal: a pixel whose centre is this far inside a round edge lies wholly inside it. */
const HALF_DIAGONAL = Math.SQRT1_2;

/**
 * The pixels of a canvas showing `frame` that lie wholly inside a shape,
 * worked out from the shape's own numbers, not from the code that paints it.
 * A stroke counts a pixel when its centre is at least half a pixel's diagonal
 * inside, which includes its round caps and joins.
 * @typedef {{ left: number, top: number, width: number, height: number, mask: Uint8Array }} Covered
 *   `mask`: width × height, 1 for each pixel inside, from (left, top) on the canvas.
 * @param {Shape} shape
 * @param {{ width: number, height: number }} image
 * @param {Frame} frame
 * @returns {Covered}
 */
function coveredPixels(shape, image, frame) {
  const [kx, ky] = [frame.width / frame.sw, frame.height / frame.sh];
  const toX = (/** @type {number} */ fraction) => (fraction * image.width - frame.sx) * kx;
  const toY = (/** @type {number} */ fraction) => (fraction * image.height - frame.sy) * ky;
  const radius = shape.type === 'line' ? (shape.size * image.width * kx) / 2 : 0;
  const points = shape.type === 'line' ? shape.points.map((point) => ({ x: toX(point.x), y: toY(point.y) })) : [];
  const bounds =
    shape.type === 'line'
      ? [Math.min(...points.map((p) => p.x)) - radius, Math.min(...points.map((p) => p.y)) - radius, Math.max(...points.map((p) => p.x)) + radius, Math.max(...points.map((p) => p.y)) + radius]
      : [toX(shape.x), toY(shape.y), toX(shape.x + shape.w), toY(shape.y + shape.h)];
  const left = Math.max(0, Math.floor(bounds[0]));
  const top = Math.max(0, Math.floor(bounds[1]));
  const width = Math.max(0, Math.min(frame.width, Math.ceil(bounds[2])) - left);
  const height = Math.max(0, Math.min(frame.height, Math.ceil(bounds[3])) - top);
  const mask = new Uint8Array(width * height);
  /** Marks pixels from..to (canvas columns, both included) in canvas row y. @param {number} y @param {number} from @param {number} to */
  const span = (y, from, to) => {
    const [a, b] = [Math.max(left, from), Math.min(left + width - 1, to)];
    if (b >= a) mask.fill(1, (y - top) * width + a - left, (y - top) * width + b - left + 1);
  };
  if (shape.type === 'box') {
    const [x0, y0, x1, y1] = bounds;
    for (let y = Math.max(top, Math.ceil(y0 - TOLERANCE)); y + 1 <= y1 + TOLERANCE && y < top + height; y += 1) span(y, Math.ceil(x0 - TOLERANCE), Math.floor(x1 + TOLERANCE) - 1);
  } else if (shape.type === 'ellipse') {
    const [x0, y0, x1, y1] = bounds;
    const [cx, cy, rx, ry] = [(x0 + x1) / 2, (y0 + y1) / 2, (x1 - x0) / 2, (y1 - y0) / 2];
    for (let y = top; y < top + height; y += 1) {
      // The row's corner farther from the middle is the one that has to fit.
      const far = Math.max(Math.abs(y - cy), Math.abs(y + 1 - cy)) / ry;
      if (far > 1 + TOLERANCE) continue;
      const half = rx * Math.sqrt(Math.max(0, 1 - far * far));
      span(y, Math.ceil(cx - half - TOLERANCE), Math.floor(cx + half + TOLERANCE) - 1);
    }
  } else {
    const reach = radius - HALF_DIAGONAL;
    if (reach <= 0) return { left, top, width, height, mask };
    const segments = points.length === 1 ? [[points[0], points[0]]] : points.slice(1).map((point, index) => [points[index], point]);
    for (const [a, b] of segments) {
      const length = Math.hypot(b.x - a.x, b.y - a.y);
      const [nx, ny] = length ? [(-(b.y - a.y) / length) * reach, ((b.x - a.x) / length) * reach] : [0, 0];
      // The segment's band, a rectangle, as its four sides.
      const corners = [{ x: a.x + nx, y: a.y + ny }, { x: b.x + nx, y: b.y + ny }, { x: b.x - nx, y: b.y - ny }, { x: a.x - nx, y: a.y - ny }];
      const firstRow = Math.max(top, Math.floor(Math.min(a.y, b.y) - reach));
      const lastRow = Math.min(top + height - 1, Math.ceil(Math.max(a.y, b.y) + reach));
      for (let y = firstRow; y <= lastRow; y += 1) {
        const middle = y + 0.5;
        let [from, to] = [Infinity, -Infinity];
        // The round ends.
        for (const end of [a, b]) {
          const dy = middle - end.y;
          if (Math.abs(dy) > reach) continue;
          const half = Math.sqrt(reach * reach - dy * dy);
          [from, to] = [Math.min(from, end.x - half), Math.max(to, end.x + half)];
        }
        // The band between them.
        if (length) {
          for (let i = 0; i < 4; i += 1) {
            const [p, q] = [corners[i], corners[(i + 1) % 4]];
            if ((p.y - middle) * (q.y - middle) > 0) continue;
            const x = p.y === q.y ? [p.x, q.x] : [p.x + ((middle - p.y) * (q.x - p.x)) / (q.y - p.y)];
            [from, to] = [Math.min(from, ...x), Math.max(to, ...x)];
          }
        }
        // Pixels whose centre lies in from..to.
        if (to >= from) span(y, Math.ceil(from - 0.5 - TOLERANCE), Math.floor(to - 0.5 + TOLERANCE));
      }
    }
  }
  return { left, top, width, height, mask };
}

/**
 * Keeps only the pixels at least `edge + 1` pixels from any pixel outside
 * the mask, in rows, columns and diagonals. Pixels beyond the canvas count as
 * inside: where a crop cuts an area there is no edge for JPEG to blur.
 * @param {Uint8Array} mask  1 where a shape covers, changed in place.
 * @param {number} width
 * @param {number} height
 * @param {number} edge
 */
function erode(mask, width, height, edge) {
  const line = new Int32Array(Math.max(width, height));
  /** One row or column: `at(i)` is its i-th pixel's index in the mask. @param {number} count @param {(i: number) => number} at */
  const pass = (count, at) => {
    let run = edge + 1;
    for (let i = 0; i < count; i += 1) {
      run = mask[at(i)] ? run + 1 : 0;
      line[i] = run;
    }
    run = edge + 1;
    for (let i = count - 1; i >= 0; i -= 1) {
      run = mask[at(i)] ? run + 1 : 0;
      if (line[i] <= edge || run <= edge) line[i] = -1;
    }
    // Cleared only now, once the whole line has been measured.
    for (let i = 0; i < count; i += 1) if (line[i] === -1) mask[at(i)] = 0;
  };
  // A square neighbourhood is a row's neighbourhood of each pixel in a column's: rows first, then columns.
  for (let y = 0; y < height; y += 1) pass(width, (x) => y * width + x);
  for (let x = 0; x < width; x += 1) pass(height, (y) => y * width + x);
}

/**
 * Checks a saved picture, decoded back to pixels: every pixel that lies
 * wholly inside a covered area must be black. Pixels within `edge` of the
 * covered region's outline are not judged (JPEG blurs them; see JPEG_EDGE);
 * where areas touch or a crop cuts one there is no outline, so none are
 * skipped there.
 * @param {Uint8ClampedArray} pixels  RGBA of the decoded copy, frame.width × frame.height.
 * @param {Shape[]} shapes
 * @param {{ width: number, height: number }} image  The full image's size.
 * @param {Frame} frame  What the copy shows (see outputFrame).
 * @param {number} edge  0 for PNG, JPEG_EDGE for JPEG.
 * @returns {{ checked: number, thin: number, solid: boolean }}  checked: areas in the copy with pixels judged;
 *   thin: areas in the copy too thin to have any.
 */
export function checkCovered(pixels, shapes, image, frame, edge) {
  const { width, height } = frame;
  /** @type {Uint8Array | null} */
  let judged = null;
  if (edge > 0) {
    judged = new Uint8Array(width * height);
    for (const shape of shapes) {
      const covered = coveredPixels(shape, image, frame);
      for (let row = 0; row < covered.height; row += 1) {
        for (let column = 0; column < covered.width; column += 1) {
          if (covered.mask[row * covered.width + column]) judged[(covered.top + row) * width + covered.left + column] = 1;
        }
      }
    }
    erode(judged, width, height, edge);
  }
  let [checked, thin] = [0, 0];
  for (const shape of shapes) {
    const covered = coveredPixels(shape, image, frame);
    let seen = 0;
    for (let row = 0; row < covered.height; row += 1) {
      for (let column = 0; column < covered.width; column += 1) {
        const at = (covered.top + row) * width + covered.left + column;
        if (!covered.mask[row * covered.width + column] || (judged && !judged[at])) continue;
        seen += 1;
        if (pixels[at * 4] > DARK || pixels[at * 4 + 1] > DARK || pixels[at * 4 + 2] > DARK) return { checked, thin, solid: false };
      }
    }
    if (seen) checked += 1;
    else if (inFrame(shape, image, frame)) thin += 1;
  }
  return { checked, thin, solid: true };
}

/**
 * Whether any of a shape shows in the copy.
 * @param {Shape} shape
 * @param {{ width: number, height: number }} image
 * @param {Frame} frame
 */
function inFrame(shape, image, frame) {
  const bounds = shapeBounds(shape, image.width / image.height);
  const [left, top] = [bounds.x * image.width - frame.sx, bounds.y * image.height - frame.sy];
  return left + bounds.w * image.width > 0 && top + bounds.h * image.height > 0 && left < frame.sw && top < frame.sh;
}

/* ---------- Undo and redo ---------- */

/**
 * A history of drawings. Typed here, so a first drawing with no shapes yet
 * still starts a history that takes shapes later.
 * @param {Drawing} drawing @returns {History}
 */
export const createHistory = (drawing) => historyOf(drawing);

/** @param {History} history */
export const currentDrawing = (history) => history.entries[history.index];

/* ---------- Drawing ---------- */

/**
 * Draws the image, or the part of it in `frame`, with the shapes painted over it.
 * @param {HTMLCanvasElement} canvas
 * @param {ImageBitmap} image
 * @param {Shape[]} shapes
 * @param {Frame} [frame]  Defaults to the whole image on the whole canvas.
 * @param {number} [grow]  Image pixels added to every side of boxes and ellipses (see previewGrow).
 */
export function paint(canvas, image, shapes, frame = { sx: 0, sy: 0, sw: image.width, sh: image.height, width: canvas.width, height: canvas.height }, grow = 0) {
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
    const { x, y, w, h } = frameRect(shape, image.width, image.height, frame, grow);
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
  const verified = /** @type {HTMLElement} */ (find('verified'));
  const saveBox = /** @type {HTMLElement} */ (find('result').querySelector('[data-js="save"]'));
  const save = initSave(saveBox);
  const straight = /** @type {HTMLInputElement} */ (find('straight'));
  const replace = /** @type {HTMLElement} */ (find('replace'));
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
   *   | { kind: 'pan', zoom: number, distance: number }}
   */
  let gesture = null;
  /** Fingers on the canvas, to tell a two-finger pan from drawing. @type {Map<number, Point>} */
  const pointers = new Map();
  /**
   * The checked copy on show: its canvas, so it can be copied as well as
   * saved, and what was checked, so a copy for the clipboard can be checked too.
   * @type {{ canvas: HTMLCanvasElement, blob: Blob, shapes: Shape[], frame: Frame } | null}
   */
  let output = null;
  /** Counts checks: one that is no longer the latest, or whose picture or covering changed meanwhile, is dropped. */
  let checks = 0;
  /** The covering drawn so far was saved, shared or copied. */
  let saved = false;
  /** A picture chosen while unsaved covering is on screen, waiting for the visitor's answer. @type {File | null} */
  let pending = null;

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
    if (output) release(output.canvas);
    output = null;
    if (result.hidden) return;
    result.hidden = true;
    save.clear();
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
    count.textContent = [fillText(count.dataset.template, { n: String(shapes.length) }), crop ? count.dataset.cropped : ''].filter(Boolean).join(' ');
    button('undo').disabled = index === 0;
    button('redo').disabled = index === entries.length - 1;
    button('remove').disabled = mode === 'crop' || !shapes[selected];
    // Moving needs a selected shape or a crop; resizing a box, an ellipse or a crop.
    const movable = mode === 'crop' ? Boolean(crop) : Boolean(shapes[selected]);
    const sizable = mode === 'crop' ? Boolean(crop) : Boolean(shapes[selected]) && shapes[selected].type !== 'line';
    for (const name of ['move-left', 'move-right', 'move-up', 'move-down']) button(name).disabled = !movable;
    for (const name of ['narrower', 'wider', 'shorter', 'taller']) button(name).disabled = !sizable;
    button('uncrop').disabled = !crop;
    button('clear').disabled = shapes.length === 0 && !crop;
    button('zoom-out').disabled = zoom === ZOOMS[0];
    button('zoom-in').disabled = zoom === ZOOMS[ZOOMS.length - 1];
    zoomValue.textContent = `${Math.round(zoom * 100)}%`;
    sizeInput.disabled = mode !== 'marker';
    straight.disabled = mode !== 'marker';
    modeButtons.forEach((other) => other.setAttribute('aria-pressed', String(other.dataset.mode === mode)));
  };

  /** A finished change: a new step in the history. @param {Drawing} next @param {number} [select] @param {string} [tag] */
  const apply = (next, select = selected, tag = '') => {
    history = commit(history, next, tag);
    saved = false;
    draft = null;
    selected = select;
    hideResult();
    render();
  };

  /** @param {(history: History) => History} step */
  const travel = (step) => {
    history = step(history);
    saved = false;
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
    // Covering that wasn't saved would be lost: ask first, in the page.
    if (image && unsavedWork(history, saved)) {
      pending = chosen;
      replace.hidden = false;
      // The safe answer has the focus: Enter or Space must not throw the work away.
      /** @type {HTMLButtonElement} */ (find('replace-no')).focus();
      return;
    }
    pending = null;
    replace.hidden = true;
    image?.close();
    image = null;
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
    // PNG stays PNG (screenshots keep sharp text); everything else is saved as JPEG.
    type = chosen.type === 'image/png' ? 'image/png' : 'image/jpeg';
    const size = exportSize(image.width, image.height);
    message.textContent = [
      size.scaled ? fillText(message.dataset.resized, { w: String(size.width), h: String(size.height) }) : '',
      moving ? (message.dataset.animated ?? '') : '',
    ]
      .filter(Boolean)
      .join(' ');
    history = createHistory({ shapes: [], crop: null });
    saved = false;
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
  find('replace-yes').addEventListener('click', () => {
    const next = pending;
    saved = true; // The visitor chose to let the covering go.
    if (next) open(next);
  });
  find('replace-no').addEventListener('click', () => {
    pending = null;
    replace.hidden = true;
    // Forget the file that wasn't opened: its name no longer shows, and choosing it again fires a change.
    file.value = '';
    canvas.focus();
  });
  find('example').addEventListener('click', async () => {
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
  /** Where a pointer is, as fractions of the image. @param {PointerEvent} event */
  const point = (event) => {
    const area = canvas.getBoundingClientRect();
    return { x: (event.clientX - area.left) / area.width, y: (event.clientY - area.top) / area.height };
  };
  /**
   * A distance on screen as fractions of the image, never less than one of
   * the image's own pixels: sizes and steps look the same at every zoom.
   * @param {number} pixels  CSS pixels.
   */
  const onScreen = (pixels) => {
    const area = canvas.getBoundingClientRect();
    const [width, height] = [area.width || canvas.width, area.height || canvas.height];
    return { x: Math.max(pixels / width, 1 / (image?.width ?? 1)), y: Math.max(pixels / height, 1 / (image?.height ?? 1)) };
  };
  const minBox = () => onScreen(MIN_SCREEN);
  /** How close to a handle counts: 24 px across for a mouse (WCAG 2.5.8), more for a fingertip. @param {PointerEvent} event */
  const reach = (event) => onScreen(event.pointerType === 'mouse' ? 12 : 20);
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
    // Only a left button, a pen or a finger: a right-click's release may never reach the canvas.
    if (!image || event.button !== 0) return;
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    // Every pointer is captured, so its release or loss always comes back here.
    try {
      canvas.setPointerCapture(event.pointerId);
    } catch (error) {
      console.warn('[lockwell] Could not follow this pointer outside the image.', error);
    }
    if (pointers.size > 1) {
      // A second finger: this is a pan or a pinch, not a drawing.
      draft = null;
      gesture = { kind: 'pan', zoom, distance: spread() };
      render();
      return;
    }
    if (!event.isPrimary) return;
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
      // Fingers moving apart or together: zoom in steps. Once one has lifted, the zoom stays where it is.
      if (pointers.size < 2) return;
      const next = pinchZoom(gesture.zoom, gesture.distance, spread());
      if (next !== zoom) setZoom(next);
      return;
    }
    if (gesture.kind === 'stroke') {
      const { points } = gesture.line;
      if (straight.checked || event.shiftKey) {
        // One straight line from where the stroke began, for covering a line of text.
        gesture.line.points = [points[0], straightEnd(points[0], at, aspect())];
        draft = { ...currentDrawing(history), shapes: [...currentDrawing(history).shapes, gesture.line] };
        render();
        return;
      }
      const last = points[points.length - 1];
      const next = { x: clamp(at.x), y: clamp(at.y) };
      // Skip movements too small to see: long strokes stay light.
      if (Math.hypot(next.x - last.x, next.y - last.y) < 0.002) return;
      points.push(next);
    } else if (gesture.kind === 'draw') {
      const box = boxFromDrag(gesture.from, at, minBox());
      if (mode === 'crop') draft = box ? { shapes, crop: box } : null;
      else draft = box ? { crop, shapes: [...shapes, { type: mode === 'ellipse' ? 'ellipse' : 'box', ...box }] } : null;
    } else if (gesture.kind === 'move') {
      const [dx, dy] = [at.x - gesture.from.x, at.y - gesture.from.y];
      gesture.moved = true;
      if (mode === 'crop') draft = { shapes, crop: crop && moveBox(crop, dx, dy) };
      else draft = { crop, shapes: shapes.map((shape, index) => (index === selected ? moveShape(shape, dx, dy) : shape)) };
    } else {
      const { handle } = gesture;
      changeTarget((box) => resizeFromHandle(box, handle, at, minBox()));
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
  // Capture lost without a release (the tab hid, the element changed): the pointer is gone all the same.
  canvas.addEventListener('lostpointercapture', endGesture);

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

  /**
   * Moves or resizes the selected shape (or the crop) by one step: from the
   * arrow keys, and from the buttons for those who can't drag.
   * @param {number} x  -1, 0 or 1.
   * @param {number} y
   * @param {boolean} resize
   */
  const nudge = (x, y, resize) => {
    const { shapes, crop } = currentDrawing(history);
    const shape = mode === 'crop' ? null : shapes[selected];
    const step = onScreen(STEP_SCREEN);
    const [dx, dy] = [x * step.x, y * step.y];
    const tag = `${resize ? 'resize' : 'move'}:${mode === 'crop' ? 'crop' : selected}`;
    if (mode === 'crop' && crop) {
      apply({ shapes, crop: resize ? resizeBox(crop, dx, dy, minBox()) : moveBox(crop, dx, dy) }, selected, tag);
    } else if (shape) {
      const changed = resize && shape.type !== 'line' ? resizeBox(shape, dx, dy, minBox()) : moveShape(shape, dx, dy);
      apply({ crop, shapes: shapes.map((other, index) => (index === selected ? changed : other)) }, selected, tag);
    }
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
      const [x, y] = arrows[/** @type {keyof typeof arrows} */ (event.key)];
      nudge(x, y, event.shiftKey);
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
  button('add').addEventListener('click', addInMiddle);
  for (const [name, x, y, resize] of /** @type {const} */ ([
    ['move-left', -1, 0, false], ['move-right', 1, 0, false], ['move-up', 0, -1, false], ['move-down', 0, 1, false],
    ['narrower', -1, 0, true], ['wider', 1, 0, true], ['shorter', 0, -1, true], ['taller', 0, 1, true],
  ])) {
    button(name).addEventListener('click', () => nudge(x, y, resize));
  }

  /* ---------- Result ---------- */

  /** @param {string | undefined} text @param {'ok' | 'warn'} state */
  const showVerdict = (text, state) => {
    verified.textContent = text ?? '';
    verified.dataset.state = state;
  };

  button('check').addEventListener('click', async () => {
    if (!image) return;
    // What is being checked. Anything that changes it while the copy is made makes this result stale.
    const [ticket, picture, steps] = [++checks, image, history];
    const stale = () => ticket !== checks || image !== picture || history !== steps;
    const { shapes, crop } = currentDrawing(history);
    const frame = outputFrame(picture.width, picture.height, crop);
    const made = document.createElement('canvas');
    made.width = frame.width;
    made.height = frame.height;
    resultStatus.textContent = '';
    if (message.textContent === message.dataset.encodeFailed) message.textContent = '';
    /** @type {{ checked: number, thin: number, solid: boolean }} */
    let check;
    /** @type {Blob} */
    let blob;
    let readable = true;
    try {
      // Boxes grow by a preview pixel, so the copy covers at least what the editor showed.
      paint(made, picture, shapes, frame, previewGrow(picture.width, picture.height));
      blob = await encode(made, type);
      // Show the encoded file itself, not the editor's idea of it, and check it pixel by pixel.
      const decoded = await createImageBitmap(blob);
      if (stale()) {
        decoded.close();
        release(made);
        return;
      }
      Object.assign(resultCanvas, previewSize(decoded.width, decoded.height, 1));
      resultCanvas.getContext('2d')?.drawImage(decoded, 0, 0, resultCanvas.width, resultCanvas.height);
      readable = canReadBack();
      const pixels = readable ? pixelsOf(decoded, frame.width, frame.height) : null;
      decoded.close();
      // JPEG lightens the outline of a covered area a little (measured); PNG keeps every pixel.
      check = pixels ? checkCovered(pixels, shapes, picture, frame, type === 'image/png' ? 0 : JPEG_EDGE) : { checked: 0, thin: 0, solid: false };
    } catch (error) {
      release(made);
      if (stale()) return;
      console.error('[lockwell] The covered copy could not be created.', error);
      message.textContent = message.dataset.encodeFailed ?? '';
      return;
    }
    if (stale()) {
      release(made);
      return;
    }
    hideResult();
    if (check.solid) {
      output = { canvas: made, blob, shapes, frame };
    } else {
      release(made);
    }
    resultInfo.textContent = `${frame.width} × ${frame.height} · ${type === 'image/png' ? 'PNG' : 'JPEG'}`;
    if (!readable) {
      showVerdict(verified.dataset.blocked, 'warn');
    } else if (!check.solid) {
      showVerdict(verified.dataset.failed, 'warn');
    } else if (!check.checked && !check.thin) {
      showVerdict(verified.dataset.empty, 'warn');
    } else {
      const claim = type === 'image/png' ? verified.dataset.ok : verified.dataset.okJpeg;
      showVerdict([claim, check.thin ? verified.dataset.thin : ''].filter(Boolean).join(' '), check.checked && !check.thin ? 'ok' : 'warn');
    }
    button('copy').hidden = !check.solid;
    if (check.solid) save.offer({ blob, original: name, extension: type === 'image/png' ? 'png' : 'jpg', fallback: 'image', suffix: 'redacted' });
    else save.clear();
    result.hidden = false;
    // Not while the visitor is answering whether to open another picture.
    if (replace.hidden) result.focus();
  });

  /**
   * The checked copy as PNG, the one format clipboards take: the saved file
   * itself when it is a PNG, otherwise a PNG made from it and checked the same way.
   * @param {NonNullable<typeof output>} copy
   * @returns {Promise<Blob>}
   */
  const checkedPng = async (copy) => {
    if (type === 'image/png') return copy.blob;
    const png = await encode(copy.canvas, 'image/png');
    const decoded = await createImageBitmap(png);
    try {
      const pixels = pixelsOf(decoded, copy.frame.width, copy.frame.height);
      if (!image || !checkCovered(pixels, copy.shapes, image, copy.frame, 0).solid) throw new Error('The PNG made for the clipboard did not pass the check, so it was not copied.');
    } finally {
      decoded.close();
    }
    return png;
  };

  const copyButton = button('copy');
  copyButton.addEventListener('click', async () => {
    if (!output) return;
    let copied = true;
    try {
      // The promise form keeps the copy inside this click on Safari.
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': checkedPng(output) })]);
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
}

// @ts-check
/**
 * @file Sign and stamp, the pure part (plan docs/tools-plan/pdf-toolkit.md §7): what an overlay is, where it lands on
 * a page for every rotation, and how it is written into the page as content (not an annotation), so every viewer
 * shows and prints it. Drawn signatures and marks are vector paths; text, dates, stamps and photos of a signature are
 * an 8-bit mask of their ink drawn in one colour (research log §21). Also the ink of a photographed signature, found
 * from its pixels. No canvas here: pdf-raster.mjs makes the masks.
 */
import { PdfDict, PdfName, PdfRef, PdfStream, formatNumber } from './pdf-syntax.mjs';

/** @typedef {import('./box.mjs').Box} Box */
/** @typedef {import('./box.mjs').Point} Point */
/** @typedef {import('./pdf-write.mjs').PdfWriter} PdfWriter */

/**
 * @typedef {'black' | 'blue'} Ink
 * @typedef {'site' | 'serif' | 'cursive'} FontKey  `cursive` is the device's handwriting-style font, whatever it is.
 * @typedef {{ width: number, height: number, data: Uint8Array }} Mask  8-bit coverage, rows from the top.
 * @typedef {Box & { rotation: number, opacity: number }} Placed  Fractions of the page as shown (after its
 *   rotation, inside its visible box), y from the top; `rotation` in degrees clockwise about the box's centre.
 * @typedef {Placed & { type: 'ink', strokes: Point[][], width: number, color: Ink }} InkOverlay  Points as fractions
 *   of the box (y from the top); `width`: the pen, as a fraction of the box's height.
 * @typedef {Placed & { type: 'picture', mask: Mask, color: Ink }} PictureOverlay  A photographed signature's ink.
 * @typedef {Placed & { type: 'text', text: string, font: FontKey, bold: boolean, color: Ink, mask: Mask }} TextOverlay
 * @typedef {Placed & { type: 'mark', mark: 'tick' | 'cross', color: Ink }} MarkOverlay
 * @typedef {Placed & { type: 'stamp', text: string, color: Ink, mask: Mask }} StampOverlay
 * @typedef {InkOverlay | PictureOverlay | TextOverlay | MarkOverlay | StampOverlay} Overlay
 * @typedef {{ box: number[], rotate: number }} ShownPage  The visible box in user space and the total rotation.
 */

/** Ink colours, RGB 0–1: black, and a dark blue that copies and scans tell from a printed black. */
export const INKS = { black: [0, 0, 0], blue: [0.08, 0.2, 0.6] };
/** A stamp's default transparency, so the page shows through. */
export const STAMP_OPACITY = 0.35;
/** The pen of a tick or cross, as a fraction of its box's shorter side. */
export const MARK_PEN = 0.12;
/** A tick and a cross, as strokes in box fractions (y from the top). */
export const MARKS = {
  tick: [[{ x: 0.08, y: 0.55 }, { x: 0.38, y: 0.86 }, { x: 0.92, y: 0.14 }]],
  cross: [[{ x: 0.12, y: 0.12 }, { x: 0.88, y: 0.88 }], [{ x: 0.88, y: 0.12 }, { x: 0.12, y: 0.88 }]],
};

/* ---------- Geometry ---------- */

/** @typedef {number[]} Matrix  [a b c d e f]: x' = a·x + c·y + e, y' = b·x + d·y + f (ISO 32000-1 §8.3.4). */

/**
 * The matrix that applies `first`, then `second`.
 * @param {Matrix} first @param {Matrix} second @returns {Matrix}
 */
export function then([a1, b1, c1, d1, e1, f1], [a2, b2, c2, d2, e2, f2]) {
  return [a1 * a2 + b1 * c2, a1 * b2 + b1 * d2, c1 * a2 + d1 * c2, c1 * b2 + d1 * d2, e1 * a2 + f1 * c2 + e2, e1 * b2 + f1 * d2 + f2];
}

/** @param {Matrix} m @param {Point} p @returns {Point} */
export const apply = (m, { x, y }) => ({ x: m[0] * x + m[2] * y + m[4], y: m[1] * x + m[3] * y + m[5] });

/** The page as shown: its size in points, turned by its rotation. @param {ShownPage} page */
export function shownSize({ box, rotate }) {
  const [w, h] = [box[2] - box[0], box[3] - box[1]];
  return rotate % 180 === 0 ? { width: w, height: h } : { width: h, height: w };
}

/**
 * From points on the page as shown (x right, y down from the top left) to the page's user space. A viewer turns the
 * page clockwise by `rotate`; this undoes it, so each rotation is a reflection plus a turn and nothing is scaled.
 * @param {ShownPage} page @returns {Matrix}
 */
export function shownToUser({ box: [x0, y0, x1, y1], rotate }) {
  switch (((rotate % 360) + 360) % 360) {
    case 90:
      return [0, 1, 1, 0, x0, y0];
    case 180:
      return [-1, 0, 0, 1, x1, y0];
    case 270:
      return [0, -1, -1, 0, x1, y1];
    default:
      return [1, 0, 0, -1, x0, y1];
  }
}

/**
 * From an overlay's unit square (u right, v up, as images are drawn) to user space: into its box on the shown page,
 * turned about the box's centre, then onto the page.
 * @param {Placed} overlay @param {ShownPage} page @returns {Matrix}
 */
export function overlayMatrix(overlay, page) {
  const { width, height } = shownSize(page);
  const [bx, by, bw, bh] = [overlay.x * width, overlay.y * height, overlay.w * width, overlay.h * height];
  const local = [bw, 0, 0, -bh, bx, by + bh];
  const angle = (overlay.rotation * Math.PI) / 180;
  const [cos, sin] = [Math.cos(angle), Math.sin(angle)];
  const [cx, cy] = [bx + bw / 2, by + bh / 2];
  const turn = [cos, sin, -sin, cos, cx - cx * cos + cy * sin, cy - cx * sin - cy * cos];
  return then(then(local, turn), shownToUser(page));
}

/**
 * Overlays on a page turned a quarter: each keeps its size and turns with the page, its centre moving with the page.
 * @template {Overlay} T
 * @param {T[]} overlays @param {90 | -90} delta  Clockwise as shown.
 * @param {{ width: number, height: number }} size  The page as shown before the turn.
 * @returns {T[]}
 */
export function turnOverlays(overlays, delta, { width, height }) {
  return overlays.map((overlay) => {
    const [cx, cy] = [overlay.x + overlay.w / 2, overlay.y + overlay.h / 2];
    const [nx, ny] = delta === 90 ? [1 - cy, cx] : [cy, 1 - cx];
    // Same size in points on a page whose width and height swapped.
    const [w, h] = [(overlay.w * width) / height, (overlay.h * height) / width];
    const rotation = ((((overlay.rotation + delta + 180) % 360) + 360) % 360) - 180;
    return { ...overlay, x: nx - w / 2, y: ny - h / 2, w, h, rotation };
  });
}

/* ---------- Content ---------- */

/** @param {number} n */
const num = (n) => formatNumber(Math.round(n * 1000) / 1000);

/**
 * Strokes in box fractions (y from the top) as one path in user space, drawn with round ends and joins.
 * @param {Point[][]} strokes @param {Matrix} m  The overlay's matrix (unit square, v up).
 */
function strokePath(strokes, m) {
  const out = [];
  for (const stroke of strokes) {
    if (stroke.length === 0) continue;
    const points = stroke.map((p) => apply(m, { x: p.x, y: 1 - p.y }));
    out.push(`${num(points[0].x)} ${num(points[0].y)} m`);
    // A single point is a dot: a line of no length, which round caps draw as a disc.
    for (const p of points.length === 1 ? points : points.slice(1)) out.push(`${num(p.x)} ${num(p.y)} l`);
  }
  return out.join('\n');
}

/**
 * The image object for a mask: a 1 × 1 picture of the ink's colour with the mask as its soft mask (ISO 32000-1
 * §11.6.5.3: without Matte, the two sizes are independent).
 * @param {PdfWriter} writer @param {Mask} mask @param {Ink} color
 */
async function maskImage(writer, mask, color) {
  const soft = writer.reserve();
  await writer.setStream(soft, new PdfStream(new PdfDict([
    ['Type', new PdfName('XObject')], ['Subtype', new PdfName('Image')], ['Width', mask.width], ['Height', mask.height],
    ['ColorSpace', new PdfName('DeviceGray')], ['BitsPerComponent', 8],
  ]), mask.data));
  const image = writer.reserve();
  await writer.setStream(image, new PdfStream(new PdfDict([
    ['Type', new PdfName('XObject')], ['Subtype', new PdfName('Image')], ['Width', 1], ['Height', 1],
    ['ColorSpace', new PdfName('DeviceRGB')], ['BitsPerComponent', 8], ['SMask', soft],
  ]), Uint8Array.from(INKS[color], (value) => Math.round(value * 255))));
  return image;
}

/**
 * A dictionary of the page's resources that this page may change: a copy, since resources are often shared.
 * @param {PdfWriter} writer @param {import('./pdf-syntax.mjs').PdfObject | undefined} value
 */
function ownCopy(writer, value) {
  const found = value instanceof PdfRef ? writer.get(value) : value;
  return new PdfDict(found instanceof PdfDict ? [...found.entries()] : []);
}

/**
 * Writes overlays into a page dictionary already in the writer's hands: the page's own content is wrapped in q … Q
 * (a page that leaves its graphics state changed cannot move our drawing), one stream is added after it, and the new
 * resources go into copies of the page's dictionaries under names nothing else uses.
 * @param {PdfWriter} writer @param {PdfDict} dict @param {ShownPage} page @param {Overlay[]} overlays
 */
export async function applyOverlays(writer, dict, page, overlays) {
  if (overlays.length === 0) return;
  const resources = ownCopy(writer, dict.get('Resources'));
  const xobjects = ownCopy(writer, resources.get('XObject'));
  const states = ownCopy(writer, resources.get('ExtGState'));
  /** @param {PdfDict} where @param {string} prefix */
  const fresh = (where, prefix) => {
    let n = 1;
    while (where.has(`${prefix}${n}`)) n += 1;
    return `${prefix}${n}`;
  };
  const ops = ['Q'];
  for (const overlay of overlays) {
    const m = overlayMatrix(overlay, page);
    const { width, height } = shownSize(page);
    ops.push('q');
    if (overlay.opacity < 1) {
      const name = fresh(states, 'LwG');
      states.set(name, new PdfDict([['Type', new PdfName('ExtGState')], ['ca', overlay.opacity], ['CA', overlay.opacity]]));
      ops.push(`/${name} gs`);
    }
    if (overlay.type === 'ink' || overlay.type === 'mark') {
      const [r, g, b] = INKS[overlay.color];
      const [bw, bh] = [overlay.w * width, overlay.h * height];
      const pen = overlay.type === 'ink' ? overlay.width * bh : MARK_PEN * Math.min(bw, bh);
      ops.push(`${num(r)} ${num(g)} ${num(b)} RG ${num(pen)} w 1 J 1 j`, strokePath(overlay.type === 'ink' ? overlay.strokes : MARKS[overlay.mark], m), 'S');
    } else {
      const name = fresh(xobjects, 'LwO');
      xobjects.set(name, await maskImage(writer, overlay.mask, overlay.color));
      ops.push(`${m.map(num).join(' ')} cm /${name} Do`);
    }
    ops.push('Q');
  }
  if (xobjects.size > 0) resources.set('XObject', xobjects);
  if (states.size > 0) resources.set('ExtGState', states);
  const before = writer.reserve();
  await writer.setStream(before, new PdfStream(new PdfDict(), Uint8Array.of(0x71, 0x0a)));
  const after = writer.reserve();
  const text = `${ops.join('\n')}\n`;
  await writer.setStream(after, new PdfStream(new PdfDict(), Uint8Array.from(text, (char) => char.charCodeAt(0))));
  const contents = dict.get('Contents');
  dict.set('Contents', [before, ...(Array.isArray(contents) ? contents : contents ? [contents] : []), after]);
  dict.set('Resources', resources);
}

/* ---------- Ink from a photo of a signature ---------- */

/**
 * The ink of a photographed signature: dark pixels become coverage (the darker, the more), the paper becomes nothing,
 * and the result is cropped to the ink with a small margin.
 * @param {Uint8ClampedArray | Uint8Array} rgba @param {number} width @param {number} height
 * @param {number} threshold  0–255: lighter than this is paper.
 * @returns {Mask | null}  null when nothing is dark enough.
 */
export function inkMask(rgba, width, height, threshold) {
  const alpha = new Uint8Array(width * height);
  let [left, top, right, bottom] = [width, height, -1, -1];
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = (y * width + x) * 4;
      // Rec. 709 luma, weighted by the pixel's own alpha (a transparent pixel is paper).
      const luma = (0.2126 * rgba[i] + 0.7152 * rgba[i + 1] + 0.0722 * rgba[i + 2]) * (rgba[i + 3] / 255) + 255 * (1 - rgba[i + 3] / 255);
      if (luma >= threshold) continue;
      const value = Math.round(Math.min(1, (threshold - luma) / Math.max(1, threshold * 0.6)) * 255);
      if (value === 0) continue;
      alpha[y * width + x] = value;
      [left, top, right, bottom] = [Math.min(left, x), Math.min(top, y), Math.max(right, x), Math.max(bottom, y)];
    }
  }
  if (right < 0) return null;
  const pad = Math.round(Math.max(right - left, bottom - top) * 0.02);
  [left, top, right, bottom] = [Math.max(0, left - pad), Math.max(0, top - pad), Math.min(width - 1, right + pad), Math.min(height - 1, bottom + pad)];
  const [w, h] = [right - left + 1, bottom - top + 1];
  const data = new Uint8Array(w * h);
  for (let y = 0; y < h; y += 1) data.set(alpha.subarray((top + y) * width + left, (top + y) * width + left + w), y * w);
  return { width: w, height: h, data };
}

/**
 * Drawn strokes made smoother (one round of corner cutting, ends kept) and fitted into a box of their own: the
 * strokes as fractions of it, and its shape.
 * @param {Point[][]} strokes  In any units, y down.
 * @param {number} pen  The pen's width in the same units.
 * @returns {{ strokes: Point[][], ratio: number, width: number } | null}  ratio: width ÷ height; width: the pen as a
 *   fraction of the box's height. null when nothing was drawn.
 */
export function fitStrokes(strokes, pen) {
  const finite = strokes.map((stroke) => stroke.filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y)));
  const smooth = finite.filter((stroke) => stroke.length > 0).map((stroke) => {
    if (stroke.length < 3) return stroke;
    const out = [stroke[0]];
    for (let i = 0; i < stroke.length - 1; i += 1) {
      const [a, b] = [stroke[i], stroke[i + 1]];
      out.push({ x: 0.75 * a.x + 0.25 * b.x, y: 0.75 * a.y + 0.25 * b.y }, { x: 0.25 * a.x + 0.75 * b.x, y: 0.25 * a.y + 0.75 * b.y });
    }
    out.push(stroke[stroke.length - 1]);
    return out;
  });
  const all = smooth.flat();
  if (all.length === 0) return null;
  const half = pen / 2;
  const [left, top] = [Math.min(...all.map((p) => p.x)) - half, Math.min(...all.map((p) => p.y)) - half];
  const [w, h] = [Math.max(...all.map((p) => p.x)) + half - left, Math.max(...all.map((p) => p.y)) + half - top];
  return { strokes: smooth.map((stroke) => stroke.map((p) => ({ x: (p.x - left) / w, y: (p.y - top) / h }))), ratio: w / h, width: pen / h };
}

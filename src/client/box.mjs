// @ts-check
/**
 * @file Boxes on a picture, as fractions of it: drawing, moving and resizing them by their handles. Shared by the image tools.
 */

/**
 * A rectangle as fractions of the image (0 to 1), so it means the same on
 * the small preview and on the full-size copy.
 * @typedef {{ x: number, y: number, w: number, h: number }} Box
 */
/** @typedef {{ x: number, y: number }} Point */
/** @typedef {'nw' | 'ne' | 'se' | 'sw' | 'n' | 'e' | 's' | 'w'} Handle */

/** Smallest box side when no screen size is known, as a fraction of the image. */
const MIN_SIDE = 0.01;

/** @param {number} value */
export const clamp = (value) => Math.min(1, Math.max(0, value));

/** @type {Point} */
const MIN_BOX = { x: MIN_SIDE, y: MIN_SIDE };

/**
 * The box between two corners of a drag, kept inside the image.
 * @param {Point} from
 * @param {Point} to
 * @param {Point} [min]  Smallest side in each direction, as fractions of the image (see `screenFraction`).
 * @returns {Box | null}  null when the drag was too small to be a box.
 */
export function boxFromDrag(from, to, min = MIN_BOX) {
  const [x1, x2] = [clamp(Math.min(from.x, to.x)), clamp(Math.max(from.x, to.x))];
  const [y1, y2] = [clamp(Math.min(from.y, to.y)), clamp(Math.max(from.y, to.y))];
  const box = { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
  return box.w >= min.x && box.h >= min.y ? box : null;
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
 * @param {Point} [min]  Smallest side in each direction, as fractions of the image.
 * @returns {T}  The same corner, resized between the smallest size and the image's edge.
 */
export function resizeBox(box, dw, dh, min = MIN_BOX) {
  return { ...box, w: Math.min(1 - box.x, Math.max(min.x, box.w + dw)), h: Math.min(1 - box.y, Math.max(min.y, box.h + dh)) };
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
 * @param {Point} [min]  Smallest side in each direction, as fractions of the image.
 * @returns {T}
 */
export function resizeFromHandle(box, handle, point, min = MIN_BOX) {
  let [left, top, right, bottom] = [box.x, box.y, box.x + box.w, box.y + box.h];
  if (handle.includes('w')) left = clamp(Math.min(point.x, right - min.x));
  if (handle.includes('e')) right = clamp(Math.max(point.x, left + min.x));
  if (handle.includes('n')) top = clamp(Math.min(point.y, bottom - min.y));
  if (handle.includes('s')) bottom = clamp(Math.max(point.y, top + min.y));
  return { ...box, x: left, y: top, w: right - left, h: bottom - top };
}

// @ts-check
/**
 * @file The photo editor's description of an edit (Doc) and the geometry that turns it into pixels.
 */
/**
 * Nothing is ever applied to the picture while editing: the screen and the
 * saved file are both drawn from the original through this description, so
 * every step can be undone and nothing degrades.
 *
 * Two spaces:
 * - oriented: the picture after its quarter turns and flips. The crop lives here.
 * - output: what is saved, the crop frame filled edge to edge.
 * The crop frame stays upright while the picture turns under it by `angle`
 * (straightening, as on a phone), so the crop is stored as its centre, in
 * fractions of the oriented picture, and its size, in fractions of the
 * oriented picture's width and height.
 */
import { exportSize } from './canvas.mjs';
import { apply, compose, invert, rotate, scale, translate, turn } from './editor-matrix.mjs';

/** @typedef {import('./box.mjs').Box} Box */
/** @typedef {import('./editor-matrix.mjs').Matrix} Matrix */
/** @typedef {{ width: number, height: number }} Size */
/**
 * @typedef {object} Doc
 * @property {0 | 1 | 2 | 3} quarter  Quarter turns, clockwise.
 * @property {boolean} flipX  Mirrored left to right, after the turns.
 * @property {boolean} flipY  Mirrored top to bottom, after the turns.
 * @property {number} angle  Straightening in degrees, MAX_ANGLE either way; positive turns the picture clockwise.
 * @property {Box | null} crop  The crop as the visitor left it; null: the whole picture. See effectiveCrop.
 * @property {Size | null} size  Pixels of the saved copy; null: the crop's own size.
 */

export const MAX_ANGLE = 45;
/** @type {Box} */
const WHOLE = { x: 0, y: 0, w: 1, h: 1 };

/** @returns {Doc} */
export const emptyDoc = () => ({ quarter: 0, flipX: false, flipY: false, angle: 0, crop: null, size: null });

/** True when a description leaves the picture as it was opened. @param {Doc} doc */
export const isUnchanged = (doc) => JSON.stringify(doc) === JSON.stringify(emptyDoc());

/** @param {number} degrees */
const radians = (degrees) => (degrees * Math.PI) / 180;

/**
 * The picture's size after its quarter turns.
 * @param {Doc} doc
 * @param {Size} source
 * @returns {Size}
 */
export const orientedSize = (doc, source) => (doc.quarter % 2 ? { width: source.height, height: source.width } : { width: source.width, height: source.height });

/**
 * Source pixels to oriented pixels: turned about the middle, then mirrored.
 * @param {Doc} doc
 * @param {Size} source
 */
export function orientMatrix(doc, source) {
  const { width, height } = orientedSize(doc, source);
  return compose(translate(width / 2, height / 2), scale(doc.flipX ? -1 : 1, doc.flipY ? -1 : 1), turn(doc.quarter), translate(-source.width / 2, -source.height / 2));
}

/* ---------- The crop under a straightened picture ---------- */

/**
 * The size of the box around a picture turned by `angle`.
 * @param {Size} size
 * @param {number} angle  Degrees.
 * @returns {Size}
 */
export function rotatedBounds({ width, height }, angle) {
  const [cos, sin] = [Math.abs(Math.cos(radians(angle))), Math.abs(Math.sin(radians(angle)))];
  return { width: width * cos + height * sin, height: width * sin + height * cos };
}

/**
 * Where the crop frame's corners fall on the oriented picture, as offsets
 * from its centre in pixels.
 * @param {Box} crop
 * @param {number} angle
 * @param {Size} size  The oriented picture.
 */
function frameCorners(crop, angle, { width, height }) {
  // The frame is upright on screen and the picture turned by `angle`, so on the picture the frame is turned back.
  const back = rotate(-radians(angle));
  const [hw, hh] = [(crop.w * width) / 2, (crop.h * height) / 2];
  return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([sx, sy]) => apply(back, { x: sx * hw, y: sy * hh }));
}

/**
 * True when the whole crop frame lies on the picture: the saved copy has no empty corners.
 * @param {Box} crop
 * @param {number} angle
 * @param {Size} size  The oriented picture.
 */
export function cropFits(crop, angle, size) {
  const [cx, cy] = [(crop.x + crop.w / 2) * size.width, (crop.y + crop.h / 2) * size.height];
  const slack = 1e-6 * Math.max(size.width, size.height);
  return frameCorners(crop, angle, size).every(({ x, y }) => cx + x >= -slack && cx + x <= size.width + slack && cy + y >= -slack && cy + y <= size.height + slack);
}

/**
 * The crop made smaller about its centre, keeping its proportions, until it
 * lies on the picture. Never larger than it was.
 * @param {Box} crop
 * @param {number} angle
 * @param {Size} size  The oriented picture.
 * @returns {Box}
 */
export function fitCrop(crop, angle, size) {
  const cx = Math.min(1, Math.max(0, crop.x + crop.w / 2)) * size.width;
  const cy = Math.min(1, Math.max(0, crop.y + crop.h / 2)) * size.height;
  let factor = 1;
  for (const { x, y } of frameCorners(crop, angle, size)) {
    if (x > 0) factor = Math.min(factor, (size.width - cx) / x);
    if (x < 0) factor = Math.min(factor, -cx / x);
    if (y > 0) factor = Math.min(factor, (size.height - cy) / y);
    if (y < 0) factor = Math.min(factor, -cy / y);
  }
  const [w, h] = [crop.w * factor, crop.h * factor];
  return { x: cx / size.width - w / 2, y: cy / size.height - h / 2, w, h };
}

/**
 * The crop the saved copy uses: the visitor's, or the whole picture, made
 * small enough to lie on the straightened picture. Straightening back to
 * level gives the visitor's crop back.
 * @param {Doc} doc
 * @param {Size} source
 */
export const effectiveCrop = (doc, source) => fitCrop(doc.crop ?? WHOLE, doc.angle, orientedSize(doc, source));

/**
 * As far from `from` towards `to` as the crop can go and still lie on the
 * picture. `from` must lie on it. Boxes in between are blends of the two, so
 * a corner both share stays put and a shared proportion is kept.
 * @param {Box} from
 * @param {Box} to
 * @param {number} angle
 * @param {Size} size  The oriented picture.
 * @returns {Box}
 */
export function limitCrop(from, to, angle, size) {
  if (cropFits(to, angle, size)) return to;
  /** @param {number} t @returns {Box} */
  const blend = (t) => ({ x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t, w: from.w + (to.w - from.w) * t, h: from.h + (to.h - from.h) * t });
  let [low, high] = [0, 1];
  for (let step = 0; step < 30; step += 1) {
    const middle = (low + high) / 2;
    if (cropFits(blend(middle), angle, size)) low = middle;
    else high = middle;
  }
  return blend(low);
}

/**
 * Oriented pixels to the box around the straightened picture, which the
 * editor shows while cropping.
 * @param {number} angle
 * @param {Size} size  The oriented picture.
 */
export function boundsMatrix(angle, size) {
  const bounds = rotatedBounds(size, angle);
  return compose(translate(bounds.width / 2, bounds.height / 2), rotate(radians(angle)), translate(-size.width / 2, -size.height / 2));
}

/**
 * The crop frame as a box in fractions of the box around the straightened
 * picture: there it is upright, and the shared box functions can move it.
 * @param {Box} crop
 * @param {number} angle
 * @param {Size} size  The oriented picture.
 * @returns {Box}
 */
export function cropToView(crop, angle, size) {
  const bounds = rotatedBounds(size, angle);
  const centre = apply(boundsMatrix(angle, size), { x: (crop.x + crop.w / 2) * size.width, y: (crop.y + crop.h / 2) * size.height });
  const [w, h] = [(crop.w * size.width) / bounds.width, (crop.h * size.height) / bounds.height];
  return { x: centre.x / bounds.width - w / 2, y: centre.y / bounds.height - h / 2, w, h };
}

/**
 * The reverse of cropToView.
 * @param {Box} box
 * @param {number} angle
 * @param {Size} size  The oriented picture.
 * @returns {Box}
 */
export function cropFromView(box, angle, size) {
  const bounds = rotatedBounds(size, angle);
  const centre = apply(invert(boundsMatrix(angle, size)), { x: (box.x + box.w / 2) * bounds.width, y: (box.y + box.h / 2) * bounds.height });
  const [w, h] = [(box.w * bounds.width) / size.width, (box.h * bounds.height) / size.height];
  return { x: centre.x / size.width - w / 2, y: centre.y / size.height - h / 2, w, h };
}

/* ---------- Sizes and matrices ---------- */

/**
 * The crop's own size in pixels of the picture.
 * @param {Doc} doc
 * @param {Size} source
 * @returns {Size}
 */
export function cropSize(doc, source) {
  const crop = effectiveCrop(doc, source);
  const size = orientedSize(doc, source);
  return { width: Math.max(1, Math.round(crop.w * size.width)), height: Math.max(1, Math.round(crop.h * size.height)) };
}

/**
 * Size of the saved copy: the chosen size or the crop's own, within what a
 * canvas can hold.
 * @param {Doc} doc
 * @param {Size} source
 * @param {number} [maxPixels]
 */
export function outputSize(doc, source, maxPixels) {
  const { width, height } = doc.size ?? cropSize(doc, source);
  return exportSize(width, height, maxPixels);
}

/**
 * A chosen size kept for a changed crop: the same longer side, the crop's proportions.
 * @param {Size} size
 * @param {Size} crop
 * @returns {Size}
 */
export function keepLongSide(size, crop) {
  const factor = Math.max(size.width, size.height) / Math.max(crop.width, crop.height);
  return { width: Math.max(1, Math.round(crop.width * factor)), height: Math.max(1, Math.round(crop.height * factor)) };
}

/**
 * Source pixels to a canvas showing the saved copy, at any size.
 * @param {Doc} doc
 * @param {Size} source
 * @param {Size} target
 */
export function outputMatrix(doc, source, target) {
  const size = orientedSize(doc, source);
  const crop = effectiveCrop(doc, source);
  const [cw, ch] = [crop.w * size.width, crop.h * size.height];
  return compose(
    translate(target.width / 2, target.height / 2),
    scale(target.width / cw, target.height / ch),
    rotate(radians(doc.angle)),
    translate(-(crop.x + crop.w / 2) * size.width, -(crop.y + crop.h / 2) * size.height),
    orientMatrix(doc, source),
  );
}

/**
 * Source pixels to a canvas showing the whole straightened picture, for cropping.
 * @param {Doc} doc
 * @param {Size} source
 * @param {Size} target
 */
export function wholeMatrix(doc, source, target) {
  const size = orientedSize(doc, source);
  const bounds = rotatedBounds(size, doc.angle);
  return compose(scale(target.width / bounds.width, target.height / bounds.height), boundsMatrix(doc.angle, size), orientMatrix(doc, source));
}

/* ---------- Changes ---------- */

/**
 * A quarter turn of everything: the saved copy is the previous one, turned.
 * @param {Doc} doc
 * @param {1 | -1} direction  1: clockwise.
 * @returns {Doc}
 */
export function turnDoc(doc, direction) {
  const { crop } = doc;
  return {
    ...doc,
    quarter: /** @type {Doc['quarter']} */ ((doc.quarter + direction + 4) % 4),
    // Turning a mirrored picture is mirroring the turned one the other way.
    flipX: doc.flipY,
    flipY: doc.flipX,
    crop: crop && (direction === 1 ? { x: 1 - crop.y - crop.h, y: crop.x, w: crop.h, h: crop.w } : { x: crop.y, y: 1 - crop.x - crop.w, w: crop.h, h: crop.w }),
    size: doc.size && { width: doc.size.height, height: doc.size.width },
  };
}

/**
 * A mirror image of everything: the saved copy is the previous one, mirrored.
 * @param {Doc} doc
 * @param {'x' | 'y'} axis  x: left to right.
 * @returns {Doc}
 */
export function flipDoc(doc, axis) {
  const { crop } = doc;
  return {
    ...doc,
    flipX: axis === 'x' ? !doc.flipX : doc.flipX,
    flipY: axis === 'y' ? !doc.flipY : doc.flipY,
    angle: doc.angle ? -doc.angle : 0,
    crop: crop && (axis === 'x' ? { ...crop, x: 1 - crop.x - crop.w } : { ...crop, y: 1 - crop.y - crop.h }),
  };
}

/**
 * A straightening angle as the editor keeps it: within MAX_ANGLE, in tenths of a degree.
 * @param {number} angle
 */
export function cleanAngle(angle) {
  if (!Number.isFinite(angle)) return 0;
  return Math.round(Math.min(MAX_ANGLE, Math.max(-MAX_ANGLE, angle)) * 10) / 10 || 0;
}

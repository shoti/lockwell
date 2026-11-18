// @ts-check
/**
 * @file Text and drawings on top of the photo editor's picture: their geometry, as plain data.
 */
/**
 * Layers live on the turned picture (oriented space, see editor-doc.mjs).
 * Positions are fractions of its width and height; lengths (text size, line
 * thickness) are fractions of its longer side, which a quarter turn doesn't
 * change. Functions that need pixels take the picture's size.
 */

/** @typedef {{ x: number, y: number }} Point */
/** @typedef {{ width: number, height: number }} Size */
/** @typedef {'site' | 'sans' | 'serif' | 'mono'} FontKey */
/**
 * @typedef {object} TextLayer
 * @property {'text'} type
 * @property {number} x  Centre.
 * @property {number} y
 * @property {string} text  Line breaks as typed; no automatic wrapping.
 * @property {FontKey} font
 * @property {number} size  Font size, as a fraction of the longer side.
 * @property {boolean} bold
 * @property {boolean} italic
 * @property {'start' | 'center' | 'end'} align
 * @property {string} color
 * @property {number} opacity  0 to 1.
 * @property {string | null} outline  A colour, or none.
 * @property {string | null} background  A colour, or none.
 * @property {number} rotation  Degrees, clockwise.
 */
/**
 * @typedef {object} ShapeLayer
 * @property {'rect' | 'ellipse'} type
 * @property {number} x  Top left before rotating, fractions of width and height.
 * @property {number} y
 * @property {number} w
 * @property {number} h
 * @property {string} stroke
 * @property {number} width  Line thickness, as a fraction of the longer side.
 * @property {string | null} fill
 * @property {number} opacity
 * @property {number} rotation  Degrees, clockwise, about the middle.
 */
/** @typedef {{ type: 'line' | 'arrow', from: Point, to: Point, stroke: string, width: number, opacity: number }} LineLayer */
/** @typedef {{ type: 'pen', points: Point[], stroke: string, width: number, opacity: number }} PenLayer */
/** @typedef {TextLayer | ShapeLayer | LineLayer | PenLayer} Layer */
/**
 * A layer's outline in pixels of the turned picture: a rectangle, turned about its middle.
 * @typedef {{ cx: number, cy: number, w: number, h: number, rotation: number }} Frame
 */
/** @typedef {(text: string, font: string) => number} Measure  The width of a line of text in a canvas font, in pixels. */

/** Font families as a canvas takes them. The site font falls back by itself where it isn't loaded. */
export const FONTS = { site: '"FiraGO", sans-serif', sans: 'sans-serif', serif: 'serif', mono: 'monospace' };
/** Line height, as a multiple of the font size. */
const LEADING = 1.25;
/** Room around text inside its background box, as a multiple of the font size. */
export const TEXT_PADDING = 0.25;
/** The arrowhead's length, as a multiple of the line's thickness (and never shorter than 10 pixels). */
const ARROWHEAD = 4;

/** @param {Layer} layer @returns {layer is ShapeLayer} */
export const isShape = (layer) => layer.type === 'rect' || layer.type === 'ellipse';
/** @param {Layer} layer @returns {layer is LineLayer} */
export const isLine = (layer) => layer.type === 'line' || layer.type === 'arrow';

/** @param {number} degrees */
const radians = (degrees) => (degrees * Math.PI) / 180;
/** @param {Size} size */
const unit = (size) => Math.max(size.width, size.height);
/** @param {Point} point @param {number} degrees */
const turnPoint = ({ x, y }, degrees) => {
  const [cos, sin] = [Math.cos(radians(degrees)), Math.sin(radians(degrees))];
  return { x: x * cos - y * sin, y: x * sin + y * cos };
};

/**
 * Only #rrggbb colours reach the canvas; anything else becomes the fallback.
 * @param {unknown} value
 * @param {string} fallback
 */
export const cleanColor = (value, fallback) => (typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value) ? value.toLowerCase() : fallback);

/**
 * The canvas font of a text layer drawn at a size in pixels. The site font has no bold, only semibold.
 * @param {TextLayer} layer
 * @param {number} pixels
 */
export const canvasFont = (layer, pixels) => `${layer.italic ? 'italic ' : ''}${layer.bold ? (layer.font === 'site' ? 600 : 700) : 400} ${Math.max(1, pixels)}px ${FONTS[layer.font] ?? FONTS.sans}`;

/**
 * A text layer's lines and how much room they take, in pixels of the turned picture.
 * @param {TextLayer} layer
 * @param {Size} size
 * @param {Measure} measure
 */
export function textLines(layer, size, measure) {
  const pixels = layer.size * unit(size);
  const font = canvasFont(layer, pixels);
  const lines = layer.text.split(/\r?\n/);
  const widths = lines.map((line) => measure(line, font));
  const lineHeight = pixels * LEADING;
  return { lines, widths, font, pixels, lineHeight, width: Math.max(pixels * 0.5, ...widths), height: lineHeight * lines.length };
}

/**
 * The outline a layer is selected, moved and turned by.
 * @param {Layer} layer
 * @param {Size} size
 * @param {Measure} measure
 * @returns {Frame}
 */
export function layerFrame(layer, size, measure) {
  if (layer.type === 'text') {
    const { width, height, pixels } = textLines(layer, size, measure);
    const pad = layer.background ? 2 * TEXT_PADDING * pixels : 0;
    return { cx: layer.x * size.width, cy: layer.y * size.height, w: width + pad, h: height + pad, rotation: layer.rotation };
  }
  if (isShape(layer)) {
    return { cx: (layer.x + layer.w / 2) * size.width, cy: (layer.y + layer.h / 2) * size.height, w: layer.w * size.width, h: layer.h * size.height, rotation: layer.rotation };
  }
  const points = isLine(layer) ? [layer.from, layer.to] : layer.points;
  const xs = points.map((point) => point.x * size.width);
  const ys = points.map((point) => point.y * size.height);
  const [left, right, top, bottom] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  // Room for the line's own thickness, so a level line still has a height to grab.
  const pad = layer.width * unit(size);
  return { cx: (left + right) / 2, cy: (top + bottom) / 2, w: right - left + pad, h: bottom - top + pad, rotation: 0 };
}

/**
 * The four corners of a frame, clockwise from the top left as the layer sees it.
 * @param {Frame} frame
 * @returns {Point[]}
 */
export function frameCorners(frame) {
  return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([sx, sy]) => {
    const offset = turnPoint({ x: (sx * frame.w) / 2, y: (sy * frame.h) / 2 }, frame.rotation);
    return { x: frame.cx + offset.x, y: frame.cy + offset.y };
  });
}

/**
 * The distance from a point to a segment.
 * @param {Point} p
 * @param {Point} a
 * @param {Point} b
 */
function toSegment(p, a, b) {
  const [dx, dy] = [b.x - a.x, b.y - a.y];
  const along = dx || dy ? Math.min(1, Math.max(0, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy))) : 0;
  return Math.hypot(p.x - a.x - along * dx, p.y - a.y - along * dy);
}

/**
 * Whether a point (pixels of the turned picture) is on a layer. Lines and
 * strokes count within half their thickness plus `reach`; text and shapes
 * anywhere inside their turned outline.
 * @param {Layer} layer
 * @param {Point} point
 * @param {Size} size
 * @param {Measure} measure
 * @param {number} [reach]  Extra pixels around thin lines, for fingers.
 */
export function hitLayer(layer, point, size, measure, reach = 0) {
  if (!isShape(layer) && layer.type !== 'text') {
    const points = (isLine(layer) ? [layer.from, layer.to] : layer.points).map((p) => ({ x: p.x * size.width, y: p.y * size.height }));
    const limit = (layer.width * unit(size)) / 2 + reach;
    return points.some((a, index) => toSegment(point, a, points[index + 1] ?? a) <= limit);
  }
  const frame = layerFrame(layer, size, measure);
  const local = turnPoint({ x: point.x - frame.cx, y: point.y - frame.cy }, -frame.rotation);
  const [hw, hh] = [frame.w / 2 + reach, frame.h / 2 + reach];
  return Math.abs(local.x) <= hw && Math.abs(local.y) <= hh;
}

/**
 * Applies a change of pixel positions to every point that places a layer.
 * @template {Layer} T
 * @param {T} layer
 * @param {Size} size
 * @param {(point: Point) => Point} move  In pixels of the turned picture.
 * @returns {T}
 */
function movePoints(layer, size, move) {
  /** @param {Point} p */
  const map = (p) => {
    const moved = move({ x: p.x * size.width, y: p.y * size.height });
    return { x: moved.x / size.width, y: moved.y / size.height };
  };
  if (layer.type === 'text') return { ...layer, ...map(layer) };
  if (isShape(layer)) {
    const centre = map({ x: layer.x + layer.w / 2, y: layer.y + layer.h / 2 });
    return { ...layer, x: centre.x - layer.w / 2, y: centre.y - layer.h / 2 };
  }
  if (isLine(layer)) return { ...layer, from: map(layer.from), to: map(layer.to) };
  return { ...layer, points: layer.points.map(map) };
}

/**
 * @template {Layer} T
 * @param {T} layer
 * @param {number} dx  Pixels of the turned picture.
 * @param {number} dy
 * @param {Size} size
 * @returns {T}
 */
export const moveLayer = (layer, dx, dy, size) => movePoints(layer, size, (p) => ({ x: p.x + dx, y: p.y + dy }));

/**
 * The layer made larger or smaller by a factor, keeping its proportions, with
 * one point (a corner, or the middle) staying where it is.
 * @template {Layer} T
 * @param {T} layer
 * @param {number} factor
 * @param {Point} anchor  Pixels of the turned picture.
 * @param {Size} size
 * @returns {T}
 */
export function scaleLayer(layer, factor, anchor, size) {
  const moved = movePoints(layer, size, (p) => ({ x: anchor.x + (p.x - anchor.x) * factor, y: anchor.y + (p.y - anchor.y) * factor }));
  if (moved.type === 'text') return { ...moved, size: moved.size * factor };
  if (isShape(moved)) {
    // The middle moved with the anchor; the sides grow about it.
    const [w, h] = [moved.w * factor, moved.h * factor];
    return { ...moved, x: moved.x + (moved.w - w) / 2, y: moved.y + (moved.h - h) / 2, w, h };
  }
  return moved;
}

/**
 * The layer turned about the middle of its outline.
 * @template {Layer} T
 * @param {T} layer
 * @param {number} degrees  Clockwise.
 * @param {Size} size
 * @param {Measure} measure
 * @returns {T}
 */
export function rotateLayer(layer, degrees, size, measure) {
  if (layer.type === 'text' || isShape(layer)) return { ...layer, rotation: cleanRotation(layer.rotation + degrees) };
  const { cx, cy } = layerFrame(layer, size, measure);
  return movePoints(layer, size, (p) => {
    const turned = turnPoint({ x: p.x - cx, y: p.y - cy }, degrees);
    return { x: cx + turned.x, y: cy + turned.y };
  });
}

/**
 * An angle from -180 to 180, in tenths of a degree.
 * @param {number} degrees
 */
export function cleanRotation(degrees) {
  if (!Number.isFinite(degrees)) return 0;
  const wrapped = ((((degrees + 180) % 360) + 360) % 360) - 180;
  return Math.round(wrapped * 10) / 10 || 0;
}

/**
 * Layers moved with the picture when it is turned a quarter or mirrored, so
 * each stays on the same part of the picture. Text is moved, never mirrored:
 * a mirrored photo keeps a readable caption.
 * @param {Layer[]} layers
 * @param {{ turn: 1 | -1 } | { flip: 'x' | 'y' }} change
 * @returns {Layer[]}
 */
export function orientLayers(layers, change) {
  /** @type {(p: Point) => Point} */
  const map =
    'turn' in change
      ? change.turn === 1
        ? (p) => ({ x: 1 - p.y, y: p.x })
        : (p) => ({ x: p.y, y: 1 - p.x })
      : change.flip === 'x'
        ? (p) => ({ x: 1 - p.x, y: p.y })
        : (p) => ({ x: p.x, y: 1 - p.y });
  /** A turn adds or takes a quarter; a mirror reverses the direction. @param {number} rotation */
  const rotation = (rotation) => cleanRotation('turn' in change ? rotation + 90 * change.turn : -rotation);
  return layers.map((layer) => {
    if (layer.type === 'text') return { ...layer, ...map(layer), rotation: rotation(layer.rotation) };
    if (isShape(layer)) {
      const centre = map({ x: layer.x + layer.w / 2, y: layer.y + layer.h / 2 });
      const [w, h] = 'turn' in change ? [layer.h, layer.w] : [layer.w, layer.h];
      // A turned box keeps its own sides; it is the picture's sides that swap.
      return { ...layer, x: centre.x - w / 2, y: centre.y - h / 2, w, h, rotation: 'turn' in change ? layer.rotation : rotation(layer.rotation) };
    }
    if (isLine(layer)) return { ...layer, from: map(layer.from), to: map(layer.to) };
    return { ...layer, points: layer.points.map(map) };
  });
}

/**
 * The arrowhead of an arrow from `from` to `to` (pixels): its tip, its two
 * back corners, and where the line should stop so its round end doesn't show
 * past the head.
 * @param {Point} from
 * @param {Point} to
 * @param {number} thickness  Pixels.
 */
export function arrowHead(from, to, thickness) {
  const length = Math.max(10, ARROWHEAD * thickness);
  const distance = Math.hypot(to.x - from.x, to.y - from.y) || 1;
  const [ux, uy] = [(to.x - from.x) / distance, (to.y - from.y) / distance];
  const back = { x: to.x - ux * length, y: to.y - uy * length };
  const half = length * 0.55;
  return {
    tip: to,
    left: { x: back.x - uy * half, y: back.y + ux * half },
    right: { x: back.x + uy * half, y: back.y - ux * half },
    lineEnd: { x: to.x - ux * length * 0.6, y: to.y - uy * length * 0.6 },
  };
}

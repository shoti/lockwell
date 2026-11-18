// @ts-check
/**
 * @file The photo editor's drawing: the one path from the original picture to the screen and to the saved file.
 */
import { downscale, release } from './canvas.mjs';
import { colorPlan, isPlain, processBands, processPixels, radii } from './editor-color.mjs';
import { multiply, scale } from './editor-matrix.mjs';
import { outputMatrix } from './editor-doc.mjs';

/** @typedef {import('./editor-matrix.mjs').Matrix} Matrix */
/** @typedef {import('./editor-doc.mjs').Doc} Doc */
/** @typedef {CanvasImageSource & { width: number, height: number }} Picture */
/** @typedef {import('./editor-color.mjs').ColorPlan} ColorPlan */
/** @typedef {{ x: number, y: number, w: number, h: number }} Rect */
/** @typedef {{ jpeg: boolean }} RenderOptions  jpeg: the copy has no transparency, so see-through parts turn white, not black. */
/**
 * @typedef {object} AdjustOptions
 * @property {number} longSide  The copy's longer side in this canvas's pixels: blurs are measured against it.
 * @property {Rect} [frame]  Where the copy lies on the canvas (the crop frame while cropping); the whole canvas by default.
 * @property {number} [bandRows]
 * @property {() => Promise<unknown>} [pause]
 * @property {() => boolean} [stop]  True when the result is no longer wanted.
 */

/** Below this scale, the picture is first halved step by step (see downscale). */
const SMOOTH_LIMIT = 0.5;

/**
 * Draws a picture onto a whole canvas through a matrix (picture pixels to
 * canvas pixels). Whatever the picture doesn't cover is left clear, or white
 * for a JPEG.
 * @param {HTMLCanvasElement} target
 * @param {Picture} source
 * @param {Matrix} matrix
 * @param {RenderOptions} options
 */
export function drawPhoto(target, source, matrix, { jpeg }) {
  const context = target.getContext('2d');
  if (!context) throw new Error('This browser cannot draw on a canvas.');
  context.setTransform(1, 0, 0, 1, 0, 0);
  context.clearRect(0, 0, target.width, target.height);
  if (jpeg) {
    context.fillStyle = '#fff';
    context.fillRect(0, 0, target.width, target.height);
  }
  let [picture, through] = [source, matrix];
  /** @type {HTMLCanvasElement | null} */
  let smaller = null;
  // How much the matrix shrinks the picture, on average in both directions.
  const factor = Math.sqrt(Math.abs(matrix[0] * matrix[3] - matrix[1] * matrix[2]));
  if (factor < SMOOTH_LIMIT) {
    const [width, height] = [Math.max(1, Math.round(source.width * factor)), Math.max(1, Math.round(source.height * factor))];
    smaller = downscale(source, width, height);
    [picture, through] = [smaller, multiply(matrix, scale(source.width / width, source.height / height))];
  }
  try {
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';
    context.setTransform(...through);
    context.drawImage(picture, 0, 0);
  } finally {
    context.setTransform(1, 0, 0, 1, 0, 0);
    if (smaller) release(smaller);
  }
}

/**
 * Darkens the corners: a gradient drawn over the picture, no pixels read.
 * @param {CanvasRenderingContext2D} context
 * @param {Rect} frame
 * @param {number} amount  0 to 1.
 */
export function drawVignette(context, frame, amount) {
  const [x, y] = [frame.x + frame.w / 2, frame.y + frame.h / 2];
  const reach = Math.hypot(frame.w, frame.h) / 2;
  const gradient = context.createRadialGradient(x, y, reach * (0.7 - 0.35 * amount), x, y, reach);
  gradient.addColorStop(0, 'rgba(0, 0, 0, 0)');
  gradient.addColorStop(1, `rgba(0, 0, 0, ${0.8 * amount})`);
  context.fillStyle = gradient;
  context.fillRect(frame.x, frame.y, frame.w, frame.h);
}

/** @param {HTMLCanvasElement} canvas */
const context2d = (canvas) => {
  const context = canvas.getContext('2d');
  if (!context) throw new Error('This browser cannot draw on a canvas.');
  return context;
};

/**
 * Colour, soften, sharpen and vignette on a canvas that already shows the
 * photo, in bands with pauses between them: for the saved file.
 * @param {HTMLCanvasElement} canvas
 * @param {ColorPlan} plan
 * @param {AdjustOptions} options
 * @returns {Promise<boolean>}  False when stopped part way.
 */
export async function adjustCanvas(canvas, plan, options) {
  if (isPlain(plan)) return true;
  const context = context2d(canvas);
  const { width, height } = canvas;
  if (plan.luts || plan.matrix || plan.soften || plan.sharpen) {
    const finished = await processBands(width, height, plan, radii(plan, options.longSide), {
      read: (y, rows) => context.getImageData(0, y, width, rows).data,
      write: (y, rows, data) => context.putImageData(new ImageData(data.slice(), width, rows), 0, y),
      bandRows: options.bandRows,
      pause: options.pause,
      stop: options.stop,
    });
    if (!finished) return false;
  }
  if (plan.vignette) drawVignette(context, options.frame ?? { x: 0, y: 0, w: width, h: height }, plan.vignette);
  return true;
}

/**
 * The same on a small canvas in one go, for the screen.
 * @param {HTMLCanvasElement} canvas
 * @param {ColorPlan} plan
 * @param {AdjustOptions} options
 */
export function adjustCanvasNow(canvas, plan, options) {
  if (isPlain(plan)) return;
  const context = context2d(canvas);
  const { width, height } = canvas;
  if (plan.luts || plan.matrix || plan.soften || plan.sharpen) {
    const image = context.getImageData(0, 0, width, height);
    processPixels(image.data, width, height, plan, radii(plan, options.longSide));
    context.putImageData(image, 0, 0);
  }
  if (plan.vignette) drawVignette(context, options.frame ?? { x: 0, y: 0, w: width, h: height }, plan.vignette);
}

/**
 * Draws the edited picture onto a whole canvas, at the canvas's size: the
 * saved file comes from here, and the screen from the same pieces.
 * @param {HTMLCanvasElement} target
 * @param {Picture} source
 * @param {Doc} doc
 * @param {RenderOptions & Omit<AdjustOptions, 'longSide'>} options
 * @returns {Promise<boolean>}  False when stopped part way.
 */
export async function renderDoc(target, source, doc, options) {
  drawPhoto(target, source, outputMatrix(doc, source, target), options);
  return adjustCanvas(target, colorPlan(doc.adjust, doc.preset), { ...options, longSide: Math.max(target.width, target.height) });
}

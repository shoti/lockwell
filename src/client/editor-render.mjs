// @ts-check
/**
 * @file The photo editor's drawing: the one path from the original picture to the screen and to the saved file.
 */
import { downscale, release } from './canvas.mjs';
import { multiply, scale } from './editor-matrix.mjs';
import { outputMatrix } from './editor-doc.mjs';

/** @typedef {import('./editor-matrix.mjs').Matrix} Matrix */
/** @typedef {import('./editor-doc.mjs').Doc} Doc */
/** @typedef {CanvasImageSource & { width: number, height: number }} Picture */
/** @typedef {{ jpeg: boolean }} RenderOptions  jpeg: the copy has no transparency, so see-through parts turn white, not black. */

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
 * Draws the edited picture onto a whole canvas, at the canvas's size: the
 * screen's preview and the saved file both come from here.
 * @param {HTMLCanvasElement} target
 * @param {Picture} source
 * @param {Doc} doc
 * @param {RenderOptions} options
 */
export function renderDoc(target, source, doc, options) {
  drawPhoto(target, source, outputMatrix(doc, source, target), options);
}

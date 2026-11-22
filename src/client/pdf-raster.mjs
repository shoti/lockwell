// @ts-check
/**
 * @file Pictures as PDF pages (plan docs/tools-plan/pdf-toolkit.md §6.8), the canvas part: decoding with the browser,
 * a small copy for the cards, re-encoding what cannot be embedded unchanged, and drawing a picture page on a card.
 * Re-encoding draws pixels only, so nothing of the original file (location, camera, dates) can come along.
 */
import { downscale, encode, exportSize, release } from './canvas.mjs';
import { jpegForPdf, jpegInfo } from './pdf-image.mjs';
import { deflate } from './pdf-write.mjs';

/** @typedef {import('./pdf-image.mjs').Picture} Picture */
/** @typedef {import('./pdf-image.mjs').ImageLayout} ImageLayout */

/** JPEG quality for pictures the browser re-encodes (plan §6.8). */
export const JPEG_QUALITY = 0.9;
/** Longest side of the copy kept for the cards, in pixels. */
const THUMB_SIDE = 480;

/**
 * Decodes a picture, turned as its camera says (createImageBitmap's default "from-image").
 * @param {Uint8Array} bytes
 * @returns {Promise<ImageBitmap | null>}  null when this browser cannot decode it.
 */
export async function decodePicture(bytes) {
  if (typeof createImageBitmap !== 'function') return null;
  try {
    return await createImageBitmap(new Blob([/** @type {Uint8Array<ArrayBuffer>} */ (bytes)]));
  } catch (error) {
    console.warn('[lockwell] The browser could not decode a picture.', error);
    return null;
  }
}

/**
 * A small copy for the cards; the caller closes it.
 * @param {ImageBitmap} bitmap
 */
export async function thumbnailOf(bitmap) {
  const scale = Math.min(1, THUMB_SIDE / Math.max(bitmap.width, bitmap.height));
  const canvas = downscale(bitmap, Math.max(1, Math.round(bitmap.width * scale)), Math.max(1, Math.round(bitmap.height * scale)));
  try {
    return await createImageBitmap(canvas);
  } finally {
    release(canvas);
  }
}

/**
 * The picture drawn again on white (transparency shows the page under it, as a viewer would), scaled down to what a
 * canvas holds, and encoded: as JPEG, or for drawings and screenshots without loss as PNG-predicted Flate rows.
 * @param {ImageBitmap} bitmap  Already turned as the camera says, so the result has orientation 1.
 * @param {{ lossless: boolean }} options
 * @returns {Promise<{ picture: Picture, scaled: boolean }>}
 */
export async function rasterPicture(bitmap, { lossless }) {
  const { width, height, scaled } = exportSize(bitmap.width, bitmap.height);
  const smaller = scaled ? downscale(bitmap, width, height) : null;
  const canvas = document.createElement('canvas');
  [canvas.width, canvas.height] = [width, height];
  try {
    const context = /** @type {CanvasRenderingContext2D} */ (canvas.getContext('2d', { willReadFrequently: lossless }));
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, width, height);
    context.drawImage(smaller ?? bitmap, 0, 0, width, height);
    if (!lossless) {
      const encoded = new Uint8Array(await (await encode(canvas, 'image/jpeg', JPEG_QUALITY)).arrayBuffer());
      const info = jpegInfo(encoded);
      const data = jpegForPdf(encoded);
      if (!info || !data) throw new Error('The browser did not write a JPEG this tool can read.');
      return { picture: { width: info.width, height: info.height, orientation: 1, density: null, filter: 'DCTDecode', colors: info.components === 1 ? 1 : 3, data }, scaled };
    }
    return { picture: { width, height, orientation: 1, density: null, filter: 'FlateDecode', colors: 3, data: await deflate(predictedRows(context.getImageData(0, 0, width, height).data, width, height)) }, scaled };
  } finally {
    if (smaller) release(smaller);
    release(canvas);
  }
}

/**
 * RGBA pixels as RGB rows, each with PNG's "Up" filter (type 2): every byte minus the one above it.
 * @param {Uint8ClampedArray} rgba @param {number} width @param {number} height
 */
export function predictedRows(rgba, width, height) {
  const stride = width * 3;
  const out = new Uint8Array(height * (stride + 1));
  for (let y = 0; y < height; y += 1) {
    const row = y * (stride + 1);
    out[row] = 2;
    for (let x = 0; x < width; x += 1) {
      for (let c = 0; c < 3; c += 1) {
        const here = rgba[(y * width + x) * 4 + c];
        const above = y > 0 ? rgba[((y - 1) * width + x) * 4 + c] : 0;
        out[row + 1 + x * 3 + c] = (here - above) & 0xff;
      }
    }
  }
  return out;
}

/**
 * Draws a picture page on a card: white paper of the page's shape, turned by `turn`, with the picture in its box.
 * @param {HTMLCanvasElement} canvas
 * @param {ImageBitmap} thumb  Already turned as the camera says.
 * @param {ImageLayout} layout
 * @param {{ width: number, turn: number, ratio?: number }} size  CSS width; ratio: device pixels per CSS pixel.
 */
export function drawPicturePage(canvas, thumb, layout, { width, turn, ratio = 1 }) {
  const turned = turn % 180 !== 0;
  const scale = (width * ratio) / (turned ? layout.height : layout.width);
  canvas.width = Math.max(1, Math.round((turned ? layout.height : layout.width) * scale));
  canvas.height = Math.max(1, Math.round((turned ? layout.width : layout.height) * scale));
  const context = /** @type {CanvasRenderingContext2D} */ (canvas.getContext('2d'));
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.save();
  context.translate(canvas.width / 2, canvas.height / 2);
  context.rotate((turn * Math.PI) / 180);
  const { box } = layout;
  context.imageSmoothingQuality = 'high';
  context.drawImage(thumb, (box.x - layout.width / 2) * scale, (layout.height / 2 - box.y - box.height) * scale, box.width * scale, box.height * scale);
  context.restore();
}

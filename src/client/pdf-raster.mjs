// @ts-check
/**
 * @file Pictures as PDF pages (plan docs/tools-plan/pdf-toolkit.md §6.8), the canvas part: decoding with the browser,
 * a small copy for the cards, re-encoding what cannot be embedded unchanged, drawing a picture page on a card; and
 * for sign and stamp, text drawn as an ink mask and overlays drawn on the page as shown.
 * Re-encoding draws pixels only, so nothing of the original file (location, camera, dates) can come along.
 */
import { downscale, encode, exportSize, release } from './canvas.mjs';
import { jpegForPdf, jpegInfo } from './pdf-image.mjs';
import { INKS, MARKS, MARK_PEN } from './pdf-overlay.mjs';
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

/* ---------- Sign and stamp ---------- */

/** @typedef {import('./pdf-overlay.mjs').Overlay} Overlay */
/** @typedef {import('./pdf-overlay.mjs').Mask} Mask */
/** @typedef {import('./pdf-overlay.mjs').FontKey} FontKey */

/** Font families as a canvas takes them; `cursive` is whatever handwriting-style font the device has. */
export const OVERLAY_FONTS = { site: '"FiraGO", sans-serif', serif: 'serif', cursive: 'cursive' };
/** Height of one line of text in a mask, in pixels: about 300 per inch for a line a quarter of an inch high. */
const TEXT_PIXELS = 96;

/** @param {import('./pdf-overlay.mjs').Ink} color */
export const inkColor = (color) => `rgb(${INKS[color].map((value) => Math.round(value * 255)).join(' ')})`;

/**
 * Text drawn by the browser as an ink mask, so any script works with no font in the PDF. Needs canvas read-back.
 * @param {string} text  One or more lines.
 * @param {FontKey} font @param {boolean} bold
 * @returns {Promise<Mask | null>}  null for empty text.
 */
export async function textMask(text, font, bold) {
  const lines = text.split('\n');
  if (!text.trim()) return null;
  const css = `${bold ? 700 : 400} ${TEXT_PIXELS}px ${OVERLAY_FONTS[font]}`;
  if (font === 'site' && typeof document !== 'undefined' && document.fonts) {
    await document.fonts.load(css, text).catch((/** @type {unknown} */ error) => console.warn('[lockwell] The site font did not load; the browser draws a fallback.', error));
  }
  const canvas = document.createElement('canvas');
  try {
    const context = /** @type {CanvasRenderingContext2D} */ (canvas.getContext('2d', { willReadFrequently: true }));
    context.font = css;
    const pad = Math.round(TEXT_PIXELS * 0.15);
    const line = Math.round(TEXT_PIXELS * 1.25);
    const width = Math.max(1, Math.ceil(Math.max(...lines.map((item) => context.measureText(item).width))) + 2 * pad);
    const height = line * lines.length + 2 * pad;
    [canvas.width, canvas.height] = [width, height];
    context.font = css;
    context.textBaseline = 'middle';
    context.fillStyle = '#000000';
    lines.forEach((item, i) => context.fillText(item, pad, pad + line * (i + 0.5)));
    const rgba = context.getImageData(0, 0, width, height).data;
    const data = new Uint8Array(width * height);
    for (let i = 0; i < data.length; i += 1) data[i] = rgba[i * 4 + 3];
    return { width, height, data };
  } finally {
    release(canvas);
  }
}

/** Masks turned into drawable canvases of one colour, made once each. @type {WeakMap<Mask, Map<string, HTMLCanvasElement>>} */
const maskCanvases = new WeakMap();

/** @param {Mask} mask @param {import('./pdf-overlay.mjs').Ink} color */
function maskCanvas(mask, color) {
  const known = maskCanvases.get(mask) ?? new Map();
  maskCanvases.set(mask, known);
  const found = known.get(color);
  if (found) return found;
  const canvas = document.createElement('canvas');
  [canvas.width, canvas.height] = [mask.width, mask.height];
  const context = /** @type {CanvasRenderingContext2D} */ (canvas.getContext('2d'));
  const image = context.createImageData(mask.width, mask.height);
  const [r, g, b] = INKS[color].map((value) => Math.round(value * 255));
  for (let i = 0; i < mask.data.length; i += 1) image.data.set([r, g, b, mask.data[i]], i * 4);
  context.putImageData(image, 0, 0);
  known.set(color, canvas);
  return canvas;
}

/**
 * Draws overlays on a canvas showing the page as shown, `width` × `height` pixels: the same geometry as the PDF.
 * @param {CanvasRenderingContext2D} context @param {Overlay[]} overlays @param {number} width @param {number} height
 */
export function drawOverlays(context, overlays, width, height) {
  for (const overlay of overlays) {
    const [bw, bh] = [overlay.w * width, overlay.h * height];
    context.save();
    context.translate(overlay.x * width + bw / 2, overlay.y * height + bh / 2);
    context.rotate((overlay.rotation * Math.PI) / 180);
    context.globalAlpha = overlay.opacity;
    if (overlay.type === 'ink' || overlay.type === 'mark') {
      context.strokeStyle = inkColor(overlay.color);
      context.lineWidth = overlay.type === 'ink' ? overlay.width * bh : MARK_PEN * Math.min(bw, bh);
      context.lineCap = 'round';
      context.lineJoin = 'round';
      context.beginPath();
      for (const stroke of overlay.type === 'ink' ? overlay.strokes : MARKS[overlay.mark]) {
        stroke.forEach((p, i) => (i === 0 ? context.moveTo(p.x * bw - bw / 2, p.y * bh - bh / 2) : context.lineTo(p.x * bw - bw / 2, p.y * bh - bh / 2)));
        if (stroke.length === 1) context.lineTo(stroke[0].x * bw - bw / 2, stroke[0].y * bh - bh / 2);
      }
      context.stroke();
    } else {
      context.imageSmoothingQuality = 'high';
      context.drawImage(maskCanvas(overlay.mask, overlay.color), -bw / 2, -bh / 2, bw, bh);
    }
    context.restore();
  }
}

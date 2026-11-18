// @ts-check
/**
 * @file The photo editor's drawing: the one path from the original picture to the screen and to the saved file.
 */
import { downscale, release } from './canvas.mjs';
import { colorPlan, isPlain, processBands, processPixels, radii } from './editor-color.mjs';
import { multiply, scale } from './editor-matrix.mjs';
import { orientedSize, outputMatrix, viewMatrix } from './editor-doc.mjs';
import { TEXT_PADDING, arrowHead, canvasFont, isShape, textLines } from './editor-layers.mjs';

/** @typedef {import('./editor-matrix.mjs').Matrix} Matrix */
/** @typedef {import('./editor-doc.mjs').Doc} Doc */
/** @typedef {CanvasImageSource & { width: number, height: number }} Picture */
/** @typedef {import('./editor-color.mjs').ColorPlan} ColorPlan */
/** @typedef {import('./editor-layers.mjs').Layer} Layer */
/** @typedef {import('./editor-layers.mjs').TextLayer} TextLayer */
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
 * Text and drawings, back to front, through a matrix from turned-picture pixels to canvas pixels.
 * @param {CanvasRenderingContext2D} context
 * @param {Layer[]} layers
 * @param {Matrix} matrix
 * @param {{ width: number, height: number }} size  The turned picture.
 */
export function drawLayers(context, layers, matrix, size) {
  const longer = Math.max(size.width, size.height);
  /** @param {{ x: number, y: number }} p */
  const px = (p) => ({ x: p.x * size.width, y: p.y * size.height });
  for (const layer of layers) {
    context.save();
    try {
      context.setTransform(...matrix);
      context.globalAlpha = Math.min(1, Math.max(0, layer.opacity));
      context.lineCap = 'round';
      context.lineJoin = 'round';
      if (layer.type === 'text') {
        drawText(context, layer, size);
        continue;
      }
      context.strokeStyle = layer.stroke;
      context.lineWidth = Math.max(0.5, layer.width * longer);
      if (isShape(layer)) {
        const [w, h] = [layer.w * size.width, layer.h * size.height];
        context.translate((layer.x + layer.w / 2) * size.width, (layer.y + layer.h / 2) * size.height);
        context.rotate((layer.rotation * Math.PI) / 180);
        context.beginPath();
        if (layer.type === 'rect') context.rect(-w / 2, -h / 2, w, h);
        else context.ellipse(0, 0, w / 2, h / 2, 0, 0, Math.PI * 2);
        if (layer.fill) {
          context.fillStyle = layer.fill;
          context.fill();
        }
        context.stroke();
      } else if (layer.type === 'pen') {
        const points = layer.points.map(px);
        context.beginPath();
        if (points.length === 1) {
          context.fillStyle = layer.stroke;
          context.arc(points[0].x, points[0].y, context.lineWidth / 2, 0, Math.PI * 2);
          context.fill();
        } else {
          points.forEach((point, index) => (index ? context.lineTo(point.x, point.y) : context.moveTo(point.x, point.y)));
          context.stroke();
        }
      } else {
        const [from, to] = [px(layer.from), px(layer.to)];
        const head = layer.type === 'arrow' ? arrowHead(from, to, context.lineWidth) : null;
        const end = head ? head.lineEnd : to;
        context.beginPath();
        context.moveTo(from.x, from.y);
        context.lineTo(end.x, end.y);
        context.stroke();
        if (head) {
          // A filled triangle, so the screen and the file show the same head at every size.
          context.fillStyle = layer.stroke;
          context.beginPath();
          context.moveTo(head.tip.x, head.tip.y);
          context.lineTo(head.left.x, head.left.y);
          context.lineTo(head.right.x, head.right.y);
          context.closePath();
          context.fill();
        }
      }
    } finally {
      context.restore();
    }
  }
}

/**
 * One text layer: its background box, its outline, then its letters.
 * @param {CanvasRenderingContext2D} context  Already set to turned-picture pixels.
 * @param {TextLayer} layer
 * @param {{ width: number, height: number }} size
 */
function drawText(context, layer, size) {
  const block = textLines(layer, size, (text, font) => {
    context.font = font;
    return context.measureText(text).width;
  });
  context.translate(layer.x * size.width, layer.y * size.height);
  context.rotate((layer.rotation * Math.PI) / 180);
  if (layer.background) {
    const pad = TEXT_PADDING * block.pixels;
    context.fillStyle = layer.background;
    context.fillRect(-block.width / 2 - pad, -block.height / 2 - pad, block.width + 2 * pad, block.height + 2 * pad);
  }
  context.font = canvasFont(layer, block.pixels);
  context.textBaseline = 'middle';
  // start and end follow the text's own direction, as the textarea it was typed in does.
  context.direction = 'inherit';
  context.textAlign = layer.align === 'center' ? 'center' : layer.align === 'end' ? 'right' : 'left';
  const x = layer.align === 'center' ? 0 : layer.align === 'end' ? block.width / 2 : -block.width / 2;
  block.lines.forEach((line, index) => {
    const y = -block.height / 2 + block.lineHeight * (index + 0.5);
    if (layer.outline) {
      context.strokeStyle = layer.outline;
      context.lineWidth = block.pixels * 0.12;
      context.strokeText(line, x, y);
    }
    context.fillStyle = layer.color;
    context.fillText(line, x, y);
  });
}

/**
 * Asks the browser to load the fonts that text layers use. The site's own
 * font may not be loaded yet (it is declared "optional"), and a canvas draws
 * with a font only once it has loaded. Fails quietly: the letters then come
 * from the fallback font.
 * @param {Layer[]} layers
 */
export async function loadFonts(layers) {
  const fonts = new Set(layers.flatMap((layer) => (layer.type === 'text' && layer.font === 'site' ? [canvasFont(layer, 16)] : [])));
  if (!fonts.size || typeof document === 'undefined' || !document.fonts) return;
  await Promise.all(
    [...fonts].map((font) =>
      document.fonts.load(font).catch((/** @type {unknown} */ error) => {
        console.warn(`[lockwell] The font for "${font}" could not be loaded; the fallback font is used.`, error);
      }),
    ),
  );
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
  await loadFonts(doc.layers);
  drawPhoto(target, source, outputMatrix(doc, source, target), options);
  if (!(await adjustCanvas(target, colorPlan(doc.adjust, doc.preset), { ...options, longSide: Math.max(target.width, target.height) }))) return false;
  if (options.stop?.()) return false;
  drawLayers(context2d(target), doc.layers, viewMatrix(doc, source, target), orientedSize(doc, source));
  return true;
}

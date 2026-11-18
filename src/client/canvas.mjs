// @ts-check
/**
 * @file Canvas helpers for the image tools: size limits, animated pictures, encoding, reading pixels back, the example picture.
 */

/** Browsers refuse or mangle canvases beyond this many pixels (about 16 megapixels on iPhones). */
export const MAX_PIXELS = 16_000_000;
/** Safari refuses canvases longer than this on either side, whatever their area. */
const MAX_SIDE = 16_384;

/**
 * Size of the saved copy: the image's own size, or scaled down to what a
 * canvas can hold, in area and on each side.
 * @param {number} width
 * @param {number} height
 * @param {number} [maxPixels]
 * @returns {{ width: number, height: number, scaled: boolean }}
 */
export function exportSize(width, height, maxPixels = MAX_PIXELS) {
  const factor = Math.min(Math.sqrt(maxPixels / (width * height)), MAX_SIDE / Math.max(width, height));
  if (factor >= 1) return { width, height, scaled: false };
  return { width: Math.max(1, Math.floor(width * factor)), height: Math.max(1, Math.floor(height * factor)), scaled: true };
}

/* ---------- Animated pictures ---------- */

/**
 * Whether a picture moves: a GIF with more than one frame, an animated PNG
 * or WebP, or an AVIF or HEIF image sequence. A browser opens only the first
 * frame of these, so that is all the saved copy can hold.
 * @param {Uint8Array} bytes  The file, or at least its start (a GIF needs all of its first frame).
 */
export function isAnimated(bytes) {
  const text = (/** @type {number} */ at, /** @type {number} */ length) => String.fromCharCode(...bytes.subarray(at, at + length));
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (text(0, 4) === 'GIF8') return gifFrames(bytes) > 1;
  if (text(1, 3) === 'PNG') {
    // acTL comes before the first IDAT in an animated PNG.
    for (let at = 8; at + 8 <= bytes.length; at += 12 + view.getUint32(at)) {
      const type = text(at + 4, 4);
      if (type === 'acTL') return true;
      if (type === 'IDAT') return false;
    }
    return false;
  }
  if (text(0, 4) === 'RIFF' && text(8, 4) === 'WEBP') return text(12, 4) === 'VP8X' && bytes.length > 20 && (bytes[20] & 0x02) !== 0;
  if (text(4, 4) === 'ftyp' && bytes.length >= 8) {
    const size = Math.min(bytes.length, view.getUint32(0));
    for (let at = 8; at + 4 <= size; at += 4) if (['avis', 'hevs', 'msf1'].includes(text(at, 4))) return true;
  }
  return false;
}

/**
 * Counts a GIF's frames, stopping at the second.
 * @param {Uint8Array} bytes
 */
function gifFrames(bytes) {
  /** Skips data sub-blocks from `at`; returns where they end. @param {number} at */
  const skipBlocks = (at) => {
    while (at < bytes.length && bytes[at] !== 0) at += bytes[at] + 1;
    return at + 1;
  };
  let at = 13 + (bytes[10] & 0x80 ? 3 * 2 ** ((bytes[10] & 7) + 1) : 0);
  let frames = 0;
  while (at < bytes.length && frames < 2) {
    if (bytes[at] === 0x21) {
      at = skipBlocks(at + 2);
    } else if (bytes[at] === 0x2c) {
      frames += 1;
      const flags = bytes[at + 9];
      at += 10 + (flags & 0x80 ? 3 * 2 ** ((flags & 7) + 1) : 0);
      at = skipBlocks(at + 1); // past the LZW code size
    } else {
      break;
    }
  }
  return frames;
}

/* ---------- Canvases ---------- */

/** Gives a canvas's memory back to the browser. @param {HTMLCanvasElement} done */
export const release = (done) => {
  done.width = 0;
  done.height = 0;
};

/** @param {HTMLCanvasElement} source @param {string} mime @returns {Promise<Blob>} */
export const encode = (source, mime) =>
  new Promise((resolve, reject) => {
    source.toBlob((blob) => (blob ? resolve(blob) : reject(new Error(`The browser could not encode the image as ${mime}.`))), mime, 0.92);
  });

/**
 * The pixels of a decoded picture, read back from a canvas.
 * @param {ImageBitmap} decoded
 * @param {number} width
 * @param {number} height
 */
export const pixelsOf = (decoded, width, height) => {
  const reader = document.createElement('canvas');
  [reader.width, reader.height] = [width, height];
  try {
    const context = /** @type {CanvasRenderingContext2D} */ (reader.getContext('2d', { willReadFrequently: true }));
    context.drawImage(decoded, 0, 0);
    return context.getImageData(0, 0, width, height).data;
  } finally {
    release(reader);
  }
};

/**
 * Whether this page may read pixels back from a canvas. Tor Browser,
 * Mullvad Browser and Firefox with fingerprinting resistance hand back
 * blank or made-up pixels until the visitor allows it; Brave changes a
 * few by a little, which the tolerance allows.
 */
export const canReadBack = () => {
  const probe = document.createElement('canvas');
  [probe.width, probe.height] = [2, 1];
  try {
    const context = /** @type {CanvasRenderingContext2D} */ (probe.getContext('2d', { willReadFrequently: true }));
    context.fillStyle = '#000';
    context.fillRect(0, 0, 1, 1);
    context.fillStyle = '#f00';
    context.fillRect(1, 0, 1, 1);
    const data = context.getImageData(0, 0, 2, 1).data;
    return [0, 0, 0, 255, 255, 0, 0, 255].every((value, index) => Math.abs(data[index] - value) <= 8);
  } catch (error) {
    console.warn('[lockwell] This browser does not let the page read a canvas back.', error);
    return false;
  } finally {
    release(probe);
  }
};

/* ---------- Example ---------- */

/**
 * The example picture: a street with a car's number plate, a person and a
 * shop sign, the kinds of things people cover before sharing.
 * @returns {Promise<Blob>}
 */
export async function examplePicture() {
  const canvas = document.createElement('canvas');
  [canvas.width, canvas.height] = [960, 640];
  const context = /** @type {CanvasRenderingContext2D} */ (canvas.getContext('2d'));
  const fill = (/** @type {string} */ colour, /** @type {number[]} */ ...rect) => {
    context.fillStyle = colour;
    context.fillRect(rect[0], rect[1], rect[2], rect[3]);
  };
  fill('#a9c8e6', 0, 0, 960, 360);
  fill('#9b9b96', 0, 360, 960, 280);
  fill('#d8cbb3', 40, 80, 400, 280); // a building
  fill('#2f5f8a', 90, 140, 300, 60); // its sign
  context.fillStyle = '#ffffff';
  context.font = 'bold 36px sans-serif';
  context.fillText('BAKERY 24', 140, 182);
  fill('#c23b2e', 520, 400, 340, 110); // a car
  fill('#c23b2e', 580, 340, 210, 70);
  fill('#24313d', 600, 352, 170, 50);
  fill('#ffffff', 625, 470, 150, 34); // its number plate
  context.fillStyle = '#111111';
  context.font = 'bold 26px monospace';
  context.fillText('AA-001-AA', 632, 496);
  context.fillStyle = '#1d1d1d';
  for (const x of [580, 800]) {
    context.beginPath();
    context.arc(x, 515, 34, 0, Math.PI * 2);
    context.fill();
  }
  // A person: head and body.
  context.fillStyle = '#e0b48f';
  context.beginPath();
  context.arc(330, 300, 38, 0, Math.PI * 2);
  context.fill();
  fill('#3d6b4f', 285, 340, 90, 170);
  return new Promise((resolve, reject) => canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('The browser could not draw the example picture.'))), 'image/png'));
}

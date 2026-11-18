// @ts-check
/**
 * @file The photo editor's colour and sharpness maths, on plain arrays of RGBA pixels.
 */
/**
 * Two steps per pixel, so the cost doesn't grow with the number of sliders:
 * three 256-entry tables (one per channel) carry exposure, brightness,
 * contrast, highlights, shadows, warmth and tint; one 3×3 matrix carries
 * saturation and the filter. Soften and sharpen are box blurs, done with
 * whole-number sums so that working in bands gives exactly the same pixels as
 * working on the whole picture. Alpha is never changed.
 */

/** @typedef {'exposure' | 'brightness' | 'contrast' | 'highlights' | 'shadows' | 'saturation' | 'warmth' | 'tint' | 'sharpen' | 'soften' | 'vignette'} AdjustKey */
/** @typedef {'none' | 'mono' | 'sepia' | 'warm' | 'cool' | 'vivid' | 'faded'} PresetKey */
/** @typedef {Record<AdjustKey, number>} Adjust  Each -100 to 100 (sharpen, soften, vignette: 0 to 100); 0 is off. */
/** @typedef {[number, number, number, number, number, number, number, number, number]} ColorMatrix  Row by row. */
/**
 * What to do to the pixels, worked out once per picture.
 * @typedef {object} ColorPlan
 * @property {[Uint8Array, Uint8Array, Uint8Array] | null} luts  Red, green and blue tables; null: no change.
 * @property {ColorMatrix | null} matrix  null: no change.
 * @property {number} soften  0 to 1.
 * @property {number} sharpen  0 to 1.
 * @property {number} vignette  0 to 1.
 */

/** The sliders, in the order the page lists them, with their range. */
export const ADJUSTMENTS = /** @type {const} */ ([
  ['exposure', -100], ['brightness', -100], ['contrast', -100], ['highlights', -100], ['shadows', -100], ['saturation', -100],
  ['warmth', -100], ['tint', -100], ['sharpen', 0], ['soften', 0], ['vignette', 0],
]);

/** @returns {Adjust} */
export const noAdjust = () => /** @type {Adjust} */ (Object.fromEntries(ADJUSTMENTS.map(([key]) => [key, 0])));

/** Rec. 709 luma weights: how bright red, green and blue look. */
const LUMA = [0.2126, 0.7152, 0.0722];
/** @type {ColorMatrix} */
const IDENTITY = [1, 0, 0, 0, 1, 0, 0, 0, 1];
/** A table that changes nothing. */
const IDENTITY_TABLE = Uint8Array.from({ length: 256 }, (_, i) => i);
/** @type {ColorMatrix} */
const SEPIA = [0.393, 0.769, 0.189, 0.349, 0.686, 0.168, 0.272, 0.534, 0.131];

/**
 * The filters: a matrix, a change to the sliders, or both. They combine with
 * the visitor's own slider settings.
 * @type {Record<PresetKey, { matrix?: ColorMatrix, adjust?: Partial<Adjust> }>}
 */
export const PRESETS = {
  none: {},
  mono: { adjust: { saturation: -100 } },
  sepia: { matrix: SEPIA },
  warm: { adjust: { warmth: 35 } },
  cool: { adjust: { warmth: -35 } },
  vivid: { adjust: { saturation: 35, contrast: 15 } },
  faded: { adjust: { contrast: -25, saturation: -30, brightness: 6 } },
};

/** @param {number} value */
const unit = (value) => Math.min(1, Math.max(0, value));

/**
 * The sliders as they act: the visitor's settings plus the filter's, each kept within its range.
 * @param {Adjust} adjust
 * @param {PresetKey} preset
 * @returns {Adjust}
 */
export function combinedAdjust(adjust, preset) {
  const extra = PRESETS[preset]?.adjust ?? {};
  return /** @type {Adjust} */ (Object.fromEntries(ADJUSTMENTS.map(([key, min]) => [key, Math.min(100, Math.max(min, (adjust[key] ?? 0) + (extra[key] ?? 0)))])));
}

/**
 * One tone curve for all three channels, as values from 0 to 1. Every step
 * keeps the curve rising (or flat), so dark never turns lighter than light.
 * @param {Adjust} adjust
 * @returns {Float64Array}
 */
export function toneCurve(adjust) {
  const [exposure, brightness, contrast, highlights, shadows] = ['exposure', 'brightness', 'contrast', 'highlights', 'shadows'].map((key) => adjust[/** @type {AdjustKey} */ (key)] / 100);
  // tan(π/4 · (s + 1)): 1 at 0, 0 (flat grey) at -1, steep at 1, capped at 8.
  const slope = Math.min(8, Math.tan(((contrast + 1) * Math.PI) / 4));
  const curve = new Float64Array(256);
  for (let i = 0; i < 256; i += 1) {
    let v = i / 255;
    v = unit(v * 2 ** (2 * exposure));
    v = unit(v + 0.4 * brightness);
    v = unit((v - 0.5) * slope + 0.5);
    // v(1 - v)² and v²(1 - v) change by at most 1 per unit, so at full strength the curve still never falls.
    v = unit(v + shadows * v * (1 - v) ** 2);
    v = unit(v + highlights * v * v * (1 - v));
    curve[i] = v;
  }
  return curve;
}

/**
 * The red, green and blue tables: the tone curve, then warmth and tint.
 * @param {Adjust} adjust
 * @returns {[Uint8Array, Uint8Array, Uint8Array]}
 */
export function channelLuts(adjust) {
  const curve = toneCurve(adjust);
  const [warmth, tint] = [adjust.warmth / 100, adjust.tint / 100];
  const factors = [1 + 0.2 * warmth, 1 - 0.2 * tint, 1 - 0.2 * warmth];
  return /** @type {[Uint8Array, Uint8Array, Uint8Array]} */ (factors.map((factor) => Uint8Array.from(curve, (v) => Math.round(unit(v * factor) * 255))));
}

/**
 * Saturation, then the filter's matrix. Null when that changes nothing.
 * @param {Adjust} adjust  As combined with the filter.
 * @param {PresetKey} preset
 * @returns {ColorMatrix | null}
 */
export function colorMatrix(adjust, preset) {
  const s = adjust.saturation / 100;
  // Grey (every channel the pixel's luma) plus (1 + s) times the colour around it.
  const saturation = /** @type {ColorMatrix} */ (IDENTITY.map((value, index) => LUMA[index % 3] + (1 + s) * (value - LUMA[index % 3])));
  const filter = PRESETS[preset]?.matrix;
  const matrix = filter ? multiply3(filter, saturation) : saturation;
  return matrix.every((value, index) => Math.abs(value - IDENTITY[index]) < 1e-9) ? null : matrix;
}

/** `a` after `b`. @param {ColorMatrix} a @param {ColorMatrix} b @returns {ColorMatrix} */
function multiply3(a, b) {
  return /** @type {ColorMatrix} */ (Array.from({ length: 9 }, (_, index) => {
    const [row, column] = [Math.floor(index / 3), index % 3];
    return a[row * 3] * b[column] + a[row * 3 + 1] * b[3 + column] + a[row * 3 + 2] * b[6 + column];
  }));
}

/**
 * Everything the description asks of the pixels.
 * @param {Adjust} adjust
 * @param {PresetKey} preset
 * @returns {ColorPlan}
 */
export function colorPlan(adjust, preset) {
  const all = combinedAdjust(adjust, preset);
  const tables = ['exposure', 'brightness', 'contrast', 'highlights', 'shadows', 'warmth', 'tint'].some((key) => all[/** @type {AdjustKey} */ (key)] !== 0);
  return {
    luts: tables ? channelLuts(all) : null,
    matrix: colorMatrix(all, preset),
    soften: all.soften / 100,
    sharpen: all.sharpen / 100,
    vignette: all.vignette / 100,
  };
}

/** True when a plan changes no pixel. @param {ColorPlan} plan */
export const isPlain = (plan) => !plan.luts && !plan.matrix && !plan.soften && !plan.sharpen && !plan.vignette;

/**
 * Tables, then the matrix, on every pixel, in place. Alpha stays as it was.
 * @param {Uint8ClampedArray} data  RGBA.
 * @param {[Uint8Array, Uint8Array, Uint8Array] | null} luts
 * @param {ColorMatrix | null} matrix
 */
export function applyColor(data, luts, matrix) {
  // Plain variables in the loop: it runs once per pixel, millions of times.
  const [red, green, blue] = luts ?? [IDENTITY_TABLE, IDENTITY_TABLE, IDENTITY_TABLE];
  const [m0, m1, m2, m3, m4, m5, m6, m7, m8] = matrix ?? IDENTITY;
  for (let at = 0; at < data.length; at += 4) {
    const r = red[data[at]];
    const g = green[data[at + 1]];
    const b = blue[data[at + 2]];
    if (matrix) {
      data[at] = m0 * r + m1 * g + m2 * b;
      data[at + 1] = m3 * r + m4 * g + m5 * b;
      data[at + 2] = m6 * r + m7 * g + m8 * b;
    } else {
      data[at] = r;
      data[at + 1] = g;
      data[at + 2] = b;
    }
  }
}

/**
 * Where a box of `radius` around each of `length` positions gains and loses a
 * pixel as it slides on, edges repeated, as offsets of `step`.
 * @param {number} length
 * @param {number} radius
 * @param {number} step
 */
function slideOffsets(length, radius, step) {
  const gain = new Int32Array(length);
  const lose = new Int32Array(length);
  for (let i = 0; i < length; i += 1) {
    gain[i] = Math.min(length - 1, i + radius + 1) * step;
    lose[i] = Math.max(0, i - radius) * step;
  }
  return { gain, lose };
}

/**
 * One pass of a box blur along each row, RGB only, edges repeated; alpha copied.
 * @param {Uint8ClampedArray} from
 * @param {Uint8ClampedArray} to
 * @param {number} width
 * @param {number} height
 * @param {number} radius
 */
function rowPass(from, to, width, height, radius) {
  const scale = 1 / (2 * radius + 1);
  const { gain, lose } = slideOffsets(width, radius, 4);
  for (let y = 0; y < height; y += 1) {
    const row = y * width * 4;
    let [r, g, b] = [0, 0, 0];
    for (let i = -radius; i <= radius; i += 1) {
      const at = row + Math.min(width - 1, Math.max(0, i)) * 4;
      r += from[at];
      g += from[at + 1];
      b += from[at + 2];
    }
    for (let x = 0; x < width; x += 1) {
      const at = row + x * 4;
      to[at] = r * scale;
      to[at + 1] = g * scale;
      to[at + 2] = b * scale;
      to[at + 3] = from[at + 3];
      const [plus, minus] = [row + gain[x], row + lose[x]];
      r += from[plus] - from[minus];
      g += from[plus + 1] - from[minus + 1];
      b += from[plus + 2] - from[minus + 2];
    }
  }
}

/**
 * One pass of a box blur down each column, RGB only, edges repeated; alpha
 * copied. Every column's sum slides down together, row by row, so memory is
 * read in order.
 * @param {Uint8ClampedArray} from
 * @param {Uint8ClampedArray} to
 * @param {number} width
 * @param {number} height
 * @param {number} radius
 */
function columnPass(from, to, width, height, radius) {
  const scale = 1 / (2 * radius + 1);
  const rowLength = width * 4;
  const { gain, lose } = slideOffsets(height, radius, rowLength);
  const sums = new Int32Array(rowLength);
  for (let i = -radius; i <= radius; i += 1) {
    const row = Math.min(height - 1, Math.max(0, i)) * rowLength;
    for (let at = 0; at < rowLength; at += 1) sums[at] += from[row + at];
  }
  for (let y = 0; y < height; y += 1) {
    const [row, plus, minus] = [y * rowLength, gain[y], lose[y]];
    for (let at = 0; at < rowLength; at += 4) {
      to[row + at] = sums[at] * scale;
      to[row + at + 1] = sums[at + 1] * scale;
      to[row + at + 2] = sums[at + 2] * scale;
      to[row + at + 3] = from[row + at + 3];
      sums[at] += from[plus + at] - from[minus + at];
      sums[at + 1] += from[plus + at + 1] - from[minus + at + 1];
      sums[at + 2] += from[plus + at + 2] - from[minus + at + 2];
    }
  }
}

/**
 * Working space kept between calls: a slider drag would otherwise allocate
 * megabytes on every frame and keep the garbage collector busy.
 */
const scratch = { spare: new Uint8ClampedArray(0), blurred: new Uint8ClampedArray(0) };

/** Gives the kept working space back, once the dragging is over or a copy is made. */
export function releaseScratch() {
  scratch.spare = new Uint8ClampedArray(0);
  scratch.blurred = new Uint8ClampedArray(0);
}

/**
 * A working array of `length` from the kept space, grown when too small. Its contents are left over: overwrite them.
 * @param {'spare' | 'blurred'} name
 * @param {number} length
 */
function scratchFor(name, length) {
  if (scratch[name].length < length) scratch[name] = new Uint8ClampedArray(length);
  return scratch[name].subarray(0, length);
}

/**
 * A box blur in place; three passes come close to a Gaussian. A pixel reaches
 * at most passes × radius pixels in each direction.
 * @param {Uint8ClampedArray} data
 * @param {number} width
 * @param {number} height
 * @param {number} radius  Pixels; 0 does nothing.
 * @param {number} [passes]
 */
export function boxBlur(data, width, height, radius, passes = 3) {
  if (radius < 1) return;
  const spare = scratchFor('spare', data.length);
  for (let pass = 0; pass < passes; pass += 1) {
    rowPass(data, spare, width, height, radius);
    columnPass(spare, data, width, height, radius);
  }
}

/**
 * Unsharp masking, in place: each pixel moves away from its blurred self.
 * @param {Uint8ClampedArray} data
 * @param {number} width
 * @param {number} height
 * @param {number} amount  0 to 1.
 * @param {number} radius
 */
export function sharpen(data, width, height, amount, radius) {
  if (amount <= 0) return;
  const blurred = scratchFor('blurred', data.length);
  blurred.set(data);
  // The radius is a pixel or two, so one pass is enough.
  boxBlur(blurred, width, height, radius, 1);
  const strength = 1.5 * amount;
  for (let at = 0; at < data.length; at += 4) {
    for (let channel = 0; channel < 3; channel += 1) data[at + channel] = data[at + channel] + strength * (data[at + channel] - blurred[at + channel]);
  }
}

/**
 * The blur radii for a picture whose copy is `longSide` pixels long on this canvas,
 * so a small preview and the full-size file look alike.
 * @param {ColorPlan} plan
 * @param {number} longSide
 */
export function radii(plan, longSide) {
  return {
    soften: plan.soften > 0 ? Math.max(1, Math.round(plan.soften * 0.01 * longSide)) : 0,
    sharpen: plan.sharpen > 0 ? Math.max(1, Math.round(0.001 * longSide)) : 0,
  };
}

/**
 * Colour, soften and sharpen on one block of pixels, in place.
 * @param {Uint8ClampedArray} data
 * @param {number} width
 * @param {number} height
 * @param {ColorPlan} plan
 * @param {{ soften: number, sharpen: number }} radius
 */
export function processPixels(data, width, height, plan, radius) {
  if (plan.luts || plan.matrix) applyColor(data, plan.luts, plan.matrix);
  if (radius.soften) boxBlur(data, width, height, radius.soften);
  if (radius.sharpen) sharpen(data, width, height, plan.sharpen, radius.sharpen);
}

/**
 * Works through a picture in bands of rows, pausing between them, so a large
 * picture never freezes the page or needs a second full copy in memory.
 * Each band is read with extra rows above and below (unchanged ones, kept from
 * the band before), so the blurs at its edges come out exactly as they would
 * on the whole picture.
 * @param {number} width
 * @param {number} height
 * @param {ColorPlan} plan
 * @param {{ soften: number, sharpen: number }} radius
 * @param {object} io
 * @param {(y: number, rows: number) => Uint8ClampedArray} io.read  Rows from y, RGBA.
 * @param {(y: number, rows: number, data: Uint8ClampedArray) => void} io.write
 * @param {number} [io.bandRows]  Rows per band; by default about a megapixel, and at least twice the blur's reach.
 * @param {() => Promise<unknown>} [io.pause]  Between bands.
 * @param {() => boolean} [io.stop]  True when the result is no longer wanted: checked after every pause.
 * @returns {Promise<boolean>}  False when stopped.
 */
export async function processBands(width, height, plan, radius, { read, write, bandRows, pause = () => new Promise((resolve) => setTimeout(resolve, 0)), stop = () => false }) {
  // How far a pixel's blur reaches: three box passes for soften, one for sharpen.
  const margin = 3 * radius.soften + radius.sharpen;
  // About a megapixel, but at least twice the reach: a wide picture's thin bands would each be read with far more rows than they hold.
  const rows = Math.max(1, bandRows ?? Math.max(Math.floor(1_000_000 / width), 2 * margin));
  /** Unchanged rows just above the current band. */
  let above = new Uint8ClampedArray(0);
  for (let top = 0; top < height; top += rows) {
    const bottom = Math.min(height, top + rows);
    const end = Math.min(height, bottom + margin);
    const fresh = read(top, end - top);
    const block = new Uint8ClampedArray(above.length + fresh.length);
    block.set(above);
    block.set(fresh, above.length);
    const first = top - above.length / 4 / width;
    // Kept before the block is changed: the next band needs these rows as they were.
    const keepFrom = Math.max(first, bottom - margin);
    above = block.slice((keepFrom - first) * width * 4, (bottom - first) * width * 4);
    processPixels(block, width, end - first, plan, radius);
    write(top, bottom - top, block.subarray((top - first) * width * 4, (bottom - first) * width * 4));
    if (bottom < height) {
      await pause();
      if (stop()) return false;
    }
  }
  return true;
}

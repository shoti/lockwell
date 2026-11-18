// @ts-check
/**
 * @file Tests for the photo editor's pure logic: matrices, the edit description and its geometry, proportions.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { fitAspect, resizeWithRatio } from '../src/client/box.mjs';
import { apply, compose, identity, invert, multiply, rotate, scale, translate, turn } from '../src/client/editor-matrix.mjs';
import {
  MAX_ANGLE, cleanAngle, cropFits, cropFromView, cropSize, cropToView, effectiveCrop, emptyDoc, fitCrop, flipDoc, isUnchanged, keepLongSide,
  limitCrop, orientMatrix, orientedSize, outputMatrix, outputSize, rotatedBounds, turnDoc, wholeMatrix,
} from '../src/client/editor-doc.mjs';
import { fileSize, ratioOf, typedSize, unsavedWork } from '../src/client/tool-editor.mjs';
import { createHistory, commit } from '../src/client/history.mjs';
import {
  ADJUSTMENTS, PRESETS, applyColor, boxBlur, channelLuts, colorMatrix, colorPlan, combinedAdjust, isPlain, noAdjust, processBands, processPixels, radii, sharpen,
} from '../src/client/editor-color.mjs';

/** @typedef {import('../src/client/editor-doc.mjs').Doc} Doc */
/** @typedef {import('../src/client/box.mjs').Box} Box */

/** @param {{ x: number, y: number }} a @param {{ x: number, y: number }} b @param {string} [label] */
const near = (a, b, label = '') => assert.ok(Math.abs(a.x - b.x) < 1e-6 && Math.abs(a.y - b.y) < 1e-6, `${label} ${JSON.stringify(a)} ≠ ${JSON.stringify(b)}`);
/** @param {Partial<Doc>} change @returns {Doc} */
const docWith = (change) => ({ ...emptyDoc(), ...change });
const SOURCE = { width: 400, height: 300 };

describe('photo editor: matrices', () => {
  it('multiplies, inverts and maps points back to where they were', () => {
    const m = compose(translate(30, -12), rotate(0.7), scale(2, 0.5), translate(-5, 9));
    const back = invert(m);
    for (const point of [{ x: 0, y: 0 }, { x: 13.5, y: -40 }, { x: 400, y: 300 }]) near(apply(back, apply(m, point)), point);
    assert.deepEqual(multiply(m, back).map((value) => Math.round(value * 1e9) / 1e9 || 0), identity());
    assert.throws(() => invert(scale(0, 1)), /squashes/);
  });

  it('applies the last matrix of a compose first', () => {
    near(apply(compose(translate(10, 0), scale(2)), { x: 1, y: 1 }), { x: 12, y: 2 });
  });

  it('turns by exact quarters, clockwise with y pointing down', () => {
    assert.deepEqual(turn(1), [0, 1, -1, 0, 0, 0]);
    near(apply(turn(1), { x: 1, y: 0 }), { x: 0, y: 1 }, 'right goes down');
    near(apply(turn(2), { x: 1, y: 0 }), { x: -1, y: 0 });
    near(apply(turn(-1), { x: 1, y: 0 }), { x: 0, y: -1 });
    near(apply(rotate(Math.PI / 2), { x: 1, y: 0 }), apply(turn(1), { x: 1, y: 0 }));
  });
});

describe('photo editor: the edit description', () => {
  it('puts the source corners on the oriented picture’s corners for every turn and mirror', () => {
    const corners = [{ x: 0, y: 0 }, { x: 400, y: 0 }, { x: 400, y: 300 }, { x: 0, y: 300 }];
    for (const quarter of /** @type {const} */ ([0, 1, 2, 3])) {
      for (const flipX of [false, true]) {
        for (const flipY of [false, true]) {
          const doc = docWith({ quarter, flipX, flipY });
          const size = orientedSize(doc, SOURCE);
          const mapped = corners.map((corner) => apply(orientMatrix(doc, SOURCE), corner));
          for (const point of mapped) assert.ok([0, size.width].some((x) => Math.abs(point.x - x) < 1e-9) && [0, size.height].some((y) => Math.abs(point.y - y) < 1e-9), JSON.stringify({ quarter, flipX, flipY, point }));
        }
      }
    }
    near(apply(orientMatrix(docWith({ quarter: 1 }), SOURCE), { x: 0, y: 0 }), { x: 300, y: 0 }, 'a clockwise turn takes the top left to the top right');
    near(apply(orientMatrix(docWith({ flipX: true }), SOURCE), { x: 0, y: 0 }), { x: 400, y: 0 });
  });

  it('fills the target with the crop, corner to corner, with and without straightening', () => {
    for (const angle of [0, 12.5, -30]) {
      const doc = docWith({ angle, crop: { x: 0.2, y: 0.25, w: 0.4, h: 0.3 } });
      const crop = effectiveCrop(doc, SOURCE);
      assert.ok(cropFits(crop, angle, SOURCE));
      const target = { width: 320, height: 180 };
      const m = outputMatrix(doc, SOURCE, target);
      // The crop frame's corners on the oriented picture (here the source itself), turned back by the angle.
      const back = compose(translate((crop.x + crop.w / 2) * 400, (crop.y + crop.h / 2) * 300), rotate((-angle * Math.PI) / 180));
      const [hw, hh] = [(crop.w * 400) / 2, (crop.h * 300) / 2];
      near(apply(m, apply(back, { x: -hw, y: -hh })), { x: 0, y: 0 }, `angle ${angle} top left`);
      near(apply(m, apply(back, { x: hw, y: hh })), { x: 320, y: 180 }, `angle ${angle} bottom right`);
    }
  });

  it('keeps the crop on the picture for a grid of angles and shapes, and never grows it', () => {
    for (const size of [{ width: 400, height: 300 }, { width: 300, height: 400 }, { width: 1000, height: 100 }]) {
      for (let angle = -MAX_ANGLE; angle <= MAX_ANGLE; angle += 7.5) {
        for (const crop of [{ x: 0, y: 0, w: 1, h: 1 }, { x: 0.6, y: 0.1, w: 0.4, h: 0.5 }, { x: 0.05, y: 0.7, w: 0.2, h: 0.3 }]) {
          const fitted = fitCrop(crop, angle, size);
          assert.ok(cropFits(fitted, angle, size), JSON.stringify({ size, angle, crop }));
          assert.ok(fitted.w <= crop.w + 1e-12 && fitted.h <= crop.h + 1e-12, 'never larger');
          assert.ok(Math.abs(fitted.w / fitted.h - crop.w / crop.h) < 1e-9, 'same proportions');
          near({ x: fitted.x + fitted.w / 2, y: fitted.y + fitted.h / 2 }, { x: crop.x + crop.w / 2, y: crop.y + crop.h / 2 }, 'same centre');
        }
      }
    }
  });

  it('shrinks the whole picture by the known factor when straightened', () => {
    const [w, h, a] = [400, 300, (10 * Math.PI) / 180];
    const expected = Math.min(w / (w * Math.cos(a) + h * Math.sin(a)), h / (w * Math.sin(a) + h * Math.cos(a)));
    assert.ok(Math.abs(fitCrop({ x: 0, y: 0, w: 1, h: 1 }, 10, { width: w, height: h }).w - expected) < 1e-9);
    assert.deepEqual(effectiveCrop(docWith({ angle: 0 }), SOURCE), { x: 0, y: 0, w: 1, h: 1 }, 'level again: the whole picture');
  });

  it('limits a crop drag at the edge of a straightened picture, keeping what both boxes share', () => {
    const size = { width: 400, height: 300 };
    const from = fitCrop({ x: 0.3, y: 0.3, w: 0.3, h: 0.3 }, 20, size);
    const to = { ...from, w: from.w + 0.8 };
    const limited = limitCrop(from, to, 20, size);
    assert.ok(cropFits(limited, 20, size));
    assert.ok(limited.w > from.w && limited.w < to.w);
    assert.equal(limited.x, from.x, 'the left edge stays put');
    assert.equal(limitCrop(from, from, 20, size), from);
  });

  it('turns a crop into a box on the screen and back', () => {
    const size = { width: 400, height: 300 };
    for (const angle of [0, 17, -44]) {
      const crop = fitCrop({ x: 0.1, y: 0.2, w: 0.5, h: 0.6 }, angle, size);
      const box = cropToView(crop, angle, size);
      const back = cropFromView(box, angle, size);
      for (const key of /** @type {const} */ (['x', 'y', 'w', 'h'])) assert.ok(Math.abs(back[key] - crop[key]) < 1e-9, `${angle} ${key}`);
      const bounds = rotatedBounds(size, angle);
      assert.ok(Math.abs(box.w * bounds.width - crop.w * size.width) < 1e-9, 'the same width in pixels');
    }
  });

  it('turning or mirroring the edit turns or mirrors the saved copy, straightened and cropped', () => {
    const doc = docWith({ angle: 8, crop: { x: 0.15, y: 0.2, w: 0.5, h: 0.45 }, size: { width: 500, height: 300 } });
    const target = outputSize(doc, SOURCE);
    const points = [{ x: 120, y: 90 }, { x: 260, y: 200 }, { x: 200, y: 150 }];
    for (const direction of /** @type {const} */ ([1, -1])) {
      const turned = turnDoc(doc, direction);
      const turnedTarget = outputSize(turned, SOURCE);
      assert.deepEqual([turnedTarget.width, turnedTarget.height], [target.height, target.width]);
      for (const point of points) {
        const before = apply(outputMatrix(doc, SOURCE, target), point);
        const after = apply(outputMatrix(turned, SOURCE, turnedTarget), point);
        near(after, direction === 1 ? { x: target.height - before.y, y: before.x } : { x: before.y, y: target.width - before.x }, `turn ${direction}`);
      }
    }
    for (const axis of /** @type {const} */ (['x', 'y'])) {
      const flipped = flipDoc(doc, axis);
      for (const point of points) {
        const before = apply(outputMatrix(doc, SOURCE, target), point);
        const after = apply(outputMatrix(flipped, SOURCE, target), point);
        near(after, axis === 'x' ? { x: target.width - before.x, y: before.y } : { x: before.x, y: target.height - before.y }, `flip ${axis}`);
      }
    }
  });

  it('returns to the start after four turns either way, and two mirrors', () => {
    const doc = docWith({ flipX: true, angle: -5, crop: { x: 0.1, y: 0.2, w: 0.3, h: 0.4 }, size: { width: 30, height: 40 } });
    /** @param {Doc} d */
    const clean = (d) => JSON.parse(JSON.stringify(d, (_, value) => (typeof value === 'number' ? Math.round(value * 1e9) / 1e9 : value)));
    for (const direction of /** @type {const} */ ([1, -1])) assert.deepEqual(clean(turnDoc(turnDoc(turnDoc(turnDoc(doc, direction), direction), direction), direction)), clean(doc));
    assert.deepEqual(clean(turnDoc(turnDoc(doc, 1), -1)), clean(doc));
    for (const axis of /** @type {const} */ (['x', 'y'])) assert.deepEqual(clean(flipDoc(flipDoc(doc, axis), axis)), clean(doc));
    assert.equal(Object.is(flipDoc(docWith({ angle: 0 }), 'x').angle, -0), false, 'no negative zero');
  });

  it('works out the copy’s size from the crop, a chosen size, turns and the canvas limit', () => {
    assert.deepEqual(outputSize(emptyDoc(), SOURCE), { width: 400, height: 300, scaled: false });
    assert.deepEqual(outputSize(docWith({ quarter: 1 }), SOURCE), { width: 300, height: 400, scaled: false });
    assert.deepEqual(outputSize(docWith({ crop: { x: 0.5, y: 0, w: 0.5, h: 0.5 } }), SOURCE), { width: 200, height: 150, scaled: false });
    assert.deepEqual(outputSize(docWith({ size: { width: 1080, height: 810 } }), SOURCE), { width: 1080, height: 810, scaled: false });
    const huge = outputSize(docWith({ size: { width: 20000, height: 15000 } }), SOURCE);
    assert.equal(huge.scaled, true);
    assert.ok(huge.width * huge.height <= 16_000_000);
    assert.deepEqual(cropSize(docWith({ crop: { x: 0, y: 0, w: 0.333, h: 1 } }), SOURCE), { width: 133, height: 300 });
    assert.deepEqual(keepLongSide({ width: 1600, height: 1200 }, { width: 300, height: 400 }), { width: 1200, height: 1600 });
  });

  it('keeps straightening within its range, in tenths of a degree', () => {
    assert.equal(cleanAngle(12.345), 12.3);
    assert.equal(cleanAngle(90), 45);
    assert.equal(cleanAngle(-90), -45);
    assert.equal(cleanAngle(Number.NaN), 0);
    assert.equal(Object.is(cleanAngle(-0.01), -0), false);
  });

  it('shows the whole straightened picture while cropping', () => {
    const doc = docWith({ angle: 30 });
    const bounds = rotatedBounds(SOURCE, 30);
    const target = { width: Math.round(bounds.width), height: Math.round(bounds.height) };
    const m = wholeMatrix(doc, SOURCE, target);
    const mapped = [{ x: 0, y: 0 }, { x: 400, y: 0 }, { x: 400, y: 300 }, { x: 0, y: 300 }].map((point) => apply(m, point));
    assert.ok(mapped.every((point) => point.x >= -1e-6 && point.y >= -1e-6 && point.x <= target.width + 1e-6 && point.y <= target.height + 1e-6));
    assert.ok(Math.abs(Math.min(...mapped.map((point) => point.x))) < 1e-6, 'touches the left edge');
  });

  it('counts an edit as unsaved only when it changes something and was not saved', () => {
    let history = createHistory(emptyDoc());
    assert.equal(isUnchanged(emptyDoc()), true);
    assert.equal(unsavedWork(history, false), false);
    history = commit(history, turnDoc(emptyDoc(), 1));
    assert.equal(unsavedWork(history, false), true);
    assert.equal(unsavedWork(history, true), false);
  });
});

describe('photo editor: proportions and fields', () => {
  it('fits the largest box of a shape in the middle of another, measured in pixels', () => {
    const aspect = 400 / 300;
    const square = fitAspect({ x: 0, y: 0, w: 1, h: 1 }, 1, aspect);
    assert.ok(Math.abs(square.w * 400 - square.h * 300) < 1e-9, 'square in pixels');
    assert.equal(square.h, 1);
    assert.ok(Math.abs(square.x - (1 - square.w) / 2) < 1e-12);
    const wide = fitAspect({ x: 0, y: 0, w: 1, h: 1 }, 16 / 9, aspect);
    assert.equal(wide.w, 1);
    assert.ok(Math.abs((wide.w * 400) / (wide.h * 300) - 16 / 9) < 1e-9);
  });

  it('keeps the proportions while a handle is dragged, with the opposite corner or the middle fixed', () => {
    const aspect = 2;
    /** @type {Box} */
    const box = { x: 0.2, y: 0.2, w: 0.2, h: 0.4 }; // 0.4 × 0.4 in units of the height: square
    const corner = resizeWithRatio(box, 'se', { x: 0.6, y: 0.7 }, 1, aspect);
    assert.ok(Math.abs(corner.w * aspect - corner.h) < 1e-12);
    assert.deepEqual([corner.x, corner.y], [0.2, 0.2], 'the top left stays');
    const edge = resizeWithRatio(box, 'e', { x: 0.5, y: 0.3 }, 1, aspect);
    assert.ok(Math.abs(edge.w * aspect - edge.h) < 1e-12);
    assert.ok(Math.abs(edge.y + edge.h / 2 - 0.4) < 1e-12, 'grows evenly up and down');
    const top = resizeWithRatio(box, 'nw', { x: 0.1, y: 0.1 }, 1, aspect);
    assert.ok(Math.abs(top.x + top.w - 0.4) < 1e-12 && Math.abs(top.y + top.h - 0.6) < 1e-12, 'the bottom right stays');
  });

  it('reads proportions, typed sizes and file sizes', () => {
    assert.equal(ratioOf('free', SOURCE), null);
    assert.equal(ratioOf('original', SOURCE), 4 / 3);
    assert.equal(ratioOf('9:16', SOURCE), 9 / 16);
    assert.equal(typedSize('1080'), 1080);
    assert.equal(typedSize('12.6'), 13);
    assert.equal(typedSize('0'), null);
    assert.equal(typedSize('abc'), null);
    assert.equal(typedSize('9999999'), 100_000);
    assert.deepEqual(fileSize(500, 'en'), { unit: 'kb', n: '1' });
    assert.deepEqual(fileSize(250_000, 'en'), { unit: 'kb', n: '244' });
    assert.deepEqual(fileSize(3_500_000, 'en'), { unit: 'mb', n: '3.3' });
    assert.deepEqual(fileSize(3_500_000, 'ka'), { unit: 'mb', n: '3,3' }, 'Georgian writes a decimal comma');
  });
});

describe('photo editor: colour', () => {
  /** @typedef {import('../src/client/editor-color.mjs').PresetKey} PresetKey */
  /** A picture of `width` × `height` with repeatable "random" pixels. @param {number} width @param {number} height */
  const noise = (width, height) => {
    let seed = 7;
    return Uint8ClampedArray.from({ length: width * height * 4 }, (_, index) => (index % 4 === 3 ? 200 + (index % 50) : (seed = (seed * 1103515245 + 12345) % 2 ** 31) % 256));
  };
  /** One pixel through a filter. @param {PresetKey} preset @param {number[]} rgb */
  const through = (preset, rgb) => {
    const plan = colorPlan(noAdjust(), preset);
    const data = Uint8ClampedArray.from([...rgb, 77]);
    applyColor(data, plan.luts, plan.matrix);
    return [...data];
  };

  it('changes nothing at all zeros and without a filter', () => {
    assert.equal(isPlain(colorPlan(noAdjust(), 'none')), true);
    for (const table of channelLuts(noAdjust())) assert.deepEqual([...table], Array.from({ length: 256 }, (_, i) => i));
    assert.equal(colorMatrix(noAdjust(), 'none'), null);
  });

  it('keeps every table rising and within 0 to 255, at every slider’s ends and in between', () => {
    const keys = ['exposure', 'brightness', 'contrast', 'highlights', 'shadows', 'warmth', 'tint'];
    for (const key of keys) {
      for (const value of [-100, -63, -20, 20, 63, 100]) {
        for (const table of channelLuts({ ...noAdjust(), [key]: value })) {
          for (let i = 1; i < 256; i += 1) assert.ok(table[i] >= table[i - 1], `${key} ${value} at ${i}`);
          assert.ok(table.every((v) => v >= 0 && v <= 255));
        }
      }
    }
    for (const table of channelLuts({ ...noAdjust(), exposure: 100, contrast: 100, shadows: -100, highlights: 100, brightness: -100 })) {
      for (let i = 1; i < 256; i += 1) assert.ok(table[i] >= table[i - 1], `everything at once, at ${i}`);
    }
  });

  it('turns grey at saturation -100, and never touches alpha', () => {
    const plan = colorPlan({ ...noAdjust(), saturation: -100 }, 'none');
    const data = Uint8ClampedArray.from([200, 30, 90, 12, 0, 255, 0, 250]);
    applyColor(data, plan.luts, plan.matrix);
    assert.equal(data[0], data[1]);
    assert.equal(data[1], data[2]);
    assert.equal(data[4], data[6]);
    assert.deepEqual([data[3], data[7]], [12, 250]);
  });

  it('gives known results for a known pixel through each filter', () => {
    assert.deepEqual(through('none', [200, 100, 50]), [200, 100, 50, 77]);
    assert.deepEqual(through('sepia', [200, 100, 50]), [165, 147, 114, 77]);
    assert.deepEqual(through('mono', [200, 100, 50]), [118, 118, 118, 77]);
    const [warm, cool] = [through('warm', [128, 128, 128]), through('cool', [128, 128, 128])];
    assert.ok(warm[0] > 128 && warm[2] < 128, 'warm: redder, less blue');
    assert.ok(cool[0] < 128 && cool[2] > 128, 'cool: bluer');
    const vivid = through('vivid', [180, 120, 100]);
    assert.ok(vivid[0] - vivid[2] > 80, 'vivid: colours further apart');
    const faded = through('faded', [220, 40, 40]);
    assert.ok(faded[0] - faded[1] < 180, 'faded: colours closer together');
    for (const preset of /** @type {PresetKey[]} */ (Object.keys(PRESETS))) assert.equal(through(preset, [1, 2, 3])[3], 77, `${preset} keeps alpha`);
  });

  it('adds a filter’s settings to the visitor’s, within each slider’s range', () => {
    assert.equal(combinedAdjust({ ...noAdjust(), warmth: 90 }, 'warm').warmth, 100);
    assert.equal(combinedAdjust({ ...noAdjust(), saturation: 20 }, 'mono').saturation, -80);
    assert.deepEqual(ADJUSTMENTS.filter(([, min]) => min === 0).map(([key]) => key), ['sharpen', 'soften', 'vignette']);
  });

  it('blurs a flat picture into itself, and one bright pixel evenly in every direction', () => {
    const flat = new Uint8ClampedArray(20 * 10 * 4).fill(90);
    const before = flat.slice();
    boxBlur(flat, 20, 10, 3);
    assert.deepEqual(flat, before);
    sharpen(flat, 20, 10, 1, 2);
    assert.deepEqual(flat, before, 'sharpening a flat picture changes nothing');
    const [size, middle] = [21, 10];
    const dot = new Uint8ClampedArray(size * size * 4);
    dot[(middle * size + middle) * 4] = 255;
    boxBlur(dot, size, size, 1);
    const red = (/** @type {number} */ x, /** @type {number} */ y) => dot[(y * size + x) * 4];
    for (const [dx, dy] of [[1, 0], [2, 1], [3, 3]]) {
      const values = [red(middle + dx, middle + dy), red(middle - dx, middle + dy), red(middle + dx, middle - dy), red(middle - dx, middle - dy), red(middle + dy, middle + dx)];
      assert.ok(values.every((value) => value === values[0]), `symmetric at ${dx},${dy}: ${values}`);
    }
    let total = 0;
    for (let at = 0; at < dot.length; at += 4) total += dot[at];
    assert.ok(Math.abs(total - 255) < 255 * 0.15, `about as bright in total: ${total}`);
    assert.ok(red(middle, middle) < 255 && red(middle, middle) > 0);
  });

  it('works in bands to exactly the same pixels as on the whole picture', async () => {
    const [width, height] = [37, 53];
    for (const adjust of [{ ...noAdjust(), contrast: 40, saturation: -30 }, { ...noAdjust(), soften: 60 }, { ...noAdjust(), sharpen: 80, warmth: 20 }, { ...noAdjust(), soften: 30, sharpen: 100, exposure: -20 }]) {
      const plan = colorPlan(adjust, 'sepia');
      const radius = radii(plan, 400);
      const whole = noise(width, height);
      processPixels(whole, width, height, plan, radius);
      const banded = noise(width, height);
      const result = new Uint8ClampedArray(banded.length);
      const finished = await processBands(width, height, plan, radius, {
        read: (y, rows) => banded.slice(y * width * 4, (y + rows) * width * 4),
        write: (y, rows, data) => result.set(data, y * width * 4),
        bandRows: 5,
        pause: async () => {},
      });
      assert.equal(finished, true);
      assert.deepEqual(result, whole, JSON.stringify(adjust));
    }
  });

  it('stops a render that is no longer wanted before its next band', async () => {
    const [width, height] = [10, 40];
    const plan = colorPlan({ ...noAdjust(), contrast: 50 }, 'none');
    let reads = 0;
    let wanted = true;
    const finished = await processBands(width, height, plan, radii(plan, 100), {
      read: (y, rows) => {
        reads += 1;
        return new Uint8ClampedArray(rows * width * 4);
      },
      write: () => {},
      bandRows: 10,
      pause: async () => {
        wanted = false; // something changed while the page was free
      },
      stop: () => !wanted,
    });
    assert.equal(finished, false);
    assert.equal(reads, 1, 'no band after the change');
  });
});

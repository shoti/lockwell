// @ts-check
/**
 * @file The sign-and-stamp stage of the PDF tools (plan docs/tools-plan/pdf-toolkit.md §7.1): one page large, with
 * signatures (drawn, or from a photo), text, today's date, ticks, crosses and a copy stamp placed on it by pointer,
 * keyboard or buttons. Every change is a step of the board's plan, so undo works here too. A signature made here
 * stays in memory for this tab only and is never stored. Every label is in the panel template.
 */
import { resizeWithRatio } from './box.mjs';
import { ZOOMS, canReadBack, stepZoom } from './canvas.mjs';
import { MAX_PREVIEW_SIDE } from './pdf-view.mjs';
import { STAMP_OPACITY, fitStrokes, inkMask } from './pdf-overlay.mjs';
import { decodePicture, drawOverlays, textMask } from './pdf-raster.mjs';

/** @typedef {import('./pdf-build.mjs').PlanPage} PlanPage */
/** @typedef {import('./pdf-overlay.mjs').Overlay} Overlay */
/** @typedef {import('./pdf-overlay.mjs').Mask} Mask */
/** @typedef {import('./pdf-overlay.mjs').FontKey} FontKey */
/** @typedef {import('./box.mjs').Point} Point */
/** @typedef {import('./box.mjs').Handle} Handle */

/**
 * What the stage needs from the board.
 * @typedef {object} StageHost
 * @property {() => PlanPage[]} pages
 * @property {(next: PlanPage[], tag?: string) => void} change
 * @property {(page: PlanPage) => { width: number, height: number }} shown  The page's size as shown, in points.
 * @property {(page: PlanPage, canvas: HTMLCanvasElement, width: number, ratio: number) => Promise<boolean>} drawPage
 *   Draws the page itself (no overlays), `width` CSS pixels wide; false when it cannot be shown.
 * @property {() => Set<number>} selected
 * @property {string} lang
 */

/** A made signature, kept for this tab only. @typedef {{ kind: 'ink', strokes: Point[][], ratio: number, width: number } | { kind: 'picture', mask: Mask }} Signature */

/** Pen width on the signature pad, in its own pixels (600 wide). */
const PAD_PEN = 4;
/** How close a pointer must be to a corner to grab it, in CSS pixels: mouse and finger (the editor's reach). */
const REACH = { mouse: 24, touch: 40 };
/** Steps for keys and buttons. */
const STEP = { move: 0.01, far: 0.1, scale: 1.1, turn: 15 };
/** How far each new item in the middle steps down from the last, as a share of the page. */
const CASCADE = 0.06;
/** Default sizes: a signature's width as a share of the page; a line of text and a mark, in points. */
const SIZE = { signature: 0.3, text: 14, mark: 16, stamp: 0.7 };

/** @param {number} value @param {number} low @param {number} high */
const within = (value, low, high) => Math.min(high, Math.max(low, value));
/** @param {string} template @param {Record<string, string | number>} values */
const fill = (template, values) => template.replace(/\{(\w+)\}/g, (_, key) => String(values[key] ?? ''));
/** A canvas's 2D context, or null where there is none (a page without canvas support). @param {HTMLCanvasElement} canvas */
const context2d = (canvas) => (typeof canvas.getContext === 'function' ? canvas.getContext('2d') : null);
/** Degrees kept between -180 and 180. @param {number} degrees */
const tidyTurn = (degrees) => ((((degrees + 180) % 360) + 360) % 360) - 180;

/**
 * @param {HTMLElement} root
 * @param {StageHost} host
 */
export function initStage(root, host) {
  /** @param {string} name */
  const find = (name) => /** @type {HTMLElement} */ (root.querySelector(`[data-js="pdf-${name}"]`));
  /** @param {string} name */
  const button = (name) => /** @type {HTMLButtonElement} */ (find(name));
  const stage = find('stage');
  const pageCanvas = /** @type {HTMLCanvasElement} */ (find('view-page'));
  const itemsCanvas = /** @type {HTMLCanvasElement} */ (find('view-items'));
  const itemSelect = /** @type {HTMLSelectElement} */ (find('item'));
  const textInput = /** @type {HTMLTextAreaElement} */ (find('item-text'));
  const opacity = /** @type {HTMLInputElement} */ (find('item-opacity'));
  const status = find('stage-status');
  const pad = find('pad');
  const padCanvas = /** @type {HTMLCanvasElement} */ (find('pad-canvas'));
  const inkPanel = find('ink');
  const inkCanvas = /** @type {HTMLCanvasElement} */ (find('ink-canvas'));
  const threshold = /** @type {HTMLInputElement} */ (find('ink-threshold'));
  const photoInput = /** @type {HTMLInputElement} */ (find('ink-photo'));

  /** The open page's key, or null. @type {number | null} */
  let key = null;
  let index = -1;
  /** @type {Signature | null} */
  let mine = null;
  /** @type {boolean | null} */
  let readBack = null;
  let drawnFor = '';
  let zoom = 1;
  /** Overlays shown while a pointer drags, before the step is kept. @type {Overlay[] | null} */
  let preview = null;

  const page = () => host.pages().find((item) => item.key === key) ?? null;
  const overlays = () => preview ?? page()?.overlays ?? [];

  /**
   * Changes the open page's overlays as one step of the plan.
   * @param {(list: Overlay[]) => Overlay[]} edit @param {string} [tag]  Same tag in a row: one step (typing, keys).
   */
  const update = (edit, tag = '') => {
    const list = host.pages();
    const at = list.findIndex((item) => item.key === key);
    if (at < 0) return;
    const next = edit([...(list[at].overlays ?? [])]);
    host.change(list.map((item, i) => (i === at ? { ...item, overlays: next } : item)), tag);
  };
  /** @param {(overlay: Overlay) => Overlay} edit @param {string} [tag] */
  const updateChosen = (edit, tag = '') => {
    if (index < 0) return;
    update((list) => list.map((overlay, i) => (i === index ? edit(overlay) : overlay)), tag);
  };

  /* ----- Placing new items ----- */

  /**
   * A box of a given shape on the open page: `share` of the page's width (or a height in points), at a preset place.
   * @param {number} ratio  Width ÷ height, as drawn.
   * @param {{ share?: number, points?: number }} size @param {'bottomRight' | 'bottomLeft' | 'centre'} where
   */
  const boxFor = (ratio, size, where) => {
    const current = /** @type {PlanPage} */ (page());
    const { width, height } = host.shown(current);
    let w = size.share ?? ((size.points ?? SIZE.text) * ratio) / width;
    let h = (w * width) / ratio / height;
    const fit = Math.min(1, 0.9 / w, 0.9 / h);
    [w, h] = [w * fit, h * fit];
    const at = placeAt({ w, h }, where);
    // New items in the middle step down one under another instead of piling up.
    if (where === 'centre') at.y = within(at.y + CASCADE * (overlays().length % 6) - CASCADE * 2, 0, 1 - h);
    return { ...at, w, h, rotation: 0, opacity: 1 };
  };
  /** @param {{ w: number, h: number }} size @param {string} where */
  const placeAt = ({ w, h }, where) => {
    const margin = 0.05;
    if (where === 'centre') return { x: (1 - w) / 2, y: (1 - h) / 2 };
    return { x: where === 'bottomLeft' ? margin : Math.max(0, 1 - w - margin), y: Math.max(0, 1 - h - margin) };
  };
  /** @param {Overlay} overlay */
  const add = (overlay) => {
    update((list) => [...list, overlay]);
    index = overlays().length - 1;
    redraw();
    itemsCanvas.focus();
  };
  /** @param {Signature} signature */
  const addSignature = (signature) => {
    if (signature.kind === 'ink') {
      add({ type: 'ink', strokes: signature.strokes, width: signature.width, color: 'black', ...boxFor(signature.ratio, { share: SIZE.signature }, 'bottomRight') });
    } else {
      add({ type: 'picture', mask: signature.mask, color: 'black', ...boxFor(signature.mask.width / signature.mask.height, { share: SIZE.signature }, 'bottomRight') });
    }
  };
  /** @param {string} text @param {'text' | 'stamp'} type */
  const addText = async (text, type) => {
    const mask = await textMask(text, 'site', type === 'stamp');
    if (!mask || key === null) return;
    const ratio = mask.width / mask.height;
    const lines = text.split('\n').length;
    if (type === 'stamp') {
      add({ type: 'stamp', text, mask, color: 'blue', ...boxFor(ratio, { share: SIZE.stamp }, 'centre'), rotation: -30, opacity: STAMP_OPACITY });
    } else {
      add({ type: 'text', text, mask, font: 'site', bold: false, color: 'black', ...boxFor(ratio, { points: SIZE.text * 1.4 * lines }, 'centre') });
    }
  };
  /** Today as people in Georgia write it, day first: 22.11.2026, and 22/11/2026 on the English pages. */
  const today = () => new Intl.DateTimeFormat(host.lang === 'en' ? 'en-GB' : host.lang).format(new Date());
  /** @param {'tick' | 'cross'} mark */
  const addMark = (mark) => add({ type: 'mark', mark, color: 'black', ...boxFor(1, { points: SIZE.mark }, 'centre') });

  button('add-ink').addEventListener('click', () => {
    inkPanel.hidden = true;
    pad.hidden = false;
    clearPad();
    pad.scrollIntoView?.({ block: 'nearest' });
  });
  button('add-mine').addEventListener('click', () => mine && addSignature(mine));
  button('add-text').addEventListener('click', () => void addText(button('add-text').dataset.text ?? '', 'text'));
  button('add-date').addEventListener('click', () => void addText(today(), 'text'));
  button('add-tick').addEventListener('click', () => addMark('tick'));
  button('add-cross').addEventListener('click', () => addMark('cross'));
  button('add-stamp').addEventListener('click', () => void addText(fill(button('add-stamp').dataset.text ?? '', { date: today() }), 'stamp'));

  /* ----- The signature pad ----- */

  /** @type {Point[][]} */
  let strokes = [];
  const clearPad = () => {
    strokes = [];
    const context = context2d(padCanvas);
    if (context) {
      context.fillStyle = '#ffffff';
      context.fillRect(0, 0, padCanvas.width, padCanvas.height);
    }
  };
  /** A pointer's place on the pad, in the pad's own pixels. @param {PointerEvent} event */
  const padPoint = (event) => {
    const rect = padCanvas.getBoundingClientRect();
    return { x: ((event.clientX - rect.left) / (rect.width || 1)) * padCanvas.width, y: ((event.clientY - rect.top) / (rect.height || 1)) * padCanvas.height };
  };
  const drawPad = () => {
    const context = context2d(padCanvas);
    if (!context) return;
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, padCanvas.width, padCanvas.height);
    context.strokeStyle = '#000000';
    context.lineWidth = PAD_PEN;
    context.lineCap = 'round';
    context.lineJoin = 'round';
    context.beginPath();
    for (const stroke of strokes) stroke.forEach((p, i) => (i === 0 ? context.moveTo(p.x, p.y) : context.lineTo(p.x, p.y)));
    for (const stroke of strokes) if (stroke.length === 1) context.lineTo(stroke[0].x + 0.1, stroke[0].y);
    context.stroke();
  };
  let padding = false;
  padCanvas.addEventListener('pointerdown', (event) => {
    const pointer = /** @type {PointerEvent} */ (event);
    if (pointer.button !== 0) return;
    padding = true;
    padCanvas.setPointerCapture?.(pointer.pointerId);
    strokes.push([padPoint(pointer)]);
    drawPad();
  });
  padCanvas.addEventListener('pointermove', (event) => {
    if (!padding) return;
    const pointer = /** @type {PointerEvent} */ (event);
    const all = typeof pointer.getCoalescedEvents === 'function' ? pointer.getCoalescedEvents() : [];
    strokes[strokes.length - 1].push(...(all.length ? all : [pointer]).map(padPoint));
    drawPad();
  });
  for (const type of ['pointerup', 'pointercancel']) padCanvas.addEventListener(type, () => (padding = false));
  button('pad-clear').addEventListener('click', clearPad);
  button('pad-close').addEventListener('click', () => (pad.hidden = true));
  button('pad-use').addEventListener('click', () => {
    const fitted = fitStrokes(strokes, PAD_PEN);
    if (!fitted) return;
    mine = { kind: 'ink', ...fitted };
    pad.hidden = true;
    addSignature(mine);
    refresh();
  });

  /* ----- A signature from a photo ----- */

  /** @type {{ rgba: Uint8ClampedArray, width: number, height: number } | null} */
  let photo = null;
  /** @type {Mask | null} */
  let photoMask = null;
  const showInk = () => {
    photoMask = photo ? inkMask(photo.rgba, photo.width, photo.height, Number(threshold.value)) : null;
    const note = find('ink-status');
    note.textContent = photoMask ? '' : (note.dataset.none ?? '');
    button('ink-use').disabled = !photoMask;
    const context = context2d(inkCanvas);
    if (!context) return;
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, inkCanvas.width, inkCanvas.height);
    if (!photoMask) return;
    const scale = Math.min(inkCanvas.width / photoMask.width, inkCanvas.height / photoMask.height);
    drawOverlays(context, [{ type: 'picture', mask: photoMask, color: 'black', x: 0, y: 0, w: (photoMask.width * scale) / inkCanvas.width, h: (photoMask.height * scale) / inkCanvas.height, rotation: 0, opacity: 1 }], inkCanvas.width, inkCanvas.height);
  };
  photoInput.addEventListener('change', async () => {
    const file = photoInput.files?.[0];
    photoInput.value = '';
    if (!file) return;
    const bitmap = await decodePicture(new Uint8Array(await file.arrayBuffer()));
    if (!bitmap) {
      photo = null;
    } else {
      // Enough pixels for a sharp signature, few enough to stay quick.
      const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
      const canvas = document.createElement('canvas');
      [canvas.width, canvas.height] = [Math.max(1, Math.round(bitmap.width * scale)), Math.max(1, Math.round(bitmap.height * scale))];
      const context = /** @type {CanvasRenderingContext2D} */ (canvas.getContext('2d', { willReadFrequently: true }));
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      bitmap.close();
      photo = { rgba: context.getImageData(0, 0, canvas.width, canvas.height).data, width: canvas.width, height: canvas.height };
      [canvas.width, canvas.height] = [0, 0];
    }
    pad.hidden = true;
    inkPanel.hidden = false;
    showInk();
    inkPanel.scrollIntoView?.({ block: 'nearest' });
  });
  threshold.addEventListener('input', showInk);
  button('ink-close').addEventListener('click', () => (inkPanel.hidden = true));
  button('ink-use').addEventListener('click', () => {
    if (!photoMask) return;
    mine = { kind: 'picture', mask: photoMask };
    inkPanel.hidden = true;
    photo = null;
    addSignature(mine);
    refresh();
  });

  /* ----- Drawing the stage ----- */

  const redraw = () => {
    const current = page();
    if (!current) return;
    const list = overlays();
    if (index >= list.length) index = list.length - 1;
    [itemsCanvas.width, itemsCanvas.height] = [pageCanvas.width, pageCanvas.height];
    const context = context2d(itemsCanvas);
    if (context) {
      context.clearRect(0, 0, itemsCanvas.width, itemsCanvas.height);
      drawOverlays(context, list, itemsCanvas.width, itemsCanvas.height);
      if (index >= 0) drawFrame(context, list[index]);
    }
    showProps();
  };
  /** The chosen item's frame and corner handles. @param {CanvasRenderingContext2D} context @param {Overlay} overlay */
  const drawFrame = (context, overlay) => {
    const [W, H] = [itemsCanvas.width, itemsCanvas.height];
    const [bw, bh] = [overlay.w * W, overlay.h * H];
    const ratio = itemsCanvas.width / (itemsCanvas.getBoundingClientRect().width || itemsCanvas.width);
    context.save();
    context.translate(overlay.x * W + bw / 2, overlay.y * H + bh / 2);
    context.rotate((overlay.rotation * Math.PI) / 180);
    // Drawn just outside the item, so a small tick or a thin line stays visible inside its frame.
    const [fw, fh] = [bw + 8 * ratio, bh + 8 * ratio];
    context.lineWidth = 2 * ratio;
    context.strokeStyle = '#0b6e69';
    context.setLineDash([6 * ratio, 4 * ratio]);
    context.strokeRect(-fw / 2, -fh / 2, fw, fh);
    context.setLineDash([]);
    context.fillStyle = '#ffffff';
    const size = 8 * ratio;
    for (const [x, y] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      context.fillRect((x * fw) / 2 - size / 2, (y * fh) / 2 - size / 2, size, size);
      context.strokeRect((x * fw) / 2 - size / 2, (y * fh) / 2 - size / 2, size, size);
    }
    context.restore();
  };

  /** Shows the chosen item's settings and the list of items. */
  const showProps = () => {
    const list = overlays();
    const props = find('props');
    props.hidden = list.length === 0;
    /** @type {Record<string, number>} */
    const counts = {};
    itemSelect.replaceChildren(...list.map((overlay, i) => {
      const kind = overlay.type === 'mark' ? overlay.mark : overlay.type;
      counts[kind] = (counts[kind] ?? 0) + 1;
      const option = document.createElement('option');
      option.value = String(i);
      option.textContent = fill(itemSelect.dataset[kind] ?? '', { n: counts[kind] });
      return option;
    }));
    itemSelect.value = String(index);
    const chosen = list[index];
    find('prop-text').hidden = !chosen || (chosen.type !== 'text' && chosen.type !== 'stamp');
    find('prop-font').hidden = !chosen || chosen.type !== 'text';
    find('prop-color').hidden = !chosen;
    find('prop-opacity').hidden = !chosen;
    for (const name of ['item-turn-left', 'item-turn-right', 'item-smaller', 'item-larger', 'item-duplicate', 'item-remove', 'item-every']) button(name).disabled = !chosen;
    for (const place of root.querySelectorAll('[data-js="pdf-place"]')) /** @type {HTMLButtonElement} */ (place).disabled = !chosen;
    if (chosen) {
      if ((chosen.type === 'text' || chosen.type === 'stamp') && textInput !== document.activeElement) textInput.value = chosen.text;
      if (chosen.type === 'text') {
        for (const radio of root.querySelectorAll('[data-js="pdf-item-font"]')) /** @type {HTMLInputElement} */ (radio).checked = /** @type {HTMLInputElement} */ (radio).value === chosen.font;
        /** @type {HTMLInputElement} */ (find('item-bold')).checked = chosen.bold;
      }
      for (const radio of root.querySelectorAll('[data-js="pdf-item-color"]')) /** @type {HTMLInputElement} */ (radio).checked = /** @type {HTMLInputElement} */ (radio).value === chosen.color;
      opacity.value = String(Math.round(chosen.opacity * 100));
    }
    find('not-digital').hidden = !list.some((overlay) => overlay.type === 'ink' || overlay.type === 'picture');
    button('add-mine').disabled = !mine;
  };

  /** Draws the page itself when it changed (opened, turned, resized), then the items. */
  const refresh = async () => {
    const current = page();
    if (!current || stage.hidden) {
      if (key !== null && !current) close();
      return;
    }
    const title = find('stage-title');
    title.textContent = fill(title.dataset.template ?? '', { n: host.pages().findIndex((item) => item.key === key) + 1 });
    const ratio = Math.min(2, globalThis.devicePixelRatio || 1);
    // The view's own width at 100%; zoomed, the page is drawn wider (never past what a preview may be).
    const width = Math.min((Math.min(900, find('view').clientWidth || 600) - 8) * zoom, MAX_PREVIEW_SIDE / ratio);
    const wanted = `${current.key}:${current.turn}:${width}:${ratio}`;
    if (drawnFor !== wanted) {
      drawnFor = wanted;
      const { width: w, height: h } = host.shown(current);
      [pageCanvas.width, pageCanvas.height] = [Math.round(width * ratio), Math.round((width * ratio * h) / w)];
      const shown = await host.drawPage(current, pageCanvas, width, ratio);
      if (!shown) {
        [pageCanvas.width, pageCanvas.height] = [Math.round(width * ratio), Math.round((width * ratio * h) / w)];
        const context = context2d(pageCanvas);
        if (context) {
          context.fillStyle = '#ffffff';
          context.fillRect(0, 0, pageCanvas.width, pageCanvas.height);
        }
      }
      find('view-outline').hidden = shown;
    }
    redraw();
  };

  /* ----- Pointer: choose, move, resize ----- */

  /** A pointer's place as fractions of the shown page, and in CSS pixels. @param {PointerEvent} event */
  const where = (event) => {
    const rect = itemsCanvas.getBoundingClientRect();
    return { x: (event.clientX - rect.left) / (rect.width || 1), y: (event.clientY - rect.top) / (rect.height || 1), width: rect.width || 1, height: rect.height || 1 };
  };
  /**
   * The point in an overlay's own unturned frame, in CSS pixels from its centre.
   * @param {Overlay} overlay @param {{ x: number, y: number, width: number, height: number }} at
   */
  const local = (overlay, at) => {
    const [cx, cy] = [(overlay.x + overlay.w / 2) * at.width, (overlay.y + overlay.h / 2) * at.height];
    const angle = (-overlay.rotation * Math.PI) / 180;
    const [dx, dy] = [at.x * at.width - cx, at.y * at.height - cy];
    return { x: dx * Math.cos(angle) - dy * Math.sin(angle), y: dx * Math.sin(angle) + dy * Math.cos(angle) };
  };
  /** @typedef {{ mode: 'move' | 'resize', start: Overlay, from: { x: number, y: number, width: number, height: number }, handle: Handle | null, id: number }} Drag */
  /** @type {Drag | null} */
  let drag = null;
  itemsCanvas.addEventListener('pointerdown', (event) => {
    const pointer = /** @type {PointerEvent} */ (event);
    if (pointer.button !== 0) return;
    const at = where(pointer);
    const list = overlays();
    const reach = pointer.pointerType === 'touch' || pointer.pointerType === 'pen' ? REACH.touch : REACH.mouse;
    const chosen = list[index];
    if (chosen) {
      const p = local(chosen, at);
      const [hw, hh] = [(chosen.w * at.width) / 2, (chosen.h * at.height) / 2];
      // The handles sit 4 pixels outside the item's corners.
      const corner = /** @type {Handle | null} */ (Math.abs(Math.abs(p.x) - hw - 4) <= reach / 2 && Math.abs(Math.abs(p.y) - hh - 4) <= reach / 2 ? `${p.y < 0 ? 'n' : 's'}${p.x < 0 ? 'w' : 'e'}` : null);
      if (corner) {
        drag = { mode: 'resize', start: chosen, from: at, handle: corner, id: pointer.pointerId };
        itemsCanvas.setPointerCapture?.(pointer.pointerId);
        return;
      }
    }
    for (let i = list.length - 1; i >= 0; i -= 1) {
      const p = local(list[i], at);
      if (Math.abs(p.x) <= (list[i].w * at.width) / 2 + 4 && Math.abs(p.y) <= (list[i].h * at.height) / 2 + 4) {
        index = i;
        drag = { mode: 'move', start: list[i], from: at, handle: null, id: pointer.pointerId };
        itemsCanvas.setPointerCapture?.(pointer.pointerId);
        redraw();
        return;
      }
    }
    index = -1;
    redraw();
  });
  itemsCanvas.addEventListener('pointermove', (event) => {
    const pointer = /** @type {PointerEvent} */ (event);
    if (!drag || pointer.pointerId !== drag.id) return;
    const at = where(pointer);
    const { start } = drag;
    /** @type {Overlay} */
    let moved;
    if (drag.mode === 'move') {
      moved = { ...start, x: within(start.x + at.x - drag.from.x, -start.w / 2, 1 - start.w / 2), y: within(start.y + at.y - drag.from.y, -start.h / 2, 1 - start.h / 2) };
    } else if (start.rotation === 0 && drag.handle) {
      const ratio = (start.w * at.width) / (start.h * at.height);
      const box = resizeWithRatio(start, drag.handle, { x: at.x, y: at.y }, ratio, at.width / at.height, { x: 0.01, y: 0.01 });
      moved = { ...start, ...box };
    } else {
      // A turned item grows and shrinks about its centre, following the pointer's distance from it.
      const [cx, cy] = [(start.x + start.w / 2) * at.width, (start.y + start.h / 2) * at.height];
      const distance = (/** @type {{ x: number, y: number }} */ p) => Math.hypot(p.x * at.width - cx, p.y * at.height - cy);
      moved = scaled(start, distance(at) / Math.max(1, distance(drag.from)));
    }
    preview = overlays().map((overlay, i) => (i === index ? moved : overlay));
    redraw();
  });
  const finish = () => {
    if (!drag) return;
    drag = null;
    const done = preview;
    preview = null;
    if (done) update(() => done);
    redraw();
  };
  itemsCanvas.addEventListener('pointerup', finish);
  itemsCanvas.addEventListener('pointercancel', () => {
    drag = null;
    preview = null;
    redraw();
  });

  /** An overlay scaled about its centre. @param {Overlay} overlay @param {number} factor @returns {Overlay} */
  const scaled = (overlay, factor) => {
    const f = Math.max(0.02 / Math.min(overlay.w, overlay.h), Math.min(factor, 1 / Math.max(overlay.w, overlay.h)));
    const [w, h] = [overlay.w * f, overlay.h * f];
    return { ...overlay, x: overlay.x + (overlay.w - w) / 2, y: overlay.y + (overlay.h - h) / 2, w, h };
  };
  /** @param {number} dx @param {number} dy */
  const nudge = (dx, dy) => updateChosen((overlay) => ({ ...overlay, x: within(overlay.x + dx, -overlay.w / 2, 1 - overlay.w / 2), y: within(overlay.y + dy, -overlay.h / 2, 1 - overlay.h / 2) }), `move:${index}`);
  /** @param {number} degrees */
  const turn = (degrees) => updateChosen((overlay) => ({ ...overlay, rotation: tidyTurn(overlay.rotation + degrees) }), `turn:${index}`);
  /** @param {number} factor */
  const resize = (factor) => updateChosen((overlay) => scaled(overlay, factor), `size:${index}`);
  const remove = () => {
    if (index < 0) return;
    const gone = index;
    update((list) => list.filter((_, i) => i !== gone));
    index = Math.min(gone, overlays().length - 1);
    redraw();
  };

  itemsCanvas.addEventListener('keydown', (event) => {
    const key = /** @type {KeyboardEvent} */ (event);
    if (index < 0 && key.code !== 'Tab') {
      if (overlays().length && /^Arrow/.test(key.code)) {
        index = 0;
        redraw();
        key.preventDefault();
      }
      return;
    }
    const far = key.shiftKey ? STEP.far : STEP.move;
    /** @type {Record<string, () => void>} */
    const actions = {
      ArrowLeft: () => nudge(-far, 0),
      ArrowRight: () => nudge(far, 0),
      ArrowUp: () => nudge(0, -far),
      ArrowDown: () => nudge(0, far),
      Equal: () => resize(STEP.scale),
      NumpadAdd: () => resize(STEP.scale),
      Minus: () => resize(1 / STEP.scale),
      NumpadSubtract: () => resize(1 / STEP.scale),
      KeyR: () => turn(key.shiftKey ? -STEP.turn : STEP.turn),
      Delete: remove,
      Backspace: remove,
    };
    const run = actions[key.code];
    if (!run || key.ctrlKey || key.metaKey || key.altKey) return;
    key.preventDefault();
    run();
  });

  /* ----- The chosen item's settings ----- */

  itemSelect.addEventListener('change', () => {
    index = Number(itemSelect.value);
    redraw();
  });
  /** Draws a text or stamp again after its words or font changed, keeping its height and centre. @param {string} tag */
  const retype = async (tag) => {
    const chosen = overlays()[index];
    if (!chosen || (chosen.type !== 'text' && chosen.type !== 'stamp')) return;
    const text = textInput.value;
    const font = chosen.type === 'text' ? /** @type {FontKey} */ (/** @type {HTMLInputElement | undefined} */ ([...root.querySelectorAll('[data-js="pdf-item-font"]')].find((radio) => /** @type {HTMLInputElement} */ (radio).checked))?.value ?? 'site') : 'site';
    const bold = chosen.type === 'stamp' || /** @type {HTMLInputElement} */ (find('item-bold')).checked;
    const mask = await textMask(text, font, bold);
    if (!mask) return;
    const current = /** @type {PlanPage} */ (page());
    const { width, height } = host.shown(current);
    updateChosen((overlay) => {
      if (overlay.type !== 'text' && overlay.type !== 'stamp') return overlay;
      const w = (overlay.h * height * (mask.width / mask.height)) / width;
      const changed = { ...overlay, text, mask, x: overlay.x + (overlay.w - w) / 2, w };
      return changed.type === 'text' ? { ...changed, font, bold } : changed;
    }, tag);
  };
  textInput.addEventListener('input', () => void retype(`text:${key}:${index}`));
  for (const radio of root.querySelectorAll('[data-js="pdf-item-font"]')) radio.addEventListener('change', () => void retype(''));
  find('item-bold').addEventListener('change', () => void retype(''));
  for (const radio of root.querySelectorAll('[data-js="pdf-item-color"]')) {
    radio.addEventListener('change', () => {
      const color = /** @type {HTMLInputElement} */ (radio).value === 'blue' ? 'blue' : 'black';
      updateChosen((overlay) => ({ ...overlay, color }));
    });
  }
  opacity.addEventListener('input', () => updateChosen((overlay) => ({ ...overlay, opacity: within(Number(opacity.value) / 100, 0.1, 1) }), `opacity:${index}`));
  button('item-turn-left').addEventListener('click', () => turn(-STEP.turn));
  button('item-turn-right').addEventListener('click', () => turn(STEP.turn));
  button('item-smaller').addEventListener('click', () => resize(1 / STEP.scale));
  button('item-larger').addEventListener('click', () => resize(STEP.scale));
  button('item-remove').addEventListener('click', remove);
  button('item-duplicate').addEventListener('click', () => {
    const chosen = overlays()[index];
    if (!chosen) return;
    add({ ...chosen, x: within(chosen.x + 0.03, 0, 1 - chosen.w), y: within(chosen.y + 0.03, 0, 1 - chosen.h) });
  });
  for (const place of root.querySelectorAll('[data-js="pdf-place"]')) {
    place.addEventListener('click', () => updateChosen((overlay) => ({ ...overlay, ...placeAt(overlay, /** @type {HTMLElement} */ (place).dataset.place ?? 'centre') })));
  }
  button('item-every').addEventListener('click', () => {
    const chosen = overlays()[index];
    const current = page();
    if (!chosen || !current) return;
    const from = host.shown(current);
    const ratio = (chosen.w * from.width) / (chosen.h * from.height);
    const targets = host.selected();
    let count = 0;
    const next = host.pages().map((item) => {
      if (item.key === key || !targets.has(item.key)) return item;
      count += 1;
      const { width, height } = host.shown(item);
      // The same width share and place on each page, the height following the item's shape on that page.
      const h = Math.min(0.9, (chosen.w * width) / ratio / height);
      return { ...item, overlays: [...(item.overlays ?? []), { ...chosen, h, y: within(chosen.y, 0, 1 - h) }] };
    });
    if (count === 0) return;
    host.change(next);
    status.textContent = fill(button('item-every').dataset.done ?? '', { count });
  });

  /** @param {1 | -1} direction */
  const zoomBy = (direction) => {
    zoom = stepZoom(zoom, direction);
    find('view').dataset.zoom = String(zoom);
    button('zoom-out').disabled = zoom === ZOOMS[0];
    button('zoom-in').disabled = zoom === ZOOMS[ZOOMS.length - 1];
    void refresh();
  };
  button('zoom-in').addEventListener('click', () => zoomBy(1));
  button('zoom-out').addEventListener('click', () => zoomBy(-1));

  /* ----- Opening and closing ----- */

  /** @param {number} pageKey */
  const open = (pageKey) => {
    key = pageKey;
    index = -1;
    drawnFor = '';
    preview = null;
    pad.hidden = true;
    inkPanel.hidden = true;
    status.textContent = '';
    stage.hidden = false;
    zoom = ZOOMS[1];
    zoomBy(-1);
    readBack ??= canReadBack();
    find('stage-blocked').hidden = readBack;
    for (const name of ['add-text', 'add-date', 'add-stamp']) button(name).disabled = !readBack;
    photoInput.disabled = !readBack;
    find('add-photo').classList.toggle('is-disabled', !readBack);
    find('add-photo').hidden = !readBack;
    button('add-mine').disabled = !mine;
    void refresh();
    stage.scrollIntoView?.({ block: 'start' });
    itemsCanvas.focus();
  };
  const close = () => {
    key = null;
    stage.hidden = true;
  };
  button('stage-done').addEventListener('click', close);

  return {
    open,
    close,
    /** Redraws after the plan changed (undo, redo, a page turned). */
    refresh: () => void refresh(),
    /** Forgets the signature made in this tab ("Start again"). */
    reset: () => {
      mine = null;
      photo = null;
      photoMask = null;
      strokes = [];
      close();
    },
    get openKey() {
      return key;
    },
  };
}

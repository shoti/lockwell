// @ts-check
/**
 * @file Page previews for the PDF tools, drawn by Mozilla's PDF.js. The ONLY module that loads PDF.js
 * (src/vendor/pdfjs/, served from /assets/vendor/pdfjs-<version>/): loaded on first use, never on other pages.
 * PDF.js only draws; every saved file is built by our own code (pdf-build.mjs). Contained as milestone 0 proved
 * under the site's unchanged CSP (docs/research/tool-pdf-toolkit.md §13): the worker is created here through a
 * Trusted Types policy that allows only its one URL; no WebAssembly; the JPEG 2000 and JBIG2 decoders and the
 * character maps come from our own folder through import(), never through the network API; no scripting, no XFA,
 * no text or annotation layers. Nothing of PDF.js is exposed to the rest of the page.
 */

/** Must match the first line of src/vendor/pdfjs/VERSION (a test checks). */
export const PDFJS_VERSION = '6.5.438';

const VENDOR = new URL(`../vendor/pdfjs-${PDFJS_VERSION}/`, import.meta.url).href;
const WORKER = `${VENDOR}pdf.worker.min.mjs`;

/** Largest canvas side drawn for a preview, in device pixels. */
export const MAX_PREVIEW_SIDE = 2048;

/** What was done, for tests that count operations. */
export const COUNTS = { loads: 0, opened: 0, drawn: 0, released: 0 };

/**
 * The part of PDF.js used here.
 * @typedef {{ promise: Promise<unknown>, cancel: () => void }} RenderTask
 * @typedef {{ rotate: number, getViewport: (options: { scale: number, rotation: number }) => { width: number, height: number },
 *   render: (options: { canvas: HTMLCanvasElement, viewport: unknown }) => RenderTask, cleanup: () => void }} PdfjsPage
 * @typedef {{ numPages: number, getPage: (n: number) => Promise<PdfjsPage> }} PdfjsDocument
 * @typedef {{ promise: Promise<PdfjsDocument>, destroy: () => Promise<void>, onPassword?: unknown }} LoadingTask
 * @typedef {{ getDocument: (options: Record<string, unknown>) => LoadingTask, GlobalWorkerOptions: { workerPort: Worker | null } }} Pdfjs
 */

/** @typedef {{ task: LoadingTask, doc: PdfjsDocument }} Preview */

/** @type {Promise<Pdfjs> | null} */
let loading = null;

/**
 * The library, loaded once, with its worker. Null when it cannot load (an old browser, a blocked script): the
 * board then shows pages as outlines.
 * @returns {Promise<Pdfjs | null>}
 */
export async function library() {
  loading ??= (async () => {
    COUNTS.loads += 1;
    const pdfjs = /** @type {Pdfjs} */ (await import(`${VENDOR}pdf.min.mjs`));
    // `require-trusted-types-for 'script'` makes the worker's URL a protected sink: only this one URL passes.
    const trusted = /** @type {{ trustedTypes?: { createPolicy: (name: string, rules: { createScriptURL: (url: string) => string }) => { createScriptURL: (url: string) => unknown } } }} */ (/** @type {unknown} */ (globalThis)).trustedTypes;
    const policy = trusted?.createPolicy('lockwell-pdf-worker', {
      createScriptURL: (/** @type {string} */ url) => {
        if (url !== WORKER) throw new TypeError(`Refused worker URL ${url}`);
        return url;
      },
    });
    const url = policy ? /** @type {string} */ (/** @type {unknown} */ (policy.createScriptURL(WORKER))) : WORKER;
    pdfjs.GlobalWorkerOptions.workerPort = new Worker(url, { type: 'module' });
    return pdfjs;
  })();
  try {
    return await loading;
  } catch (error) {
    console.error('[lockwell] The PDF previews could not start; pages are shown as outlines.', error);
    return null;
  }
}

/**
 * Hands PDF.js the character maps it asks for, from our own folder by import() (script-src 'self'), since network
 * requests are blocked (connect-src 'none'). PDF.js calls this method `fetch`. Each map is a module `export const base64 = "…"` written by
 * scripts/update-pdfjs.mjs. Standard fonts are not shipped: system fonts draw them (owner's decision, plan §15).
 */
class ModuleDataFactory {
  /** @param {{ cMapUrl?: string | null }} options */
  constructor({ cMapUrl = null }) {
    this.cMapUrl = cMapUrl;
  }

  /** @param {{ kind: string, filename: string }} request */
  async fetch({ kind, filename }) {
    if (kind !== 'cMapUrl' || !this.cMapUrl || !/^[\w.-]+$/.test(filename)) throw new Error(`No ${kind} for ${filename}`);
    const { base64 } = await import(`${this.cMapUrl}${filename}.mjs`);
    return Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
  }
}

/**
 * Opens a source for previews. PDF.js moves the bytes it is given to its worker, so it gets a copy.
 * @param {Uint8Array} bytes
 * @param {{ password?: string }} [options]
 * @returns {Promise<Preview | null>}  null when previews are unavailable or this file cannot be drawn.
 */
export async function openPreview(bytes, { password } = {}) {
  const pdfjs = await library();
  if (!pdfjs) return null;
  const task = pdfjs.getDocument({
    data: bytes.slice(),
    password,
    useWasm: false,
    wasmUrl: VENDOR,
    enableXfa: false,
    useWorkerFetch: false,
    BinaryDataFactory: ModuleDataFactory,
    cMapUrl: `${VENDOR}cmaps/`,
    cMapPacked: true,
    stopAtErrors: false,
    verbosity: 0,
  });
  try {
    const doc = await task.promise;
    COUNTS.opened += 1;
    return { task, doc };
  } catch {
    await task.destroy().catch(() => {});
    return null;
  }
}

/**
 * Draws one page into a canvas, `width` CSS pixels wide, turned by `turn` on top of the page's own rotation.
 * @param {Preview} preview
 * @param {number} index  From 0.
 * @param {HTMLCanvasElement} canvas
 * @param {{ width: number, turn: number, ratio?: number }} size  ratio: device pixels per CSS pixel.
 * @returns {{ done: Promise<boolean>, cancel: () => void }}  done: false when it failed or was cancelled.
 */
export function drawPage(preview, index, canvas, { width, turn, ratio = 1 }) {
  /** @type {RenderTask | null} */
  let render = null;
  let cancelled = false;
  const done = (async () => {
    try {
      const page = await preview.doc.getPage(index + 1);
      if (cancelled) return false;
      const rotation = (((page.rotate + turn) % 360) + 360) % 360;
      const unit = page.getViewport({ scale: 1, rotation });
      const scale = Math.min((width * ratio) / unit.width, MAX_PREVIEW_SIDE / Math.max(unit.width, unit.height));
      const viewport = page.getViewport({ scale, rotation });
      canvas.width = Math.max(1, Math.round(viewport.width));
      canvas.height = Math.max(1, Math.round(viewport.height));
      render = page.render({ canvas, viewport });
      await render.promise;
      page.cleanup();
      COUNTS.drawn += 1;
      return true;
    } catch {
      return false;
    }
  })();
  return {
    done,
    cancel() {
      cancelled = true;
      render?.cancel();
    },
  };
}

/**
 * Lets go of a source's previews and their memory.
 * @param {Preview | null} preview
 */
export async function closePreview(preview) {
  if (!preview) return;
  COUNTS.released += 1;
  await preview.task.destroy().catch(() => {});
}

// @ts-check
// SPDX-FileCopyrightText: 2026 Shota Mtvarelishvili <mtvarelishvili@proton.me>
// SPDX-License-Identifier: MIT
/**
 * @file Tool "What your browser reveals": shows what any site can read from this browser.
 * @author Shota Mtvarelishvili <mtvarelishvili@proton.me> (https://shoti.github.io/)
 */
/**
 * "What your browser reveals": reads the same things any website can read
 * without asking, and shows them to the visitor. Nothing is stored or sent.
 *
 * Values are either text shown as it is, or one of the words the page
 * translates (TOKENS in templates/tool-panels.mjs): yes, no, on, off, unset,
 * unsupported, none, dark, light, unknown.
 */

/**
 * @typedef {object} BrowserEnv  The parts of the browser this tool reads (a plain object in tests).
 * @property {{ languages?: readonly string[], language?: string, userAgent?: string, platform?: string,
 *   hardwareConcurrency?: number, deviceMemory?: number, maxTouchPoints?: number, cookieEnabled?: boolean,
 *   doNotTrack?: string | null, globalPrivacyControl?: boolean,
 *   connection?: { effectiveType?: string, downlink?: number, saveData?: boolean } }} navigator
 * @property {{ width: number, height: number, colorDepth?: number }} screen
 * @property {{ innerWidth: number, innerHeight: number, devicePixelRatio?: number }} window
 * @property {string} timeZone
 * @property {number} offsetMinutes  Date#getTimezoneOffset(): minutes behind UTC.
 * @property {(query: string) => boolean} media  Whether a media query matches.
 * @property {string} referrer
 */

/**
 * "UTC+4", "UTC-3:30".
 * @param {number} offsetMinutes  As returned by Date#getTimezoneOffset (positive = behind UTC).
 */
export function utcOffset(offsetMinutes) {
  const minutes = -offsetMinutes;
  const hours = Math.trunc(Math.abs(minutes) / 60);
  const rest = Math.abs(minutes) % 60;
  return `UTC${minutes < 0 ? '-' : '+'}${hours}${rest ? `:${String(rest).padStart(2, '0')}` : ''}`;
}

/**
 * Everything that can be read at once, one value per row of the report.
 * @param {BrowserEnv} env
 * @returns {Record<string, string>}
 */
export function browserFacts({ navigator, screen, window, timeZone, offsetMinutes, media, referrer }) {
  const languages = navigator.languages?.length ? navigator.languages : navigator.language ? [navigator.language] : [];
  const ratio = window.devicePixelRatio ?? 1;
  // Browsers spell "on" as "1" or "yes", and "off" as "0" or "no".
  const dnt = navigator.doNotTrack;
  const gamut = ['rec2020', 'p3', 'srgb'].find((name) => media(`(color-gamut: ${name})`));
  const colors = [screen.colorDepth ? `${screen.colorDepth}-bit` : '', gamut ? gamut.replace('srgb', 'sRGB').replace('p3', 'P3').replace('rec2020', 'Rec. 2020') : '', media('(dynamic-range: high)') ? 'HDR' : ''];
  const link = navigator.connection;
  const connection = link
    ? [link.effectiveType, link.downlink ? `${link.downlink} Mbps` : '', link.saveData ? 'data saver' : ''].filter(Boolean).join(', ')
    : '';
  return {
    languages: languages.join(', ') || 'unknown',
    timeZone: timeZone ? `${timeZone} (${utcOffset(offsetMinutes)})` : utcOffset(offsetMinutes),
    userAgent: navigator.userAgent || 'unknown',
    platform: navigator.platform || 'unknown',
    cores: navigator.hardwareConcurrency ? String(navigator.hardwareConcurrency) : 'unknown',
    memory: navigator.deviceMemory ? `${navigator.deviceMemory} GB` : 'unknown',
    screen: `${screen.width} × ${screen.height}${ratio === 1 ? '' : `, ×${Math.round(ratio * 100) / 100}`}`,
    window: `${window.innerWidth} × ${window.innerHeight}`,
    colors: colors.filter(Boolean).join(', ') || 'unknown',
    touch: (navigator.maxTouchPoints ?? 0) > 0 ? 'yes' : 'no',
    theme: media('(prefers-color-scheme: dark)') ? 'dark' : 'light',
    motion: media('(prefers-reduced-motion: reduce)') ? 'on' : 'off',
    contrast: media('(prefers-contrast: more)') ? 'on' : 'off',
    cookies: navigator.cookieEnabled ? 'yes' : 'no',
    dnt: dnt === '1' || dnt === 'yes' ? 'on' : dnt === '0' || dnt === 'no' ? 'off' : 'unset',
    gpc: navigator.globalPrivacyControl === undefined ? 'unsupported' : navigator.globalPrivacyControl ? 'on' : 'off',
    connection: connection || 'unknown',
    referrer: referrer || 'none',
  };
}

/** Rows that change while you browse, so they are left out of the fingerprint. */
const UNSTABLE = ['window', 'referrer', 'connection', 'fingerprint'];

/**
 * The text a fingerprint is computed from: every stable fact, in a fixed order.
 * @param {Record<string, string>} facts
 */
export function fingerprintSource(facts) {
  return Object.keys(facts)
    .filter((key) => !UNSTABLE.includes(key))
    .sort()
    .map((key) => `${key}=${facts[key]}`)
    .join('\n');
}

/** Fonts that say something about the device or the programs on it. */
export const FONTS = [
  'Arial', 'Helvetica Neue', 'Times New Roman', 'Courier New', 'Georgia', 'Verdana', 'Tahoma', 'Trebuchet MS', 'Impact', 'Comic Sans MS',
  'Segoe UI', 'Calibri', 'Cambria', 'Consolas', 'Sylfaen', 'Microsoft Sans Serif',
  'San Francisco', 'Menlo', 'Monaco', 'Avenir', 'Futura', 'Gill Sans', 'Optima', 'Palatino',
  'Roboto', 'Noto Sans', 'Noto Sans Georgian', 'Ubuntu', 'DejaVu Sans', 'Liberation Sans', 'Cantarell',
  'BPG Nino Mtavruli', 'BPG Glaho', 'Adobe Garamond Pro', 'Myriad Pro', 'Source Sans Pro', 'Fira Code', 'JetBrains Mono',
];

/**
 * Which fonts are installed: a font is there if text set in it is not the
 * same width as in every generic fallback.
 * @param {string[]} fonts
 * @param {(family: string) => number} width  Width of a fixed sample text in a CSS font family.
 * @returns {string[]}
 */
export function detectFonts(fonts, width) {
  const bases = ['monospace', 'serif', 'sans-serif'];
  const baseline = bases.map(width);
  return fonts.filter((font) => bases.some((base, i) => width(`"${font}", ${base}`) !== baseline[i]));
}

/**
 * The hidden fields of the autofill demonstration that hold a value.
 * @param {{ label: string, value: string }[]} fields
 * @returns {{ label: string, value: string }[]}
 */
export function autofillLeak(fields) {
  return fields.map(({ label, value }) => ({ label, value: value.trim() })).filter(({ value }) => value !== '');
}

/**
 * @param {string} text
 * @returns {Promise<string | null>}  Hex SHA-256, or null where the browser offers no hashing (pages not served securely).
 */
async function sha256(text) {
  if (!globalThis.crypto?.subtle) return null;
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** "3f9a1c0e22b7" → "3f9a-1c0e-22b7" @param {string} hex */
const grouped = (hex) => hex.match(/.{4}/g)?.join('-') ?? hex;

/**
 * The graphics chip, as WebGL names it.
 * @returns {string | null}
 */
function graphicsChip() {
  const gl = document.createElement('canvas').getContext('webgl');
  if (!gl) return null;
  const info = gl.getExtension('WEBGL_debug_renderer_info');
  const name = info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
  return typeof name === 'string' && name ? name : null;
}

/**
 * A picture drawn off screen. Devices render the text and curves slightly
 * differently, so the pixels work as a signature.
 * @returns {string | null}  The picture as text, to be hashed.
 */
function canvasDrawing() {
  const canvas = document.createElement('canvas');
  canvas.width = 240;
  canvas.height = 60;
  const context = canvas.getContext('2d');
  if (!context) return null;
  context.textBaseline = 'top';
  context.font = '16px Arial, sans-serif';
  context.fillStyle = '#f60';
  context.fillRect(100, 5, 80, 30);
  context.fillStyle = '#069';
  context.fillText('Lockwell ქართული 🔒', 4, 8);
  context.fillStyle = 'rgba(14, 106, 105, 0.6)';
  context.arc(60, 40, 18, 0, Math.PI * 2);
  context.fill();
  return canvas.toDataURL();
}

/** @returns {string[]} */
function installedFonts() {
  const context = document.createElement('canvas').getContext('2d');
  if (!context) return [];
  return detectFonts(FONTS, (family) => {
    context.font = `72px ${family}`;
    return context.measureText('mmmmmmmmmmlli ქართული').width;
  });
}

/**
 * Details Chromium browsers hand out on request: exact system version, device model.
 * @returns {Promise<{ os: string | null, model: string | null }>}
 */
async function clientHints() {
  /** @type {{ getHighEntropyValues?: (hints: string[]) => Promise<Record<string, string>> } | undefined} */
  const data = /** @type {any} */ (navigator).userAgentData;
  if (!data?.getHighEntropyValues) return { os: null, model: null };
  const hints = await data.getHighEntropyValues(['platform', 'platformVersion', 'architecture', 'model']);
  const os = [hints.platform, hints.platformVersion, hints.architecture].filter(Boolean).join(' ');
  return { os: os || null, model: hints.model || null };
}

/**
 * Runs a reading that may fail or be blocked; the row then says "not available".
 * @template T
 * @param {string} what
 * @param {() => T | Promise<T>} read
 * @returns {Promise<T | null>}
 */
async function attempt(what, read) {
  try {
    return await read();
  } catch (error) {
    console.warn(`[lockwell] Could not read the ${what}; showing it as not available.`, error);
    return null;
  }
}

/** @param {HTMLElement} root */
function initFacts(root) {
  const list = root.querySelector('[data-js="browser-facts"]');
  if (!(list instanceof HTMLElement)) return;

  /** @param {Record<string, string>} facts */
  const show = (facts) => {
    list.querySelectorAll('[data-row]').forEach((row) => {
      const value = row.querySelector('[data-js="browser-value"]');
      const fact = row instanceof HTMLElement ? facts[row.dataset.row ?? ''] : undefined;
      if (!value || fact === undefined) return;
      // data-token-yes="Yes" → dataset.tokenYes
      value.textContent = list.dataset[`token${fact.charAt(0).toUpperCase()}${fact.slice(1)}`] ?? fact;
    });
  };

  const instant = () =>
    browserFacts({
      navigator,
      screen,
      window,
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      offsetMinutes: new Date().getTimezoneOffset(),
      media: (query) => window.matchMedia(query).matches,
      referrer: document.referrer,
    });

  /** Readings that take a moment; filled in once, after the instant ones. */
  const slow = async () => {
    const [hints, gpu, drawing, fonts] = await Promise.all([
      attempt('system details', clientHints),
      attempt('graphics chip', graphicsChip),
      attempt('canvas drawing', canvasDrawing),
      attempt('installed fonts', installedFonts),
    ]);
    const canvas = drawing ? await sha256(drawing) : null;
    /** @type {Record<string, string>} */
    const facts = {
      ...instant(),
      os: hints?.os ?? 'unknown',
      model: hints?.model ?? 'unknown',
      gpu: gpu ?? 'unknown',
      canvas: canvas ? grouped(canvas.slice(0, 12)) : 'unknown',
      fonts: fonts?.length ? `${fonts.length} / ${FONTS.length}: ${fonts.join(', ')}` : 'unknown',
    };
    const print = await sha256(fingerprintSource(facts));
    show({ ...facts, fingerprint: print ? grouped(print.slice(0, 16)) : 'unknown' });
  };

  show(instant());
  slow().catch((error) => console.error('[lockwell] Could not finish the browser report.', error));
  // The window size is part of what sites see, and it changes.
  window.addEventListener('resize', () => show(instant()), { passive: true });
}

/**
 * The autofill demonstration: two visible fields and several the visitor
 * can't see. If the browser fills in a saved address, the hidden ones show
 * what it handed over. Values stay in this page and are erased on leaving.
 * @param {HTMLElement} root
 */
function initAutofill(root) {
  const form = root.querySelector('[data-js="autofill-form"]');
  const result = root.querySelector('[data-js="autofill-result"]');
  const list = root.querySelector('[data-js="autofill-list"]');
  const message = root.querySelector('[data-js="autofill-message"]');
  if (!(form instanceof HTMLFormElement) || !(result instanceof HTMLElement) || !(list instanceof HTMLElement) || !(message instanceof HTMLElement)) return;
  const hidden = /** @type {HTMLInputElement[]} */ ([...form.querySelectorAll('[data-js="autofill-hidden"]')]);
  const visible = /** @type {HTMLInputElement[]} */ ([...form.querySelectorAll('[data-js="autofill-visible"]')]);

  const update = () => {
    const leaked = autofillLeak(hidden.map((field) => ({ label: field.dataset.label ?? '', value: field.value })));
    const typed = visible.some((field) => field.value.trim() !== '');
    list.replaceChildren(
      ...leaked.map(({ label, value }) => {
        const item = document.createElement('li');
        const name = document.createElement('strong');
        name.textContent = `${label}: `;
        item.append(name, value);
        return item;
      }),
    );
    result.hidden = !typed && leaked.length === 0;
    result.classList.toggle('autofill__result--leak', leaked.length > 0);
    message.textContent = (leaked.length ? message.dataset.leaked : message.dataset.safe) ?? '';
  };

  const clear = () => {
    form.reset();
    update();
  };

  form.addEventListener('input', update);
  form.addEventListener('change', update);
  // The form goes nowhere (the Content-Security-Policy forbids it as well).
  form.addEventListener('submit', (event) => event.preventDefault());
  form.querySelector('[data-js="autofill-clear"]')?.addEventListener('click', clear);
  // Don't keep someone's address in a page the browser may restore later.
  window.addEventListener('pagehide', clear);
}

/** @param {HTMLElement} root */
export function init(root) {
  initFacts(root);
  initAutofill(root);
}

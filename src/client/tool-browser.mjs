// @ts-check
/**
 * @file Tool "What your browser reveals": shows what any site can read from this browser.
 */
/**
 * "What your browser reveals": reads the same things any website can read
 * without asking, and shows them to the visitor. It also says where the
 * browser seems to protect a value, and what the visitor can do next.
 *
 * Two things happen only when the visitor asks: the IP lookup, one request to
 * this site's own host (Cloudflare answers /cdn-cgi/trace itself), and the
 * comparison, which keeps the values in this tab's session storage.
 * Sources for the ratings and the protections: docs/research/tool-browser-check.md.
 *
 * Values are either text shown as it is, or one of the words the page
 * translates (BROWSER_TOKENS in templates/tool-panels.mjs): yes, no, on, off,
 * unset, unsupported, none, dark, light, unknown, notSeen.
 */

import { CLEARED_EVENT, read, remove, write } from './storage.mjs';
import { fillText } from './fill.mjs';

/** Where Cloudflare tells a visitor their own address and country. */
export const TRACE_URL = '/cdn-cgi/trace';
/** The remembered values for the comparison (session storage: this tab only). */
const COMPARE_KEY = 'browser-compare';
/** How long the IP lookup may take before the page gives up. */
const IP_TIMEOUT_MS = 8000;

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
  const ratio = Math.round((window.devicePixelRatio ?? 1) * 100) / 100;
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
    screen: `${screen.width} × ${screen.height}`,
    pixelRatio: String(ratio),
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

/**
 * Rows that change while you browse, or with the time of day (an automatic theme), page zoom (the pixel ratio)
 * or a click (a blocker turned off), or that may arrive after the reading (the voice list), so they are left out
 * of the fingerprint.
 */
const UNSTABLE = ['window', 'referrer', 'connection', 'fingerprint', 'theme', 'pixelRatio', 'blocker', 'voices'];
/** Rows that change on their own between two visits, so the comparison leaves them out. */
const DRIFTING = ['window', 'referrer', 'connection'];
/**
 * The part of a value that stays put: a screen's two sides whichever way the phone is turned, a time zone
 * without its offset, which changes with summer time.
 * @type {Record<string, (value: string) => string>}
 */
const STEADY = {
  screen: (value) => value.split(' × ').map(Number).sort((a, b) => b - a).join(' × '),
  timeZone: (value) => value.replace(/ \(UTC[^)]*\)$/, ''),
};

/**
 * The text a fingerprint is computed from: every stable fact, in a fixed order.
 * @param {Record<string, string>} facts
 */
export function fingerprintSource(facts) {
  return Object.keys(facts)
    .filter((key) => !UNSTABLE.includes(key))
    .sort()
    .map((key) => `${key}=${STEADY[key]?.(facts[key]) ?? facts[key]}`)
    .join('\n');
}

/** Time zones that Tor Browser and Firefox's resistFingerprinting report for everyone (nsRFPService.cpp), or UTC. */
const UNIFORM_ZONES = ['Atlantic/Reykjavik', 'UTC', 'Etc/UTC', 'Etc/GMT', 'GMT'];

/**
 * Protections a browser gives away through the values it reports.
 * - screen: screen size equal to the window, window at 0,0 (Safari's Advanced Fingerprinting Protection; a
 *   full-screen window looks the same).
 * - timeZone: one zone for everyone, at offset 0 (Tor Browser, Firefox resistFingerprinting).
 * - window: inner size on the 200 × 100 grid of letterboxing (same browsers).
 * @param {{ screen: { width: number, height: number }, window: { innerWidth: number, innerHeight: number, screenX?: number, screenY?: number }, timeZone: string, offsetMinutes: number }} env
 * @returns {('screen' | 'timeZone' | 'window')[]}
 */
export function detectProtections({ screen, window, timeZone, offsetMinutes }) {
  /** @type {('screen' | 'timeZone' | 'window')[]} */
  const found = [];
  if (screen.width === window.innerWidth && screen.height === window.innerHeight && window.screenX === 0 && window.screenY === 0) found.push('screen');
  if (UNIFORM_ZONES.includes(timeZone) && offsetMinutes === 0) found.push('timeZone');
  if (window.innerWidth >= 400 && window.innerWidth % 200 === 0 && window.innerHeight % 100 === 0) found.push('window');
  return found;
}

/**
 * Which signs come from the same values: a window in full screen fills the screen and often sits on the
 * 200 × 100 grid too, so those two count as one.
 * @type {Record<string, string>}
 */
const SIGN_SOURCE = { screen: 'size', window: 'size', timeZone: 'zone', canvas: 'canvas' };

/**
 * Which rows may say that the browser protects them, and whether the fingerprint changes because of it.
 * Ordinary browsers give single signs too (a full-screen window, a computer set to UTC, someone in Iceland),
 * so the size and time-zone notes need signs from two different sources. Canvas noise is seen directly, and is
 * the only sign that makes the code itself change: uniform values make it common, not changing.
 * @param {string[]} signs  From detectProtections, plus 'canvas' when the canvas came back changed.
 * @returns {{ rows: string[], shifting: boolean }}
 */
export function protectionNotes(signs) {
  const sources = new Set(signs.map((sign) => SIGN_SOURCE[sign]));
  return { rows: signs.filter((sign) => sign === 'canvas' || sources.size >= 2), shifting: signs.includes('canvas') };
}

/** Four colours in four squares: Firefox adds no noise to a canvas of one colour, so a plain fill would hide it. */
const PATTERN_COLOURS = [
  [102, 153, 204],
  [204, 102, 51],
  [51, 204, 102],
  [240, 220, 30],
];

/** What the noise test draws, pixel by pixel: 16 × 16, RGBA. */
export function canvasPattern() {
  const pixels = new Uint8ClampedArray(16 * 16 * 4);
  for (let y = 0; y < 16; y += 1) {
    for (let x = 0; x < 16; x += 1) pixels.set([...PATTERN_COLOURS[(y < 8 ? 0 : 2) + (x < 8 ? 0 : 1)], 255], (y * 16 + x) * 4);
  }
  return pixels;
}

/**
 * True when the drawing came back changed: the browser adds noise to canvas readings on purpose.
 * @param {Uint8ClampedArray} pixels  RGBA read back.
 * @param {Uint8ClampedArray} drawn  What was drawn (canvasPattern).
 */
export function canvasNoise(pixels, drawn) {
  return pixels.length !== drawn.length || pixels.some((value, index) => value !== drawn[index]);
}

/**
 * Values remembered for the comparison, or null when what is stored is not a set of them.
 * @param {string} text
 * @returns {Record<string, string> | null}
 */
export function rememberedFacts(text) {
  /** @type {unknown} */
  let value;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  const entries = Object.entries(value);
  return entries.length > 0 && entries.every(([, fact]) => typeof fact === 'string') ? Object.fromEntries(entries) : null;
}

/**
 * The address and country from Cloudflare's trace answer ("key=value" lines). Only an address is accepted.
 * @param {string} text
 * @returns {{ ip: string, country: string } | null}
 */
export function parseTrace(text) {
  const fields = new Map(
    text
      .split('\n')
      .map((line) => line.split('='))
      .filter((parts) => parts.length === 2)
      .map(([key, value]) => [key.trim(), value.trim()]),
  );
  const ip = fields.get('ip') ?? '';
  if (!/^[0-9a-fA-F:.]{3,45}$/.test(ip) || !/[.:]/.test(ip)) return null;
  const country = fields.get('loc') ?? '';
  return { ip, country: /^[A-Z]{2}$/.test(country) ? country : '' };
}

/**
 * The characters on the first six letter keys (Q W E R T Y on a US keyboard), which show the layout in use.
 * @param {(code: string) => string | undefined} key  The character a key code types.
 */
export const layoutSample = (key) => ['KeyQ', 'KeyW', 'KeyE', 'KeyR', 'KeyT', 'KeyY'].map((code) => key(code) ?? '').join('');

/**
 * Rows whose value differs from the remembered one, leaving out those that change on their own.
 * @param {Record<string, string>} before
 * @param {Record<string, string>} after
 */
export function compareFacts(before, after) {
  return [...new Set([...Object.keys(before), ...Object.keys(after)])]
    .filter((key) => !DRIFTING.includes(key) && before[key] !== after[key])
    .sort();
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

/** Whether the browser changes canvas readings: four coloured squares, read back. */
function canvasChanged() {
  const canvas = document.createElement('canvas');
  canvas.width = 16;
  canvas.height = 16;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) return false;
  PATTERN_COLOURS.forEach((colour, index) => {
    context.fillStyle = `rgb(${colour.join(',')})`;
    context.fillRect((index % 2) * 8, Math.floor(index / 2) * 8, 8, 8);
  });
  return canvasNoise(context.getImageData(0, 0, 16, 16).data, canvasPattern());
}

/** The keyboard layout, where the browser shares it (Chromium). @returns {Promise<string | null>} */
async function keyboardLayout() {
  /** @type {{ getLayoutMap?: () => Promise<Map<string, string>> } | undefined} */
  const keyboard = /** @type {any} */ (navigator).keyboard;
  if (!keyboard?.getLayoutMap) return null;
  const map = await keyboard.getLayoutMap();
  return layoutSample((code) => map.get(code)) || null;
}

/** How many speech voices are installed; browsers may list them only after a moment. @returns {Promise<string | null>} */
async function speechVoices() {
  if (!('speechSynthesis' in window)) return null;
  let voices = speechSynthesis.getVoices();
  if (voices.length === 0) {
    await new Promise((resolve) => {
      speechSynthesis.addEventListener('voiceschanged', resolve, { once: true });
      setTimeout(resolve, 1500);
    });
    voices = speechSynthesis.getVoices();
  }
  return String(voices.length);
}

/**
 * Whether a content blocker hides "bait": an element with class names that blockers hide on every site
 * (the method of Drazner et al. 2019). Placed out of sight and removed at once.
 */
async function contentBlocker() {
  const bait = document.createElement('div');
  bait.className = 'ad ads adsbox ad-banner ad-placement textads banner-ads';
  bait.setAttribute('aria-hidden', 'true');
  bait.textContent = '\u00a0';
  bait.classList.add('bait');
  document.body.append(bait);
  // Blockers apply their rules shortly after an element appears.
  await new Promise((resolve) => setTimeout(resolve, 300));
  const hidden = bait.offsetHeight === 0 || getComputedStyle(bait).display === 'none' || getComputedStyle(bait).visibility === 'hidden';
  bait.remove();
  // Not seen is not the same as none: blockers that work on the network or in DNS hide nothing here.
  return hidden ? 'yes' : 'notSeen';
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
  /** @param {string} name @returns {HTMLElement | null} */
  const find = (name) => root.querySelector(`[data-js="browser-${name}"]`);
  /** The last full set of values, for the comparison. @type {Record<string, string>} */
  let latest = {};

  /** A token's word in the page's language, or the value itself. @param {string} value */
  const word = (value) => list.dataset[`token${value.charAt(0).toUpperCase()}${value.slice(1)}`] ?? value;

  /** @param {Record<string, string>} facts */
  const show = (facts) => {
    list.querySelectorAll('[data-row]').forEach((row) => {
      const value = row.querySelector('[data-js="browser-value"]');
      const fact = row instanceof HTMLElement ? facts[row.dataset.row ?? ''] : undefined;
      if (!(value instanceof HTMLElement) || fact === undefined) return;
      // data-token-yes="Yes" → dataset.tokenYes; rows with several values fill a template.
      if (value.dataset.template && fact.startsWith('{')) {
        const parts = /** @type {Record<string, string | number>} */ (JSON.parse(fact));
        value.textContent = value.dataset.template.replace(/\{(\w+)\}/g, (_, key) => word(String(parts[key] ?? 'unknown')));
      } else {
        value.textContent = value.dataset.template && fact !== 'unknown' ? fillText(value.dataset.template, { n: fact }) : word(fact);
      }
    });
  };

  /**
   * Puts a protection note in place of a row's explanation, and says whether the fingerprint changes. Notes
   * share a cell with what they replace, so nothing moves. @param {string[]} signs
   */
  const markProtected = (signs) => {
    const { rows, shifting } = protectionNotes(signs);
    list.querySelectorAll('[data-js="browser-notes"]').forEach((notes) => {
      notes.toggleAttribute('data-on', rows.includes(notes.closest('[data-row]')?.getAttribute('data-row') ?? ''));
    });
    find('fingerprint-notes')?.toggleAttribute('data-on', shifting);
  };

  const environment = () => ({
    navigator,
    screen,
    window,
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    offsetMinutes: new Date().getTimezoneOffset(),
    media: (/** @type {string} */ query) => window.matchMedia(query).matches,
    referrer: document.referrer,
  });
  const instant = () => browserFacts(environment());

  /** Readings that take a moment; filled in once, after the instant ones. */
  const slow = async () => {
    const [hints, gpu, drawing, fonts, noise, keyboard, voices, blocker] = await Promise.all([
      attempt('system details', clientHints),
      attempt('graphics chip', graphicsChip),
      attempt('canvas drawing', canvasDrawing),
      attempt('installed fonts', installedFonts),
      attempt('canvas noise', canvasChanged),
      attempt('keyboard layout', keyboardLayout),
      attempt('speech voices', speechVoices),
      attempt('content blocker', contentBlocker),
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
      keyboard: keyboard ?? 'unknown',
      voices: voices ?? 'unknown',
      blocker: blocker ?? 'unknown',
    };
    const print = await sha256(fingerprintSource(facts));
    latest = { ...facts, fingerprint: print ? grouped(print.slice(0, 16)) : 'unknown' };
    show(latest);
    markProtected([...detectProtections(environment()), ...(noise ? ['canvas'] : [])]);
    compare();
    // Only now is there a full set of values to remember.
    const rememberButton = find('compare-remember');
    if (rememberButton instanceof HTMLButtonElement) rememberButton.disabled = false;
  };

  /* The comparison: values remembered in this tab, marked where they changed after a reload. */
  const remembered = find('compare-status');
  const forget = find('compare-forget');
  /** Marks no row as changed. */
  const unmark = () => list.querySelectorAll('[data-changed]').forEach((mark) => mark.removeAttribute('data-on'));
  const compare = () => {
    const saved = read(COMPARE_KEY, 'session');
    unmark();
    const before = saved === null ? null : rememberedFacts(saved);
    if (saved !== null && !before) remove(COMPARE_KEY, 'session');
    if (forget instanceof HTMLButtonElement) forget.disabled = before === null;
    if (!before || !remembered) return;
    const changed = compareFacts(before, latest);
    for (const key of changed) list.querySelector(`[data-row="${key}"] [data-changed]`)?.setAttribute('data-on', '');
    remembered.textContent = fillText(changed.length ? remembered.dataset.changed : remembered.dataset.same, { n: String(changed.length) });
  };
  find('compare-remember')?.addEventListener('click', () => {
    if (!remembered) return;
    const kept = write(COMPARE_KEY, JSON.stringify(latest), 'session');
    remembered.textContent = (kept ? remembered.dataset.remembered : remembered.dataset.failed) ?? '';
    if (forget instanceof HTMLButtonElement) forget.disabled = !kept;
    unmark();
  });
  forget?.addEventListener('click', () => {
    remove(COMPARE_KEY, 'session');
    if (remembered) remembered.textContent = remembered.dataset.forgotten ?? '';
    compare();
    // Forget is now disabled, which would drop the keyboard focus: hand it to the button beside it.
    find('compare-remember')?.focus();
  });
  // "Clear my data" in the footer removes the remembered values too.
  document.addEventListener(CLEARED_EVENT, () => {
    if (remembered) remembered.textContent = '';
    compare();
  });

  /* The IP address: one request to this site's host, only when asked. */
  const ipButton = find('ip');
  const ipValue = find('ip-value');
  const ipStatus = find('ip-status');
  /** A lookup is running: further presses wait for it. */
  let asking = false;
  ipButton?.addEventListener('click', async () => {
    // Only on request: the page makes no other connection.
    if (!ipValue || !ipStatus || asking) return;
    ipStatus.textContent = '';
    // aria-disabled rather than disabled, which would drop the keyboard focus.
    asking = true;
    ipButton.setAttribute('aria-disabled', 'true');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), IP_TIMEOUT_MS);
    /** @type {{ ip: string, country: string } | null} */
    let answer = null;
    try {
      const response = await fetch(TRACE_URL, { cache: 'no-store', credentials: 'omit', signal: controller.signal });
      answer = response.ok ? parseTrace(await response.text()) : null;
      if (!answer) throw new Error(`no address in the answer (HTTP ${response.status})`);
    } catch (error) {
      console.warn('[lockwell] Could not get the IP address from the host: the request failed, was blocked or took too long.', error);
      ipStatus.textContent = ipStatus.dataset.failed ?? '';
    } finally {
      clearTimeout(timer);
      asking = false;
      ipButton.removeAttribute('aria-disabled');
    }
    if (!answer) return;
    ipValue.textContent = answer.ip;
    // The country's name in the page's language, where the browser can name it; the address alone otherwise.
    try {
      const country = answer.country ? new Intl.DisplayNames([document.documentElement.lang || 'en'], { type: 'region' }).of(answer.country) : '';
      if (country) ipValue.textContent = `${answer.ip} (${country})`;
    } catch (error) {
      console.warn('[lockwell] This browser cannot name countries; showing the address alone.', error);
    }
  });

  show(instant());
  slow().catch((error) => console.error('[lockwell] Could not finish the browser report.', error));
  // The window size is part of what sites see, and it changes.
  window.addEventListener('resize', () => show({ ...latest, ...instant() }), { passive: true });
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

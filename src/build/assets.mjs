// @ts-check
/**
 * @file Static assets: public files, the concatenated stylesheet, versioned client modules, fonts, the head script, CSP and _headers.
 */
/**
 * Static assets: public files, the stylesheet, client JavaScript, the
 * Content-Security-Policy and the inline head script it allows.
 */
import { createHash } from 'node:crypto';
import { cp, mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { PLATFORM_KEYS } from './guide.mjs';
import { PATHS, href } from './site.mjs';

/** @typedef {import('./site.mjs').Site} Site */
/** @typedef {import('./templates/layout.mjs').Assets} Assets */

/** How long main.mjs gets to start before the page falls back to the no-JS layout. */
export const JS_READY_TIMEOUT_MS = 4000;

/**
 * Runs in <head> before first paint, so nothing jumps once the page shows:
 *  - marks the page as JS-enabled ("js" class) so CSS can lay out JS-only UI up
 *    front, but only in browsers that can run our ES modules;
 *  - failsafe: if main.mjs hasn't added "js-ready" in time (blocked, failed to
 *    load), switches back to "no-js" so every platform's steps stay readable;
 *  - marks browsers with a built-in barcode reader (data-qr), so the link
 *    checker's "read a QR code" field is laid out from the first paint, and
 *    browsers that can share (data-share), for the tools' share buttons;
 *  - applies the saved theme;
 *  - picks the platform tab to show (saved choice: this tab's first, as session-only guides
 *    save it there; else a guess from the user agent;
 *    iPadOS reports a Mac user agent, so a "Mac" with a touch screen counts as iOS).
 * The Content-Security-Policy allows exactly this script by its hash.
 * Storage keys must match src/client/storage.mjs.
 */
export const HEAD_SCRIPT =
  "var d=document.documentElement,p;" +
  "if('noModule'in HTMLScriptElement.prototype){d.className='js';if(typeof BarcodeDetector=='function')d.dataset.qr='1';if(navigator.share)d.dataset.share='1';" +
  `setTimeout(function(){if(!/\\bjs-ready\\b/.test(d.className))d.className='no-js'},${JS_READY_TIMEOUT_MS})}` +
  "try{var t=localStorage.getItem('lockwell:theme');if(t==='light'||t==='dark')d.dataset.theme=t;p=sessionStorage.getItem('lockwell:platform')||localStorage.getItem('lockwell:platform')}catch(e){}" +
  "var u=navigator.userAgent;" +
  `d.dataset.platform=${JSON.stringify(PLATFORM_KEYS)}.indexOf(p)>=0?p:` +
  "/iPhone|iPad|iPod/.test(u)||/Macintosh/.test(u)&&navigator.maxTouchPoints>1?'ios':/Android/.test(u)?'android':'desktop';" +
  // The browser family, for the browser check's advice. Browsers inside apps and other browsers on iPhone use
  // Safari's engine without Safari's protections; Tor Browser says it is Firefox.
  "d.dataset.browser='brave'in navigator?'brave':/CriOS|FxiOS|EdgiOS|OPiOS|FBAN|FBAV|Instagram|Line\\/|Telegram|Viber|DuckDuckGo\\//.test(u)?'other':" +
  "/Firefox\\//.test(u)?'firefox':/Chrome\\/|Edg\\//.test(u)?'chromium':/Version\\/[\\d.]+.*Safari\\//.test(u)?'safari':'other'";

/**
 * Copies public files, writes the stylesheet and client modules, and returns
 * the URLs and policies the templates need.
 * @param {string} outDir
 * @param {Site} site
 * @returns {Promise<Assets>}
 */
export async function writeAssets(outDir, site) {
  await cp(PATHS.public, outDir, { recursive: true, filter: (source) => basename(source) !== '.DS_Store' });
  await mkdir(join(outDir, 'assets', 'js'), { recursive: true });

  const css = await readStyles();
  await writeFile(join(outDir, 'assets', 'site.css'), css);
  const jsVersion = await writeClientModules(join(outDir, 'assets', 'js'));

  /** @type {Record<string, string | null>} */
  const ogImages = {};
  for (const lang of site.languages) {
    const path = `/og-${lang}.png`;
    ogImages[lang] = (await exists(join(PATHS.public, path))) ? path : null;
  }

  return {
    css: `${href(site, '/assets/site.css')}?v=${shortHash(css)}`,
    js: `${href(site, '/assets/js/main.mjs')}?v=${jsVersion}`,
    fonts: fontsIn(css).map((font) => href(site, font)),
    headScript: HEAD_SCRIPT,
    csp: contentSecurityPolicy(),
    cspSelf: contentSecurityPolicy({ connect: "'self'" }),
    ogImages,
  };
}

/** Concatenates src/styles/*.css in file-name order. */
async function readStyles() {
  const files = (await readdir(PATHS.styles)).filter((name) => name.endsWith('.css')).sort();
  const parts = await Promise.all(files.map((name) => readFile(join(PATHS.styles, name), 'utf8')));
  return parts.join('\n');
}

/**
 * Font files referenced by @font-face, so the CSS is the only list of fonts.
 * @param {string} css
 * @returns {string[]}  Site paths, e.g. "/fonts/firago-regular.woff2".
 */
export function fontsIn(css) {
  return [...css.matchAll(/url\("\.\.(\/fonts\/[^"]+\.woff2)"\)/g)].map((match) => match[1]);
}

/**
 * Copies client modules and adds the same ?v=<hash> to every relative import,
 * so a browser never combines a new main.mjs with an old cached module.
 * @param {string} dir
 * @returns {Promise<string>}  The version hash.
 */
async function writeClientModules(dir) {
  const files = (await readdir(PATHS.client)).filter((name) => name.endsWith('.mjs')).sort();
  const sources = await Promise.all(files.map((name) => readFile(join(PATHS.client, name), 'utf8')));
  const version = shortHash(sources.join('\n'));
  await Promise.all(files.map((name, i) => writeFile(join(dir, name), versionImports(sources[i], version))));
  return version;
}

/**
 * @param {string} source
 * @param {string} version
 */
export function versionImports(source, version) {
  return source.replace(/((?:from|import)\s*\(?\s*)(['"])(\.{1,2}\/[^'"?]+\.mjs)\2/g, `$1$2$3?v=${version}$2`);
}

/**
 * @param {{ connect?: string }} [options]  connect: the connect-src sources; only the browser check page
 *   allows 'self', for its opt-in IP lookup (src/build/tools.mjs, `requests`).
 * @returns {string}
 */
export function contentSecurityPolicy({ connect = "'none'" } = {}) {
  const scriptHash = createHash('sha256').update(HEAD_SCRIPT).digest('base64');
  return [
    "default-src 'self'",
    `script-src 'self' 'sha256-${scriptHash}'`,
    "style-src 'self'",
    "img-src 'self'",
    "font-src 'self'",
    `connect-src ${connect}`,
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    // The client never builds HTML from strings; Chromium enforces that.
    "require-trusted-types-for 'script'",
  ].join('; ');
}

/**
 * HTTP headers for hosts that read a `_headers` file (Cloudflare Pages, Netlify).
 * GitHub Pages ignores it; there the <meta> CSP still applies, but it can't
 * block framing (frame-ancestors) or set the other headers.
 * @param {string} csp
 * @param {{ path: string, csp: string }[]} [pages]  Pages with a policy of their own. Each rule comes after the
 *   one for every page and detaches its policy first ("! Header"), as Cloudflare Pages requires.
 */
export function headersFile(csp, pages = []) {
  return [
    '/*',
    `  Content-Security-Policy: ${csp}; frame-ancestors 'none'`,
    '  X-Frame-Options: DENY',
    '  X-Content-Type-Options: nosniff',
    '  Referrer-Policy: no-referrer',
    '  Cross-Origin-Opener-Policy: same-origin',
    '  Permissions-Policy: camera=(), microphone=(), geolocation=(), browsing-topics=()',
    // One year, this host only: add includeSubDomains and preload only once every subdomain serves HTTPS.
    '  Strict-Transport-Security: max-age=31536000',
    '  Cross-Origin-Resource-Policy: same-origin',
    // CSS and JS URLs carry ?v=<content hash>, so they never change in place.
    '/assets/*',
    '  Cache-Control: public, max-age=31536000, immutable',
    // Font URLs have no version, so a replaced font must not stay cached for long.
    '/fonts/*',
    '  Cache-Control: public, max-age=86400',
    ...pages.flatMap((page) => [page.path, '  ! Content-Security-Policy', `  Content-Security-Policy: ${page.csp}; frame-ancestors 'none'`]),
    '',
  ].join('\n');
}

/** @param {string} text */
function shortHash(text) {
  return createHash('sha256').update(text).digest('hex').slice(0, 10);
}

/** @param {string} path */
async function exists(path) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

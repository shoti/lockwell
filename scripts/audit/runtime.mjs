// @ts-check
/**
 * @file Runtime privacy audit: opens every built page in a headless browser with a fresh profile, in light and
 *   dark colour schemes, and records network requests, cookies, storage keys and console errors. Fails on any
 *   request that leaves the site, any cookie, any storage written without the visitor doing anything, any script
 *   error, and on progress shown to a first-time visitor. On the browser check it presses the IP button and
 *   expects exactly one same-origin request to /cdn-cgi/trace.
 *
 *   Browser: Chrome/Chromium (CHROME_PATH, or google-chrome / chromium on PATH; CI uses this) or Lightpanda
 *   (`lightpanda` on PATH). It talks the Chrome DevTools Protocol over Node's built-in WebSocket: no dependencies.
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { extname, join, normalize, relative } from 'node:path';

/** @typedef {import('./lib.mjs').Finding} Finding */

const TYPES = /** @type {Record<string, string>} */ ({
  '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.mjs': 'text/javascript', '.js': 'text/javascript',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.xml': 'application/xml', '.txt': 'text/plain',
});
const PAGE_TIMEOUT_MS = 15_000;

/**
 * Serves dist/ like the host does, and answers /cdn-cgi/trace with a fixed sample (Cloudflare answers it in production).
 * @param {string} dist
 * @returns {Promise<{ origin: string, close: () => Promise<void> }>}
 */
async function serve(dist) {
  const server = createServer(async (request, response) => {
    const path = decodeURIComponent(new URL(request.url ?? '/', 'http://x').pathname);
    if (path === '/cdn-cgi/trace') {
      response.writeHead(200, { 'content-type': 'text/plain' }).end('ip=192.0.2.1\nloc=GE\n');
      return;
    }
    const file = normalize(join(dist, path.endsWith('/') ? `${path}index.html` : path));
    if (relative(dist, file).startsWith('..') || !existsSync(file)) {
      response.writeHead(404, { 'content-type': 'text/html' }).end(await readFile(join(dist, '404.html')));
      return;
    }
    response.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' }).end(await readFile(file));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(undefined)));
  const address = /** @type {import('node:net').AddressInfo} */ (server.address());
  return { origin: `http://127.0.0.1:${address.port}`, close: () => new Promise((resolve) => server.close(() => resolve(undefined))) };
}

/**
 * @param {string} name
 * @returns {string | null}
 */
function onPath(name) {
  for (const dir of (process.env.PATH ?? '').split(':')) if (dir && existsSync(join(dir, name))) return join(dir, name);
  return null;
}

/**
 * Starts a headless browser with a throwaway profile and returns its DevTools WebSocket URL.
 * @returns {Promise<{ name: string, ws: string, stop: () => Promise<void> }>}
 */
async function startBrowser() {
  const chrome = process.env.CHROME_PATH || onPath('google-chrome') || onPath('chromium') || onPath('chromium-browser');
  if (chrome) {
    const profile = await mkdtemp(join(tmpdir(), 'lockwell-audit-'));
    // CI runners (Ubuntu 24.04) block Chrome's sandbox; the browser only opens our own local build there.
    const sandbox = process.env.CI ? ['--no-sandbox'] : [];
    const child = spawn(chrome, [...sandbox, '--headless=new', '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--disable-background-networking', '--disable-component-update', '--disable-sync', '--metrics-recording-only', '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
    const ws = await new Promise((resolve, reject) => {
      let log = '';
      const timer = setTimeout(() => reject(new Error(`Chrome (${chrome}) didn't start within 20 s. Its output:\n${log}`)), 20_000);
      child.stderr.on('data', (chunk) => {
        log += chunk;
        const match = /DevTools listening on (ws:\/\/\S+)/.exec(log);
        if (match) {
          clearTimeout(timer);
          resolve(match[1]);
        }
      });
      child.on('exit', (code) => reject(new Error(`Chrome (${chrome}) exited with ${code}. Its output:\n${log}`)));
    });
    return { name: `Chrome (${chrome})`, ws: /** @type {string} */ (ws), stop: async () => { child.kill(); await rm(profile, { recursive: true, force: true }); } };
  }
  const lightpanda = onPath('lightpanda');
  if (lightpanda) {
    const port = 9300 + Math.floor(Math.random() * 500);
    const child = spawn(lightpanda, ['serve', '--host', '127.0.0.1', '--port', String(port)], { stdio: 'ignore', env: { ...process.env, LIGHTPANDA_DISABLE_TELEMETRY: 'true' } });
    for (let attempt = 0; attempt < 50; attempt += 1) {
      try {
        const version = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
        return { name: `Lightpanda (${lightpanda})`, ws: version.webSocketDebuggerUrl, stop: async () => { child.kill(); } };
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }
    child.kill();
    throw new Error(`Lightpanda (${lightpanda}) didn't answer on port ${port}.`);
  }
  throw new Error('No headless browser found for the runtime audit. Install Chrome or Chromium (or set CHROME_PATH), or Lightpanda.');
}

/** A minimal Chrome DevTools Protocol client over one WebSocket, with flattened target sessions. */
class Cdp {
  /** @param {WebSocket} socket */
  constructor(socket) {
    this.socket = socket;
    this.nextId = 1;
    /** @type {Map<number, { resolve: (value: any) => void, reject: (error: Error) => void, method: string }>} */
    this.pending = new Map();
    /** @type {Set<(message: any) => void>} */
    this.listeners = new Set();
    socket.addEventListener('message', (event) => {
      const message = JSON.parse(String(event.data));
      if (message.id && this.pending.has(message.id)) {
        const call = /** @type {NonNullable<ReturnType<typeof this.pending.get>>} */ (this.pending.get(message.id));
        this.pending.delete(message.id);
        if (message.error) call.reject(new Error(`${call.method}: ${message.error.message}`));
        else call.resolve(message.result);
      } else {
        for (const listener of this.listeners) listener(message);
      }
    });
  }

  /** @param {string} url */
  static async connect(url) {
    const socket = new WebSocket(url);
    await new Promise((resolve, reject) => {
      socket.addEventListener('open', resolve, { once: true });
      socket.addEventListener('error', () => reject(new Error(`Couldn't connect to the browser at ${url}`)), { once: true });
    });
    return new Cdp(socket);
  }

  /**
   * @param {string} method
   * @param {object} [params]
   * @param {string} [sessionId]
   * @returns {Promise<any>}
   */
  send(method, params = {}, sessionId) {
    const id = this.nextId++;
    this.socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject, method });
      setTimeout(() => {
        if (this.pending.delete(id)) reject(new Error(`${method} timed out`));
      }, PAGE_TIMEOUT_MS);
    });
  }

  close() {
    this.socket.close();
  }
}

/**
 * @typedef {object} Visit
 * @property {string[]} requests  Every URL the page requested.
 * @property {string[]} cookies   Cookies seen in document.cookie, the cookie store or Set-Cookie headers.
 * @property {{ local: string[], session: string[] }} storage
 * @property {string[]} errors    Script errors, failed loads and policy violations reported to the console.
 * @property {number} progressShown  Guide cards showing progress to this (first-time) visitor.
 */

/**
 * Opens one page in a fresh browser context.
 * @param {Cdp} cdp
 * @param {string} url
 * @param {'light' | 'dark'} scheme
 * @param {string} [clickSelector]  An element to click after load, then wait for its requests.
 * @returns {Promise<Visit>}
 */
async function visit(cdp, url, scheme, clickSelector) {
  const { browserContextId } = await cdp.send('Target.createBrowserContext', {});
  const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank', browserContextId });
  const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
  /** @type {Visit} */
  const result = { requests: [], cookies: [], storage: { local: [], session: [] }, errors: [], progressShown: 0 };
  let loaded = () => {};
  const loadedPromise = new Promise((resolve) => { loaded = () => resolve(undefined); });
  /** @param {any} message */
  const listener = (message) => {
    if (message.sessionId !== sessionId) return;
    const params = message.params ?? {};
    switch (message.method) {
      case 'Network.requestWillBeSent': result.requests.push(params.request.url); break;
      case 'Network.responseReceivedExtraInfo':
      case 'Network.responseReceived': {
        const headers = params.headers ?? params.response?.headers ?? {};
        for (const [name, value] of Object.entries(headers)) if (name.toLowerCase() === 'set-cookie') result.cookies.push(`Set-Cookie: ${value}`);
        if (params.response?.status >= 400 && !String(params.response.url).includes('/does-not-exist')) result.errors.push(`HTTP ${params.response.status} for ${params.response.url}`);
        break;
      }
      case 'Network.loadingFailed': if (!params.canceled) result.errors.push(`failed to load (${params.errorText})`); break;
      case 'Runtime.exceptionThrown': result.errors.push(`exception: ${params.exceptionDetails?.exception?.description ?? params.exceptionDetails?.text}`); break;
      case 'Runtime.consoleAPICalled': if (params.type === 'error') result.errors.push(`console.error: ${params.args?.map((/** @type {any} */ a) => a.value ?? a.description).join(' ')}`); break;
      case 'Log.entryAdded': if (params.entry?.level === 'error') result.errors.push(`${params.entry.source}: ${params.entry.text}`); break;
      case 'Page.loadEventFired': loaded(); break;
      default:
    }
  };
  cdp.listeners.add(listener);
  try {
    for (const domain of ['Network', 'Runtime', 'Page', 'Log']) await cdp.send(`${domain}.enable`, {}, sessionId).catch(() => {});
    await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: scheme }] }, sessionId).catch(() => {});
    await cdp.send('Page.navigate', { url }, sessionId);
    await Promise.race([loadedPromise, new Promise((resolve) => setTimeout(resolve, PAGE_TIMEOUT_MS))]);
    await new Promise((resolve) => setTimeout(resolve, 300));
    if (clickSelector) {
      await cdp.send('Runtime.evaluate', { expression: `document.querySelector(${JSON.stringify(clickSelector)})?.click()` }, sessionId);
      await new Promise((resolve) => setTimeout(resolve, 1500));
    }
    const state = await cdp.send('Runtime.evaluate', {
      returnByValue: true,
      expression: `JSON.stringify({
        cookie: document.cookie,
        local: Object.keys(localStorage),
        session: Object.keys(sessionStorage),
        progress: document.querySelectorAll('.card-progress.is-visible, .card-progress.is-complete, .continue.is-visible').length,
      })`,
    }, sessionId);
    const parsed = JSON.parse(state.result.value);
    if (parsed.cookie) result.cookies.push(`document.cookie: ${parsed.cookie}`);
    result.storage = { local: parsed.local, session: parsed.session };
    result.progressShown = parsed.progress;
    const jar = await cdp.send('Network.getCookies', {}, sessionId).catch(() => ({ cookies: [] }));
    for (const cookie of jar.cookies ?? []) result.cookies.push(`cookie store: ${cookie.name}`);
  } finally {
    cdp.listeners.delete(listener);
    await cdp.send('Target.closeTarget', { targetId }).catch(() => {});
    await cdp.send('Target.disposeBrowserContext', { browserContextId }).catch(() => {});
  }
  return result;
}

/**
 * @param {string} dist
 * @returns {Promise<Finding[]>}
 */
export async function auditRuntime(dist) {
  /** @type {Finding[]} */
  const findings = [];
  const pages = (await readdir(dist, { recursive: true })).filter((file) => file.endsWith('index.html')).map((file) => `/${file.replace(/index\.html$/, '')}`).sort();
  pages.push('/does-not-exist/');
  const server = await serve(dist);
  const browser = await startBrowser();
  console.log(`Runtime audit: ${pages.length} pages × light and dark in ${browser.name}`);
  const cdp = await Cdp.connect(browser.ws);
  try {
    for (const page of pages) {
      for (const scheme of /** @type {const} */ (['light', 'dark'])) {
        const isBrowserCheck = page.endsWith('/tools/browser-check/');
        const where = `${page} (${scheme})`;
        /** @param {'error' | 'warning'} level @param {string} message */
        const add = (level, message) => findings.push({ level, check: 'runtime', where, message });
        const result = await visit(cdp, server.origin + page, scheme);
        for (const url of result.requests) if (!url.startsWith(server.origin) && !url.startsWith('data:')) add('error', `request to another site: ${url}`);
        for (const cookie of result.cookies) add('error', `cookie: ${cookie}`);
        const stored = [...result.storage.local.map((key) => `localStorage ${key}`), ...result.storage.session.map((key) => `sessionStorage ${key}`)];
        if (stored.length) add('error', `stored without any action: ${stored.join(', ')}`);
        // The missing page is meant to answer 404; that one console line is expected.
        for (const error of result.errors) if (!(page === '/does-not-exist/' && /\b404\b/.test(error))) add('error', error);
        if (result.progressShown) add('error', `${result.progressShown} progress element(s) shown to a first-time visitor`);
        if (isBrowserCheck && scheme === 'light') {
          const before = await visit(cdp, server.origin + page, scheme);
          const after = await visit(cdp, server.origin + page, scheme, '[data-js="browser-ip"]');
          const traceRequests = after.requests.filter((url) => url === `${server.origin}/cdn-cgi/trace`);
          if (before.requests.some((url) => url.includes('/cdn-cgi/'))) add('error', 'the IP lookup ran before the button was pressed');
          if (traceRequests.length !== 1) add('error', `pressing the IP button made ${traceRequests.length} request(s) to /cdn-cgi/trace; expected exactly 1`);
          for (const url of after.requests) if (!url.startsWith(server.origin)) add('error', `IP button: request to another site: ${url}`);
        }
      }
    }
  } finally {
    cdp.close();
    await browser.stop();
    await server.close();
  }
  return findings;
}

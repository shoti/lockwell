// @ts-check
/**
 * @file External link check (`npm run audit:links`): requests every outside link in the built site and reports
 *   errors, redirects to another site, and timeouts. It depends on hundreds of other sites, so it runs on a
 *   schedule (.github/workflows/links.yml), not on every pull request. Expects a fresh build in dist/.
 *   Many sites refuse automated requests (403, 429): those are warnings for a human to open by hand.
 */
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const DIST = fileURLToPath(new URL('../../dist/', import.meta.url));
const CONCURRENCY = 6;
const TIMEOUT_MS = 20_000;
const RETRIES = 2;
const HEADERS = { 'user-agent': 'Mozilla/5.0 (compatible; Lockwell link check)', accept: 'text/html,application/xhtml+xml,*/*;q=0.8' };

/**
 * @param {string} url
 * @param {'HEAD' | 'GET'} method
 */
async function request(url, method) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(url, { method, redirect: 'follow', signal: controller.signal, headers: HEADERS });
    await response.body?.cancel();
    return { status: response.status, finalUrl: response.url };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * @param {string} url
 * @returns {Promise<{ url: string, status: number | 'timeout' | 'error', finalUrl?: string, detail?: string }>}
 */
async function check(url) {
  let last = /** @type {{ url: string, status: number | 'timeout' | 'error', finalUrl?: string, detail?: string }} */ ({ url, status: 'error' });
  for (let attempt = 0; attempt <= RETRIES; attempt += 1) {
    if (attempt) await new Promise((resolve) => setTimeout(resolve, 1000 * 2 ** attempt));
    try {
      let result = await request(url, 'HEAD');
      // Many servers answer HEAD wrongly; GET is the real test.
      if (result.status >= 400) result = await request(url, 'GET');
      last = { url, status: result.status, finalUrl: result.finalUrl };
      if (result.status < 500 && result.status !== 429) return last;
    } catch (error) {
      last = { url, status: error instanceof Error && error.name === 'AbortError' ? 'timeout' : 'error', detail: error instanceof Error ? error.message : String(error) };
    }
  }
  return last;
}

const pages = (await readdir(DIST, { recursive: true })).filter((file) => file.endsWith('.html'));
/** @type {Map<string, Set<string>>} url → pages */
const links = new Map();
for (const page of pages) {
  const html = await readFile(join(DIST, page), 'utf8');
  for (const [, href] of html.matchAll(/<a\b[^>]*\shref="(https?:\/\/[^"]+)"/g)) {
    const url = href.replace(/&amp;/g, '&');
    if (new URL(url).hostname.endsWith('lockwell.org')) continue;
    if (!links.has(url)) links.set(url, new Set());
    links.get(url)?.add(`/${page.replace(/index\.html$/, '')}`);
  }
}

const urls = [...links.keys()].sort();
console.log(`Checking ${urls.length} external links from ${pages.length} pages…`);
/** @type {Awaited<ReturnType<typeof check>>[]} */
const results = [];
let next = 0;
await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
  while (next < urls.length) {
    const url = urls[next++];
    results.push(await check(url));
  }
}));

let errors = 0;
for (const result of results.sort((a, b) => a.url.localeCompare(b.url))) {
  const where = [...(links.get(result.url) ?? [])].slice(0, 3).join(', ');
  const { status } = result;
  if (typeof status === 'number' && status < 400) {
    const from = new URL(result.url).hostname.replace(/^www\./, '');
    const to = result.finalUrl ? new URL(result.finalUrl).hostname.replace(/^www\./, '') : from;
    if (to !== from) console.log(`  warn  redirect to another site: ${result.url} → ${result.finalUrl} (${where})`);
    continue;
  }
  if (status === 401 || status === 403 || status === 429 || status === 'timeout') {
    console.log(`  warn  ${status}: ${result.url} (${where}) — open it by hand`);
    continue;
  }
  errors += 1;
  console.log(`  ERROR ${status}${result.detail ? ` (${result.detail})` : ''}: ${result.url} (${where})`);
}
console.log(errors ? `\nLink check failed: ${errors} broken link(s).` : '\nLink check passed.');
process.exit(errors ? 1 : 0);

// @ts-check
/**
 * @file Local development server: rebuilds on change and serves dist/ on 127.0.0.1.
 */
/**
 * Local development: builds the site, serves dist/ and rebuilds when
 * content/ or src/ change. Refresh the browser to see changes.
 * Usage: node src/build/dev.mjs
 *   PORT  default 4000
 *   HOST  default 127.0.0.1 (this computer only). Set HOST=0.0.0.0 to open the
 *         preview from a phone on the same network; anyone on it can then see it.
 */
import { spawn } from 'node:child_process';
import { watch } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { serial } from './serial.mjs';
import { PATHS, ROOT } from './site.mjs';

const PORT = Number(process.env.PORT ?? 4000);
const HOST = process.env.HOST ?? '127.0.0.1';
const SITE_URL = `http://localhost:${PORT}/`;

/** @type {Record<string, string>} */
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
  '.xml': 'application/xml; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
};

const BUILD_SCRIPT = fileURLToPath(new URL('./build.mjs', import.meta.url));

/**
 * Runs the build in a fresh Node process. Importing build.mjs here would cache
 * its modules, so edits to the build code or templates would be ignored until
 * a restart. The build prints its own result; on failure dist/ keeps the
 * previous version (see build.mjs).
 * @returns {Promise<void>}
 */
function buildOnce() {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [BUILD_SCRIPT], {
      env: { ...process.env, SITE_URL },
      stdio: 'inherit',
    });
    child.on('error', (error) => {
      console.error(`✗ Could not start the build (${BUILD_SCRIPT}): ${error.message}`);
      resolve();
    });
    child.on('exit', (code) => {
      if (code !== 0) console.error('  The previous version is still being served.');
      resolve();
    });
  });
}

/** One build at a time; changes during a build trigger one more build afterwards. */
const rebuild = serial(buildOnce);

/**
 * Maps a URL path to a file inside dist/, refusing anything outside it.
 * @param {string} urlPath
 * @returns {Promise<string | null>}
 */
async function resolveFile(urlPath) {
  let decoded;
  try {
    decoded = decodeURIComponent(urlPath);
  } catch {
    return null;
  }
  const root = PATHS.dist.endsWith(sep) ? PATHS.dist : PATHS.dist + sep;
  const candidate = normalize(join(PATHS.dist, decoded));
  if (!(candidate + sep).startsWith(root)) return null;
  try {
    const info = await stat(candidate);
    return info.isDirectory() ? join(candidate, 'index.html') : candidate;
  } catch {
    return null;
  }
}

const server = createServer(async (req, res) => {
  const { pathname } = new URL(req.url ?? '/', SITE_URL);
  const file = await resolveFile(pathname);
  try {
    if (!file) throw new Error('not found');
    const body = await readFile(file);
    res.writeHead(200, { 'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(body);
  } catch {
    const notFound = await readFile(join(PATHS.dist, '404.html')).catch(() => Buffer.from('Not found'));
    res.writeHead(404, { 'Content-Type': TYPES['.html'], 'Cache-Control': 'no-store' });
    res.end(notFound);
  }
});

await rebuild();

/** @type {NodeJS.Timeout | undefined} */
let timer;
for (const dir of [PATHS.content, join(ROOT, 'src')]) {
  watch(dir, { recursive: true }, () => {
    clearTimeout(timer);
    timer = setTimeout(rebuild, 100);
  });
}

server.listen(PORT, HOST, () => {
  const where = HOST === '127.0.0.1' ? 'this computer only' : `listening on ${HOST}, visible to your network`;
  console.log(`→ ${SITE_URL}  (${where}; rebuilds on change; Ctrl+C to stop)`);
});

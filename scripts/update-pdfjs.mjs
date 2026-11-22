// @ts-check
/**
 * @file Copies the pinned release of Mozilla's PDF.js into src/vendor/pdfjs/ (plan docs/tools-plan/pdf-toolkit.md
 * §5.3): the legacy build (the one that supports Safari), the pure-JavaScript JPEG 2000 and JBIG2 decoders, the
 * character maps wrapped as modules so they load through import() under `connect-src 'none'`, and every licence.
 * Writes VERSION with the release, its date and the SHA-256 of each file; the tests check the files against it.
 *
 * Dev only, run by hand (it needs the network): `node scripts/update-pdfjs.mjs`, or
 * `node scripts/update-pdfjs.mjs path/to/pdfjs-dist.tgz` for a tarball already downloaded (its integrity is still
 * checked against the registry). To update: change PINNED, run, review the diff, run `npm run check`, and set
 * PDFJS_VERSION in src/client/pdf-view.mjs to the same version. Never below 6.2.108 (CVE-2026-16633).
 */
import { createHash } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';

export const PINNED = '6.5.438';
const REGISTRY = `https://registry.npmjs.org/pdfjs-dist`;
const OUT = fileURLToPath(new URL('../src/vendor/pdfjs/', import.meta.url));

/** Files taken from the package, by their path in it, and where they go. */
const FILES = {
  'package/legacy/build/pdf.min.mjs': 'pdf.min.mjs',
  'package/legacy/build/pdf.worker.min.mjs': 'pdf.worker.min.mjs',
  'package/wasm/openjpeg_nowasm_fallback.js': 'openjpeg_nowasm_fallback.js',
  'package/wasm/jbig2_nowasm_fallback.js': 'jbig2_nowasm_fallback.js',
  'package/LICENSE': 'LICENSE',
  'package/wasm/LICENSE_OPENJPEG': 'LICENSE_OPENJPEG',
  'package/wasm/LICENSE_PDFJS_OPENJPEG': 'LICENSE_PDFJS_OPENJPEG',
  'package/wasm/LICENSE_JBIG2': 'LICENSE_JBIG2',
  'package/wasm/LICENSE_PDFJS_JBIG2': 'LICENSE_PDFJS_JBIG2',
  'package/cmaps/LICENSE': 'cmaps/LICENSE',
};

/**
 * The files of a tar archive (POSIX ustar, as npm writes it), by name.
 * @param {Uint8Array} tar
 */
export function untar(tar) {
  /** @type {Map<string, Uint8Array>} */
  const files = new Map();
  const text = (/** @type {number} */ at, /** @type {number} */ length) => new TextDecoder().decode(tar.subarray(at, at + length)).replace(/\0.*$/s, '');
  for (let at = 0; at + 512 <= tar.length; ) {
    const name = text(at, 100);
    if (!name) break;
    const prefix = text(at + 345, 155);
    const size = parseInt(text(at + 124, 12).trim() || '0', 8);
    const type = String.fromCharCode(tar[at + 156]);
    if (type === '0' || type === '\0') files.set(prefix ? `${prefix}/${name}` : name, tar.subarray(at + 512, at + 512 + size));
    at += 512 + Math.ceil(size / 512) * 512;
  }
  return files;
}

/** A character map wrapped as a module: `export const base64 = "…"`. @param {Uint8Array} bytes */
export const cmapModule = (bytes) => `export const base64 = "${Buffer.from(bytes).toString('base64')}";\n`;

/** @param {Uint8Array | string} data */
const sha256 = (data) => createHash('sha256').update(data).digest('hex');

async function main() {
  const meta = await (await fetch(REGISTRY)).json();
  const release = meta.versions?.[PINNED];
  if (!release) throw new Error(`pdfjs-dist ${PINNED} is not in the registry`);
  const local = process.argv[2];
  const tgz = new Uint8Array(local ? await readFile(local) : await (await fetch(release.dist.tarball)).arrayBuffer());
  const [algorithm, expected] = String(release.dist.integrity).split('-');
  const actual = createHash(algorithm).update(tgz).digest('base64');
  if (algorithm !== 'sha512' || actual !== expected) throw new Error(`Integrity check failed for pdfjs-dist ${PINNED}: the tarball is not the one the registry lists. Download it again.`);
  const files = untar(gunzipSync(tgz));

  await rm(OUT, { recursive: true, force: true });
  await mkdir(join(OUT, 'cmaps'), { recursive: true });
  /** @type {[string, string][]} */
  const written = [];
  /** @param {string} path @param {Uint8Array | string} data */
  const put = async (path, data) => {
    await mkdir(dirname(join(OUT, path)), { recursive: true });
    await writeFile(join(OUT, path), data);
    written.push([path, sha256(data)]);
  };
  for (const [from, to] of Object.entries(FILES)) {
    const data = files.get(from);
    if (!data) throw new Error(`${from} is missing from pdfjs-dist ${PINNED}: check FILES against the package.`);
    await put(to, data);
  }
  for (const [path, data] of files) {
    const match = /^package\/cmaps\/([\w.-]+)\.bcmap$/.exec(path);
    if (match) await put(`cmaps/${match[1]}.bcmap.mjs`, cmapModule(data));
  }
  const date = String(meta.time?.[PINNED] ?? '').slice(0, 10);
  written.sort(([a], [b]) => (a < b ? -1 : 1));
  await writeFile(join(OUT, 'VERSION'), `pdfjs-dist ${PINNED}\nreleased ${date}\ntarball sha512-${expected}\n${written.map(([path, hash]) => `${hash}  ${path}`).join('\n')}\n`);
  console.log(`PDF.js ${PINNED} (${date}): ${written.length} files written to src/vendor/pdfjs/.`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}

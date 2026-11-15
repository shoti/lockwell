// @ts-check
/**
 * @file Pre-launch audit entry point. `npm run audit` builds the site and runs the static, claims and runtime
 *   checks; pass check names to run only some: `node scripts/audit/run.mjs static claims`.
 *   Errors fail the run (exit 1); warnings are listed for a human to read.
 */
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from '../../src/build/build.mjs';
import { auditClaims } from './claims.mjs';
import { auditRuntime } from './runtime.mjs';
import { auditContent, auditPages } from './static.mjs';

/** @typedef {import('./lib.mjs').Finding} Finding */

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const DIST = join(ROOT, 'dist');
const CONTENT = join(ROOT, 'content');

/** @type {Record<string, () => Promise<Finding[]>>} */
const CHECKS = {
  static: async () => [...(await auditPages(DIST)), ...(await auditContent(CONTENT))],
  claims: () => auditClaims(join(ROOT, 'data', 'claims.json'), CONTENT, new Date()),
  runtime: () => auditRuntime(DIST),
};

const wanted = process.argv.slice(2).filter((arg) => !arg.startsWith('-'));
const names = wanted.length ? wanted : Object.keys(CHECKS);
const unknown = names.filter((name) => !(name in CHECKS));
if (unknown.length) {
  console.error(`Unknown check(s): ${unknown.join(', ')}. Known: ${Object.keys(CHECKS).join(', ')}.`);
  process.exit(2);
}
const showWarnings = !process.argv.includes('--quiet');

await build({ outDir: DIST });

let errors = 0;
for (const name of names) {
  const findings = await CHECKS[name]();
  const errorList = findings.filter((finding) => finding.level === 'error');
  const warningList = findings.filter((finding) => finding.level === 'warning');
  errors += errorList.length;
  console.log(`\n== ${name}: ${errorList.length} error(s), ${warningList.length} warning(s)`);
  for (const finding of errorList) console.log(`  ERROR [${finding.check}] ${finding.where}: ${finding.message}`);
  if (showWarnings) for (const finding of warningList) console.log(`  warn  [${finding.check}] ${finding.where}: ${finding.message}`);
}
console.log(errors ? `\nAudit failed: ${errors} error(s).` : '\nAudit passed.');
process.exit(errors ? 1 : 0);

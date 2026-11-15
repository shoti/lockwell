// @ts-check
/**
 * @file The claims registry (data/claims.json): time-sensitive facts on the site, each with its source, the date
 *   it was checked and how long that check stays good. The audit fails when a claim is overdue, unsourced, or no
 *   longer on the page it names (so the registry can't drift away from the content).
 */
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { daysLeft } from './lib.mjs';

/** @typedef {import('./lib.mjs').Finding} Finding */

/**
 * @typedef {object} Claim
 * @property {string} id               Stable, kebab-case.
 * @property {string[]} pages          Content paths without language or extension, e.g. "guides/computer".
 * @property {{ en: string, ka: string }} match  A fragment of the claim's wording as it appears on each page.
 * @property {string} source_url       The primary source (https).
 * @property {string} checked_on       YYYY-MM-DD: when the source was last read and the text compared with it.
 * @property {string} method           How it was checked, e.g. "read vendor help page".
 * @property {number} expires_in_days  How long the check stays good: 30–90 for retention periods, versions,
 *                                     waiting periods, contacts and prices.
 */

/** Days before expiry at which the audit starts warning. */
const WARN_DAYS = 14;

/**
 * @param {string} registryFile
 * @param {string} contentDir
 * @param {Date} now
 * @returns {Promise<Finding[]>}
 */
export async function auditClaims(registryFile, contentDir, now) {
  /** @type {Finding[]} */
  const findings = [];
  /** @param {'error' | 'warning'} level @param {string} where @param {string} message */
  const add = (level, where, message) => findings.push({ level, check: 'claims', where, message });

  /** @type {Claim[]} */
  const claims = JSON.parse(await readFile(registryFile, 'utf8'));
  const ids = new Set();
  for (const claim of claims) {
    const where = `data/claims.json#${claim.id}`;
    if (!/^[a-z0-9][a-z0-9-]*$/.test(claim.id ?? '')) add('error', where, 'id must be kebab-case');
    if (ids.has(claim.id)) add('error', where, 'duplicate id');
    ids.add(claim.id);
    if (!/^https:\/\/\S+$/.test(claim.source_url ?? '')) add('error', where, 'needs an https source_url');
    if (!claim.method) add('error', where, 'needs a method (how the claim was checked)');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(claim.checked_on ?? '') || Number.isNaN(Date.parse(claim.checked_on))) {
      add('error', where, 'checked_on must be a YYYY-MM-DD date');
      continue;
    }
    if (Date.parse(`${claim.checked_on}T00:00:00Z`) > now.getTime()) add('error', where, 'checked_on is in the future');
    if (!(claim.expires_in_days > 0 && claim.expires_in_days <= 365)) add('error', where, 'expires_in_days must be between 1 and 365');
    const left = daysLeft(claim, now);
    if (left < 0) add('error', where, `overdue by ${-left} day(s): re-read ${claim.source_url}, fix the pages if needed, then set checked_on`);
    else if (left <= WARN_DAYS) add('warning', where, `due in ${left} day(s)`);

    for (const page of claim.pages ?? []) {
      for (const lang of /** @type {const} */ (['en', 'ka'])) {
        const file = join(contentDir, lang, `${page}.md`);
        if (!existsSync(file)) {
          add('error', where, `page ${lang}/${page} doesn't exist`);
          continue;
        }
        const fragment = claim.match?.[lang];
        if (!fragment) add('error', where, `no "${lang}" match text`);
        else if (!(await readFile(file, 'utf8')).includes(fragment)) {
          add('error', where, `${lang}/${page} no longer contains "${fragment}": update the registry or the page`);
        }
      }
    }
  }
  return findings;
}

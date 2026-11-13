// @ts-check
/**
 * @file The registered name of a host, by the Public Suffix List: shared by the link checker, the link reader and the cleaner.
 */
import { ICANN, SHARED } from './public-suffix.mjs';

/** @type {Map<string, 'icann' | 'shared'> | null} */
let rules = null;

/** The list's rules, read once from their compact form. */
function suffixRules() {
  if (rules) return rules;
  rules = new Map();
  for (const [section, text] of /** @type {const} */ ([['icann', ICANN], ['shared', SHARED]])) {
    for (const line of text.split('\n')) {
      const at = line.indexOf(':');
      const ending = line.slice(0, at);
      for (const rest of line.slice(at + 1).split(',')) rules.set(rest ? `${rest}.${ending}` : ending, section);
    }
  }
  return rules;
}

/**
 * The registered name of a host (the part someone chose and registered) and
 * the ending it sits under, by the Public Suffix List's algorithm. `shared`:
 * the ending is a company's name under which anyone can make their own
 * (pages.dev, github.io), not a registry's.
 * @param {string} host  Lowercase, as letters (not "xn--").
 * @returns {{ site: string, suffix: string, shared: boolean }}
 */
export function siteOf(host) {
  const list = suffixRules();
  const labels = host.split('.');
  let suffixAt = labels.length - 1; // the default rule "*": the last label
  let shared = false;
  for (let i = 0; i < labels.length; i += 1) {
    const candidate = labels.slice(i).join('.');
    const parent = labels.slice(i + 1).join('.');
    const exception = list.get(`!${candidate}`);
    if (exception) {
      suffixAt = i + 1;
      shared = exception === 'shared';
      break;
    }
    const rule = list.get(candidate) ?? (parent ? list.get(`*.${parent}`) : undefined);
    if (rule) {
      suffixAt = i;
      shared = rule === 'shared';
      break;
    }
  }
  const suffix = labels.slice(suffixAt).join('.');
  return { site: labels.slice(Math.max(0, suffixAt - 1)).join('.'), suffix, shared: shared && suffixAt > 0 };
}

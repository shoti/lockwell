// @ts-check
// SPDX-FileCopyrightText: 2026 Shota Mtvarelishvili <mtvarelishvili@proton.me>
// SPDX-License-Identifier: MIT
/**
 * @file UI string lookup with placeholders and plural forms, plus date formatting.
 * @author Shota Mtvarelishvili <mtvarelishvili@proton.me> (https://shoti.github.io/)
 */

/**
 * @typedef {{ [key: string]: string | Strings }} Strings
 * @typedef {(key: string, vars?: Record<string, string | number>) => string} Translate
 */

/**
 * Creates a lookup for UI strings in content/i18n/<lang>.json.
 * Keys are dotted paths ("guide.progress"). Values may contain {placeholders}.
 * A value can be a plural object ({ "one": "...", "other": "..." }) selected by vars.n.
 * @param {Strings} strings
 * @param {string} lang
 * @returns {Translate}
 */
export function createTranslator(strings, lang) {
  const plurals = new Intl.PluralRules(lang);
  return function t(key, vars = {}) {
    /** @type {string | Strings | undefined} */
    let value = strings;
    for (const part of key.split('.')) {
      value = value && typeof value === 'object' ? value[part] : undefined;
    }
    if (value && typeof value === 'object' && typeof value.other === 'string') {
      const form = value[plurals.select(Number(vars.n))];
      value = typeof form === 'string' ? form : value.other;
    }
    if (typeof value !== 'string') {
      throw new Error(`Missing UI string "${key}" for language "${lang}". Add it to content/i18n/${lang}.json.`);
    }
    return value.replace(/\{(\w+)\}/g, (placeholder, name) => (Object.hasOwn(vars, name) ? String(vars[name]) : placeholder));
  };
}

/**
 * Lists dotted keys present in `a` but missing from `b`, or of a different kind
 * there (text in one language, a plural or group object in the other).
 * @param {Strings} a
 * @param {Strings} b
 * @param {string} [prefix]
 * @returns {string[]}
 */
export function missingKeys(a, b, prefix = '') {
  /** @type {string[]} */
  const missing = [];
  for (const [key, value] of Object.entries(a)) {
    const path = prefix ? `${prefix}.${key}` : key;
    const other = b[key];
    if (other === undefined || (typeof value === 'object') !== (typeof other === 'object')) missing.push(path);
    else if (typeof value === 'object' && typeof other === 'object') missing.push(...missingKeys(value, other, path));
  }
  return missing;
}

/**
 * Formats a YYYY-MM-DD date for display, e.g. "9 ნოემბერი, 2026" / "9 November 2026".
 * @param {string} isoDate
 * @param {string} locale
 */
export function formatDate(isoDate, locale) {
  return new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })
    .format(new Date(`${isoDate}T00:00:00Z`));
}

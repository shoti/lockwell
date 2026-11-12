// @ts-check
// SPDX-FileCopyrightText: 2026 Shota Mtvarelishvili <mtvarelishvili@proton.me>
// SPDX-License-Identifier: MIT
/**
 * @file Safe HTML building: the html tagged template and SafeHtml, escaping every value.
 * @author Shota Mtvarelishvili <mtvarelishvili@proton.me> (https://shoti.github.io/)
 */
/**
 * Safe HTML building. Every interpolated value is escaped unless it is already
 * SafeHtml (produced by `html` or `raw`). This is the project's main XSS guard:
 * templates must never build HTML by string concatenation.
 */

export class SafeHtml {
  /** @param {string} value */
  constructor(value) {
    this.value = value;
  }

  toString() {
    return this.value;
  }
}

/** @type {Record<string, string>} */
const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

/**
 * Escapes text for use in HTML content and quoted attribute values.
 * @param {unknown} value
 * @returns {string}
 */
export function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (ch) => ESCAPES[ch]);
}

/**
 * @typedef {SafeHtml | string | number | boolean | null | undefined | Interpolation[]} Interpolation
 */

/**
 * @param {Interpolation} value
 * @returns {string}
 */
function renderValue(value) {
  if (value === null || value === undefined || value === false) return '';
  if (value instanceof SafeHtml) return value.value;
  if (Array.isArray(value)) return value.map(renderValue).join('');
  return escapeHtml(value);
}

/**
 * Tagged template that escapes interpolations. Arrays are joined, and
 * null/undefined/false render as nothing (handy for conditionals).
 * @param {TemplateStringsArray} strings
 * @param {...Interpolation} values
 * @returns {SafeHtml}
 */
export function html(strings, ...values) {
  let out = strings[0];
  values.forEach((value, i) => {
    out += renderValue(value) + strings[i + 1];
  });
  return new SafeHtml(out);
}

/**
 * Marks a string as trusted HTML. Use only for output of our own renderers.
 * @param {string} value
 * @returns {SafeHtml}
 */
export function raw(value) {
  return new SafeHtml(value);
}

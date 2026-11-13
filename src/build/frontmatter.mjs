// @ts-check
/**
 * @file Parses and validates the minimal front matter block of content files.
 */
import { ContentError } from './errors.mjs';

/**
 * @typedef {object} FrontMatterResult
 * @property {Record<string, string>} data  Raw string values, validated later per content type.
 * @property {Record<string, number>} lines  Line number of each key, for error messages.
 * @property {string} body
 * @property {number} bodyLine  Line number where the body starts (for error messages).
 */

/**
 * Parses a minimal front matter block: `---`, then `key: value` lines, then `---`.
 * Values are plain strings; surrounding quotes are optional. No nesting, no lists.
 * @param {string} source
 * @param {string} file
 * @returns {FrontMatterResult}
 */
export function parseFrontMatter(source, file) {
  let text = source.replace(/^﻿/, '').replace(/\r\n?/g, '\n');
  if (!text.endsWith('\n')) text += '\n';

  if (!text.startsWith('---\n')) {
    throw new ContentError(file, 1, 'Missing front matter. Start the file with a "---" line, then "key: value" lines, then another "---".');
  }
  const end = text.indexOf('\n---\n', 3);
  if (end === -1) {
    throw new ContentError(file, 1, 'Front matter is not closed. Add a "---" line after the last "key: value" line.');
  }

  /** @type {Record<string, string>} */
  const data = {};
  /** @type {Record<string, number>} */
  const lines = {};
  const rawLines = end === 3 ? [] : text.slice(4, end).split('\n');
  rawLines.forEach((line, index) => {
    const lineNo = index + 2;
    if (line.trim() === '' || line.trimStart().startsWith('#')) return;
    const match = /^([a-zA-Z][\w-]*):\s*(.*)$/.exec(line);
    if (!match) {
      throw new ContentError(file, lineNo, `Invalid front matter line "${line}". Use the form "key: value".`);
    }
    const [, key, value] = match;
    if (Object.hasOwn(data, key)) {
      throw new ContentError(file, lineNo, `Duplicate front matter key "${key}". Keep only one.`);
    }
    data[key] = unquote(value.trim());
    lines[key] = lineNo;
  });

  const bodyStart = end + 5;
  return {
    data,
    lines,
    body: text.slice(bodyStart),
    bodyLine: text.slice(0, bodyStart).split('\n').length,
  };
}

/** @param {string} value */
function unquote(value) {
  const quoted = /^"(.*)"$/.exec(value) ?? /^'(.*)'$/.exec(value);
  return quoted ? quoted[1] : value;
}

/**
 * True for real dates only. Date.parse() rolls "2026-02-30" over to March 2
 * instead of failing, so the parsed date must format back to the same text.
 * @param {string} value  YYYY-MM-DD
 */
function isCalendarDate(value) {
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

/**
 * @typedef {'text' | 'text?' | 'int' | 'date' | 'date?' | 'status?' | 'progress?' | 'audience' | 'group' | 'icon'} FieldType
 */

/** The guide tracks, in the order they are listed. */
export const AUDIENCES = /** @type {const} */ (['everyone', 'high-risk']);

/**
 * The topic groups inside each track, in the order they are listed. A group's
 * name is the UI string "guides.groups.<key>"; keys are unique across tracks.
 * @type {Record<typeof AUDIENCES[number], readonly string[]>}
 */
export const GROUPS = {
  everyone: ['start', 'habits', 'devices', 'recovery'],
  'high-risk': ['plan', 'basics', 'situations', 'threats', 'teams'],
};

/**
 * The subject icons a guide can show on its card (the "icon" key). Each is an
 * entry of `icons` in templates/icons.mjs. Give every guide its own (a test
 * checks the real guides; test fixtures may share one).
 */
export const GUIDE_ICONS = /** @type {const} */ ([
  'key', 'phoneLock', 'phoneShield', 'phoneAlert', 'chat', 'chatLock', 'hook', 'at', 'globe', 'pin', 'sparkle', 'laptop',
  'cloud', 'wifi', 'lifebuoy', 'map', 'userLock', 'mail', 'megaphone', 'suitcase', 'bug', 'idCard', 'incognito', 'folderLock', 'users',
]);

/** Allowed values for enum fields. For optional fields the first value is the default. */
const ENUMS = {
  'status?': ['published', 'draft'],
  'progress?': ['local', 'session'],
  audience: AUDIENCES,
  group: Object.values(GROUPS).flat(),
  icon: GUIDE_ICONS,
};

/**
 * Checks front matter against a field spec and converts values.
 * Unknown keys are rejected so typos don't go unnoticed.
 * @param {FrontMatterResult} frontMatter
 * @param {Record<string, FieldType>} spec
 * @param {string} file
 * @returns {Record<string, string | number | undefined>}
 */
export function validateFrontMatter({ data, lines }, spec, file) {
  for (const key of Object.keys(data)) {
    if (!Object.hasOwn(spec, key)) {
      throw new ContentError(file, lines[key] ?? 0, `Unknown front matter key "${key}". Allowed keys: ${Object.keys(spec).join(', ')}.`);
    }
  }

  /** @type {Record<string, string | number | undefined>} */
  const out = {};
  for (const [key, type] of Object.entries(spec)) {
    const value = data[key];
    if (value === undefined || value === '') {
      if (type.endsWith('?')) continue;
      throw new ContentError(file, lines[key] ?? 1, `Missing required front matter key "${key}".`);
    }
    out[key] = convertField(key, value, type, file, lines[key] ?? 0);
  }
  return out;
}

/**
 * @param {string} key
 * @param {string} value
 * @param {FieldType} type
 * @param {string} file
 * @param {number} line
 */
function convertField(key, value, type, file, line) {
  if (type === 'int') {
    if (!/^\d+$/.test(value)) throw new ContentError(file, line, `"${key}" must be a whole number, got "${value}".`);
    return Number(value);
  }
  if (type === 'date' || type === 'date?') {
    const valid = /^\d{4}-\d{2}-\d{2}$/.test(value) && isCalendarDate(value);
    if (!valid) throw new ContentError(file, line, `"${key}" must be a date in YYYY-MM-DD format, got "${value}".`);
    return value;
  }
  if (type === 'status?' || type === 'progress?' || type === 'audience' || type === 'group' || type === 'icon') {
    /** @type {readonly string[]} */
    const allowed = ENUMS[type];
    if (!allowed.includes(value)) throw new ContentError(file, line, `"${key}" must be one of: ${allowed.join(', ')}. Got "${value}".`);
    return value;
  }
  return value;
}

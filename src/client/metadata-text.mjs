// @ts-check
/**
 * @file Turning text found in files (photo and video metadata) into clean, one-line values to show.
 */

/** Control, direction, invisible and tag characters: never shown from a file. */
export const CONTROL = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u00ad\u061c\u180e\u200b-\u200f\u202a-\u202e\u2060-\u2064\u2066-\u2069\ufeff\u{e0000}-\u{e007f}]/gu;

/** @param {string} text  One line: whitespace runs become one space. */
export const oneLine = (text) => text.replace(CONTROL, ' ').replace(/\s+/g, ' ').trim();

/**
 * UTF-8 where the bytes are valid UTF-8, otherwise Latin-1 (older writers).
 * @param {Uint8Array} bytes
 */
export function decodeText(bytes) {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder('latin1').decode(bytes);
  }
}

/** @param {string[]} values  Distinct, non-empty, joined. */
export const joinValues = (values) => [...new Set(values.map(oneLine).filter(Boolean))].join(', ');

/**
 * "Apple" + "iPhone 15" → "Apple iPhone 15"; "Canon" + "Canon EOS R6" → "Canon EOS R6".
 * @param {string | null | undefined} make
 * @param {string | null | undefined} model
 */
export function device(make, model) {
  if (make && model && model.toLowerCase().startsWith(make.toLowerCase())) return model;
  return [make, model].filter(Boolean).join(' ');
}

/**
 * "2026:11:09 14:03:22" or "2026-11-09T14:03:22+04:00" → "2026-11-09 14:03"
 * @param {string | null | undefined} value
 */
export function dateTime(value) {
  if (!value) return '';
  const match = /^(\d{4})[:-](\d{2})[:-](\d{2})(?:[T ](\d{2}):(\d{2}))?/.exec(value.trim());
  if (!match) return oneLine(value);
  const [, year, month, day, hour, minute] = match;
  return `${year}-${month}-${day}${hour ? ` ${hour}:${minute}` : ''}`;
}

// @ts-check
// SPDX-FileCopyrightText: 2026 Shota Mtvarelishvili <mtvarelishvili@proton.me>
// SPDX-License-Identifier: MIT
/**
 * @file ContentError: a content problem reported with its file and line.
 * @author Shota Mtvarelishvili <mtvarelishvili@proton.me> (https://shoti.github.io/)
 */

/** A problem in a content file, reported with its location so authors can fix it. */
export class ContentError extends Error {
  /**
   * @param {string} file  Path relative to the repo root.
   * @param {number} line  1-based line number (0 when not tied to a line).
   * @param {string} message  What is wrong and how to fix it.
   */
  constructor(file, line, message) {
    super(`${line > 0 ? `${file}:${line}` : file} — ${message}`);
    this.name = 'ContentError';
    this.file = file;
    this.line = line;
  }
}

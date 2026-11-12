// @ts-check
// SPDX-FileCopyrightText: 2026 Shota Mtvarelishvili <mtvarelishvili@proton.me>
// SPDX-License-Identifier: MIT
/**
 * @file "Print or save as PDF" buttons on guides and articles.
 * @author Shota Mtvarelishvili <mtvarelishvili@proton.me> (https://shoti.github.io/)
 */

/** "Print or save as PDF" buttons on guides and articles. */
export function initPrint() {
  document.querySelectorAll('[data-js="print"]').forEach((button) => {
    button.addEventListener('click', () => window.print());
  });
}

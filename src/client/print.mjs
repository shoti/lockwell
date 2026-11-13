// @ts-check
/**
 * @file "Print or save as PDF" buttons on guides and articles.
 */

/** "Print or save as PDF" buttons on guides and articles. */
export function initPrint() {
  document.querySelectorAll('[data-js="print"]').forEach((button) => {
    button.addEventListener('click', () => window.print());
  });
}

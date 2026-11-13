// @ts-check
/**
 * @file Filling the page's own sentences with values that come from a file, a link or the browser.
 */

/**
 * "{site} is…" with the values put in. A function replacement, so "$&" or "$'" in a value is shown as written.
 * @param {string | undefined} template
 * @param {Record<string, string>} values
 */
export const fillText = (template, values) => (template ?? '').replace(/\{(\w+)\}/g, (placeholder, name) => values[name] ?? placeholder);

/**
 * Writes a sentence into an element, each value in its own <bdi>: a name written right to left, or one ending in
 * punctuation, can't then reorder the sentence around it.
 * @param {HTMLElement} element
 * @param {string | undefined} template
 * @param {Record<string, string>} values
 */
export function fillInto(element, template, values) {
  const parts = (template ?? '').split(/\{(\w+)\}/);
  element.replaceChildren(
    ...parts.map((part, index) => {
      if (index % 2 === 0) return part;
      const value = values[part];
      if (value === undefined) return `{${part}}`;
      const isolated = document.createElement('bdi');
      isolated.textContent = value;
      return isolated;
    }),
  );
}

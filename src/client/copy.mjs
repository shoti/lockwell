// @ts-check
/**
 * @file Copy-to-clipboard buttons with a manual-copy fallback.
 */

/** How long the "Copied" confirmation stays. */
const CONFIRM_MS = 4000;

/**
 * Copy buttons inside `root`. Each names the element whose text it copies
 * (data-copy-from) and the status line that reports the result (data-status).
 * If the clipboard is unavailable, the status asks the visitor to copy by hand.
 * @param {ParentNode} root
 */
export function initCopy(root) {
  root.querySelectorAll('[data-js="copy"]').forEach((button) => {
    if (!(button instanceof HTMLElement)) return;
    const source = root.querySelector(`[data-js="${button.dataset.copyFrom}"]`);
    const status = root.querySelector(`[data-js="${button.dataset.status}"]`);
    let timer = 0;

    button.addEventListener('click', async () => {
      const text = source?.textContent ?? '';
      if (!text) return;
      let copied = true;
      try {
        await navigator.clipboard.writeText(text);
      } catch (error) {
        console.warn('[lockwell] Could not write to the clipboard; asking the visitor to copy by hand.', error);
        copied = false;
      }
      if (!status) return;
      status.textContent = (copied ? button.dataset.done : button.dataset.failed) ?? '';
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        status.textContent = '';
      }, CONFIRM_MS);
    });
  });
}

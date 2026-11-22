// @ts-check
/**
 * @file Loads the client module of the tool on the current page.
 */
import { initCopy } from './copy.mjs';

/**
 * Tool pages (/tools/<name>/). Each tool's code is loaded only on its own
 * page, so other pages don't download it.
 * @type {Record<string, () => Promise<{ init: (root: HTMLElement) => void }>>}
 */
const LOADERS = {
  password: () => import('./tool-password.mjs'),
  links: () => import('./tool-links.mjs'),
  check: () => import('./tool-check.mjs'),
  redact: () => import('./tool-redact.mjs'),
  editor: () => import('./tool-editor.mjs'),
  document: () => import('./tool-document.mjs'),
  hidden: () => import('./tool-hidden.mjs'),
  photo: () => import('./tool-photo.mjs'),
  video: () => import('./tool-video.mjs'),
  attachment: () => import('./tool-attachment.mjs'),
  email: () => import('./tool-email.mjs'),
  browser: () => import('./tool-browser.mjs'),
};

export function initTools() {
  const root = document.querySelector('[data-js="tool"]');
  if (!(root instanceof HTMLElement)) return;
  const load = LOADERS[root.dataset.tool ?? ''];
  if (!load) return;

  initCopy(root);
  load()
    .then((tool) => tool.init(root))
    .catch((error) => {
      // Show the "needs JavaScript" notice instead of controls that do nothing.
      console.error(`[lockwell] The "${root.dataset.tool}" tool failed to start.`, error);
      root.hidden = true;
      document.querySelector('[data-js="tool-fallback"]')?.classList.add('is-visible');
    });
}

// @ts-check
/**
 * @file Saving a cleaned file: a download link, sharing where the browser can share files, and a neutral file name.
 */
/**
 * The file tools (photo, document, redaction) save through this module.
 *
 * - A download link with the `download` attribute: the usual way.
 * - Sharing (Web Share API) where the browser can share files: on phones it
 *   lets the visitor save to Files or Photos, or send the copy straight to a
 *   chat, which also works in browsers that ignore downloads.
 * - A neutral file name: phone file names carry the date and time
 *   ("IMG_20261109_140322") and document names can identify their author.
 *   The neutral name is the default when the original name contains a date.
 *
 * Built-in browsers of apps (Facebook, Messenger, Telegram, Viber) often
 * ignore both; there is no documented way to tell them apart, so the page
 * always says what to do if saving fails, and says it first where the
 * browser can't share files.
 */

/**
 * A date or time in a file name: year first (2026-11-09, 20261109, 2026_11_09), day first as dates are written in
 * Georgia (13.11.2026, 13-11-2026, 13.11.26; month first matches too), or milliseconds since 1970 as some apps name
 * files (FB_IMG_1731492000123).
 */
export const DATE_IN_NAME = new RegExp(
  [
    String.raw`(?:19|20)\d{2}[-_.]?(?:0[1-9]|1[0-2])[-_.]?(?:0[1-9]|[12]\d|3[01])`,
    String.raw`(?<!\d)(?:0?[1-9]|[12]\d|3[01])([-_.])(?:0?[1-9]|1[0-2]|[12]\d|3[01])\1(?:(?:19|20)\d{2}|\d{2})(?!\d)`,
    String.raw`(?<!\d)1\d{12}(?!\d)`,
  ].join('|'),
);

/** @param {string} name */
export const hasDate = (name) => DATE_IN_NAME.test(name);

/**
 * The name of a saved copy.
 * @param {string} original  The chosen file's name.
 * @param {{ extension: string, fallback: string, suffix: string, neutral: boolean }} options
 *   fallback: the neutral name without extension ("photo"); suffix: added to the original name ("clean"). An empty
 *   suffix keeps the original name exactly as given (the encryption tool passes "report.pdf.lockwell").
 */
export function savedName(original, { extension, fallback, suffix, neutral }) {
  const plain = extension ? `${fallback}.${extension}` : fallback;
  if (neutral) return plain;
  if (!suffix) return original || plain;
  const base = original.replace(/\.[^.]*$/, '') || fallback;
  return `${base}-${suffix}.${extension}`;
}

/**
 * True when the browser can share this file (not only links).
 * @param {File} file
 */
export function canShareFile(file) {
  return typeof navigator.canShare === 'function' && typeof navigator.share === 'function' && navigator.canShare({ files: [file] });
}

/**
 * @typedef {object} Offer
 * @property {Blob} blob
 * @property {string} original  The chosen file's name.
 * @property {string} extension
 * @property {string} fallback  The neutral name, without extension.
 * @property {string} suffix  Added to the original name; empty keeps it exactly.
 * @property {boolean} [neutral]  Start with the neutral name chosen (true) or not (false); by default it is chosen
 *   when the original name holds a date.
 */

/**
 * Wires one save area: data-js "save-neutral" (checkbox), "save-neutral-name",
 * "save-download" (link), "save-share" (button), "save-status" and "save-hint".
 * @param {HTMLElement} box
 */
export function initSave(box) {
  /** @param {string} name */
  const find = (name) => box.querySelector(`[data-js="save-${name}"]`);
  const neutral = /** @type {HTMLInputElement} */ (find('neutral'));
  const neutralName = /** @type {HTMLElement} */ (find('neutral-name'));
  const download = /** @type {HTMLAnchorElement} */ (find('download'));
  const share = /** @type {HTMLButtonElement} */ (find('share'));
  const status = /** @type {HTMLElement} */ (find('status'));
  const hint = /** @type {HTMLElement} */ (find('hint'));
  let url = '';
  /** @type {Offer | null} */
  let current = null;
  /** Called when the visitor changes the name choice (an archive of several copies follows it). @type {(() => void) | null} */
  let renamed = null;

  const name = () => (current ? savedName(current.original, { ...current, neutral: neutral.checked }) : '');
  const rename = () => {
    download.download = name();
  };

  neutral.addEventListener('change', () => {
    rename();
    renamed?.();
  });
  share.addEventListener('click', async () => {
    if (!current) return;
    const file = new File([current.blob], name(), { type: current.blob.type });
    if (!canShareFile(file)) {
      status.textContent = status.dataset.noShare ?? '';
      return;
    }
    status.textContent = '';
    try {
      await navigator.share({ files: [file] });
    } catch (error) {
      // Closing the share sheet rejects too; that needs no message.
      if (error instanceof Error && error.name === 'AbortError') return;
      console.warn('[lockwell] The browser could not share the file.', error);
      status.textContent = status.dataset.failed ?? '';
    }
  });

  return {
    /** @param {Offer} offer */
    offer(offer) {
      if (url) URL.revokeObjectURL(url);
      // The same file offered again (an archive rebuilt) keeps the visitor's choice.
      if (current?.original !== offer.original) neutral.checked = offer.neutral ?? hasDate(offer.original);
      current = offer;
      url = URL.createObjectURL(offer.blob);
      download.href = url;
      neutralName.textContent = savedName('', { ...offer, neutral: true });
      status.textContent = '';
      rename();
      // Where files can't be shared, saving rests on the download alone: say up front what to do if it fails.
      hint.classList.toggle('is-prominent', !canShareFile(new File([offer.blob], name(), { type: offer.blob.type })));
      box.hidden = false;
    },
    clear() {
      if (url) URL.revokeObjectURL(url);
      url = '';
      current = null;
      renamed = null;
      download.removeAttribute('href');
      box.hidden = true;
    },
    /** True when the copy is to be saved under the neutral name. */
    isNeutral() {
      return neutral.checked;
    },
    /** @param {() => void} callback  Called when the visitor changes the name choice. */
    onRename(callback) {
      renamed = callback;
    },
  };
}

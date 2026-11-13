// @ts-check
/**
 * @file Lets a tool take a dropped or pasted file and shows the chosen file's name.
 */

/**
 * Lets a tool take a file dropped anywhere on its panel, and optionally one
 * pasted into the page, as well as from its file chooser. The tool decides
 * whether the file is one it can read.
 *
 * Also shows the name of the file in hand next to the tool's "Choose a file"
 * button, which replaces the browser's own text (see .file in CSS).
 * @param {HTMLElement} root  The tool's panel.
 * @param {(file: File, all: File[]) => void} open  Gets the first file, and every file for tools that take several.
 * @param {{ paste?: boolean }} [options]  paste: also take a pasted file (in practice, a copied image or screenshot).
 */
export function receiveFiles(root, open, { paste = false } = {}) {
  const name = root.querySelector('[data-js="file-name"]');
  /** @param {File[]} files */
  const showName = (files) => {
    if (name instanceof HTMLElement) name.textContent = files.length ? files.map((file) => file.name).join(', ') : (name.dataset.empty ?? '');
  };
  /** @param {File[]} files */
  const take = (files) => {
    showName(files);
    open(files[0], files);
  };
  // The tool opens a chosen file itself; this only keeps the name in step.
  const input = root.querySelector('input[type="file"]');
  if (input instanceof HTMLInputElement) input.addEventListener('change', () => showName([...(input.files ?? [])]));

  root.addEventListener('dragover', (event) => {
    // Without this the browser would leave the page to show the dropped file.
    event.preventDefault();
    root.classList.add('is-dropping');
  });
  root.addEventListener('dragleave', () => root.classList.remove('is-dropping'));
  root.addEventListener('drop', (event) => {
    event.preventDefault();
    root.classList.remove('is-dropping');
    const dropped = [...(event.dataTransfer?.files ?? [])];
    if (dropped.length) take(dropped);
  });
  if (!paste) return;
  document.addEventListener('paste', (event) => {
    const pasted = [...(event.clipboardData?.files ?? [])];
    if (!pasted.length || hasWords(event.clipboardData)) return;
    event.preventDefault();
    take(pasted);
  });
}

/**
 * Whether a paste carries words. Text copied from Word, Excel or Outlook comes with a picture of itself; then the
 * text is what was meant. "Copy image" in a browser adds HTML that is only the picture's tag: not words.
 * @param {DataTransfer | null} data
 */
export function hasWords(data) {
  if (!data?.getData) return false;
  if (data.getData('text/plain').trim()) return true;
  return data.getData('text/html').replace(/<[^>]*>/g, '').replace(/&nbsp;|\s/g, '').length > 0;
}

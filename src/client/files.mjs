// @ts-check
// SPDX-FileCopyrightText: 2026 Shota Mtvarelishvili <mtvarelishvili@proton.me>
// SPDX-License-Identifier: MIT
/**
 * @file Lets a tool take a dropped or pasted file and shows the chosen file's name.
 * @author Shota Mtvarelishvili <mtvarelishvili@proton.me> (https://shoti.github.io/)
 */

/**
 * Lets a tool take a file dropped anywhere on its panel, and optionally one
 * pasted into the page, as well as from its file chooser. The tool decides
 * whether the file is one it can read.
 *
 * Also shows the name of the file in hand next to the tool's "Choose a file"
 * button, which replaces the browser's own text (see .file in CSS).
 * @param {HTMLElement} root  The tool's panel.
 * @param {(file: File) => void} open
 * @param {{ paste?: boolean }} [options]  paste: also take a pasted file (in practice, a copied image or screenshot).
 */
export function receiveFiles(root, open, { paste = false } = {}) {
  const name = root.querySelector('[data-js="file-name"]');
  /** @param {File | undefined} file */
  const showName = (file) => {
    if (name instanceof HTMLElement) name.textContent = file?.name ?? name.dataset.empty ?? '';
  };
  /** @param {File} file */
  const take = (file) => {
    showName(file);
    open(file);
  };
  // The tool opens a chosen file itself; this only keeps the name in step.
  const input = root.querySelector('input[type="file"]');
  if (input instanceof HTMLInputElement) input.addEventListener('change', () => showName(input.files?.[0]));

  root.addEventListener('dragover', (event) => {
    // Without this the browser would leave the page to show the dropped file.
    event.preventDefault();
    root.classList.add('is-dropping');
  });
  root.addEventListener('dragleave', () => root.classList.remove('is-dropping'));
  root.addEventListener('drop', (event) => {
    event.preventDefault();
    root.classList.remove('is-dropping');
    const dropped = event.dataTransfer?.files[0];
    if (dropped) take(dropped);
  });
  if (!paste) return;
  document.addEventListener('paste', (event) => {
    const pasted = event.clipboardData?.files[0];
    if (!pasted) return;
    event.preventDefault();
    take(pasted);
  });
}

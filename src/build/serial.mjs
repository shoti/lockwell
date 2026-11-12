// @ts-check
// SPDX-FileCopyrightText: 2026 Shota Mtvarelishvili <mtvarelishvili@proton.me>
// SPDX-License-Identifier: MIT
/**
 * @file Runs an async task one at a time, so dev-server builds never overlap.
 * @author Shota Mtvarelishvili <mtvarelishvili@proton.me> (https://shoti.github.io/)
 */

/**
 * Wraps an async task so only one run happens at a time. Calls made while it
 * runs are collapsed into exactly one more run afterwards.
 * Used by the dev server so two builds never write the same folder.
 * @param {() => Promise<void>} task
 * @returns {() => Promise<void>}  Resolves when the run (including any queued re-run) is done.
 */
export function serial(task) {
  /** @type {Promise<void> | null} */
  let running = null;
  let pending = false;

  const loop = async () => {
    do {
      pending = false;
      await task();
    } while (pending);
  };

  return () => {
    if (running) {
      pending = true;
      return running;
    }
    running = loop().finally(() => {
      running = null;
    });
    return running;
  };
}

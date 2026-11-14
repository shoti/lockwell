// @ts-check
/**
 * @file Reading parts of a chosen file, so large files (videos of several gigabytes) are never read whole.
 */

/**
 * Reads `length` bytes from `offset`, or fewer at the end of the file.
 * @param {Blob} blob  Usually the File the visitor chose.
 * @param {number} offset
 * @param {number} length
 * @returns {Promise<Uint8Array<ArrayBuffer>>}
 */
export async function readRange(blob, offset, length) {
  return new Uint8Array(await blob.slice(offset, offset + length).arrayBuffer());
}

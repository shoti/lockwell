#!/usr/bin/env node
// @ts-check
/**
 * @file Reference decryptor for Lockwell encrypted files (format in docs/ENCRYPTED-FORMAT.md), for Node 22 with no
 * dependencies. It uses the same module as the site, so a locked file can be opened without the site.
 *
 *   node scripts/lockbox-open.mjs <file> [output]
 *
 * The password is read from the terminal without echo, or from the first line of standard input when that is not a
 * terminal; never from an argument, which would land in the shell history. Without an output path, a file is saved
 * under its own (cleaned) name in the current folder and a text is printed. An existing file is never overwritten,
 * and nothing is left behind when opening fails.
 */

import { open as openFile, readFile, stat, unlink } from 'node:fs/promises';
import { resolve } from 'node:path';
import process from 'node:process';
import { HEADER_LENGTH, KIND, LockboxError, cleanName, looksLocked, open, readBytes, unarmour } from '../src/client/lockbox.mjs';

/** @type {Record<string, string>} */
const MESSAGES = {
  notLocked: 'is not a Lockwell file (it starts neither with "LOCKWELL" nor with a locked text block)',
  newerVersion: 'was made with a newer version of the format than this script reads; update the script',
  damaged: 'is damaged, cut off or was changed on the way; nothing was saved',
  wrongPassword: "can't be opened: the password is wrong, or the file was changed on the way. These can't be told apart",
  readFailed: 'could not be read to the end; check that it is not still being copied',
};

/** Reads one line from standard input: hidden typing on a terminal, the first line of a pipe otherwise. */
async function readPassword() {
  const input = process.stdin;
  if (!input.isTTY) {
    let text = '';
    for await (const chunk of input) {
      text += chunk;
      if (text.includes('\n')) break;
    }
    return text.split('\n')[0].replace(/\r$/, '');
  }
  process.stderr.write('Password: ');
  input.setRawMode(true);
  input.setEncoding('utf8');
  let password = '';
  try {
    for await (const chunk of input) {
      for (const char of String(chunk)) {
        if (char === '\u0003') throw new Error('Cancelled with Ctrl+C');
        if (char === '\r' || char === '\n') return password;
        if (char === '\u007f' || char === '\b') password = [...password].slice(0, -1).join('');
        else password += char;
      }
    }
    return password;
  } finally {
    input.setRawMode(false);
    input.pause();
    process.stderr.write('\n');
  }
}

/**
 * The locked file as a reader: binary files are read in pieces; a locked text block is decoded first.
 * @param {string} path
 */
async function source(path) {
  const handle = await openFile(path, 'r');
  const head = new Uint8Array(HEADER_LENGTH);
  await handle.read(head, 0, HEADER_LENGTH, 0);
  if (looksLocked(head)) {
    const { size } = await stat(path);
    /** @type {import('../src/client/lockbox.mjs').Read} */
    const read = async (offset, length) => {
      const buffer = new Uint8Array(length);
      const { bytesRead } = await handle.read(buffer, 0, length, offset);
      return buffer.subarray(0, bytesRead);
    };
    return { read, size, close: () => handle.close() };
  }
  await handle.close();
  const bytes = unarmour(await readFile(path, 'utf8'));
  if (!bytes) throw new LockboxError('notLocked');
  return { read: readBytes(bytes), size: bytes.length, close: async () => {} };
}

async function main() {
  const [input, output] = process.argv.slice(2);
  if (!input) {
    process.stderr.write('Usage: node scripts/lockbox-open.mjs <file> [output]\n');
    return 2;
  }
  const locked = await source(input);
  /** @type {import('node:fs/promises').FileHandle | null} */
  let target = null;
  /** @type {string | null} */
  let targetPath = null;
  /** @type {Uint8Array[]} */
  const printed = [];
  try {
    const password = await readPassword();
    const meta = await open({
      password,
      read: locked.read,
      size: locked.size,
      start: async (found) => {
        if (output === '-' || (!output && found.kind === KIND.text)) return (bytes) => { printed.push(bytes.slice()); };
        const path = resolve(output ?? cleanName(found.name));
        const handle = await openFile(path, 'wx');
        // Only a file this script created is ever removed on failure.
        target = handle;
        targetPath = path;
        return async (bytes) => { await handle.write(bytes); };
      },
    });
    if (printed.length) process.stdout.write(Buffer.concat(printed));
    if (targetPath) process.stderr.write(`Saved ${meta.kind === KIND.files ? 'the files (a ZIP archive)' : 'the file'} as ${targetPath}\n`);
    return 0;
  } catch (error) {
    if (targetPath) await unlink(targetPath).catch(() => {});
    throw error;
  } finally {
    await /** @type {import('node:fs/promises').FileHandle | null} */ (target)?.close();
    await locked.close();
  }
}

try {
  process.exitCode = await main();
} catch (error) {
  const file = process.argv[2];
  if (error instanceof LockboxError && MESSAGES[error.code]) process.stderr.write(`${file} ${MESSAGES[error.code]}.\n`);
  else if (/** @type {NodeJS.ErrnoException} */ (error).code === 'EEXIST') process.stderr.write(`Not overwriting an existing file; pass an output path: ${/** @type {Error} */ (error).message}\n`);
  else process.stderr.write(`Opening ${file} failed: ${/** @type {Error} */ (error).message}\n`);
  process.exitCode = 1;
}

// @ts-check
/**
 * @file Tool "File encryption": locks a text, a file or several files with a password in the browser, and opens what
 * it locked.
 */
/**
 * The format and every cryptographic step live in lockbox.mjs; this module only reads what the visitor gives, runs
 * a job at a time and shows the result. Every word on the page comes from the panel (templates/tool-panels.mjs).
 *
 * Before a locked result is offered, it is opened again with a key derived anew from the password field as it is
 * now, and the recovered content is compared with the input: a field that changed, a browser bug or a wrong offset
 * is caught here instead of by the recipient. The password, the keys and the content live in memory only;
 * JavaScript can't wipe memory, so "Start again" drops the references and the page says nothing more.
 *
 * Large files never sit whole in memory. Where the browser has a save dialog (Chromium on a computer), output goes
 * straight to the file the visitor chose, with no limit of ours; elsewhere it is collected as a Blob, which
 * browsers may keep on disk, up to BLOB_LIMIT.
 */

import { crc32 } from './bytes.mjs';
import { readRange } from './file-read.mjs';
import { RISKY_EXTENSIONS, checkName } from './file-name.mjs';
import { receiveFiles } from './files.mjs';
import { fillText } from './fill.mjs';
import { ARMOUR_BEGIN, KIND, LockboxError, MAX_NAME, armour, cleanName, looksLocked, open, openBytes, openEnds, readBytes, seal, sealBytes, unarmour } from './lockbox.mjs';
import { initSave } from './save.mjs';
import { generatePassphrase, passphraseBits } from './tool-password.mjs';
import { FLAG_UTF8, writeZip } from './zip.mjs';

/** Six words from EFF's long list: about 77 bits. */
export const PASSPHRASE_WORDS = 6;
/** Below this, Lock stays disabled. */
export const MIN_PASSWORD = 8;
/** Below this, a typed password gets a warning. */
const GOOD_LENGTH = 12;
/** Files up to this size are offered through the download link even where a save dialog exists. */
export const MEMORY_LIMIT = 32 * 1024 * 1024;
/**
 * The most this page locks or opens without a save dialog: hat.sh's published limit for Safari and phones.
 * Not measured yet in Firefox, Safari, iOS or Android (no vendor documents a Blob limit; research log §13).
 */
export const BLOB_LIMIT = 1024 * 1024 * 1024;
/** Results up to this size are checked by opening them whole; larger ones at their start and end. */
export const FULL_CHECK_LIMIT = 256 * 1024 * 1024;
/** Several files are put in one ZIP archive in memory first, so together they may be this large. */
export const MAX_BUNDLE = 200 * 1024 * 1024;
/** Blob parts are joined at this size, so the browser can move them out of the page's memory. */
const JOIN_EVERY = 32 * 1024 * 1024;
/** Locked text longer than this gets a note: some chats cut or split long messages (no app publishes its limit). */
export const CHAT_LIMIT = 4000;
/** A locked text read from a file: the armour of a MEMORY_LIMIT file, with room for line breaks. */
const TEXT_FILE_LIMIT = Math.ceil((MEMORY_LIMIT * 4) / 3) + 1024 * 1024;
/** The progress text changes at most this often; the bar moves every batch. */
const PROGRESS_TEXT_MS = 1000;
const LOCKWELL_TYPES = [{ description: 'Lockwell', accept: { 'application/octet-stream': ['.lockwell'] } }];

const encoder = new TextEncoder();

/**
 * @typedef {'tooShort' | 'short' | 'oneClass' | 'run' | 'name' | 'text'} PasswordWarning
 * @typedef {{ suggestedName?: string, types?: { description: string, accept: Record<string, string[]> }[] }} SaveOptions
 * @typedef {(options: SaveOptions) => Promise<FileSystemFileHandle>} SavePicker
 */

/** @param {string} char */
function charClass(char) {
  if (/\p{Ll}/u.test(char)) return 'lower';
  if (/\p{Lu}/u.test(char)) return 'upper';
  if (/\p{Nd}/u.test(char)) return 'digit';
  if (/\p{L}/u.test(char)) return 'letter';
  return 'symbol';
}

/**
 * What is wrong with a typed password, never what is right: a rule can't tell `Tbilisi2026!` from a good password,
 * so there is no "strong". Nothing for an empty field.
 * @param {string} password
 * @param {{ name?: string, text?: string }} [context]  The file's name and the text being locked.
 * @returns {PasswordWarning[]}
 */
export function passwordWarnings(password, { name = '', text = '' } = {}) {
  const chars = [...password];
  if (!chars.length) return [];
  /** @type {PasswordWarning[]} */
  const found = [];
  if (chars.length < MIN_PASSWORD) found.push('tooShort');
  else if (chars.length < GOOD_LENGTH) found.push('short');
  if (new Set(chars.map(charClass)).size === 1) found.push('oneClass');
  const points = chars.map((char) => /** @type {number} */ (char.codePointAt(0)));
  const step = points[1] - points[0];
  if (points.length > 1 && Math.abs(step) <= 1 && points.every((point, i) => i === 0 || point - points[i - 1] === step)) found.push('run');
  const base = name.replace(/\.[^.]*$/, '').toLowerCase();
  if (base.length >= 3 && password.toLowerCase().includes(base)) found.push('name');
  if (text && password === text) found.push('text');
  return found;
}

/**
 * Whether a typed password may be used: long enough, and typed twice alike while it is hidden.
 * @param {{ password: string, repeat: string, shown: boolean }} fields
 */
export const canUse = ({ password, repeat, shown }) => [...password].length >= MIN_PASSWORD && (shown || repeat === password);

/**
 * A file name that fits the format's 1,024 bytes, with its extension kept.
 * @param {string} name
 */
export function fitName(name) {
  if (encoder.encode(name).length <= MAX_NAME) return name;
  const dot = name.lastIndexOf('.');
  const extension = dot > 0 && name.length - dot <= 16 ? name.slice(dot) : '';
  const base = [...name.slice(0, name.length - extension.length)];
  let length = encoder.encode(base.join('')).length + encoder.encode(extension).length;
  while (base.length && length > MAX_NAME) length -= encoder.encode(/** @type {string} */ (base.pop())).length;
  return base.join('') + extension;
}

/** @param {string} type  A file's media type as the browser gives it; kept only when the format can carry it. */
export const mediaType = (type) => (/^[\x20-\x7e]{0,255}$/.test(type) ? type : '');

/**
 * How an unlocked file is offered for saving: its cleaned name, and the extension the neutral name keeps.
 * @param {import('./lockbox.mjs').Meta} meta
 */
export function savedAs(meta) {
  const name = cleanName(meta.name || (meta.kind === KIND.files ? 'files.zip' : ''));
  const dot = name.lastIndexOf('.');
  return { original: name, extension: dot > 0 ? name.slice(dot + 1) : '' };
}

/**
 * Whether an unlocked file's name deserves a warning: a type that runs as a program, or a name built to hide its real
 * ending. A locked file passes mail scanners unchecked, which is why attackers send password-protected files.
 * @param {string} name
 */
export function riskyName(name) {
  const report = checkName(name);
  return { visible: report.visible, risky: RISKY_EXTENSIONS.has(report.extension) || Boolean(report.bait) || report.bidi || report.padded };
}

/**
 * The names several files get inside the ZIP archive: characters some systems refuse replaced, and names that differ
 * only in case (the same file on macOS and Windows) numbered.
 * @param {string[]} names
 */
export function bundleNames(names) {
  const used = new Set();
  return names.map((original) => {
    const first = original.replace(/[\\/:*?"<>|\u0000-\u001f\u007f]/g, '-') || 'file';
    let name = first;
    for (let n = 2; used.has(name.toLowerCase()); n += 1) name = /\.[^.]+$/.test(first) ? first.replace(/(\.[^.]+)$/, `-${n}$1`) : `${first}-${n}`;
    used.add(name.toLowerCase());
    return name;
  });
}

/**
 * Several files as one stored (uncompressed) ZIP archive, built in memory.
 * @param {File[]} files
 */
async function bundle(files) {
  const names = bundleNames(files.map((file) => file.name));
  const entries = await Promise.all(files.map(async (file, i) => {
    const data = new Uint8Array(await file.arrayBuffer());
    return { name: names[i], rawName: encoder.encode(names[i]), flags: FLAG_UTF8, method: 0, crc: crc32(data), size: data.length, data };
  }));
  return writeZip(entries);
}

/**
 * The most this browser can lock or open here: no limit of ours with a save dialog, BLOB_LIMIT without.
 * @param {{ picker: boolean }} env
 */
export const sizeLimit = ({ picker }) => (picker ? Infinity : BLOB_LIMIT);

/**
 * A size in the units people read: bytes, whole kilobytes, megabytes or gigabytes with one decimal.
 * @param {number} bytes
 * @param {string} lang
 * @returns {{ unit: 'b' | 'kb' | 'mb' | 'gb', n: string }}
 */
export function sizeParts(bytes, lang) {
  const format = (/** @type {number} */ value, /** @type {number} */ digits) => new Intl.NumberFormat(lang || 'en', { maximumFractionDigits: digits }).format(value);
  if (bytes < 1024) return { unit: 'b', n: format(bytes, 0) };
  if (bytes < 1024 ** 2) return { unit: 'kb', n: format(Math.round(bytes / 1024), 0) };
  if (bytes < 1024 ** 3) return { unit: 'mb', n: format(bytes / 1024 ** 2, 1) };
  return { unit: 'gb', n: format(bytes / 1024 ** 3, 1) };
}

/** @param {Uint8Array} a @param {Uint8Array} b */
function sameBytes(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) if (a[i] !== b[i]) return false;
  return true;
}

/**
 * Output collected as Blob parts, joined every 32 MB so the browser can keep them outside the page's memory
 * (Chromium moves large blobs to disk).
 */
export function blobSink() {
  let joined = new Blob([]);
  /** @type {Uint8Array<ArrayBuffer>[]} */
  let batch = [];
  let pending = 0;
  return {
    /** @param {Uint8Array<ArrayBuffer>} bytes */
    write(bytes) {
      batch.push(bytes);
      pending += bytes.length;
      if (pending < JOIN_EVERY) return;
      joined = new Blob([joined, ...batch]);
      batch = [];
      pending = 0;
    },
    /** @param {string} [type] */
    finish: (type = '') => new Blob([joined, ...batch], { type }),
  };
}

/**
 * Output written straight to the file the visitor chose in the save dialog. On failure the writes are discarded, so
 * no half-written file stays (the chosen file is left empty).
 * @param {FileSystemFileHandle} handle
 */
async function fileSink(handle) {
  const writable = await handle.createWritable();
  return {
    /** @param {Uint8Array<ArrayBuffer>} bytes */
    write: (bytes) => writable.write(bytes),
    finish: () => writable.close(),
    async abort() {
      try {
        await writable.abort();
      } catch (error) {
        console.warn('[lockwell] Could not discard what was written to the chosen file.', error);
      }
    },
  };
}

/** Chromium's save dialog where the browser has one: found by feature, never by the browser's name. @returns {SavePicker | null} */
function savePicker() {
  const picker = /** @type {{ showSaveFilePicker?: SavePicker }} */ (/** @type {unknown} */ (globalThis)).showSaveFilePicker;
  return typeof picker === 'function' ? (options) => picker.call(globalThis, options) : null;
}

/** @param {unknown} error */
const isAbort = (error) => error instanceof Error && error.name === 'AbortError';

/** A visitor-facing problem that is not about the file: too large for this page. */
class TooLarge extends Error {
  /** @param {number} limit  Bytes. @param {'tooLarge' | 'bundleTooLarge'} [code] */
  constructor(limit, code = 'tooLarge') {
    super(`Over the limit of ${limit} bytes`);
    this.name = 'TooLarge';
    this.limit = limit;
    this.code = code;
  }
}

/** @param {HTMLElement} root */
export function init(root) {
  /** @template {Element} T @param {string} name @param {ParentNode} [within] @returns {T} */
  const find = (name, within = root) => /** @type {T} */ (within.querySelector(`[data-js="encrypt-${name}"]`));
  /** @param {string} name @returns {HTMLInputElement} */
  const input = (name) => find(name);
  /** @param {string} name @returns {HTMLButtonElement} */
  const button = (name) => find(name);
  /** @param {string} name @returns {HTMLElement} */
  const part = (name) => find(name);

  /** The panel's wrapper holds the size units (data-b, data-kb, data-mb, data-gb). */
  const units = /** @type {HTMLElement} */ (root.querySelector('[data-js="encrypt"]'));
  const lang = document.documentElement.lang || 'en';
  const lockBox = part('lock');
  const openBox = part('open');
  const modes = /** @type {HTMLInputElement[]} */ ([...root.querySelectorAll('[data-js="encrypt-mode"]')]);
  const whats = /** @type {HTMLInputElement[]} */ ([...root.querySelectorAll('[data-js="encrypt-what"]')]);
  const kinds = /** @type {HTMLInputElement[]} */ ([...root.querySelectorAll('[data-js="encrypt-password-kind"]')]);
  const text = /** @type {HTMLTextAreaElement} */ (find('text'));
  const textSize = part('text-size');
  const fileInput = input('file');
  const fileSize = part('file-size');
  const fileHint = fileSize.textContent;
  const fileList = part('files');
  const fileTemplate = /** @type {HTMLTemplateElement} */ (find('file-template'));
  const passphrase = part('passphrase');
  const bits = part('bits');
  const password = input('password');
  const repeat = input('repeat');
  const show = button('password-show');
  const warnings = /** @type {HTMLElement[]} */ ([...part('warnings').querySelectorAll('[data-warning]')]);
  const lockButton = button('lock-button');
  const locked = part('locked');
  const verified = part('verified');
  const armourBox = part('armour-box');
  const armourText = /** @type {HTMLTextAreaElement} */ (find('armour'));
  const long = part('long');
  const lockSaveBox = part('lock-save');
  const lockSaved = part('lock-saved');
  const lockedFileInput = input('locked-file');
  const lockedText = /** @type {HTMLTextAreaElement} */ (find('locked-text'));
  const openPassword = input('open-password');
  const openShow = button('open-password-show');
  const openButton = button('open-button');
  const example = button('example');
  const opened = part('opened');
  const plainBox = part('plain-box');
  const plain = /** @type {HTMLTextAreaElement} */ (find('plain'));
  const openSaved = part('open-saved');
  const progressBox = part('progress-box');
  const progress = /** @type {HTMLProgressElement} */ (find('progress'));
  const progressText = part('progress-text');
  const cancel = button('cancel');
  const message = part('message');
  const lockSave = initSave(/** @type {HTMLElement} */ (lockSaveBox.querySelector('[data-js="save"]')));
  const openSave = initSave(/** @type {HTMLElement} */ (part('open-save').querySelector('[data-js="save"]')));
  const supported = Boolean(globalThis.crypto?.subtle);

  /** @type {File[]} */
  let lockFiles = [];
  /** @type {File | null} */
  let lockedFile = null;
  /** @type {string[] | null} The word list, loaded with the page's first passphrase. */
  let words = null;
  let busy = false;
  let cancelled = false;
  /** The save dialog couldn't open after the password check (the click had expired): open it first next time. */
  let pickFirst = false;
  /** Each job's number: a job whose number is no longer current (Start again, another mode) shows nothing. */
  let ticket = 0;
  let textShownAt = 0;

  const what = () => (whats.find((radio) => radio.checked)?.value === 'file' ? 'file' : 'text');
  const own = () => kinds.find((radio) => radio.checked)?.value === 'own';
  const shown = () => show.getAttribute('aria-pressed') === 'true';
  const currentPassword = () => (own() ? password.value : passphrase.textContent ?? '');

  /** @param {string} key @param {Record<string, string>} [values] */
  const say = (key, values = {}) => {
    message.textContent = key ? fillText(message.dataset[key], values) : '';
  };
  /** @param {number} bytes */
  const sizeText = (bytes) => {
    const { unit, n } = sizeParts(bytes, lang);
    return fillText(units.dataset[unit], { n });
  };
  /** @param {HTMLElement} box @param {File[]} files */
  const showName = (box, files) => {
    const name = /** @type {HTMLElement | null} */ (box.querySelector('[data-js="file-name"]'));
    if (name) name.textContent = files.length ? files.map((file) => file.name).join(', ') : (name.dataset.empty ?? '');
  };
  const showFiles = () => {
    fileList.replaceChildren(
      ...lockFiles.map((file) => {
        const item = /** @type {HTMLElement} */ (/** @type {HTMLElement} */ (fileTemplate.content.firstElementChild).cloneNode(true));
        /** @type {HTMLElement} */ (item.querySelector('[data-js="encrypt-file-name"]')).textContent = file.name;
        /** @type {HTMLElement} */ (item.querySelector('[data-js="encrypt-file-bytes"]')).textContent = sizeText(file.size);
        return item;
      }),
    );
    fileList.hidden = lockFiles.length < 2;
  };

  /** @param {number} done @param {number} total */
  const showProgress = (done, total) => {
    progress.value = total ? done / total : 0;
    const now = Date.now();
    if (done < total && now - textShownAt < PROGRESS_TEXT_MS) return;
    textShownAt = now;
    progressText.textContent = fillText(progressText.dataset.template, { done: sizeText(done), total: sizeText(total) });
  };
  const startProgress = () => {
    progress.value = 0;
    progressText.textContent = '';
    textShownAt = 0;
    cancel.disabled = false;
    progressBox.hidden = false;
  };

  const update = () => {
    const typed = password.value;
    const found = own() ? passwordWarnings(typed, { name: lockFiles[0]?.name ?? '', text: what() === 'text' ? text.value : '' }) : [];
    const mismatch = own() && !shown() && repeat.value !== '' && repeat.value !== typed;
    for (const row of warnings) row.hidden = row.dataset.warning === 'mismatch' ? !mismatch : !found.includes(/** @type {PasswordWarning} */ (row.dataset.warning));
    repeat.disabled = shown();
    const content = what() === 'text' ? text.value.length > 0 : lockFiles.length > 0;
    const usable = own() ? canUse({ password: typed, repeat: repeat.value, shown: shown() }) : Boolean(passphrase.textContent);
    lockButton.disabled = !supported || busy || !content || !usable;
    openButton.disabled = !supported || busy || !(lockedFile || lockedText.value.trim()) || !openPassword.value;
    example.disabled = !supported || busy;
    textSize.textContent = text.value ? sizeText(encoder.encode(text.value).length) : '';
    fileSize.textContent = lockFiles.length ? sizeText(lockFiles.reduce((sum, file) => sum + file.size, 0)) : fileHint;
  };

  const newPassphrase = async () => {
    words ??= (await import('./wordlist-en.mjs')).WORDS.split(' ');
    const options = { separator: '-', capital: false, digit: false };
    passphrase.textContent = generatePassphrase(words, PASSPHRASE_WORDS, options);
    bits.textContent = fillText(bits.dataset.template, { bits: String(passphraseBits(words.length, PASSPHRASE_WORDS, options)) });
    update();
  };
  const another = () => {
    newPassphrase().catch((error) => console.error('[lockwell] Could not make a passphrase: the word list did not load.', error));
  };

  const hideLocked = () => {
    locked.hidden = true;
    lockSave.clear();
    lockSaved.hidden = true;
  };
  const clearLock = () => {
    text.value = '';
    lockFiles = [];
    fileInput.value = '';
    showName(lockBox, []);
    showFiles();
    password.value = '';
    repeat.value = '';
    hideLocked();
    armourText.value = '';
    armourText.textContent = '';
  };
  const clearOpen = () => {
    lockedText.value = '';
    lockedFile = null;
    lockedFileInput.value = '';
    showName(openBox, []);
    openPassword.value = '';
    opened.hidden = true;
    plain.value = '';
    plain.textContent = '';
    openSave.clear();
    openSaved.hidden = true;
    pickFirst = false;
  };
  /** Ends whatever job is running: its result, if any, is never shown. */
  const endJob = () => {
    ticket += 1;
    busy = false;
    progressBox.hidden = true;
  };

  /** @param {'lock' | 'open'} next */
  const setMode = (next) => {
    for (const radio of modes) radio.checked = radio.value === next;
    if (next === 'open') clearLock();
    else clearOpen();
    lockBox.hidden = next !== 'lock';
    openBox.hidden = next !== 'open';
    endJob();
    say('');
    update();
  };

  /** @param {HTMLButtonElement} toggle @param {HTMLInputElement} field */
  const wireShow = (toggle, field) => {
    toggle.addEventListener('click', () => {
      const showing = toggle.getAttribute('aria-pressed') !== 'true';
      toggle.setAttribute('aria-pressed', String(showing));
      field.type = showing ? 'text' : 'password';
      const label = toggle.querySelector('span');
      if (label) label.textContent = (showing ? toggle.dataset.hide : toggle.dataset.show) ?? '';
      update();
    });
  };

  /** @param {unknown} error @param {'lock' | 'open'} job */
  const fail = (error, job) => {
    if (error instanceof TooLarge) {
      say(error.code, { limit: sizeText(error.limit) });
      return;
    }
    if (error instanceof LockboxError) {
      say(error.code);
      if (error.code === 'wrongPassword') openPassword.focus();
      return;
    }
    console.error(`[lockwell] ${job === 'lock' ? 'Locking' : 'Opening'} failed while reading or writing the file.`, error);
    say('readFailed');
  };

  /* ---------- Locking ---------- */

  /**
   * Opens a locked result again, with the password field as it is now, and compares what comes out with the input:
   * whole up to FULL_CHECK_LIMIT, at the two ends above it. Null when it doesn't match.
   * @param {Blob} result
   * @param {Blob} source
   * @param {() => boolean} stop
   * @returns {Promise<'full' | 'ends' | null>}
   */
  const checkLocked = async (result, source, stop) => {
    const again = currentPassword();
    /** @type {import('./lockbox.mjs').Read} */
    const read = (offset, length) => readRange(result, offset, length);
    try {
      if (source.size <= FULL_CHECK_LIMIT) {
        let at = 0;
        let same = true;
        const meta = await open({
          password: again,
          read,
          size: result.size,
          onProgress: showProgress,
          isCancelled: stop,
          start: () => async (bytes) => {
            if (same) same = sameBytes(bytes, await readRange(source, at, bytes.length));
            at += bytes.length;
          },
        });
        return same && at === source.size && meta.size === source.size ? 'full' : null;
      }
      const { meta, first, last } = await openEnds({ password: again, read, size: result.size });
      const ends = sameBytes(first, await readRange(source, 0, first.length)) && sameBytes(last.bytes, await readRange(source, last.offset, last.bytes.length));
      return meta.size === source.size && ends ? 'ends' : null;
    } catch (error) {
      if (error instanceof LockboxError && error.code === 'cancelled') throw error;
      return null;
    }
  };

  /** A text: small, so locked and checked in memory, and shown as locked text too. */
  const lockText = async (/** @type {number} */ job) => {
    const content = encoder.encode(text.value);
    const sealed = await sealBytes({ password: currentPassword(), meta: { kind: KIND.text, name: '', type: '' }, content });
    if (job !== ticket) return;
    say('checking');
    // Derived again from the field as it is now, not from the key in hand.
    const back = await openBytes({ password: currentPassword(), bytes: sealed }).catch(() => null);
    if (job !== ticket) return;
    if (!back || !sameBytes(back.content, content)) {
      say('verifyFailed');
      return;
    }
    const block = armour(sealed);
    armourText.value = block;
    armourText.textContent = block;
    long.hidden = block.length <= CHAT_LIMIT;
    long.textContent = fillText(long.dataset.template, { n: new Intl.NumberFormat(lang).format(block.length) });
    armourBox.hidden = false;
    verified.textContent = verified.dataset.full ?? '';
    lockSaveBox.hidden = false;
    lockSave.offer({ blob: new Blob([sealed], { type: 'application/octet-stream' }), original: '', extension: 'lockwell', fallback: 'locked', suffix: '', neutral: true });
    locked.hidden = false;
    say('locked');
  };

  const lock = async () => {
    const job = (ticket += 1);
    const chosen = what() === 'file' ? [...lockFiles] : [];
    const several = chosen.length > 1;
    const total = chosen.reduce((sum, file) => sum + file.size, 0);
    if (several && total > MAX_BUNDLE) {
      say('bundleTooLarge', { limit: sizeText(MAX_BUNDLE) });
      return;
    }
    // The save dialog needs the click itself, so it opens before anything else is awaited.
    const picker = chosen.length && total > MEMORY_LIMIT ? savePicker() : null;
    busy = true;
    cancelled = false;
    hideLocked();
    update();
    /** @type {FileSystemFileHandle | null} */
    let handle = null;
    if (picker) {
      try {
        handle = await picker({ suggestedName: 'locked.lockwell', types: LOCKWELL_TYPES });
      } catch (error) {
        if (isAbort(error)) {
          if (job === ticket) {
            busy = false;
            update();
          }
          return;
        }
        console.warn('[lockwell] The save dialog did not open; saving through the download link instead.', error);
      }
    }
    /** @type {Awaited<ReturnType<typeof fileSink>> | null} */
    let file = null;
    const stop = () => cancelled || job !== ticket;
    say('locking');
    try {
      if (!chosen.length) {
        await lockText(job);
        return;
      }
      if (!handle && total > BLOB_LIMIT) throw new TooLarge(BLOB_LIMIT);
      const source = several ? new Blob([await bundle(chosen)], { type: 'application/zip' }) : chosen[0];
      const meta = several ? { kind: KIND.files, name: 'files.zip', type: 'application/zip' } : { kind: KIND.file, name: fitName(chosen[0].name), type: mediaType(chosen[0].type) };
      if (job !== ticket) return;
      startProgress();
      const blob = handle ? null : blobSink();
      file = handle ? await fileSink(handle) : null;
      const write = file?.write ?? /** @type {ReturnType<typeof blobSink>} */ (blob).write;
      await seal({ password: currentPassword(), meta: { ...meta, size: source.size }, read: (offset, length) => readRange(source, offset, length), write, onProgress: showProgress, isCancelled: stop });
      if (file) await file.finish();
      file = null;
      const result = handle ? await handle.getFile() : /** @type {ReturnType<typeof blobSink>} */ (blob).finish('application/octet-stream');
      if (job !== ticket) return;
      say('checking');
      const check = await checkLocked(result, source, stop);
      if (job !== ticket) return;
      if (!check) {
        if (handle) await (await fileSink(handle)).finish().catch((error) => console.warn('[lockwell] Could not empty the chosen file after the check failed.', error));
        say('verifyFailed');
        return;
      }
      verified.textContent = verified.dataset[check] ?? '';
      armourBox.hidden = true;
      lockSaveBox.hidden = Boolean(handle);
      lockSaved.hidden = !handle;
      if (!handle) lockSave.offer({ blob: result, original: `${several ? 'files.zip' : chosen[0].name}.lockwell`, extension: 'lockwell', fallback: 'locked', suffix: '', neutral: true });
      locked.hidden = false;
      say('locked');
    } catch (error) {
      if (file) await file.abort();
      if (job === ticket) fail(error, 'lock');
    } finally {
      if (job === ticket) {
        busy = false;
        progressBox.hidden = true;
        update();
      }
    }
  };

  /* ---------- Opening ---------- */

  /** The locked bytes: a chosen file (binary, or a locked text saved as a file) or the pasted text. */
  const source = async () => {
    if (lockedFile) {
      const chosen = lockedFile;
      if (looksLocked(await readRange(chosen, 0, 8))) {
        return { read: /** @type {import('./lockbox.mjs').Read} */ ((offset, length) => readRange(chosen, offset, length)), size: chosen.size, binary: true };
      }
      if (chosen.size > TEXT_FILE_LIMIT) throw new LockboxError('notLocked');
      const bytes = unarmour(await chosen.text());
      if (!bytes) throw new LockboxError('notLocked');
      return { read: readBytes(bytes), size: bytes.length, binary: false };
    }
    const bytes = unarmour(lockedText.value);
    if (!bytes) throw new LockboxError('notLocked');
    return { read: readBytes(bytes), size: bytes.length, binary: false };
  };

  /** @param {import('./lockbox.mjs').Meta} meta */
  const showInside = (meta) => {
    const kind = part('kind');
    kind.textContent = kind.dataset[meta.kind === KIND.text ? 'text' : meta.kind === KIND.file ? 'file' : 'files'] ?? '';
    const { visible, risky } = riskyName(meta.name || (meta.kind === KIND.files ? 'files.zip' : ''));
    part('name-row').hidden = meta.kind === KIND.text;
    part('name').textContent = visible;
    part('risky').hidden = meta.kind !== KIND.file || !risky;
    part('zip-note').hidden = meta.kind !== KIND.files;
    part('size').textContent = sizeText(meta.size);
  };

  const openLocked = async () => {
    const job = (ticket += 1);
    const chosen = lockedFile;
    const picker = chosen && chosen.size > MEMORY_LIMIT ? savePicker() : null;
    busy = true;
    cancelled = false;
    opened.hidden = true;
    openSave.clear();
    openSaved.hidden = true;
    update();
    /** @type {FileSystemFileHandle | null} */
    let handle = null;
    if (picker && pickFirst && chosen) {
      try {
        handle = await picker({ suggestedName: cleanName(chosen.name.replace(/\.lockwell$/i, '')) });
      } catch (error) {
        if (job === ticket) {
          busy = false;
          update();
          if (!isAbort(error)) say('readFailed');
        }
        if (!isAbort(error)) console.error('[lockwell] The save dialog did not open.', error);
        return;
      }
    }
    /** @type {Awaited<ReturnType<typeof fileSink>> | null} */
    let file = null;
    const stop = () => cancelled || job !== ticket;
    say('opening');
    try {
      const { read, size, binary } = await source();
      const toFile = Boolean(picker && binary);
      if (!toFile && size > BLOB_LIMIT + BLOB_LIMIT / 64) throw new TooLarge(BLOB_LIMIT);
      const typed = openPassword.value;
      if (toFile && !handle) {
        // The password is checked before any dialog opens: a wrong one costs a key derivation and nothing else.
        const { meta } = await openEnds({ password: typed, read, size });
        if (job !== ticket) return;
        try {
          handle = await /** @type {SavePicker} */ (picker)({ suggestedName: savedAs(meta).original });
        } catch (error) {
          if (isAbort(error)) {
            say('');
            return;
          }
          console.warn('[lockwell] The save dialog did not open after the password check; asking for another press.', error);
          pickFirst = true;
          say('pressAgain');
          return;
        }
      }
      startProgress();
      const blob = handle ? null : blobSink();
      file = handle ? await fileSink(handle) : null;
      const write = file?.write ?? /** @type {ReturnType<typeof blobSink>} */ (blob).write;
      const meta = await open({ password: typed, read, size, start: () => write, onProgress: showProgress, isCancelled: stop });
      if (file) await file.finish();
      file = null;
      if (job !== ticket) return;
      pickFirst = false;
      showInside(meta);
      plainBox.hidden = meta.kind !== KIND.text || Boolean(handle);
      openSaved.hidden = !handle;
      if (blob && meta.kind === KIND.text) {
        const value = await blob.finish().text();
        plain.value = value;
        plain.textContent = value;
      } else if (blob) {
        const { original, extension } = savedAs(meta);
        openSave.offer({ blob: blob.finish(meta.type || 'application/octet-stream'), original, extension, fallback: 'unlocked', suffix: '', neutral: false });
      }
      opened.hidden = false;
      say('opened');
    } catch (error) {
      if (file) await file.abort();
      if (job === ticket) fail(error, 'open');
    } finally {
      if (job === ticket) {
        busy = false;
        progressBox.hidden = true;
        update();
      }
    }
  };

  /* ---------- Taking files and text ---------- */

  /** @param {File} file */
  const openThis = (file) => {
    lockedFile = file;
    lockedText.value = '';
    showName(openBox, [file]);
    pickFirst = false;
    say('');
    update();
  };

  /** Files given to Lock: one locked file moves the page to Open. @param {File[]} files */
  const takeForLock = async (files) => {
    if (files.length === 1) {
      const [file] = files;
      let isLocked = file.name.toLowerCase().endsWith('.lockwell');
      try {
        isLocked ||= looksLocked(await readRange(file, 0, 8));
      } catch (error) {
        console.warn('[lockwell] Could not read the start of the chosen file to see whether it is locked.', error);
      }
      if (isLocked) {
        setMode('open');
        openThis(file);
        openPassword.focus();
        return;
      }
    }
    lockFiles = files;
    for (const radio of whats) radio.checked = radio.value === 'file';
    part('text-box').hidden = true;
    part('file-box').hidden = false;
    showName(lockBox, files);
    showFiles();
    hideLocked();
    say('');
    update();
  };
  /** @param {File[]} files */
  const takeLock = (files) => {
    if (files.length) takeForLock(files).catch((error) => console.error('[lockwell] Could not take the chosen files.', error));
  };

  receiveFiles(lockBox, (_, all) => takeLock(all));
  receiveFiles(openBox, (file) => openThis(file));
  fileInput.addEventListener('change', () => takeLock([...(fileInput.files ?? [])]));
  lockedFileInput.addEventListener('change', () => {
    const file = lockedFileInput.files?.[0];
    if (file) openThis(file);
  });

  text.addEventListener('input', () => {
    // A locked text pasted where a text to lock goes: the visitor wants to open it.
    if (text.value.includes(ARMOUR_BEGIN) && unarmour(text.value)) {
      const pasted = text.value;
      setMode('open');
      lockedText.value = pasted;
      update();
      openPassword.focus();
      return;
    }
    hideLocked();
    update();
  });
  lockedText.addEventListener('input', () => {
    if (lockedText.value.trim()) {
      lockedFile = null;
      lockedFileInput.value = '';
      showName(openBox, []);
    }
    update();
  });
  for (const field of [password, repeat, openPassword]) field.addEventListener('input', update);

  for (const radio of modes) {
    radio.addEventListener('change', () => {
      if (radio.checked) setMode(radio.value === 'open' ? 'open' : 'lock');
    });
  }
  for (const radio of whats) {
    radio.addEventListener('change', () => {
      part('text-box').hidden = what() !== 'text';
      part('file-box').hidden = what() !== 'file';
      hideLocked();
      update();
    });
  }
  for (const radio of kinds) {
    radio.addEventListener('change', () => {
      part('made').hidden = own();
      part('own').hidden = !own();
      update();
    });
  }
  wireShow(show, password);
  wireShow(openShow, openPassword);
  button('another').addEventListener('click', another);
  lockButton.addEventListener('click', () => {
    lock().catch((error) => console.error('[lockwell] Locking stopped unexpectedly.', error));
  });
  openButton.addEventListener('click', () => {
    openLocked().catch((error) => console.error('[lockwell] Opening stopped unexpectedly.', error));
  });
  cancel.addEventListener('click', () => {
    cancelled = true;
    cancel.disabled = true;
  });
  button('armour-share').addEventListener('click', async () => {
    try {
      await navigator.share({ text: armourText.value });
    } catch (error) {
      if (!isAbort(error)) console.warn('[lockwell] The browser could not share the locked text.', error);
    }
  });

  example.addEventListener('click', async () => {
    setMode('open');
    const job = ticket;
    try {
      const bytes = await sealBytes({ password: example.dataset.password ?? '', meta: { kind: KIND.text, name: '', type: '' }, content: encoder.encode(example.dataset.text ?? '') });
      if (job !== ticket) return;
      lockedText.value = armour(bytes);
      openPassword.value = example.dataset.password ?? '';
      update();
      openButton.focus();
    } catch (error) {
      console.error('[lockwell] Could not make the example.', error);
    }
  });

  button('reset').addEventListener('click', () => {
    clearLock();
    clearOpen();
    endJob();
    say('');
    another();
  });

  if (!supported) say('unsupported');
  another();
  update();
}

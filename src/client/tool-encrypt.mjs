// @ts-check
/**
 * @file Tool "File encryption": locks a text or a file with a password in the browser, and opens what it locked.
 */
/**
 * The format and every cryptographic step live in lockbox.mjs; this module only reads what the visitor gives, runs
 * a job at a time and shows the result. Every word on the page comes from the panel (templates/tool-panels.mjs).
 *
 * Before a locked result is offered, it is opened again with a key derived anew from the password field as it is
 * now, and the recovered content is compared with the input: a field that changed, a browser bug or a wrong offset
 * is caught here instead of by the recipient. The password, the keys and the content live in memory only;
 * JavaScript can't wipe memory, so "Start again" drops the references and the page says nothing more.
 */

import { readRange } from './file-read.mjs';
import { receiveFiles } from './files.mjs';
import { fillText } from './fill.mjs';
import { ARMOUR_BEGIN, KIND, LockboxError, MAX_NAME, armour, cleanName, looksLocked, open, openBytes, readBytes, sealBytes, unarmour } from './lockbox.mjs';
import { initSave } from './save.mjs';
import { generatePassphrase, passphraseBits } from './tool-password.mjs';

/** Six words from EFF's long list: about 77 bits. */
export const PASSPHRASE_WORDS = 6;
/** Below this, Lock stays disabled. */
export const MIN_PASSWORD = 8;
/** Below this, a typed password gets a warning. */
const GOOD_LENGTH = 12;
/** Files and locked files up to this size are handled in one piece in memory. */
export const MEMORY_LIMIT = 32 * 1024 * 1024;
/** Locked text longer than this gets a note: some chats cut or split long messages (no app publishes its limit). */
export const CHAT_LIMIT = 4000;
/** A locked text read from a file: the armour of a MEMORY_LIMIT file, with room for line breaks. */
const TEXT_FILE_LIMIT = Math.ceil((MEMORY_LIMIT * 4) / 3) + 1024 * 1024;

const encoder = new TextEncoder();

/**
 * @typedef {'tooShort' | 'short' | 'oneClass' | 'run' | 'name' | 'text'} PasswordWarning
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

/** A visitor-facing problem that is not about the file: too large for this page. */
class TooLarge extends Error {
  constructor() {
    super('File is over the in-memory limit');
    this.name = 'TooLarge';
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

  /** The panel's wrapper holds the size units (data-b, data-kb, data-mb, data-gb). */
  const units = /** @type {HTMLElement} */ (root.querySelector('[data-js="encrypt"]'));
  const lang = document.documentElement.lang || 'en';
  const lockBox = /** @type {HTMLElement} */ (find('lock'));
  const openBox = /** @type {HTMLElement} */ (find('open'));
  const modes = /** @type {HTMLInputElement[]} */ ([...root.querySelectorAll('[data-js="encrypt-mode"]')]);
  const whats = /** @type {HTMLInputElement[]} */ ([...root.querySelectorAll('[data-js="encrypt-what"]')]);
  const kinds = /** @type {HTMLInputElement[]} */ ([...root.querySelectorAll('[data-js="encrypt-password-kind"]')]);
  const text = /** @type {HTMLTextAreaElement} */ (find('text'));
  const textSize = /** @type {HTMLElement} */ (find('text-size'));
  const fileInput = input('file');
  const fileSize = /** @type {HTMLElement} */ (find('file-size'));
  const fileHint = fileSize.textContent;
  const passphrase = /** @type {HTMLElement} */ (find('passphrase'));
  const bits = /** @type {HTMLElement} */ (find('bits'));
  const password = input('password');
  const repeat = input('repeat');
  const show = button('password-show');
  const warnings = /** @type {HTMLElement[]} */ ([...find('warnings').querySelectorAll('[data-warning]')]);
  const lockButton = button('lock-button');
  const locked = /** @type {HTMLElement} */ (find('locked'));
  const verified = /** @type {HTMLElement} */ (find('verified'));
  const armourBox = /** @type {HTMLElement} */ (find('armour-box'));
  const armourText = /** @type {HTMLTextAreaElement} */ (find('armour'));
  const long = /** @type {HTMLElement} */ (find('long'));
  const lockedFileInput = input('locked-file');
  const lockedText = /** @type {HTMLTextAreaElement} */ (find('locked-text'));
  const openPassword = input('open-password');
  const openShow = button('open-password-show');
  const openButton = button('open-button');
  const opened = /** @type {HTMLElement} */ (find('opened'));
  const plainBox = /** @type {HTMLElement} */ (find('plain-box'));
  const plain = /** @type {HTMLTextAreaElement} */ (find('plain'));
  const message = /** @type {HTMLElement} */ (find('message'));
  const lockSave = initSave(/** @type {HTMLElement} */ (find('lock-save').querySelector('[data-js="save"]')));
  const openSave = initSave(/** @type {HTMLElement} */ (find('open-save').querySelector('[data-js="save"]')));
  const supported = Boolean(globalThis.crypto?.subtle);

  /** @type {File | null} */
  let lockFile = null;
  /** @type {File | null} */
  let lockedFile = null;
  /** @type {string[] | null} The word list, loaded with the page's first passphrase. */
  let words = null;
  let busy = false;
  /** Each job's number: a job whose number is no longer current (Start again, another mode) shows nothing. */
  let ticket = 0;

  const mode = () => (modes.find((radio) => radio.checked)?.value === 'open' ? 'open' : 'lock');
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
  /** @param {HTMLElement} box @param {File | null} file */
  const showName = (box, file) => {
    const name = /** @type {HTMLElement | null} */ (box.querySelector('[data-js="file-name"]'));
    if (name) name.textContent = file ? file.name : (name.dataset.empty ?? '');
  };

  const update = () => {
    const typed = password.value;
    const found = own() ? passwordWarnings(typed, { name: lockFile?.name ?? '', text: what() === 'text' ? text.value : '' }) : [];
    const mismatch = own() && !shown() && repeat.value !== '' && repeat.value !== typed;
    for (const row of warnings) row.hidden = row.dataset.warning === 'mismatch' ? !mismatch : !found.includes(/** @type {PasswordWarning} */ (row.dataset.warning));
    repeat.disabled = shown();
    const content = what() === 'text' ? text.value.length > 0 : Boolean(lockFile);
    const usable = own() ? canUse({ password: typed, repeat: repeat.value, shown: shown() }) : Boolean(passphrase.textContent);
    lockButton.disabled = !supported || busy || !content || !usable;
    openButton.disabled = !supported || busy || !(lockedFile || lockedText.value.trim()) || !openPassword.value;
    textSize.textContent = text.value ? sizeText(encoder.encode(text.value).length) : '';
    fileSize.textContent = lockFile ? sizeText(lockFile.size) : fileHint;
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

  const clearLock = () => {
    text.value = '';
    lockFile = null;
    fileInput.value = '';
    showName(lockBox, null);
    password.value = '';
    repeat.value = '';
    locked.hidden = true;
    armourText.value = '';
    armourText.textContent = '';
    lockSave.clear();
  };
  const clearOpen = () => {
    lockedText.value = '';
    lockedFile = null;
    lockedFileInput.value = '';
    showName(openBox, null);
    openPassword.value = '';
    opened.hidden = true;
    plain.value = '';
    plain.textContent = '';
    openSave.clear();
  };

  /** @param {'lock' | 'open'} next */
  const setMode = (next) => {
    for (const radio of modes) radio.checked = radio.value === next;
    if (next === 'open') clearLock();
    else clearOpen();
    lockBox.hidden = next !== 'lock';
    openBox.hidden = next !== 'open';
    ticket += 1;
    busy = false;
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
      say('tooLarge', { limit: sizeText(MEMORY_LIMIT) });
      return;
    }
    if (error instanceof LockboxError) {
      say(error.code);
      if (error.code === 'wrongPassword') openPassword.focus();
      return;
    }
    console.error(`[lockwell] ${job === 'lock' ? 'Locking' : 'Opening'} failed while reading the file.`, error);
    say('readFailed');
  };

  /* ---------- Locking ---------- */

  const lock = async () => {
    const job = (ticket += 1);
    busy = true;
    locked.hidden = true;
    lockSave.clear();
    update();
    say('locking');
    const chosen = what() === 'file' ? lockFile : null;
    try {
      /** @type {Uint8Array<ArrayBuffer>} */
      let content;
      /** @type {Omit<import('./lockbox.mjs').Meta, 'size'>} */
      let meta;
      if (chosen) {
        if (chosen.size > MEMORY_LIMIT) throw new TooLarge();
        content = new Uint8Array(await chosen.arrayBuffer());
        meta = { kind: KIND.file, name: fitName(chosen.name), type: mediaType(chosen.type) };
      } else {
        content = encoder.encode(text.value);
        meta = { kind: KIND.text, name: '', type: '' };
      }
      const sealed = await sealBytes({ password: currentPassword(), meta, content });
      if (job !== ticket) return;
      say('checking');
      // Derived again from the field as it is now, not from the key in hand.
      const back = await openBytes({ password: currentPassword(), bytes: sealed }).catch(() => null);
      if (job !== ticket) return;
      if (!back || !sameBytes(back.content, content)) {
        say('verifyFailed');
        return;
      }
      verified.textContent = verified.dataset.full ?? '';
      armourBox.hidden = Boolean(chosen);
      if (!chosen) {
        const block = armour(sealed);
        armourText.value = block;
        armourText.textContent = block;
        long.hidden = block.length <= CHAT_LIMIT;
        long.textContent = fillText(long.dataset.template, { n: new Intl.NumberFormat(lang).format(block.length) });
      }
      lockSave.offer({ blob: new Blob([sealed], { type: 'application/octet-stream' }), original: chosen ? `${chosen.name}.lockwell` : '', extension: 'lockwell', fallback: 'locked', suffix: '', neutral: true });
      locked.hidden = false;
      say('locked');
    } catch (error) {
      if (job === ticket) fail(error, 'lock');
    } finally {
      if (job === ticket) {
        busy = false;
        update();
      }
    }
  };

  /* ---------- Opening ---------- */

  /** The locked bytes: a chosen file (binary, or a locked text saved as a file) or the pasted text. */
  const source = async () => {
    if (lockedFile) {
      const file = lockedFile;
      if (looksLocked(await readRange(file, 0, 8))) {
        if (file.size > MEMORY_LIMIT + MEMORY_LIMIT / 64) throw new TooLarge();
        return { read: /** @type {import('./lockbox.mjs').Read} */ ((offset, length) => readRange(file, offset, length)), size: file.size };
      }
      if (file.size > TEXT_FILE_LIMIT) throw new LockboxError('notLocked');
      const bytes = unarmour(await file.text());
      if (!bytes) throw new LockboxError('notLocked');
      return { read: readBytes(bytes), size: bytes.length };
    }
    const bytes = unarmour(lockedText.value);
    if (!bytes) throw new LockboxError('notLocked');
    return { read: readBytes(bytes), size: bytes.length };
  };

  const openLocked = async () => {
    const job = (ticket += 1);
    busy = true;
    opened.hidden = true;
    openSave.clear();
    update();
    say('opening');
    try {
      const { read, size } = await source();
      if (size > MEMORY_LIMIT + MEMORY_LIMIT / 64) throw new TooLarge();
      /** @type {Uint8Array<ArrayBuffer>[]} */
      const parts = [];
      const meta = await open({ password: openPassword.value, read, size, start: () => (bytes) => { parts.push(bytes.slice()); } });
      if (job !== ticket) return;
      const kind = /** @type {HTMLElement} */ (find('kind'));
      kind.textContent = kind.dataset[meta.kind === KIND.text ? 'text' : meta.kind === KIND.file ? 'file' : 'files'] ?? '';
      const { original, extension } = savedAs(meta);
      /** @type {HTMLElement} */ (find('name-row')).hidden = meta.kind === KIND.text;
      /** @type {HTMLElement} */ (find('name')).textContent = original;
      /** @type {HTMLElement} */ (find('size')).textContent = sizeText(meta.size);
      plainBox.hidden = meta.kind !== KIND.text;
      if (meta.kind === KIND.text) {
        const value = new TextDecoder().decode(await new Blob(parts).arrayBuffer());
        plain.value = value;
        plain.textContent = value;
      } else {
        openSave.offer({ blob: new Blob(parts, { type: meta.type || 'application/octet-stream' }), original, extension, fallback: 'unlocked', suffix: '', neutral: false });
      }
      opened.hidden = false;
      say('opened');
    } catch (error) {
      if (job === ticket) fail(error, 'open');
    } finally {
      if (job === ticket) {
        busy = false;
        update();
      }
    }
  };

  /* ---------- Taking files and text ---------- */

  /** @param {File} file */
  const openThis = (file) => {
    lockedFile = file;
    lockedText.value = '';
    showName(openBox, file);
    say('');
    update();
  };

  /** A file given to Lock: a locked one moves the page to Open. @param {File} file */
  const takeForLock = async (file) => {
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
    lockFile = file;
    for (const radio of whats) radio.checked = radio.value === 'file';
    /** @type {HTMLElement} */ (find('text-box')).hidden = true;
    /** @type {HTMLElement} */ (find('file-box')).hidden = false;
    showName(lockBox, file);
    locked.hidden = true;
    lockSave.clear();
    say('');
    update();
  };
  /** @param {File | undefined} file */
  const takeLock = (file) => {
    if (file) takeForLock(file).catch((error) => console.error('[lockwell] Could not take the chosen file.', error));
  };

  receiveFiles(lockBox, (file) => takeLock(file));
  receiveFiles(openBox, (file) => openThis(file));
  fileInput.addEventListener('change', () => takeLock(fileInput.files?.[0]));
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
    locked.hidden = true;
    lockSave.clear();
    update();
  });
  lockedText.addEventListener('input', () => {
    if (lockedText.value.trim()) {
      lockedFile = null;
      lockedFileInput.value = '';
      showName(openBox, null);
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
      /** @type {HTMLElement} */ (find('text-box')).hidden = what() !== 'text';
      /** @type {HTMLElement} */ (find('file-box')).hidden = what() !== 'file';
      locked.hidden = true;
      lockSave.clear();
      update();
    });
  }
  for (const radio of kinds) {
    radio.addEventListener('change', () => {
      /** @type {HTMLElement} */ (find('made')).hidden = own();
      /** @type {HTMLElement} */ (find('own')).hidden = !own();
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
  button('armour-share').addEventListener('click', async () => {
    try {
      await navigator.share({ text: armourText.value });
    } catch (error) {
      if (!(error instanceof Error && error.name === 'AbortError')) console.warn('[lockwell] The browser could not share the locked text.', error);
    }
  });

  const example = button('example');
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
    ticket += 1;
    busy = false;
    say('');
    another();
  });

  if (!supported) say('unsupported');
  another();
  update();
}

// @ts-check
/**
 * @file Tool "Password generator": passwords, passphrases and PINs from crypto.getRandomValues.
 */

import { fillText } from './fill.mjs';
/**
 * Password and PIN generator. Every character comes from the browser's
 * cryptographic random source (crypto.getRandomValues), never Math.random.
 * Nothing is stored: the password lives only in the page.
 */

const LOWER = 'abcdefghijklmnopqrstuvwxyz';
const UPPER = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const DIGITS = '0123456789';
/** Symbols that almost every site accepts (no quotes, spaces, backslashes or angle brackets). */
const SYMBOLS = '!@#$%^&*()-_=+[]{};:,.?';
/** Characters that are easy to confuse when read or typed by hand. */
const LOOKALIKES = new Set('0Oo1lI|');

/**
 * @typedef {object} PasswordOptions
 * @property {boolean} lower
 * @property {boolean} upper
 * @property {boolean} digits
 * @property {boolean} symbols
 * @property {boolean} avoid  Leave out look-alike characters.
 */

/**
 * The character sets to draw from, one string per selected kind.
 * @param {PasswordOptions} options
 * @returns {string[]}
 */
export function charSets({ lower, upper, digits, symbols, avoid }) {
  return [lower && LOWER, upper && UPPER, digits && DIGITS, symbols && SYMBOLS]
    .filter((set) => typeof set === 'string')
    .map((set) => (avoid ? [...set].filter((char) => !LOOKALIKES.has(char)).join('') : set));
}

/**
 * A uniformly random whole number from 0 to max - 1. Plain "random % max"
 * would favour small numbers; values in the uneven tail are drawn again instead.
 * @param {number} max  1 to 2^32.
 * @param {(buffer: Uint32Array<ArrayBuffer>) => unknown} [fill]  Fills the buffer with random values (replaceable in tests).
 * @returns {number}
 */
export function randomInt(max, fill = (buffer) => crypto.getRandomValues(buffer)) {
  const range = 0x100000000;
  const limit = range - (range % max);
  const buffer = new Uint32Array(1);
  do {
    fill(buffer);
  } while (buffer[0] >= limit);
  return buffer[0] % max;
}

/**
 * A random password with at least one character from every set, so it passes
 * "must contain a digit and a symbol" rules. The guaranteed characters are
 * placed by a uniform shuffle, so their positions give nothing away.
 * @param {string[]} sets
 * @param {number} length
 * @param {(max: number) => number} [random]
 * @returns {string}  "" when no set is selected or the length can't fit one of each.
 */
export function generatePassword(sets, length, random = randomInt) {
  if (sets.length === 0 || length < sets.length) return '';
  const all = sets.join('');
  const chars = sets.map((set) => set[random(set.length)]);
  while (chars.length < length) chars.push(all[random(all.length)]);
  for (let i = chars.length - 1; i > 0; i -= 1) {
    const j = random(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join('');
}

/**
 * How many guesses it takes, as a power of two. Rounded down; requiring one
 * character of each kind lowers it by a fraction of a bit, hence "about".
 * @param {string[]} sets
 * @param {number} length
 */
export function entropyBits(sets, length) {
  const size = sets.join('').length;
  return size > 1 ? Math.floor(length * Math.log2(size)) : 0;
}

/**
 * @param {number} bits
 * @returns {'weak' | 'fair' | 'strong' | 'veryStrong'}
 */
export function strengthOf(bits) {
  if (bits < 45) return 'weak';
  if (bits < 70) return 'fair';
  if (bits < 100) return 'strong';
  return 'veryStrong';
}

/**
 * Roughly how long guessing would take an attacker who has stolen a site's
 * password database and can try a trillion passwords a second (a rack of
 * graphics cards against a weakly protected database). On average the
 * password is found halfway through.
 * @param {number} bits
 * @returns {'instant' | 'minutes' | 'hours' | 'days' | 'months' | 'years' | 'centuries' | 'forever'}
 */
export function guessTime(bits) {
  const seconds = 2 ** (bits - 1) / 1e12;
  const year = 31_557_600;
  if (seconds < 60) return 'instant';
  if (seconds < 3600) return 'minutes';
  if (seconds < 86_400) return 'hours';
  if (seconds < year / 12) return 'days';
  if (seconds < year) return 'months';
  if (seconds < year * 100) return 'years';
  if (seconds < year * 1_000_000) return 'centuries';
  return 'forever';
}

/**
 * @typedef {object} PhraseOptions
 * @property {string} separator
 * @property {boolean} capital  Capitalise one word, picked at random.
 * @property {boolean} digit  Add one random digit to the end of one word, picked at random.
 */

/**
 * A passphrase: words drawn at random from a list. The capital and the digit
 * go on words picked at random too, so their place is part of the secret.
 * @param {string[]} words
 * @param {number} count
 * @param {PhraseOptions} options
 * @param {(max: number) => number} [random]
 */
export function generatePassphrase(words, count, { separator, capital, digit }, random = randomInt) {
  const picked = Array.from({ length: count }, () => words[random(words.length)]);
  if (capital) {
    const at = random(count);
    picked[at] = picked[at].charAt(0).toUpperCase() + picked[at].slice(1);
  }
  if (digit) {
    const at = random(count);
    picked[at] += DIGITS[random(DIGITS.length)];
  }
  return picked.join(separator);
}

/**
 * How many guesses a passphrase takes, as a power of two, rounded down: the
 * words, plus which word got the capital and which word got which digit.
 * @param {number} listSize
 * @param {number} count
 * @param {{ capital: boolean, digit: boolean }} options
 */
export function passphraseBits(listSize, count, { capital, digit }) {
  let bits = count * Math.log2(listSize);
  if (capital) bits += Math.log2(count);
  if (digit) bits += Math.log2(10) + Math.log2(count);
  return Math.floor(bits);
}

/**
 * A PIN's odds: how many codes there are, and the chance of guessing it with
 * `tries` attempts before a lock stops further ones.
 * @param {number} length
 * @param {number} tries
 */
export function pinOdds(length, tries) {
  const codes = 10 ** length;
  return { codes, oneIn: Math.round(codes / tries) };
}

/** Length slider limits and starting value per mode. */
const MODES = {
  password: { min: 8, max: 64, start: 20 },
  pin: { min: 4, max: 12, start: 6 },
};
/** Tries before a lock, in the PIN example. */
const LOCKOUT_TRIES = 10;

/** @param {HTMLElement} root */
export function init(root) {
  /** @template {Element} T @param {string} name @returns {T} */
  const find = (name) => /** @type {T} */ (root.querySelector(`[data-js="${name}"]`));
  /** @param {string} name @returns {HTMLInputElement} */
  const input = (name) => find(name);

  const output = /** @type {HTMLElement} */ (find('password-output'));
  const mask = /** @type {HTMLElement} */ (find('password-mask'));
  const strength = /** @type {HTMLElement} */ (find('password-strength'));
  const strengthBox = /** @type {HTMLElement} */ (find('password-strength-box'));
  const meter = /** @type {HTMLElement} */ (find('password-meter'));
  const time = /** @type {HTMLElement} */ (find('password-time'));
  const pin = /** @type {HTMLElement} */ (find('password-pin'));
  const length = input('password-length');
  const lengthValue = find('password-length-value');
  const words = input('password-words');
  const wordsValue = find('password-words-value');
  const sets = /** @type {HTMLFieldSetElement} */ (find('password-sets'));
  const hide = /** @type {HTMLButtonElement} */ (find('password-hide'));
  /** Shown per mode; the rest are hidden. */
  const parts = {
    password: [find('password-length-box'), sets, find('password-presets')],
    passphrase: [find('password-words-box'), find('password-phrase')],
    pin: [find('password-length-box')],
  };
  const modes = /** @type {HTMLInputElement[]} */ ([...root.querySelectorAll('[data-js="password-mode"]')]);
  const lengths = { password: MODES.password.start, pin: MODES.pin.start };
  /** @type {'password' | 'passphrase' | 'pin'} */
  let mode = 'password';
  /** @type {string[] | null} The word list, loaded the first time it is needed. */
  let list = null;
  const format = new Intl.NumberFormat(document.documentElement.lang || undefined);

  /** @param {number} bits @param {boolean} usable */
  const showStrength = (bits, usable) => {
    const level = strengthOf(bits);
    meter.dataset.level = usable ? level : 'weak';
    meter.style.setProperty('--level', String(usable ? Math.min(bits / 128, 1) : 0));
    strength.textContent = usable ? fillText(strength.dataset.template, { label: strength.dataset[level] ?? '', bits: String(bits) }) : (strength.dataset.empty ?? '');
    time.textContent = usable ? fillText(time.dataset.template, { time: time.dataset[guessTime(bits)] ?? '' }) : '';
  };

  /** @param {string} value */
  const show = (value) => {
    output.textContent = value;
    mask.textContent = '•'.repeat([...value].length);
  };

  const generate = async () => {
    strengthBox.hidden = mode === 'pin';
    pin.hidden = mode !== 'pin';
    if (mode === 'passphrase') {
      if (!list) {
        const loaded = (await import('./wordlist-en.mjs')).WORDS.split(' ');
        list = loaded;
        // The type changed while the list loaded: that change made its own value, which stays.
        if (mode !== 'passphrase') return;
      }
      const count = Number(words.value);
      wordsValue.textContent = String(count);
      const options = {
        separator: /** @type {HTMLInputElement | null} */ (root.querySelector('[data-js="password-separator"]:checked'))?.value ?? '-',
        capital: input('password-capital').checked,
        digit: input('password-digit').checked,
      };
      show(generatePassphrase(list, count, options));
      showStrength(passphraseBits(list.length, count, options), true);
      return;
    }
    const chosen =
      mode === 'pin'
        ? [DIGITS]
        : charSets({
            lower: input('password-lower').checked,
            upper: input('password-upper').checked,
            digits: input('password-digits').checked,
            symbols: input('password-symbols').checked,
            avoid: input('password-avoid').checked,
          });
    const size = Number(length.value);
    lengths[mode] = size;
    lengthValue.textContent = String(size);
    show(generatePassword(chosen, size));
    if (mode === 'pin') {
      const odds = pinOdds(size, LOCKOUT_TRIES);
      pin.textContent = `${fillText(pin.dataset.codes, { codes: format.format(odds.codes) })} ${fillText(pin.dataset.lockout, { tries: String(LOCKOUT_TRIES), odds: format.format(odds.oneIn) })}`;
      return;
    }
    showStrength(entropyBits(chosen, size), chosen.length > 0);
  };
  const run = () => {
    generate().catch((error) => console.error('[lockwell] Could not make a new password.', error));
  };

  modes.forEach((radio) => {
    radio.addEventListener('change', () => {
      if (!radio.checked) return;
      mode = radio.value === 'pin' ? 'pin' : radio.value === 'passphrase' ? 'passphrase' : 'password';
      if (mode !== 'passphrase') {
        length.min = String(MODES[mode].min);
        length.max = String(MODES[mode].max);
        length.value = String(lengths[mode]);
      }
      for (const [name, elements] of Object.entries(parts)) {
        for (const element of /** @type {HTMLElement[]} */ (elements)) element.hidden = name !== mode && !parts[mode].includes(element);
      }
      run();
    });
  });
  hide.addEventListener('click', () => {
    const hidden = hide.getAttribute('aria-pressed') !== 'true';
    hide.setAttribute('aria-pressed', String(hidden));
    output.hidden = hidden;
    mask.hidden = !hidden;
    const label = hide.querySelector('span');
    if (label) label.textContent = (hidden ? hide.dataset.show : hide.dataset.hide) ?? '';
  });
  find('password-preset-symbols').addEventListener('click', () => {
    input('password-symbols').checked = false;
    run();
  });
  find('password-preset-16').addEventListener('click', () => {
    length.value = String(Math.min(Number(length.value), 16));
    run();
  });
  length.addEventListener('input', run);
  words.addEventListener('input', run);
  sets.addEventListener('change', run);
  find('password-phrase').addEventListener('change', run);
  find('password-new').addEventListener('click', run);
  run();
}

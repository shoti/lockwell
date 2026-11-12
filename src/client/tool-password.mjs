// @ts-check
// SPDX-FileCopyrightText: 2026 Shota Mtvarelishvili <mtvarelishvili@proton.me>
// SPDX-License-Identifier: MIT
/**
 * @file Tool "Password generator": passwords, passphrases and PINs from crypto.getRandomValues.
 * @author Shota Mtvarelishvili <mtvarelishvili@proton.me> (https://shoti.github.io/)
 */
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

/** Length slider limits and starting value per mode. */
const MODES = {
  password: { min: 8, max: 64, start: 20 },
  pin: { min: 4, max: 12, start: 6 },
};

/** @param {HTMLElement} root */
export function init(root) {
  /** @template {Element} T @param {string} name @returns {T} */
  const find = (name) => /** @type {T} */ (root.querySelector(`[data-js="${name}"]`));
  /** @param {string} name @returns {HTMLInputElement} */
  const input = (name) => find(name);

  const output = find('password-output');
  const strength = /** @type {HTMLElement} */ (find('password-strength'));
  const meter = /** @type {HTMLElement} */ (find('password-meter'));
  const time = /** @type {HTMLElement} */ (find('password-time'));
  const length = input('password-length');
  const lengthValue = find('password-length-value');
  const sets = /** @type {HTMLFieldSetElement} */ (find('password-sets'));
  const modes = /** @type {HTMLInputElement[]} */ ([...root.querySelectorAll('[data-js="password-mode"]')]);
  const lengths = { password: MODES.password.start, pin: MODES.pin.start };
  /** @type {keyof typeof MODES} */
  let mode = 'password';

  const generate = () => {
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
    output.textContent = generatePassword(chosen, size);

    const bits = entropyBits(chosen, size);
    const level = strengthOf(bits);
    meter.dataset.level = chosen.length ? level : 'weak';
    meter.style.setProperty('--level', String(chosen.length ? Math.min(bits / 128, 1) : 0));
    strength.textContent = chosen.length
      ? (strength.dataset.template ?? '').replace('{label}', strength.dataset[level] ?? '').replace('{bits}', String(bits))
      : (strength.dataset.empty ?? '');
    time.textContent = chosen.length ? (time.dataset.template ?? '').replace('{time}', time.dataset[guessTime(bits)] ?? '') : '';
  };

  modes.forEach((radio) => {
    radio.addEventListener('change', () => {
      if (!radio.checked) return;
      mode = radio.value === 'pin' ? 'pin' : 'password';
      length.min = String(MODES[mode].min);
      length.max = String(MODES[mode].max);
      length.value = String(lengths[mode]);
      // The character choices don't apply to a PIN.
      sets.disabled = mode === 'pin';
      generate();
    });
  });
  length.addEventListener('input', generate);
  sets.addEventListener('change', generate);
  find('password-new').addEventListener('click', generate);
  generate();
}

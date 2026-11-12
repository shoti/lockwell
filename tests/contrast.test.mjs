// @ts-check
// SPDX-FileCopyrightText: 2026 Shota Mtvarelishvili <mtvarelishvili@proton.me>
// SPDX-License-Identifier: MIT
/**
 * @file WCAG 2.2 AA contrast tests for the theme tokens.
 * @author Shota Mtvarelishvili <mtvarelishvili@proton.me> (https://shoti.github.io/)
 */
/** WCAG 2.2 AA contrast for the theme tokens in src/styles/02-tokens.css, in both themes. */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { PATHS } from '../src/build/site.mjs';

/**
 * Reads `--name: #rrggbb;` declarations from the first rule that starts with `selector {`.
 * @param {string} css
 * @param {string} selector
 * @returns {Record<string, string>}
 */
function tokens(css, selector) {
  const start = css.indexOf(`${selector} {`);
  assert.notEqual(start, -1, `token block "${selector}" not found in 02-tokens.css`);
  const block = css.slice(start, css.indexOf('}', start));
  return Object.fromEntries([...block.matchAll(/(--[\w-]+):\s*(#[0-9a-f]{6});/gi)].map((m) => [m[1], m[2]]));
}

/** @param {string} hex */
function luminance(hex) {
  const [r, g, b] = [1, 3, 5]
    .map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** @param {string} a @param {string} b */
function ratio(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** [foreground, background, minimum ratio, what it is] */
const PAIRS = /** @type {const} */ ([
  ['--color-text', '--color-bg', 4.5, 'body text'],
  ['--color-text-muted', '--color-bg', 4.5, 'muted text'],
  ['--color-text-muted', '--color-surface', 4.5, 'muted text on cards'],
  ['--color-text-muted', '--color-surface-2', 4.5, 'muted text on tinted areas'],
  ['--color-link', '--color-bg', 4.5, 'links'],
  ['--color-on-accent', '--color-accent', 4.5, 'buttons'],
  ['--color-essential', '--color-essential-soft', 4.5, 'essential badge'],
  ['--color-recommended', '--color-recommended-soft', 4.5, 'recommended badge'],
  ['--color-advanced', '--color-advanced-soft', 4.5, 'advanced badge'],
  ['--color-warning', '--color-warning-soft', 4.5, 'warning callout'],
  // Non-text contrast (SC 1.4.11): control boundaries and state indicators need 3:1.
  ['--color-control-border', '--color-surface', 3, 'checkbox border on a card'],
  ['--color-control-border', '--color-bg', 3, 'checkbox border on a finished item'],
  ['--color-accent', '--color-surface', 3, 'selected tab indicator'],
  ['--color-focus', '--color-bg', 3, 'focus ring'],
]);

describe('theme contrast (UI-1, UI-2)', async () => {
  const css = await readFile(join(PATHS.styles, '02-tokens.css'), 'utf8');
  const themes = { light: tokens(css, ':root'), dark: tokens(css, ':root[data-theme="dark"]') };

  for (const [name, colors] of Object.entries(themes)) {
    it(`meets AA in the ${name} theme`, () => {
      const failures = PAIRS.flatMap(([fg, bg, min, what]) => {
        assert.ok(colors[fg] && colors[bg], `${name} theme is missing ${fg} or ${bg}`);
        const value = ratio(colors[fg], colors[bg]);
        return value < min ? [`${what}: ${fg} on ${bg} is ${value.toFixed(2)}:1, needs ${min}:1`] : [];
      });
      assert.deepEqual(failures, []);
    });
  }

  it('defines the same dark colors for the media query and the manual toggle', () => {
    const media = tokens(css, ':root:not([data-theme="light"])');
    assert.deepEqual(media, themes.dark);
  });
});

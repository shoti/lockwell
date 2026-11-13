// @ts-check
// SPDX-FileCopyrightText: 2026 Shota Mtvarelishvili <mtvarelishvili@proton.me>
// SPDX-License-Identifier: MIT
/**
 * @file Tests for figure files: the SVG subset, its validation and rendering.
 * @author Shota Mtvarelishvili <mtvarelishvili@proton.me> (https://shoti.github.io/)
 */
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { FIGURE_CLASSES, parseFigure, renderFigure } from '../src/build/figures.mjs';
import { PATHS, ROOT } from '../src/build/site.mjs';

/** @param {string} body @param {string} [head] */
const svg = (body, head = '<title>A title</title>') => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 340 100">${head}${body}</svg>`;
/** @param {string} source */
const parse = (source) => parseFigure(source, 'fig.svg', 'fig');

describe('parseFigure', () => {
  it('reads the size, title, description and drawing', () => {
    const figure = parse(svg('<rect x="0" y="0" width="10" height="10" rx="2" class="box"/><text x="5" y="20" class="t-sm t-bad" text-anchor="middle">Hi &amp; bye</text>', '<title>Name</title><desc>Longer text</desc>'));
    assert.equal(figure.width, 340);
    assert.equal(figure.height, 100);
    assert.equal(figure.title, 'Name');
    assert.equal(figure.desc, 'Longer text');
    assert.equal(figure.body.length, 2);
  });

  it('accepts an XML declaration and comments, and drops the comments', () => {
    const figure = parse(`<?xml version="1.0" encoding="UTF-8"?>\n<!-- note -->${svg('<!-- inside --><circle cx="1" cy="1" r="1" class="fill-good"/>')}`);
    assert.equal(renderFigure(figure, '').includes('note'), false);
    assert.equal(renderFigure(figure, '').includes('inside'), false);
  });

  it('rejects anything that could run code, load something or escape the styles', () => {
    const cases = [
      [svg('<script>alert(1)</script>'), /<script> is not allowed/],
      [svg('<foreignObject></foreignObject>'), /<foreignObject> is not allowed/],
      [svg('<image x="0" y="0"/>'), /<image> is not allowed/],
      [svg('<use x="0" y="0"/>'), /<use> is not allowed/],
      [svg('<style>rect{}</style>'), /<style> is not allowed/],
      [svg('<a><rect/></a>'), /<a> is not allowed/],
      [svg('<rect onclick="alert(1)" class="box"/>'), /Attribute "onclick" is not allowed/],
      [svg('<rect style="fill:red" class="box"/>'), /Attribute "style" is not allowed/],
      [svg('<rect fill="red"/>'), /Attribute "fill" is not allowed/],
      [svg('<rect id="x" class="box"/>'), /Attribute "id" is not allowed/],
      [svg('<path d="M0 0 url(#x)" class="line"/>'), /Invalid d=/],
      [svg('<rect x="1e9" class="box"/>'), /Invalid x=/],
      [svg('<rect class="box red"/>'), /Unknown figure class "red"/],
      [svg('<rect x="1" x="2" class="box"/>'), /Duplicate attribute "x"/],
      ['<svg viewBox="0 0 10 10" width="10"><title>t</title></svg>', /<svg> may only have viewBox and xmlns/],
      ['<!DOCTYPE svg><svg viewBox="0 0 10 10"><title>t</title></svg>', /DOCTYPE/],
    ];
    for (const [source, error] of cases) assert.throws(() => parse(/** @type {string} */ (source)), /** @type {RegExp} */ (error), String(source));
  });

  it('requires a viewBox, a title first and well-formed nesting', () => {
    assert.throws(() => parse('<svg><title>t</title></svg>'), /needs viewBox="0 0 width height"/);
    assert.throws(() => parse(svg('<rect class="box"/>', '')), /first element inside <svg> must be <title>/);
    assert.throws(() => parse(svg('', '<title> </title>')), /<title> is empty/);
    assert.throws(() => parse(svg('<g><rect class="box"/>')), /Closing <\/svg> doesn't match <g>/);
    assert.throws(() => parse(svg('<text x="1" y="1">a</text>') + '<svg viewBox="0 0 1 1"><title>t</title></svg>'), /exactly one <svg>/);
    assert.throws(() => parse(svg('<tspan>a</tspan>')), /<tspan> must be inside <text>/);
    assert.throws(() => parse(svg('<g>loose text</g>')), /<g> can't hold text/);
    assert.throws(() => parse(svg('loose text')), /must be inside <text>/);
    assert.throws(() => parse(svg('<text x="1" y="1">a &nbsp; b</text>')), /Unsupported "&"/);
    assert.throws(() => parse(svg('<rect x="1" y=\'1\' class="box"/>')), /Attributes need double quotes/);
  });

  it('rejects characters the site font does not have', () => {
    assert.throws(() => parse(svg('<text x="1" y="1">Done ✔</text>')), /fig\.svg:1 — The site font has no "✔" \(U\+2714\)/);
    assert.doesNotThrow(() => parse(svg('<text x="1" y="1">ბოლომდე დაშიფრული „ok“ → ✓ 41.7° €</text>')));
  });
});

describe('renderFigure', () => {
  it('writes accessible inline SVG from the validated tree, with ids from the figure name', () => {
    const figure = parse(svg('<text x="1" y="2" class="t-b">A  <tspan class="t-bad">&lt;b&gt;</tspan> c </text>', '<title>The "name"</title><desc>More</desc>'));
    assert.equal(
      renderFigure(figure, 'Caption'),
      '<figure class="figure" id="figure-fig"><svg class="figure__art" viewBox="0 0 340 100" width="340" height="100" role="img" aria-labelledby="figure-fig-title" aria-describedby="figure-fig-desc">' +
        '<title id="figure-fig-title">The &quot;name&quot;</title><desc id="figure-fig-desc">More</desc>' +
        '<text x="1" y="2" class="t-b">A <tspan class="t-bad">&lt;b&gt;</tspan> c</text></svg>' +
        '<figcaption class="figure__caption">Caption</figcaption></figure>',
    );
  });

  it('leaves out aria-describedby when there is no description', () => {
    const out = renderFigure(parse(svg('')), '');
    assert.doesNotMatch(out, /aria-describedby|<desc/);
  });
});

describe('figure styles and content', () => {
  it('every figure class has a rule in the stylesheet', async () => {
    const css = await readFile(join(ROOT, 'src/styles/05-components.css'), 'utf8');
    for (const name of FIGURE_CLASSES) assert.match(css, new RegExp(`\\.figure__art[^{]*\\.${name}(?![\\w-])`), `.${name}`);
  });

  it('every language has the same figure files', async () => {
    const names = async (/** @type {string} */ lang) => (await readdir(join(PATHS.content, lang, 'figures'))).sort();
    assert.deepEqual(await names('en'), await names('ka'));
  });
});

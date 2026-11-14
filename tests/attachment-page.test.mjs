// @ts-check
/**
 * @file Tests for the attachment checker page: its wiring, driven with the small fake DOM.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { FakeElement, installDom } from './fake-dom.mjs';
import { FINDINGS, init } from '../src/client/tool-attachment.mjs';

/** A fake element whose descendants are found by data-js name. @param {string} tag @param {Record<string, string>} [dataset] @param {Record<string, FakeElement>} [inside] */
function element(tag, dataset = {}, inside = {}) {
  const out = new FakeElement(tag, dataset);
  for (const [name, child] of Object.entries(inside)) out.select[`[data-js="attachment-${name}"]`] = [child];
  return out;
}

const VERDICTS = { program: 'Runs a program.', disguise: 'Disguised.', active: 'Can run code.', locked: 'Not checked.', none: 'Nothing found.' };

/** The panel as the template renders it, with the messages the client reads from data attributes. */
function page() {
  const findings = Object.keys(FINDINGS).map((key) => {
    const item = element('li', { finding: key }, { values: element('span') });
    item.hidden = true;
    return item;
  });
  const kind = element('dd');
  for (const [name, label] of [['exe', 'a Windows program'], ['html', 'a web page'], ['docx', 'a Word document'], ['unknown', 'unknown']]) kind.setAttribute(`data-kind-${name}`, label);
  const card = element('article', {}, {
    name: element('h3'),
    verdict: element('p', VERDICTS),
    advice: element('p', VERDICTS),
    kind,
    findings: element('section'),
    inside: element('section'),
    'inside-title': element('h4', { template: 'Inside: {n}' }),
    'inside-list': element('ul', VERDICTS),
    'inside-more': element('p', { template: 'And {n} more.' }),
    links: element('section'),
    'links-title': element('h4', { template: 'Links: {n}' }),
    'links-list': element('ul', { ok: 'No warning signs.', warn: 'Warnings: {n}.' }),
    'links-more': element('p', { template: 'And {n} more links.' }),
  });
  card.select['[data-finding]'] = findings;
  const template = /** @type {FakeElement & { content: { firstElementChild: FakeElement } }} */ (Object.assign(element('template'), { content: { firstElementChild: card } }));
  const parts = {
    file: Object.assign(element('input'), { files: [] }),
    results: element('div'),
    template,
    summary: element('p', { reading: 'Checking…', done: 'Files checked: {n}.', capped: 'Only the first {max}.' }),
    example: element('button'),
  };
  const root = element('section', {}, parts);
  return { root, ...parts };
}

/** Waits until the page has finished checking. @param {FakeElement} summary */
async function settled(summary) {
  for (let i = 0; i < 200 && !summary.textContent.startsWith('Files checked'); i += 1) await new Promise((resolve) => setTimeout(resolve, 10));
}

describe('attachment checker page', () => {
  it('checks the three example files and shows one card each, with its verdict, type and findings', async () => {
    const dom = installDom();
    // files.mjs checks for a real file input; the fake one is not, so it only skips showing the file's name.
    Object.assign(globalThis, { HTMLInputElement: class {} });
    try {
      const { root, results, summary, example } = page();
      init(/** @type {HTMLElement} */ (/** @type {unknown} */ (root)));
      example.click();
      assert.equal(summary.textContent, 'Checking…');
      await settled(summary);
      assert.equal(summary.textContent, 'Files checked: 3.');
      const cards = results.children;
      /** @param {FakeElement} card @param {string} name */
      const part = (card, name) => card.select[`[data-js="attachment-${name}"]`][0];
      assert.deepEqual(cards.map((card) => card.dataset.verdict), ['program', 'active', 'active']);
      assert.deepEqual(cards.map((card) => card.dataset.state), ['warn', 'warn', 'warn']);
      assert.deepEqual(cards.map((card) => part(card, 'name').textContent), ['Invoice⟨RLO⟩fdp.exe', 'Delivery notice.html', 'Report.docm']);
      assert.deepEqual(cards.map((card) => part(card, 'verdict').textContent), ['Runs a program.', 'Can run code.', 'Can run code.']);
      assert.deepEqual(cards.map((card) => part(card, 'kind').textContent), ['a Windows program', 'a web page', 'a Word document']);
      /** @param {FakeElement} card */
      const shown = (card) => card.select['[data-finding]'].filter((item) => !item.hidden).map((item) => item.dataset.finding);
      assert.deepEqual(cards.map(shown), [['program', 'bidi'], ['passwordForm', 'webPage'], ['macros']]);
      const bidi = cards[0].select['[data-finding]'].find((item) => item.dataset.finding === 'bidi');
      assert.deepEqual(bidi?.select['[data-js="attachment-values"]'][0].children.map((line) => line.textContent), ['Invoice⟨RLO⟩fdp.exe', 'Invoiceexe.pdf']);
      // The web page's link is listed and judged; nothing is inside these files.
      assert.equal(part(cards[1], 'links').hidden, false);
      assert.equal(part(cards[1], 'links-title').children.map((child) => child.textContent).join(''), '1');
      assert.equal(part(cards[0], 'inside').hidden, true);
    } finally {
      dom.restore();
      delete (/** @type {Record<string, unknown>} */ (globalThis)).HTMLInputElement;
    }
  });
});

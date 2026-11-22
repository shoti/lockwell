// @ts-check
/**
 * @file Tests for the page list (src/client/pdf-pages.mjs): inheritance (ISO 32000-1 §7.7.3.4, Table 30), boxes,
 * rotation and the page-tree limits (plan §6.3, §11 "Pages"). Fixtures from build-files.mjs.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { PdfError, openPdf } from '../src/client/pdf-file.mjs';
import { LETTER, MAX_TREE_DEPTH, normaliseRotation, pageBox, pageList } from '../src/client/pdf-pages.mjs';
import { PdfDict, PdfRef, PdfString } from '../src/client/pdf-syntax.mjs';
import { pdfFile } from './build-files.mjs';

const CATALOG = { num: 1, body: '<< /Type /Catalog /Pages 2 0 R >>' };

/** @param {{ num: number, body: string }[]} objects */
const pages = async (objects) => pageList(await openPdf(pdfFile({ objects: [CATALOG, ...objects] })));

describe('PDF pages: inheritance (Table 30)', () => {
  it('takes Resources, MediaBox, CropBox and Rotate from two levels up, and the nearest level wins', async () => {
    const list = await pages([
      { num: 2, body: '<< /Type /Pages /Kids [3 0 R] /Count 2 /MediaBox [0 0 500 700] /Resources 9 0 R /Rotate 90 /CropBox [10 10 490 690] >>' },
      { num: 3, body: '<< /Type /Pages /Parent 2 0 R /Kids [4 0 R 5 0 R] /Count 2 /Rotate 180 >>' },
      { num: 4, body: '<< /Type /Page /Parent 3 0 R >>' },
      { num: 5, body: '<< /Type /Page /Parent 3 0 R /MediaBox [0 0 200 300] /Rotate 0 >>' },
      { num: 9, body: '<< /Font << >> >>' },
    ]);
    assert.equal(list.length, 2);
    assert.deepEqual(list[0].mediaBox, [0, 0, 500, 700]);
    assert.deepEqual(list[0].cropBox, [10, 10, 490, 690]);
    assert.equal(list[0].rotate, 180, 'the middle level is nearer than the root');
    assert.ok(list[0].resources instanceof PdfRef && list[0].resources.num === 9, 'one Resources stays a reference, so it stays shared');
    assert.deepEqual(list[1].mediaBox, [0, 0, 200, 300]);
    assert.deepEqual(list[1].cropBox, [10, 10, 200, 300], 'the inherited crop box is clipped to the page\'s own MediaBox');
    assert.equal(list[1].rotate, 0);
    assert.ok(list[1].ref instanceof PdfRef && list[1].ref.num === 5);
  });

  it('does not inherit UserUnit, which Table 30 does not mark inheritable', async () => {
    const list = await pages([
      { num: 2, body: '<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 /UserUnit 2 /MediaBox [0 0 100 100] >>' },
      { num: 3, body: '<< /Type /Page /Parent 2 0 R >>' },
      { num: 4, body: '<< /Type /Page /Parent 2 0 R /UserUnit 3 >>' },
    ]);
    assert.deepEqual(list.map((page) => page.userUnit), [1, 3]);
    assert.deepEqual(pageBox(list[1]), { box: [0, 0, 100, 100], width: 300, height: 300 });
  });

  it('merges Resources found at several levels, the nearest winning, as PDF.js draws them', async () => {
    const [page] = await pages([
      { num: 2, body: '<< /Type /Pages /Kids [3 0 R] /Count 1 /MediaBox [0 0 100 100] /Resources << /Font (parent) /XObject (parent) >> >>' },
      { num: 3, body: '<< /Type /Page /Parent 2 0 R /Resources << /Font (page) >> >>' },
    ]);
    assert.ok(page.resources instanceof PdfDict);
    const text = (/** @type {string} */ key) => String.fromCharCode(.../** @type {PdfString} */ (/** @type {PdfDict} */ (page.resources).get(key)).bytes);
    assert.equal(text('Font'), 'page');
    assert.equal(text('XObject'), 'parent');
  });
});

describe('PDF pages: boxes and rotation', () => {
  it('uses US Letter when no MediaBox is given, or the nearest one is not a rectangle', async () => {
    const list = await pages([
      { num: 2, body: '<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 /MediaBox [0 0 300 300] >>' },
      { num: 3, body: '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 0 100] >>' },
      { num: 4, body: '<< /Type /Page /Parent 2 0 R /MediaBox (not a box) >>' },
    ]);
    assert.deepEqual(list.map((page) => page.mediaBox), [LETTER, LETTER]);
    const [missing] = await pages([{ num: 2, body: '<< /Type /Pages /Kids [3 0 R] /Count 1 >>' }, { num: 3, body: '<< /Type /Page /Parent 2 0 R >>' }]);
    assert.deepEqual(missing.mediaBox, [0, 0, 612, 792]);
  });

  it('normalises boxes written corner to corner in any order, with references inside', async () => {
    const [page] = await pages([
      { num: 2, body: '<< /Type /Pages /Kids [3 0 R] /Count 1 >>' },
      { num: 3, body: '<< /Type /Page /Parent 2 0 R /MediaBox [612 792 5 0 R 0] >>' },
      { num: 5, body: '0' },
    ]);
    assert.deepEqual(page.mediaBox, [0, 0, 612, 792]);
  });

  it('clamps a CropBox to the MediaBox, and falls back to the MediaBox when they do not meet (§14.11.2)', async () => {
    const list = await pages([
      { num: 2, body: '<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 /MediaBox [0 0 600 800] >>' },
      { num: 3, body: '<< /Type /Page /Parent 2 0 R /CropBox [-50 100 700 900] >>' },
      { num: 4, body: '<< /Type /Page /Parent 2 0 R /CropBox [700 900 800 1000] >>' },
    ]);
    assert.deepEqual(list[0].cropBox, [0, 100, 600, 800]);
    assert.deepEqual(list[1].cropBox, [0, 0, 600, 800]);
  });

  it('normalises /Rotate as PDF.js does: −90 is 270, 450 is 90, 45 is 0', () => {
    assert.deepEqual([-90, 450, 45, 0, 360, -720, 270, 90.5].map(normaliseRotation), [270, 90, 0, 0, 0, 0, 270, 0]);
  });

  it('gives the shown size: crop box, rotated, times UserUnit', async () => {
    const [page] = await pages([
      { num: 2, body: '<< /Type /Pages /Kids [3 0 R] /Count 1 >>' },
      { num: 3, body: '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 800] /CropBox [100 100 400 300] /Rotate -90 /UserUnit 2 >>' },
    ]);
    assert.equal(page.rotate, 270);
    assert.deepEqual(pageBox(page), { box: [100, 100, 400, 300], width: 400, height: 600 });
  });
});

describe('PDF pages: odd trees and limits', () => {
  it('lists a page written directly in Kids, a page listed twice, and a node with no /Type', async () => {
    const list = await pages([
      { num: 2, body: '<< /Type /Pages /Kids [3 0 R << /Type /Page /MediaBox [0 0 10 10] >> 3 0 R 4 0 R] /Count 4 >>' },
      { num: 3, body: '<< /Type /Page /Parent 2 0 R >>' },
      { num: 4, body: '<< /Kids [5 0 R] /Count 1 >>' },
      { num: 5, body: '<< /Type /Page /Parent 4 0 R >>' },
    ]);
    assert.equal(list.length, 4);
    assert.equal(list[1].ref, null);
    assert.equal(list[0].dict, list[2].dict);
    assert.ok(list[3].ref instanceof PdfRef && list[3].ref.num === 5);
  });

  it('skips a node listed below itself, as qpdf and Poppler do, and keeps the other pages', async () => {
    const list = await pages([
      { num: 2, body: '<< /Type /Pages /Kids [3 0 R 2 0 R 4 0 R] /Count 2 >>' },
      { num: 3, body: '<< /Type /Page /Parent 2 0 R >>' },
      { num: 4, body: '<< /Type /Pages /Parent 2 0 R /Kids [2 0 R 5 0 R] /Count 1 >>' },
      { num: 5, body: '<< /Type /Page /Parent 4 0 R >>' },
    ]);
    assert.equal(list.length, 2);
  });

  it('refuses a tree 1,000 levels deep, without overflowing the stack', async () => {
    const objects = [];
    for (let i = 0; i < 1000; i += 1) objects.push({ num: 2 + i, body: `<< /Type /Pages /Kids [${3 + i} 0 R] /Count 1 >>` });
    objects.push({ num: 1002, body: '<< /Type /Page >>' });
    await assert.rejects(pages(objects), (error) => error instanceof PdfError && error.code === 'tooLarge');
    const shallow = objects.slice(1000 - MAX_TREE_DEPTH).map((o, i) => ({ ...o, num: 2 + i, body: o.body.replace(/\d+ 0 R/, `${3 + i} 0 R`) }));
    assert.equal((await pages(shallow)).length, 1, `${MAX_TREE_DEPTH} levels are accepted`);
  });

  it('refuses a tree that multiplies into too many pages, without walking them all', async () => {
    // 20 levels where every node lists the next one twice: 2^20 pages in a tiny file.
    const objects = [];
    for (let i = 0; i < 20; i += 1) objects.push({ num: 2 + i, body: `<< /Type /Pages /Kids [${3 + i} 0 R ${3 + i} 0 R] >>` });
    objects.push({ num: 22, body: '<< /Type /Page >>' });
    await assert.rejects(pages(objects), (error) => error instanceof PdfError && error.code === 'tooLarge');
  });

  it('says damaged for a tree with no page at all', async () => {
    await assert.rejects(pages([{ num: 2, body: '<< /Type /Pages /Kids [] /Count 0 >>' }]), (error) => error instanceof PdfError && error.code === 'damaged');
  });
});

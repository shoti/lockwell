// @ts-check
/**
 * @file Tests for saving clean copies: neutral names and the archive of several files.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { hasDate, savedName } from '../src/client/save.mjs';
import { cleanArchive } from '../src/client/zip.mjs';
import { readZip } from '../src/client/tool-document.mjs';

describe('save: file names', () => {
  it('finds the dates phones and people put in file names', () => {
    for (const name of ['IMG_20261109_140322.jpg', 'PXL_20261109_140322123.jpg', 'Board report 2026-11-09.docx', 'scan_2026.11.09.pdf']) {
      assert.equal(hasDate(name), true, name);
    }
    for (const name of ['holiday.jpg', 'IMG_1234.JPG', 'report-v2.docx', '1234567.png']) assert.equal(hasDate(name), false, name);
  });

  it('finds dates written day first, as in Georgia, and times in milliseconds', () => {
    for (const name of ['report 13-11-2026.docx', 'report 13.11.2026.docx', 'report 13.11.26.docx', 'report 11-13-2026.docx', 'FB_IMG_1731492000123.jpg', '1731492000123.jpg']) {
      assert.equal(hasDate(name), true, name);
    }
    for (const name of ['invoice 1920x1080 v2.docx', 'tel 599201231.docx', 'budget-2026.xlsx', 'Scan_2026-11.pdf', 'v1.2.3.docx', 'photo_5247011234567890123_y.jpg']) {
      assert.equal(hasDate(name), false, name);
    }
  });

  it('names the copy after the original, or neutrally', () => {
    const options = { extension: 'jpg', fallback: 'photo', suffix: 'clean' };
    assert.equal(savedName('IMG_1234.JPG', { ...options, neutral: false }), 'IMG_1234-clean.jpg');
    assert.equal(savedName('IMG_1234.JPG', { ...options, neutral: true }), 'photo.jpg');
    assert.equal(savedName('.jpg', { ...options, neutral: false }), 'photo-clean.jpg');
    const exact = { extension: 'lockwell', fallback: 'locked', suffix: '' };
    assert.equal(savedName('report.pdf.lockwell', { ...exact, neutral: false }), 'report.pdf.lockwell', 'an empty suffix keeps the name');
    assert.equal(savedName('', { ...exact, neutral: false }), 'locked.lockwell');
    assert.equal(savedName('notes', { extension: '', fallback: 'unlocked', suffix: '', neutral: true }), 'unlocked', 'no extension, no dot');
  });
});

describe('save: several clean copies in one archive', () => {
  const data = (/** @type {number} */ n) => Uint8Array.of(n, n + 1, n + 2);

  it('gives dated originals neutral names inside the archive and keeps the rest apart', () => {
    const archive = cleanArchive(
      [
        { original: 'IMG_20261109_140322.jpg', extension: 'jpg', data: data(1) },
        { original: 'IMG_20261109_140323.jpg', extension: 'jpg', data: data(2) },
        { original: 'cat.png', extension: 'png', data: data(3) },
        { original: 'cat.png', extension: 'png', data: data(4) },
      ],
      { fallback: 'photo', suffix: 'clean' },
    );
    const entries = readZip(archive);
    assert.deepEqual(
      entries.map((entry) => entry.name),
      ['photo-1.jpg', 'photo-2.jpg', 'cat-clean.png', 'cat-clean-2.png'],
    );
    assert.deepEqual(
      entries.map((entry) => [...entry.data]),
      [1, 2, 3, 4].map((n) => [...data(n)]),
      'stored as they are',
    );
  });

  it('follows each card’s choice of name', () => {
    const archive = cleanArchive(
      [
        { original: 'Nino Beridze - letter.docx', extension: 'docx', data: data(1), neutral: true },
        { original: 'IMG_20261109_140322.docx', extension: 'docx', data: data(2), neutral: false },
        { original: 'notes.docx', extension: 'docx', data: data(3) },
      ],
      { fallback: 'document', suffix: 'clean' },
    );
    assert.deepEqual(readZip(archive).map((entry) => entry.name), ['document-1.docx', 'IMG_20261109_140322-clean.docx', 'notes-clean.docx']);
  });

  it('makes names that are safe on every system: no separators or control characters, no two that differ only in case', () => {
    const archive = cleanArchive(
      [
        { original: 'a.docx', extension: 'docx', data: data(1) },
        { original: 'A.docx', extension: 'docx', data: data(2) },
        { original: 'a/b\\c:d\u0001.docx', extension: 'docx', data: data(3) },
      ],
      { fallback: 'document', suffix: 'clean' },
    );
    assert.deepEqual(readZip(archive).map((entry) => entry.name), ['a-clean.docx', 'A-clean-2.docx', 'a-b-c-d--clean.docx']);
  });

  it('carries no time of its own', () => {
    const archive = cleanArchive([{ original: 'a.jpg', extension: 'jpg', data: data(1) }], { fallback: 'photo', suffix: 'clean' });
    const view = new DataView(archive.buffer, archive.byteOffset, archive.byteLength);
    assert.equal(view.getUint16(10, true), 0, 'time 00:00');
    assert.equal(view.getUint16(12, true), 0x0021, 'date 1980-01-01');
  });
});

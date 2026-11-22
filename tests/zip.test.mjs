// @ts-check
/**
 * @file Tests for reading ZIP archives: the strict reader and the tolerant scanner.
 */
/**
 * Archives are assembled here byte by byte (PKWARE APPNOTE 6.3.10 §4.3), independently of the site's ZIP writer.
 */
import assert from 'node:assert/strict';
import { deflateRawSync } from 'node:zlib';
import { describe, it } from 'node:test';
import { crc32 } from '../src/client/bytes.mjs';
import { FLAG_UTF8, ZipError, readZip, scanZip, unzip, writeZip, zipBlob } from '../src/client/zip.mjs';

/** @param {number} n */
const u16 = (n) => [n & 0xff, (n >>> 8) & 0xff];
/** @param {number} n */
const u32 = (n) => [n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff];
/** @param {string} text */
const utf8 = (text) => [...new TextEncoder().encode(text)];

/**
 * @typedef {object} Item
 * @property {string} name
 * @property {string} [text]  Contents.
 * @property {number} [flags]
 * @property {boolean} [deflate]
 * @property {string} [localName]  A different name in the local header.
 * @property {number} [declaredSize]  A different uncompressed size in the directory.
 */

/** @param {Item[]} items @param {{ breakCentral?: boolean, zip64?: boolean }} [options] */
function archive(items, { breakCentral = false, zip64 = false } = {}) {
  /** @type {number[]} */
  const out = [];
  /** @type {number[]} */
  const central = [];
  for (const { name, text = '', flags = 0, deflate = false, localName = name, declaredSize } of items) {
    const raw = utf8(text);
    const data = deflate ? [...deflateRawSync(Buffer.from(raw))] : raw;
    const method = deflate ? 8 : 0;
    const size = declaredSize ?? raw.length;
    const offset = out.length;
    out.push(...u32(0x04034b50), ...u16(20), ...u16(flags), ...u16(method), ...u32(0), ...u32(0), ...u32(data.length), ...u32(size), ...u16(utf8(localName).length), ...u16(0), ...utf8(localName), ...data);
    central.push(...u32(breakCentral ? 0x12345678 : 0x02014b50), ...u16(20), ...u16(20), ...u16(flags), ...u16(method), ...u32(0), ...u32(0), ...u32(data.length), ...u32(size), ...u16(utf8(name).length), ...u16(0), ...u16(0), ...u16(0), ...u16(0), ...u32(0), ...u32(offset), ...utf8(name));
  }
  const start = out.length;
  out.push(...central, ...u32(0x06054b50), ...u16(0), ...u16(0), ...u16(zip64 ? 0xffff : items.length), ...u16(zip64 ? 0xffff : items.length), ...u32(central.length), ...u32(start), ...u16(0));
  return Uint8Array.from(out);
}

describe('scanZip', () => {
  it('lists entries of an ordinary archive with no problems', () => {
    const { entries, problems } = scanZip(archive([{ name: 'report.pdf', text: '%PDF-1.7' }, { name: 'photos/a.jpg', text: 'x', deflate: true }]));
    assert.deepEqual(entries.map((entry) => entry.name), ['report.pdf', 'photos/a.jpg']);
    assert.deepEqual([...problems], []);
  });

  it('lists encrypted entries by name and says they are encrypted', () => {
    const { entries, problems } = scanZip(archive([{ name: 'invoice.pdf.exe', text: 'secret', flags: 1 }]));
    assert.equal(entries[0].name, 'invoice.pdf.exe');
    assert.equal(entries[0].encrypted, true);
    assert.ok(problems.has('encrypted'));
  });

  it('notices duplicate names, local names that differ, and names that leave the folder', () => {
    assert.ok(scanZip(archive([{ name: 'a.txt' }, { name: 'A.TXT' }])).problems.has('duplicate'));
    assert.ok(scanZip(archive([{ name: 'invoice.pdf', localName: 'invoice.exe' }])).problems.has('nameMismatch'));
    for (const name of ['../evil.lnk', 'docs/../../evil.lnk', '/etc/profile', 'C:\\Users\\x\\Startup\\a.lnk', '..\\a.exe']) {
      assert.ok(scanZip(archive([{ name }])).problems.has('traversal'), name);
    }
    assert.ok(!scanZip(archive([{ name: 'notes..txt' }, { name: 'a/..b/c' }])).problems.has('traversal'), 'two dots inside a name are fine');
  });

  it('says when a file is not an archive, is damaged or uses ZIP64', () => {
    assert.ok(scanZip(Uint8Array.from(utf8('just some text'))).problems.has('notZip'));
    assert.ok(scanZip(archive([{ name: 'a' }], { breakCentral: true })).problems.has('damaged'));
    assert.ok(scanZip(archive([{ name: 'a' }], { zip64: true })).problems.has('zip64'));
  });
});

describe('readZip and unzip', () => {
  it('reads an ordinary archive and its stored and deflated entries', async () => {
    const entries = readZip(archive([{ name: 'a.txt', text: 'hello' }, { name: 'b.txt', text: 'world '.repeat(50), deflate: true }]));
    assert.equal(new TextDecoder().decode(await unzip(entries[0], 1000)), 'hello');
    assert.equal(new TextDecoder().decode(await unzip(entries[1], 1000)), 'world '.repeat(50));
  });

  it('refuses archives it can’t read in full, with the reason', () => {
    /** @param {Uint8Array} bytes @param {string} code */
    const refuses = (bytes, code) => assert.throws(() => readZip(bytes), (error) => error instanceof ZipError && error.code === code);
    refuses(archive([{ name: 'a', flags: 1 }]), 'locked');
    refuses(archive([{ name: 'a' }, { name: 'A' }]), 'damaged');
    refuses(archive([{ name: 'a' }], { zip64: true }), 'zip64');
    refuses(Uint8Array.from(utf8('not an archive')), 'damaged');
  });

  it('stops an entry that inflates past its declared size, and one too large to accept', async () => {
    const [bomb] = readZip(archive([{ name: 'a', text: 'x'.repeat(10_000), deflate: true, declaredSize: 100 }]));
    await assert.rejects(unzip(bomb, 1_000_000), (error) => error instanceof ZipError && error.code === 'damaged');
    const [large] = readZip(archive([{ name: 'a', text: 'x'.repeat(10_000), deflate: true }]));
    await assert.rejects(unzip(large, 1000), (error) => error instanceof ZipError && error.code === 'damaged');
  });

  it('never decompresses an encrypted entry', async () => {
    const { entries } = scanZip(archive([{ name: 'a', text: 'x', flags: 1 }]));
    await assert.rejects(unzip(entries[0], 1000), (error) => error instanceof ZipError && error.code === 'locked');
  });
});

describe('zipBlob (review C8, C9)', () => {
  const encoder = new TextEncoder();
  /** @param {string} name @param {Uint8Array} data */
  const entry = (name, data) => ({ name, rawName: encoder.encode(name), flags: FLAG_UTF8, method: 0, crc: crc32(data), size: data.length, data });

  it('writes the same bytes as writeZip, with the entries left as Blobs', async () => {
    const a = new Uint8Array(3000).map((_, i) => i % 251);
    const b = encoder.encode('second file');
    const inMemory = writeZip([entry('a.bin', a), entry('b.txt', b)]);
    const blob = zipBlob([{ ...entry('a.bin', a), data: new Blob([a]) }, { ...entry('b.txt', b), data: new Blob([b]) }]);
    assert.equal(blob.type, 'application/zip');
    assert.deepEqual(new Uint8Array(await blob.arrayBuffer()), inMemory);
  });

  it('checksums a piece at a time to the same value', () => {
    const data = encoder.encode('The quick brown fox jumps over the lazy dog');
    assert.equal(crc32(data), 0x414fa339);
    assert.equal(crc32(data.subarray(10), crc32(data.subarray(0, 10))), 0x414fa339);
  });

  it('refuses more entries than a ZIP without ZIP64 can count', () => {
    const one = entry('x', new Uint8Array(0));
    assert.throws(() => writeZip(Array.from({ length: 65_536 }, () => one)), RangeError);
    assert.equal(readZip(writeZip(['x', 'y', 'z'].map((name) => entry(name, new Uint8Array(0))))).length, 3);
  });
});

// @ts-check
/**
 * @file Tests for opening PDFs (src/client/pdf-file.mjs): cross-reference tables and streams, hybrid files,
 * updates, object streams, stream extents, repair, filters and limits (ISO 32000-1 §7.4–7.5; plan §6.1–6.3, §11).
 * Every fixture is built byte by byte in build-files.mjs, never by the site's own writer.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { describe, it } from 'node:test';
import { COUNTS, LIMITS, PdfError, ascii85, asciiHex, lzw, meter, openPdf } from '../src/client/pdf-file.mjs';
import { pageList } from '../src/client/pdf-pages.mjs';
import { PdfDict, PdfStream, PdfString } from '../src/client/pdf-syntax.mjs';
import { ascii85Encode, join, latin1, lastStartxref, lzwEncode, pdfFile, simplePdf } from './build-files.mjs';

/** @param {Uint8Array} bytes */
const pagesOf = async (bytes) => pageList(await openPdf(bytes)).length;

/** @param {Promise<unknown>} promise @param {string} code */
async function rejectsPdf(promise, code) {
  await assert.rejects(promise, (error) => error instanceof PdfError && error.code === code);
}

/** The text of an object's /Marker string, to tell versions of an object apart. @param {import('../src/client/pdf-file.mjs').PdfFile} file @param {number} num */
function marker(file, num) {
  const value = file.get(num);
  const text = value instanceof PdfDict ? value.get('Marker') : null;
  return text instanceof PdfString ? String.fromCharCode(...text.bytes) : null;
}

const CATALOG = { num: 1, body: '<< /Type /Catalog /Pages 2 0 R >>' };
const PAGES = { num: 2, body: '<< /Type /Pages /Kids [3 0 R] /Count 1 >>' };
const PAGE = { num: 3, body: '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] /Marker (v1) >>' };

describe('PDF file: cross-reference data (§7.5.4–7.5.8)', () => {
  it('opens a classic table without decoding any stream', async () => {
    const before = { ...COUNTS };
    const file = await openPdf(simplePdf(3));
    assert.equal(pageList(file).length, 3);
    assert.equal(file.repaired, false);
    assert.equal(file.version, '1.7');
    assert.equal(COUNTS.decoded - before.decoded, 0, 'no page content decoded');
    assert.equal(COUNTS.structural - before.structural, 0);
  });

  for (const widths of [[1, 2, 1], [1, 4, 2], [2, 3, 2], [1, 8, 1], [0, 3, 1]]) {
    it(`reads a cross-reference stream with /W [${widths.join(' ')}]`, async () => {
      const bytes = pdfFile({ objects: [CATALOG, PAGES, PAGE], xref: 'stream', widths });
      const file = await openPdf(bytes);
      assert.equal(pageList(file).length, 1);
      assert.equal(file.repaired, false);
    });
  }

  it('reads a cross-reference stream with the PNG Up predictor and an /Index of several ranges', async () => {
    const bytes = pdfFile({ objects: [CATALOG, PAGES, PAGE, { num: 7, body: '(seven)' }, { num: 20, body: '(twenty)' }], xref: 'stream', predictor: true, xrefNum: 30 });
    assert.match(String.fromCharCode(...bytes), /\/Index \[0 4 7 1 20 1 30 1\]/);
    const file = await openPdf(bytes);
    assert.equal(file.repaired, false);
    assert.deepEqual(Array.from(/** @type {PdfString} */ (file.get(20)).bytes), Array.from(latin1('twenty')));
    assert.equal(file.get(8), null, 'an object not listed is null');
  });

  it('reads objects from an object stream (§7.5.7)', async () => {
    const bytes = pdfFile({ objects: [], packed: { num: 4, objects: [CATALOG, PAGES, PAGE] }, xref: 'stream' });
    const file = await openPdf(bytes);
    assert.equal(pageList(file).length, 1);
    assert.equal(marker(file, 3), 'v1');
    assert.equal(file.entries.get(3)?.type, 'packed');
  });

  it('reads a hybrid file: the XRefStm is searched before /Prev, and a free entry in the older table does not hide an object', async () => {
    const base = pdfFile({ objects: [CATALOG, PAGES, { num: 3, body: '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] /Annots 5 0 R >>' }], free: [5] });
    // The update: an object stream with object 5, listed only in a cross-reference stream that the empty table names.
    const packed = pdfFile({ base, objects: [], packed: { num: 6, objects: [{ num: 5, body: '[(hidden annotation list)]' }] }, xref: 'stream', xrefNum: 7, prev: null });
    const streamAt = lastStartxref(packed);
    const hybrid = join(packed, latin1(`xref\n0 0\ntrailer\n<< /Size 8 /Root 1 0 R /Prev ${lastStartxref(base)} /XRefStm ${streamAt} >>\nstartxref\n${packed.length}\n%%EOF\n`));
    const file = await openPdf(hybrid);
    assert.equal(file.repaired, false);
    const list = file.get(5);
    assert.ok(Array.isArray(list) && list[0] instanceof PdfString);
  });

  it('follows three chained updates: the newest version of an object wins and a deleted one reads as null', async () => {
    const v1 = pdfFile({ objects: [CATALOG, PAGES, PAGE, { num: 4, body: '<< /Marker (four) >>' }, { num: 5, body: '<< /Marker (five) >>' }] });
    const v2 = pdfFile({ base: v1, objects: [{ num: 3, body: '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] /Marker (v2) >>' }] });
    const v3 = pdfFile({ base: v2, objects: [{ num: 6, body: '<< /Marker (six) >>' }], free: [5], xref: 'stream' });
    const v4 = pdfFile({ base: v3, objects: [{ num: 4, body: '<< /Marker (four again) >>' }, { num: 3, body: '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] /Marker (v4) >>' }] });
    const file = await openPdf(v4);
    assert.equal(file.repaired, false);
    assert.equal(marker(file, 3), 'v4');
    assert.equal(marker(file, 4), 'four again');
    assert.equal(file.get(5), null, 'deleted in the second update');
    assert.equal(marker(file, 6), 'six');
    assert.equal(pageList(file).length, 1);
  });

  it('ends a /Prev chain that points back to itself, or to a newer section, without a hang', async () => {
    const own = pdfFile({ objects: [CATALOG, PAGES, PAGE] });
    const at = lastStartxref(own);
    const loop = latin1(String.fromCharCode(...own).replace(/trailer\n<< \/Size 4/, `trailer\n<< /Size 4 /Prev ${at}`));
    assert.equal(await pagesOf(loop), 1);
    const v1 = pdfFile({ objects: [CATALOG, PAGES, PAGE] });
    const v2 = pdfFile({ base: v1, objects: [{ num: 4, body: 'null' }] });
    const back = latin1(String.fromCharCode(...v2).replace(`/Prev ${lastStartxref(v1)}`, `/Prev ${lastStartxref(v2)}`));
    const file = await openPdf(back);
    assert.equal(pageList(file).length, 1);
  });

  it('opens a file with junk before the header, with offsets counted from the file or from the header', async () => {
    const junk = 'x'.repeat(500);
    for (const relative of [false, true]) {
      const file = await openPdf(simplePdf(2, { junk, relative }));
      assert.equal(pageList(file).length, 2, `relative: ${relative}`);
      assert.equal(file.repaired, false, `relative: ${relative}`);
    }
    await rejectsPdf(openPdf(simplePdf(1, { junk: 'x'.repeat(1100) })), 'unsupported');
  });

  it('refuses a file without a PDF header', async () => {
    await rejectsPdf(openPdf(latin1('Hello, this is not a PDF')), 'unsupported');
    await rejectsPdf(openPdf(new Uint8Array(0)), 'unsupported');
  });
});

describe('PDF file: repair (plan §6.2)', () => {
  it('rebuilds a broken table by scanning, and says so', async () => {
    const good = simplePdf(3);
    const text = String.fromCharCode(...good);
    for (const broken of [text.replace('xref', 'xrfe'), text.replace(/startxref\n\d+/, 'startxref\n999999'), text.replace(/startxref[\s\S]*$/, ''), text.replace(/0000000\d\d\d 00000 n/, '0000000001 00000 n')]) {
      const file = await openPdf(latin1(broken));
      assert.equal(file.repaired, true);
      assert.equal(pageList(file).length, 3);
    }
  });

  it('finds the catalog without any trailer', async () => {
    const file = await openPdf(pdfFile({ objects: [CATALOG, PAGES, PAGE], xref: 'none', root: null }));
    assert.equal(file.repaired, true);
    assert.equal(pageList(file).length, 1);
  });

  it('takes the later copy of an object, and never an object written inside a stream\'s data', async () => {
    const decoy = latin1('3 0 obj\n<< /Type /Page /Marker (decoy) >>\nendobj\n');
    const bytes = pdfFile({ objects: [CATALOG, PAGES, PAGE, { num: 5, stream: { data: decoy } }, { num: 3, body: '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] /Marker (later) >>' }, { num: 6, stream: { data: decoy } }], xref: 'none' });
    const file = await openPdf(bytes);
    assert.equal(file.repaired, true);
    assert.equal(marker(file, 3), 'later');
  });

  it('fails with damaged when even the scan finds no page tree', async () => {
    await rejectsPdf(openPdf(pdfFile({ objects: [{ num: 1, body: '<< /Type /Catalog >>' }] })), 'damaged');
    await rejectsPdf(openPdf(latin1('%PDF-1.7\nnothing here\n%%EOF')), 'damaged');
  });

  it('does not repair a file whose cross-reference stream lists itself at a stale offset (qpdf good17.pdf)', async () => {
    const bytes = pdfFile({ objects: [CATALOG, PAGES, PAGE], xref: 'stream', xrefNum: 9 });
    // Four bytes inserted before the stream, and startxref moved with it: the stream's own entry for object 9,
    // inside its data, now points four bytes early.
    const shifted = join(bytes.subarray(0, lastStartxref(bytes)), latin1('\n\n\n\n'), bytes.subarray(lastStartxref(bytes)));
    const fixed = latin1(String.fromCharCode(...shifted).replace(/startxref\n\d+/, `startxref\n${lastStartxref(bytes) + 4}`));
    const file = await openPdf(fixed);
    assert.equal(file.repaired, false);
    assert.equal(pageList(file).length, 1);
  });
});

describe('PDF file: streams (§7.3.8, plan §6.1)', () => {
  const content = 'BT /F1 12 Tf (endstream inside) Tj ET';
  /** @param {import('./build-files.mjs').PdfPart['stream']} stream */
  const withStream = async (stream) => {
    const file = await openPdf(pdfFile({ objects: [CATALOG, PAGES, PAGE, { num: 4, stream }, { num: 5, body: String(content.length) }] }));
    const value = file.get(4);
    assert.ok(value instanceof PdfStream);
    return String.fromCharCode(...value.data);
  };

  it('reads the data by /Length, which may be a reference', async () => {
    assert.equal(await withStream({ data: content }), content);
    assert.equal(await withStream({ data: content, length: '5 0 R' }), content);
    assert.equal(await withStream({ data: content, eol: '\r\n' }), content);
  });

  it('falls back to "endstream" when /Length is wrong or missing', async () => {
    const plain = 'BT (no keyword in here) Tj ET';
    assert.equal(await withStream({ data: plain, length: 3 }), plain);
    assert.equal(await withStream({ data: plain, length: 5000 }), plain);
    assert.equal(await withStream({ data: plain, length: null }), plain);
    assert.equal(await withStream({ data: plain, length: '99 0 R' }), plain);
  });

  it('does not loop on a /Length that refers to its own stream', async () => {
    const file = await openPdf(pdfFile({ objects: [CATALOG, PAGES, PAGE, { num: 4, stream: { data: 'abc', length: '4 0 R' } }] }));
    const value = file.get(4);
    assert.ok(value instanceof PdfStream);
    assert.equal(String.fromCharCode(...value.data), 'abc');
  });
});

describe('PDF file: filters (§7.4)', () => {
  /** @param {string} dict @param {Uint8Array | string} data @param {number} [limit] */
  const decoded = async (dict, data, limit) => {
    const file = await openPdf(pdfFile({ objects: [CATALOG, PAGES, PAGE, { num: 4, stream: { dict, data } }] }));
    const stream = /** @type {PdfStream} */ (file.get(4));
    return Array.from(await file.decode(stream, limit ? { limit } : {}));
  };
  const text = latin1('The quick brown fox jumps over the lazy dog. '.repeat(40));

  it('inflates Flate data, and raw deflate without the zlib header', async () => {
    assert.deepEqual(await decoded('/Filter /FlateDecode', deflateSync(text)), Array.from(text));
    const { deflateRawSync } = await import('node:zlib');
    assert.deepEqual(await decoded('/Filter /FlateDecode', deflateRawSync(text)), Array.from(text));
  });

  it('keeps what was inflated from a stream cut short', async () => {
    const whole = deflateSync(Uint8Array.from({ length: 200_000 }, (_, i) => (i * 7919) % 251));
    const out = await decoded('/Filter /FlateDecode', whole.subarray(0, whole.length - 200));
    assert.ok(out.length > 100_000 && out.length < 200_000);
  });

  it('undoes each PNG predictor and the TIFF predictor (§7.4.4.4)', async () => {
    const columns = 5;
    const colors = 3;
    const rowBytes = columns * colors;
    const rows = Array.from({ length: 6 }, (_, r) => Array.from({ length: rowBytes }, (_, i) => (r * 37 + i * 11 + ((r * i) % 7)) % 256));
    const flat = rows.flat();
    // Encode each row with a different PNG filter type (RFC 2083 §6), the way PDF writers do.
    /** @type {number[]} */
    const png = [];
    rows.forEach((row, r) => {
      const tag = r % 5;
      png.push(tag);
      row.forEach((byte, i) => {
        const left = i >= colors ? row[i - colors] : 0;
        const up = r > 0 ? rows[r - 1][i] : 0;
        const corner = r > 0 && i >= colors ? rows[r - 1][i - colors] : 0;
        const p = left + up - corner;
        const paeth = Math.abs(p - left) <= Math.abs(p - up) && Math.abs(p - left) <= Math.abs(p - corner) ? left : Math.abs(p - up) <= Math.abs(p - corner) ? up : corner;
        const predicted = [0, left, up, (left + up) >> 1, paeth][tag];
        png.push((byte - predicted + 256) % 256);
      });
    });
    const parms = `/DecodeParms << /Predictor 15 /Colors ${colors} /Columns ${columns} >>`;
    assert.deepEqual(await decoded(`/Filter /FlateDecode ${parms}`, deflateSync(Uint8Array.from(png))), flat);
    const tiff8 = rows.flatMap((row) => row.map((byte, i) => (i >= colors ? (byte - row[i - colors] + 256) % 256 : byte)));
    assert.deepEqual(await decoded(`/Filter /FlateDecode /DecodeParms << /Predictor 2 /Colors ${colors} /Columns ${columns} >>`, deflateSync(Uint8Array.from(tiff8))), flat);
    // 16 bits per component, one colour: each sample is the 16-bit difference from the one to its left.
    const samples = [1000, 1003, 65535, 2, 40000];
    const tiff16 = samples.flatMap((value, i) => {
      const diff = (value - (i > 0 ? samples[i - 1] : 0) + 65536) % 65536;
      return [diff >> 8, diff & 0xff];
    });
    assert.deepEqual(await decoded('/Filter /FlateDecode /DecodeParms << /Predictor 2 /BitsPerComponent 16 /Columns 5 >>', deflateSync(Uint8Array.from(tiff16))), samples.flatMap((v) => [v >> 8, v & 0xff]));
    // 4 bits per component: two samples per byte.
    const nibbles = [1, 3, 15, 0, 7, 7];
    const diffs = nibbles.map((v, i) => (v - (i > 0 ? nibbles[i - 1] : 0) + 16) % 16);
    const packed = [0, 2, 4].map((i) => (diffs[i] << 4) | diffs[i + 1]);
    assert.deepEqual(await decoded('/Filter /FlateDecode /DecodeParms << /Predictor 2 /BitsPerComponent 4 /Columns 6 >>', deflateSync(Uint8Array.from(packed))), [0, 2, 4].map((i) => (nibbles[i] << 4) | nibbles[i + 1]));
  });

  it('decodes LZW: the example of §7.4.4.2, and long data with either EarlyChange', async () => {
    const example = Uint8Array.of(0x80, 0x0b, 0x60, 0x50, 0x22, 0x0c, 0x0c, 0x85, 0x01);
    assert.deepEqual(Array.from(lzw(example, 1, 1000, meter())), [45, 45, 45, 45, 45, 65, 45, 45, 45, 66]);
    assert.deepEqual(Array.from(lzwEncode(Uint8Array.of(45, 45, 45, 45, 45, 65, 45, 45, 45, 66))), Array.from(example), 'the test encoder matches the standard');
    let seed = 11;
    const random = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
    const long = Uint8Array.from({ length: 70_000 }, (_, i) => (random() < 0.6 ? 97 + (i % 7) : Math.floor(random() * 256)));
    assert.deepEqual(await decoded('/Filter /LZWDecode', lzwEncode(long, 1)), Array.from(long));
    assert.deepEqual(await decoded('/Filter /LZWDecode /DecodeParms << /EarlyChange 0 >>', lzwEncode(long, 0)), Array.from(long));
  });

  it('decodes ASCIIHex and ASCII85, alone and in a chain with Flate', async () => {
    assert.deepEqual(Array.from(asciiHex(latin1('61 62\n6>'), meter())), [0x61, 0x62, 0x60]);
    assert.throws(() => asciiHex(latin1('6g>'), meter()), PdfError);
    for (const length of [0, 1, 2, 3, 4, 5, 8, 9, 100]) {
      const data = Uint8Array.from({ length }, (_, i) => (i % 9 === 0 ? 0 : (i * 31) % 256));
      assert.deepEqual(Array.from(ascii85(latin1(ascii85Encode(data)), meter())), Array.from(data), `length ${length}`);
    }
    assert.deepEqual(Array.from(ascii85(latin1('z!!~>'), meter())), [0, 0, 0, 0, 0]);
    assert.throws(() => ascii85(latin1('!z~>'), meter()), PdfError, '"z" inside a group');
    assert.throws(() => ascii85(latin1('!!!!!!~>'), meter()), PdfError, 'a last group of one character');
    assert.throws(() => ascii85(latin1('s8W-"~>'), meter()), PdfError, 'a group above 2^32 - 1');
    assert.deepEqual(Array.from(ascii85(latin1('s8W-!~>'), meter())), [255, 255, 255, 255]);
    assert.deepEqual(await decoded('/Filter [/ASCII85Decode /FlateDecode]', ascii85Encode(deflateSync(text))), Array.from(text));
    assert.deepEqual(await decoded('/Filter /AHx', '414243>'), [65, 66, 67], 'abbreviated names, as qpdf accepts');
  });

  it('does not decode pictures and RunLength: they are copied as they are', async () => {
    for (const filter of ['DCTDecode', 'JPXDecode', 'JBIG2Decode', 'CCITTFaxDecode', 'RunLengthDecode']) {
      await rejectsPdf(decoded(`/Filter /${filter}`, 'abc'), 'unsupported');
    }
  });

  it('stops a stream that inflates past the limit, and a job past its total', async () => {
    const bomb = deflateSync(new Uint8Array(4 * 1024 * 1024));
    assert.ok(bomb.length < 10_000);
    await rejectsPdf(decoded('/Filter /FlateDecode', bomb, 1024 * 1024), 'tooLarge');
    await rejectsPdf(decoded('/Filter /LZWDecode', lzwEncode(new Uint8Array(200_000)), 10_000), 'tooLarge');
    const objects = [{ num: 1, body: '<< /Type /Catalog /Pages 2 0 R /Junk (' + 'x'.repeat(5000) + ') >>' }, PAGES, PAGE];
    const packed = pdfFile({ objects: [], packed: { num: 4, objects }, xref: 'stream' });
    await rejectsPdf(openPdf(packed, { meter: meter(1000) }), 'tooLarge');
    assert.equal(LIMITS.stream, 256 * 1024 ** 2);
  });
});

describe('PDF file: encryption and limits', () => {
  it('recognises an encrypted file: its page tree still opens, its streams and object streams are locked until unlocked', async () => {
    const plain = pdfFile({ objects: [CATALOG, PAGES, PAGE, { num: 4, stream: { data: 'secret' } }, { num: 5, body: '<< /Filter /Standard /V 1 /R 2 >>' }], trailer: '/Encrypt 5 0 R' });
    const file = await openPdf(plain);
    assert.equal(file.encrypted, true);
    assert.equal(pageList(file).length, 1);
    await rejectsPdf(file.decode(/** @type {PdfStream} */ (file.get(4))), 'locked');
    const packed = pdfFile({ objects: [{ num: 5, body: '<< /Filter /Standard /V 4 /R 4 >>' }], packed: { num: 6, objects: [CATALOG, PAGES, PAGE] }, xref: 'stream', trailer: '/Encrypt 5 0 R' });
    const packedFile = await openPdf(packed);
    assert.equal(packedFile.encrypted, true, 'it opens: the password is asked for next (tests/pdf-crypt.test.mjs)');
    assert.throws(() => pageList(packedFile), (error) => error instanceof PdfError && error.code === 'locked');
  });

  it('refuses a cross-reference stream that claims more objects than the limit', async () => {
    const bytes = pdfFile({ objects: [CATALOG, PAGES, PAGE], xref: 'stream' });
    const huge = latin1(String.fromCharCode(...bytes).replace(/\/Index \[[^\]]*\]/, `/Index [0 ${LIMITS.objects + 1}]`));
    // The repair scan then opens it from the objects themselves.
    const file = await openPdf(huge);
    assert.equal(file.repaired, true);
    assert.equal(pageList(file).length, 1);
  });
});

describe('PDF file: damaged input never crashes or hangs', () => {
  it('repairs in linear time: unclosed strings and streams without an end (review P2)', async () => {
    /** @param {'nested' | 'hex' | 'stream'} mode @param {number} n */
    const hostile = (mode, n) => latin1(`%PDF-1.7\n${mode === 'nested' ? `${'1 0 obj ('.repeat(n)}${')'.repeat(n)}` : mode === 'hex' ? '1 0 obj <'.repeat(n) : Array.from({ length: n }, (_, i) => `${i + 1} 0 obj << /Length 999999 >> stream\nxx\nendobj\n`).join('')}\n`);
    for (const mode of /** @type {const} */ (['nested', 'hex', 'stream'])) {
      /** @param {number} n */
      const best = async (n) => {
        const bytes = hostile(mode, n);
        let fastest = Infinity;
        for (let i = 0; i < 3; i += 1) {
          const start = performance.now();
          await openPdf(bytes).catch((error) => assert.ok(error instanceof PdfError, String(error)));
          fastest = Math.min(fastest, performance.now() - start);
        }
        return fastest;
      };
      await best(500);
      // Eight times the input: about 8× the time when linear, 64× when quadratic. A ratio holds on slow machines.
      const ratio = (await best(16_000)) / Math.max(await best(2000), 0.5);
      assert.ok(ratio < 24, `${mode}: 8× the input took ${ratio.toFixed(1)}× as long`);
    }
  });

  it('still finds the objects after an unclosed string when it repairs', async () => {
    const text = `%PDF-1.7\n9 0 obj (never closed\n1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj\n3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 10 10] >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n`;
    const file = await openPdf(latin1(text));
    assert.equal(file.repaired, true);
    assert.equal(pageList(file).length, 1);
  });

  /** A seeded generator, so a failure can be reproduced. @param {number} seed */
  const generator = (seed) => () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  const fixtures = [
    simplePdf(3),
    pdfFile({ objects: [CATALOG, PAGES, PAGE], xref: 'stream', predictor: true }),
    pdfFile({ objects: [], packed: { num: 4, objects: [CATALOG, PAGES, PAGE] }, xref: 'stream' }),
    pdfFile({ base: simplePdf(2), objects: [{ num: 3, body: '<< /Type /Page /Parent 2 0 R >>' }], free: [4], xref: 'stream' }),
    pdfFile({ objects: [CATALOG, PAGES, PAGE, { num: 4, stream: { dict: '/Filter /LZWDecode', data: lzwEncode(latin1('abcabcabc')) } }] }),
  ];

  it('truncated anywhere: opens or throws PdfError', async () => {
    const random = generator(1);
    for (const fixture of fixtures) {
      for (let i = 0; i < 40; i += 1) {
        const cut = fixture.subarray(0, Math.floor(random() * fixture.length));
        try {
          pageList(await openPdf(cut));
        } catch (error) {
          assert.ok(error instanceof PdfError, String(error));
        }
      }
    }
  });

  it('with bytes flipped: opens or throws PdfError', async () => {
    const random = generator(2);
    for (const fixture of fixtures) {
      for (let i = 0; i < 60; i += 1) {
        const copy = Uint8Array.from(fixture);
        for (let k = 0; k < 1 + Math.floor(random() * 8); k += 1) copy[Math.floor(random() * copy.length)] ^= 1 << Math.floor(random() * 8);
        try {
          const file = await openPdf(copy);
          for (const num of file.entries.keys()) {
            const value = file.get(num);
            if (value instanceof PdfStream) await file.decode(value).catch((error) => assert.ok(error instanceof PdfError, String(error)));
          }
          pageList(file);
        } catch (error) {
          assert.ok(error instanceof PdfError, String(error));
        }
      }
    }
  });
});

describe('PDF file: privacy', () => {
  it('uses no network, storage or URL state', () => {
    for (const module of ['pdf-syntax', 'pdf-file', 'pdf-pages']) {
      const source = readFileSync(new URL(`../src/client/${module}.mjs`, import.meta.url), 'utf8');
      for (const word of ['fetch(', 'XMLHttpRequest', 'sendBeacon', 'WebSocket', 'localStorage', 'sessionStorage', 'indexedDB', 'location.', 'history.']) {
        assert.ok(!source.includes(word), `${module}: ${word}`);
      }
    }
  });
});

// @ts-check
/**
 * @file Tests for PDF objects from bytes and back (src/client/pdf-syntax.mjs), against the rules and examples of
 * ISO 32000-1 §7.2–7.3 (docs/research/tool-pdf-toolkit.md §14).
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Lexer, MAX_DEPTH, PdfDict, PdfError, PdfName, PdfRef, PdfStream, PdfString, formatNumber, parseObject, serialise } from '../src/client/pdf-syntax.mjs';
import { latin1 } from './build-files.mjs';

/** @param {string} text */
const read = (text) => parseObject(new Lexer(latin1(text)));
/** @param {import('../src/client/pdf-syntax.mjs').PdfObject} value */
const bytes = (value) => Array.from(/** @type {PdfString} */ (value).bytes);
/** @param {string} text */
const codes = (text) => Array.from(latin1(text));

/** @param {() => unknown} run @param {string} code */
function throwsPdf(run, code) {
  assert.throws(run, (error) => error instanceof PdfError && error.code === code);
}

describe('PDF syntax: objects (§7.3)', () => {
  it('reads every object type', () => {
    assert.equal(read('null'), null);
    assert.equal(read('true'), true);
    assert.equal(read('false'), false);
    assert.equal(read('123'), 123);
    const name = read('/Type');
    assert.ok(name instanceof PdfName && name.value === 'Type');
    assert.deepEqual(bytes(read('(abc)')), codes('abc'));
    assert.deepEqual(bytes(read('<616263>')), codes('abc'));
    const ref = read('12 0 R');
    assert.ok(ref instanceof PdfRef && ref.num === 12 && ref.gen === 0);
    const array = read('[1 2 0 R /N (s) [true]]');
    assert.ok(Array.isArray(array) && array.length === 5 && array[1] instanceof PdfRef && Array.isArray(array[4]));
    const dict = read('<< /A 1 /B << /C /D >> /E [ ] >>');
    assert.ok(dict instanceof PdfDict && dict.size === 3 && dict.get('B') instanceof PdfDict);
  });

  it('reads the numbers of §7.3.3, signs and periods included', () => {
    for (const [text, value] of /** @type {[string, number][]} */ ([['123', 123], ['43445', 43445], ['+17', 17], ['-98', -98], ['0', 0], ['34.5', 34.5], ['-3.62', -3.62], ['+123.6', 123.6], ['4.', 4], ['-.002', -0.002], ['0.0', 0], ['-.5', -0.5], ['+3', 3]])) {
      assert.equal(read(text), value, text);
    }
    throwsPdf(() => read('16#FFFE'), 'damaged');
  });

  it('reads two integers before R as a reference, and leaves "1 2" alone', () => {
    const items = /** @type {import('../src/client/pdf-syntax.mjs').PdfObject[]} */ (read('[1 2 3 0 R 4]'));
    assert.equal(items.length, 4);
    assert.deepEqual([items[0], items[1], items[3]], [1, 2, 4]);
    assert.ok(items[2] instanceof PdfRef && items[2].num === 3);
    assert.deepEqual(read('[-1 0 R]'), [-1, 0], 'no reference with a sign');
  });

  it('decodes #xx in names (§7.3.5), and keeps a "#" not followed by two hex digits', () => {
    assert.equal(/** @type {PdfName} */ (read('/A#20B')).value, 'A B');
    assert.equal(/** @type {PdfName} */ (read('/#4A#53')).value, 'JS');
    assert.equal(/** @type {PdfName} */ (read('/Java#53cript')).value, 'JavaScript');
    assert.equal(/** @type {PdfName} */ (read('/paired#28#29parentheses')).value, 'paired()parentheses');
    assert.equal(/** @type {PdfName} */ (read('/A#zz')).value, 'A#zz');
    assert.equal(/** @type {PdfName} */ (read('/')).value, '', 'the empty name');
  });

  it('reads literal strings: nested parentheses, the escapes of Table 3, octal codes, line continuations', () => {
    assert.deepEqual(bytes(read('(Strings may contain balanced parentheses ( ) and special characters ( * ! & } ^ % and so on ) .)')), codes('Strings may contain balanced parentheses ( ) and special characters ( * ! & } ^ % and so on ) .'));
    assert.deepEqual(bytes(read('()')), []);
    assert.deepEqual(bytes(read(String.raw`(\n\r\t\b\f\(\)\\)`)), [10, 13, 9, 8, 12, 40, 41, 92]);
    assert.deepEqual(bytes(read(String.raw`(\0053)`)), [5, 0x33], '\\005 then the digit 3 (§7.3.4.2 EXAMPLE 5)');
    assert.deepEqual(bytes(read(String.raw`(\053)`)), [0x2b]);
    assert.deepEqual(bytes(read(String.raw`(\53)`)), [0x2b]);
    assert.deepEqual(bytes(read(String.raw`(\5)`)), [5]);
    assert.deepEqual(bytes(read(String.raw`(\777)`)), [0xff], 'high-order overflow ignored');
    assert.deepEqual(bytes(read(String.raw`(\q)`)), codes('q'), 'an unknown escape drops the backslash');
    assert.deepEqual(bytes(read('(These \\\ntwo strings \\\r\nare the same.)')), codes('These two strings are the same.'));
    assert.deepEqual(bytes(read('(a\rb\r\nc\nd)')), codes('a\nb\nc\nd'), 'every line end reads as LF');
    throwsPdf(() => read('(not closed'), 'damaged');
  });

  it('reads hex strings: white space ignored, an odd last digit padded with 0 (§7.3.4.3 EXAMPLE 2)', () => {
    assert.deepEqual(bytes(read('<901FA3>')), [0x90, 0x1f, 0xa3]);
    assert.deepEqual(bytes(read('<901FA>')), [0x90, 0x1f, 0xa0]);
    assert.deepEqual(bytes(read('< 4E 6f\n76 >')), codes('Nov'));
    assert.ok(/** @type {PdfString} */ (read('<00>')).hex);
    throwsPdf(() => read('<4E6F'), 'damaged');
  });

  it('treats a comment as white space (§7.2.3 EXAMPLE)', () => {
    const lexer = new Lexer(latin1('abc% comment ( /% ) blah blah blah\n123'));
    assert.deepEqual([lexer.next().value, lexer.next().value, lexer.next().type], ['abc', 123, 'eof']);
    assert.deepEqual(read('[1 % two\n 3]'), [1, 3]);
  });

  it('keeps the last value of a repeated key and drops a key with no value', () => {
    const dict = /** @type {PdfDict} */ (read('<< /A 1 /A 2 /B >>'));
    assert.equal(dict.get('A'), 2);
    assert.equal(dict.has('B'), false);
  });

  it('skips what PDF.js skips in a broken dictionary, but not a keyword of the file structure', () => {
    const dict = /** @type {PdfDict} */ (read('<< /X 1 0 R 0 R /Pages 2 0 R /Bad junk /Type /Catalog >>'));
    assert.deepEqual([...dict.keys()], ['X', 'Pages', 'Type'], 'qpdf corpus: indirect-r-arg.pdf');
    assert.deepEqual(read('[1 junk 2]'), [1, 2]);
    throwsPdf(() => read('<< /A 1 endobj'), 'damaged');
    throwsPdf(() => read('[1 2 stream'), 'damaged');
    throwsPdf(() => read('<< /A 1'), 'damaged');
  });

  it(`refuses nesting deeper than ${MAX_DEPTH} without overflowing the stack`, () => {
    assert.ok(Array.isArray(read(`${'['.repeat(MAX_DEPTH)}${']'.repeat(MAX_DEPTH)}`)));
    throwsPdf(() => read('['.repeat(100_000)), 'tooLarge');
    throwsPdf(() => read('<</A '.repeat(5_000)), 'tooLarge');
  });
});

describe('PDF syntax: writing', () => {
  it('writes numbers without exponents, in their shortest exact form', () => {
    assert.equal(formatNumber(0.1), '0.1');
    assert.equal(formatNumber(612), '612');
    assert.equal(formatNumber(-0), '0');
    assert.equal(formatNumber(1e-7), '0.0000001');
    assert.equal(formatNumber(1e21), '1000000000000000000000');
    assert.equal(formatNumber(1.5e-9), '0.0000000015');
    assert.throws(() => formatNumber(Number.NaN), PdfError);
  });

  it('reads back exactly what it writes, every byte of names and strings included', () => {
    const all = Uint8Array.from({ length: 256 }, (_, i) => i);
    const value = new PdfDict([
      ['Type', new PdfName('Page')],
      ['Name with #, space and é', new PdfName('A B#()ÿ')],
      ['Literal', new PdfString(all)],
      ['Hex', new PdfString(all, true)],
      ['Numbers', [0, -1, 2.5, -0.002, 1e-7, 123456789]],
      ['Refs', [new PdfRef(1, 0), new PdfRef(65535, 2)]],
      ['Nested', [[[]], new PdfDict(), new PdfDict([['K', null]])]],
      ['Flags', [true, false, null]],
      ['Empty', new PdfString(new Uint8Array(0))],
    ]);
    const text = serialise(value);
    const back = parseObject(new Lexer(latin1(text)));
    assert.equal(serialise(back), text);
    const dict = /** @type {PdfDict} */ (back);
    assert.deepEqual([...dict.keys()], [...value.keys()]);
    assert.deepEqual(Array.from(/** @type {PdfString} */ (dict.get('Literal')).bytes), Array.from(all));
    assert.deepEqual(Array.from(/** @type {PdfString} */ (dict.get('Hex')).bytes), Array.from(all));
    assert.equal(/** @type {PdfName} */ (/** @type {PdfDict} */ (back).get('Name with #, space and é') ?? new PdfName('')).value, 'A B#()ÿ');
    assert.deepEqual(dict.get('Numbers'), [0, -1, 2.5, -0.002, 1e-7, 123456789]);
  });

  it('escapes CR in literal strings, since a raw CR would read back as LF', () => {
    const text = serialise(new PdfString(Uint8Array.of(13, 10, 0x28)));
    assert.ok(!text.includes('\r'));
    assert.deepEqual(bytes(read(text)), [13, 10, 0x28]);
  });

  it('writes no stream inside another object', () => {
    assert.throws(() => serialise([new PdfStream(new PdfDict(), new Uint8Array(0))]), PdfError);
  });
});

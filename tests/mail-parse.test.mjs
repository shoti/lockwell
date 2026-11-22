// @ts-check
/**
 * @file Tests for reading email headers: the header block, unfolding, encoded words, addresses, dates, parameters,
 * and hostile input. Fixtures are the RFCs' own examples (tests/mail-fixtures.mjs).
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  MAX_FIELDS, MAX_FIELD_LENGTH, MAX_TEXT, STEPS, decodeWords, fieldsNamed, parseAddresses, parseDate, parseMessageIds, parseParams, splitMessage, tokenize,
} from '../src/client/mail-parse.mjs';
import {
  ALL_MESSAGES, MICROSOFT_ARRIVAL, RFC2047_COMMENT, RFC2047_HEADERS, RFC2047_TABLE, RFC5322_A11, RFC5322_A12, RFC5322_A13, RFC5322_A4, RFC5322_A5, RFC5322_A61,
  RFC5322_A62, RFC5322_A63, RFC8601_B1,
} from './mail-fixtures.mjs';

/** @param {string} text */
const fields = (text) => splitMessage(text).fields;
/** @param {string} text @param {string} key */
const value = (text, key) => fieldsNamed(fields(text), key)[0]?.value;

/**
 * Runs a reader and returns how many steps it took per character of input.
 * @param {() => unknown} run
 * @param {number} length
 */
function stepsPerChar(run, length) {
  STEPS.count = 0;
  run();
  return STEPS.count / length;
}

describe('splitMessage', () => {
  it('reads the fields of RFC 5322 A.1.1 in order and keeps the body', () => {
    const message = splitMessage(RFC5322_A11);
    assert.deepEqual(message.fields.map((field) => field.name), ['From', 'To', 'Subject', 'Date', 'Message-ID']);
    assert.equal(message.fields[0].value, 'John Doe <jdoe@machine.example>');
    assert.equal(message.fields[0].key, 'from');
    assert.equal(message.hasBody, true);
    assert.equal(message.body, 'This is a message just to say hello.\nSo, "Hello".\n');
    assert.deepEqual(message.unparsed, []);
  });

  it('reads CRLF, CR and LF line ends the same way', () => {
    const lf = splitMessage(RFC5322_A4).fields;
    assert.deepEqual(splitMessage(RFC5322_A4.replace(/\n/g, '\r\n')).fields, lf);
    assert.deepEqual(splitMessage(RFC5322_A4.replace(/\n/g, '\r')).fields, lf);
  });

  it('unfolds folded fields (RFC 5322 A.4) and keeps the folding white space', () => {
    const received = fieldsNamed(fields(RFC5322_A4), 'received');
    assert.equal(received.length, 2);
    assert.equal(received[0].value, 'from x.y.test   by example.net   via TCP   with ESMTP   id ABC12345   for <mary@example.net>;  21 Nov 1997 10:05:43 -0600');
  });

  it('reads the obsolete forms of A.6.3: white space before the colon, a fold of only white space', () => {
    const message = splitMessage(RFC5322_A63);
    assert.deepEqual(message.fields.map((field) => field.key), ['from', 'to', 'subject', 'date', 'message-id']);
    assert.equal(message.fields[1].value, 'Mary Smith          <mary@example.net>');
  });

  it('keeps lines inside the header block that are not fields, without dropping them silently', () => {
    const message = splitMessage('Received: from a by b; 21 Nov 1997 10:05:43 -0600\nthis is not a field\nFrom: a@example.com\n');
    assert.deepEqual(message.unparsed, ['this is not a field']);
    assert.deepEqual(message.fields.map((field) => field.key), ['received', 'from']);
  });

  it('keeps repeated fields, each with its position', () => {
    const message = splitMessage('From: a@example.com\nFrom: b@example.org\nSubject: x\n');
    assert.deepEqual(fieldsNamed(message.fields, 'from').map((field) => [field.value, field.index]), [['a@example.com', 0], ['b@example.org', 1]]);
  });

  it('removes a byte order mark, an mbox "From " line, ">" quoting and a common indent', () => {
    const quoted = RFC5322_A4.split('\n').map((line) => (line ? `> ${line}` : '>')).join('\n');
    const indented = RFC5322_A4.split('\n').map((line) => (line ? `    ${line}` : '')).join('\n');
    const mbox = `﻿From jdoe@node.example Fri Nov 21 09:55:06 1997\n${RFC5322_A4}`;
    const expected = fields(RFC5322_A4);
    assert.deepEqual(splitMessage(quoted).fields, expected);
    assert.equal(splitMessage(quoted).cleaned.quoted, true);
    assert.deepEqual(splitMessage(indented).fields, expected);
    assert.equal(splitMessage(indented).cleaned.indented, true);
    assert.deepEqual(splitMessage(mbox).fields, expected);
    assert.equal(splitMessage(mbox).cleaned.mbox, true);
  });

  it('skips a summary a mail program shows above the source, starting at the trace fields', () => {
    const pasted = `Original message\nMessage ID\t<12345.abc@example.com>\nCreated at:\tFri, Feb 15 2002\nFrom:\tsender@example.com\nSPF:\tPASS\nDownload Original\tCopy to clipboard\n${RFC8601_B1}`;
    const message = splitMessage(pasted);
    assert.deepEqual(message.fields, fields(RFC8601_B1));
    assert.equal(message.cleaned.before, 6);
    assert.equal(fieldsNamed(message.fields, 'from').length, 1);
  });

  it('finds headers pasted without trace fields', () => {
    assert.deepEqual(fields(`Some words first\n\n${RFC5322_A11}`).map((field) => field.key), ['from', 'to', 'subject', 'date', 'message-id']);
  });

  it('returns no fields for text that has no header block', () => {
    assert.deepEqual(splitMessage('Hello, how are you?\nSee you: tomorrow at noon').fields, []);
    assert.deepEqual(splitMessage('').fields, []);
  });

  it('stops at its limits: too many fields, a field too long, text too large', () => {
    const many = Array.from({ length: MAX_FIELDS + 5 }, (_, i) => `X-Field-${i}: ${i}`).join('\n');
    const message = splitMessage(`Received: from a by b; 21 Nov 1997 10:05:43 -0600\n${many}\n`);
    assert.equal(message.fields.length, MAX_FIELDS);
    assert.equal(message.notRead, 6);
    const long = splitMessage(`Subject: ${'a'.repeat(MAX_FIELD_LENGTH)}\n ${'b'.repeat(1000)}\nFrom: a@example.com\n`);
    assert.equal(long.fields[0].cut, true);
    assert.ok(long.fields[0].value.length <= MAX_FIELD_LENGTH);
    assert.equal(long.fields[1].key, 'from');
    assert.equal(splitMessage('x'.repeat(MAX_TEXT + 1)).tooLarge, true);
  });
});

describe('decodeWords (RFC 2047)', () => {
  it('decodes the header fields of RFC 2047 §8', () => {
    const message = fields(RFC2047_HEADERS);
    assert.deepEqual(message.map((field) => decodeWords(field.value).text), [
      'Keith Moore <moore@cs.utk.edu>',
      'Keld Jørn Simonsen <keld@dkuug.dk>',
      'André Pirard <PIRARD@vm1.ulg.ac.be>',
      'If you can read this you understand the example.',
    ]);
  });

  it('follows the "displayed as" table of RFC 2047 §8', () => {
    for (const [encoded, shown] of RFC2047_TABLE) assert.equal(decodeWords(encoded).text, shown, encoded);
  });

  it('decodes UTF-8, Georgian, windows-1251 and ISO-8859-8 words', () => {
    const georgian = 'გამარჯობა';
    assert.equal(decodeWords(`=?UTF-8?B?${Buffer.from(georgian).toString('base64')}?=`).text, georgian);
    assert.equal(decodeWords('=?utf-8?q?=E1=83=92=E1=83=90?=').text, 'გა');
    assert.equal(decodeWords('=?windows-1251?Q?=CF=F0=E8=E2=E5=F2?=').text, 'Привет');
    assert.match(decodeWords('=?iso-8859-8?b?7eXs+SDv4SDp7Oj08A==?=').text, /^[\u05d0-\u05ea ]+$/);
  });

  it('reads a language after the character set (RFC 2231 §5)', () => {
    assert.equal(decodeWords('=?US-ASCII*EN?Q?Keith_Moore?=').text, 'Keith Moore');
  });

  it('leaves an unknown character set or a broken word as written, and says so', () => {
    assert.deepEqual(decodeWords('=?x-unknown?Q?abc?= tail'), { text: '=?x-unknown?Q?abc?= tail', broken: true });
    assert.deepEqual(decodeWords('=?utf-8?B?!!!?='), { text: '=?utf-8?B?!!!?=', broken: true });
    assert.deepEqual(decodeWords('=?utf-8?X?abc?= =?utf-8?Q?a b?='), { text: '=?utf-8?X?abc?= =?utf-8?Q?a b?=', broken: false });
  });

  it('keeps raw UTF-8 text as it is (RFC 6532)', () => {
    assert.deepEqual(decodeWords('ბანკი <info@example.com>'), { text: 'ბანკი <info@example.com>', broken: false });
  });
});

describe('parseAddresses', () => {
  /** @param {string} text */
  const brief = (text) => parseAddresses(text).map(({ name, address, group, bad }) => ({ name, address, group, bad }));

  it('reads the mailbox forms of RFC 5322 A.1.2', () => {
    assert.deepEqual(brief(/** @type {string} */ (value(RFC5322_A12, 'to'))), [
      { name: 'Mary Smith', address: 'mary@x.test', group: '', bad: false },
      { name: '', address: 'jdoe@example.org', group: '', bad: false },
      { name: 'Who?', address: 'one@y.test', group: '', bad: false },
    ]);
    assert.deepEqual(brief(/** @type {string} */ (value(RFC5322_A12, 'cc'))), [
      { name: '', address: 'boss@nil.test', group: '', bad: false },
      { name: 'Giant; "Big" Box', address: 'sysservices@example.net', group: '', bad: false },
    ]);
    assert.deepEqual(brief(/** @type {string} */ (value(RFC5322_A12, 'from'))), [{ name: 'Joe Q. Public', address: 'john.q.public@example.com', group: '', bad: false }]);
  });

  it('reads groups and empty groups (A.1.3)', () => {
    assert.deepEqual(brief(/** @type {string} */ (value(RFC5322_A13, 'to'))), [
      { name: 'Ed Jones', address: 'c@a.test', group: 'A Group', bad: false },
      { name: '', address: 'joe@where.test', group: 'A Group', bad: false },
      { name: 'John', address: 'jdoe@one.test', group: 'A Group', bad: false },
    ]);
    assert.deepEqual(brief(/** @type {string} */ (value(RFC5322_A13, 'cc'))), []);
  });

  it('reads comments and folding everywhere (A.5)', () => {
    assert.deepEqual(brief(/** @type {string} */ (value(RFC5322_A5, 'from'))), [{ name: 'Pete', address: 'pete@silly.test', group: '', bad: false }]);
    assert.deepEqual(brief(/** @type {string} */ (value(RFC5322_A5, 'to'))), [
      { name: 'Chris Jones', address: 'c@public.example', group: 'A Group', bad: false },
      { name: '', address: 'joe@example.org', group: 'A Group', bad: false },
      { name: 'John', address: 'jdoe@one.test', group: 'A Group', bad: false },
    ]);
    assert.deepEqual(brief(/** @type {string} */ (value(RFC5322_A5, 'cc'))), []);
  });

  it('reads obsolete addressing: routes, empty items, spaces around dots (A.6.1, A.6.3)', () => {
    assert.deepEqual(brief(/** @type {string} */ (value(RFC5322_A61, 'to'))), [
      { name: 'Mary Smith', address: 'mary@example.net', group: '', bad: false },
      { name: '', address: 'jdoe@test.example', group: '', bad: false },
    ]);
    assert.deepEqual(brief(/** @type {string} */ (value(RFC5322_A61, 'from'))), [{ name: 'Joe Q. Public', address: 'john.q.public@example.com', group: '', bad: false }]);
    assert.deepEqual(brief(/** @type {string} */ (value(RFC5322_A63, 'from'))), [{ name: 'John Doe', address: 'jdoe@machine.example', group: '', bad: false }]);
  });

  it('decodes encoded names, and takes the name from a comment in the old form', () => {
    assert.deepEqual(brief(/** @type {string} */ (value(RFC2047_HEADERS, 'cc'))), [{ name: 'André Pirard', address: 'PIRARD@vm1.ulg.ac.be', group: '', bad: false }]);
    assert.deepEqual(brief('jdoe@example.org (=?ISO-8859-1?Q?Andr=E9?=)'), [{ name: 'André', address: 'jdoe@example.org', group: '', bad: false }]);
    assert.equal(parseAddresses(/** @type {string} */ (value(RFC2047_COMMENT, 'to'))).length, 3);
  });

  it('keeps commas inside quotes and nested comments, and splits several addresses', () => {
    assert.deepEqual(brief('"Doe, John" <j@example.com>, (a (nested, comment)) k@example.org'), [
      { name: 'Doe, John', address: 'j@example.com', group: '', bad: false },
      { name: '', address: 'k@example.org', group: '', bad: false },
    ]);
  });

  it('marks what is not an address as bad and keeps it as written, never guessing', () => {
    assert.deepEqual(parseAddresses('not an address').map(({ raw, bad, address }) => ({ raw, bad, address })), [{ raw: 'not an address', bad: true, address: '' }]);
    assert.equal(parseAddresses('Name <a@example.com').at(0)?.bad, true, 'an angle address that never closes');
    assert.equal(parseAddresses('a@.example.com').at(0)?.bad, true);
    assert.equal(parseAddresses('@example.com').at(0)?.bad, true);
  });

  it('keeps the raw text of each item', () => {
    assert.deepEqual(parseAddresses('"Bank" <x@example.com>, y@example.org').map((item) => item.raw), ['"Bank" <x@example.com>', 'y@example.org']);
  });
});

describe('parseMessageIds', () => {
  it('reads identifiers with comments and spaces (A.6.3) and several in References', () => {
    assert.deepEqual(parseMessageIds(/** @type {string} */ (value(RFC5322_A63, 'message-id'))), [{ id: '1234@local.machine.example', domain: 'local.machine.example' }]);
    assert.deepEqual(parseMessageIds('<1234@local.machine.example> <3456@example.net>').map((id) => id.domain), ['local.machine.example', 'example.net']);
    assert.deepEqual(parseMessageIds('no brackets'), []);
  });
});

describe('parseDate', () => {
  it('reads the RFC 5322 form with its zone', () => {
    assert.equal(parseDate('Fri, 21 Nov 1997 09:55:06 -0600'), Date.UTC(1997, 10, 21, 15, 55, 6));
    assert.equal(parseDate('Thu, 13 Feb 1969 23:32:54 -0330'), Date.UTC(1969, 1, 14, 3, 2, 54));
  });

  it('reads obsolete dates: two-digit years and zone names (A.6.2), comments and spacing (A.5, A.6.3)', () => {
    assert.equal(parseDate(/** @type {string} */ (value(RFC5322_A62, 'date'))), Date.UTC(1997, 10, 21, 9, 55, 6));
    assert.equal(parseDate('21 Nov 49 09:55:06 GMT'), Date.UTC(2049, 10, 21, 9, 55, 6));
    assert.equal(parseDate('21 Nov 197 09:55:06 GMT'), Date.UTC(2097, 10, 21, 9, 55, 6));
    assert.equal(parseDate(/** @type {string} */ (value(RFC5322_A5, 'date'))), Date.UTC(1969, 1, 14, 3, 2, 0));
    assert.equal(parseDate(/** @type {string} */ (value(RFC5322_A63, 'date'))), Date.UTC(1997, 10, 21, 15, 55, 6));
    assert.equal(parseDate('Fri, 21 Nov 1997 09:55:06 PST'), Date.UTC(1997, 10, 21, 17, 55, 6));
  });

  it('counts military and unknown zone letters, and a missing zone, as UTC', () => {
    assert.equal(parseDate('21 Nov 1997 09:55:06 Q'), Date.UTC(1997, 10, 21, 9, 55, 6));
    assert.equal(parseDate('21 Nov 1997 09:55:06 XYZ'), Date.UTC(1997, 10, 21, 9, 55, 6));
    assert.equal(parseDate('21 Nov 1997 09:55'), Date.UTC(1997, 10, 21, 9, 55, 0));
  });

  it('reads the orders real servers write: month first (RFC 8601 examples), fractions of a second (Microsoft)', () => {
    assert.equal(parseDate('Fri, Feb 15 2002 17:19:07 -0800'), Date.UTC(2002, 1, 16, 1, 19, 7));
    assert.equal(parseDate(MICROSOFT_ARRIVAL), Date.UTC(2017, 11, 12, 21, 38, 50));
    assert.equal(parseDate('Thu, 14 Jan 2015 15:02:40 -0800 (PST)'), Date.UTC(2015, 0, 14, 23, 2, 40));
  });

  it('returns null for what is not a date', () => {
    for (const text of ['', 'tomorrow', '32 Nov 1997 09:55:06 +0000', '30 Feb 2001 10:00:00 +0000', '21 Nov 1997 25:00:00 +0000', '21 Nov 1997 09:55:06 +0099', '21 Foo 1997 09:55:06 +0000', '21 Nov 7 09:55:06 +0000']) {
      assert.equal(parseDate(text), null, text);
    }
  });
});

describe('parseParams (RFC 2045, RFC 2231)', () => {
  it('reads the value and plain parameters', () => {
    assert.deepEqual(parseParams('text/plain; charset=ISO-8859-1'), { value: 'text/plain', params: { charset: 'ISO-8859-1' } });
    assert.deepEqual(parseParams('attachment; filename="a; b.pdf" (comment)'), { value: 'attachment', params: { filename: 'a; b.pdf' } });
  });

  it('joins continuations, quoted and not (RFC 2231 §3)', () => {
    const { params } = parseParams('message/external-body; access-type=URL;\n URL*0="ftp://";\n URL*1="cs.utk.edu/pub/moore/bulk-mailer/bulk-mailer.tar"');
    assert.equal(params.url, 'ftp://cs.utk.edu/pub/moore/bulk-mailer/bulk-mailer.tar');
    assert.equal(params['access-type'], 'URL');
  });

  it('decodes character sets and languages, alone and with continuations (RFC 2231 §4, §4.1)', () => {
    assert.equal(parseParams("application/x-stuff;\n title*=us-ascii'en-us'This%20is%20%2A%2A%2Afun%2A%2A%2A").params.title, 'This is ***fun***');
    // The RFC prints this example without the semicolons between parameters; they are added here.
    const joined = parseParams("application/x-stuff;\n title*0*=us-ascii'en'This%20is%20even%20more%20;\n title*1*=%2A%2A%2Afun%2A%2A%2A%20;\n title*2=\"isn't it!\"");
    assert.equal(joined.params.title, "This is even more ***fun*** isn't it!");
    assert.equal(parseParams("attachment; filename*=utf-8''%E1%83%A1%E1%83%90.pdf").params.filename, 'სა.pdf');
  });

  it('decodes encoded words in a plain parameter, as many programs write file names', () => {
    assert.equal(parseParams(`attachment; filename="=?UTF-8?B?${Buffer.from('Счет.pdf').toString('base64')}?="`).params.filename, 'Счет.pdf');
  });

  it('keeps an unquoted value that contains "=" (boundaries)', () => {
    assert.equal(parseParams('multipart/mixed; boundary=----=_Part_1').params.boundary, '----=_Part_1');
  });
});

describe('hostile input', () => {
  const MAX_STEPS_PER_CHAR = 12;

  it('reads 2 MB of one unterminated quoted string in linear time', () => {
    const text = `"${'a'.repeat(MAX_TEXT - 10)}`;
    assert.ok(stepsPerChar(() => parseAddresses(text), text.length) < MAX_STEPS_PER_CHAR);
    assert.equal(parseAddresses(text).length, 1);
  });

  it('reads 100,000 nested comment openers in linear time', () => {
    const text = `a@example.com ${'('.repeat(100_000)}`;
    assert.ok(stepsPerChar(() => parseAddresses(text), text.length) < MAX_STEPS_PER_CHAR);
    assert.ok(stepsPerChar(() => tokenize(text, ';'), text.length) < MAX_STEPS_PER_CHAR);
  });

  it('reads 100,000 "=?" fragments and half-open encoded words in linear time', () => {
    for (const text of ['=?'.repeat(100_000), '=?a?B?'.repeat(50_000), `=?utf-8?Q?${'x'.repeat(100_000)}`, '=?utf-8?Q?a?= '.repeat(20_000)]) {
      assert.ok(stepsPerChar(() => decodeWords(text), text.length) < MAX_STEPS_PER_CHAR, text.slice(0, 12));
    }
  });

  it('reads many fields, long lines and endless folding in linear time', () => {
    const text = `Received: x\n${' y\n'.repeat(200_000)}${'Z: 1\n'.repeat(100_000)}`;
    assert.ok(stepsPerChar(() => splitMessage(text), text.length) < MAX_STEPS_PER_CHAR);
  });

  it('reads long parameter lists and dates in linear time', () => {
    const params = `attachment; ${'a*1=b; '.repeat(50_000)}`;
    assert.ok(stepsPerChar(() => parseParams(params), params.length) < MAX_STEPS_PER_CHAR);
    const date = `${'1 '.repeat(100_000)}:`;
    assert.ok(stepsPerChar(() => parseDate(date), date.length) < MAX_STEPS_PER_CHAR);
  });

  it('never throws on any fixture cut at every 37th character', () => {
    for (const message of ALL_MESSAGES) {
      for (let cut = 0; cut < message.length; cut += 37) {
        const part = message.slice(0, cut);
        const read = splitMessage(part);
        for (const field of read.fields) {
          decodeWords(field.value);
          parseAddresses(field.value);
          parseDate(field.value);
          parseParams(field.value);
          parseMessageIds(field.value);
        }
      }
    }
  });
});

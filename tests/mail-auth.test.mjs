// @ts-check
/**
 * @file Tests for reading the fields mail servers add (Authentication-Results, Received-SPF, DKIM, ARC, Received,
 * spam filters' fields) and for IP address classes. Fixtures are the RFCs' examples and Microsoft's printed lines.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { INTERNAL, ipClass, parseIp } from '../src/client/ip.mjs';
import {
  parseArcResults, parseArcSets, parseAuthResults, parseDkimSignature, parsePairs, parseReceived, parseReceivedSpf, parseSpamStatus, parseTagList,
} from '../src/client/mail-auth.mjs';
import { STEPS, fieldsNamed, splitMessage } from '../src/client/mail-parse.mjs';
import {
  ALL_MESSAGES, MICROSOFT_ARC_RESULTS, MICROSOFT_AUTH, MICROSOFT_RECEIVED, RFC5322_A4, RFC7208_AUTH_EXPANDED, RFC7208_SPF, RFC8601_B2, RFC8601_B4, RFC8601_B5,
  RFC8601_B6, RFC8601_B7, RFC8617_B,
} from './mail-fixtures.mjs';

/** @param {string} message @param {string} key */
const valuesOf = (message, key) => fieldsNamed(splitMessage(message).fields, key).map((field) => field.value);

/**
 * The results of one field in a compact form: "method=result" with props.
 * @param {import('../src/client/mail-auth.mjs').AuthResults} read
 */
const brief = (read) => read.results.map((result) => [`${result.method}=${result.result}`, ...result.props.map((prop) => `${prop.ptype ? `${prop.ptype}.` : ''}${prop.property}=${prop.value}`)].join(' '));

describe('parseAuthResults (RFC 8601)', () => {
  it('reads "none" and the version (B.2)', () => {
    const [value] = valuesOf(RFC8601_B2, 'authentication-results');
    assert.deepEqual(parseAuthResults(value), { authservId: 'example.org', version: '1', none: true, results: [], unparsed: [] });
  });

  it('reads several results with comments and properties (B.4)', () => {
    const [first, second] = valuesOf(RFC8601_B4, 'authentication-results').map(parseAuthResults);
    assert.equal(first.authservId, 'example.com');
    assert.deepEqual(brief(first), ['auth=pass smtp.auth=sender@example.net', 'spf=pass smtp.mailfrom=example.net']);
    assert.deepEqual(first.results[0].comments, ['cram-md5']);
    assert.deepEqual(brief(second), ['iprev=pass policy.iprev=192.0.2.200']);
  });

  it('reads both fields of B.5 and the quoted reasons of B.6', () => {
    assert.deepEqual(valuesOf(RFC8601_B5, 'authentication-results').map((value) => brief(parseAuthResults(value))), [
      ['dkim=pass header.d=example.com'],
      ['auth=pass smtp.auth=sender@example.com', 'spf=fail smtp.mailfrom=example.com'],
    ]);
    const [top, lower] = valuesOf(RFC8601_B6, 'authentication-results').map(parseAuthResults);
    assert.deepEqual(top.results.map((result) => [result.result, result.reason, result.props[0].value]), [['pass', 'good signature', '@mail-router.example.net'], ['fail', 'bad signature', '@newyork.example.com']]);
    assert.equal(lower.authservId, 'example.net');
  });

  it('reads the comment-heavy example (B.7)', () => {
    const read = parseAuthResults(RFC8601_B7);
    assert.equal(read.authservId, 'foo.example.net');
    assert.equal(read.version, '1');
    assert.deepEqual(read.results.map(({ method, version, result, props }) => ({ method, version, result, props })), [
      { method: 'dkim', version: '1', result: 'fail', props: [{ ptype: 'policy', property: 'expired', value: '1362471462' }] },
    ]);
    assert.deepEqual(read.results[0].comments, ['Because I like it', 'One yay', 'wait for it', 'A dot can go here', 'like that', 'this surprised me', "as I wasn't expecting it"]);
  });

  it('keeps a semicolon inside a quoted reason (RFC 7208 §9.2)', () => {
    const read = parseAuthResults(RFC7208_AUTH_EXPANDED);
    assert.deepEqual(read.results.map((result) => [result.method, result.result, result.reason]), [['spf', 'pass', 'client-ip=192.0.2.1; smtp.helo=foo.example.com']]);
    assert.deepEqual(brief(read), ['spf=pass smtp.mailfrom=user@example.net']);
  });

  it("reads Microsoft's form: no authserv-id, bare names between results, no space after a semicolon", () => {
    const alignment = parseAuthResults(MICROSOFT_AUTH.alignment);
    assert.equal(alignment.authservId, '');
    assert.deepEqual(brief(alignment), [
      'spf=pass smtp.mailfrom=bounces.adatum.com',
      'dkim=pass header.d=adatum.com',
      'dmarc=fail action=oreject header.from=contoso.com',
      'compauth=fail',
    ]);
    assert.equal(alignment.results[3].reason, '000');
    assert.deepEqual(alignment.results[0].comments, ['sender IP is 198.51.100.10']);
    const spoof = parseAuthResults(MICROSOFT_AUTH.spoof);
    assert.equal(spoof.authservId, '');
    assert.deepEqual(spoof.unparsed, ['contoso.com', 'contoso.com']);
    assert.deepEqual(spoof.results.map((result) => `${result.method}=${result.result}`), ['spf=none', 'dkim=pass', 'dmarc=none', 'compauth=fail']);
    assert.deepEqual(brief(parseAuthResults(MICROSOFT_AUTH.bestGuess)).slice(2), ['dmarc=bestguesspass action=none header.from=fabrikam.com', 'compauth=pass']);
    assert.equal(parseAuthResults(MICROSOFT_AUTH.arcOverride).results[3].reason, '130');
  });

  it('keeps unknown methods and results as written, and parts it cannot read', () => {
    const read = parseAuthResults('mx.example.org; x-custom=maybe (a note) x.y=z; spf=hardfail smtp.mailfrom=example.com; ; =broken; justaword');
    assert.deepEqual(brief(read), ['x-custom=maybe x.y=z', 'spf=hardfail smtp.mailfrom=example.com']);
    assert.deepEqual(read.unparsed, ['=broken', 'justaword']);
  });

  it('keeps a value glued to "/" and "=" (signature parts)', () => {
    assert.deepEqual(brief(parseAuthResults('mx.example.org; dkim=pass header.d=example.com header.b=Ab/c+d=')), ['dkim=pass header.d=example.com header.b=Ab/c+d=']);
  });

  it('reads an empty or garbage value without throwing', () => {
    assert.deepEqual(parseAuthResults(''), { authservId: '', version: '', none: false, results: [], unparsed: [] });
    assert.equal(parseAuthResults('((((').results.length, 0);
  });
});

describe('parseReceivedSpf (RFC 7208 §9.1)', () => {
  it('reads the result, the comment and the pairs of the three examples', () => {
    const [pass, fail, mechanism] = RFC7208_SPF.map(parseReceivedSpf);
    assert.equal(pass.result, 'pass');
    assert.match(pass.comment, /^mybox\.example\.org: domain of\s+myname@example\.com designates 192\.0\.2\.1 as permitted sender$/);
    assert.deepEqual(pass.pairs, { receiver: 'mybox.example.org', 'client-ip': '192.0.2.1', 'envelope-from': 'myname@example.com', helo: 'foo.example.com' });
    assert.equal(fail.result, 'fail');
    assert.deepEqual(fail.pairs, { identity: 'mailfrom', 'client-ip': '192.0.2.1', 'envelope-from': 'myname@example.com' });
    assert.equal(mechanism.pairs.mechanism, 'ip4:192.0.2.1');
  });

  it('reads garbage without throwing', () => {
    assert.deepEqual(parseReceivedSpf(''), { result: '', comment: '', pairs: {} });
    assert.deepEqual(parseReceivedSpf('= = ; ;').pairs, {});
  });
});

describe('DKIM tag lists (RFC 6376 §3.2, §3.5)', () => {
  it('reads the signature of RFC 8601 B.5', () => {
    const [value] = valuesOf(RFC8601_B5, 'dkim-signature');
    const signature = parseDkimSignature(value);
    assert.equal(signature.domain, 'example.com');
    assert.equal(signature.selector, 'gatsby');
    assert.equal(signature.algorithm, 'rsa-sha256');
    assert.equal(signature.signedAt, 1188964191000);
    assert.equal(signature.length, null);
    assert.deepEqual(signature.headers, ['from', 'date', 'to', 'subject', 'message-id', 'authentication-results']);
    assert.equal(signature.tags.b, 'EToRSuvUfQVP3Bkz...rTB0t0gYnBVCM=');
  });

  it('reads l=, x= and a repeated tag', () => {
    const signature = parseDkimSignature('v=1; a=RSA-SHA1; d=Example.COM; s=s1; l=200; t=100; x=200; h=from; bh=x; b=y; d=other.example');
    assert.equal(signature.length, 200);
    assert.equal(signature.expires, 200_000);
    assert.equal(signature.domain, 'example.com', 'the first of a repeated tag');
    assert.equal(signature.repeated, true);
    assert.equal(signature.algorithm, 'rsa-sha1');
  });

  it('ignores parts that are not tags', () => {
    assert.deepEqual(parseTagList('junk; =x; 9a=1; a=1;;'), { tags: { a: '1' }, repeated: false });
  });
});

describe('ARC (RFC 8617)', () => {
  it('groups the three sets of Appendix B, newest first, with their chain validation', () => {
    const { sets, invalid } = parseArcSets(splitMessage(RFC8617_B).fields);
    assert.equal(invalid, 0);
    assert.deepEqual(sets.map((set) => [set.instance, set.cv, set.results?.authservId, set.signature?.domain]), [
      [3, 'pass', 'clochette.example.org', 'clochette.example.org'],
      [2, 'pass', 'gmail.example', 'gmail.example'],
      [1, 'none', 'lists.example.org', 'lists.example.org'],
    ]);
    assert.deepEqual(brief(/** @type {import('../src/client/mail-auth.mjs').AuthResults} */ (sets[2].results)), ['spf=pass smtp.mfrom=jqd@d1.example', 'dkim=pass header.i=@d1.example', 'dmarc=pass']);
  });

  it("reads Microsoft's ARC-Authentication-Results, whose arc= comment holds brackets and equals signs", () => {
    const read = parseArcResults(MICROSOFT_ARC_RESULTS);
    assert.equal(read?.instance, 2);
    assert.equal(read?.results.authservId, 'mx.microsoft.com');
    assert.equal(read?.results.version, '1');
    assert.deepEqual(read?.results.results.map((result) => `${result.method}=${result.result}`), ['spf=pass', 'dmarc=bestguesspass', 'dkim=none', 'arc=pass']);
  });

  it('counts sets with an instance outside 1 to 50 and leaves them out', () => {
    const fields = splitMessage('ARC-Seal: i=51; cv=none; d=example.com\nARC-Seal: i=0; cv=none\nARC-Authentication-Results: i=x; example.com; none\nARC-Seal: i=1; cv=fail; d=example.org\n').fields;
    const { sets, invalid } = parseArcSets(fields);
    assert.equal(invalid, 3);
    assert.deepEqual(sets.map((set) => [set.instance, set.cv]), [[1, 'fail']]);
  });
});

describe('parseReceived (RFC 5321 §4.4)', () => {
  it('reads every clause of RFC 5322 A.4', () => {
    const [first, second] = valuesOf(RFC5322_A4, 'received').map(parseReceived);
    assert.deepEqual(
      { from: first.from, by: first.by, via: first.via, with: first.with, id: first.id, for: first.for, date: first.date, tls: first.tls, auth: first.auth },
      { from: 'x.y.test', by: 'example.net', via: 'TCP', with: 'ESMTP', id: 'ABC12345', for: '<mary@example.net>', date: Date.UTC(1997, 10, 21, 16, 5, 43), tls: false, auth: false },
    );
    assert.equal(second.from, 'node.example');
    assert.equal(second.by, 'x.y.test');
    assert.equal(second.fromAddress, '');
  });

  it('reads the address and looked-up name the server saw, and the protocol letters (RFC 8601 B.4)', () => {
    const [received] = valuesOf(RFC8601_B4, 'received').map(parseReceived);
    assert.equal(received.from, 'dialup-1-2-3-4.example.net');
    assert.equal(received.fromAddress, '192.0.2.200');
    assert.equal(received.ip?.text, '192.0.2.200');
    assert.equal(received.reverse, 'dialup-1-2-3-4.example.net');
    assert.equal(received.by, 'mail-router.example.com');
    assert.equal(received.protocol, 'ESMTPA');
    assert.deepEqual([received.tls, received.auth], [false, true]);
    assert.deepEqual(received.comments, ['8.11.6/8.11.6', 'dialup-1-2-3-4.example.net [192.0.2.200]', '8.11.6/8.11.6']);
  });

  it('reads the Received lines of RFC 8617 Appendix B, including a placeholder address', () => {
    const lines = valuesOf(RFC8617_B, 'received').map(parseReceived);
    assert.deepEqual(lines.map((line) => line.by), ['gmail.example', 'lists.example.org', 'segv.d1.example', 'clochette.example.org']);
    assert.equal(lines[2].from, '[2001:DB8::1A]');
    assert.equal(lines[2].fromAddress, 'w.x.y.z');
    assert.equal(lines[2].ip, null);
    assert.equal(lines[3].for, '<fmartin@example.org>');
    assert.equal(lines[0].date, Date.UTC(2015, 0, 14, 23, 2, 40));
  });

  it("reads Microsoft's lines: an unregistered protocol name, and no date", () => {
    const [proseware, litware] = MICROSOFT_RECEIVED.map(parseReceived);
    assert.equal(proseware.with, 'Microsoft SMTPSVC');
    assert.deepEqual([proseware.protocol, proseware.tls, proseware.auth], ['MICROSOFT', null, null]);
    assert.equal(proseware.ip?.text, '10.54.108.101');
    assert.equal(litware.fromAddress, '10.54.108.23');
    assert.equal(litware.reverse, '');
    assert.equal(litware.date, null);
    assert.equal(litware.dateText, '');
  });

  it('marks STARTTLS from the protocol name and reads a from-literal', () => {
    const line = parseReceived('from [192.0.2.7] by mx.example.org with ESMTPS id 1; Fri, 21 Nov 1997 10:05:43 -0600');
    assert.deepEqual([line.fromAddress, line.ip?.text, line.tls, line.auth], ['192.0.2.7', '192.0.2.7', true, false]);
    assert.equal(parseReceived('from a by b with UTF8SMTPSA; 21 Nov 1997 10:05:43 -0600').auth, true);
  });

  it('reads Microsoft 365’s address without brackets, and no address from other comments (review E17)', () => {
    const line = parseReceived('from mail.example.com (192.0.2.25) by BN8NAM11FT001.mail.protection.outlook.com (10.13.1.1) with Microsoft SMTP Server id 15.20.1 via Frontend Transport; Mon, 16 Nov 2026 09:12:31 +0000');
    assert.deepEqual([line.fromAddress, line.ip?.text, line.reverse], ['192.0.2.25', '192.0.2.25', '']);
    assert.equal(parseReceived('from SA1PR12MB0001.namprd12.prod.outlook.com (2603:10b6:806:1::1) by x.example with HTTPS; Mon, 16 Nov 2026 09:12:33 +0000').ip?.text, '2603:10b6:806:1::1');
    for (const comment of ['Postfix', 'using TLSv1.3 with cipher TLS_AES_256_GCM_SHA384', 'HELO 999.1.1.1']) {
      assert.equal(parseReceived(`from a.example (${comment}) by b.example; Mon, 16 Nov 2026 09:12:33 +0000`).ip, null, comment);
    }
  });

  it('takes Microsoft’s TLS version as encryption, and nothing else in its comments (review E28)', () => {
    assert.equal(parseReceived('from a.example (192.0.2.1) by b.example (10.0.0.1) with Microsoft SMTP Server (version=TLS1_3, cipher=TLS_AES_256_GCM_SHA384) id 15.20.1; Mon, 16 Nov 2026 09:12:31 +0000').tls, true);
    assert.equal(parseReceived('from a.example (192.0.2.1) by b.example (10.0.0.1) with Microsoft SMTP Server id 15.20.1; Mon, 16 Nov 2026 09:12:31 +0000').tls, null);
  });

  it('keeps text it does not know, and reads garbage without throwing', () => {
    assert.equal(parseReceived('(qmail 1234 invoked by uid 0); 21 Nov 1997 10:05:43 -0600').comments[0], 'qmail 1234 invoked by uid 0');
    assert.equal(parseReceived('something odd by x.example; bad date').extra, 'something odd');
    assert.equal(parseReceived('').date, null);
  });
});

describe('spam filter fields', () => {
  it("reads Microsoft's KEY:value pairs, skipping the elisions of its printed sample", () => {
    assert.deepEqual(parsePairs('...CTRY:;LANG:hr;SCL:1;SRV:;IPV:NLI;SFV:NSPM;PTR:;SFTY:;...'), { LANG: 'hr', SCL: '1', SRV: '', IPV: 'NLI', SFV: 'NSPM', PTR: '', SFTY: '' });
    assert.deepEqual(parsePairs('BCL:7;'), { BCL: '7' });
    assert.equal(parsePairs('CIP:192.0.2.1;CTRY:GE;SFV:SPM;CAT:PHSH;').CAT, 'PHSH');
  });

  it("reads SpamAssassin's X-Spam-Status in its default form, folded", () => {
    const [value] = valuesOf('From: a@example.com\nX-Spam-Status: Yes, score=6.1 required=5.0 tests=BAYES_99,\n\tURIBL_BLACK autolearn=no version=4.0.0\n', 'x-spam-status');
    assert.deepEqual(parseSpamStatus(value), { spam: true, score: 6.1, required: 5, tests: ['BAYES_99', 'URIBL_BLACK'] });
    assert.deepEqual(parseSpamStatus('No, score=-0.1 required=5.0 tests=NONE'), { spam: false, score: -0.1, required: 5, tests: ['NONE'] });
    assert.deepEqual(parseSpamStatus('maybe'), { spam: null, score: null, required: null, tests: [] });
  });
});

describe('IP addresses', () => {
  it('names every block in IANA’s special-purpose registries of 2025-10-09 (review E28)', () => {
    const cls = (/** @type {string} */ text) => ipClass(/** @type {import('../src/client/ip.mjs').Ip} */ (parseIp(text)));
    for (const [address, expected] of [
      ['192.31.196.1', 'protocol'], ['192.52.193.1', 'protocol'], ['192.175.48.1', 'protocol'], ['192.0.0.9', 'protocol'],
      ['100:0:0:1::1', 'protocol'], ['2001:1::1', 'protocol'], ['2001:2::1', 'benchmarking'], ['2001:3::1', 'protocol'],
      ['2001:4:112::1', 'protocol'], ['2001:20::1', 'protocol'], ['2001:30::1', 'protocol'], ['2001::1', 'teredo'],
      ['2001:db8::1', 'documentation'], ['2620:4f:8000::1', 'protocol'],
      ['2001:200::1', 'public'], ['2620:4f:8001::1', 'public'], ['192.31.197.1', 'public'],
    ]) assert.equal(cls(address), expected, address);
  });

  it('reads IPv4 and IPv6 as headers write them', () => {
    assert.equal(parseIp('192.0.2.1')?.text, '192.0.2.1');
    assert.equal(parseIp('[192.0.2.1]')?.text, '192.0.2.1');
    assert.equal(parseIp('[IPv6:2001:DB8::1A]')?.text, '2001:db8::1a');
    assert.equal(parseIp('2001:0db8:0000:0000:0000:0000:0000:0001')?.text, '2001:db8::1');
    assert.equal(parseIp('fe80::1%eth0')?.text, 'fe80::1');
    assert.equal(parseIp('::ffff:192.0.2.1')?.text, '::ffff:192.0.2.1');
    assert.equal(parseIp('::')?.text, '::');
    assert.equal(parseIp('1:0:0:1:0:0:0:1')?.text, '1:0:0:1::1');
  });

  it('refuses what is not an address', () => {
    for (const text of ['', 'w.x.y.z', '256.1.1.1', '1.2.3', '1.2.3.4.5', '01.2.3.4', '1::2::3', '12345::1', '1:2:3:4:5:6:7:8:9', ':1:2:3:4:5:6:7', 'mail.example.com', '1.2.3.4::', '::1.2.3.4:5']) {
      assert.equal(parseIp(text), null, text);
    }
  });

  it('names every range of the IANA special-purpose registries (research §9)', () => {
    /** @type {[string, string][]} */
    const cases = [
      ['0.1.2.3', 'thisNetwork'], ['10.0.0.1', 'private'], ['172.16.0.1', 'private'], ['172.31.255.255', 'private'], ['172.32.0.1', 'public'],
      ['192.168.1.1', 'private'], ['100.64.0.1', 'shared'], ['100.127.255.255', 'shared'], ['100.128.0.1', 'public'], ['127.0.0.1', 'loopback'],
      ['169.254.1.1', 'linkLocal'], ['192.0.0.8', 'protocol'], ['192.0.2.1', 'documentation'], ['198.51.100.7', 'documentation'],
      ['203.0.113.9', 'documentation'], ['198.18.0.1', 'benchmarking'], ['198.19.255.255', 'benchmarking'], ['192.88.99.1', 'relay'],
      ['240.0.0.1', 'reserved'], ['255.255.255.255', 'broadcast'], ['255.255.255.254', 'reserved'], ['8.8.8.8', 'public'], ['224.0.0.1', 'public'],
      ['::1', 'loopback'], ['::', 'unspecified'], ['::ffff:10.0.0.1', 'private'], ['::ffff:8.8.8.8', 'public'], ['64:ff9b::1', 'translation'],
      ['64:ff9b:1::1', 'translation'], ['100::1', 'discard'], ['2001::1', 'teredo'], ['2001:db8::1', 'documentation'], ['3fff::1', 'documentation'],
      ['3fff:fff::1', 'documentation'], ['3fff:1000::1', 'public'], ['2002::1', 'sixToFour'], ['fc00::1', 'uniqueLocal'], ['fd12:3456::1', 'uniqueLocal'],
      ['fe80::1', 'linkLocal'], ['febf::1', 'linkLocal'], ['fec0::1', 'public'], ['5f00::1', 'srv6'], ['2a00:1450::1', 'public'],
    ];
    for (const [text, expected] of cases) assert.equal(ipClass(/** @type {import('../src/client/ip.mjs').Ip} */ (parseIp(text))), expected, text);
  });

  it('lists the classes that mean a network inside an organisation or home', () => {
    assert.deepEqual([...INTERNAL].sort(), ['linkLocal', 'loopback', 'private', 'shared', 'uniqueLocal']);
  });
});

describe('hostile input', () => {
  const MAX_STEPS_PER_CHAR = 12;
  /** @param {() => unknown} run @param {number} length */
  const stepsPerChar = (run, length) => {
    STEPS.count = 0;
    run();
    return STEPS.count / length;
  };

  it('reads a results field of 50,000 semicolons, and other long fields, in linear time', () => {
    for (const text of [`example.com${';'.repeat(50_000)}`, `example.com; ${'dkim=pass '.repeat(20_000)}`, `example.com; spf=pass ${'a.b=c '.repeat(20_000)}`, `${'('.repeat(100_000)}`]) {
      assert.ok(stepsPerChar(() => parseAuthResults(text), text.length) < MAX_STEPS_PER_CHAR, text.slice(0, 20));
    }
  });

  it('reads long Received, Received-SPF, tag lists and filter fields in linear time', () => {
    const received = `from ${'a '.repeat(50_000)}by b; ${'x '.repeat(50_000)}`;
    assert.ok(stepsPerChar(() => parseReceived(received), received.length) < MAX_STEPS_PER_CHAR);
    const spf = `pass ${'a=b; '.repeat(40_000)}`;
    assert.ok(stepsPerChar(() => parseReceivedSpf(spf), spf.length) < MAX_STEPS_PER_CHAR);
    const tags = 'a=b;'.repeat(50_000);
    assert.ok(stepsPerChar(() => parseTagList(tags), tags.length) < MAX_STEPS_PER_CHAR);
    const pairs = 'A:b;'.repeat(50_000);
    assert.ok(stepsPerChar(() => parsePairs(pairs), pairs.length) < MAX_STEPS_PER_CHAR);
    const arc = splitMessage(Array.from({ length: 1500 }, (_, i) => `ARC-Seal: i=${i % 60}; cv=pass`).join('\n')).fields;
    assert.ok(parseArcSets(arc).sets.length <= 50);
  });

  it('never throws on any fixture cut at every 37th character', () => {
    for (const message of ALL_MESSAGES) {
      for (let cut = 0; cut < message.length; cut += 37) {
        const fields = splitMessage(message.slice(0, cut)).fields;
        parseArcSets(fields);
        for (const field of fields) {
          parseAuthResults(field.value);
          parseArcResults(field.value);
          parseReceivedSpf(field.value);
          parseDkimSignature(field.value);
          parseReceived(field.value);
          parsePairs(field.value);
          parseSpamStatus(field.value);
          parseIp(field.value);
        }
      }
    }
  });
});

describe('privacy', () => {
  it('keeps the readers free of requests, storage, the URL and HTML building', async () => {
    const { readFile } = await import('node:fs/promises');
    for (const name of ['mail-parse.mjs', 'mail-auth.mjs', 'ip.mjs']) {
      const source = await readFile(new URL(`../src/client/${name}`, import.meta.url), 'utf8');
      assert.doesNotMatch(source, /fetch\(|XMLHttpRequest|sendBeacon|WebSocket|localStorage|sessionStorage|location\.|history\.|innerHTML|outerHTML|insertAdjacentHTML/, name);
    }
  });
});

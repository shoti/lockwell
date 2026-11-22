// @ts-check
/**
 * @file Tests for the email header analyzer's judging: which lines are believed, every finding, the verdicts, ordinary
 * mail that must stay quiet, the three examples and hostile input. Messages are built from reserved names
 * (example.com/.org/.net, .example, .test) and documentation addresses; "example@gmail.com" is Google's own example.
 */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { describe, it } from 'node:test';
import { parseReceived } from '../src/client/mail-auth.mjs';
import { checkName } from '../src/client/file-name.mjs';
import { siteOf } from '../src/client/site.mjs';
import { inspectText } from '../src/client/tool-check.mjs';
import { STEPS, splitMessage } from '../src/client/mail-parse.mjs';
import { CfbError } from '../src/client/cfb.mjs';
import {
  FINDINGS, MAX_ATTACHMENTS, countRemoteImages, domainsInName, exampleMessages, headersFromMsg, inspectMessage, organisationOf, readBody, trustBoundary, verdictOf,
} from '../src/client/tool-email.mjs';
import { cfb, latin1, utf16le } from './build-files.mjs';
import { ALL_MESSAGES, MICROSOFT_AUTH, RFC8601_B2, RFC8601_B5, RFC8601_B6 } from './mail-fixtures.mjs';

/**
 * A message as the visitor's provider (inbox.test) delivers it: its own Received line, its results, the hand-off
 * line, then whatever the sending side wrote.
 * @param {{ results?: string, from?: string, handoff?: string, top?: string, extra?: string, below?: string, fields?: string, date?: string, subject?: string, messageId?: string, noResults?: boolean }} [options]
 */
function message({
  results = 'spf=pass smtp.mailfrom=ana@example.com; dkim=pass header.d=example.com; dmarc=pass header.from=example.com',
  from = 'Ana Example <ana@example.com>',
  handoff = 'from out.example.com (out.example.com [192.0.2.5]) by mx.inbox.test with ESMTPS id 1; Mon, 16 Nov 2026 09:00:01 +0000',
  top = 'from mx.inbox.test (mx.inbox.test [192.0.2.10]) by store.inbox.test with LMTPS id 2; Mon, 16 Nov 2026 09:00:02 +0000',
  extra = '',
  below = '',
  fields = '',
  date = 'Mon, 16 Nov 2026 09:00:00 +0000',
  subject = 'Hello',
  messageId = '<1@example.com>',
  noResults = false,
} = {}) {
  return `Received: ${top}
${noResults ? '' : `Authentication-Results: mx.inbox.test; ${results}\n`}${extra}Received: ${handoff}
${below}From: ${from}
To: you@inbox.test
Subject: ${subject}
Date: ${date}
Message-ID: ${messageId}
${fields}`;
}

/** @param {string} text */
const keys = (text) => inspectMessage(text).findings.map((finding) => finding.key);
/** @param {string} text @param {string} key */
const finding = (text, key) => inspectMessage(text).findings.find((entry) => entry.key === key);

describe('trustBoundary', () => {
  /** @param {string} text */
  const boundary = (text) => {
    const { fields } = splitMessage(text);
    const received = new Map(fields.filter((field) => field.key === 'received').map((field) => [field.index, parseReceived(field.value)]));
    return { fields, trust: trustBoundary(fields, received) };
  };

  it('believes the receiver’s results, and shows a foreign organisation’s below them as claimed (RFC 8601 B.6)', () => {
    const report = inspectMessage(RFC8601_B6);
    assert.deepEqual(report.checks.map((check) => [check.result, check.domain, check.trusted]), [
      ['pass', 'mail-router.example.net', true],
      ['fail', 'newyork.example.com', true],
      ['pass', 'newyork.example.com', false],
    ]);
    assert.deepEqual(report.route.map((hop) => hop.trusted), [false, true]);
  });

  it('believes several results fields of one organisation (RFC 8601 B.5)', () => {
    const { fields, trust } = boundary(RFC8601_B5);
    assert.equal(trust.authservId, 'example.com');
    assert.equal(fields[trust.boundary - 1].key, 'received', 'the lowest Received line of example.com is the last one believed');
    assert.equal(fields[trust.boundary].key, 'from');
    assert.deepEqual(inspectMessage(RFC8601_B5).checks.map((check) => `${check.method}=${check.result}:${check.trusted}`), ['dkim=pass:true', 'spf=fail:true']);
  });

  it('treats a forged results field with the receiver’s own name, below a foreign Received line, as claimed', () => {
    const text = message({
      results: 'spf=fail smtp.mailfrom=bank.example; dkim=none; dmarc=fail header.from=bank.example',
      from: 'Bank <info@bank.example>',
      handoff: 'from relay.example.net (relay.example.net [203.0.113.5]) by mx.inbox.test with ESMTPS id 1; Mon, 16 Nov 2026 09:00:01 +0000',
      below: 'Authentication-Results: mx.inbox.test; spf=pass smtp.mailfrom=bank.example; dkim=pass header.d=bank.example; dmarc=pass header.from=bank.example\nReceived: from x (x [198.51.100.1]) by relay.example.net with ESMTP; Mon, 16 Nov 2026 09:00:00 +0000\n',
    });
    const report = inspectMessage(text);
    assert.deepEqual(report.checks.map((check) => `${check.method}=${check.result}:${check.trusted}`), ['spf=fail:true', 'dkim=none:true', 'dmarc=fail:true', 'spf=pass:false', 'dkim=pass:false', 'dmarc=pass:false']);
    assert.ok(report.findings.some((entry) => entry.key === 'dmarcFail'), 'the forged pass clears nothing');
  });

  it('does not believe a results field that sits below the receiver’s Received line and names another organisation', () => {
    const text = `Received: from out.example.net (out.example.net [192.0.2.5]) by mx.inbox.test with ESMTPS id 1; Mon, 16 Nov 2026 09:00:01 +0000
Authentication-Results: bank.example; spf=pass; dkim=pass header.d=bank.example; dmarc=pass header.from=bank.example
From: Bank <info@bank.example>
Subject: x
Date: Mon, 16 Nov 2026 09:00:00 +0000
`;
    const report = inspectMessage(text);
    assert.equal(report.checks.every((check) => !check.trusted), true);
    assert.deepEqual(report.findings.find((entry) => entry.key === 'noChecks')?.variant, 'claimed');
    assert.equal(report.verdict, 'unchecked');
  });

  it("believes Microsoft's results, which name no receiver", () => {
    const text = message({ results: MICROSOFT_AUTH.alignment, from: 'Contoso <info@contoso.com>' }).replace('Authentication-Results: mx.inbox.test; ', 'Authentication-Results: ');
    const report = inspectMessage(text);
    assert.equal(report.receiver.named, false);
    assert.equal(report.receiver.host, 'mx.inbox.test');
    assert.ok(report.checks.every((check) => check.trusted));
    assert.ok(keys(text).includes('dmarcFail'));
  });

  it('trusts no results without a results field, but still shows the route and the sender', () => {
    const report = inspectMessage(message({ noResults: true }));
    assert.deepEqual(report.findings.map((entry) => entry.key), ['noChecks', 'encryptedInTransit']);
    assert.equal(report.identity.address, 'ana@example.com');
    assert.deepEqual(report.route.map((hop) => hop.trusted), [true, true]);
  });

  it('works out organisations from the Public Suffix List, and leaves addresses alone', () => {
    assert.equal(organisationOf('mail.news.example.co.uk'), 'example.co.uk');
    assert.equal(organisationOf('ana@Mail.Example.COM.'), 'example.com');
    assert.equal(organisationOf('192.0.2.1'), '192.0.2.1');
    assert.equal(organisationOf('localhost'), 'localhost');
  });
});

describe('trustBoundary: forgeries from the sending side (review E1–E3)', () => {
  const claimed = (/** @type {string} */ text) => inspectMessage(text).checks.filter((check) => !check.trusted).map((check) => `${check.method}=${check.result}`);
  const tail = 'From: Bank <security@bank.example>\nTo: you@inbox.test\nSubject: Verify your account\nDate: Mon, 16 Nov 2026 09:00:00 +0000\nMessage-ID: <1@bank.example>\n';

  it('stops at the hand-off: a forged results field and a forged line "by" the provider below it are claimed (E1)', () => {
    const text = message({
      results: 'spf=softfail smtp.mailfrom=x@evil.example; dkim=none',
      from: 'Bank <security@bank.example>',
      handoff: 'from out.evil.example (out.evil.example [203.0.113.9]) by mx.inbox.test with ESMTPS id 1; Mon, 16 Nov 2026 09:00:01 +0000',
      below: 'Authentication-Results: mx.inbox.test; dkim=pass header.d=bank.example; dmarc=pass header.from=bank.example\nReceived: from mail.bank.example (mail.bank.example [192.0.2.77]) by mx.inbox.test with ESMTPS id 9; Mon, 16 Nov 2026 08:59:59 +0000\n',
    });
    const report = inspectMessage(text);
    assert.equal(report.verdict, 'warn');
    assert.deepEqual(report.identity.signedBy, []);
    assert.equal(report.identity.handoff?.from, 'out.evil.example');
    assert.deepEqual(claimed(text), ['dkim=pass', 'dmarc=pass']);
  });

  const gmail = `Delivered-To: you@gmail.example
Received: by 2002:a05:7300:5a0b:b0:1a2:3b4c:5d6e with SMTP id x11csp1; Mon, 16 Nov 2026 01:02:03 -0800
Received: from out.evil.example (out.evil.example. [203.0.113.9]) by mx.google.com with ESMTPS id abc123 for <you@gmail.example>; Mon, 16 Nov 2026 01:02:02 -0800
Received-SPF: softfail (google.com: domain of transitioning x@evil.example does not designate 203.0.113.9 as permitted sender) client-ip=203.0.113.9;
Authentication-Results: mx.google.com; spf=softfail smtp.mailfrom=x@evil.example; dmarc=none header.from=bank.example
`;

  it('reads Gmail’s order: the hand-off above the results, nothing below them believed (E2)', () => {
    const honest = inspectMessage(gmail + 'Received: from [198.51.100.2] by out.evil.example with ESMTPSA id 2; Mon, 16 Nov 2026 01:02:00 -0800\n' + tail);
    assert.equal(honest.identity.handoff?.from, 'out.evil.example', 'the sender’s own submission hop is not the hand-off');
    assert.ok(honest.route.filter((hop) => hop.trusted).every((hop) => hop.by === 'mx.google.com' || hop.by.startsWith('2002:')));
    const forged = gmail + 'Received: from relay.evil.example by out.evil.example with ESMTPS id 3; Mon, 16 Nov 2026 01:02:01 -0800\nAuthentication-Results: mx.google.com; dkim=pass header.d=bank.example header.s=s1\nReceived: from [198.51.100.2] by smtp.evil.example with ESMTPSA id 2; Mon, 16 Nov 2026 01:02:00 -0800\n' + tail;
    assert.equal(inspectMessage(forged).verdict, 'warn');
    assert.deepEqual(claimed(forged), ['dkim=pass']);
  });

  it('believes a results field without a writer’s name only above the hand-off, as Microsoft writes it (E3)', () => {
    const base = (/** @type {string} */ results) => `Received: from out.evil.example (out.evil.example [203.0.113.9]) by mx.smallisp.example with ESMTP id 1; Mon, 16 Nov 2026 09:12:31 +0000
${results}
Received: from [198.51.100.2] by out.evil.example with ESMTPSA id 2; Mon, 16 Nov 2026 09:12:30 +0000
${tail}`;
    for (const forged of ['Authentication-Results: mx; spf=pass smtp.mailfrom=bank.example; dkim=pass header.d=bank.example; dmarc=pass header.from=bank.example', 'Authentication-Results: spf=pass (sender IP is 203.0.113.9) smtp.mailfrom=bank.example; dkim=pass (signature was verified) header.d=bank.example;dmarc=pass action=none header.from=bank.example;compauth=pass reason=100']) {
      const report = inspectMessage(base(forged));
      assert.equal(report.verdict, 'unchecked', forged);
      assert.ok(report.checks.every((check) => !check.trusted));
    }
    const microsoft = `Received: from SA1PR12MB0001.namprd12.prod.outlook.com (2603:10b6:806:1::1) by MN2PR12MB0002.namprd12.prod.outlook.com with HTTPS; Mon, 16 Nov 2026 09:12:33 +0000
Received: from BN9PR03CA0001.namprd03.prod.outlook.com (2603:10b6:408:1::2) by SA1PR12MB0001.namprd12.prod.outlook.com (2603:10b6:806:1::1) with Microsoft SMTP Server (version=TLS1_2, cipher=TLS_ECDHE_RSA_WITH_AES_256_GCM_SHA384) id 15.20.1; Mon, 16 Nov 2026 09:12:32 +0000
Authentication-Results: spf=pass (sender IP is 192.0.2.25) smtp.mailfrom=example.com; dkim=pass (signature was verified) header.d=example.com;dmarc=pass action=none header.from=example.com;compauth=pass reason=100
Received-SPF: Pass (protection.outlook.com: domain of example.com designates 192.0.2.25 as permitted sender) receiver=protection.outlook.com; client-ip=192.0.2.25; helo=mail.example.com; pr=C
Received: from mail.example.com (192.0.2.25) by BN8NAM11FT001.mail.protection.outlook.com (10.13.1.1) with Microsoft SMTP Server id 15.20.1 via Frontend Transport; Mon, 16 Nov 2026 09:12:31 +0000
From: Friend <friend@example.com>
To: you@contoso.example
Subject: Lunch?
Date: Mon, 16 Nov 2026 09:12:29 +0000
Message-ID: <abc@example.com>
`;
    const report = inspectMessage(microsoft);
    assert.equal(report.verdict, 'none');
    assert.ok(report.checks.length > 0 && report.checks.every((check) => check.trusted));
    assert.equal(report.identity.handoff?.from, 'mail.example.com');
  });
});

describe('findings', () => {
  it('stays quiet on an ordinary message from one person to another', () => {
    assert.deepEqual(keys(message()), ['encryptedInTransit']);
    assert.equal(inspectMessage(message()).verdict, 'none');
  });

  it('dmarcFail and spoofedSender', () => {
    assert.ok(keys(message({ results: 'spf=pass smtp.mailfrom=x@example.com; dmarc=fail header.from=example.com' })).includes('dmarcFail'));
    assert.ok(keys(message({ results: MICROSOFT_AUTH.spoof.replace(/contoso\.com/g, 'example.com') })).includes('dmarcFail'), 'compauth=fail counts');
    const spoofed = keys(message({ results: 'spf=pass smtp.mailfrom=x@other.example.net; dkim=none; dmarc=none' }));
    assert.ok(spoofed.includes('spoofedSender'));
    assert.ok(!spoofed.includes('dmarcFail'));
    assert.ok(!keys(message({ results: 'spf=pass smtp.mailfrom=x@other.example.net; dmarc=bestguesspass header.from=example.com' })).includes('spoofedSender'));
  });

  it('replyElsewhere is not excused by a List-Id line the sender wrote; a real list’s shape is (review E4)', () => {
    const [, scam] = exampleMessages();
    const added = scam.replace('To: you@inbox.test', 'List-Id: <updates.post.example.net>\nTo: you@inbox.test');
    assert.ok(keys(added).includes('replyElsewhere'));
    const free = message({
      results: 'spf=pass smtp.mailfrom=boss@gmail.com; dkim=pass header.d=gmail.com; dmarc=pass header.from=gmail.com',
      from: 'Boss <boss@gmail.com>',
      fields: 'Reply-To: desk@other.example.net\nList-Id: <team.gmail.com>\n',
    });
    assert.ok(keys(free).includes('replyElsewhere'), 'a free mailbox is never a list');
    const toList = message({
      results: 'spf=pass smtp.mailfrom=ana@example.com; dkim=pass header.d=lists.example.org; dkim=pass header.d=example.com; dmarc=pass header.from=example.com',
      fields: 'Reply-To: friends@lists.example.org\nList-Id: Friends <friends.lists.example.org>\n',
    });
    assert.ok(!keys(toList).includes('replyElsewhere'), 'replies to a list that signed the post');
    const unsigned = message({ fields: 'Reply-To: friends@lists.example.org\nList-Id: Friends <friends.lists.example.org>\n' });
    assert.ok(keys(unsigned).includes('replyElsewhere'), 'no signature of the list: the List-Id is only the sender’s word');
  });

  it('an unreadable Reply-To is shown as written and still warns (review E14)', () => {
    for (const field of ['Reply-To: <g.beridze.director@post.example.net\n', 'Reply-To: g.beridze.director@post.example.net.\n']) {
      const found = finding(message({ fields: field }), 'replyElsewhere');
      assert.ok(found, field);
      assert.ok(found.values.some((value) => value.includes('g.beridze.director@post.example.net')), field);
    }
  });

  it('replyElsewhere, and its free-mailbox wording', () => {
    assert.deepEqual(finding(message({ fields: 'Reply-To: desk@other.example.net\n' }), 'replyElsewhere')?.values, ['desk@other.example.net']);
    assert.equal(finding(message({ fields: 'Reply-To: example@gmail.com\n' }), 'replyElsewhere')?.variant, 'free');
    assert.equal(finding(message({ fields: 'Reply-To: Ana <ana@home.example.com>\n' }), 'replyElsewhere'), undefined, 'same organisation');
  });

  it('nameIsAddress', () => {
    assert.deepEqual(finding(message({ from: '"service@bank.example" <ana@example.com>' }), 'nameIsAddress')?.values, ['bank.example']);
    assert.deepEqual(finding(message({ from: '"bank.ge security" <ana@example.com>' }), 'nameIsAddress')?.values, ['bank.ge']);
    assert.equal(finding(message({ from: '"ana@example.com" <ana@example.com>' }), 'nameIsAddress'), undefined);
    assert.deepEqual(domainsInName('Dr. Ana Example, Inc.'), []);
  });

  it('lookalikeDomain, by the link checker’s rules', () => {
    const imitation = finding(message({ from: 'TBC <info@tbcbank-ge.example>', results: 'dkim=pass header.d=tbcbank-ge.example; dmarc=pass header.from=tbcbank-ge.example' }), 'lookalikeDomain');
    assert.deepEqual(imitation?.values, ['tbcbank-ge.example', 'tbcbank']);
    assert.equal(imitation?.variant, '');
    assert.equal(finding(message({ fields: 'Reply-To: help@paypa1.example\n' }), 'lookalikeDomain')?.values[0], 'paypa1.example');
    const mixed = new URL('http://p\u0430ypal.example').hostname;
    assert.equal(finding(message({ from: `Ana <ana@${mixed}>` }), 'lookalikeDomain')?.variant !== undefined, true, 'Latin and Cyrillic letters mixed');
  });

  it('nameHidden', () => {
    const hidden = finding(message({ from: '"Bank\u202Egnp.exe" <ana@example.com>' }), 'nameHidden');
    assert.ok(hidden?.values[0].includes('⟨U+202E⟩'));
    assert.ok(finding(message({ subject: 'Pay\u200B now' }), 'nameHidden'));
  });

  it('severalFrom', () => {
    assert.ok(keys(message({ fields: 'From: other@example.org\n' })).includes('severalFrom'));
    assert.ok(keys(message({ from: 'a@example.com, b@example.com' })).includes('severalFrom'));
    assert.ok(!keys(message({ from: 'a@example.com, b@example.com', fields: 'Sender: a@example.com\n' })).includes('severalFrom'));
  });

  it('filterSaidSpam, only from the provider’s own lines', () => {
    assert.deepEqual(finding(message({ extra: 'X-Forefront-Antispam-Report: CIP:192.0.2.5;CTRY:GE;SFV:SPM;CAT:PHSH;SCL:5;\n' }), 'filterSaidSpam')?.values, ['SFV:SPM', 'CAT:PHSH']);
    assert.deepEqual(finding(message({ extra: 'X-Spam-Flag: YES\nX-Spam-Status: Yes, score=7.0 required=5.0 tests=A\n' }), 'filterSaidSpam')?.values, ['X-Spam-Flag: YES', 'X-Spam-Status: Yes']);
    assert.equal(finding(message({ below: 'X-Spam-Flag: YES\n', handoff: 'from out.example.com (out.example.com [192.0.2.5]) by mx.inbox.test with ESMTPS id 1; Mon, 16 Nov 2026 09:00:01 +0000\nReceived: from a (a [198.51.100.1]) by out.example.com with ESMTPSA id 0; Mon, 16 Nov 2026 09:00:00 +0000' }), 'filterSaidSpam'), undefined);
    const report = inspectMessage(message({ extra: 'X-Forefront-Antispam-Report: CIP:192.0.2.5;CTRY:GE;SFV:NSPM;SCL:1;DIR:INB;\nX-Microsoft-Antispam: BCL:0;\n' }));
    assert.deepEqual(report.filter, [{ key: 'SFV', value: 'NSPM' }, { key: 'SCL', value: '1' }, { key: 'BCL', value: '0' }, { key: 'CIP', value: '192.0.2.5' }, { key: 'CTRY', value: 'GE' }, { key: 'DIR', value: 'INB' }]);
    assert.ok(!report.findings.some((entry) => entry.key === 'filterSaidSpam'));
  });

  it('dkimLength, for a signature by a domain that passed', () => {
    assert.deepEqual(finding(message({ fields: 'DKIM-Signature: v=1; a=rsa-sha256; d=example.com; s=s1; l=120; h=from; bh=x; b=y\n' }), 'dkimLength')?.values, ['example.com']);
    assert.equal(finding(message({ fields: 'DKIM-Signature: v=1; a=rsa-sha256; d=unrelated.example.org; s=s1; l=120; h=from; bh=x; b=y\n' }), 'dkimLength'), undefined);
  });

  it('arcBroken, from the provider’s newest ARC set', () => {
    assert.ok(keys(message({ extra: 'ARC-Seal: i=2; a=rsa-sha256; cv=fail; d=inbox.test; s=a; b=x\nARC-Seal: i=1; a=rsa-sha256; cv=none; d=example.org; s=a; b=x\n' })).includes('arcBroken'));
    assert.ok(!keys(message({ extra: 'ARC-Seal: i=2; a=rsa-sha256; cv=pass; d=inbox.test; s=a; b=x\n' })).includes('arcBroken'));
  });

  it('noChecks and partial, and their wordings', () => {
    assert.equal(finding(message({ noResults: true }), 'noChecks')?.variant, '');
    assert.equal(finding(RFC8601_B2, 'noChecks')?.variant, 'none');
    assert.deepEqual(keys('From: ana@example.com\nSubject: Hello\n'), ['noChecks', 'partial']);
    assert.equal(inspectMessage('From: ana@example.com\nSubject: Hello\n').verdict, 'unchecked');
  });

  it('spfFail, spfSoftfail and dkimFail are notes when DMARC passes or is absent', () => {
    assert.ok(keys(message({ results: 'spf=fail smtp.mailfrom=ana@example.com; dkim=pass header.d=example.com; dmarc=pass header.from=example.com' })).includes('spfFail'));
    assert.ok(keys(message({ results: 'spf=hardfail smtp.mailfrom=ana@example.com; dkim=pass header.d=example.com' })).includes('spfFail'));
    assert.ok(keys(message({ results: 'spf=softfail smtp.mailfrom=ana@example.com; dkim=pass header.d=example.com; dmarc=pass header.from=example.com' })).includes('spfSoftfail'));
    assert.deepEqual(finding(message({ results: 'spf=pass smtp.mailfrom=ana@example.com; dkim=fail header.d=list.example.org; dmarc=pass header.from=example.com' }), 'dkimFail')?.values, ['list.example.org']);
    const failed = keys(message({ results: 'spf=fail smtp.mailfrom=ana@example.com; dkim=fail header.d=example.com; dmarc=fail header.from=example.com' }));
    assert.ok(failed.includes('dmarcFail') && !failed.includes('spfFail') && !failed.includes('dkimFail'), 'a DMARC failure says it once');
  });

  it('freeMailbox, only under an organisation’s name', () => {
    const results = 'spf=pass smtp.mailfrom=example@gmail.com; dkim=pass header.d=gmail.com; dmarc=pass header.from=gmail.com';
    assert.deepEqual(finding(message({ results, from: 'Bank Support <example@gmail.com>' }), 'freeMailbox')?.values, ['gmail.com']);
    assert.ok(finding(message({ results, from: 'სს ბანკი <example@gmail.com>' }), 'freeMailbox'));
    assert.equal(finding(message({ results, from: 'Ana Example <example@gmail.com>' }), 'freeMailbox'), undefined, 'a person’s name');
  });

  it('signedByOther', () => {
    assert.deepEqual(finding(message({ results: 'spf=pass smtp.mailfrom=ana@example.com; dkim=pass header.d=esp.example.net; dmarc=pass header.from=example.com' }), 'signedByOther')?.values, ['esp.example.net']);
  });

  it('fakeReply', () => {
    assert.ok(keys(message({ subject: 'Re: invoice' })).includes('fakeReply'));
    assert.ok(keys(message({ subject: 'FWD: invoice' })).includes('fakeReply'));
    assert.ok(!keys(message({ subject: 'Re: invoice', fields: 'In-Reply-To: <0@example.com>\n' })).includes('fakeReply'));
    assert.ok(!keys(message({ subject: 'Regarding the invoice' })).includes('fakeReply'));
  });

  it('dateOdd: a date in the future or more than a week old', () => {
    assert.equal(finding(message({ date: 'Tue, 17 Nov 2026 09:00:00 +0000' }), 'dateOdd')?.variant, 'future');
    assert.equal(finding(message({ date: 'Thu, 5 Nov 2026 09:00:00 +0000' }), 'dateOdd')?.variant, 'old');
    assert.equal(finding(message({ date: 'Mon, 16 Nov 2026 09:10:00 +0000' }), 'dateOdd'), undefined, 'a few minutes of clock difference');
  });

  it('slowHop and backwards, between the provider’s own hops', () => {
    assert.deepEqual(finding(message({ top: 'from mx.inbox.test by store.inbox.test with LMTPS id 2; Mon, 16 Nov 2026 11:30:00 +0000' }), 'slowHop')?.values, ['store.inbox.test']);
    assert.ok(keys(message({ top: 'from mx.inbox.test by store.inbox.test with LMTPS id 2; Mon, 16 Nov 2026 08:40:00 +0000' })).includes('backwards'));
    assert.ok(!keys(message({ top: 'from mx.inbox.test by store.inbox.test with LMTPS id 2; Mon, 16 Nov 2026 08:58:00 +0000' })).includes('backwards'), 'small clock differences');
    const claimedSlow = message({
      handoff: 'from relay.example.net (relay.example.net [203.0.113.5]) by mx.inbox.test with ESMTPS id 1; Mon, 16 Nov 2026 09:00:01 +0000\nReceived: from a (a [198.51.100.1]) by relay.example.net with ESMTPS id 0; Sun, 15 Nov 2026 09:00:00 +0000',
    });
    assert.ok(!keys(claimedSlow).includes('slowHop'), 'a claimed hop raises nothing');
  });

  it('plainHop, between two organisations without STARTTLS', () => {
    assert.deepEqual(finding(message({ handoff: 'from out.example.com (out.example.com [192.0.2.5]) by mx.inbox.test with ESMTP id 1; Mon, 16 Nov 2026 09:00:01 +0000' }), 'plainHop')?.values, ['out.example.com → mx.inbox.test']);
    assert.ok(!keys(message({ top: 'from mx.inbox.test by store.inbox.test with LMTP id 2; Mon, 16 Nov 2026 09:00:02 +0000' })).includes('plainHop'), 'inside the provider');
  });

  it('privateOrigin', () => {
    const text = message({
      handoff: 'from out.example.com (out.example.com [192.0.2.5]) by mx.inbox.test with ESMTPS id 1; Mon, 16 Nov 2026 09:00:01 +0000\nReceived: from [10.1.2.3] (unknown [10.1.2.3]) by out.example.com with ESMTPSA id 0; Mon, 16 Nov 2026 09:00:00 +0000',
    });
    assert.deepEqual(finding(text, 'privateOrigin')?.values, ['10.1.2.3']);
  });

  it('forwarded, oldDkim', () => {
    assert.ok(keys(message({ fields: 'X-Forwarded-For: ana@example.com\n' })).includes('forwarded'));
    assert.ok(keys(message({ fields: 'Resent-From: ana@example.com\n' })).includes('forwarded'));
    assert.deepEqual(finding(message({ fields: 'DKIM-Signature: v=1; a=rsa-sha1; d=example.com; s=s1; h=from; bh=x; b=y\n' }), 'oldDkim')?.values, ['example.com']);
    assert.ok(keys(message({ fields: 'DKIM-Signature: v=1; a=rsa-sha256; d=example.com; s=s1; x=1000; h=from; bh=x; b=y\n' })).includes('oldDkim'), 'expired');
  });

  it('the facts: bulk mail, lists, automatic replies, software, an originating address, a message ID elsewhere, encryption', () => {
    assert.ok(keys(message({ fields: 'List-Unsubscribe: <https://example.com/u>\n' })).includes('bulkSender'));
    assert.ok(keys(message({ fields: 'Precedence: bulk\n' })).includes('bulkSender'));
    assert.deepEqual(finding(message({ fields: 'List-Id: Friends <friends.lists.example.org>\n' }), 'mailingList')?.values, ['Friends <friends.lists.example.org>']);
    assert.deepEqual(finding(message({ fields: 'Auto-Submitted: auto-replied\n' }), 'autoReply')?.values, ['auto-replied']);
    assert.ok(!keys(message({ fields: 'Auto-Submitted: no\n' })).includes('autoReply'));
    assert.deepEqual(finding(message({ fields: 'X-Mailer: Example Mailer 1.0\n' }), 'software')?.values, ['Example Mailer 1.0']);
    assert.deepEqual(finding(message({ fields: 'X-Originating-IP: [198.51.100.9]\n' }), 'senderAddress')?.values, ['198.51.100.9']);
    assert.deepEqual(finding(message({ messageId: '<abc@esp.example.net>' }), 'messageIdElsewhere')?.values, ['esp.example.net']);
    assert.deepEqual(finding(message(), 'encryptedInTransit')?.values, ['ESMTPS']);
  });

  it('has a test above for every finding', async () => {
    const source = await readFile(new URL(import.meta.url), 'utf8');
    for (const key of Object.keys(FINDINGS)) assert.ok(source.includes(`'${key}'`), key);
  });
});

describe('the whole message', () => {
  /** @param {string} type @param {string} content @param {string} [extra] */
  const part = (type, content, extra = '') => `--b\nContent-Type: ${type}\n${extra}\n${content}\n`;
  /** @param {...string} parts */
  const whole = (...parts) => message({ fields: `MIME-Version: 1.0\nContent-Type: multipart/mixed; boundary=b\n\n${parts.join('')}--b--\n` });

  it('judges the links with the link checker, including words that name another site', () => {
    const text = whole(part('text/html; charset=utf-8', '<p>Sign in at <a href="https://tbc-login.pages.dev/auth">www.tbcbank.ge</a> or <a href="https://example.com/help">help</a>.</p>'));
    const report = inspectMessage(text);
    assert.equal(report.body?.linksTotal, 2);
    assert.deepEqual(report.body?.links.map((link) => [link.url, link.warnings > 0]), [['https://tbc-login.pages.dev/auth', true], ['https://example.com/help', false]]);
    assert.ok(!report.findings.some((entry) => entry.key === 'riskyAttachment'));
  });

  it('finds links in a plain-text part too', () => {
    assert.equal(inspectMessage(whole(part('text/plain', 'See https://example.org/page and https://example.net/'))).body?.linksTotal, 2);
  });

  it('judges attachment names with the attachment checker’s name check: riskyAttachment', () => {
    const text = whole(
      part('text/plain', 'Invoice attached.'),
      part('application/pdf; name="Invoice\u202Efdp.exe"', 'TVo=', 'Content-Transfer-Encoding: base64\nContent-Disposition: attachment\n'),
      part('application/octet-stream', 'x', 'Content-Disposition: attachment; filename="report.pdf.js"\n'),
      part('image/png', 'iVBORw0KGgo=', 'Content-Transfer-Encoding: base64\nContent-Disposition: attachment; filename="photo.png"\n'),
    );
    const report = inspectMessage(text);
    assert.deepEqual(report.body?.attachments.map((file) => [file.name, file.risky]), [['Invoice\u202Efdp.exe', true], ['report.pdf.js', true], ['photo.png', false]]);
    assert.deepEqual(report.findings.find((entry) => entry.key === 'riskyAttachment')?.values, ['Invoice⟨RLO⟩fdp.exe', 'report.pdf.js']);
    assert.equal(report.body?.attachmentsTotal, 3);
  });

  it('counts pictures loaded from the internet: remoteImages', () => {
    const text = whole(part('text/html', '<img src="https://track.example.net/p.gif" width=1><IMG alt="" SRC = \'http://example.com/a.png\'><img src="cid:logo">'));
    assert.deepEqual(finding(text, 'remoteImages')?.values, ['2']);
    assert.equal(countRemoteImages('<img src="data:image/png;base64,AAAA">'), 0);
  });

  it('lists at most MAX_ATTACHMENTS files and says when part of the body wasn’t read', () => {
    const files = Array.from({ length: MAX_ATTACHMENTS + 3 }, (_, i) => `--b\nContent-Type: image/gif; name=a${i}.gif\n\nx\n`).join('');
    const body = readBody(splitMessage(`From: a@example.com\nContent-Type: multipart/mixed; boundary=b\n\n${files}--b--\n`).fields, `${files}--b--\n`);
    assert.equal(body.attachments.length, MAX_ATTACHMENTS);
    assert.equal(body.attachmentsTotal, MAX_ATTACHMENTS + 3);
    assert.equal(body.unread, false);
  });

  it('reads hostile HTML in linear time: unclosed links and pictures', () => {
    for (const html of ['<a href="https://example.com/">'.repeat(30_000), '<img src="https://example.com/"'.repeat(30_000), '<a'.repeat(200_000)]) {
      const text = whole(part('text/html', html));
      const started = performance.now();
      inspectMessage(text);
      assert.ok(performance.now() - started < 3000, html.slice(0, 10));
    }
  });

  it('gives no body for headers alone', () => {
    assert.equal(inspectMessage(message()).body, null);
  });
});

describe('headersFromMsg (.msg files)', () => {
  const headers = exampleMessages()[1];
  it('reads the transport headers stream, Unicode (001F) or 8-bit (001E)', () => {
    assert.equal(headersFromMsg(cfb([{ path: '__substg1.0_0037001F', data: utf16le('Subject') }, { path: '__substg1.0_007D001F', data: utf16le(`${headers}\0`) }])), headers);
    assert.equal(headersFromMsg(cfb([{ path: '__substg1.0_007D001E', data: latin1(`${headers}\0`) }])), headers);
  });

  it('says a message holds none (a draft), a file isn’t a compound file, or throws for a damaged one', () => {
    assert.equal(headersFromMsg(cfb([{ path: '__substg1.0_0037001F', data: utf16le('Draft') }])), '');
    assert.equal(headersFromMsg(cfb([{ path: 'Attach/__substg1.0_007D001F', data: utf16le(headers) }])), '', 'only the message’s own stream counts');
    assert.equal(headersFromMsg(latin1(headers)), null);
    const damaged = cfb([{ path: '__substg1.0_007D001F', data: utf16le(headers) }]).slice(0, 600);
    assert.throws(() => headersFromMsg(damaged), CfbError);
  });
});

describe('verdictOf', () => {
  /** @param {...(keyof typeof FINDINGS)} list */
  const of = (...list) => verdictOf(list.map((key) => ({ key, level: FINDINGS[key], values: [], variant: '' })));
  it('is "warn" with any warning, "unchecked" without the provider’s checks, "none" otherwise; never "safe"', () => {
    assert.equal(of(), 'none');
    assert.equal(of('encryptedInTransit', 'spfFail'), 'none');
    assert.equal(of('noChecks'), 'unchecked');
    assert.equal(of('partial', 'bulkSender'), 'unchecked');
    assert.equal(of('replyElsewhere'), 'warn');
    assert.equal(of('noChecks', 'replyElsewhere'), 'warn');
    assert.equal(of('partial', 'noChecks', 'lookalikeDomain', 'spfFail', 'software'), 'warn');
  });
});

describe('ordinary mail stays quiet', () => {
  it('a person-to-person message', () => {
    assert.deepEqual(keys(message()), ['encryptedInTransit']);
  });

  it('a newsletter through a bulk sender, with a different bounce address', () => {
    const text = message({
      results: 'spf=pass smtp.mailfrom=bounce-1@bounces.esp.example.net; dkim=pass header.d=example.com; dmarc=pass header.from=example.com',
      from: 'Example News <news@example.com>',
      messageId: '<n1@esp.example.net>',
      fields: 'Return-Path: <bounce-1@bounces.esp.example.net>\nList-Unsubscribe: <https://example.com/u?1>\nList-Unsubscribe-Post: List-Unsubscribe=One-Click\nFeedback-ID: 1:news:esp:12345\n',
    });
    assert.deepEqual(keys(text), ['bulkSender', 'messageIdElsewhere', 'encryptedInTransit']);
    assert.equal(inspectMessage(text).identity.returnSame, false);
  });

  it('a forwarded message whose SPF fails while DMARC passes', () => {
    const text = message({
      results: 'spf=fail smtp.mailfrom=ana@example.com; dkim=pass header.d=example.com; dmarc=pass header.from=example.com; arc=pass',
      extra: 'ARC-Seal: i=1; a=rsa-sha256; cv=none; d=forward.example.org; s=a; b=x\nARC-Authentication-Results: i=1; relay.forward.example.org; spf=pass smtp.mailfrom=ana@example.com\n',
      handoff: 'from relay.forward.example.org (relay.forward.example.org [203.0.113.7]) by mx.inbox.test with ESMTPS id 1; Mon, 16 Nov 2026 09:00:01 +0000',
    });
    assert.deepEqual(keys(text), ['spfFail', 'forwarded', 'encryptedInTransit']);
  });

  it('a mailing-list post whose From was rewritten to the list', () => {
    const text = message({
      results: 'spf=pass smtp.mailfrom=friends-bounces@lists.example.org; dkim=pass header.d=lists.example.org; dmarc=pass header.from=lists.example.org',
      from: '"Ana Example via Friends" <friends@lists.example.org>',
      messageId: '<p1@example.com>',
      fields: 'Reply-To: Ana Example <ana@example.com>\nList-Id: Friends <friends.lists.example.org>\n',
    });
    assert.deepEqual(keys(text), ['mailingList', 'messageIdElsewhere', 'encryptedInTransit']);
  });

  it('a calendar invitation sent by an assistant, with Sender', () => {
    const text = message({ from: 'Director <director@example.com>', fields: 'Sender: Assistant <assistant@example.com>\nContent-Type: text/calendar; method=REQUEST\n' });
    assert.deepEqual(keys(text), ['encryptedInTransit']);
    assert.equal(inspectMessage(text).identity.sender, 'assistant@example.com');
  });
});

describe('exampleMessages', () => {
  it('produce exactly the findings they are meant to show', () => {
    const [spoof, scam, newsletter] = exampleMessages().map((text) => inspectMessage(text));
    assert.deepEqual(spoof.findings.map((entry) => entry.key), ['dmarcFail', 'replyElsewhere', 'lookalikeDomain', 'plainHop', 'messageIdElsewhere']);
    assert.ok(spoof.checks.some((check) => !check.trusted && check.result === 'pass'), 'the forged pass is shown, as claimed');
    assert.deepEqual(scam.findings.map((entry) => entry.key), ['replyElsewhere', 'fakeReply', 'encryptedInTransit']);
    assert.ok(scam.checks.every((check) => check.trusted && check.result === 'pass'), 'every check passes');
    assert.deepEqual(newsletter.findings.map((entry) => entry.key), ['spfFail', 'forwarded', 'bulkSender', 'messageIdElsewhere', 'encryptedInTransit']);
    assert.deepEqual([spoof.verdict, scam.verdict, newsletter.verdict], ['warn', 'warn', 'none']);
  });

  it('use only reserved names and documentation addresses', () => {
    for (const text of exampleMessages()) {
      for (const host of text.replace(/[\w.+-]+@/g, '@').match(/[a-z0-9-]+(?:\.[a-z0-9-]+)+/gi) ?? []) {
        if (/^(smtp|header)\./i.test(host)) continue;
        if (/^[\d.]+$/.test(host)) {
          if (host.split('.').length === 4) assert.match(host, /^(192\.0\.2|198\.51\.100|203\.0\.113)\./, host);
          continue;
        }
        assert.match(host, /(^|\.)(example\.(com|org|net)|example|test)$/i, host);
      }
    }
  });
});

describe('hostile input', () => {
  /**
   * How much longer the work takes on an input eight times as long, as the best of three runs each. Linear work grows
   * about 8×, quadratic about 64×: the ratio holds on a slow machine too, unlike a time limit (review E5–E7).
   * @param {(n: number) => void} work
   */
  const growth = (work) => {
    const best = (/** @type {number} */ n) => Math.min(...[0, 1, 2].map(() => {
      const start = performance.now();
      work(n);
      return performance.now() - start;
    }));
    best(2000); // warm up
    return best(400_000) / Math.max(best(50_000), 0.5);
  };

  it('stays linear on long runs of spaces in an attachment name, an <img src=…> and a host of many labels (E5–E7)', () => {
    const cases = {
      checkName: (/** @type {number} */ n) => checkName(`a${' '.repeat(n)}b.exe`),
      countRemoteImages: (/** @type {number} */ n) => countRemoteImages(`<img src=${' '.repeat(n)}x>`),
      siteOf: (/** @type {number} */ n) => siteOf(`${'a.'.repeat(n / 2)}com`),
      inspectText: (/** @type {number} */ n) => inspectText(`${'a.'.repeat(n / 2)}com`, ''),
    };
    for (const [name, work] of Object.entries(cases)) {
      const ratio = growth(work);
      assert.ok(ratio < 24, `${name}: 8× the input took ${ratio.toFixed(1)}× as long`);
    }
  });

  it('reads a file name of hundreds of thousands of characters without throwing, and cuts it (E8)', () => {
    const long = 'x'.repeat(300_000);
    for (const disposition of [`attachment; filename*0=${long}.exe`, `attachment; filename*=utf-8''${long}.exe`]) {
      const text = `From: a@b.example\nTo: c@d.example\nSubject: s\nMIME-Version: 1.0\nContent-Type: multipart/mixed; boundary=X\n\n--X\nContent-Type: text/plain\n\nhi\n--X\nContent-Type: application/octet-stream\nContent-Disposition: ${disposition}\n\nAAAA\n--X--\n`;
      const report = inspectMessage(text);
      assert.equal(report.status, 'ok');
      assert.equal(report.body?.attachmentsTotal, 1);
    }
  });

  it('reads 2 MB of garbage and every example cut at every 37th character without throwing, in linear time', () => {
    const garbage = `Received: ${'(=?"<'.repeat(400_000)}`;
    STEPS.count = 0;
    inspectMessage(garbage);
    assert.ok(STEPS.count / garbage.length < 20, String(STEPS.count / garbage.length));
    for (const text of [...exampleMessages(), ...ALL_MESSAGES]) {
      for (let cut = 0; cut < text.length; cut += 37) inspectMessage(text.slice(0, cut));
    }
  });

  it('says what it got when the input is empty, too large or not headers', () => {
    assert.equal(inspectMessage('  \n').status, 'empty');
    assert.equal(inspectMessage('hello there').status, 'notHeaders');
    assert.equal(inspectMessage('x'.repeat(3 * 1024 * 1024)).status, 'tooLarge');
  });

  it('keeps the module free of requests, storage, the URL and HTML building', async () => {
    const source = await readFile(new URL('../src/client/tool-email.mjs', import.meta.url), 'utf8');
    assert.doesNotMatch(source, /fetch\(|XMLHttpRequest|sendBeacon|WebSocket|localStorage|sessionStorage|location\.|history\.|innerHTML|outerHTML|insertAdjacentHTML/);
  });
});

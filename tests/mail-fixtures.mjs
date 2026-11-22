// @ts-check
/**
 * @file Email header fixtures for the email header analyzer's tests: the RFCs' own examples, copied verbatim (only
 * the RFC page indent removed), and the header lines printed in Microsoft's documentation. Every name and address is
 * a reserved or documentation one, or the RFC's own. No real message and no real person's address.
 * Sources: docs/research/tool-email-headers.md §1–§5 and §12.
 */

/** RFC 5322 Appendix A.1.1, the first message. */
export const RFC5322_A11 = `From: John Doe <jdoe@machine.example>
To: Mary Smith <mary@example.net>
Subject: Saying Hello
Date: Fri, 21 Nov 1997 09:55:06 -0600
Message-ID: <1234@local.machine.example>

This is a message just to say hello.
So, "Hello".
`;

/** RFC 5322 Appendix A.1.1, with a Sender. */
export const RFC5322_A11_SENDER = `From: John Doe <jdoe@machine.example>
Sender: Michael Jones <mjones@machine.example>
To: Mary Smith <mary@example.net>
Subject: Saying Hello
Date: Fri, 21 Nov 1997 09:55:06 -0600
Message-ID: <1234@local.machine.example>

This is a message just to say hello.
So, "Hello".
`;

/** RFC 5322 Appendix A.1.2. */
export const RFC5322_A12 = String.raw`From: "Joe Q. Public" <john.q.public@example.com>
To: Mary Smith <mary@x.test>, jdoe@example.org, Who? <one@y.test>
Cc: <boss@nil.test>, "Giant; \"Big\" Box" <sysservices@example.net>
Date: Tue, 1 Jul 2003 10:52:37 +0200
Message-ID: <5678.21-Nov-1997@example.com>

Hi everyone.
`;

/** RFC 5322 Appendix A.1.3. */
export const RFC5322_A13 = `From: Pete <pete@silly.example>
To: A Group:Ed Jones <c@a.test>,joe@where.test,John <jdoe@one.test>;
Cc: Undisclosed recipients:;
Date: Thu, 13 Feb 1969 23:32:54 -0330
Message-ID: <testabcd.1234@silly.example>

Testing.
`;

/** RFC 5322 Appendix A.2, the second message (a reply with Reply-To). */
export const RFC5322_A2_REPLY = `From: Mary Smith <mary@example.net>
To: John Doe <jdoe@machine.example>
Reply-To: "Mary Smith: Personal Account" <smith@home.example>
Subject: Re: Saying Hello
Date: Fri, 21 Nov 1997 10:01:10 -0600
Message-ID: <3456@example.net>
In-Reply-To: <1234@local.machine.example>
References: <1234@local.machine.example>

This is a reply to your hello.
`;

/** RFC 5322 Appendix A.3, the resent message. */
export const RFC5322_A3 = `Resent-From: Mary Smith <mary@example.net>
Resent-To: Jane Brown <j-brown@other.example>
Resent-Date: Mon, 24 Nov 1997 14:22:01 -0800
Resent-Message-ID: <78910@example.net>
From: John Doe <jdoe@machine.example>
To: Mary Smith <mary@example.net>
Subject: Saying Hello
Date: Fri, 21 Nov 1997 09:55:06 -0600
Message-ID: <1234@local.machine.example>

This is a message just to say hello.
So, "Hello".
`;

/** RFC 5322 Appendix A.4, trace fields. */
export const RFC5322_A4 = `Received: from x.y.test
   by example.net
   via TCP
   with ESMTP
   id ABC12345
   for <mary@example.net>;  21 Nov 1997 10:05:43 -0600
Received: from node.example by x.y.test; 21 Nov 1997 10:01:22 -0600
From: John Doe <jdoe@node.example>
To: Mary Smith <mary@example.net>
Subject: Saying Hello
Date: Fri, 21 Nov 1997 09:55:06 -0600
Message-ID: <1234@local.node.example>

This is a message just to say hello.
So, "Hello".
`;

/** RFC 5322 Appendix A.5, white space, comments and other oddities. */
export const RFC5322_A5 = String.raw`From: Pete(A nice \) chap) <pete(his account)@silly.test(his host)>
To:A Group(Some people)
     :Chris Jones <c@(Chris's host.)public.example>,
         joe@example.org,
  John <jdoe@one.test> (my dear friend); (the end of the group)
Cc:(Empty list)(start)Hidden recipients  :(nobody(that I know))  ;
Date: Thu,
      13
        Feb
          1969
      23:32
               -0330 (Newfoundland Time)
Message-ID:              <testabcd.1234@silly.test>

Testing.
`;

/** RFC 5322 Appendix A.6.1, obsolete addressing. */
export const RFC5322_A61 = `From: Joe Q. Public <john.q.public@example.com>
To: Mary Smith <@node.test:mary@example.net>, , jdoe@test  . example
Date: Tue, 1 Jul 2003 10:52:37 +0200
Message-ID: <5678.21-Nov-1997@example.com>

Hi everyone.
`;

/** RFC 5322 Appendix A.6.2, obsolete dates. */
export const RFC5322_A62 = `From: John Doe <jdoe@machine.example>
To: Mary Smith <mary@example.net>
Subject: Saying Hello
Date: 21 Nov 97 09:55:06 GMT
Message-ID: <1234@local.machine.example>

This is a message just to say hello.
So, "Hello".
`;

/** RFC 5322 Appendix A.6.3, obsolete white space and comments. The RFC writes the two-space line as "__". */
export const RFC5322_A63 = `From  : John Doe <jdoe@machine(comment).  example>
To    : Mary Smith
${'  '}
          <mary@example.net>
Subject     : Saying Hello
Date  : Fri, 21 Nov 1997 09(comment):   55  :  06 -0600
Message-ID  : <1234   @   local(blah)  .machine .example>

This is a message just to say hello.
So, "Hello".
`;

/** RFC 2047 §8, the header fields of the examples. */
export const RFC2047_HEADERS = `From: =?US-ASCII?Q?Keith_Moore?= <moore@cs.utk.edu>
To: =?ISO-8859-1?Q?Keld_J=F8rn_Simonsen?= <keld@dkuug.dk>
CC: =?ISO-8859-1?Q?Andr=E9?= Pirard <PIRARD@vm1.ulg.ac.be>
Subject: =?ISO-8859-1?B?SWYgeW91IGNhbiByZWFkIHRoaXMgeW8=?=
 =?ISO-8859-2?B?dSB1bmRlcnN0YW5kIHRoZSBleGFtcGxlLg==?=
`;

/** RFC 2047 §8, a name in a comment, encoded. */
export const RFC2047_COMMENT = `From: Nathaniel Borenstein <nsb@thumper.bellcore.com>
      (=?iso-8859-8?b?7eXs+SDv4SDp7Oj08A==?=)
To: Greg Vaudreuil <gvaudre@NRI.Reston.VA.US>, Ned Freed
   <ned@innosoft.com>, Keith Moore <moore@cs.utk.edu>
Subject: Test of new header generator
MIME-Version: 1.0
Content-type: text/plain; charset=ISO-8859-1
`;

/** RFC 2047 §8, the "encoded form → displayed as" table. */
export const RFC2047_TABLE = /** @type {[string, string][]} */ ([
  ['(=?ISO-8859-1?Q?a?=)', '(a)'],
  ['(=?ISO-8859-1?Q?a?= b)', '(a b)'],
  ['(=?ISO-8859-1?Q?a?= =?ISO-8859-1?Q?b?=)', '(ab)'],
  ['(=?ISO-8859-1?Q?a?=  =?ISO-8859-1?Q?b?=)', '(ab)'],
  ['(=?ISO-8859-1?Q?a?=\n    =?ISO-8859-1?Q?b?=)', '(ab)'],
  ['(=?ISO-8859-1?Q?a_b?=)', '(a b)'],
  ['(=?ISO-8859-1?Q?a?= =?ISO-8859-2?Q?_b?=)', '(a b)'],
]);

/** RFC 8601 Appendix B.1: no Authentication-Results. */
export const RFC8601_B1 = `Received: from mail-router.example.com
              (mail-router.example.com [192.0.2.1])
          by server.example.org (8.11.6/8.11.6)
              with ESMTP id g1G0r1kA003489;
          Fri, Feb 15 2002 17:19:07 -0800
From: sender@example.com
Date: Fri, Feb 15 2002 16:54:30 -0800
To: receiver@example.org
Message-Id: <12345.abc@example.com>
Subject: here's a sample

Hello!  Goodbye!
`;

/** RFC 8601 Appendix B.2: service provided, no authentication done. */
export const RFC8601_B2 = `Authentication-Results: example.org 1; none
${RFC8601_B1}`;

/** RFC 8601 Appendix B.3. */
export const RFC8601_B3 = `Authentication-Results: example.com;
          spf=pass smtp.mailfrom=example.net
Received: from dialup-1-2-3-4.example.net
              (dialup-1-2-3-4.example.net [192.0.2.200])
          by mail-router.example.com (8.11.6/8.11.6)
              with ESMTP id g1G0r1kA003489;
          Fri, Feb 15 2002 17:19:07 -0800
From: sender@example.net
Date: Fri, Feb 15 2002 16:54:30 -0800
To: receiver@example.com
Message-Id: <12345.abc@example.net>
Subject: here's a sample

Hello!  Goodbye!
`;

/** RFC 8601 Appendix B.4. */
export const RFC8601_B4 = `Authentication-Results: example.com;
          auth=pass (cram-md5) smtp.auth=sender@example.net;
          spf=pass smtp.mailfrom=example.net
Authentication-Results: example.com; iprev=pass
          policy.iprev=192.0.2.200
Received: from dialup-1-2-3-4.example.net (8.11.6/8.11.6)
              (dialup-1-2-3-4.example.net [192.0.2.200])
          by mail-router.example.com (8.11.6/8.11.6)
              with ESMTPA id g1G0r1kA003489;
          Fri, Feb 15 2002 17:19:07 -0800
Date: Fri, Feb 15 2002 16:54:30 -0800
To: receiver@example.com
From: sender@example.net
Message-Id: <12345.abc@example.net>
Subject: here's a sample

Hello!  Goodbye!
`;

/** RFC 8601 Appendix B.5: results from two MTAs of the same organisation. */
export const RFC8601_B5 = `Authentication-Results: example.com;
          dkim=pass (good signature) header.d=example.com
Received: from mail-router.example.com
              (mail-router.example.com [192.0.2.1])
          by auth-checker.example.com (8.11.6/8.11.6)
              with ESMTP id i7PK0sH7021929;
          Fri, Feb 15 2002 17:19:22 -0800
DKIM-Signature:  v=1; a=rsa-sha256; s=gatsby; d=example.com;
          t=1188964191; c=simple/simple; h=From:Date:To:Subject:
          Message-Id:Authentication-Results;
          bh=sEuZGD/pSr7ANysbY3jtdaQ3Xv9xPQtS0m70;
          b=EToRSuvUfQVP3Bkz ... rTB0t0gYnBVCM=
Authentication-Results: example.com;
          auth=pass (cram-md5) smtp.auth=sender@example.com;
          spf=fail smtp.mailfrom=example.com
Received: from dialup-1-2-3-4.example.net
              (dialup-1-2-3-4.example.net [192.0.2.200])
          by mail-router.example.com (8.11.6/8.11.6)
              with ESMTPA id g1G0r1kA003489;
          Fri, Feb 15 2002 17:19:07 -0800
From: sender@example.com
Date: Fri, Feb 15 2002 16:54:30 -0800
To: receiver@example.com
Message-Id: <12345.abc@example.com>
Subject: here's a sample

Hello!  Goodbye!
`;

/** RFC 8601 Appendix B.6: a results field written by another organisation (example.net) below the receiver's. */
export const RFC8601_B6 = `Authentication-Results: example.com;
      dkim=pass reason="good signature"
        header.i=@mail-router.example.net;
      dkim=fail reason="bad signature"
        header.i=@newyork.example.com
Received: from mail-router.example.net
          (mail-router.example.net [192.0.2.250])
      by chicago.example.com (8.11.6/8.11.6)
          for <recipient@chicago.example.com>
          with ESMTP id i7PK0sH7021929;
      Fri, Feb 15 2002 17:19:22 -0800
DKIM-Signature: v=1; a=rsa-sha256; s=furble;
      d=mail-router.example.net; t=1188964198; c=relaxed/simple;
      h=From:Date:To:Message-Id:Subject:Authentication-Results;
      bh=ftA9J6GtX8OpwUECzHnCkRzKw1uk6FNiLfJl5Nmv49E=;
      b=oINEO8hgn/gnunsg ... 9n9ODSNFSDij3=
Authentication-Results: example.net;
      dkim=pass (good signature) header.i=@newyork.example.com
Received: from smtp.newyork.example.com
          (smtp.newyork.example.com [192.0.2.220])
      by mail-router.example.net (8.11.6/8.11.6)
          with ESMTP id g1G0r1kA003489;
      Fri, Feb 15 2002 17:19:07 -0800
DKIM-Signature: v=1; a=rsa-sha256; s=gatsby;
      d=newyork.example.com;
      t=1188964191; c=simple/simple;
      h=From:Date:To:Message-Id:Subject;
      bh=sEu28nfs9fuZGD/pSr7ANysbY3jtdaQ3Xv9xPQtS0m7=;
      b=EToRSuvUfQVP3Bkz ... rTB0t0gYnBVCM=
From: sender@newyork.example.com
Date: Fri, Feb 15 2002 16:54:30 -0800
To: meetings@example.net
Message-Id: <12345.abc@newyork.example.com>
Subject: here's a sample
`;

/** RFC 8601 Appendix B.7, the comment-heavy field (value only). */
export const RFC8601_B7 = `foo.example.net (foobar) 1 (baz);
    dkim (Because I like it) / 1 (One yay) = (wait for it) fail
      policy (A dot can go here) . (like that) expired
      (this surprised me) = (as I wasn't expecting it) 1362471462`;

/** RFC 7208 §9.1 and §9.2, Received-SPF and Authentication-Results values. */
export const RFC7208_SPF = [
  `pass (mybox.example.org: domain of
 myname@example.com designates 192.0.2.1 as permitted sender)
    receiver=mybox.example.org; client-ip=192.0.2.1;
    envelope-from="myname@example.com"; helo=foo.example.com;`,
  `fail (mybox.example.org: domain of
                  myname@example.com does not designate
                  192.0.2.1 as permitted sender)
                  identity=mailfrom; client-ip=192.0.2.1;
                  envelope-from="myname@example.com";`,
  `pass (mybox.example.org: domain of
 myname@example.com designates 192.0.2.1 as permitted sender)
    receiver=mybox.example.org; client-ip=192.0.2.1;
    mechanism=ip4:192.0.2.1; envelope-from="myname@example.com";
    helo=foo.example.com;`,
];
export const RFC7208_AUTH_EXPANDED = `myhost.example.org; spf=pass
  reason="client-ip=192.0.2.1; smtp.helo=foo.example.com"
  smtp.mailfrom=user@example.net`;

/** RFC 8617 Appendix B, a message through three handlers with ARC sets (the RFC's page break inside it removed). */
export const RFC8617_B = `Return-Path: <jqd@d1.example>
Received: from example.org (example.org [208.69.40.157])
    by gmail.example with ESMTP id d200mr22663000ykb.93.1421363207
    for <fmartin@example.com>; Thu, 14 Jan 2015 15:02:40 -0800 (PST)
Received: from segv.d1.example (segv.d1.example [72.52.75.15])
    by lists.example.org (8.14.5/8.14.5) with ESMTP id t0EKaNU9010123
    for <arc@example.org>; Thu, 14 Jan 2015 15:01:30 -0800 (PST)
    (envelope-from jqd@d1.example)
Received: from [2001:DB8::1A] (w-x-y-z.dsl.static.isp.example [w.x.y.z])
    (authenticated bits=0)
    by segv.d1.example with ESMTP id t0FN4a8O084569;
    Thu, 14 Jan 2015 15:00:01 -0800 (PST)
    (envelope-from jqd@d1.example)
Received: from mail-ob0-f188.google.example
    (mail-ob0-f188.google.example [208.69.40.157]) by
    clochette.example.org with ESMTP id d200mr22663000ykb.93.1421363268
    for <fmartin@example.org>; Thu, 14 Jan 2015 15:03:15 -0800 (PST)
ARC-Seal: i=3; a=rsa-sha256; cv=pass; d=clochette.example.org; s=
        clochette; t=12345; b=CU87XzXlNlk5X/yW4l73UvPUcP9ivwYWxyBWcVrRs7
        +HPx3K05nJhny2fvymbReAmOA9GTH/y+k9kEc59hAKVg==
ARC-Message-Signature: i=3; a=rsa-sha256; c=relaxed/relaxed; d=
        clochette.example.org; h=message-id:date:from:to:subject; s=
        clochette; t=12345; bh=KWSe46TZKCcDbH4klJPo+tjk5LWJnVRlP5pvjXFZY
        LQ=; b=o71vwyLsK+Wm4cOSlirXoRwzEvi0vqIjd/2/GkYFYlSd/GGfKzkAgPqxf
        K7ccBMP7Zjb/mpeggswHjEMS8x5NQ==
ARC-Authentication-Results: i=3; clochette.example.org; spf=fail
    smtp.from=jqd@d1.example; dkim=fail (512-bit key)
    header.i=@d1.example; dmarc=fail; arc=pass (as.2.gmail.example=pass,
    ams.2.gmail.example=pass, as.1.lists.example.org=pass,
    ams.1.lists.example.org=fail (message has been altered))
Authentication-Results: clochette.example.org; spf=fail
    smtp.from=jqd@d1.example; dkim=fail (512-bit key)
    header.i=@d1.example; dmarc=fail; arc=pass (as.2.gmail.example=pass,
    ams.2.gmail.example=pass, as.1.lists.example.org=pass,
    ams.1.lists.example.org=fail (message has been altered))
ARC-Seal: i=2; a=rsa-sha256; cv=pass; d=gmail.example; s=20120806; t=
        12345; b=Zpukh/kJL4Q7Kv391FKwTepgS56dgHIcdhhJZjsalhqkFIQQAJ4T9BE
        8jjLXWpRNuh81yqnT1/jHn086RwezGw==
ARC-Message-Signature: i=2; a=rsa-sha256; c=relaxed/relaxed; d=
        gmail.example; h=message-id:date:from:to:subject; s=20120806; t=
        12345; bh=KWSe46TZKCcDbH4klJPo+tjk5LWJnVRlP5pvjXFZYLQ=; b=CVoG44
        cVZvoSs2mMig2wwqPaJ4OZS5XGMCegWqQs1wvRZJS894tJM0xO1RJLgCPsBOxdA5
        9WSqI9s9DfyKDfWg==
ARC-Authentication-Results: i=2; gmail.example; spf=fail
    smtp.from=jqd@d1.example; dkim=fail (512-bit key)
    header.i=@example.org; dmarc=fail; arc=pass
    (as.1.lists.example.org=pass, ams.1.lists.example.org=pass)
ARC-Seal: i=1; a=rsa-sha256; cv=none; d=lists.example.org; s=dk-lists;
         t=12345; b=TlCCKzgk3TrAa+G77gYYO8Fxk4q/Ml0biqduZJeOYh6+0zhwQ8u/
        lHxLi21pxu347isLSuNtvIagIvAQna9a5A==
ARC-Message-Signature: i=1; a=rsa-sha256; c=relaxed/relaxed; d=
        lists.example.org; h=message-id:date:from:to:subject; s=
        dk-lists; t=12345; bh=KWSe46TZKCcDbH4klJPo+tjk5LWJnVRlP5pvjXFZYL
        Q=; b=DsoD3n3hiwlrN1ma8IZQFgZx8EDO7Wah3hUjIEsYKuShRKYB4LwGUiKD5Y
        yHgcIwGHhSc/4+ewYqHMWDnuFxiQ==
ARC-Authentication-Results: i=1; lists.example.org; spf=pass
    smtp.mfrom=jqd@d1.example; dkim=pass (512-bit key)
    header.i=@d1.example; dmarc=pass
DKIM-Signature: v=1; a=rsa-sha1; c=relaxed/relaxed; d=d1.example; h=
        message-id:date:from:to:subject; s=origin2015; bh=bIxxaeIQvmOBdT
        AitYfSNFgzPP4=; b=qKjd5fYibKXWWIcMKCgRYuo1vJ2fD+IAQPjX+uamXIGY2Q
        0HjQ+Lq3/yHzG3JHJp6780/nKQPOWt2UDJQrJkEA==
Message-ID: <54B84785.1060301@d1.example>
Date: Thu, 14 Jan 2015 15:00:01 -0800
From: John Q Doe <jqd@d1.example>
To: arc@dmarc.example
Subject: [List 2] Example 1

Hey gang,
This is a test message.
--J.
`;

/**
 * Authentication-Results values printed by Microsoft (research §12): the DMARC page, two from "Email authentication
 * in Microsoft 365" (with the bare domain between results), and the ARC page. Folding as printed.
 */
export const MICROSOFT_AUTH = {
  alignment: `spf=pass (sender IP is 198.51.100.10)
  smtp.mailfrom=bounces.adatum.com; dkim=pass (signature was verified)
  header.d=adatum.com; dmarc=fail action=oreject
  header.from=contoso.com;compauth=fail reason=000`,
  spoof: `spf=none (sender IP is 192.168.1.8)
  smtp.mailfrom=maliciousdomain.com; contoso.com; dkim=pass
  (signature was verified) header.d=maliciousdomain.com;
  contoso.com; dmarc=none action=none header.from=contoso.com;
  compauth=fail reason=001`,
  bestGuess: `spf=pass (sender IP is 10.2.3.4)
  smtp.mailfrom=fabrikam.com; contoso.com; dkim=none
  (message not signed) header.d=none; contoso.com; dmarc=bestguesspass
  action=none header.from=fabrikam.com; compauth=pass reason=109`,
  arcOverride: `spf=fail (sender IP is 10.10.10.10)
smtp.mailfrom=contoso.com; dkim=fail (body hash did not verify)
header.d=contoso.com;dmarc=fail action=none
header.from=contoso.com;compauth=pass reason=130`,
};

/** Microsoft's ARC-Authentication-Results example (value only), with an authserv-id. */
export const MICROSOFT_ARC_RESULTS = `i=2; mx.microsoft.com 1; spf=pass (sender ip is
172.17.17.17) smtp.rcpttodomain=microsoft.com
smtp.mailfrom=sampledoamin.onmicrosoft.com; dmarc=bestguesspass action=none
header.from=sampledoamin.onmicrosoft.com; dkim=none (message not signed);
arc=pass (0 oda=1 ltdi=1
spf=[1,1,smtp.mailfrom=sampledoamin.onmicrosoft.com]
dkim=[1,1,header.d=sampledoamin.onmicrosoft.com]
dmarc=[1,1,header.from=sampledoamin.onmicrosoft.com])`;

/** Microsoft's sample Received lines and X-OriginalArrivalTime ("View internet message headers", research §6). */
export const MICROSOFT_RECEIVED = [
  'from mail.litwareinc.com ([10.54.108.101]) by mail.proseware.com with Microsoft SMTPSVC(6.0.3790.0); Tue, 12 Dec 2017 13:39:22 -0800',
  'from mail ([10.54.108.23] RDNS failed) by mail.litware.com with Microsoft SMTPSVC(6.0.3790.0);',
];
export const MICROSOFT_ARRIVAL = '12 Dec 2017 21:38:50.0145 (UTC)';

/** Every whole message above, for the tests that cut and mangle input. */
export const ALL_MESSAGES = [
  RFC5322_A11, RFC5322_A11_SENDER, RFC5322_A12, RFC5322_A13, RFC5322_A2_REPLY, RFC5322_A3, RFC5322_A4, RFC5322_A5, RFC5322_A61, RFC5322_A62, RFC5322_A63,
  RFC2047_HEADERS, RFC2047_COMMENT, RFC8601_B1, RFC8601_B2, RFC8601_B3, RFC8601_B4, RFC8601_B5, RFC8601_B6, RFC8617_B,
];

// @ts-check
/**
 * @file Link checker: site names from the Public Suffix List, links in messages and pasted HTML, and the tricks phishing links use.
 */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { describe, it } from 'node:test';
import { anchorsFromHtml, carriedValues, findLinks, refang, unwrap } from '../src/client/link-text.mjs';
import { inspectLink, inspectText, linkParts, siteOf } from '../src/client/tool-check.mjs';
import { staleDataWarnings } from '../src/build/build.mjs';

/** @typedef {import('../src/client/tool-check.mjs').LinkReport} LinkReport */

/**
 * Every link in a text, asserting that some were found.
 * @param {string} text
 * @param {string} [html]
 */
const scan = (text, html) => {
  const result = inspectText(text, html);
  assert.equal(result.status, 'ok', `links should be found in: ${text}`);
  return /** @type {{ status: 'ok', links: LinkReport[], total: number }} */ (result);
};

/** @param {string} input @returns {LinkReport} */
const check = (input) => {
  const report = inspectLink(input);
  assert.equal(report.status, 'ok', `${input} should be a valid link`);
  return /** @type {LinkReport} */ (report);
};

describe('link checker: the site name comes from the Public Suffix List', () => {
  it('finds the registered name under any country ending', () => {
    assert.deepEqual(siteOf('www.paypal.co.id'), { site: 'paypal.co.id', suffix: 'co.id', shared: false });
    assert.deepEqual(siteOf('a.b.example.com.ge'), { site: 'example.com.ge', suffix: 'com.ge', shared: false });
    assert.deepEqual(siteOf('my.gov.ge'), { site: 'my.gov.ge', suffix: 'gov.ge', shared: false });
    assert.deepEqual(siteOf('example.გე'), { site: 'example.გე', suffix: 'გე', shared: false }, 'the Georgian ending in Georgian letters');
  });

  it('treats free hosting as a suffix: the page name is the site', () => {
    for (const [host, suffix] of [['tbc-login.pages.dev', 'pages.dev'], ['someone.github.io', 'github.io'], ['x.web.app', 'web.app'], ['x.vercel.app', 'vercel.app'], ['x.netlify.app', 'netlify.app'], ['x.y.workers.dev', 'workers.dev'], ['x.blogspot.com', 'blogspot.com'], ['x.firebaseapp.com', 'firebaseapp.com']]) {
      const found = siteOf(host);
      assert.equal(found.suffix, suffix, host);
      assert.equal(found.shared, true, host);
      assert.ok(host.endsWith(found.site), host);
    }
    assert.equal(siteOf('x.y.workers.dev').site, 'y.workers.dev');
  });

  it('follows the list’s wildcard and exception rules', () => {
    assert.equal(siteOf('a.b.c.ck').site, 'b.c.ck', '"*.ck": every name under .ck is an ending');
    assert.equal(siteOf('www.ck').site, 'www.ck', '"!www.ck" is the exception');
    assert.equal(siteOf('example.unknownending').site, 'example.unknownending', 'an ending the list does not know counts as one label');
  });

  it('warns when the copy of the list is old', () => {
    assert.deepEqual(staleDataWarnings(new Date('2026-11-13T00:00:00Z'), '2026-11-13'), []);
    const [warning] = staleDataWarnings(new Date('2027-06-01T00:00:00Z'), '2026-11-13');
    assert.match(warning, /Public Suffix List is 200 days old/);
    assert.match(warning, /node scripts\/update-psl\.mjs/);
  });
});

describe('link checker: what the reviewer found', () => {
  it('free hosting: the page name is the site, with its own warning', () => {
    const report = check('https://tbc-login.pages.dev/auth');
    assert.equal(report.site, 'tbc-login.pages.dev');
    assert.ok(report.warnings.includes('sharedHost'));
    assert.equal(report.details.suffix, 'pages.dev');
    assert.ok(report.warnings.includes('brandLookalike'), 'and "tbc" next to "login" is still an imitation');
  });

  it('a brand under its own country ending is not flagged', () => {
    const report = check('https://www.paypal.co.id/signin');
    assert.equal(report.site, 'paypal.co.id');
    assert.deepEqual(report.warnings, []);
  });

  it('a name with one official home is flagged under any other ending', () => {
    const report = check('https://tbcbank.xyz/login');
    assert.deepEqual(report.warnings, ['brandElsewhere']);
    assert.equal(report.details.brand, 'tbcbank');
    assert.equal(report.details.official, 'tbcbank.ge');
    assert.deepEqual(check('https://www.tbcbank.ge/').warnings, []);
  });

  it('digits for letters inside one part of a hyphenated name', () => {
    const report = check('https://paypa1-login.com/');
    assert.deepEqual(report.warnings, ['typo']);
    assert.equal(report.details.brand, 'paypal');
  });

  it('Latin look-alike letters that are not plain ASCII', () => {
    const report = check('https://xn--paypa-r4a.com/');
    assert.equal(report.site, 'paypaı.com');
    assert.deepEqual(report.warnings, ['latinLookalike']);
    assert.equal(report.details.brand, 'paypal');
    assert.equal(report.asciiHost, 'xn--paypa-r4a.com', 'the xn-- form is shown next to the letters');
    assert.deepEqual(check('https://paypaı.com/').warnings, ['latinLookalike'], 'typed in letters too');
    assert.deepEqual(check('https://müller.de/').warnings, [], 'an ordinary name with an accent is not a trick');
  });

  it('another address carried inside the link', () => {
    const report = check('https://example.com/out?next=https://evil.top/login');
    assert.deepEqual(report.warnings, ['carriedUrl']);
    assert.equal(report.details.inner, 'evil.top');
    assert.deepEqual(check('https://accounts.google.com/signin?continue=https%3A%2F%2Fmail.google.com%2F').warnings, [], 'a login that returns you to the same site is normal');
    assert.deepEqual(check('https://example.com/go/https%3A%2F%2Fevil.top%2F').warnings, ['carriedUrl'], 'in the path too');
  });

  it('mail-security wrappers are unwrapped', () => {
    const wrapped = `https://eur01.safelinks.protection.outlook.com/?url=${encodeURIComponent('https://evil.top/login')}&data=05%7C02%7C&sdata=abc&reserved=0`;
    const report = check(wrapped);
    assert.equal(report.site, 'evil.top');
    assert.deepEqual(report.via, ['eur01.safelinks.protection.outlook.com']);
    assert.ok(report.warnings.includes('redirect'));
  });

  it('several layers of redirect pages are unwrapped, as in the cleaner', () => {
    const google = `https://www.google.com/url?q=${encodeURIComponent('https://paypal-verify.com/')}`;
    const report = check(`https://l.facebook.com/l.php?u=${encodeURIComponent(google)}`);
    assert.equal(report.site, 'paypal-verify.com');
    assert.deepEqual(report.via, ['l.facebook.com', 'www.google.com']);
  });

  it('links without https:// or www. are found in a message', () => {
    const result = scan('GPost: ამანათი გაჩერებულია საბაჟოზე. გადაიხადეთ 1.99 ₾: gpost-ge.info/track?id=77 დღესვე');
    assert.equal(result.links.length, 1);
    assert.equal(result.links[0].site, 'gpost-ge.info');
    assert.ok(result.links[0].warnings.includes('brandLookalike'));
  });

  it('defanged links are read', () => {
    const report = check('hxxps://evil[.]top/login');
    assert.equal(report.site, 'evil.top');
    assert.equal(report.url, 'https://evil.top/login');
    assert.equal(report.defanged, true);
  });

  it('a real address used as a folder name', () => {
    const report = check('https://evil.top/tbcbank.ge/login');
    assert.deepEqual(report.warnings, ['brandPath']);
    assert.equal(report.details.brand, 'tbcbank');
    assert.deepEqual(check('https://www.tbcbank.ge/tbcbank.ge/').warnings, [], 'on the brand’s own site it is not a trick');
  });

  it('data: and javascript: addresses say what they are', () => {
    assert.deepEqual(inspectLink('data:text/html,<script>alert(1)</script>'), { status: 'scheme', scheme: 'data' });
    assert.deepEqual(inspectLink('javascript:alert(1)'), { status: 'scheme', scheme: 'javascript' });
    assert.deepEqual(inspectLink('mailto:a@example.com'), { status: 'scheme', scheme: 'other' });
    assert.deepEqual(inspectLink('just words'), { status: 'invalid' });
  });

  it('a short brand name as one part of an ordinary name is not flagged', () => {
    assert.deepEqual(check('https://apple-tree.ge/').warnings, []);
    assert.deepEqual(check('https://ups-and-downs.com/').warnings, []);
    assert.deepEqual(check('https://secure-apple.com/id').warnings, ['brandLookalike'], 'next to a word a lure uses, it still is');
    assert.deepEqual(check('https://apple-id-verify.com/').warnings, ['brandLookalike']);
  });
});

describe('link checker: new warning signs', () => {
  it('an email address carried in the link', () => {
    const report = check('https://example.com/track?u=nino%40example.org&c=4');
    assert.deepEqual(report.warnings, ['carriedEmail']);
    assert.equal(report.details.email, 'nino@example.org');
    assert.deepEqual(check('https://example.com/r/nino@example.org').warnings, ['carriedEmail']);
  });

  it('the visible text of a link names another site than the one it leads to', () => {
    const html = '<p>Sign in at <a href="https://tbc-secure.top/login">https://www.tbcbank.ge/</a> today</p>';
    const result = scan('Sign in at https://www.tbcbank.ge/ today', html);
    assert.equal(result.links.length, 1);
    const [link] = result.links;
    assert.equal(link.site, 'tbc-secure.top');
    assert.equal(link.warnings[0], 'textMismatch', 'listed first: it is the strongest sign');
    assert.equal(link.details.shown, 'tbcbank.ge');
  });

  it('a link whose text is a word is checked by where it leads, without a mismatch', () => {
    const result = scan('Click here to pay', '<a href="https://evil.top/pay">Click here</a> to pay');
    assert.equal(result.links[0].site, 'evil.top');
    assert.equal(result.links[0].shown, 'Click here');
    assert.ok(!result.links[0].warnings.includes('textMismatch'));
  });

  it('a pasted link whose words were deleted from the box is no longer checked', () => {
    const html = '<a href="https://evil.top/">Pay here</a> or <a href="https://www.tbcbank.ge/">tbcbank.ge</a>';
    const result = scan('Sign in at\ntbcbank.ge', html);
    assert.deepEqual(result.links.map((link) => link.site), ['tbcbank.ge']);
  });

  it('every link in a message gets its own verdict', () => {
    const result = scan('Old: https://www.tbcbank.ge/ New: paypal-login.com and http://192.168.0.1/');
    assert.deepEqual(result.links.map((link) => link.site), ['tbcbank.ge', 'paypal-login.com', '192.168.0.1']);
    assert.deepEqual(result.links.map((link) => link.warnings), [[], ['brandLookalike'], ['http', 'ip']]);
    assert.equal(result.total, 3);
  });

  it('the same link twice is checked once, and a very long message is capped', () => {
    assert.equal(scan('a https://x.com/ b https://x.com/').links.length, 1);
    const many = Array.from({ length: 30 }, (_, i) => `https://site${i}.com/`).join(' ');
    const result = scan(many);
    assert.equal(result.links.length, 10);
    assert.equal(result.total, 30);
  });
});

describe('link checker: the address, as browsers show it', () => {
  it('splits the address around the real site', () => {
    assert.deepEqual(linkParts('https://login.tbcbank.ge.secure-pay.top:8443/a/b?c=1#d', 'secure-pay.top'), {
      before: 'https://login.tbcbank.ge.',
      site: 'secure-pay.top',
      after: ':8443/a/b?c=1#d',
    });
    assert.deepEqual(linkParts('https://xn--80ak6aa92e.com/', 'аррӏе.com'), { before: 'https://', site: 'аррӏе.com', after: '/' });
  });
});

describe('shared link reading (link checker and cleaner)', () => {
  it('finds bare addresses only when asked, and not emails, versions or file names', () => {
    const text = 'Pay at gpost-ge.info/track?id=1, write to help@example.org, see v1.2.3, open report.pdf, e.g. this, or example.გე.';
    assert.deepEqual(findLinks(text, { bare: true }).map((link) => link.text), ['gpost-ge.info/track?id=1', 'example.გე']);
    assert.deepEqual(findLinks(text).map((link) => link.text), [], 'the cleaner keeps its current behaviour until its own change');
  });

  it('reads defanged addresses', () => {
    assert.equal(refang('hxxps://evil[.]top/a hXXp://b(.)ge c[dot]com d[:]//e'), 'https://evil.top/a http://b.ge c.com d://e');
    assert.equal(refang('nothing [here] (really)'), 'nothing [here] (really)');
  });

  it('unwraps up to five layers and names each one', () => {
    let link = 'https://evil.top/';
    for (let i = 0; i < 7; i += 1) link = `https://www.google.com/url?q=${encodeURIComponent(link)}`;
    const result = unwrap(new URL(link));
    assert.equal(result.via.length, 5);
    assert.equal(result.url.hostname, 'www.google.com', 'stops after five');
  });

  it('unwraps the mail-security wrappers whose format the vendor documents', () => {
    const target = 'https://evil.top/login?a=1';
    const cases = [
      // Proofpoint v2: percent-encoding with "-" for "%" and "_" for "/" (Proofpoint's urldecoder.py).
      ['https://urldefense.proofpoint.com/v2/url?u=https-3A__evil.top_login-3Fa-3D1&d=DwMF&c=x&r=y&m=z&s=w&e=', 'urldefense.proofpoint.com'],
      // Proofpoint v3: "*" stands for characters kept, base64url-encoded, after "__;".
      ['https://urldefense.com/v3/__https://evil.top/login*a=1__;Pw!!abc!def$', 'urldefense.com'],
      ['https://linkprotect.cudasvc.com/url?a=https%3A%2F%2Fevil.top%2Flogin%3Fa%3D1&c=E,1,xyz&typo=1', 'linkprotect.cudasvc.com'],
      ['https://secure-web.cisco.com/1duptzzum1fZ53w/https%3A%2F%2Fevil.top%2Flogin%3Fa%3D1', 'secure-web.cisco.com'],
      ['https://ems-urlprotect.trendmicro.com:443/wis/clicktime/v1/query?url=https%3A%2F%2Fevil.top%2Flogin%3Fa%3D1&umid=abc', 'ems-urlprotect.trendmicro.com'],
      ['https://evil-top.cdn.ampproject.org/c/s/evil.top/login?a=1', 'evil-top.cdn.ampproject.org'],
    ];
    for (const [link, via] of cases) {
      const result = unwrap(new URL(link));
      assert.equal(result.url.href, target, link);
      assert.deepEqual(result.via, [via], link);
    }
    assert.equal(unwrap(new URL('https://evil-top.cdn.ampproject.org/c/evil.top/x')).url.href, 'http://evil.top/x', 'without "s" the original was http');
  });

  it('says when a wrapper hides the address entirely', () => {
    for (const link of ['https://protect-eu.mimecast.com/s/1dBvZWHZ', 'https://url.uk.m.mimecastprotect.com/s/AbCdEf']) {
      const report = check(link);
      assert.deepEqual(report.warnings, ['hiddenTarget'], link);
      assert.equal(report.details.via, new URL(link).hostname);
    }
  });

  it('reads the links out of pasted HTML without a parser', () => {
    assert.deepEqual(
      anchorsFromHtml(`<div><a class="x" href='https://a.example/?q=1&amp;r=2'><b>Bold</b> text</a> <A HREF="https://b.example/">b.example</A><a name="x">no href</a><a href="javascript:void(0)">js</a></div>`),
      [
        { href: 'https://a.example/?q=1&r=2', text: 'Bold text' },
        { href: 'https://b.example/', text: 'b.example' },
        { href: 'javascript:void(0)', text: 'js' },
      ],
    );
    assert.deepEqual(anchorsFromHtml('plain text'), []);
  });

  it('lists the addresses and emails carried in a link', () => {
    assert.deepEqual(carriedValues(new URL('https://example.com/r/https%3A%2F%2Fa.example%2F?to=b%40c.example&x=www.d.example#u=https://e.example/')), {
      urls: ['https://a.example/', 'https://www.d.example', 'https://e.example/'],
      emails: ['b@c.example'],
    });
  });
});

describe('link checker: the "nothing found" state', () => {
  it('is neutral, not a green tick of approval', async () => {
    const css = await readFile(new URL('../src/styles/05-components.css', import.meta.url), 'utf8');
    const base = /\n {2}\.verdict \{([^}]*)\}/.exec(css)?.[1] ?? '';
    assert.doesNotMatch(base, /accent|success|green/, 'the default (no warnings) look uses no approving colour');
  });
});

/* ---------- Review of 2026-11-13 ---------- */

/** @param {string} input */
const warnings = (input) => check(input).warnings;

describe('link checker review: verdicts about the right site', () => {
  it('1.1 a redirect page counts only on the service’s own site', () => {
    for (const fake of ['https://google.com.evil.top/url?q=https://tbcbank.ge/', 'https://google.evil.com/url?q=https://tbcbank.ge/login', 'https://www.google.co.evil.top/url?q=https://tbcbank.ge/']) {
      const report = check(fake);
      assert.notEqual(report.site, 'tbcbank.ge', fake);
      assert.ok(!report.warnings.includes('redirect'), `${fake}: not a Google redirect`);
    }
    assert.equal(check('https://www.google.com.ge/url?q=https://tbcbank.ge/').site, 'tbcbank.ge', 'Google’s own country site still unwraps');
    assert.equal(check('https://www.google.co.uk/url?q=https://tbcbank.ge/').site, 'tbcbank.ge');
    const lookalikes = [
      'https://l.facebook.com.evil.top/l.php?u=https://tbcbank.ge/',
      'https://www.youtube.com.evil.top/redirect?q=https://tbcbank.ge/',
      'https://out.reddit.com.evil.top/?url=https://tbcbank.ge/',
      'https://www.linkedin.com.evil.top/redir/redirect?url=https://tbcbank.ge/',
      'https://eur01.safelinks.protection.outlook.com.evil.top/?url=https://tbcbank.ge/',
      'https://linkprotect.cudasvc.com.evil.top/url?a=https://tbcbank.ge/',
      'https://x.trendmicro.com.evil.top/wis/clicktime/v1/query?url=https://tbcbank.ge/',
      'https://protect-eu.mimecast.com.evil.top/s/abc',
    ];
    for (const fake of lookalikes) assert.equal(check(fake).site, 'evil.top', fake);
  });

  it('1.2 ordinary words and places are not brand typos', () => {
    for (const word of ['https://finance.ge/', 'https://cooking.com/', 'https://revolt.com', 'https://telavi.ge', 'https://goggle.com', 'https://telegra.ph/']) {
      assert.ok(!warnings(word).includes('typo'), word);
    }
    // A one-letter change still counts with a second sign, or for a name used only by one Georgian company.
    assert.ok(warnings('https://gooogle-login.com/').includes('typo'));
    assert.ok(warnings('https://tbcbamk.ge/').includes('typo'));
    assert.ok(warnings('https://paypa1-login.com/').includes('typo'), 'digits for letters stay a sign on their own');
  });

  it('1.3 links between one owner’s own sites are not suspicious', () => {
    for (const link of [
      'https://accounts.google.com/ServiceLogin?continue=https://www.youtube.com/',
      'https://www.tbcbank.ge/go?to=https://tbconline.ge/',
      'https://web.archive.org/web/2020/https://google.com/',
      'https://www.facebook.com/sharer/sharer.php?u=https://netgazeti.ge/news/1',
      'https://www.instagram.com/accounts/login/?next=https://www.facebook.com/',
    ]) {
      assert.deepEqual(warnings(link).filter((w) => w === 'brandPath' || w === 'carriedUrl'), [], link);
    }
    assert.ok(warnings('https://example.com/out?next=https://evil.top/login').includes('carriedUrl'), 'an unknown site passing you on is still noted');
    assert.ok(warnings('https://evil.top/tbcbank.ge/login').includes('brandPath'));
  });

  it('1.4 a Georgian service’s other real addresses are its own; other companies get a plain statement', () => {
    for (const own of ['https://tbcbank.com.ge/', 'https://tbcbank.com/', 'https://bankofgeorgia.com/', 'https://silknet.ge/']) assert.deepEqual(warnings(own), [], own);
    const foreign = check('https://libertybank.com/');
    assert.deepEqual(foreign.warnings, ['brandElsewhere']);
    assert.equal(foreign.details.official, 'libertybank.ge');
  });

  it('1.6 mail click-tracking links say the service holds the address, without a mismatch', () => {
    const { links } = scan('Visit example.com today', '<a href="https://example.us5.list-manage.com/track/click?u=1&id=2">example.com</a>');
    assert.ok(!links[0].warnings.includes('textMismatch'));
    assert.ok(links[0].warnings.includes('mailTracking'));
    const tbc = check('https://tbc.us5.list-manage.com/track/click?u=1&id=2');
    assert.deepEqual(tbc.warnings, ['mailTracking'], 'no brand warning for the sender’s account name');
    for (const link of ['https://u123.ct.sendgrid.net/ls/click?upn=abc', 'https://r20.rs6.net/tn.jsp?f=abc', 'https://trk.klclick.com/ls/click?upn=abc', 'https://trk.klclick1.com/ls/click?upn=abc']) {
      assert.deepEqual(warnings(link), ['mailTracking'], link);
    }
    assert.ok(!warnings('https://list-manage.com.evil.top/track/click?u=1').includes('mailTracking'));
  });

  it('1.7 pages anyone can publish on trusted domains are named, and brands in their path count', () => {
    for (const link of ['https://sites.google.com/view/tbc-bonus', 'https://docs.google.com/forms/d/e/abc/viewform', 'https://forms.gle/abc', 'https://t.me/tbc_bonus_bot', 'https://phish123.googleusercontent.com/login.html', 'https://s3.amazonaws.com/bucket/login.html', 'https://ipfs.io/ipfs/Qm/login.html', 'https://telegra.ph/TBC-bonus-11-13']) {
      assert.ok(warnings(link).includes('publicPage') || warnings(link).includes('sharedHost'), link);
    }
    for (const link of ['https://sites.google.com/view/tbc-bonus', 'https://t.me/tbc_bonus_bot', 'https://telegra.ph/TBC-bonus-11-13']) {
      assert.ok(warnings(link).includes('brandPath'), `${link}: the brand named in the page’s path`);
    }
    assert.deepEqual(warnings('https://docs.google.com/document/d/abc/edit'), [], 'an ordinary document link');
    assert.deepEqual(warnings('https://t.me/durov'), ['publicPage']);
  });

  it('1.8 a global brand under an unusual generic ending is flagged; its country sites are not', () => {
    for (const link of ['https://paypal.top/login', 'https://netflix.xyz', 'https://amazon.click/', 'https://apple.online/']) assert.ok(warnings(link).includes('brandElsewhere'), link);
    for (const link of ['https://www.amazon.de/dp/B0', 'https://www.paypal.co.id/signin', 'https://google.ge/']) assert.deepEqual(warnings(link), [], link);
  });

  it('a Mastodon address is not an email address', () => {
    assert.ok(!warnings('https://mastodon.social/@user@example.org/123').includes('carriedEmail'));
    assert.ok(warnings('https://example.com/unsubscribe?email=me@example.org').includes('carriedEmail'));
  });
});

describe('link checker review: what stays on screen', async () => {
  const { pastedHtml } = await import('../src/client/tool-check.mjs');
  it('the links of a paste count only while its text is still in the box', () => {
    const pastes = [
      { html: '<a href="https://evil.top/x"><img src="a.png"></a>', text: 'Click the picture to claim' },
      { html: '<a href="https://evil2.top/">www.tbcbank.ge</a>', text: 'Open www.tbcbank.ge now' },
    ];
    assert.equal(pastedHtml(pastes, 'totally new text'), '', 'replaced text leaves no old links behind');
    assert.match(pastedHtml(pastes, 'Click the picture to claim'), /evil\.top/);
    assert.doesNotMatch(pastedHtml(pastes, 'Click the picture to claim'), /evil2/);
    assert.equal(scan('totally new text www.example.org', pastedHtml(pastes, 'totally new text www.example.org')).links.length, 1);
  });
});

describe('filling sentences with values from files and links', async () => {
  const { fillText } = await import('../src/client/fill.mjs');
  it('shows "$&", "$`" and "$\'" in a value as written', () => {
    assert.equal(fillText('Author: {values}.', { values: 'Nino $& co $` $\'' }), 'Author: Nino $& co $` $\'.');
    assert.equal(fillText('{a} and {missing}', { a: '1' }), '1 and {missing}');
  });
});

// @ts-check
/**
 * @file Link cleaner: shared link reading, trackers in the path and the fragment, what was removed, and share links.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { cleanText, cleanUrl } from '../src/client/tool-links.mjs';

/** @typedef {Extract<import('../src/client/tool-links.mjs').CleanResult, { status: 'ok' }>} Clean */

/** @param {string} input @returns {Clean} */
const clean = (input) => {
  const result = cleanUrl(input);
  assert.equal(result.status, 'ok', `${input} should be a valid link`);
  return /** @type {Clean} */ (result);
};

/** @param {string} input */
const cleanAll = (input) => {
  const result = cleanText(input);
  assert.equal(result.status, 'ok', `links should be found in: ${input}`);
  return /** @type {Extract<ReturnType<typeof cleanText>, { status: 'ok' }>} */ (result);
};

describe('link cleaner: the fragment', () => {
  it('removes a text fragment, which shows what the sharer highlighted', () => {
    const result = clean('https://example.com/a#:~:text=the%20bit%20I%20read');
    assert.equal(result.url, 'https://example.com/a');
    assert.deepEqual(result.removed, ['#:~:text']);
    assert.equal(clean('https://example.com/a#intro:~:text=x').url, 'https://example.com/a#intro', 'the page’s own anchor stays');
    assert.equal(clean('https://example.com/a#intro').url, 'https://example.com/a#intro');
  });
});

describe('link cleaner: shared link reading with the checker', () => {
  it('finds links written without https:// in a message, and keeps them as written', () => {
    const result = cleanAll('Look: example.com/a?utm_source=x&id=2 and bye');
    assert.equal(result.url, 'Look: example.com/a?id=2 and bye');
    assert.equal(result.links, 1);
  });

  it('unwraps mail-security wrappers and AMP pages', () => {
    assert.equal(clean(`https://eur01.safelinks.protection.outlook.com/?url=${encodeURIComponent('https://example.com/news?utm_source=mail')}&data=05`).url, 'https://example.com/news');
    assert.equal(clean('https://www-example-com.cdn.ampproject.org/c/s/www.example.com/news?utm_source=x').url, 'https://www.example.com/news');
  });
});

describe('link cleaner: what was removed', () => {
  it('splits the original link into kept and removed parts', () => {
    assert.deepEqual(clean('https://example.com/?id=7&utm_source=fb#x').parts, [
      { text: 'https://example.com/?id=7', removed: false },
      { text: '&utm_source=fb', removed: true },
      { text: '#x', removed: false },
    ]);
    assert.deepEqual(clean('https://example.com/?utm_source=fb&id=7').parts, [
      { text: 'https://example.com/', removed: false },
      { text: '?utm_source=fb', removed: true },
      { text: '&id=7', removed: false },
    ]);
    assert.equal(clean('https://example.com/?utm_source=fb&id=7').url, 'https://example.com/?id=7');
  });

  it('marks the whole link when a redirect page was skipped', () => {
    const input = 'https://www.google.com/url?q=https://example.org/';
    assert.deepEqual(clean(input).parts, [{ text: input, removed: true }]);
  });

  it('marks the parts across a whole message', () => {
    assert.deepEqual(cleanAll('a https://e.com/?utm_source=1 b').parts, [
      { text: 'a https://e.com/', removed: false },
      { text: '?utm_source=1', removed: true },
      { text: ' b', removed: false },
    ]);
  });
});

describe('link cleaner: rules for the sites people share from (sources in docs/research/tool-link-cleaner.md)', () => {
  it('AliExpress', () => {
    const result = clean('https://www.aliexpress.com/item/1005006.html?spm=a2g0o.home.0&algo_exp_id=abc-1&pdp_npi=4%40dis&gatewayAdapt=glo2usa&curPageLogUid=xyz');
    assert.equal(result.url, 'https://www.aliexpress.com/item/1005006.html');
  });

  it('Amazon, including the "/ref=" part of the path; the product variant (psc) stays', () => {
    const result = clean('https://www.amazon.com/dp/B0BSHF7WHW/ref=sr_1_3?crid=2X&keywords=macbook&qid=1700&sprefix=mac%2Caps&sr=8-3&th=1&psc=1&tag=someone-20');
    assert.equal(result.url, 'https://www.amazon.com/dp/B0BSHF7WHW?psc=1');
    assert.ok(result.removed.includes('/ref='));
    assert.equal(clean('https://www.amazon.de/Some-Product/dp/B0/ref=sr_1_1').url, 'https://www.amazon.de/Some-Product/dp/B0');
    assert.equal(clean('https://example.com/ref=1/x?keywords=a').url, 'https://example.com/ref=1/x?keywords=a', 'only on Amazon');
  });

  it('Google search keeps the query and drops the session markers', () => {
    assert.equal(clean('https://www.google.com/search?q=privacy+tbilisi&sca_esv=1&ei=AbC&ved=2ahU&oq=privacy&gs_lp=Egx&sclient=gws-wiz&uact=5&rlz=1C1&client=firefox-b-d&source=hp').url, 'https://www.google.com/search?q=privacy+tbilisi');
    assert.equal(clean('https://www.google.com/maps?client=x&source=y').url, 'https://www.google.com/maps?client=x&source=y', 'search pages only');
  });

  it('LinkedIn, Facebook, TikTok, Threads, Reddit and X', () => {
    assert.equal(clean('https://www.linkedin.com/in/someone?trk=public_post&lipi=urn%3Ali&trackingId=abc').url, 'https://www.linkedin.com/in/someone');
    assert.equal(clean('https://www.facebook.com/groups/1/posts/2/?__cft__[0]=AZW&__tn__=%2CO').url, 'https://www.facebook.com/groups/1/posts/2/');
    assert.equal(clean('https://www.tiktok.com/@user/video/1?_t=8x&refer=embed&embed_source=x').url, 'https://www.tiktok.com/@user/video/1');
    assert.equal(clean('https://www.threads.net/@user/post/abc?xmt=AQG').url, 'https://www.threads.net/@user/post/abc');
    assert.equal(clean('https://www.reddit.com/r/privacy/comments/1/x/?share_id=NHE&utm_medium=android_app').url, 'https://www.reddit.com/r/privacy/comments/1/x/');
    assert.equal(clean('https://x.com/user/status/1?s=46&t=abc&cxt=Hh').url, 'https://x.com/user/status/1');
  });
});

describe('link cleaner: share links that can’t be cleaned offline', () => {
  it('TikTok share links are tied to the account that made them', () => {
    for (const link of ['https://vm.tiktok.com/ZMabc123/', 'https://vt.tiktok.com/ZSabc/', 'https://www.tiktok.com/t/ZTabc/']) {
      const result = clean(link);
      assert.deepEqual(result.shared, ['TikTok'], link);
      assert.deepEqual(result.lookup, [], link);
    }
  });

  it('other short share links are looked up when opened: say so instead of "nothing to remove"', () => {
    for (const [link, name] of [['https://www.facebook.com/share/p/1AbCdEf/', 'Facebook'], ['https://www.instagram.com/share/reel/BAbc/', 'Instagram'], ['https://www.reddit.com/r/privacy/s/XaJ5kGdbva', 'Reddit'], ['https://pin.it/3abcDEF', 'Pinterest']]) {
      const result = clean(link);
      assert.deepEqual(result.lookup, [name], link);
      assert.deepEqual(result.shared, [], link);
    }
    assert.deepEqual(clean('https://www.facebook.com/someone/posts/1').lookup, [], 'an ordinary address');
  });
});

describe('link cleaner: review of 2026-11-13', () => {
  /** @param {string} text */
  const ok = (text) => {
    const result = cleanText(text);
    assert.equal(result.status, 'ok', text);
    return /** @type {Extract<ReturnType<typeof cleanText>, { status: 'ok' }>} */ (result);
  };

  it('7.1 warns about an email address or a sign-in code in a link, and keeps them', () => {
    const login = ok('https://example.com/login?token=abc&email=me@example.com');
    assert.deepEqual(login.emails, ['me@example.com']);
    assert.deepEqual(login.secrets, ['token']);
    assert.equal(login.url, 'https://example.com/login?token=abc&email=me@example.com', 'nothing removed: the site may need them');
    assert.deepEqual(ok('https://example.com/unsubscribe?email=me%40example.com&uid=12345').emails, ['me@example.com']);
    for (const name of ['auth', 'key', 'session', 'sid', 'sig', 'signature', 'code', 'password', 'reset']) assert.deepEqual(ok(`https://example.com/a?${name}=x1`).secrets, [name], name);
    assert.deepEqual(ok('https://example.com/a?x=eyJhbGciOiJIUzI1NiJ9eyJzdWIiOiIxMjM0NTY3ODkwIn0SflKxwRJSMeKKF2QT4').secrets, ['x'], 'a long random value');
    const plain = ok('https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=PLrAXtmErZgOeiKm4sgNOknGvNjby9efdf');
    assert.deepEqual([plain.emails, plain.secrets], [[], []], 'video and playlist ids are not secrets');
  });

  it('7.2 says a short link hides where it leads', () => {
    for (const link of ['https://t.co/abc', 'https://bit.ly/abc', 'https://lnkd.in/abc', 'https://maps.app.goo.gl/abc?g_st=iw', 'https://forms.gle/abc', 'https://substack.com/redirect/abc?j=eyJ1Ijoi']) {
      assert.deepEqual(ok(link).short, [new URL(link).hostname], link);
    }
    assert.deepEqual(ok('https://example.com/abc').short, []);
  });

  it('7.3 removes eBay, Shopee and Medium trackers named in Brave’s or Firefox’s lists', () => {
    assert.equal(ok('https://www.ebay.com/itm/123?mkcid=1&mkevt=1&ssspo=a&ssrc=b&ssuid=c&widget_ver=d&media=e&customid=x&hash=item').url, 'https://www.ebay.com/itm/123?hash=item');
    assert.equal(ok('https://www.ebay.de/sch/i.html?_nkw=x&toolid=1').url, 'https://www.ebay.de/sch/i.html?_nkw=x');
    assert.equal(ok('https://shopee.sg/x?sp_atk=1&xptdk=2&id=3').url, 'https://shopee.sg/x?id=3');
    assert.equal(ok('https://medium.com/@a/b-123?source=friends_link').url, 'https://medium.com/@a/b-123');
  });

  it('7.4 applies site rules only to the site’s own registered names', () => {
    assert.equal(ok('https://www.amazon.co.uk/dp/B0ABC?tag=aff-21').url, 'https://www.amazon.co.uk/dp/B0ABC');
    assert.equal(ok('https://amazon.evil.com/dp/B0ABC?tag=aff-21').url, 'https://amazon.evil.com/dp/B0ABC?tag=aff-21', 'not Amazon');
    assert.equal(ok('https://amazon.evil.com/x/ref=abc').url, 'https://amazon.evil.com/x/ref=abc');
    assert.equal(ok('https://aliexpress.evil.com/item/1.html?spm=a').url, 'https://aliexpress.evil.com/item/1.html?spm=a');
    assert.equal(ok('https://www.aliexpress.us/item/1.html?spm=a').url, 'https://www.aliexpress.us/item/1.html');
  });
});

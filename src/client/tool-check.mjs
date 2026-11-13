// @ts-check
/**
 * @file Tool "Link checker": shows where a link really leads, offline.
 */
/**
 * Link checker: shows where each link in a pasted message really leads and
 * points out the tricks phishing links use. It reads only the text of the
 * links (and, for text copied from mail or a web page, the real address
 * behind each link's words). No link is opened, fetched, saved or sent, so it
 * can't tell whether a site is safe: only whether an address is trying to
 * look like something it isn't.
 */
import { anchorsFromHtml, carriedValues, findLinks, parseWebUrl, refang, unwrap } from './link-text.mjs';
import { receiveFiles } from './files.mjs';
import { fillInto, fillText } from './fill.mjs';
import { siteOf } from './site.mjs';

export { siteOf };

/* ---------- Brands ---------- */

/** Services that hide the real address behind a short one. */
const SHORTENERS = new Set([
  'bit.ly', 't.co', 'tinyurl.com', 'goo.gl', 'is.gd', 'ow.ly', 'buff.ly', 'cutt.ly', 'rebrand.ly', 'tiny.cc', 'shorturl.at', 'rb.gy', 'lnkd.in', 't.ly', 'v.gd', 'clck.ru',
]);

/**
 * @typedef {object} Brand
 * @property {string} name  As it appears in an address.
 * @property {string[]} domains  The addresses that really belong to it.
 * @property {string} owner  Brands of one company (Google and YouTube, a bank and its internet bank) link to each
 *   other's sites all the time; that is not suspicious.
 * @property {boolean} [sole]  It has one official home, so the same name under any other ending is not it.
 *   Brands with sites in many countries (google.ge, amazon.de) are not marked.
 */

/**
 * Sources: global brands' domains are their own well-known sites. Georgian services: each organisation's own site,
 * read 2026-11-13 (the domains it links to for its internet bank or login are listed with it); redirects checked by
 * request on 2026-11-13 where noted.
 * @type {Brand[]}
 */
const BRANDS = [
  { name: 'google', owner: 'google', domains: ['google.com', 'googleapis.com', 'googlevideo.com', 'googlemail.com'] },
  { name: 'gmail', owner: 'google', domains: ['gmail.com'] },
  { name: 'youtube', owner: 'google', domains: ['youtube.com', 'youtu.be'] },
  { name: 'facebook', owner: 'meta', domains: ['facebook.com', 'fb.com', 'facebookmail.com'] },
  { name: 'instagram', owner: 'meta', domains: ['instagram.com'] },
  { name: 'whatsapp', owner: 'meta', domains: ['whatsapp.com', 'whatsapp.net'] },
  { name: 'messenger', owner: 'meta', domains: ['messenger.com'] },
  // telegra.ph is Telegram's own publishing site (anyone can publish there: see PUBLIC_PAGES).
  { name: 'telegram', owner: 'telegram', domains: ['telegram.org', 'telegram.me', 't.me', 'telegra.ph'] },
  { name: 'apple', owner: 'apple', domains: ['apple.com'] },
  { name: 'icloud', owner: 'apple', domains: ['icloud.com', 'icloud-content.com'] },
  { name: 'microsoft', owner: 'microsoft', domains: ['microsoft.com', 'microsoftonline.com'] },
  { name: 'outlook', owner: 'microsoft', domains: ['outlook.com', 'live.com', 'office.com'] },
  { name: 'linkedin', owner: 'microsoft', domains: ['linkedin.com'] },
  { name: 'paypal', owner: 'paypal', domains: ['paypal.com', 'paypal.me', 'paypalobjects.com'] },
  { name: 'amazon', owner: 'amazon', domains: ['amazon.com', 'amazonaws.com'] },
  { name: 'netflix', owner: 'netflix', domains: ['netflix.com'] },
  { name: 'tiktok', owner: 'tiktok', domains: ['tiktok.com'] },
  { name: 'twitter', owner: 'x', domains: ['twitter.com', 'x.com'] },
  { name: 'viber', owner: 'viber', domains: ['viber.com'] },
  { name: 'dropbox', owner: 'dropbox', domains: ['dropbox.com'] },
  { name: 'steam', owner: 'valve', domains: ['steampowered.com', 'steamcommunity.com'] },
  { name: 'binance', owner: 'binance', domains: ['binance.com'] },
  { name: 'coinbase', owner: 'coinbase', domains: ['coinbase.com'] },
  { name: 'revolut', owner: 'revolut', domains: ['revolut.com'] },
  { name: 'booking', owner: 'booking', domains: ['booking.com'] },
  { name: 'ebay', owner: 'ebay', domains: ['ebay.com'] },
  // Parcel notices are the most common phishing lure.
  { name: 'dhl', owner: 'dhl', domains: ['dhl.com', 'dhl.de'] },
  { name: 'fedex', owner: 'fedex', domains: ['fedex.com'] },
  { name: 'ups', owner: 'ups', domains: ['ups.com'] },
  { name: 'usps', owner: 'usps', domains: ['usps.com'] },
  // Georgian services that scams imitate. "sole": a distinctive name used only in Georgia; generic words (bog, magti,
  // myhome) and banks with sites in other countries (ProCredit, Halyk) are not marked.
  // https://gpost.ge (links maleo.ge, its parcel forwarding)
  { name: 'gpost', owner: 'gpost', domains: ['gpost.ge', 'maleo.ge'], sole: true },
  // https://usa2georgia.com
  { name: 'usa2georgia', owner: 'usa2georgia', domains: ['usa2georgia.com'], sole: true },
  // https://camex.ge
  { name: 'camex', owner: 'camex', domains: ['camex.ge'] },
  // https://tbcbank.ge (links tbconline.ge, tbcpayments.ge); tbcbank.com and tbcbank.com.ge redirect to tbcbank.ge;
  // https://tbcpay.ge
  { name: 'tbcbank', owner: 'tbc', domains: ['tbcbank.ge', 'tbcbank.com', 'tbcbank.com.ge', 'tbconline.ge', 'tbcpay.ge', 'tbcpayments.ge'], sole: true },
  { name: 'tbconline', owner: 'tbc', domains: ['tbconline.ge'], sole: true },
  { name: 'tbcpay', owner: 'tbc', domains: ['tbcpay.ge'], sole: true },
  { name: 'tbc', owner: 'tbc', domains: ['tbcbank.ge', 'tbcbank.com', 'tbcbank.com.ge', 'tbconline.ge', 'tbcpay.ge', 'tbcpayments.ge'] },
  // https://bankofgeorgia.ge (bog.ge and bankofgeorgia.com redirect to it; links ibank.bog.ge, bogpay.ge)
  { name: 'bankofgeorgia', owner: 'bog', domains: ['bankofgeorgia.ge', 'bankofgeorgia.com', 'bog.ge', 'bogpay.ge'], sole: true },
  { name: 'bogpay', owner: 'bog', domains: ['bogpay.ge'], sole: true },
  { name: 'bog', owner: 'bog', domains: ['bog.ge', 'bankofgeorgia.ge', 'bankofgeorgia.com', 'bogpay.ge'] },
  // https://libertybank.ge (links my.libertybank.ge, onboarding.lb.ge, libertypayments.ge). libertybank.com is a US bank.
  { name: 'libertybank', owner: 'liberty', domains: ['libertybank.ge', 'lb.ge', 'libertypayments.ge'], sole: true },
  // https://credobank.ge (its script uses mycredo.ge for login; links videobanking.credo.ge)
  { name: 'credobank', owner: 'credo', domains: ['credobank.ge', 'credo.ge', 'mycredo.ge'], sole: true },
  { name: 'mycredo', owner: 'credo', domains: ['mycredo.ge'], sole: true },
  // https://bb.ge (basisbank.ge redirects to it; links bankonline.ge)
  { name: 'basisbank', owner: 'basis', domains: ['bb.ge', 'basisbank.ge', 'bankonline.ge'], sole: true },
  // https://terabank.ge (links ebanking.ge, terabusiness.ge)
  { name: 'terabank', owner: 'tera', domains: ['terabank.ge', 'ebanking.ge', 'terabusiness.ge'], sole: true },
  // https://procreditbank.ge, https://halykbank.ge (links myhalyk.ge)
  { name: 'procreditbank', owner: 'procredit', domains: ['procreditbank.ge'] },
  { name: 'halykbank', owner: 'halyk', domains: ['halykbank.ge', 'myhalyk.ge'] },
  // https://magticom.ge
  { name: 'magticom', owner: 'magti', domains: ['magticom.ge'], sole: true },
  { name: 'magti', owner: 'magti', domains: ['magticom.ge'] },
  // https://silknet.com (links my.silknet.com); silknet.ge points to an address in JSC Silknet's own network (RIPE).
  { name: 'silknet', owner: 'silknet', domains: ['silknet.com', 'silknet.ge'], sole: true },
  // https://cellfie.ge
  { name: 'cellfie', owner: 'cellfie', domains: ['cellfie.ge'] },
  // https://mymarket.ge, https://myhome.ge, https://myauto.ge (shared login at auth.tnet.ge)
  { name: 'mymarket', owner: 'tnet', domains: ['mymarket.ge', 'tnet.ge'] },
  { name: 'myhome', owner: 'tnet', domains: ['myhome.ge', 'tnet.ge'] },
  { name: 'myauto', owner: 'tnet', domains: ['myauto.ge', 'tnet.ge'] },
  { name: 'glovo', owner: 'glovo', domains: ['glovoapp.com'] },
  { name: 'wolt', owner: 'wolt', domains: ['wolt.com'] },
  // https://telasi.ge
  { name: 'telasi', owner: 'telasi', domains: ['telasi.ge'], sole: true },
  // https://energo-pro.ge (links my.energo-pro.ge)
  { name: 'energopro', owner: 'energopro', domains: ['energo-pro.ge'] },
];

/** Hosting a company runs for anyone's files: its own, but not its official pages (see PUBLIC_PAGES). */
const HOSTING = new Map([['googleusercontent.com', 'google']]);

/** The company behind a registered name, if it is one of the brands. @param {string} site */
const ownerOf = (site) => BRANDS.find(({ domains }) => domains.includes(site))?.owner ?? HOSTING.get(site) ?? '';

/** Well-known sites that carry other addresses as part of what they do (archives), besides the brands' own. */
const CARRIERS = new Set(['archive.org']);

/** A site whose own links to other addresses are normal: a brand's site, or a known carrier. @param {string} site */
const wellKnown = (site) => ownerOf(site) !== '' || CARRIERS.has(site);

/**
 * Generic endings that scams register under because they are cheap. A global brand's name under one of them is not
 * the brand; its country endings (amazon.de, google.ge) are.
 */
const ODD_ENDINGS = new Set([
  'top', 'xyz', 'click', 'info', 'online', 'site', 'live', 'shop', 'store', 'buzz', 'icu', 'club', 'vip', 'work', 'link', 'rest', 'fun',
  'space', 'website', 'cfd', 'sbs', 'cyou', 'monster', 'lol', 'support', 'help', 'digital', 'world', 'today', 'life', 'cam', 'quest',
]);

/**
 * Words and places one letter away from a brand's name that are not imitations ("telavi", a town; "telasi", the
 * electricity company). Only names marked "sole" need them: other names need a second sign anyway.
 */
const NOT_TYPOS = new Set(['telavi']);

/**
 * Words that phishing addresses put next to a brand's name. A short name
 * ("ups", "apple") next to one of them is an imitation; next to other words
 * it is usually just a word ("apple-tree", "ups-and-downs").
 */
const LURE_WORDS = new Set([
  'account', 'accounts', 'alert', 'app', 'auth', 'bank', 'billing', 'bonus', 'check', 'confirm', 'customs', 'delivery', 'geo', 'georgia', 'ge',
  'gift', 'help', 'id', 'invoice', 'login', 'mail', 'my', 'notice', 'official', 'online', 'parcel', 'pay', 'payment', 'post', 'prize', 'recovery',
  'refund', 'secure', 'security', 'service', 'signin', 'support', 'track', 'tracking', 'unlock', 'update', 'verify', 'verification', 'wallet', 'web',
]);

/** "g00gle" → "google": digits and symbols often swapped for letters. @param {string} text */
const unleet = (text) => text.replace(/0/g, 'o').replace(/[1!|]/g, 'l').replace(/3/g, 'e').replace(/5/g, 's').replace(/4/g, 'a').replace(/rn/g, 'm').replace(/vv/g, 'w');

/**
 * True when two words differ by one letter added, removed, changed, or by two neighbours swapped.
 * @param {string} a
 * @param {string} b
 */
export function oneEditApart(a, b) {
  if (a === b || Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  while (i < a.length && a[i] === b[i]) i += 1;
  const [restA, restB] = [a.slice(i), b.slice(i)];
  return (
    restA.slice(1) === restB.slice(1) || // one letter changed
    restA.slice(1) === restB || // one letter added
    restA === restB.slice(1) || // one letter removed
    (restA.length > 1 && restA[0] === restB[1] && restA[1] === restB[0] && restA.slice(2) === restB.slice(2)) // neighbours swapped
  );
}

/** A word that reads as `name` to someone glancing at it. @param {string} word @param {string} name */
const readsAs = (word, name) => word !== name && (unleet(word) === name || (name.length >= 6 && oneEditApart(word, name)));

/**
 * Digits or symbols for letters ("paypa1", "g00gle"), or one letter doubled ("faceboook", "paypall"): signs on their
 * own, which ordinary words rarely give.
 * @param {string} word
 * @param {string} name
 */
const leetFor = (word, name) => {
  if (word === name) return false;
  if (unleet(word) === name) return true;
  if (word.length !== name.length + 1 || name.length < 5) return false;
  for (let i = 1; i < word.length; i += 1) {
    if (word[i] === word[i - 1] && word.slice(0, i) + word.slice(i + 1) === name) return true;
  }
  return false;
};

/**
 * One letter away from a long name: common among ordinary words ("finance", "cooking"), so it counts only for a name
 * used by one Georgian company, or with a second sign.
 * @param {string} word
 * @param {string} name
 */
const oneLetterFrom = (word, name) => name.length >= 6 && !NOT_TYPOS.has(word) && word !== name && oneEditApart(word, name);

/**
 * Which well-known name a site name imitates, if any.
 * @param {string} label  The name chosen by whoever registered the site, e.g. "paypal-login" in "paypal-login.com".
 * @param {string} site  e.g. "paypal-login.com"
 * @param {string} subdomains  The part of the host before the site name, e.g. "paypal.com.secure".
 * @param {boolean} [suspicious]  Another sign is already there (letters of another script, free hosting): a name one
 *   letter away from a brand's then counts too.
 * @returns {{ flag: 'brandElsewhere' | 'brandSubdomain' | 'brandLookalike' | 'typo', brand: string, official: string } | null}
 */
export function imitatedBrand(label, site, subdomains, suspicious = false) {
  const parts = label.split('-');
  const ending = site.split('.').pop() ?? '';
  const odd = suspicious || ODD_ENDINGS.has(ending) || parts.some((part) => LURE_WORDS.has(part));
  if (ownerOf(site)) return null;
  for (const { name, domains, sole } of BRANDS) {
    const found = (/** @type {'brandElsewhere' | 'brandSubdomain' | 'brandLookalike' | 'typo'} */ flag) => ({ flag, brand: name, official: domains[0] });
    if (label === name) {
      if (sole || ODD_ENDINGS.has(ending)) return found('brandElsewhere');
      continue;
    }
    // "paypal-login"; a short name only next to a word lures use ("secure-apple", not "apple-tree").
    if (parts.length > 1 && parts.includes(name) && (name.length >= 6 || parts.some((part) => LURE_WORDS.has(part)))) return found('brandLookalike');
    // "paypalsecure": glued on, for names long enough not to occur inside ordinary words.
    if (name.length >= 6 && (label.startsWith(name) || label.endsWith(name))) return found('brandLookalike');
    const words = parts.length > 1 ? [label, ...parts] : [label];
    if (words.some((word) => leetFor(word, name) || (oneLetterFrom(word, name) && (sole || odd)))) return found('typo');
    if (subdomains.split(/[.-]/).includes(name)) return found('brandSubdomain');
  }
  return null;
}

/**
 * Latin letters outside plain ASCII that pass for ASCII ones ("ı" for "i" or
 * "l"), mapped to what a reader takes them for. Letters with accents are
 * handled by removing the accent.
 */
const LATIN_LOOKALIKES = /** @type {Record<string, string[]>} */ ({
  ı: ['i', 'l'], ȷ: ['j'], ɑ: ['a'], ɡ: ['g'], ɩ: ['i', 'l'], ɪ: ['i'], ʟ: ['l'], ł: ['l'], ɫ: ['l'], ƚ: ['l'], ŀ: ['l'], đ: ['d'], ɗ: ['d'], ø: ['o'],
  ɵ: ['o'], ᴏ: ['o'], ᴄ: ['c'], ꜱ: ['s'], ᴠ: ['v'], ᴡ: ['w'], ᴢ: ['z'], ʀ: ['r'], ɴ: ['n'], ʏ: ['y'], ᴜ: ['u'], ꞁ: ['l'], ǀ: ['l'],
});

/**
 * The plain-ASCII words a label can be read as.
 * @param {string} label
 * @returns {string[]}
 */
function asciiReadings(label) {
  let readings = [''];
  for (const char of label.normalize('NFKD').replace(/\p{M}/gu, '')) {
    const options = LATIN_LOOKALIKES[char] ?? [char];
    readings = readings.flatMap((start) => options.map((option) => start + option)).slice(0, 16);
  }
  return readings;
}

/**
 * A brand imitated with Latin letters that are not plain ASCII ("paypaı").
 * @param {string} label  The site's own label, as letters.
 * @param {string} site
 * @returns {string | null}  The brand's name.
 */
export function latinLookalike(label, site) {
  if (/^[\x00-\x7f]*$/.test(label) || !/\p{Script=Latin}/u.test(label)) return null;
  for (const reading of asciiReadings(label)) {
    const brand = BRANDS.find(({ name, domains }) => !domains.includes(site) && reading.split('-').some((part) => part === name || readsAs(part, name)));
    if (brand) return brand.name;
  }
  return null;
}

/* ---------- Letters from other alphabets ---------- */

/** Scripts whose letters are told apart in host names. */
const SCRIPTS = /** @type {const} */ ([
  ['Latin', /\p{Script=Latin}/u], ['Cyrillic', /\p{Script=Cyrillic}/u], ['Greek', /\p{Script=Greek}/u], ['Armenian', /\p{Script=Armenian}/u],
  ['Georgian', /\p{Script=Georgian}/u], ['Arabic', /\p{Script=Arabic}/u], ['Hebrew', /\p{Script=Hebrew}/u], ['Han', /\p{Script=Han}/u],
  ['Hiragana', /\p{Script=Hiragana}/u], ['Katakana', /\p{Script=Katakana}/u], ['Hangul', /\p{Script=Hangul}/u], ['Bopomofo', /\p{Script=Bopomofo}/u],
]);

/**
 * Mixtures that Unicode's "highly restrictive" profile allows in one name
 * (UTS #39, section 5.2): Latin with Chinese, Japanese or Korean writing.
 */
const ALLOWED_MIXES = [new Set(['Latin', 'Han', 'Hiragana', 'Katakana']), new Set(['Latin', 'Han', 'Bopomofo']), new Set(['Latin', 'Han', 'Hangul'])];

/** Letters that Cyrillic or Greek letters can pass for. */
const LOOKALIKE_LETTERS = /^[аеіјорсухѕԁԛԝһӏАВЕКМНОРСТУХοανρτυκιεΑΒΕΖΗΙΚΜΝΟΡΤΥΧ\d-]+$/u;

/**
 * @param {string} label  One part of a host name, as letters.
 * @returns {'mixed' | 'lookalike' | null}
 */
export function scriptTrick(label) {
  const scripts = SCRIPTS.filter(([, pattern]) => pattern.test(label)).map(([name]) => name);
  if (scripts.length > 1 && !ALLOWED_MIXES.some((allowed) => scripts.every((script) => allowed.has(script)))) return 'mixed';
  if (scripts.length === 0 || scripts.includes('Latin')) return null;
  if (LOOKALIKE_LETTERS.test(label) && /\p{L}/u.test(label)) return 'lookalike';
  return null;
}

/* ---------- International names ---------- */

/**
 * Decodes one "xn--" label (RFC 3492) into the letters it stands for.
 * @param {string} encoded  The part after "xn--".
 * @returns {string}
 * @throws {RangeError} if the text is not valid Punycode.
 */
export function punycodeDecode(encoded) {
  const base = 36;
  const [tMin, tMax, skew, damp] = [1, 26, 38, 700];
  /** @type {number[]} */
  const output = [];
  const split = encoded.lastIndexOf('-');
  for (let j = 0; j < split; j += 1) output.push(encoded.charCodeAt(j));

  let [n, i, bias] = [128, 0, 72];
  let index = split > 0 ? split + 1 : 0;
  while (index < encoded.length) {
    const start = i;
    let weight = 1;
    for (let k = base; ; k += base) {
      if (index >= encoded.length) throw new RangeError('Punycode ends in the middle of a letter.');
      const code = encoded.charCodeAt(index);
      index += 1;
      const digit = code >= 48 && code <= 57 ? code - 22 : code >= 65 && code <= 90 ? code - 65 : code >= 97 && code <= 122 ? code - 97 : base;
      if (digit >= base) throw new RangeError('Punycode contains a character that is not a letter or digit.');
      i += digit * weight;
      const threshold = k <= bias ? tMin : k >= bias + tMax ? tMax : k - bias;
      if (digit < threshold) break;
      weight *= base - threshold;
    }
    const length = output.length + 1;
    let delta = start === 0 ? Math.floor((i - start) / damp) : (i - start) >> 1;
    delta += Math.floor(delta / length);
    let k = 0;
    while (delta > ((base - tMin) * tMax) >> 1) {
      delta = Math.floor(delta / (base - tMin));
      k += base;
    }
    bias = k + Math.floor(((base - tMin + 1) * delta) / (delta + skew));
    n += Math.floor(i / length);
    i %= length;
    if (n > 0x10ffff) throw new RangeError('Punycode decodes to a character that does not exist.');
    output.splice(i, 0, n);
    i += 1;
  }
  return String.fromCodePoint(...output);
}

/**
 * A host name with its "xn--" parts shown as the letters people see.
 * @param {string} host
 */
export function unicodeHost(host) {
  return host
    .split('.')
    .map((label) => {
      if (!label.startsWith('xn--')) return label;
      try {
        return punycodeDecode(label.slice(4));
      } catch {
        return label;
      }
    })
    .join('.');
}

/* ---------- Other signs ---------- */

/** Endings common enough that a label like this inside an address reads as the end of another address. */
const FAMILIAR_ENDINGS = new Set(['com', 'net', 'org', 'ge', 'gov', 'edu', 'info', 'io', 'co', 'me', 'ru', 'uk', 'de', 'eu']);

/**
 * A complete-looking address in front of the real site name, as in
 * "dhl.com.track-parcel.xyz" → "dhl.com".
 * @param {string} subdomains  The part of the host before the site name.
 * @returns {string}  "" if there is none.
 */
export function nestedDomain(subdomains) {
  const labels = subdomains.split('.').filter(Boolean);
  const end = labels.findLastIndex((label, index) => index > 0 && FAMILIAR_ENDINGS.has(label));
  return end === -1 ? '' : labels.slice(labels[0] === 'www' ? 1 : 0, end + 1).join('.');
}

/** Endings that look like file types. */
const FILE_LIKE_ENDINGS = new Set(['zip', 'mov']);
/** Files that can install or run software. */
const RUNNABLE = /\.(exe|msi|scr|bat|cmd|com|pif|vbs|js|jar|apk|dmg|pkg|iso|lnk)$/i;
const USUAL_PORTS = new Set(['', '80', '443']);

/**
 * Places on well-known sites where anyone can publish a page, a form or a file: the site's name says nothing about
 * who made it.
 * @type {{ host?: string, site?: string, path?: RegExp }[]}
 */
const PUBLIC_PAGES = [
  { host: 'sites.google.com' },
  { host: 'docs.google.com', path: /^\/forms\// },
  { host: 'forms.gle' },
  { site: 'googleusercontent.com' },
  { host: 'storage.googleapis.com' },
  { host: 'firebasestorage.googleapis.com' },
  { host: 's3.amazonaws.com' },
  { host: 'ipfs.io', path: /^\/ipfs\// },
  { host: 'telegra.ph' },
  { host: 't.me' },
  { host: 'forms.office.com' },
];

/** @param {URL} url @param {string} host @param {string} site */
const publicPage = (url, host, site) =>
  PUBLIC_PAGES.some((page) => (page.host ? page.host === host.replace(/^www\./, '') : page.site === site) && (!page.path || page.path.test(url.pathname)));

/**
 * A brand's own address written in the path or the parameters of a link to
 * another site: "evil.top/tbcbank.ge/login". On a page anyone can publish,
 * the brand's name alone counts too: "t.me/tbc_bonus_bot".
 * @param {URL} url
 * @param {string} site
 * @param {boolean} published  The link is to a page anyone can publish.
 * @returns {string | null}  The brand's name.
 */
function brandInPath(url, site, published) {
  // A well-known site's own links (an archive's copy of google.com, a bank's link to its internet bank) are its business.
  if (wellKnown(site) && !published) return null;
  let text = `${url.pathname} ${[...url.searchParams.values()].join(' ')}`;
  try {
    text = decodeURIComponent(text);
  } catch {
    // Not valid percent-encoding: read it as it is.
  }
  text = text.toLowerCase();
  const owner = ownerOf(site);
  const written = new Set(text.match(/[a-z0-9-]+(?:\.[a-z0-9-]+)+/g) ?? []);
  const byAddress = BRANDS.find(({ domains, owner: brandOwner }) => brandOwner !== owner && domains.some((domain) => [...written].some((name) => name === domain || name.endsWith(`.${domain}`))));
  if (byAddress) return byAddress.name;
  if (!published) return null;
  const words = text.split(/[^a-z0-9]+/).filter(Boolean);
  const lured = words.some((word) => LURE_WORDS.has(word));
  return BRANDS.find(({ name, owner: brandOwner }) => brandOwner !== owner && words.includes(name) && (name.length >= 6 || lured))?.name ?? null;
}

/* ---------- The report ---------- */

/**
 * @typedef {'textMismatch' | 'redirect' | 'http' | 'ip' | 'userinfo' | 'port' | 'mixedScript' | 'lookalikeScript' | 'latinLookalike'
 *   | 'brandElsewhere' | 'brandSubdomain' | 'brandLookalike' | 'typo' | 'nestedDomain' | 'sharedHost' | 'brandPath' | 'carriedUrl'
 *   | 'carriedEmail' | 'shortener' | 'hiddenTarget' | 'mailTracking' | 'publicPage' | 'deepSubdomain' | 'fileTld' | 'download'} Warning
 *
 * @typedef {object} LinkReport
 * @property {'ok'} status
 * @property {string} url  The address judged (after any redirect pages), as written by the browser.
 * @property {string} site  The registered name it leads to (as letters, not "xn--").
 * @property {string} host  The full host, as letters.
 * @property {string} asciiHost  The host as the browser sends it ("xn--…"), or "" when it is plain ASCII.
 * @property {string[]} via  Hosts of the redirect pages the link passes through.
 * @property {boolean} defanged  The address was written in the "hxxp" or "[.]" form.
 * @property {string} shown  For a link copied with its words: those words; otherwise "".
 * @property {Warning[]} warnings
 * @property {Record<string, string>} details  Values for the warning texts: brand, official, via, port, ending, file, suffix, inner, email, shown.
 *
 * @typedef {{ status: 'invalid' } | { status: 'scheme', scheme: 'data' | 'javascript' | 'other' }} NotALink
 */

const IP_HOST = /^\[.*\]$|^\d+(\.\d+){3}$/;

/**
 * Judges one web address.
 * @param {URL} pasted
 * @param {{ defanged?: boolean, shown?: string }} [extra]
 * @returns {LinkReport}
 */
function judge(pasted, { defanged = false, shown = '' } = {}) {
  /** @type {Warning[]} */
  const warnings = [];
  /** @type {Record<string, string>} */
  const details = {};

  // A redirect page only passes you on: judge the address it leads to.
  const { url, via, hidden } = unwrap(pasted);
  if (via.length) {
    warnings.push('redirect');
    details.via = via.join(' → ');
  }

  const ascii = url.hostname.replace(/\.$/, '');
  const isIp = IP_HOST.test(ascii);
  const host = unicodeHost(ascii).toLowerCase();
  const { site, suffix, shared } = isIp ? { site: host, suffix: '', shared: false } : siteOf(host);
  const subdomains = host.slice(0, Math.max(0, host.length - site.length - 1));

  if (url.protocol === 'http:') warnings.push('http');
  if (isIp) warnings.push('ip');
  if (url.username || url.password) warnings.push('userinfo');
  if (!USUAL_PORTS.has(url.port)) {
    warnings.push('port');
    details.port = url.port;
  }

  // A wrapper that keeps the address to itself: its own name says nothing about where the link leads.
  if (hidden) {
    warnings.push(hidden === 'mail' ? 'mailTracking' : 'hiddenTarget');
    details.via = ascii;
  }

  if (!isIp && !hidden) {
    const tricks = host.split('.').map(scriptTrick);
    if (tricks.includes('mixed')) warnings.push('mixedScript');
    else if (tricks.includes('lookalike')) warnings.push('lookalikeScript');

    const label = site.slice(0, Math.max(0, site.length - suffix.length - 1));
    const latin = latinLookalike(label, site);
    const otherSigns = tricks.some((trick) => trick !== null) || ascii.includes('xn--') || (shared && site !== suffix);
    const imitated = latin ? null : imitatedBrand(label, site, subdomains, otherSigns);
    if (latin) {
      warnings.push('latinLookalike');
      details.brand = latin;
    } else if (imitated) {
      warnings.push(imitated.flag);
      details.brand = imitated.brand;
      details.official = imitated.official;
    }
    const inner = nestedDomain(subdomains);
    if (inner.includes('.') && imitated?.flag !== 'brandSubdomain') {
      warnings.push('nestedDomain');
      details.inner = inner;
    }
    if (shared && site !== suffix) {
      warnings.push('sharedHost');
      details.suffix = suffix;
    } else if (publicPage(url, host, site)) {
      warnings.push('publicPage');
      details.page = host;
    }
    if (SHORTENERS.has(site)) warnings.push('shortener');
    if (subdomains.split('.').filter(Boolean).length >= 4) warnings.push('deepSubdomain');
    const ending = site.split('.').pop() ?? '';
    if (FILE_LIKE_ENDINGS.has(ending)) {
      warnings.push('fileTld');
      details.ending = ending;
    }
  }

  const pathBrand = hidden ? null : brandInPath(url, site, warnings.includes('publicPage') || warnings.includes('sharedHost'));
  if (pathBrand && !details.brand) {
    warnings.push('brandPath');
    details.brand = pathBrand;
  }
  const carried = carriedValues(url);
  // Passing you on is what share buttons, sign-in pages and archives of well-known sites do.
  const owner = ownerOf(site);
  const elsewhere = wellKnown(site)
    ? undefined
    : carried.urls
        .map((link) => parseWebUrl(link))
        .map((inner) => (inner ? siteOf(unicodeHost(inner.hostname).toLowerCase()).site : ''))
        .find((innerSite) => innerSite && innerSite !== site && (!owner || ownerOf(innerSite) !== owner));
  if (elsewhere) {
    warnings.push('carriedUrl');
    details.carried = elsewhere;
    details.inner ??= elsewhere;
  }
  if (carried.emails.length) {
    warnings.push('carriedEmail');
    details.email = carried.emails[0];
  }

  const file = RUNNABLE.exec(url.pathname);
  if (file) {
    warnings.push('download');
    details.file = file[1].toLowerCase();
  }
  return { status: 'ok', url: url.href, site, host, asciiHost: ascii.includes('xn--') ? ascii : '', via, defanged, shown, warnings, details };
}

/**
 * Reads one pasted address. Adds https:// to "example.com/page" and reads
 * defanged addresses; says what an address is when it is not a web link.
 * @param {string} input
 * @returns {{ url: URL, defanged: boolean } | NotALink}
 */
function readAddress(input) {
  const trimmed = input.trim();
  const text = refang(trimmed);
  const defanged = text !== trimmed;
  const scheme = /^([a-z][a-z0-9+.-]*):(?!\d)/i.exec(text)?.[1].toLowerCase();
  if (scheme && scheme !== 'http' && scheme !== 'https') {
    return { status: 'scheme', scheme: scheme === 'data' ? 'data' : scheme === 'javascript' || scheme === 'vbscript' ? 'javascript' : 'other' };
  }
  const withScheme = scheme || !/^[^\s/?#]+\.[^\s]+$/.test(text) ? text : `https://${text}`;
  const url = parseWebUrl(withScheme);
  return url ? { url, defanged } : { status: 'invalid' };
}

/**
 * The parts of an address to show, browser-style: the site name stands out,
 * the rest is quieter.
 * @param {string} href  As written by the browser.
 * @param {string} site  As letters.
 * @returns {{ before: string, site: string, after: string }}
 */
export function linkParts(href, site) {
  const url = new URL(href);
  let start = href.indexOf('//') + 2;
  if (url.username || url.password) start = href.indexOf('@', start) + 1;
  const host = unicodeHost(url.hostname);
  const shownSite = host.endsWith(site) ? site : host;
  return {
    before: href.slice(0, start) + host.slice(0, host.length - shownSite.length),
    site: shownSite,
    after: href.slice(start + url.hostname.length),
  };
}

/**
 * Judges one address, or the first link of a longer text.
 * @param {string} input
 * @returns {(LinkReport & { links: number }) | NotALink}  links: how many different links the text has.
 */
export function inspectLink(input) {
  if (/\s/.test(input.trim())) {
    const result = inspectText(input);
    return result.status === 'ok' ? { ...result.links[0], links: result.total } : result;
  }
  const read = readAddress(input);
  return 'url' in read ? { ...judge(read.url, { defanged: read.defanged }), links: 1 } : read;
}

/** Links judged at most; the rest are counted. */
export const MAX_LINKS = 10;

/**
 * Judges every link in a pasted message. `html` is what the clipboard
 * carried along with the text, if anything: the real addresses behind
 * linked words.
 * @param {string} text
 * @param {string} [html]
 * @returns {{ status: 'ok', links: LinkReport[], total: number } | NotALink}
 */
export function inspectText(text, html = '') {
  /** @type {Map<string, LinkReport>} */
  const reports = new Map();
  /** @type {Set<string>} */
  const covered = new Set();

  // Words collapsed to single spaces, as the link texts read from the HTML are.
  const words = text.replace(/\s+/g, ' ');
  for (const anchor of anchorsFromHtml(html)) {
    // Links whose words were deleted from the box since they were pasted no longer count.
    if (anchor.text && !words.includes(anchor.text)) continue;
    const read = readAddress(anchor.href);
    if (!('url' in read)) continue;
    const report = judge(read.url, { shown: anchor.text });
    const written = findLinks(refang(anchor.text), { bare: true })[0];
    const writtenUrl = written ? readAddress(written.text) : null;
    // A wrapper that hides the address can't be compared with the text: its own name is not where the link leads.
    const hides = report.warnings.includes('hiddenTarget') || report.warnings.includes('mailTracking');
    if (!hides && writtenUrl && 'url' in writtenUrl) {
      const shownSite = siteOf(unicodeHost(writtenUrl.url.hostname).toLowerCase()).site;
      if (shownSite !== report.site) {
        report.warnings.unshift('textMismatch');
        report.details.shown = shownSite;
      }
    }
    covered.add(anchor.text);
    covered.add(anchor.href);
    if (!reports.has(report.url + report.shown)) reports.set(report.url + report.shown, report);
  }

  const plain = refang(text);
  const found = findLinks(plain, { bare: true });
  if (found.length === 0 && reports.size === 0) return /\s/.test(text.trim()) ? { status: 'invalid' } : inspectSingle(text);
  for (const link of found) {
    if (covered.has(link.text)) continue;
    const read = readAddress(link.text);
    if (!('url' in read)) continue;
    // Offsets refer to the re-fanged text, so compare the words themselves.
    const report = judge(read.url, { defanged: !text.includes(link.text) });
    if (!reports.has(report.url)) reports.set(report.url, report);
  }
  const links = [...reports.values()];
  return { status: 'ok', links: links.slice(0, MAX_LINKS), total: links.length };
}

/**
 * A single pasted address, including those that are not web links.
 * @param {string} text
 * @returns {{ status: 'ok', links: LinkReport[], total: number } | NotALink}
 */
function inspectSingle(text) {
  const read = readAddress(text);
  return 'url' in read ? { status: 'ok', links: [judge(read.url, { defanged: read.defanged })], total: 1 } : read;
}

/* ---------- Page wiring ---------- */

/**
 * The browser's built-in barcode reader (Shape Detection API), where there is one.
 * @typedef {{ detect: (image: ImageBitmap) => Promise<{ rawValue: string }[]> }} Detector
 * @typedef {{ new (options: { formats: string[] }): Detector, getSupportedFormats: () => Promise<string[]> }} DetectorClass
 */

/** Waits this long after the last keystroke before checking again, so long pastes stay smooth. */
const TYPING_PAUSE_MS = 150;

/**
 * The HTML that came with pastes whose text is still in the box: the addresses behind their linked words. A paste
 * whose text was replaced or deleted leaves no links behind, including links around pictures, which have no words.
 * @param {{ html: string, text: string }[]} pastes
 * @param {string} value  What the box holds now.
 */
export function pastedHtml(pastes, value) {
  const now = value.replace(/\s+/g, ' ');
  return pastes
    .filter(({ text }) => {
      const words = text.replace(/\s+/g, ' ').trim();
      return words !== '' && (now.includes(words.slice(0, 30)) || now.includes(words.slice(-30)));
    })
    .map(({ html }) => html)
    .join('');
}

/**
 * One verdict card, from the page's template.
 * @param {HTMLTemplateElement} template
 * @param {LinkReport} report
 */
function card(template, report) {
  const element = /** @type {HTMLElement} */ (/** @type {HTMLElement} */ (template.content.firstElementChild).cloneNode(true));
  /** @param {string} name */
  const part = (name) => /** @type {HTMLElement} */ (element.querySelector(`[data-js="check-${name}"]`));
  const values = { ...report.details, site: report.site, host: report.asciiHost, shown: report.shown };
  const parts = linkParts(report.url, report.site);

  element.dataset.state = report.warnings.length ? 'warn' : 'ok';
  // A shortened or mail-security link shows only its first stop, not where it leads.
  if (/** @type {Warning[]} */ (['shortener', 'hiddenTarget', 'mailTracking']).some((warning) => report.warnings.includes(warning))) part('leads').textContent = part('leads').dataset.first ?? '';
  part('site').textContent = report.site;
  part('before').textContent = parts.before;
  part('site-part').textContent = parts.site;
  part('after').textContent = parts.after;
  for (const [name, shown] of /** @type {const} */ ([['ascii', report.asciiHost !== ''], ['shown', report.shown !== '']])) {
    part(name).hidden = !shown;
    if (shown) fillInto(part(name), part(name).dataset.template, values);
  }
  part('defanged').hidden = !report.defanged;
  const verdict = part('verdict');
  verdict.textContent = report.warnings.length ? fillText(verdict.dataset.warn, { n: String(report.warnings.length) }) : (verdict.dataset.ok ?? '');
  element.querySelectorAll('[data-js="check-warning"]').forEach((row) => {
    if (!(row instanceof HTMLElement)) return;
    row.hidden = !report.warnings.includes(/** @type {Warning} */ (row.dataset.warning));
    if (!row.hidden) fillInto(row, row.dataset.template, values);
  });
  return element;
}

/** @param {HTMLElement} root */
export function init(root) {
  /** @param {string} name */
  const find = (name) => root.querySelector(`[data-js="check-${name}"]`);
  const input = /** @type {HTMLTextAreaElement} */ (find('input'));
  const summary = /** @type {HTMLElement} */ (find('summary'));
  const results = /** @type {HTMLElement} */ (find('results'));
  const template = /** @type {HTMLTemplateElement} */ (find('template'));
  const example = /** @type {HTMLButtonElement} */ (find('example'));
  /** What the clipboard carried along with each paste: the addresses behind linked words. @type {{ html: string, text: string }[]} */
  let pastes = [];
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let pending;

  const update = () => {
    clearTimeout(pending);
    if (input.value.trim() === '') {
      pastes = [];
      summary.textContent = '';
      results.replaceChildren();
      return;
    }
    const result = inspectText(input.value, pastedHtml(pastes, input.value));
    if (result.status !== 'ok') {
      summary.textContent = summary.dataset[result.status === 'scheme' ? result.scheme : 'invalid'] ?? '';
      results.replaceChildren();
      return;
    }
    const counts = { n: String(result.total), max: String(MAX_LINKS) };
    // Said for one link too: the cards themselves are not announced.
    summary.textContent = fillText(result.total > MAX_LINKS ? summary.dataset.capped : result.total > 1 ? summary.dataset.several : summary.dataset.one, counts);
    results.replaceChildren(...result.links.map((report) => card(template, report)));
  };

  input.addEventListener('paste', (event) => {
    // A paste over the whole text replaces it, and with it the links of earlier pastes.
    if (input.selectionStart === 0 && input.selectionEnd === input.value.length) pastes = [];
    pastes.push({ html: event.clipboardData?.getData('text/html') ?? '', text: event.clipboardData?.getData('text/plain') ?? '' });
  });
  input.addEventListener('input', () => {
    clearTimeout(pending);
    pending = setTimeout(update, TYPING_PAUSE_MS);
  });
  example.addEventListener('click', () => {
    input.value = example.dataset.example ?? '';
    pastes = [];
    update();
  });
  initQr(root, (text) => {
    input.value = text;
    pastes = [];
    update();
  }, summary, results);
  update();
}

/**
 * Reads a QR code from a chosen, dropped or pasted picture, where the browser
 * has a barcode reader of its own. The picture stays in the page.
 * @param {HTMLElement} root
 * @param {(text: string) => void} found
 * @param {HTMLElement} summary
 * @param {HTMLElement} results
 */
function initQr(root, found, summary, results) {
  const Reader = /** @type {DetectorClass | undefined} */ (Reflect.get(globalThis, 'BarcodeDetector'));
  const file = root.querySelector('[data-js="check-qr"]');
  if (typeof Reader !== 'function' || !(file instanceof HTMLInputElement)) return;

  /** @param {'qrNone' | 'qrFailed'} key */
  const fail = (key) => {
    summary.textContent = summary.dataset[key] ?? '';
    results.replaceChildren();
  };
  /** @param {File | undefined} picture */
  const read = async (picture) => {
    if (!picture) return;
    try {
      if (!(await Reader.getSupportedFormats()).includes('qr_code')) return fail('qrFailed');
      const bitmap = await createImageBitmap(picture);
      const codes = await new Reader({ formats: ['qr_code'] }).detect(bitmap);
      bitmap.close();
      if (codes.length === 0) return fail('qrNone');
      found(codes.map((code) => code.rawValue).join('\n'));
    } catch (error) {
      console.warn('[lockwell] The browser could not read a QR code from the chosen picture.', error);
      fail('qrFailed');
    }
  };
  file.addEventListener('change', () => read(file.files?.[0]));
  receiveFiles(root, read, { paste: true });
}

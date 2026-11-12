// @ts-check
// SPDX-FileCopyrightText: 2026 Shota Mtvarelishvili <mtvarelishvili@proton.me>
// SPDX-License-Identifier: MIT
/**
 * @file Tool "Link checker": shows where a link really leads, offline.
 * @author Shota Mtvarelishvili <mtvarelishvili@proton.me> (https://shoti.github.io/)
 */
/**
 * Link checker: shows where a link really leads and points out the tricks
 * phishing links use. It reads only the text of the link. The link is never
 * opened, fetched, saved or sent, so it can't tell whether the site itself is
 * safe: only whether the address is trying to look like something it isn't.
 */
import { findLinks, parseWebUrl, redirectTarget } from './tool-links.mjs';

/**
 * Two-part endings under which anyone can register a name ("example.com.ge").
 * Not the full public list (thousands of entries): the common ones, so the
 * site name is found correctly for the addresses people actually meet.
 */
const TWO_PART_SUFFIXES = new Set([
  'com.ge', 'org.ge', 'net.ge', 'edu.ge', 'gov.ge', 'pvt.ge', 'school.ge',
  'co.uk', 'org.uk', 'ac.uk', 'gov.uk', 'com.au', 'net.au', 'org.au', 'co.nz', 'co.jp', 'co.kr', 'co.in', 'co.il', 'co.za',
  'com.tr', 'com.ua', 'com.ru', 'com.br', 'com.mx', 'com.ar', 'com.cn', 'com.hk', 'com.sg', 'com.pl', 'com.es',
]);

/** Services that hide the real address behind a short one. */
const SHORTENERS = new Set([
  'bit.ly', 't.co', 'tinyurl.com', 'goo.gl', 'is.gd', 'ow.ly', 'buff.ly', 'cutt.ly', 'rebrand.ly', 'tiny.cc', 'shorturl.at', 'rb.gy', 'lnkd.in', 't.ly', 'v.gd', 'clck.ru',
]);

/**
 * Names that phishing imitates, with the addresses that really belong to them.
 * A name on its own under another ending (google.ge, amazon.de) is not flagged.
 */
const BRANDS = [
  { name: 'google', domains: ['google.com', 'googleapis.com', 'googleusercontent.com', 'googlevideo.com', 'googlemail.com'] },
  { name: 'facebook', domains: ['facebook.com', 'fb.com', 'facebookmail.com'] },
  { name: 'instagram', domains: ['instagram.com'] },
  { name: 'whatsapp', domains: ['whatsapp.com', 'whatsapp.net'] },
  { name: 'telegram', domains: ['telegram.org', 'telegram.me', 't.me'] },
  { name: 'apple', domains: ['apple.com'] },
  { name: 'icloud', domains: ['icloud.com', 'icloud-content.com'] },
  { name: 'microsoft', domains: ['microsoft.com', 'microsoftonline.com'] },
  { name: 'paypal', domains: ['paypal.com', 'paypal.me', 'paypalobjects.com'] },
  { name: 'amazon', domains: ['amazon.com', 'amazonaws.com'] },
  { name: 'netflix', domains: ['netflix.com'] },
  { name: 'gmail', domains: ['gmail.com'] },
  { name: 'youtube', domains: ['youtube.com', 'youtu.be'] },
  { name: 'outlook', domains: ['outlook.com', 'live.com', 'office.com'] },
  { name: 'linkedin', domains: ['linkedin.com'] },
  { name: 'tiktok', domains: ['tiktok.com'] },
  { name: 'twitter', domains: ['twitter.com', 'x.com'] },
  { name: 'messenger', domains: ['messenger.com'] },
  { name: 'viber', domains: ['viber.com'] },
  { name: 'dropbox', domains: ['dropbox.com'] },
  { name: 'steam', domains: ['steampowered.com', 'steamcommunity.com'] },
  { name: 'binance', domains: ['binance.com'] },
  { name: 'coinbase', domains: ['coinbase.com'] },
  { name: 'revolut', domains: ['revolut.com'] },
  { name: 'booking', domains: ['booking.com'] },
  { name: 'ebay', domains: ['ebay.com'] },
  // Parcel notices are the most common phishing lure.
  { name: 'dhl', domains: ['dhl.com', 'dhl.de'] },
  { name: 'fedex', domains: ['fedex.com'] },
  { name: 'ups', domains: ['ups.com'] },
  { name: 'usps', domains: ['usps.com'] },
  { name: 'gpost', domains: ['gpost.ge'] },
  // Georgian banks and operators.
  { name: 'tbcbank', domains: ['tbcbank.ge'] },
  { name: 'tbc', domains: ['tbcbank.ge', 'tbcpay.ge'] },
  { name: 'bankofgeorgia', domains: ['bankofgeorgia.ge'] },
  { name: 'bog', domains: ['bog.ge', 'bankofgeorgia.ge'] },
  { name: 'libertybank', domains: ['libertybank.ge'] },
  { name: 'credobank', domains: ['credobank.ge'] },
  { name: 'magticom', domains: ['magticom.ge'] },
  { name: 'silknet', domains: ['silknet.com'] },
];

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

/** Latin letters that Cyrillic or Greek letters can pass for. */
const LOOKALIKE_LETTERS = /^[аеіјорсухѕԁԛԝһӏАВЕКМНОРСТУХοανρτυκιεΑΒΕΖΗΙΚΜΝΟΡΤΥΧ\d-]+$/u;

/**
 * @param {string} label  One part of a host name, as letters.
 * @returns {'mixed' | 'lookalike' | null}
 */
export function scriptTrick(label) {
  const scripts = [/\p{Script=Latin}/u, /\p{Script=Cyrillic}/u, /\p{Script=Greek}/u].filter((script) => script.test(label)).length;
  if (scripts > 1) return 'mixed';
  if (!/\p{Script=Latin}/u.test(label) && LOOKALIKE_LETTERS.test(label) && /\p{L}/u.test(label)) return 'lookalike';
  return null;
}

/**
 * The site name: the part of a host that someone registered ("example.com.ge"
 * in "login.example.com.ge").
 * @param {string} host
 */
export function siteName(host) {
  const labels = host.split('.');
  const size = TWO_PART_SUFFIXES.has(labels.slice(-2).join('.')) ? 3 : 2;
  return labels.slice(-size).join('.');
}

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

/**
 * Which well-known name a site name imitates, if any.
 * @param {string} site  e.g. "paypal-login.com"
 * @param {string} subdomains  The part of the host before the site name, e.g. "paypal.com.secure".
 * @returns {{ flag: 'brandSubdomain' | 'brandLookalike' | 'typo', brand: string } | null}
 */
export function imitatedBrand(site, subdomains) {
  const first = site.split('.')[0];
  const parts = first.split('-');
  for (const { name, domains } of BRANDS) {
    if (domains.includes(site) || first === name) continue;
    // "paypal-login", or for longer names "paypalsecure"
    const contains = parts.includes(name) || (name.length >= 6 && (first.startsWith(name) || first.endsWith(name)));
    if (contains) return { flag: 'brandLookalike', brand: name };
    if (unleet(first) === name || (name.length >= 6 && oneEditApart(first, name))) return { flag: 'typo', brand: name };
    if (subdomains.split(/[.-]/).includes(name)) return { flag: 'brandSubdomain', brand: name };
  }
  return null;
}

/**
 * @typedef {'http' | 'ip' | 'userinfo' | 'mixedScript' | 'lookalikeScript' | 'brandSubdomain' | 'brandLookalike' | 'typo' | 'nestedDomain'
 *   | 'shortener' | 'redirect' | 'port' | 'deepSubdomain' | 'fileTld' | 'download'} Warning
 *
 * @typedef {object} LinkReport
 * @property {'ok'} status
 * @property {string} site  The registered name the link leads to (as letters, not "xn--").
 * @property {string} host  The full host, as letters.
 * @property {Warning[]} warnings
 * @property {Record<string, string>} details  Values for the warning texts: brand, via, port, ending, file.
 * @property {number} links  How many links the pasted text had; the report is about the first.
 */

/**
 * @param {string} input
 * @returns {{ status: 'invalid' } | LinkReport}
 */
export function inspectLink(input) {
  // A whole message was pasted: judge the first link in it.
  const found = /\s/.test(input.trim()) ? findLinks(input) : [];
  const text = found[0]?.text ?? input.trim();
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(text) || !/^[^\s/?#]+\.[^\s]+$/.test(text) ? text : `https://${text}`;
  const pasted = parseWebUrl(withScheme);
  if (!pasted) return { status: 'invalid' };

  /** @type {Warning[]} */
  const warnings = [];
  /** @type {Record<string, string>} */
  const details = {};

  // A redirect page only passes you on: judge the address it leads to.
  const target = redirectTarget(pasted);
  const url = target ?? pasted;
  if (target) {
    warnings.push('redirect');
    details.via = pasted.hostname;
  }

  const ascii = url.hostname.replace(/\.$/, '');
  const isIp = /^\[.*\]$/.test(ascii) || /^\d+(\.\d+){3}$/.test(ascii);
  const host = unicodeHost(ascii);
  const site = isIp ? host : siteName(host);
  const subdomains = host.slice(0, Math.max(0, host.length - site.length - 1));

  if (url.protocol === 'http:') warnings.push('http');
  if (isIp) warnings.push('ip');
  if (url.username || url.password) warnings.push('userinfo');
  if (!USUAL_PORTS.has(url.port)) {
    warnings.push('port');
    details.port = url.port;
  }

  if (!isIp) {
    const tricks = host.split('.').map(scriptTrick);
    if (tricks.includes('mixed')) warnings.push('mixedScript');
    else if (tricks.includes('lookalike')) warnings.push('lookalikeScript');

    const imitated = imitatedBrand(siteName(ascii), ascii.slice(0, Math.max(0, ascii.length - siteName(ascii).length - 1)));
    if (imitated) {
      warnings.push(imitated.flag);
      details.brand = imitated.brand;
    }
    const inner = nestedDomain(subdomains);
    if (inner.includes('.') && imitated?.flag !== 'brandSubdomain') {
      warnings.push('nestedDomain');
      details.inner = inner;
    }
    if (SHORTENERS.has(site)) warnings.push('shortener');
    if (subdomains.split('.').filter(Boolean).length >= 4) warnings.push('deepSubdomain');
    const ending = site.split('.').pop() ?? '';
    if (FILE_LIKE_ENDINGS.has(ending)) {
      warnings.push('fileTld');
      details.ending = ending;
    }
  }

  const file = RUNNABLE.exec(url.pathname);
  if (file) {
    warnings.push('download');
    details.file = file[1].toLowerCase();
  }
  return { status: 'ok', site, host, warnings, details, links: Math.max(1, found.length) };
}

/** @param {HTMLElement} root */
export function init(root) {
  const input = /** @type {HTMLTextAreaElement} */ (root.querySelector('[data-js="check-input"]'));
  const result = /** @type {HTMLElement} */ (root.querySelector('[data-js="check-result"]'));
  const site = /** @type {HTMLElement} */ (root.querySelector('[data-js="check-site"]'));
  const host = /** @type {HTMLElement} */ (root.querySelector('[data-js="check-host"]'));
  const verdict = /** @type {HTMLElement} */ (root.querySelector('[data-js="check-verdict"]'));
  const rows = /** @type {HTMLElement[]} */ ([...root.querySelectorAll('[data-js="check-warning"]')]);
  const several = /** @type {HTMLElement} */ (root.querySelector('[data-js="check-several"]'));

  const update = () => {
    const report = input.value.trim() === '' ? null : inspectLink(input.value);
    result.hidden = report === null;
    if (report === null) return;

    const valid = report.status === 'ok';
    several.hidden = !valid || report.links < 2;
    if (valid) several.textContent = (several.dataset.template ?? '').replace('{n}', String(report.links));
    site.textContent = valid ? report.site : '';
    host.textContent = valid && report.host !== report.site ? report.host : '';
    rows.forEach((row) => {
      const shown = valid && report.warnings.includes(/** @type {Warning} */ (row.dataset.warning));
      row.hidden = !shown;
      if (!shown || !valid) return;
      // Fill {brand}, {site} and the like into the sentence written in the page.
      const values = { ...report.details, site: report.site };
      row.textContent = (row.dataset.template ?? '').replace(/\{(\w+)\}/g, (placeholder, name) => values[/** @type {keyof typeof values} */ (name)] ?? placeholder);
    });
    const count = valid ? report.warnings.length : 0;
    result.dataset.state = !valid ? 'invalid' : count ? 'warn' : 'ok';
    verdict.textContent = (!valid ? verdict.dataset.invalid : count ? (verdict.dataset.warn ?? '').replace('{n}', String(count)) : verdict.dataset.ok) ?? '';
  };

  input.addEventListener('input', update);
  update();
}

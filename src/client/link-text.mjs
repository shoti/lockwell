// @ts-check
/**
 * @file Reading links out of text, shared by the link checker and the link cleaner.
 */
/**
 * Finds links in a pasted message (including addresses written without
 * https://, and "defanged" ones such as hxxps://evil[.]top), reads the real
 * targets of links copied from mail or a web page, and looks through redirect
 * pages and mail-security wrappers to the address they lead to. Only text is
 * read: no link is opened, fetched, saved or sent.
 */
import { siteOf } from './site.mjs';
import { TLDS } from './top-level-domains.mjs';

/** Top-level endings, for telling "gpost-ge.info" from "report.pdf". */
const ENDINGS = new Set(TLDS.split(','));

/**
 * @param {string} text
 * @returns {URL | null}  A web (http or https) URL, or null.
 */
export function parseWebUrl(text) {
  try {
    const url = new URL(text);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url : null;
  } catch {
    return null;
  }
}

/**
 * @typedef {object} Wrapper  A redirect page that carries the address it leads to.
 * @property {(site: string, suffix: string) => boolean} owner  The page counts only on the service's own registered
 *   name: "google.com.evil.top" starts like Google's but is registered by someone else.
 * @property {RegExp} host
 * @property {string | null} [path]  The page's path; null or absent: any.
 * @property {string[]} [params]  Query parameters that hold the address.
 * @property {(url: URL) => string | null} [decode]  For addresses carried in another form.
 */

/** Proofpoint URL Defense v3: characters the wrapper set aside, by run length (Proofpoint's urldecoder.py). */
const PROOFPOINT_RUNS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

/**
 * Proofpoint URL Defense (format from Proofpoint's own decoder, urldecoder.py v3.0.1).
 * @param {URL} url
 * @returns {string | null}
 */
function proofpoint(url) {
  const version = /^\/(v[123])\//.exec(url.pathname)?.[1];
  const raw = url.href;
  if (version === 'v1' || version === 'v2') {
    const value = (version === 'v1' ? /[?&]u=(.+?)&k=/ : /[?&]u=(.+?)&[dc]=/).exec(raw)?.[1];
    if (!value) return null;
    return decodeEntities(decode(version === 'v2' ? value.replace(/-/g, '%').replace(/_/g, '/') : value));
  }
  if (version !== 'v3') return null;
  const match = /v3\/__(.+?)__;(.*?)!/.exec(raw);
  if (!match) return null;
  let link = decode(match[1].replace(/^([a-z0-9+.-]+:\/)([^/])/i, '$1/$2'));
  let kept = '';
  try {
    const base64 = match[2].replace(/-/g, '+').replace(/_/g, '/');
    kept = new TextDecoder().decode(Uint8Array.from(atob(base64 + '='.repeat((4 - (base64.length % 4)) % 4)), (char) => char.charCodeAt(0)));
  } catch {
    return null;
  }
  let at = 0;
  link = link.replace(/\*(\*.)?/g, (_, run) => {
    const length = run ? PROOFPOINT_RUNS.indexOf(run[1]) + 2 : 1;
    const piece = kept.slice(at, at + length);
    at += length;
    return piece;
  });
  return link;
}

/**
 * Google's AMP cache: the original host and path follow a type segment;
 * "s" means the original was https (amp.dev, "AMP cache URL format").
 * @param {URL} url
 * @returns {string | null}
 */
function ampCache(url) {
  const parts = url.pathname.split('/').filter(Boolean);
  if (['c', 'v', 'i', 'r', 'wp'].includes(parts[0])) parts.shift();
  else if (parts[0] === 'ii') parts.splice(0, 2);
  const secure = parts[0] === 's';
  if (secure) parts.shift();
  if (!parts[0]?.includes('.')) return null;
  return `${secure ? 'https' : 'http'}://${parts.join('/')}${url.pathname.endsWith('/') ? '/' : ''}${url.search}`;
}

/**
 * Redirect pages and mail-security wrappers whose format is known. Sources
 * for each are in docs/research/tool-link-checker.md.
 * @type {Wrapper[]}
 */
/** @param {...string} domains  The registered names the service uses. */
const own = (...domains) => (/** @type {string} */ site) => domains.includes(site);

const WRAPPERS = [
  { owner: own('facebook.com'), host: /^lm?\.facebook\.com$/, path: '/l.php', params: ['u'] },
  { owner: own('instagram.com'), host: /^l\.instagram\.com$/, path: '/', params: ['u'] },
  // Google's search sites: google.com, google.ge, google.co.uk, google.com.ge…
  { owner: (/** @type {string} */ site, /** @type {string} */ suffix) => site === `google.${suffix}`, host: /^(www\.)?google\./, path: '/url', params: ['q', 'url'] },
  { owner: own('youtube.com'), host: /^(www\.)?youtube\.com$/, path: '/redirect', params: ['q'] },
  { owner: own('reddit.com'), host: /^out\.reddit\.com$/, params: ['url'] },
  { owner: own('vk.com'), host: /^(away\.)?vk\.com$/, path: '/away.php', params: ['to'] },
  { owner: own('linkedin.com'), host: /^(www\.)?linkedin\.com$/, path: '/redir/redirect', params: ['url'] },
  // Mail-security services rewrite every link in a message.
  { owner: own('outlook.com'), host: /^[a-z0-9-]+\.safelinks\.protection\.outlook\.com$/, params: ['url'] },
  { owner: own('urldefense.com', 'proofpoint.com'), host: /^urldefense(\.proofpoint)?\.com$/, decode: proofpoint },
  { owner: own('cudasvc.com'), host: /^linkprotect\.cudasvc\.com$/, path: '/url', params: ['a'] },
  { owner: own('cisco.com'), host: /^secure-web\.cisco\.com$/, decode: (/** @type {URL} */ url) => decode(url.pathname.split('/').pop() ?? '') },
  { owner: own('trendmicro.com'), host: /\.trendmicro\.com$/, path: '/wis/clicktime/v1/query', params: ['url'] },
  { owner: own('ampproject.org'), host: /\.cdn\.ampproject\.org$/, decode: ampCache },
];

/**
 * Wrappers that keep the address on their own servers: it can't be read from the link.
 * "security": mail-security services; "mail": click tracking of mailing services. Hosts checked 2026-11-13:
 * Mimecast (docs/research/tool-link-checker.md); SendGrid ct.sendgrid.net (support.sendgrid.com "How to know if my
 * links are shortened by SendGrid"); Constant Contact rs6.net (its staff in community.constantcontact.com, "can i stop
 * rs6.net redirect / click tracking"); Klaviyo klclick.com and klclick1.com (its moderators, community.klaviyo.com);
 * Mailchimp usN.list-manage.com/track/click (Mailchimp's help page describes the redirect but not the host; the host
 * is as quoted in reports of its links).
 * @type {{ kind: 'security' | 'mail', site: string, host?: RegExp, path?: RegExp }[]}
 */
const HIDING_WRAPPERS = [
  { kind: 'security', site: 'mimecast.com', host: /^protect-[a-z0-9-]+\.mimecast\.com$/ },
  { kind: 'security', site: 'mimecastprotect.com', host: /^url\.[a-z0-9-]+\.m\.mimecastprotect\.com$/ },
  { kind: 'mail', site: 'list-manage.com', path: /^\/track\/click/ },
  { kind: 'mail', site: 'sendgrid.net', host: /(^|\.)ct\.sendgrid\.net$/ },
  { kind: 'mail', site: 'rs6.net' },
  { kind: 'mail', site: 'klclick.com' },
  { kind: 'mail', site: 'klclick1.com' },
];

/** @param {URL} url */
const siteOfUrl = (url) => siteOf(url.hostname.replace(/\.$/, '').toLowerCase());

/** Stops a chain of redirect pages pointing at each other from looping. */
export const MAX_UNWRAPS = 5;

/**
 * If `url` is a known redirect page, the address it forwards to.
 * @param {URL} url
 * @returns {URL | null}
 */
export function redirectTarget(url) {
  const { site, suffix } = siteOfUrl(url);
  const wrapper = WRAPPERS.find((w) => w.owner(site, suffix) && w.host.test(url.hostname) && (w.path == null || w.path === url.pathname));
  if (!wrapper) return null;
  if (wrapper.decode) return parseWebUrl(wrapper.decode(url) ?? '');
  for (const param of wrapper.params ?? []) {
    const target = parseWebUrl(url.searchParams.get(param) ?? '');
    if (target) return target;
  }
  return null;
}

/**
 * Whether a link goes to a wrapper that keeps the address to itself, and what kind.
 * @param {URL} url
 * @returns {'security' | 'mail' | ''}
 */
export function hidingWrapper(url) {
  const { site } = siteOfUrl(url);
  const found = HIDING_WRAPPERS.find((w) => w.site === site && (!w.host || w.host.test(url.hostname)) && (!w.path || w.path.test(url.pathname)));
  return found?.kind ?? '';
}

/**
 * Follows redirect pages to the address they lead to, at most MAX_UNWRAPS deep.
 * @param {URL} url
 * @returns {{ url: URL, via: string[], hidden: 'security' | 'mail' | '' }}  via: the hosts of the redirect pages passed,
 *   in order; hidden: the last one is a wrapper that keeps the address to itself, and of which kind.
 */
export function unwrap(url) {
  let current = url;
  /** @type {string[]} */
  const via = [];
  for (let i = 0; i < MAX_UNWRAPS; i += 1) {
    const target = redirectTarget(current);
    if (!target) break;
    via.push(current.hostname);
    current = target;
  }
  return { url: current, via, hidden: hidingWrapper(current) };
}

/**
 * Turns a "defanged" address back into a normal one: security staff write
 * hxxps://evil[.]top so that nobody opens it by accident.
 * @param {string} text
 */
export function refang(text) {
  return text
    .replace(/\bhxxp(s?)(?=(?:\[:\]|:)\/\/|\[:\/\/\])/gi, 'http$1')
    .replace(/\[:\/\/\]/g, '://')
    .replace(/\[:\]/g, ':')
    .replace(/\[\.\]|\(\.\)|\{\.\}|\[dot\]|\(dot\)/gi, '.');
}

/** Punctuation that ends a sentence, not a link. */
const TRAILING = /[.,;:!?»”’]$/;

/** @param {string} link */
function trimEnd(link) {
  let out = link;
  // A closing bracket belongs to the link only if the link opened one.
  while (TRAILING.test(out) || (out.endsWith(')') && !out.includes('('))) out = out.slice(0, -1);
  return out;
}

const SCHEME_LINK = /\b(?:https?:\/\/|www\.)[^\s<>"'`]+/gi;
/**
 * An address without https:// or www.: "gpost-ge.info/track". Not preceded by
 * a letter, "@", "." or "/", so it is not part of an email or another link.
 */
const BARE_LINK = /(?<![\p{L}\p{N}@._/:-])((?:[\p{L}\p{N}](?:[\p{L}\p{N}-]{0,61}[\p{L}\p{N}])?\.)+)([\p{L}][\p{L}\p{N}-]{0,62})(?::\d{1,5})?(?:[/?#][^\s<>"'`]*)?/gu;

/**
 * The web links in a text such as a pasted message.
 * @param {string} text
 * @param {{ bare?: boolean }} [options]  bare: also find addresses written without https:// or www. whose ending is a real top-level ending.
 * @returns {{ start: number, end: number, text: string }[]}
 */
export function findLinks(text, { bare = false } = {}) {
  /** @type {{ start: number, end: number, text: string }[]} */
  const links = [];
  for (const match of text.matchAll(SCHEME_LINK)) {
    const link = trimEnd(match[0]);
    links.push({ start: match.index, end: match.index + link.length, text: link });
  }
  if (!bare) return links;
  for (const match of text.matchAll(BARE_LINK)) {
    if (!ENDINGS.has(match[2].toLowerCase())) continue;
    const start = match.index;
    if (links.some((link) => start < link.end && start + match[0].length > link.start)) continue;
    const link = trimEnd(match[0]);
    links.push({ start, end: start + link.length, text: link });
  }
  return links.sort((a, b) => a.start - b.start);
}

/** @param {string} text */
function decodeEntities(text) {
  /** @type {Record<string, string>} */
  const named = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (entity, body) => {
    if (body[0] === '#') {
      const code = body[1] === 'x' || body[1] === 'X' ? Number.parseInt(body.slice(2), 16) : Number(body.slice(1));
      return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : entity;
    }
    return named[body.toLowerCase()] ?? entity;
  });
}

/**
 * The links of copied HTML (what the clipboard carries when text is copied
 * from mail or a web page): each link's real address and the text it shows.
 * Read with patterns, not a parser: nothing is put into the page, and the
 * page's Trusted Types policy forbids parsing HTML from strings.
 * @param {string} html
 * @returns {{ href: string, text: string }[]}
 */
export function anchorsFromHtml(html) {
  /** @type {{ href: string, text: string }[]} */
  const anchors = [];
  for (const match of html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a\s*>/gi)) {
    const href = /\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/i.exec(match[1]);
    if (!href) continue;
    const text = decodeEntities(match[2].replace(/<[^>]*>/g, '')).replace(/\s+/g, ' ').trim();
    anchors.push({ href: decodeEntities(href[1] ?? href[2] ?? href[3]).trim(), text });
  }
  return anchors;
}

/** @param {string} text */
function decode(text) {
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
}

const CARRIED_URL = /\b(?:https?:\/\/|www\.)[^\s<>"'`]+/gi;
const EMAIL = /[\p{L}\p{N}._%+-]+@[\p{L}\p{N}-]+(?:\.[\p{L}\p{N}-]+)+/gu;

/**
 * Other addresses and email addresses carried inside a link: in its path,
 * its parameters or its fragment.
 * @param {URL} url
 * @returns {{ urls: string[], emails: string[] }}
 */
export function carriedValues(url) {
  // "/@name@server" in a path is a Mastodon account, not an email address.
  const places = [decode(url.pathname).replace(/\/@[^/\s]+/g, '/'), ...[...url.searchParams.values()], decode(url.hash.slice(1))];
  /** @type {Set<string>} */
  const urls = new Set();
  /** @type {Set<string>} */
  const emails = new Set();
  for (const place of places) {
    for (const match of place.matchAll(CARRIED_URL)) {
      const link = trimEnd(match[0]);
      urls.add(/^www\./i.test(link) ? `https://${link}` : link);
    }
    for (const match of place.matchAll(EMAIL)) emails.add(match[0]);
  }
  return { urls: [...urls], emails: [...emails] };
}

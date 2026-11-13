// @ts-check
/**
 * @file Tool "Link cleaner": removes tracking parameters and redirects from links.
 */
/**
 * Link cleaner: removes tracking parameters and redirect detours from a link.
 * It only edits text. The link is never opened, fetched, saved or sent.
 * Finding links and skipping redirect pages is shared with the link checker
 * (link-text.mjs).
 */
import { carriedValues, findLinks, parseWebUrl, unwrap } from './link-text.mjs';
import { fillText } from './fill.mjs';
import { siteOf } from './site.mjs';

/**
 * A host test: the host belongs to a site registered under this name, under any ending
 * (amazon.co.uk, aliexpress.us), and not merely one that starts with it (amazon.evil.com).
 * @param {string} name
 * @returns {{ test: (host: string) => boolean }}
 */
const registered = (name) => ({ test: (host) => siteOf(host.replace(/\.$/, '').toLowerCase()).site.split('.')[0] === name });

export { findLinks, parseWebUrl, redirectTarget } from './link-text.mjs';

/** Parameters that only identify a click, a campaign or the person who shared the link. */
const TRACKING = new Set([
  'fbclid', 'gclid', 'gclsrc', 'dclid', 'gbraid', 'wbraid', 'gad_source', 'gad_campaignid', 'srsltid',
  'msclkid', 'twclid', 'ttclid', 'li_fat_id', 'yclid', 'ysclid', 'rdt_cid', 'epik',
  'igshid', 'igsh', 'mibextid', 'mc_cid', 'mc_eid', 'mkt_tok',
  '_ga', '_gl', '_hsenc', '_hsmi', 'hsctatracking', 'oly_anon_id', 'oly_enc_id',
  'vero_id', 'vero_conv', 's_cid', 'sc_cid', 'cmpid', '_openstat', 'wickedid', 'ref_src', 'ref_url',
]);

const TRACKING_PREFIXES = ['utm_', 'pk_', 'mtm_', 'hsa_', '__hs'];

/**
 * Parameters that track only on particular sites (elsewhere the same name may
 * be needed), optionally only on some pages. Sources for each name are in
 * docs/research/tool-link-cleaner.md: Brave's clean-urls list and Firefox's
 * StripOnShare list (both MPL-2.0), or a direct observation of the site.
 * @type {{ host: { test: (host: string) => boolean }, path?: RegExp, names: string[], prefixes: string[] }[]}
 */
const SITE_TRACKING = [
  { host: /(^|\.)(youtube\.com|youtu\.be|spotify\.com)$/, names: ['si', 'pp', 'feature'], prefixes: [] },
  { host: /(^|\.)(twitter\.com|x\.com)$/, names: ['s', 't', 'cxt'], prefixes: [] },
  { host: /(^|\.)tiktok\.com$/, names: ['_r', '_t', 'is_from_webapp', 'is_copy_url', 'sender_device', 'sender_web_id', 'embed_source', 'refer', 'referer_url', 'referer_video_id'], prefixes: [] },
  {
    host: registered('amazon'),
    names: ['ref_', 'ref', 'crid', 'keywords', 'sprefix', 'qid', 'sr', 'dib', 'dib_tag', 'content-id', 'th', 'linkcode', 'linkid', 'ascsubtag', 'tag'],
    prefixes: ['pf_rd_', 'pd_rd_'],
  },
  { host: registered('aliexpress'), names: ['spm', 'algo_exp_id', 'pdp_npi', 'curpageloguid', 'gatewayadapt'], prefixes: [] },
  // eBay: Brave (item pages) and Firefox (whole site); Shopee: Firefox; Medium: Brave.
  { host: registered('ebay'), path: /^\/itm\//, names: ['mkcid', 'mkevt', 'ssspo', 'ssrc', 'ssuid', 'widget_ver', 'media'], prefixes: [] },
  { host: registered('ebay'), names: ['customid', 'toolid'], prefixes: [] },
  { host: registered('shopee'), names: ['sp_atk', 'xptdk'], prefixes: [] },
  { host: /^medium\.com$/, names: ['source'], prefixes: [] },
  {
    host: /^(www\.)?google\.[a-z.]+$/,
    path: /^\/search$/,
    names: ['sca_esv', 'ei', 'ved', 'oq', 'gs_lp', 'gs_lcrp', 'sclient', 'uact', 'iflsig', 'bih', 'biw', 'sourceid', 'client', 'sei', 'fbs', 'ictx', 'dpr', 'sstk', 'source', 'rlz'],
    prefixes: [],
  },
  { host: /(^|\.)linkedin\.com$/, names: ['trk', 'lipi', 'rcm', 'ebp', 'alternatechannel', 'origin', 'isjobsearch', 'trackingid', 'trackingcode', 'original_referer', 'refid'], prefixes: [] },
  { host: /(^|\.)facebook\.com$/, names: ['__tn__'], prefixes: ['__cft__'] },
  { host: /(^|\.)instagram\.com$/, names: ['ig_rid'], prefixes: [] },
  { host: /(^|\.)threads\.(net|com)$/, names: ['xmt'], prefixes: [] },
  { host: /(^|\.)reddit\.com$/, names: ['share_id', 'ref_campaign', 'ref_source', 'correlation_id'], prefixes: [] },
];

/** Tracking written into the path: Amazon's "/ref=…" (its own canonical and share addresses leave it out). */
const PATH_TRACKING = [{ host: registered('amazon'), pattern: /\/ref=[^/?#]*/, name: '/ref=' }];

/**
 * Short links: the address they lead to is not written in them, so this page can't see or clean it.
 * Hosts that only shorten, and pages that only redirect.
 */
const SHORTENERS = [
  { host: /^(t\.co|bit\.ly|lnkd\.in|maps\.app\.goo\.gl|goo\.gl|forms\.gle|tinyurl\.com|ow\.ly|buff\.ly|is\.gd|rb\.gy|cutt\.ly|shorturl\.at|rebrand\.ly)$/, path: /^\/./ },
  { host: /^(www\.)?substack\.com$/, path: /^\/redirect\// },
];

/**
 * Parameter names that sign in, reset or open an account; a link with one may let whoever has it in.
 * Not removed: the page may need them.
 */
const SECRET_NAMES = /^(token|access_token|id_token|auth|authkey|key|apikey|api_key|session|sessionid|sid|sig|signature|code|otp|password|pass|pwd|reset|reset_token)$/i;
/** A value this long, mixing upper and lower case letters and digits, is probably a token. */
const LONG_RANDOM = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)[\w.~+/=-]{40,}$/;

/**
 * What a link gives away besides trackers: email addresses, and parameters that look like sign-in codes.
 * @param {URL} url
 * @returns {{ emails: string[], secrets: string[] }}
 */
export function personalData(url) {
  const secrets = [...new Set([...url.searchParams].filter(([name, value]) => value !== '' && (SECRET_NAMES.test(name) || LONG_RANDOM.test(value))).map(([name]) => name))];
  return { emails: carriedValues(url).emails, secrets };
}

/**
 * @param {string} name  Parameter name as written in the link.
 * @param {string} host
 * @param {string} [path]  The page's path, for rules that apply to some pages only.
 */
export function isTracking(name, host, path = '/') {
  let key = name;
  try {
    key = decodeURIComponent(name.replace(/\+/g, ' '));
  } catch {
    // Not valid percent-encoding: compare the raw name.
  }
  key = key.toLowerCase();
  if (TRACKING.has(key) || TRACKING_PREFIXES.some((prefix) => key.startsWith(prefix))) return true;
  return SITE_TRACKING.some(
    (site) => site.host.test(host) && (!site.path || site.path.test(path)) && (site.names.includes(key) || site.prefixes.some((prefix) => key.startsWith(prefix))),
  );
}

/**
 * Share links the cleaner can't clean: the platform looks the real address up
 * when the link is opened. "account": the platform says such links are tied
 * to the account that made them; "lookup": short share links whose contents
 * can't be seen offline. Sources in docs/research/tool-link-cleaner.md.
 * @type {{ host: RegExp, path: RegExp, name: string, kind: 'account' | 'lookup' }[]}
 */
const SHARE_LINKS = [
  { host: /^v[mt]\.tiktok\.com$/, path: /^\/\w/, name: 'TikTok', kind: 'account' },
  { host: /^(www\.)?tiktok\.com$/, path: /^\/t\/\w/, name: 'TikTok', kind: 'account' },
  { host: /^(www\.|m\.)?facebook\.com$/, path: /^\/share\//, name: 'Facebook', kind: 'lookup' },
  { host: /^(www\.)?instagram\.com$/, path: /^\/share\//, name: 'Instagram', kind: 'lookup' },
  { host: /^(www\.)?reddit\.com$/, path: /^\/r\/[^/]+\/s\/\w/, name: 'Reddit', kind: 'lookup' },
  { host: /^pin\.it$/, path: /^\/\w/, name: 'Pinterest', kind: 'lookup' },
];

/**
 * The share link `url` is, if any.
 * @param {URL} url
 * @returns {{ name: string, kind: 'account' | 'lookup' } | null}
 */
export function shareLink(url) {
  return SHARE_LINKS.find((link) => link.host.test(url.hostname) && link.path.test(url.pathname)) ?? null;
}

/** @typedef {{ text: string, removed: boolean }} Part  A piece of the original text, and whether the clean copy leaves it out. */

/**
 * Joins neighbouring pieces that are both kept or both removed.
 * @param {Part[]} parts
 * @returns {Part[]}
 */
function merge(parts) {
  /** @type {Part[]} */
  const out = [];
  for (const part of parts) {
    if (part.text === '') continue;
    const last = out.at(-1);
    if (last && last.removed === part.removed) last.text += part.text;
    else out.push({ ...part });
  }
  return out;
}

/** The start of a fragment directive such as "#:~:text=…" (URL Fragment Text Directives). */
const DIRECTIVE = ':~:';

/**
 * Removes the tracking parts of one link, working on the text as written so
 * that everything kept keeps its exact spelling.
 * @param {string} text  The link as written (with or without https://).
 * @param {string} host  Its host, for the rules that apply on one site only.
 * @param {string} [pathname]  Its path as parsed, for the rules that apply on some pages only.
 * @returns {{ clean: string, parts: Part[], removed: string[] }}
 */
function cleanWritten(text, host, pathname = '/') {
  /** @type {string[]} */
  const removed = [];
  /** @param {string} name */
  const note = (name) => {
    if (!removed.includes(name)) removed.push(name);
  };
  const hashAt = text.indexOf('#');
  const fragment = hashAt === -1 ? '' : text.slice(hashAt);
  const beforeHash = hashAt === -1 ? text : text.slice(0, hashAt);
  const queryAt = beforeHash.indexOf('?');
  const path = queryAt === -1 ? beforeHash : beforeHash.slice(0, queryAt);
  const query = queryAt === -1 ? null : beforeHash.slice(queryAt + 1);

  /** @type {Part[]} */
  const parts = [];
  let keptPath = path;
  const pathRule = PATH_TRACKING.find((rule) => rule.host.test(host));
  const inPath = pathRule?.pattern.exec(path);
  if (pathRule && inPath) {
    note(pathRule.name);
    keptPath = path.slice(0, inPath.index) + path.slice(inPath.index + inPath[0].length);
    parts.push({ text: path.slice(0, inPath.index), removed: false }, { text: inPath[0], removed: true }, { text: path.slice(inPath.index + inPath[0].length), removed: false });
  } else {
    parts.push({ text: path, removed: false });
  }

  /** @type {string[]} */
  const kept = [];
  if (query !== null) {
    query.split('&').forEach((pair, index) => {
      const separator = index === 0 ? '?' : '&';
      const name = pair.split('=')[0];
      const drop = pair === '' || isTracking(name, host, pathname);
      if (drop && pair !== '') note(name);
      if (!drop) kept.push(pair);
      parts.push({ text: separator + pair, removed: drop });
    });
  }

  let keptFragment = fragment;
  const directiveAt = fragment.indexOf(DIRECTIVE);
  if (directiveAt !== -1) {
    note('#:~:text');
    keptFragment = directiveAt === 1 ? '' : fragment.slice(0, directiveAt);
    parts.push({ text: keptFragment, removed: false }, { text: fragment.slice(keptFragment.length), removed: true });
  } else {
    parts.push({ text: fragment, removed: false });
  }
  return { clean: keptPath + (kept.length ? `?${kept.join('&')}` : '') + keptFragment, parts: merge(parts), removed };
}

/**
 * @typedef {{ status: 'invalid' } | { status: 'ok', url: string, removed: string[], unwrapped: string[], parts: Part[], shared: string[], lookup: string[], short: string[], emails: string[], secrets: string[] }} CleanResult
 *   removed: names of the parts taken out; unwrapped: hosts of redirect pages skipped;
 *   parts: the link as pasted, split into what was kept and what was removed;
 *   shared: platforms whose share links (tied to the sharer's account) the text contains;
 *   lookup: platforms whose short share links (looked up when opened) it contains;
 *   short: hosts of short links; emails, secrets: email addresses and sign-in-like parameters left in the link.
 */

/**
 * @param {string} input
 * @returns {CleanResult}
 */
export function cleanUrl(input) {
  const text = input.trim();
  // "example.com/page" pasted without a scheme is still clearly a link.
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(text) || !/^[^\s/?#]+\.[^\s]+$/.test(text) ? text : `https://${text}`;
  const pasted = parseWebUrl(withScheme);
  if (!pasted) return { status: 'invalid' };

  const { url, via } = unwrap(pasted);
  if (via.length === 0) {
    const result = cleanWritten(withScheme, pasted.hostname, pasted.pathname);
    const parts = withScheme === text ? result.parts : merge([{ text: 'https://', removed: false }, ...result.parts]);
    return { status: 'ok', url: result.clean, removed: result.removed, unwrapped: [], parts, ...shares(pasted) };
  }
  const result = cleanWritten(url.href, url.hostname, url.pathname);
  return { status: 'ok', url: result.clean, removed: result.removed, unwrapped: via, parts: [{ text, removed: true }], ...shares(url) };
}

/**
 * What the result says about a link besides what was removed.
 * @param {URL} url
 * @returns {{ shared: string[], lookup: string[], short: string[], emails: string[], secrets: string[] }}
 */
function shares(url) {
  const share = shareLink(url);
  const short = SHORTENERS.some((link) => link.host.test(url.hostname) && link.path.test(url.pathname)) ? [url.hostname] : [];
  return { shared: share?.kind === 'account' ? [share.name] : [], lookup: share?.kind === 'lookup' ? [share.name] : [], short, ...personalData(url) };
}

/**
 * Cleans one link, or every link in a longer text, leaving the words around
 * them as they are. A link with nothing to remove keeps its exact spelling;
 * a link written without https:// keeps that form.
 * @param {string} input
 * @returns {{ status: 'invalid' } | { status: 'ok', url: string, removed: string[], unwrapped: string[], links: number, parts: Part[], shared: string[], lookup: string[], short: string[], emails: string[], secrets: string[] }}
 *   url: the clean link, or the whole text with its links cleaned.
 */
export function cleanText(input) {
  if (!/\s/.test(input.trim())) {
    const single = cleanUrl(input);
    return single.status === 'ok' ? { ...single, links: 1 } : single;
  }
  const links = findLinks(input, { bare: true });
  if (links.length === 0) return { status: 'invalid' };
  /** @type {Set<string>} */
  const removed = new Set();
  /** @type {Set<string>} */
  const unwrapped = new Set();
  /** @type {Set<string>} */
  const shared = new Set();
  /** @type {Set<string>} */
  const lookup = new Set();
  /** @type {Record<'short' | 'emails' | 'secrets', Set<string>>} */
  const notes = { short: new Set(), emails: new Set(), secrets: new Set() };
  /** @type {Part[]} */
  const parts = [];
  let text = '';
  let at = 0;
  for (const link of links) {
    const between = input.slice(at, link.start);
    parts.push({ text: between, removed: false });
    text += between;
    at = link.end;
    const result = cleanUrl(link.text);
    if (result.status === 'ok') {
      result.shared.forEach((name) => shared.add(name));
      result.lookup.forEach((name) => lookup.add(name));
      for (const key of /** @type {const} */ (['short', 'emails', 'secrets'])) result[key].forEach((value) => notes[key].add(value));
    }
    if (result.status !== 'ok' || (result.removed.length === 0 && result.unwrapped.length === 0)) {
      parts.push({ text: link.text, removed: false });
      text += link.text;
      continue;
    }
    // A link written without https:// stays that way unless a redirect page was skipped.
    const written = result.unwrapped.length === 0 && !/^https?:\/\//i.test(link.text) ? result.url.replace(/^https:\/\//, '') : result.url;
    text += written;
    parts.push(...(result.unwrapped.length === 0 && written !== result.url ? result.parts.slice(1) : result.parts));
    result.removed.forEach((name) => removed.add(name));
    result.unwrapped.forEach((host) => unwrapped.add(host));
  }
  parts.push({ text: input.slice(at), removed: false });
  text += input.slice(at);
  return {
    status: 'ok', url: text, removed: [...removed], unwrapped: [...unwrapped], links: links.length, parts: merge(parts), shared: [...shared], lookup: [...lookup],
    short: [...notes.short], emails: [...notes.emails], secrets: [...notes.secrets],
  };
}

/** Waits this long after the last keystroke before cleaning again, so long pastes stay smooth. */
const TYPING_PAUSE_MS = 150;

/** @param {HTMLElement} root */
export function init(root) {
  /** @param {string} name */
  const find = (name) => /** @type {HTMLElement} */ (root.querySelector(`[data-js="links-${name}"]`));
  const input = /** @type {HTMLTextAreaElement} */ (find('input'));
  const output = find('output');
  const message = find('message');
  const diffBox = find('diff-box');
  const diff = find('diff');
  const example = find('example');
  const share = find('share');
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let pending;

  const update = () => {
    clearTimeout(pending);
    const result = input.value.trim() === '' ? null : cleanText(input.value);
    output.textContent = result?.status === 'ok' ? result.url : '';
    diffBox.hidden = true;
    if (!result) {
      message.textContent = '';
      return;
    }
    if (result.status === 'invalid') {
      message.textContent = message.dataset.invalid ?? '';
      return;
    }
    const parts = [];
    if (result.links > 1) parts.push(fillText(message.dataset.several, { n: String(result.links) }));
    if (result.unwrapped.length) parts.push(fillText(message.dataset.unwrapped, { host: result.unwrapped.join(', ') }));
    if (result.removed.length) parts.push(fillText(message.dataset.removed, { list: result.removed.join(', ') }));
    for (const host of result.shared) parts.push((message.dataset.shared ?? '').replaceAll('{host}', host));
    for (const host of result.lookup) parts.push((message.dataset.lookup ?? '').replaceAll('{host}', host));
    for (const host of result.short) parts.push(fillText(message.dataset.short, { host }));
    // Personal data is worth more to a stranger than any tracker: said even when something was removed.
    if (result.emails.length) parts.push(fillText(message.dataset.email, { list: result.emails.join(', ') }));
    if (result.secrets.length) parts.push(fillText(message.dataset.secret, { list: result.secrets.join(', ') }));
    if (!result.removed.length && !result.unwrapped.length && !result.shared.length && !result.lookup.length && !result.short.length) parts.push(message.dataset.clean ?? '');
    message.textContent = parts.filter(Boolean).join(' ');

    const changed = result.parts.some((part) => part.removed);
    diffBox.hidden = !changed;
    diff.replaceChildren(
      ...result.parts.map((part) => {
        if (!part.removed) return document.createTextNode(part.text);
        const element = document.createElement('del');
        element.className = 'marked__removed';
        element.textContent = part.text;
        return element;
      }),
    );
  };

  input.addEventListener('input', () => {
    clearTimeout(pending);
    pending = setTimeout(update, TYPING_PAUSE_MS);
  });
  example.addEventListener('click', () => {
    input.value = example.dataset.example ?? '';
    update();
  });
  share.addEventListener('click', () => {
    if (output.textContent === '' || typeof navigator.share !== 'function') return;
    // Cancelling the share sheet rejects too; there is nothing to report then.
    navigator.share({ text: output.textContent }).catch((error) => {
      if (error?.name !== 'AbortError') console.warn('[lockwell] The browser could not share the clean link.', error);
    });
  });
  update();
}

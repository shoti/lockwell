// @ts-check
/**
 * @file Tool "Link cleaner": removes tracking parameters and redirects from links.
 */
/**
 * Link cleaner: removes tracking parameters and redirect detours from a link.
 * It only edits text. The link is never opened, fetched, saved or sent.
 */

/** Parameters that only identify a click, a campaign or the person who shared the link. */
const TRACKING = new Set([
  'fbclid', 'gclid', 'gclsrc', 'dclid', 'gbraid', 'wbraid', 'gad_source', 'gad_campaignid', 'srsltid',
  'msclkid', 'twclid', 'ttclid', 'li_fat_id', 'yclid', 'ysclid', 'rdt_cid', 'epik',
  'igshid', 'igsh', 'mibextid', 'mc_cid', 'mc_eid', 'mkt_tok',
  '_ga', '_gl', '_hsenc', '_hsmi', 'hsctatracking', 'oly_anon_id', 'oly_enc_id',
  'vero_id', 'vero_conv', 's_cid', 'sc_cid', 'cmpid', '_openstat', 'wickedid', 'ref_src', 'ref_url',
]);

const TRACKING_PREFIXES = ['utm_', 'pk_', 'mtm_', 'hsa_', '__hs'];

/** Parameters that track only on particular sites (elsewhere the same name may be needed). */
const SITE_TRACKING = [
  { host: /(^|\.)(youtube\.com|youtu\.be|spotify\.com)$/, names: ['si', 'pp', 'feature'], prefixes: [] },
  { host: /(^|\.)(twitter\.com|x\.com)$/, names: ['s', 't'], prefixes: [] },
  { host: /(^|\.)tiktok\.com$/, names: ['_r', '_t', 'is_from_webapp', 'is_copy_url', 'sender_device', 'sender_web_id'], prefixes: [] },
  { host: /(^|\.)amazon\.[a-z.]+$/, names: ['ref_', 'ref'], prefixes: ['pf_rd_', 'pd_rd_'] },
];

/** Redirect pages that carry the real address in a parameter. */
const WRAPPERS = [
  { host: /^lm?\.facebook\.com$/, path: '/l.php', params: ['u'] },
  { host: /^l\.instagram\.com$/, path: '/', params: ['u'] },
  { host: /^(www\.)?google\.[a-z.]+$/, path: '/url', params: ['q', 'url'] },
  { host: /^(www\.)?youtube\.com$/, path: '/redirect', params: ['q'] },
  { host: /^out\.reddit\.com$/, path: null, params: ['url'] },
  { host: /^(away\.)?vk\.com$/, path: '/away.php', params: ['to'] },
  { host: /^(www\.)?linkedin\.com$/, path: '/redir/redirect', params: ['url'] },
];

/** Stops a chain of redirect pages pointing at each other from looping. */
const MAX_UNWRAPS = 5;

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
 * If `url` is a known redirect page, the address it forwards to.
 * @param {URL} url
 * @returns {URL | null}
 */
export function redirectTarget(url) {
  const wrapper = WRAPPERS.find((w) => w.host.test(url.hostname) && (w.path === null || w.path === url.pathname));
  for (const param of wrapper?.params ?? []) {
    const target = parseWebUrl(url.searchParams.get(param) ?? '');
    if (target) return target;
  }
  return null;
}

/**
 * @param {string} name  Parameter name as written in the link.
 * @param {string} host
 */
export function isTracking(name, host) {
  let key = name;
  try {
    key = decodeURIComponent(name.replace(/\+/g, ' '));
  } catch {
    // Not valid percent-encoding: compare the raw name.
  }
  key = key.toLowerCase();
  if (TRACKING.has(key) || TRACKING_PREFIXES.some((prefix) => key.startsWith(prefix))) return true;
  return SITE_TRACKING.some(
    (site) => site.host.test(host) && (site.names.includes(key) || site.prefixes.some((prefix) => key.startsWith(prefix))),
  );
}

/**
 * The web links in a text such as a pasted message.
 * @param {string} text
 * @returns {{ start: number, end: number, text: string }[]}
 */
export function findLinks(text) {
  const links = [];
  for (const match of text.matchAll(/\b(?:https?:\/\/|www\.)[^\s<>"'`]+/gi)) {
    let link = match[0];
    // Punctuation that ends the sentence, not the link; a bracket only if it was opened outside the link.
    while (/[.,;:!?»”’]$/.test(link) || (link.endsWith(')') && !link.includes('('))) link = link.slice(0, -1);
    links.push({ start: match.index, end: match.index + link.length, text: link });
  }
  return links;
}

/**
 * @typedef {{ status: 'invalid' } | { status: 'ok', url: string, removed: string[], unwrapped: string[] }} CleanResult
 *   removed: names of the parameters taken out; unwrapped: hosts of redirect pages skipped.
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

  let url = pasted;
  /** @type {string[]} */
  const unwrapped = [];
  for (let i = 0; i < MAX_UNWRAPS; i += 1) {
    const target = redirectTarget(url);
    if (!target) break;
    unwrapped.push(url.hostname);
    url = target;
  }

  /** @type {string[]} */
  const removed = [];
  const host = url.hostname;
  // Works on the raw text so the parameters that stay keep their exact spelling.
  const kept = url.search
    .slice(1)
    .split('&')
    .filter((pair) => {
      if (pair === '') return false;
      const name = pair.split('=')[0];
      if (!isTracking(name, host)) return true;
      if (!removed.includes(name)) removed.push(name);
      return false;
    });
  url.search = kept.join('&');
  return { status: 'ok', url: url.href, removed, unwrapped };
}

/**
 * Cleans one link, or every link in a longer text, leaving the words around
 * them as they are. A link with nothing to remove keeps its exact spelling.
 * @param {string} input
 * @returns {{ status: 'invalid' } | { status: 'ok', url: string, removed: string[], unwrapped: string[], links: number }}
 *   url: the clean link, or the whole text with its links cleaned.
 */
export function cleanText(input) {
  if (!/\s/.test(input.trim())) {
    const single = cleanUrl(input);
    return single.status === 'ok' ? { ...single, links: 1 } : single;
  }
  const links = findLinks(input);
  if (links.length === 0) return { status: 'invalid' };
  /** @type {Set<string>} */
  const removed = new Set();
  /** @type {Set<string>} */
  const unwrapped = new Set();
  let text = '';
  let at = 0;
  for (const link of links) {
    const result = cleanUrl(link.text);
    const changed = result.status === 'ok' && (result.removed.length > 0 || result.unwrapped.length > 0);
    text += input.slice(at, link.start) + (changed ? result.url : link.text);
    at = link.end;
    if (result.status !== 'ok') continue;
    result.removed.forEach((name) => removed.add(name));
    result.unwrapped.forEach((host) => unwrapped.add(host));
  }
  return { status: 'ok', url: text + input.slice(at), removed: [...removed], unwrapped: [...unwrapped], links: links.length };
}

/** @param {HTMLElement} root */
export function init(root) {
  const input = /** @type {HTMLTextAreaElement} */ (root.querySelector('[data-js="links-input"]'));
  const output = /** @type {HTMLElement} */ (root.querySelector('[data-js="links-output"]'));
  const message = /** @type {HTMLElement} */ (root.querySelector('[data-js="links-message"]'));

  const update = () => {
    if (input.value.trim() === '') {
      output.textContent = '';
      message.textContent = '';
      return;
    }
    const result = cleanText(input.value);
    if (result.status === 'invalid') {
      output.textContent = '';
      message.textContent = message.dataset.invalid ?? '';
      return;
    }
    output.textContent = result.url;
    const parts = [];
    if (result.links > 1) parts.push((message.dataset.several ?? '').replace('{n}', String(result.links)));
    if (result.unwrapped.length) parts.push((message.dataset.unwrapped ?? '').replace('{host}', result.unwrapped.join(', ')));
    parts.push(result.removed.length ? (message.dataset.removed ?? '').replace('{list}', result.removed.join(', ')) : '');
    if (!result.removed.length && !result.unwrapped.length) parts.push(message.dataset.clean ?? '');
    message.textContent = parts.filter(Boolean).join(' ');
  };

  input.addEventListener('input', update);
  update();
}

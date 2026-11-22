// @ts-check
/**
 * @file Tool "Email header analyzer": who really sent a message, where replies go, what the visitor's own mail
 * provider checked, which servers it passed through, and which details are warning signs.
 */
/**
 * The tool makes no request, so it can't look anything up in DNS or verify a signature. It reads what the receiving
 * server wrote into the message, and believes only the lines the visitor's own provider wrote (trustBoundary):
 * everything below them was supplied by the sending side and could be invented (RFC 8601 §5, §7.1). It never says
 * "safe" and never says "phishing": a pass ties a message to a mailbox, not to a person (RFC 8601 §7.2).
 * Sources and choices: docs/research/tool-email-headers.md, docs/tools-plan/email-headers.md.
 */
import { isCfb, readCfb } from './cfb.mjs';
import { RISKY_EXTENSIONS, checkName } from './file-name.mjs';
import { INTERNAL, ipClass, parseIp } from './ip.mjs';
import { anchorsFromHtml } from './link-text.mjs';
import { parseArcSets, parseAuthResults, parseDkimSignature, parsePairs, parseReceived, parseSpamStatus } from './mail-auth.mjs';
import { MAX_TEXT, decodeWords, fieldsNamed, parseAddresses, parseDate, parseMessageIds, readMime, splitMessage } from './mail-parse.mjs';
import { CONTROL, decodeText, oneLine } from './metadata-text.mjs';
import { receiveFiles } from './files.mjs';
import { fillInto, fillText } from './fill.mjs';
import { siteOf } from './site.mjs';
import { inspectLink, inspectText, unicodeHost } from './tool-check.mjs';
import { TLDS } from './top-level-domains.mjs';

/** @typedef {import('./mail-parse.mjs').Field} Field */
/** @typedef {import('./mail-auth.mjs').AuthResults} AuthResults */
/** @typedef {import('./mail-auth.mjs').Received} Received */
/** @typedef {import('./ip.mjs').IpClass} IpClass */

/* ---------- Data ---------- */

/**
 * Domains where anyone can open a mailbox, each confirmed on the provider's own page (research §13). A short list
 * of large providers only; a missing one only means no note.
 */
export const FREE_MAIL = new Set(['gmail.com', 'outlook.com', 'icloud.com', 'me.com', 'mac.com', 'proton.me', 'protonmail.com', 'yahoo.com']);

/** Who an authserv-id belongs to, for display only; never changes trust. Only ids in vendor documentation (research §13). */
const PROVIDERS = /** @type {Record<string, string>} */ ({ 'mx.microsoft.com': 'Microsoft' });

/**
 * Result words per method: the IANA registry (research §2) and Microsoft's own values (§5). Anything else is shown
 * as written with "not a value this tool knows".
 */
export const KNOWN_RESULTS = /** @type {Record<string, string[]>} */ ({
  spf: ['pass', 'fail', 'softfail', 'neutral', 'none', 'temperror', 'permerror', 'policy', 'hardfail'],
  dkim: ['pass', 'fail', 'neutral', 'none', 'policy', 'temperror', 'permerror'],
  dmarc: ['pass', 'fail', 'none', 'temperror', 'permerror', 'bestguesspass'],
  arc: ['pass', 'fail', 'none'],
  compauth: ['pass', 'fail', 'softpass', 'none'],
});
/** The methods the report shows as rows, in this order. */
export const CHECK_METHODS = /** @type {const} */ (['spf', 'dkim', 'dmarc', 'arc', 'compauth']);

/** Microsoft's spam-filter values that mean the filter marked the message (research §5): SFV and CAT. */
const MICROSOFT_SPAM_SFV = new Set(['SPM', 'SKS', 'SKB', 'BLK']);
const MICROSOFT_SPAM_CAT = new Set(['PHSH', 'HPHSH', 'HPHISH', 'SPOOF', 'SPM', 'HSPM', 'MALW', 'AMP', 'BIMP', 'DIMP', 'GIMP', 'UIMP', 'INTOS']);
/** Microsoft's fields shown in the filter section, in this order. */
export const FILTER_KEYS = /** @type {const} */ (['SFV', 'CAT', 'SCL', 'BCL', 'CIP', 'CTRY', 'DIR', 'SFTY']);

/**
 * Words that make a shown name an organisation's (a bank, an office, a service desk), in English and Georgian. A
 * free mailbox under such a name is a sourced trick (research §7: Proton's "United Nations Compensation" from a
 * free address); a free mailbox under a person's name is ordinary and gets no note.
 */
const ORGANISATION_WORDS = [
  'bank', 'banking', 'support', 'service', 'services', 'team', 'security', 'admin', 'administrator', 'office', 'ministry', 'government', 'police',
  'court', 'tax', 'delivery', 'post', 'parcel', 'customs', 'account', 'accounts', 'billing', 'customer', 'helpdesk', 'notification', 'noreply',
  'no-reply', 'hr', 'payroll', 'finance', 'director', 'ceo', 'department', 'agency', 'company', 'official',
];
const ORGANISATION_STEMS_KA = ['ბანკ', 'სამინისტრო', 'მხარდაჭერ', 'სერვის', 'ოფის', 'ფოსტ', 'დირექტორ', 'სამსახურ', 'პოლიცი', 'სასამართლო', 'შემოსავლ', 'ადმინისტრაცი', 'განყოფილებ', 'კომპანი', 'სააგენტო'];

/* ---------- Findings and verdicts ---------- */

/**
 * @typedef {'warn' | 'note' | 'info'} Level
 * @typedef {keyof typeof FINDINGS} FindingKey
 * @typedef {{ key: FindingKey, level: Level, values: string[], variant: string }} Finding
 * @typedef {'warn' | 'unchecked' | 'none'} Verdict
 */

/** Every finding and its level, in the order they are listed: most serious first. */
export const FINDINGS = /** @type {const} */ ({
  dmarcFail: 'warn',
  spoofedSender: 'warn',
  replyElsewhere: 'warn',
  nameIsAddress: 'warn',
  lookalikeDomain: 'warn',
  riskyAttachment: 'warn',
  nameHidden: 'warn',
  severalFrom: 'warn',
  filterSaidSpam: 'warn',
  dkimLength: 'warn',
  arcBroken: 'warn',
  noChecks: 'note',
  partial: 'note',
  spfFail: 'note',
  spfSoftfail: 'note',
  dkimFail: 'note',
  freeMailbox: 'note',
  signedByOther: 'note',
  fakeReply: 'note',
  dateOdd: 'note',
  slowHop: 'note',
  backwards: 'note',
  plainHop: 'note',
  privateOrigin: 'note',
  forwarded: 'note',
  oldDkim: 'note',
  bulkSender: 'info',
  mailingList: 'info',
  autoReply: 'info',
  software: 'info',
  senderAddress: 'info',
  messageIdElsewhere: 'info',
  encryptedInTransit: 'info',
  remoteImages: 'info',
});

/**
 * The verdict: warning signs when any finding warns; "couldn't be checked" when the provider's checks are missing
 * or only part of the headers was given; otherwise "no warning signs found" (never "safe").
 * @param {Finding[]} findings
 * @returns {Verdict}
 */
export function verdictOf(findings) {
  if (findings.some((finding) => finding.level === 'warn')) return 'warn';
  if (findings.some((finding) => finding.key === 'noChecks' || finding.key === 'partial')) return 'unchecked';
  return 'none';
}

/** Collects findings, one per key, merging values; listed in FINDINGS order. */
class Findings {
  /** @type {Map<FindingKey, Finding>} */
  map = new Map();
  /** @param {FindingKey} key @param {string[]} [values] @param {string} [variant] */
  add(key, values = [], variant = '') {
    const found = this.map.get(key) ?? { key, level: FINDINGS[key], values: [], variant };
    for (const value of values) {
      const clean = oneLine(value);
      if (clean && !found.values.includes(clean) && found.values.length < 10) found.values.push(clean);
    }
    if (variant) found.variant = variant;
    this.map.set(key, found);
  }
  /** @param {FindingKey} key */
  has(key) {
    return this.map.has(key);
  }
  get list() {
    const order = Object.keys(FINDINGS);
    return [...this.map.values()].sort((a, b) => order.indexOf(a.key) - order.indexOf(b.key));
  }
}

/* ---------- Domains ---------- */

/** The part after the last "@", lowercase, without brackets or a final dot. @param {string} text */
export function domainOf(text) {
  const at = text.lastIndexOf('@');
  return (at === -1 ? text : text.slice(at + 1)).trim().replace(/^[<[]|[>\]]$/g, '').replace(/\.$/, '').toLowerCase();
}

/**
 * The registered name ("organisational domain") of a host, from the Public Suffix List in the site. RFC 9989 uses a
 * DNS tree walk instead, which needs lookups this tool doesn't make (research §3); the provider's own dmarc= result
 * is preferred wherever there is one. An IP address, or a name that isn't a host, is returned as it is.
 * @param {string} host
 */
export function organisationOf(host) {
  const clean = domainOf(host);
  if (!clean || parseIp(clean) || !clean.includes('.')) return clean;
  try {
    const ascii = new URL(`http://${clean}`).hostname;
    return siteOf(unicodeHost(ascii).toLowerCase()).site;
  } catch {
    return clean;
  }
}

/** @type {Set<string> | null} */
let tlds = null;
/** @param {string} ending */
const isTld = (ending) => (tlds ??= new Set(TLDS.split(','))).has(ending);

/**
 * Addresses and domain names written inside a shown name: "service@bank.ge" or "bank.ge" in "service@bank.ge
 * <x@other.example>".
 * @param {string} name
 * @returns {string[]}  The domains found, lowercase.
 */
export function domainsInName(name) {
  /** @type {string[]} */
  const out = [];
  // Fullwidth "＠" and "．" are the same characters to a reader (review E21).
  for (const word of name.normalize('NFKC').split(/[\s<>()"',;:[\]]+/)) {
    const domain = domainOf(word).replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');
    const labels = domain.split('.');
    if (labels.length < 2 || labels.some((label) => !/^[\p{L}\p{N}-]{1,63}$/u.test(label))) continue;
    // "Kate.Design" is a name written with a dot, not the domain kate.design: a capitalised word as the last part.
    const last = word.split('.').pop() ?? '';
    const capitalised = last.length > 3 && /^\p{Lu}\p{Ll}+$/u.test(last);
    if ((isTld(labels[labels.length - 1]) && !capitalised) || word.includes('@')) out.push(domain);
  }
  return out;
}

/**
 * Mail domains a company names as its own on its own pages, which the lookalike rules would otherwise take for
 * imitations of it (review E13). Each one sourced: research log, "Review E13". A domain without such a page stays
 * out, however likely it is to be real (paypal-communication.com and microsoft365.com, 2026-11-22).
 */
const OFFICIAL_MAIL = new Set([
  'amazonses.com', // Amazon SES's default MAIL FROM domain: docs.aws.amazon.com/ses/latest/dg/mail-from.html
  'dropboxmail.com', // Dropbox's official email domains: help.dropbox.com/security/official-domains
  'dropboxpartners.com',
  'dropboxteam.com',
]);

/** The link checker's warnings that mean a host name imitates another one. */
const LOOKALIKE_WARNINGS = new Set(['mixedScript', 'lookalikeScript', 'latinLookalike', 'brandElsewhere', 'brandSubdomain', 'brandLookalike', 'typo', 'nestedDomain']);

/**
 * Whether a mail domain imitates a well-known name, by the link checker's rules.
 * @param {string} domain
 * @returns {{ shown: string, brand: string } | null}
 */
export function lookalike(domain) {
  if (!domain || parseIp(domain) || OFFICIAL_MAIL.has(organisationOf(domain))) return null;
  const report = inspectLink(`https://${domain}/`);
  if (report.status !== 'ok' || !report.warnings.some((warning) => LOOKALIKE_WARNINGS.has(warning))) return null;
  return { shown: report.host, brand: report.details.brand ?? report.details.inner ?? '' };
}

/** Control and direction characters written out: "Bank⟨U+202E⟩". @param {string} text */
export const visibleControls = (text) => text.replace(new RegExp(CONTROL.source, 'gu'), (char) => `⟨U+${(char.codePointAt(0) ?? 0).toString(16).toUpperCase().padStart(4, '0')}⟩`);
/** Scripts whose spelling needs the zero-width joiner and non-joiner between letters (Persian, the Indic scripts…). */
const JOINING = '\\p{Script=Arabic}\\p{Script=Syriac}\\p{Script=Nko}\\p{Script=Devanagari}\\p{Script=Bengali}\\p{Script=Gurmukhi}\\p{Script=Gujarati}\\p{Script=Oriya}\\p{Script=Tamil}\\p{Script=Telugu}\\p{Script=Kannada}\\p{Script=Malayalam}\\p{Script=Sinhala}\\p{Script=Mongolian}\\p{Script=Myanmar}\\p{Script=Khmer}';
/** Joiners that are spelling, not hiding: between letters of those scripts, or between emoji in one emoji (review E12). */
const SPELLING_JOINER = new RegExp(`(?<=[${JOINING}]\\p{M}*)[\\u200c\\u200d](?=[${JOINING}])|(?<=\\p{Extended_Pictographic}[\\u{fe0f}\\u{1f3fb}-\\u{1f3ff}]?)\\u200d(?=\\p{Extended_Pictographic})`, 'gu');
/** @param {string} text */
const hasControls = (text) => new RegExp(CONTROL.source, 'u').test(text.replace(SPELLING_JOINER, ''));

/* ---------- Which lines can be believed ---------- */

/**
 * @typedef {object} Trust
 * @property {number} top  Index of the topmost Authentication-Results field, or -1.
 * @property {string} authservId  Who it says wrote it ("" when it doesn't say).
 * @property {boolean} receiverResults  The topmost results field is the receiver's own (see trustBoundary).
 * @property {number} boundary  Index of the first field supplied by the sending side: every field above it was written
 *   by the visitor's provider; this one and everything below could be invented.
 * @property {Set<string>} receiver  The provider's organisational domains, as far as the headers show them.
 */

/** The host that wrote a Received line: the first word of its "by" clause. @param {Received} line */
const byHost = (line) => (line.by.split(' ')[0] ?? '').toLowerCase();

/** A host given by name, not by address and not a bare word (Gmail's own internal lines start "by 2002:…"). @param {string} host */
const namedHost = (host) => host.includes('.') && !parseIp(host.replace(/^\[|\]$/g, ''));

/**
 * Whether the server that handed this line's message over sits outside the provider's organisations: the line is then
 * where the provider took the message in, and every line below it came with the message.
 *
 * A hop from a private or loopback address, or a line that names no sending side at all, is inside. Below the
 * provider's results (`strict`) only the name the provider looked up for the address counts besides: the sending
 * side writes its own name (HELO) and can choose the provider's (RFC 8601 B.5 shows such an inside hop). Above the
 * results, both names decide.
 * @param {Received} line @param {Set<string>} receiver @param {boolean} strict
 */
function fromOutside(line, receiver, strict) {
  if (line.ip && INTERNAL.has(ipClass(line.ip))) return false;
  if (!line.from && !line.fromAddress) return false;
  const names = (strict ? [line.reverse] : [line.from, line.reverse]).map((name) => name.toLowerCase().replace(/\.$/, '')).filter(namedHost);
  if (names.length === 0) return strict || Boolean(line.ip);
  return names.some((name) => !receiver.has(organisationOf(name)));
}

/**
 * Finds the fields the visitor's provider wrote. Each server adds its lines on top, so the provider's own are the top
 * ones: the topmost Authentication-Results and everything above it (research §2, §4; plan §5.3). Below it the trust
 * goes on only as far as the provider's hand-off line, the one where it took the message in from outside, and only
 * when that line has not already been seen above the results (Gmail writes it above, Microsoft below).
 *
 * A results field is the receiver's when its named writer belongs to one of the organisations whose Received lines sit
 * above it. A field that names no writer, or a single word, is believed only when the provider's hand-off line sits
 * below it, as Microsoft writes it: anywhere else it could come with the message (review E1–E3).
 * @param {Field[]} fields
 * @param {Map<number, Received>} received  Parsed Received lines by field index.
 * @returns {Trust}
 */
export function trustBoundary(fields, received) {
  const top = fields.findIndex((field) => field.key === 'authentication-results');
  const authservId = top === -1 ? '' : parseAuthResults(fields[top].value).authservId;
  const lines = [...received.entries()].sort(([a], [b]) => a - b);
  const above = top === -1 ? [] : lines.filter(([index]) => index < top);
  /** @type {Set<string>} */
  const receiver = new Set();
  const named = above.map(([, line]) => byHost(line)).filter(namedHost);
  for (const host of named) receiver.add(organisationOf(host));
  const ownId = organisationOf(authservId);
  const dotted = authservId.includes('.');
  const namesReceiver = top !== -1 && dotted && (named.length === 0 || named.some((host) => organisationOf(host) === ownId));
  if (namesReceiver) receiver.add(ownId);
  // No results at all: the topmost Received line is the provider's.
  if (top === -1 && lines[0] && namedHost(byHost(lines[0][1]))) receiver.add(organisationOf(byHost(lines[0][1])));
  receiver.delete('');
  /** @param {Received} line */
  const own = (line) => !namedHost(byHost(line)) || receiver.has(organisationOf(byHost(line)));

  let handoff = top === -1 ? -1 : (above.find(([, line]) => fromOutside(line, receiver, false))?.[0] ?? -1);
  let last = top;
  if (handoff === -1) {
    for (const [index, line] of top === -1 ? lines : lines.filter(([at]) => at > top)) {
      if (!own(line)) break;
      last = index;
      if (fromOutside(line, receiver, top !== -1)) {
        handoff = index;
        break;
      }
    }
  }
  let boundary = last + 1;
  if (top !== -1 && last === top) {
    // Nothing of the provider's below its results (Gmail's order, or only part of the headers was pasted): its
    // further results fields directly under them still count, never anything after another kind of field.
    while (fields[boundary]?.key === 'authentication-results' && parseAuthResults(fields[boundary].value).authservId === authservId) boundary += 1;
  }
  const receiverResults = top !== -1 && (dotted ? namesReceiver : handoff > top);
  return { top, authservId, receiverResults, boundary, receiver };
}

/**
 * The domain a List-Id names: the part in angle brackets, or the whole value (RFC 2919 §2).
 * @param {string} value
 */
export function listDomain(value) {
  const inside = /<([^<>]*)>/.exec(value)?.[1] ?? value;
  return inside.trim().toLowerCase().replace(/\.$/, '');
}

/* ---------- The report ---------- */

/**
 * @typedef {object} CheckRow
 * @property {string} method
 * @property {string} result  As written, lowercase.
 * @property {boolean} known  A result value this tool knows for the method.
 * @property {string} domain  Which domain the result is about ("" when the field doesn't say).
 * @property {boolean | null} aligned  That domain belongs to the same organisation as the From address (null: no domain).
 * @property {string} reason
 * @property {string[]} comments
 * @property {boolean} trusted  Written by the visitor's provider.
 *
 * @typedef {object} Hop
 * @property {string} from  As the sending side named itself.
 * @property {string} by
 * @property {string} address  The address the receiving server saw, as written.
 * @property {IpClass | ''} addressClass
 * @property {string} with
 * @property {boolean | null} tls
 * @property {boolean | null} auth
 * @property {number | null} date
 * @property {number | null} delay  Milliseconds since the previous hop, small clock differences shown as 0.
 * @property {boolean} trusted
 *
 * @typedef {object} Identity
 * @property {string} name  The shown name, decoded, with invisible characters written out.
 * @property {string} address  The From address ("" when it didn't parse).
 * @property {string} raw  The From field as written, when the address didn't parse.
 * @property {string} domain
 * @property {string} site  Its organisational domain.
 * @property {string} replyTo  Reply-To addresses, joined.
 * @property {boolean | null} replySame  Reply-To is the same organisation as From (null: no Reply-To).
 * @property {string} returnPath
 * @property {boolean | null} returnSame
 * @property {string[]} signedBy  Domains with a trusted DKIM pass.
 * @property {string} sender
 * @property {string} list
 * @property {Hop | null} handoff  The hop where the provider received the message.
 *
 * @typedef {object} Report
 * @property {'ok' | 'empty' | 'notHeaders' | 'tooLarge'} status
 * @property {Identity} identity
 * @property {{ authservId: string, provider: string, host: string, named: boolean }} receiver
 * @property {CheckRow[]} checks  Trusted rows first, then claimed ones.
 * @property {{ key: string, value: string }[]} filter  The provider's spam filter fields, trusted only.
 * @property {Hop[]} route  From the sender to the visitor.
 * @property {Finding[]} findings
 * @property {Verdict} verdict
 * @property {{ name: string, value: string }[]} headers  Every field, decoded.
 * @property {number} unparsed  Lines in the header block that aren't fields.
 * @property {number} notRead  Fields beyond the limit.
 * @property {{ sent: number | null, received: number | null }} dates
 * @property {Body | null} body  What the message body holds, when the whole message was given.
 *
 * @typedef {object} Body
 * @property {{ url: string, warnings: number }[]} links  At most MAX_BODY_LINKS, judged by the link checker.
 * @property {number} linksTotal
 * @property {{ name: string, type: string, size: number, risky: boolean }[]} attachments  At most MAX_ATTACHMENTS.
 * @property {number} attachmentsTotal
 * @property {number} remoteImages  Pictures the HTML loads from the internet.
 * @property {boolean} unread  Part of the body wasn't read (too large, nested too deeply, too many parts).
 */

/** Links listed from the body (the link checker's own limit). */
export const MAX_BODY_LINKS = 10;
/** Attached files listed; the rest are counted. */
export const MAX_ATTACHMENTS = 50;
/** HTML read for links and pictures, at most (characters). */
const MAX_HTML = 1024 * 1024;

/** Delays below this are clock differences between servers (plan §9.3). */
const CLOCK_SLACK = 5 * 60_000;
const HOUR = 60 * 60_000;
const WEEK = 7 * 24 * HOUR;

/** @param {Report['status']} status @returns {Report} */
const emptyReport = (status) => ({
  status,
  identity: { name: '', address: '', raw: '', domain: '', site: '', replyTo: '', replySame: null, returnPath: '', returnSame: null, signedBy: [], sender: '', list: '', handoff: null },
  receiver: { authservId: '', provider: '', host: '', named: false },
  checks: [],
  filter: [],
  route: [],
  findings: [],
  verdict: 'unchecked',
  headers: [],
  unparsed: 0,
  notRead: 0,
  dates: { sent: null, received: null },
  body: null,
});

/**
 * The domain a result is about: SPF's envelope sender, DKIM's signing domain, DMARC's From domain.
 * @param {import('./mail-auth.mjs').AuthResult} result
 */
function resultDomain(result) {
  /** @param {string} ptype @param {string} property */
  const prop = (ptype, property) => result.props.find((p) => p.ptype === ptype && p.property === property)?.value ?? '';
  // Not smtp.helo: DMARC never aligns on it, so neither does this (review E26).
  if (result.method === 'spf') return domainOf(prop('smtp', 'mailfrom') || prop('smtp', 'from') || prop('smtp', 'mfrom'));
  if (result.method === 'dkim') return domainOf(prop('header', 'd') || prop('header', 'i'));
  if (result.method === 'dmarc') return domainOf(prop('header', 'from'));
  return '';
}

/**
 * Reads a pasted header block or message source and judges it.
 * @param {string} text
 * @param {{ limit?: number }} [options]  Characters read at most (a chosen file: MAX_FILE; pasted text: MAX_TEXT).
 * @returns {Report}
 */
export function inspectMessage(text, { limit } = {}) {
  if (text.trim() === '') return emptyReport('empty');
  const message = splitMessage(text, limit === undefined ? {} : { limit });
  if (message.tooLarge) return emptyReport('tooLarge');
  if (message.fields.length === 0) return emptyReport('notHeaders');
  const report = emptyReport('ok');
  const { fields } = message;
  report.unparsed = message.unparsed.length;
  report.notRead = message.notRead;
  report.headers = fields.map((field) => ({ name: field.name, value: visibleControls(decodeWords(field.value).text) }));
  const found = new Findings();
  /** @param {string} key */
  const all = (key) => fieldsNamed(fields, key);
  /** @param {string} key */
  const one = (key) => all(key)[0]?.value ?? '';

  /** @type {Map<number, Received>} */
  const received = new Map(all('received').slice(0, 100).map((field) => [field.index, parseReceived(field.value)]));
  const trust = trustBoundary(fields, received);
  /** @param {{ index: number }} field */
  const trusted = (field) => field.index < trust.boundary;

  /* Who sent it */
  const fromFields = all('from');
  const fromList = fromFields.length ? parseAddresses(fromFields[0].value) : [];
  const from = fromList[0];
  const identity = report.identity;
  identity.name = visibleControls(from?.name ?? '');
  identity.address = from?.address ?? '';
  identity.raw = from && from.bad ? from.raw : '';
  identity.domain = from ? domainOf(from.domain) : '';
  identity.site = organisationOf(identity.domain);
  const replyField = one('reply-to');
  const replyItems = parseAddresses(replyField);
  const replyList = replyItems.filter((item) => !item.bad);
  // An address that doesn't read is shown as written and never counts as the sender's own (review E14).
  const replyUnread = replyItems.filter((item) => item.bad).map((item) => oneLine(item.raw));
  if (replyItems.length === 0 && replyField.trim()) replyUnread.push(oneLine(replyField));
  identity.replyTo = [...replyList.map((item) => item.address), ...replyUnread].join(', ');
  const replySites = replyList.map((item) => organisationOf(item.domain));
  identity.replySame = replyList.length || replyUnread.length ? replyUnread.length === 0 && replySites.every((site) => site === identity.site) : null;
  const returnPath = parseAddresses(one('return-path')).find((item) => !item.bad);
  identity.returnPath = returnPath?.address ?? '';
  identity.returnSame = returnPath ? organisationOf(returnPath.domain) === identity.site : null;
  identity.sender = parseAddresses(one('sender')).find((item) => !item.bad)?.address ?? '';
  identity.list = oneLine(decodeWords(one('list-id')).text);

  /* What the provider checked */
  const resultFields = all('authentication-results');
  /** @type {CheckRow[]} */
  const rows = [];
  for (const field of resultFields) {
    const isTrusted = trust.receiverResults && trusted(field) && parseAuthResults(field.value).authservId === trust.authservId;
    const read = parseAuthResults(field.value);
    for (const result of read.results) {
      if (!(/** @type {readonly string[]} */ (CHECK_METHODS)).includes(result.method)) continue;
      const domain = resultDomain(result);
      rows.push({
        method: result.method,
        result: result.result,
        known: KNOWN_RESULTS[result.method]?.includes(result.result) ?? false,
        domain,
        // DMARC's domain is the From domain by definition: no comparison to show.
        aligned: domain !== '' && identity.site !== '' && result.method !== 'dmarc' ? organisationOf(domain) === identity.site : null,
        reason: result.reason,
        comments: result.comments,
        trusted: isTrusted,
      });
    }
  }
  report.checks = [...rows.filter((row) => row.trusted), ...rows.filter((row) => !row.trusted)].slice(0, 100);
  const checks = rows.filter((row) => row.trusted);
  /** @param {string} method */
  const resultsOf = (method) => checks.filter((row) => row.method === method);
  const anyTrusted = trust.receiverResults && checks.length > 0;
  report.receiver = { authservId: trust.receiverResults ? trust.authservId : '', provider: PROVIDERS[trust.authservId] ?? '', host: '', named: trust.receiverResults && trust.authservId !== '' };

  const dmarc = resultsOf('dmarc');
  const compauth = resultsOf('compauth');
  const dmarcPassed = dmarc.some((row) => row.result === 'pass' || row.result === 'bestguesspass') || compauth.some((row) => row.result === 'pass');
  const dmarcFailed = dmarc.some((row) => row.result === 'fail') || compauth.some((row) => row.result === 'fail');
  const dkimPasses = resultsOf('dkim').filter((row) => row.result === 'pass');
  const alignedPass = [...dkimPasses, ...resultsOf('spf').filter((row) => row.result === 'pass')].some((row) => row.aligned);
  identity.signedBy = [...new Set(dkimPasses.map((row) => row.domain).filter(Boolean))];

  if (!anyTrusted) found.add('noChecks', [], resultFields.length === 0 ? '' : trust.receiverResults ? 'none' : 'claimed');
  if (anyTrusted && dmarcFailed) found.add('dmarcFail', [identity.domain]);
  else if (anyTrusted && identity.domain && !alignedPass && !dmarcPassed) found.add('spoofedSender', [identity.domain]);
  if (anyTrusted && !dmarcFailed) {
    const spf = resultsOf('spf');
    if (spf.some((row) => row.result === 'fail' || row.result === 'hardfail')) found.add('spfFail', spf.map((row) => row.domain));
    else if (spf.some((row) => row.result === 'softfail')) found.add('spfSoftfail', spf.map((row) => row.domain));
    const dkimFails = resultsOf('dkim').filter((row) => row.result === 'fail');
    if (dkimFails.length) found.add('dkimFail', dkimFails.map((row) => row.domain));
  }
  if (dkimPasses.length && !dkimPasses.some((row) => row.aligned)) found.add('signedByOther', identity.signedBy);

  /* The sender's identity */
  if (fromFields.length > 1 || (fromList.length > 1 && !identity.sender)) found.add('severalFrom', fromFields.flatMap((field) => parseAddresses(field.value).map((item) => item.address || item.raw)));
  if (identity.replySame === false) {
    // A mailing list's own shape: the provider recorded a signature of the list's organisation, the From address is
    // not a free mailbox, and either the list rewrote From to itself or every reply goes to the list. A List-Id line
    // alone is the sender's word and excuses nothing (review E4).
    const listSite = organisationOf(listDomain(identity.list));
    const listSigned = listSite !== '' && dkimPasses.some((row) => organisationOf(row.domain) === listSite);
    const exempt = listSigned && replyUnread.length === 0 && !FREE_MAIL.has(identity.site) && (identity.site === listSite || replySites.every((site) => site === listSite));
    if (!exempt) found.add('replyElsewhere', [...replyList.map((item) => item.address), ...replyUnread], replySites.some((site) => FREE_MAIL.has(site)) ? 'free' : '');
  }
  const nameDomains = domainsInName(from?.name ?? '').filter((domain) => organisationOf(domain) !== identity.site);
  if (nameDomains.length) found.add('nameIsAddress', nameDomains);
  const subject = decodeWords(one('subject')).text;
  const hidden = [from?.name ?? '', from?.raw ?? '', subject].filter(hasControls);
  if (hidden.length) found.add('nameHidden', hidden.map(visibleControls));
  for (const domain of [identity.domain, ...replyList.map((item) => domainOf(item.domain))]) {
    const imitation = lookalike(domain);
    if (imitation) found.add('lookalikeDomain', [imitation.shown, imitation.brand].filter(Boolean), imitation.brand ? '' : 'script');
  }
  const lowerName = (from?.name ?? '').toLowerCase();
  const nameWords = lowerName.split(/[^\p{L}\p{N}-]+/u);
  if (FREE_MAIL.has(identity.site) && (ORGANISATION_WORDS.some((word) => nameWords.includes(word)) || ORGANISATION_STEMS_KA.some((stem) => lowerName.includes(stem)))) {
    found.add('freeMailbox', [identity.domain]);
  }
  // Only "Re:": a forwarded message ("Fwd:") refers to no earlier one in its headers either (review E20).
  if (/^\s*re\s*(\[\d+\])?\s*:/i.test(subject) && !one('in-reply-to') && !one('references')) found.add('fakeReply', [oneLine(subject)]);

  /* What the provider's filter decided */
  const forefront = all('x-forefront-antispam-report').find(trusted);
  const antispam = all('x-microsoft-antispam').find(trusted);
  /** @type {Record<string, string>} */
  const pairs = { ...(forefront ? parsePairs(forefront.value) : {}), ...(antispam ? { BCL: parsePairs(antispam.value).BCL ?? '' } : {}) };
  report.filter = FILTER_KEYS.filter((key) => pairs[key]).map((key) => ({ key, value: pairs[key] }));
  /** @type {string[]} */
  const marked = [];
  if (MICROSOFT_SPAM_SFV.has(pairs.SFV ?? '')) marked.push(`SFV:${pairs.SFV}`);
  if (MICROSOFT_SPAM_CAT.has(pairs.CAT ?? '')) marked.push(`CAT:${pairs.CAT}`);
  const spamFlag = all('x-spam-flag').find(trusted);
  if (spamFlag && /^yes$/i.test(spamFlag.value.trim())) marked.push('X-Spam-Flag: YES');
  const spamStatus = all('x-spam-status').find(trusted);
  if (spamStatus) {
    const status = parseSpamStatus(spamStatus.value);
    report.filter.push({ key: 'X-Spam-Status', value: oneLine(spamStatus.value).slice(0, 200) });
    if (status.spam) marked.push('X-Spam-Status: Yes');
  }
  if (marked.length) found.add('filterSaidSpam', marked);

  /* Signatures */
  const signatures = all('dkim-signature').slice(0, 50).map((field) => parseDkimSignature(field.value));
  const passSites = new Set(dkimPasses.map((row) => organisationOf(row.domain)));
  const lengthLimited = signatures.filter((signature) => signature.length !== null && passSites.has(organisationOf(signature.domain)));
  if (lengthLimited.length) found.add('dkimLength', lengthLimited.map((signature) => signature.domain));
  const { sets } = parseArcSets(fields);
  const newest = sets[0];
  if (newest && newest.cv === 'fail' && trusted(newest)) found.add('arcBroken', [newest.seal?.tags.d ?? '']);

  /* The route, from sender to recipient */
  const lines = [...received.entries()].sort(([a], [b]) => b - a);
  /** @type {Hop[]} */
  const route = lines.map(([index, line]) => ({
    // The name the receiving server looked up, when it found one (a host name); otherwise the one the sender gave.
    from: line.reverse.includes('.') ? line.reverse : line.from,
    by: byHost(line),
    address: line.ip?.text ?? line.fromAddress,
    addressClass: line.ip ? ipClass(line.ip) : '',
    with: line.with,
    tls: line.tls,
    auth: line.auth,
    date: line.date,
    delay: null,
    trusted: index < trust.boundary,
  }));
  let previous = /** @type {Hop | null} */ (null);
  for (const hop of route) {
    if (previous && previous.date !== null && hop.date !== null) {
      const delay = hop.date - previous.date;
      hop.delay = delay < 0 && delay > -CLOCK_SLACK ? 0 : delay;
      if (hop.trusted && previous.trusted && delay > HOUR) found.add('slowHop', [hop.by]);
      if (hop.trusted && previous.trusted && delay < -CLOCK_SLACK) found.add('backwards', [hop.by]);
    }
    previous = hop;
  }
  report.route = route;
  const handoff = route.find((hop) => hop.trusted) ?? null;
  identity.handoff = handoff;
  report.receiver.host = handoff?.by ?? '';
  for (const hop of route.filter((each) => each.trusted && each.tls === false)) {
    const fromSite = organisationOf(hop.from);
    if (fromSite && fromSite !== organisationOf(hop.by) && !trust.receiver.has(fromSite)) found.add('plainHop', [`${hop.from} → ${hop.by}`]);
  }
  if (handoff?.tls === true) found.add('encryptedInTransit', [handoff.with]);
  const origin = route[0];
  if (origin && origin.addressClass && INTERNAL.has(origin.addressClass)) found.add('privateOrigin', [origin.address]);

  /* Time */
  report.dates.sent = parseDate(one('date'));
  report.dates.received = handoff?.date ?? null;
  const { sent, received: arrived } = report.dates;
  if (sent !== null && arrived !== null) {
    if (sent - arrived > 15 * 60_000) found.add('dateOdd', [], 'future');
    else if (arrived - sent > WEEK) found.add('dateOdd', [], 'old');
  }
  const oldSignatures = signatures.filter((signature) => signature.algorithm === 'rsa-sha1' || (signature.expires !== null && arrived !== null && signature.expires < arrived));
  if (oldSignatures.length) found.add('oldDkim', oldSignatures.map((signature) => signature.domain));

  /* Forwarding, lists, bulk mail */
  // The visitor's provider seals its own ARC set on nearly every message it takes in (Gmail does): that is no sign of
  // forwarding. Only sets sealed by someone else, or below the provider's lines, are (review E11).
  const travelled = sets.filter((set) => !(trusted(set) && trust.receiver.has(organisationOf(set.seal?.tags.d ?? ''))));
  if (travelled.length || all('x-forwarded-for').length || all('x-forwarded-to').length || all('resent-from').length) found.add('forwarded', travelled.map((set) => set.seal?.tags.d ?? '').filter(Boolean));
  if (one('list-unsubscribe') || one('feedback-id') || /^(bulk|list|junk)$/i.test(one('precedence').trim())) found.add('bulkSender');
  if (identity.list) found.add('mailingList', [identity.list]);
  const autoSubmitted = one('auto-submitted').trim().toLowerCase();
  if (autoSubmitted && autoSubmitted !== 'no') found.add('autoReply', [autoSubmitted]);
  const software = one('x-mailer') || one('user-agent');
  if (software) found.add('software', [decodeWords(software).text.slice(0, 200)]);
  const originating = parseIp(one('x-originating-ip').replace(/[[\]]/g, ''));
  if (originating) found.add('senderAddress', [originating.text]);
  const messageDomain = parseMessageIds(one('message-id'))[0]?.domain ?? '';
  if (messageDomain && identity.site && organisationOf(messageDomain) !== identity.site) found.add('messageIdElsewhere', [messageDomain.toLowerCase()]);

  /* The body: links, attached files, remote pictures */
  if (message.hasBody) {
    report.body = readBody(fields, message.body);
    const risky = report.body.attachments.filter((attachment) => attachment.risky).map((attachment) => checkName(attachment.name).visible);
    if (risky.length) found.add('riskyAttachment', risky);
    if (report.body.remoteImages) found.add('remoteImages', [String(report.body.remoteImages)]);
  }

  if (received.size === 0 || !from) found.add('partial');
  report.findings = found.list;
  report.verdict = verdictOf(report.findings);
  return report;
}

/**
 * The links of an HTML text: each "<a …>…</a>", found in one pass that jumps past each closing tag, so a page of
 * unclosed links costs no more than its length. Returned as HTML holding only those links.
 * @param {string} html
 */
function linkHtml(html) {
  const opening = /<a\b/gi;
  const closing = /<\/a\s*>/gi;
  /** @type {string[]} */
  const out = [];
  for (let match = opening.exec(html); match; match = opening.exec(html)) {
    closing.lastIndex = match.index;
    const end = closing.exec(html);
    if (!end) break;
    out.push(html.slice(match.index, end.index + end[0].length));
    opening.lastIndex = end.index + end[0].length;
  }
  return out.join('\n');
}

/**
 * Pictures an HTML text loads from the internet: "<img … src=http…>", one pass.
 * @param {string} html
 */
export function countRemoteImages(html) {
  let count = 0;
  const opening = /<img\b/gi;
  for (let match = opening.exec(html); match; match = opening.exec(html)) {
    const end = html.indexOf('>', match.index);
    if (end === -1) break;
    // Spaces after the quote only when there is a quote: two optional runs side by side backtrack quadratically (review E6).
    if (/\bsrc\s*=\s*(?:["']\s*)?https?:/i.test(html.slice(match.index, end))) count += 1;
    opening.lastIndex = end + 1;
  }
  return count;
}

/**
 * Reads the body of a whole message: its links (judged by the link checker), its attached files (names judged by the
 * attachment checker's name check) and its remote pictures. Content is not inspected: the visitor is sent to the
 * attachment checker with the saved file.
 * @param {Field[]} fields
 * @param {string} text
 * @returns {Body}
 */
export function readBody(fields, text) {
  const mime = readMime(fields, text);
  const plain = mime.parts.filter((part) => part.type === 'text/plain' && part.text).map((part) => part.text).join('\n');
  const html = mime.parts.filter((part) => part.type === 'text/html' && part.text).map((part) => part.text).join('\n').slice(0, MAX_HTML);
  const anchors = linkHtml(html);
  // The link checker pairs a link's words with the text around it; a message without a plain part gives it the words.
  const words = [plain, ...anchorsFromHtml(anchors).map((anchor) => anchor.text)].join('\n');
  const judged = words.trim() || anchors ? inspectText(words, anchors) : null;
  const links = judged?.status === 'ok' ? judged.links.map((link) => ({ url: link.url, warnings: link.warnings.length })) : [];
  const files = mime.parts.filter((part) => part.name || part.disposition === 'attachment' || !part.type.startsWith('text/'));
  const attachments = files.slice(0, MAX_ATTACHMENTS).map((part) => {
    const name = checkName(part.name);
    return { name: part.name, type: part.type, size: part.size, risky: RISKY_EXTENSIONS.has(name.extension) || name.bait !== '' || name.bidi || name.padded };
  });
  return {
    links: links.slice(0, MAX_BODY_LINKS),
    linksTotal: judged?.status === 'ok' ? judged.total : 0,
    attachments,
    attachmentsTotal: files.length,
    remoteImages: countRemoteImages(html),
    unread: mime.textCut || mime.tooDeep || mime.total > mime.parts.length,
  };
}

/* ---------- Message files ---------- */

/** Outlook keeps the headers it received in PidTagTransportMessageHeaders (0x007D), UTF-16 (001F) or 8-bit (001E): research §12. */
const MSG_HEADERS = ['__substg1.0_007d001f', '__substg1.0_007d001e'];

/**
 * The received headers of an Outlook message file (.msg), or "" when it holds none (a message never sent, such as a
 * draft). null when the bytes are not a compound file.
 * @param {Uint8Array} bytes
 * @returns {string | null}
 * @throws {import('./cfb.mjs').CfbError} for a damaged file.
 */
export function headersFromMsg(bytes) {
  if (!isCfb(bytes)) return null;
  const file = readCfb(bytes);
  const stream = MSG_HEADERS.map((name) => file.entries.find((entry) => entry.type === 'stream' && !entry.path.includes('/') && entry.name.toLowerCase() === name)).find(Boolean);
  if (!stream) {
    // A Word or Excel file is a compound file too: only one with Outlook's property streams is an Outlook message (review E23).
    const outlook = file.entries.some((entry) => /^__(substg1\.0_|properties_version1\.0$)/i.test(entry.name));
    return outlook ? '' : null;
  }
  const data = file.read(stream, MAX_FILE);
  const text = stream.name.toLowerCase().endsWith('001f') ? new TextDecoder('utf-16le').decode(data) : decodeText(data);
  return text.replace(/\0+$/, '');
}

/* ---------- Examples ---------- */

/**
 * Three built-in messages, made only of reserved names (example.com/.org/.net, .example, .test) and documentation
 * addresses (RFC 5737): a spoof, a message that passes every check and is still a scam, and an honest newsletter
 * forwarded once. The receiving provider, inbox.test, is fictional.
 * @returns {string[]}
 */
export function exampleMessages() {
  const spoof = `Return-Path: <bounce-7731@mailer.example.net>
Received: from mx1.inbox.test (mx1.inbox.test [192.0.2.10])
        by store.inbox.test with LMTPS id 9QkLb; Mon, 16 Nov 2026 09:12:31 +0000
Authentication-Results: mx1.inbox.test;
       spf=pass smtp.mailfrom=bounce-7731@mailer.example.net;
       dkim=none;
       dmarc=fail header.from=tbcbank-ge.example
Received: from mailer.example.net (mailer.example.net [203.0.113.45])
        by mx1.inbox.test with ESMTP id 4Fz9Hq; Mon, 16 Nov 2026 09:12:30 +0000
Authentication-Results: tbcbank-ge.example; spf=pass; dkim=pass; dmarc=pass
Received: from [198.51.100.23] (unknown [198.51.100.23])
        by mailer.example.net with ESMTPSA id 77a1; Mon, 16 Nov 2026 09:12:29 +0000
From: "TBC Bank Security" <security@tbcbank-ge.example>
Reply-To: tbc.support.desk@mail.example.org
To: you@inbox.test
Subject: Your account will be blocked today
Date: Mon, 16 Nov 2026 09:12:28 +0000
Message-ID: <a1b2c3d4@mailer.example.net>
MIME-Version: 1.0
Content-Type: text/plain; charset=utf-8
`;
  const scam = `Received: from mx1.inbox.test (mx1.inbox.test [192.0.2.10])
        by store.inbox.test with LMTPS id 1Rt7c; Tue, 17 Nov 2026 14:03:12 +0000
Authentication-Results: mx1.inbox.test;
       dkim=pass header.d=mail.example.org header.s=s1;
       spf=pass smtp.mailfrom=giorgi.beridze.office@mail.example.org;
       dmarc=pass header.from=mail.example.org
Received: from out.mail.example.org (out.mail.example.org [198.51.100.80])
        by mx1.inbox.test with ESMTPS id 8Hc2Lp; Tue, 17 Nov 2026 14:03:11 +0000
DKIM-Signature: v=1; a=rsa-sha256; c=relaxed/relaxed; d=mail.example.org; s=s1;
        t=1794924190; h=from:reply-to:to:subject:date:message-id; bh=Zm9vYmFy; b=YmFyYmF6
From: "Giorgi Beridze, Director" <giorgi.beridze.office@mail.example.org>
Reply-To: <g.beridze.director@post.example.net>
To: you@inbox.test
Subject: Re: urgent transfer today
Date: Tue, 17 Nov 2026 14:03:09 +0000
Message-ID: <5e6f7a8b@mail.example.org>
MIME-Version: 1.0
Content-Type: text/plain; charset=utf-8
`;
  const newsletter = `Return-Path: <bounce+u1@bounces.news.example.com>
Received: from mx1.inbox.test (mx1.inbox.test [192.0.2.10])
        by store.inbox.test with LMTPS id 3Ws8d; Wed, 18 Nov 2026 07:30:05 +0000
Authentication-Results: mx1.inbox.test;
       spf=fail smtp.mailfrom=bounce+u1@bounces.news.example.com;
       dkim=pass header.d=news.example.com header.s=k1;
       dmarc=pass header.from=news.example.com;
       arc=pass
Received: from relay.forward.example.org (relay.forward.example.org [203.0.113.7])
        by mx1.inbox.test with ESMTPS id 5Kd1Qa; Wed, 18 Nov 2026 07:30:04 +0000
ARC-Seal: i=1; a=rsa-sha256; cv=none; d=forward.example.org; s=arc1; t=1795073403; b=QVJDc2VhbA
ARC-Message-Signature: i=1; a=rsa-sha256; c=relaxed/relaxed; d=forward.example.org; s=arc1;
        h=from:to:subject:date; bh=Ym9keQ; b=QVJDbXNn
ARC-Authentication-Results: i=1; relay.forward.example.org;
       spf=pass smtp.mailfrom=bounce+u1@bounces.news.example.com;
       dkim=pass header.d=news.example.com;
       dmarc=pass header.from=news.example.com
Received: from out-7.esp.example.net (out-7.esp.example.net [198.51.100.7])
        by relay.forward.example.org with ESMTPS id 2Pq9; Wed, 18 Nov 2026 07:30:02 +0000
DKIM-Signature: v=1; a=rsa-sha256; c=relaxed/relaxed; d=news.example.com; s=k1;
        t=1795073401; h=from:to:subject:date:list-unsubscribe; bh=bmV3cw; b=c2lnbmVk
List-Unsubscribe: <https://news.example.com/unsubscribe?u=1>
List-Unsubscribe-Post: List-Unsubscribe=One-Click
Feedback-ID: 7:newsletter:esp:1234567
From: Example News <hello@news.example.com>
To: alumni@forward.example.org
Subject: This week at Example News
Date: Wed, 18 Nov 2026 07:30:00 +0000
Message-ID: <n-20261118@esp.example.net>
MIME-Version: 1.0
Content-Type: text/plain; charset=utf-8
`;
  return [spoof, scam, newsletter];
}

/* ---------- Page wiring ---------- */

/** "replyTo" → "reply-to", the attribute form of a key. @param {string} key */
const attributeName = (key) => key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);

/**
 * A duration in the page's own units: "{n} s", "{n} min", "{n} h", "{n} d".
 * @param {HTMLElement} labels  Carries data-seconds, data-minutes, data-hours, data-days.
 * @param {number} ms
 */
function duration(labels, ms) {
  const seconds = Math.round(Math.abs(ms) / 1000);
  const sign = ms < 0 ? '−' : '';
  if (seconds < 120) return sign + fillText(labels.dataset.seconds, { n: String(seconds) });
  if (seconds < 2 * 3600) return sign + fillText(labels.dataset.minutes, { n: String(Math.round(seconds / 60)) });
  if (seconds < 2 * 86400) return sign + fillText(labels.dataset.hours, { n: String(Math.round(seconds / 3600)) });
  return sign + fillText(labels.dataset.days, { n: String(Math.round(seconds / 86400)) });
}

/**
 * A time as a <time> element: UTC and the visitor's own zone, in the page's language.
 * @param {number} ms
 * @param {string} lang
 * @param {string} template  "{utc} (your time: {local})"
 */
function timeElement(ms, lang, template) {
  const element = document.createElement('time');
  const date = new Date(ms);
  element.dateTime = date.toISOString();
  const format = (/** @type {string | undefined} */ timeZone) => new Intl.DateTimeFormat(lang, { dateStyle: 'medium', timeStyle: 'medium', ...(timeZone ? { timeZone } : {}) }).format(date);
  element.textContent = fillText(template, { utc: `${format('UTC')} UTC`, local: format(undefined) });
  return element;
}

/** @param {string} text */
const code = (text) => {
  const element = document.createElement('code');
  element.textContent = text;
  element.translate = false;
  element.dir = 'ltr';
  return element;
};

/**
 * Shows a report in the page. Every word comes from the page; this only fills values and shows rows.
 * @param {HTMLElement} root
 * @param {Report} report
 */
export function showReport(root, report) {
  /** @template {HTMLElement} T @param {string} name @returns {T} */
  const part = (name) => /** @type {T} */ (root.querySelector(`[data-js="email-${name}"]`));
  const lang = document.documentElement?.lang || 'en';
  const verdict = part('verdict');
  const warnings = report.findings.filter((finding) => finding.level === 'warn').length;
  verdict.textContent = fillText(verdict.dataset[report.verdict], { n: String(warnings) });
  part('report').dataset.verdict = report.verdict;
  // Only warning signs colour the card; "no warning signs" stays neutral, never approving.
  part('verdict-card').dataset.state = report.verdict === 'warn' ? 'warn' : 'ok';

  /* Who sent it */
  const identity = report.identity;
  /** @param {string} row @param {boolean} shown */
  const row = (row, shown) => {
    const element = /** @type {HTMLElement} */ (root.querySelector(`[data-js="email-identity"] [data-row="${row}"]`));
    element.hidden = !shown;
    return element;
  };
  /** @param {string} name @param {string} value */
  const fill = (name, value) => {
    const element = root.querySelector(`[data-js="email-identity"] [data-row="${name}"] [data-js="email-value"]`);
    if (element) element.textContent = value;
  };
  row('name', identity.name !== '');
  fill('name', identity.name);
  row('address', identity.address !== '' || identity.raw !== '');
  const address = /** @type {HTMLElement} */ (root.querySelector('[data-js="email-address"]'));
  if (identity.address) {
    const local = identity.address.slice(0, identity.address.lastIndexOf('@') + 1);
    const host = unicodeHost(identity.domain);
    const site = unicodeHost(identity.site);
    const before = host.endsWith(site) ? host.slice(0, host.length - site.length) : host;
    const strong = document.createElement('strong');
    strong.textContent = host.endsWith(site) ? site : '';
    address.replaceChildren(`${local}${before}`, strong);
  } else {
    address.replaceChildren(identity.raw);
  }
  for (const [name, value, same] of /** @type {const} */ ([['replyTo', identity.replyTo, identity.replySame], ['returnPath', identity.returnPath, identity.returnSame]])) {
    const element = row(name, value !== '');
    fill(name, value);
    const note = /** @type {HTMLElement} */ (element.querySelector('[data-js="email-same"]'));
    note.textContent = (same ? note.dataset.same : note.dataset.other) ?? '';
  }
  row('signedBy', identity.signedBy.length > 0);
  fill('signedBy', identity.signedBy.join(', '));
  row('sender', identity.sender !== '');
  fill('sender', identity.sender);
  row('list', identity.list !== '');
  fill('list', identity.list);
  const handoff = identity.handoff;
  const handoffRow = row('handoff', handoff !== null);
  if (handoff) {
    fill('handoff', [handoff.from, handoff.address].filter(Boolean).join(' · '));
    const classLabel = /** @type {HTMLElement} */ (handoffRow.querySelector('[data-js="email-class"]'));
    classLabel.textContent = handoff.address ? (handoff.addressClass && classLabel.getAttribute(`data-class-${attributeName(handoff.addressClass)}`)) || (classLabel.dataset.invalid ?? '') : '';
  }

  /* What the provider checked */
  const receiver = part('receiver');
  const { authservId, provider, host, named } = report.receiver;
  fillInto(receiver, named ? (provider ? receiver.dataset.provider : receiver.dataset.named) : host ? receiver.dataset.unnamed : receiver.dataset.none, { id: authservId, provider, host });
  receiver.hidden = report.checks.length === 0 && !named;
  const checkList = part('checks');
  const checkTemplate = /** @type {HTMLTemplateElement} */ (part('check-template'));
  checkList.replaceChildren(...report.checks.map((check) => {
    const item = /** @type {HTMLElement} */ (/** @type {HTMLElement} */ (checkTemplate.content.firstElementChild).cloneNode(true));
    /** @param {string} name */
    const piece = (name) => /** @type {HTMLElement} */ (item.querySelector(`[data-js="email-check-${name}"]`));
    item.dataset.state = check.trusted ? (check.result === 'pass' || check.result === 'bestguesspass' ? 'pass' : check.result === 'fail' || check.result === 'hardfail' ? 'fail' : 'other') : 'claimed';
    piece('method').textContent = piece('method').getAttribute(`data-${check.method}`) ?? check.method;
    piece('result').textContent = check.result;
    const meaning = piece('meaning');
    meaning.textContent = (check.known ? meaning.getAttribute(`data-${check.method}-${check.result}`) : meaning.dataset.unknown) ?? '';
    const domain = piece('domain');
    domain.hidden = check.domain === '';
    fillInto(domain, check.aligned === null ? domain.dataset.plain : check.aligned ? domain.dataset.same : domain.dataset.other, { domain: check.domain });
    const extra = piece('comments');
    const comments = [check.reason, ...check.comments].filter(Boolean);
    extra.hidden = comments.length === 0;
    extra.replaceChildren(...comments.map((comment) => code(comment)));
    piece('claimed').hidden = check.trusted;
    return item;
  }));
  part('checks-none').hidden = report.checks.length > 0;

  /* The provider's filter */
  const filter = part('filter');
  filter.hidden = report.filter.length === 0;
  const filterList = part('filter-list');
  filterList.replaceChildren(...report.filter.map(({ key, value }) => {
    const item = document.createElement('li');
    const meaning = filterList.getAttribute(`data-${attributeName(key.toLowerCase())}-${attributeName(value.toLowerCase())}`) ?? filterList.getAttribute(`data-${attributeName(key.toLowerCase())}`) ?? '';
    item.append(code(`${key}: ${value}`), meaning ? ` ${meaning}` : '');
    return item;
  }));

  /* The route */
  const route = part('route');
  const hopTemplate = /** @type {HTMLTemplateElement} */ (part('hop-template'));
  const units = part('route');
  route.replaceChildren(...report.route.map((hop) => {
    const item = /** @type {HTMLElement} */ (/** @type {HTMLElement} */ (hopTemplate.content.firstElementChild).cloneNode(true));
    /** @param {string} name */
    const piece = (name) => /** @type {HTMLElement} */ (item.querySelector(`[data-js="email-hop-${name}"]`));
    item.dataset.state = hop.trusted ? 'trusted' : 'claimed';
    fillInto(piece('path'), piece('path').dataset.template, { from: hop.from || '?', by: hop.by || '?' });
    const where = piece('address');
    where.hidden = hop.address === '';
    const classText = (hop.addressClass && where.getAttribute(`data-class-${attributeName(hop.addressClass)}`)) || (where.dataset.invalid ?? '');
    fillInto(where, where.dataset.template, { address: hop.address, kind: classText });
    const protocol = piece('protocol');
    protocol.hidden = hop.with === '';
    const security = hop.tls === null ? protocol.dataset.unknown : hop.tls ? (hop.auth ? protocol.dataset.tlsAuth : protocol.dataset.tls) : hop.auth ? protocol.dataset.auth : protocol.dataset.plain;
    fillInto(protocol, security, { with: hop.with });
    const time = piece('time');
    time.hidden = hop.date === null;
    time.replaceChildren(...(hop.date === null ? [] : [timeElement(hop.date, lang, time.dataset.template ?? '{utc}')]));
    const delay = piece('delay');
    delay.hidden = hop.delay === null;
    if (hop.delay !== null) fillInto(delay, delay.dataset.template, { delay: duration(units, hop.delay) });
    piece('claimed').hidden = hop.trusted;
    return item;
  }));
  part('route-section').hidden = report.route.length === 0;

  /* Dates */
  const dates = part('dates');
  const { sent, received } = report.dates;
  dates.hidden = sent === null || received === null || Math.abs(sent - received) <= HOUR;
  if (!dates.hidden && sent !== null && received !== null) {
    fillInto(dates, dates.dataset.template, { sent: new Date(sent).toISOString().replace('T', ' ').slice(0, 16) + ' UTC', received: new Date(received).toISOString().replace('T', ' ').slice(0, 16) + ' UTC' });
  }

  /* Findings */
  for (const item of /** @type {HTMLElement[]} */ ([...root.querySelectorAll('[data-js="email-findings"] [data-finding]')])) {
    const finding = report.findings.find((entry) => entry.key === item.dataset.finding);
    item.hidden = !finding;
    if (!finding) continue;
    const text = /** @type {HTMLElement} */ (item.querySelector('[data-js="email-finding-text"]'));
    const template = (finding.variant && text.getAttribute(`data-${finding.variant}`)) || text.dataset.template;
    fillInto(text, template, { value: finding.values.join(', '), n: String(finding.values.length), first: finding.values[0] ?? '', second: finding.values[1] ?? '' });
  }
  part('findings').hidden = report.findings.length === 0;

  /* Links and attachments */
  const body = report.body;
  part('body').hidden = !body || (body.linksTotal === 0 && body.attachmentsTotal === 0 && !body.unread);
  if (body) {
    part('links').hidden = body.linksTotal === 0;
    fillInto(part('links-title'), part('links-title').dataset.template, { n: String(body.linksTotal) });
    const linkList = part('links-list');
    linkList.replaceChildren(...body.links.map((link) => {
      const item = document.createElement('li');
      item.dataset.state = link.warnings ? 'warn' : 'ok';
      const address = code(link.url);
      address.className = 'verdict__address';
      const judged = document.createElement('span');
      judged.className = 'facts__why';
      judged.textContent = link.warnings ? fillText(linkList.dataset.warn, { n: String(link.warnings) }) : (linkList.dataset.ok ?? '');
      item.append(address, ' ', judged);
      return item;
    }));
    const linksMore = part('links-more');
    linksMore.hidden = body.linksTotal <= body.links.length;
    fillInto(linksMore, linksMore.dataset.template, { n: String(body.linksTotal - body.links.length) });
    part('attachments').hidden = body.attachmentsTotal === 0;
    fillInto(part('attachments-title'), part('attachments-title').dataset.template, { n: String(body.attachmentsTotal) });
    const fileList = part('attachments-list');
    fileList.replaceChildren(...body.attachments.map((file) => {
      const item = document.createElement('li');
      item.dataset.state = file.risky ? 'warn' : 'ok';
      const name = code(file.name ? checkName(file.name).visible : (fileList.dataset.unnamed ?? ''));
      const facts = document.createElement('span');
      facts.className = 'facts__why';
      const size = file.size < 1024 ? fillText(fileList.dataset.bytes, { n: String(file.size) }) : file.size < 1024 * 1024 ? fillText(fileList.dataset.kb, { n: String(Math.round(file.size / 1024)) }) : fillText(fileList.dataset.mb, { n: (file.size / 1024 / 1024).toFixed(1) });
      facts.textContent = `${file.type} · ${size} · ${(file.risky ? fileList.dataset.risky : fileList.dataset.ok) ?? ''}`;
      item.append(name, ' ', facts);
      return item;
    }));
    const filesMore = part('attachments-more');
    filesMore.hidden = body.attachmentsTotal <= body.attachments.length;
    fillInto(filesMore, filesMore.dataset.template, { n: String(body.attachmentsTotal - body.attachments.length) });
    part('body-unread').hidden = !body.unread;
  }

  /* Every header */
  const headers = part('headers');
  const headerTemplate = /** @type {HTMLTemplateElement} */ (part('header-template'));
  headers.replaceChildren(...report.headers.map(({ name, value }) => {
    const item = /** @type {HTMLElement} */ (/** @type {HTMLElement} */ (headerTemplate.content.firstElementChild).cloneNode(true));
    /** @type {HTMLElement} */ (item.querySelector('[data-js="email-header-name"]')).textContent = name;
    /** @type {HTMLElement} */ (item.querySelector('[data-js="email-header-value"]')).textContent = value;
    return item;
  }));
  const count = part('headers-count');
  fillInto(count, count.dataset.template, { n: String(report.headers.length) });
  const unread = part('unread');
  unread.hidden = report.unparsed === 0 && report.notRead === 0;
  fillInto(unread, unread.dataset.template, { n: String(report.unparsed + report.notRead) });

  /* The summary to copy: the verdict and the findings, in the page's words. */
  const lines = [verdict.textContent ?? ''];
  for (const item of /** @type {HTMLElement[]} */ ([...root.querySelectorAll('[data-js="email-findings"] [data-finding]')])) {
    if (!item.hidden) lines.push(`- ${(item.textContent ?? '').replace(/\s+/g, ' ').trim()}`);
  }
  part('summary-text').textContent = lines.join('\n');
}

/** Message files read at most (bytes). */
export const MAX_FILE = 25 * 1024 * 1024;

/**
 * The header block of a message: everything before the first empty line, or all of it.
 * @param {string} text
 */
export function headerPart(text) {
  const end = /\r?\n[ \t]*\r?\n/.exec(text);
  return end ? text.slice(0, end.index + 1) : text;
}

/** @param {HTMLElement} root */
export function init(root) {
  /** @template {HTMLElement} T @param {string} name @returns {T} */
  const find = (name) => /** @type {T} */ (root.querySelector(`[data-js="email-${name}"]`));
  const input = /** @type {HTMLTextAreaElement} */ (find('input'));
  const check = /** @type {HTMLButtonElement} */ (find('check'));
  const clear = /** @type {HTMLButtonElement} */ (find('clear'));
  const message = /** @type {HTMLElement} */ (find('message'));
  const report = /** @type {HTMLElement} */ (find('report'));
  const file = /** @type {HTMLInputElement | null} */ (find('file'));
  const announce = /** @type {HTMLElement | null} */ (find('announce'));
  const verdict = /** @type {HTMLElement | null} */ (find('verdict'));
  if (!input || !check || !message || !report) return;
  const examples = exampleMessages();

  /** @param {string} key */
  const say = (key) => {
    message.textContent = message.dataset[key] ?? '';
  };
  /** The last chosen file: its whole text, and what of it the box shows (only the headers). */
  let chosenFile = { text: '', shown: '' };
  /** Counts the visitor's actions: a file still being read when another action came shows nothing (review E28). */
  let latest = 0;
  /**
   * Judges a message and shows the report. Anything that goes wrong hides the previous report, so it can never stand
   * under a new message (review E10).
   * @param {string} text @param {number} [limit]
   */
  const judge = (text, limit) => {
    report.hidden = true;
    if (announce) announce.textContent = '';
    let result;
    try {
      result = inspectMessage(text, limit === undefined ? {} : { limit });
      if (result.status === 'ok') showReport(root, result);
    } catch (error) {
      console.error('[lockwell] The message could not be judged; the report was hidden.', error);
      say('failed');
      return;
    }
    if (result.status !== 'ok') {
      say(result.status);
      return;
    }
    message.textContent = '';
    report.hidden = false;
    // The verdict is read out after Check or a dropped file, as the error messages are (review E18).
    if (announce && verdict) announce.textContent = verdict.textContent;
  };
  // A file chosen and left unchanged in the box is judged whole again, body included.
  const run = () => {
    latest += 1;
    return input.value !== '' && input.value === chosenFile.shown ? judge(chosenFile.text, MAX_FILE) : judge(input.value);
  };
  /** @param {File | undefined} chosen */
  const open = async (chosen) => {
    if (!chosen) return;
    const mine = (latest += 1);
    if (chosen.size > MAX_FILE) {
      report.hidden = true;
      say('tooLarge');
      return;
    }
    try {
      const bytes = new Uint8Array(await chosen.arrayBuffer());
      if (mine !== latest) return;
      const fromMsg = headersFromMsg(bytes);
      if (fromMsg === '') {
        report.hidden = true;
        say('msgNoHeaders');
        return;
      }
      // The whole file is judged, up to its own limit; the box shows only its headers (review E9).
      const text = fromMsg ?? new TextDecoder('utf-8').decode(bytes);
      chosenFile = { text, shown: headerPart(text).slice(0, MAX_TEXT) };
      input.value = chosenFile.shown;
      judge(text, MAX_FILE);
    } catch (error) {
      if (mine !== latest) return;
      console.error('[lockwell] Could not read the chosen message file.', error);
      report.hidden = true;
      say('readFailed');
    }
  };

  check.addEventListener('click', run);
  clear?.addEventListener('click', () => {
    latest += 1;
    input.value = '';
    message.textContent = '';
    if (announce) announce.textContent = '';
    report.hidden = true;
    // Forget the chosen file too: its name no longer shows, and choosing it again fires a change (review E19).
    chosenFile = { text: '', shown: '' };
    if (file) file.value = '';
    const name = /** @type {HTMLElement | null} */ (root.querySelector('[data-js="file-name"]'));
    if (name) name.textContent = name.dataset.empty ?? '';
    input.focus();
  });
  for (const button of /** @type {HTMLButtonElement[]} */ ([...root.querySelectorAll('[data-js="email-example"]')])) {
    button.addEventListener('click', () => {
      input.value = examples[Number(button.dataset.example)] ?? '';
      run();
    });
  }
  file?.addEventListener('change', () => open(file.files?.[0]));
  receiveFiles(root, (dropped) => open(dropped));
}

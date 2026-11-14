// @ts-check
/**
 * @file Tool "Attachment checker": says what a received file really is and whether opening it can run something.
 */
/**
 * The file is read in the browser, never opened, run or uploaded. The checker looks for what attachment attacks
 * rely on: a name that hides what the file is, a program or shortcut, and documents or web pages that can run code
 * or show a fake sign-in page. It is not an antivirus: "nothing active found" is never "safe".
 *
 * Every file gets one verdict, the most serious level among its findings: a program, a disguise, active content,
 * or a part that couldn't be read. Archives, disk images, Outlook messages and PDF attachments are opened one level
 * down (two for an archive inside an archive) and each file in them is checked the same way.
 * Sources and choices: docs/research/tool-file-check.md, docs/tools-plan/attachment-checker.md.
 */
import { ascii, byteString, crc32 } from './bytes.mjs';
import { CfbError, readCfb } from './cfb.mjs';
import { readRange } from './file-read.mjs';
import { detectType } from './file-type.mjs';
import { receiveFiles } from './files.mjs';
import { fillInto, fillText } from './fill.mjs';
import { pdfNames, pdfObjects, pdfString, streamData, stringToken } from './pdf.mjs';
import { inspectLink } from './tool-check.mjs';
import { ZipError, scanZip, unzip, writeZip } from './zip.mjs';

/* ---------- Names ---------- */

/**
 * Extensions that run as programs or scripts, or install or mount something, when opened. Gmail's blocked list
 * (verbatim, research §2) and the extensions Outlook blocks beyond it (research §2).
 */
export const RISKY_EXTENSIONS = new Set([
  // Gmail
  'ade', 'adp', 'apk', 'appx', 'appxbundle', 'bat', 'cab', 'chm', 'cmd', 'com', 'cpl', 'diagcab', 'diagcfg', 'diagpkg', 'dll', 'dmg', 'ex', 'ex_', 'exe', 'hta', 'img', 'ins', 'iso', 'isp', 'jar', 'jnlp', 'js', 'jse', 'lib', 'lnk', 'mde', 'mjs', 'msc', 'msi', 'msix', 'msixbundle', 'msp', 'mst', 'nsh', 'pif', 'ps1', 'scr', 'sct', 'shb', 'sys', 'vb', 'vbe', 'vbs', 'vhd', 'vxd', 'wsc', 'wsf', 'wsh', 'xll',
  // Outlook, beyond Gmail's
  'app', 'appcontent-ms', 'application', 'appref-ms', 'asp', 'aspx', 'bas', 'cer', 'crt', 'der', 'csh', 'ksh', 'gadget', 'hlp', 'htc', 'inf', 'library-ms', 'mht', 'mhtml', 'msu', 'pl', 'ps1xml', 'ps2', 'ps2xml', 'psc1', 'psc2', 'psd1', 'py', 'pyc', 'pyo', 'pyw', 'pyz', 'pyzw', 'reg', 'scf', 'search-ms', 'settingcontent-ms', 'shs', 'theme', 'url', 'vhdx', 'website', 'ws', 'wsb', 'xbap', 'xnk',
]);

/**
 * Risky extensions that open or install something rather than run code: certificates, themes, Windows libraries and
 * search connectors. They get "can run or open something", not "a program".
 */
const OPENS_SOMETHING = new Set(['cer', 'crt', 'der', 'theme', 'lib', 'library-ms', 'search-ms']);

/** Extensions people expect to be harmless documents, pictures or media: the bait of a double extension. */
const BAIT_EXTENSIONS = new Set(['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'odt', 'ods', 'odp', 'rtf', 'txt', 'csv', 'jpg', 'jpeg', 'png', 'gif', 'heic', 'webp', 'bmp', 'mp3', 'mp4', 'mov', 'avi', 'wav', 'm4a', 'zip', 'rar', 'html', 'htm']);

/**
 * Characters that change the direction of the text around them (Unicode bidirectional controls). In a file name they
 * can make "invoice‮fdp.exe" show as "invoiceexe.pdf" (MITRE ATT&CK T1036.002).
 * @type {Record<number, string>}
 */
const BIDI_CONTROLS = { 0x202a: 'LRE', 0x202b: 'RLE', 0x202c: 'PDF', 0x202d: 'LRO', 0x202e: 'RLO', 0x2066: 'LRI', 0x2067: 'RLI', 0x2068: 'FSI', 0x2069: 'PDI', 0x200e: 'LRM', 0x200f: 'RLM', 0x061c: 'ALM' };
const BIDI = /[؜‎‏‪-‮⁦-⁩]/g;

/**
 * @typedef {object} NameReport
 * @property {string} visible  The name with direction controls written out, e.g. "invoice⟨RLO⟩fdp.exe".
 * @property {string} shown  Roughly how a file manager may show it when a right-to-left override hides the end.
 * @property {boolean} bidi  The name contains direction controls.
 * @property {string} extension  The real extension, lowercase, after the last dot ("" if none).
 * @property {string} bait  An earlier extension that makes the name look harmless ("pdf" in "a.pdf.exe"), or "".
 * @property {boolean} padded  Spaces or underscores push the real extension far from the rest of the name.
 */

/**
 * Reads a file name the way an attacker might have built it.
 * @param {string} name
 * @returns {NameReport}
 */
export function checkName(name) {
  const chars = [...name];
  const bidi = chars.some((char) => (char.codePointAt(0) ?? 0) in BIDI_CONTROLS);
  const visible = chars.map((char) => {
    const label = BIDI_CONTROLS[char.codePointAt(0) ?? 0];
    return label ? `⟨${label}⟩` : char;
  }).join('');
  // A right-to-left override shows what follows it reversed, up to the end or a pop.
  const shown = name.replace(/‮([^‬]*)‬?/g, (_, after) => [...after].reverse().join('')).replace(BIDI, '');
  // Windows drops trailing dots and spaces from names, so "invoice.js." is saved as "invoice.js".
  const clean = name.replace(BIDI, '').replace(/[. ]+$/, '');
  const parts = clean.split('.');
  const extension = parts.length > 1 ? (parts.at(-1) ?? '').trim().toLowerCase() : '';
  const before = parts.length > 2 ? (parts.at(-2) ?? '').trim().toLowerCase() : '';
  const bait = RISKY_EXTENSIONS.has(extension) && BAIT_EXTENSIONS.has(before) ? before : '';
  const padded = /(?:\s{4,}|_{8,})\.[^.]+$/.test(clean);
  return { visible, shown, bidi, extension, bait, padded };
}

/**
 * What each extension says the file is, as the kinds this checker reports. Used to notice a file whose name and
 * content disagree. Text-like extensions accept any text.
 * @type {Record<string, string[]>}
 */
export const EXPECTED_KINDS = {
  pdf: ['pdf'],
  doc: ['doc', 'rtf'], dot: ['doc'], xls: ['xls'], xlt: ['xls'], ppt: ['ppt'], pps: ['ppt'], msg: ['msg'], msi: ['msi'], msp: ['msi'],
  docx: ['docx', 'officeLocked'], docm: ['docx', 'officeLocked'], dotx: ['docx'], dotm: ['docx'], xlsx: ['xlsx', 'officeLocked'], xlsm: ['xlsx', 'officeLocked'], xltx: ['xlsx'], xltm: ['xlsx'], xlsb: ['xlsx', 'officeLocked'],
  pptx: ['pptx', 'officeLocked'], pptm: ['pptx', 'officeLocked'], ppsx: ['pptx'], ppsm: ['pptx'], potx: ['pptx'], potm: ['pptx'], odt: ['odf'], ods: ['odf'], odp: ['odf'],
  odg: ['odf'], epub: ['zip'], zip: ['zip', 'docx', 'xlsx', 'pptx', 'odf'], jar: ['jar', 'zip'], apk: ['apk'], ipa: ['zip'],
  rtf: ['rtf'], one: ['onenote'],
  jpg: ['jpeg'], jpeg: ['jpeg'], png: ['png'], gif: ['gif'], webp: ['webp'], bmp: ['bmp'], ico: ['ico'], heic: ['heif'], heif: ['heif'], avif: ['heif'],
  mp4: ['mp4'], mov: ['mp4'], m4v: ['mp4'], m4a: ['mp4'], '3gp': ['mp4'], mp3: ['mp3'], wav: ['wav'], avi: ['avi'], webm: ['webm'], mkv: ['webm'], ogg: ['ogg'], opus: ['ogg'],
  exe: ['exe'], dll: ['exe'], scr: ['exe'], cpl: ['exe'], sys: ['exe'], lnk: ['lnk'], url: ['url'], chm: ['chm'],
  iso: ['iso'], vhd: ['vhd'], vhdx: ['vhdx'], dmg: ['dmg'],
  rar: ['rar'], '7z': ['7z'], gz: ['gzip'], tgz: ['gzip'], tar: ['tar'], cab: ['cab'],
  html: ['html'], htm: ['html'], svg: ['svg'], xml: ['xml', 'svg', 'text'],
  txt: ['text', 'xml', 'html'], csv: ['text'], md: ['text'], json: ['text'], log: ['text'],
};

/**
 * True when the name promises one kind of file and the content is another (an .exe renamed .pdf, a web page named
 * .docx). A content the checker can't recognise, or an extension it doesn't list, is not called a mismatch.
 * @param {string} extension
 * @param {string} kind
 */
export function nameMismatch(extension, kind) {
  const expected = EXPECTED_KINDS[extension];
  if (!expected || kind === 'unknown' || kind === 'empty') return false;
  return !expected.includes(kind);
}

/* ---------- Findings and verdicts ---------- */

/**
 * @typedef {'program' | 'disguise' | 'active' | 'locked' | 'info'} Level
 *   program: opening it runs code or installs something. disguise: it pretends to be something else.
 *   active: opening it can run code, fetch something or show a fake page. locked: part of it couldn't be read.
 * @typedef {'program' | 'disguise' | 'active' | 'locked' | 'none'} Verdict
 * @typedef {{ key: FindingKey, level: Level, values: string[] }} Finding
 * @typedef {keyof typeof FINDINGS} FindingKey
 */

/** Every finding, its level, in the order they are listed. */
export const FINDINGS = /** @type {const} */ ({
  program: 'program',
  script: 'program',
  installer: 'program',
  androidApp: 'program',
  javaApp: 'program',
  profile: 'program',
  shortcut: 'program',
  riskyExtension: 'program',
  riskyOpen: 'active',
  insideProgram: 'program',
  bidi: 'disguise',
  doubleExtension: 'disguise',
  padded: 'disguise',
  mismatch: 'disguise',
  zipSameName: 'disguise',
  zipTraversal: 'disguise',
  zipNameMismatch: 'disguise',
  zipDuplicate: 'disguise',
  hiddenFiles: 'disguise',
  veryHidden: 'disguise',
  pdfObfuscated: 'disguise',
  insideDisguise: 'disguise',
  macros: 'active',
  macroSheet: 'active',
  activeX: 'active',
  dde: 'active',
  remote: 'active',
  embedded: 'active',
  autoUpdate: 'active',
  equationEditor: 'active',
  pdfJavaScript: 'active',
  pdfAutoAction: 'active',
  pdfLaunch: 'active',
  pdfRemote: 'active',
  pdfSubmit: 'active',
  pdfAttachments: 'active',
  pdfMedia: 'active',
  pdfXfa: 'active',
  pageScript: 'active',
  passwordForm: 'active',
  smuggling: 'active',
  refresh: 'active',
  foreignObject: 'active',
  remoteFolder: 'active',
  linkToProgram: 'active',
  diskImage: 'active',
  insideActive: 'active',
  encrypted: 'locked',
  cantList: 'locked',
  tooLarge: 'locked',
  damaged: 'locked',
  partlyRead: 'locked',
  nested: 'locked',
  insideLocked: 'locked',
  webPage: 'info',
  svgPage: 'info',
});

/** The verdict levels, most serious first. */
export const VERDICTS = /** @type {const} */ (['program', 'disguise', 'active', 'locked']);

/**
 * The verdict for a set of findings: the most serious level among them, or "none".
 * @param {Finding[]} findings
 * @returns {Verdict}
 */
export function verdictOf(findings) {
  return VERDICTS.find((level) => findings.some((finding) => finding.level === level)) ?? 'none';
}

/** Collects findings, one per key, merging their values. */
class Findings {
  /** @type {Map<FindingKey, Finding>} */
  map = new Map();
  /** @param {FindingKey} key @param {string[]} [values] */
  add(key, values = []) {
    const found = this.map.get(key) ?? { key, level: FINDINGS[key], values: [] };
    for (const value of values) {
      const clean = value.replace(/\s+/g, ' ').trim();
      if (clean && !found.values.includes(clean) && found.values.length < MAX_VALUES) found.values.push(clean);
    }
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

/* ---------- Reports ---------- */

/**
 * @typedef {object} Inside  A file found inside an archive, a disk image, a message or a PDF.
 * @property {string} name  Its path inside, with direction controls written out.
 * @property {string} kind
 * @property {Verdict} verdict
 *
 * @typedef {object} LinkFound
 * @property {string} url
 * @property {string} site
 * @property {number} warnings  How many warnings the link checker has about it.
 *
 * @typedef {object} FileReport
 * @property {string} name  As received.
 * @property {NameReport} nameCheck
 * @property {string} kind  What the content is (see the kinds in the page's labels).
 * @property {Finding[]} findings
 * @property {Verdict} verdict
 * @property {Inside[]} inside  At most MAX_INSIDE_SHOWN.
 * @property {number} insideTotal
 * @property {LinkFound[]} links  At most MAX_LINKS_SHOWN.
 * @property {number} linksTotal
 */

/** Files up to this size are read whole and looked into; larger ones get the name and type checks only. */
export const MAX_DEEP = 200 * 1024 * 1024;
/** A file inside another one is looked into up to this size. */
const MAX_INNER = 64 * 1024 * 1024;
/** Bytes unpacked from all the archives in one file together: stops archives built to fill memory. */
const MAX_UNPACKED = 256 * 1024 * 1024;
/** Files inside one container that are checked; the rest are counted. */
const MAX_INSIDE = 2000;
/** Files inside listed on the page. */
export const MAX_INSIDE_SHOWN = 200;
/** Links judged and listed on the page. */
export const MAX_LINKS_SHOWN = 10;
/** Values listed under one finding. */
const MAX_VALUES = 20;
/** The file is depth 0; what is inside it 1; inside that 2. Containers deeper than that are not opened. */
const MAX_DEPTH = 2;
/** XML parts of Office files are read up to this size. */
const MAX_PART = 16 * 1024 * 1024;
/** XML parts read from one Office file; real documents have a few hundred at most. */
const MAX_PARTS = 2000;

/**
 * State shared by one file and everything found inside it.
 * @typedef {object} Context
 * @property {number} depth
 * @property {{ unpacked: number }} budget
 */

/**
 * What one inspector found, besides findings.
 * @typedef {object} Work
 * @property {Findings} found
 * @property {string} kind
 * @property {{ name: string, report: FileReport }[]} children
 * @property {number} childTotal
 * @property {string[]} links
 * @property {Context} context
 */

/**
 * Checks a received file.
 * @param {Blob} file
 * @param {string} name
 * @returns {Promise<FileReport>}
 */
export async function inspectFile(file, name) {
  return inspect(file, name, { depth: 0, budget: { unpacked: 0 } });
}

/**
 * @param {Blob} file
 * @param {string} name
 * @param {Context} context
 * @returns {Promise<FileReport>}
 */
async function inspect(file, name, context) {
  const nameCheck = checkName(name);
  const type = await detectType(file);
  /** @type {Work} */
  const work = { found: new Findings(), kind: type.kind, children: [], childTotal: 0, links: [], context };
  const { found } = work;

  if (file.size > (context.depth ? MAX_INNER : MAX_DEEP)) {
    found.add('tooLarge');
    if (type.kind === 'iso') await inspectIso(file, work);
  } else if (type.kind === 'iso') {
    await inspectIso(file, work);
  } else {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const readAs = forcedType(type, nameCheck.extension, bytes);
    work.kind = readAs.kind;
    try {
      await inspectContent(bytes, readAs, name, work);
    } catch (error) {
      // A structure the readers didn't expect: what was found so far stays, and the rest is reported as unread.
      console.info('[lockwell] Part of a file could not be read.', error);
      found.add('partlyRead');
    }
  }
  contentFindings(work, KIND_GROUPS[work.kind] ?? type.group);
  nameFindings(work, nameCheck);

  // What was found inside counts for the file that holds it.
  for (const { name: inner, report } of work.children) {
    const key = /** @type {const} */ ({ program: 'insideProgram', disguise: 'insideDisguise', active: 'insideActive', locked: 'insideLocked', none: null })[report.verdict];
    if (key) found.add(key, [checkName(inner).visible]);
  }
  const findings = found.list;
  /** @type {Inside[]} */
  const inside = work.children.flatMap(({ name: inner, report }) => [
    { name: checkName(inner).visible, kind: report.kind, verdict: report.verdict },
    ...report.inside.map((item) => ({ ...item, name: `${checkName(inner).visible}/${item.name}` })),
  ]);
  const links = [...new Set(work.links)];
  return {
    name,
    nameCheck,
    kind: work.kind,
    findings,
    verdict: verdictOf(findings),
    inside: inside.slice(0, MAX_INSIDE_SHOWN),
    insideTotal: Math.max(work.childTotal, inside.length),
    links: links.slice(0, MAX_LINKS_SHOWN).map(judgeLink),
    linksTotal: links.length,
  };
}

/** @param {string} url @returns {LinkFound} */
function judgeLink(url) {
  const report = inspectLink(url);
  return report.status === 'ok' ? { url: report.url, site: report.site, warnings: report.warnings.length } : { url, site: '', warnings: 0 };
}

/** Groups of kinds the checker sets itself, after reading more than the first bytes. */
const KIND_GROUPS = /** @type {Record<string, import('./file-type.mjs').Group>} */ ({ html: 'web', svg: 'web', rtf: 'document', zip: 'archive', mobileconfig: 'program' });

/**
 * Findings that come from the type alone.
 * @param {Work} work
 * @param {import('./file-type.mjs').Group} group
 */
function contentFindings({ found, kind }, group) {
  if (kind === 'javaClass') found.add('javaApp');
  else if (kind === 'mobileconfig') found.add('profile');
  else if (group === 'program') found.add('program');
  if (group === 'script') found.add('script');
  if (group === 'shortcut' && !found.has('shortcut')) found.add('shortcut');
  if (group === 'diskImage') found.add('diskImage');
  if (['vhd', 'vhdx', 'dmg', 'rar', '7z', 'cab', 'xar', 'onenote'].includes(kind)) found.add('cantList');
  if (kind === 'html') found.add('webPage');
  if (kind === 'svg') found.add('svgPage');
}

/**
 * Findings that come from the name, after the content was read.
 * @param {Work} work
 * @param {NameReport} nameCheck
 */
function nameFindings({ found, kind }, nameCheck) {
  if (nameCheck.bidi) found.add('bidi', [nameCheck.visible, nameCheck.shown]);
  if (nameCheck.bait) found.add('doubleExtension', [`.${nameCheck.bait}`, `.${nameCheck.extension}`]);
  if (nameCheck.padded) found.add('padded');
  if (nameMismatch(nameCheck.extension, kind)) found.add('mismatch', [`.${nameCheck.extension}`]);
  // An ending that runs as a program, when the content alone didn't already say so (a script is plain text).
  if (RISKY_EXTENSIONS.has(nameCheck.extension) && !found.list.some((finding) => finding.level === 'program') && !found.has('diskImage')) {
    found.add(OPENS_SOMETHING.has(nameCheck.extension) ? 'riskyOpen' : 'riskyExtension', [`.${nameCheck.extension}`]);
  }
}

/** Endings that open as a web page in a browser, whatever the file starts with. */
const PAGE_ENDINGS = new Set(['html', 'htm', 'xhtml', 'xht', 'shtml', 'svg']);

/**
 * The type to read the file as. A stray byte at the start makes a web page or an RTF document "unknown" to sniffing,
 * but a browser still shows a .html file as a page and Word still opens a document that starts "{\rt": a file whose
 * ending promises a page is read as one when it holds markup.
 * @param {import('./file-type.mjs').FileType} type
 * @param {string} extension
 * @param {Uint8Array} bytes
 * @returns {import('./file-type.mjs').FileType}
 */
function forcedType(type, extension, bytes) {
  if (!PAGE_ENDINGS.has(extension) || !['unknown', 'text', 'xml'].includes(type.kind)) return type;
  const head = byteString(bytes.subarray(0, 64 * 1024));
  if (extension === 'svg' && /<svg[\s>]/i.test(head)) return { kind: 'svg', group: 'web' };
  if (extension !== 'svg' && /<(?:html|head|body|script|form|iframe|svg|meta|a|div|p)[\s>/]/i.test(head)) return { kind: 'html', group: 'web' };
  return type;
}

/**
 * Reads the content of a file whose bytes are in memory.
 * @param {Uint8Array} bytes
 * @param {import('./file-type.mjs').FileType} type
 * @param {string} name
 * @param {Work} work
 */
async function inspectContent(bytes, type, name, work) {
  switch (type.kind) {
    case 'zip': return inspectZip(bytes, work);
    case 'cfb': return inspectCfb(bytes, work);
    case 'rtf': return inspectRtf(bytes, work);
    case 'pdf': return inspectPdf(bytes, work);
    case 'html': case 'svg': return inspectPage(bytes, work);
    case 'lnk': return inspectLnk(bytes, work);
    case 'url': return inspectUrlFile(bytes, work);
    case 'libraryMs': case 'searchMs': return inspectLocations(bytes, work);
    case 'mobileconfig': return inspectProfile(bytes, work);
    case 'gzip': return inspectGzip(bytes, name, work);
    case 'tar': return inspectTar(bytes, work);
    default:
      // A signed configuration profile is binary (CMS) with the profile's XML inside.
      if (type.kind === 'unknown' && /<key>\s*PayloadContent\s*<\/key>/.test(byteString(bytes.subarray(0, 256 * 1024)))) {
        work.kind = 'mobileconfig';
        return inspectProfile(bytes, work);
      }
  }
}

/**
 * Checks a file found inside another one and adds it to the list.
 * @param {Work} work
 * @param {string} name
 * @param {() => Promise<Uint8Array>} read
 * @param {number} size  As the container declares it.
 */
async function addChild(work, name, read, size) {
  work.childTotal += 1;
  if (work.childTotal > MAX_INSIDE) return;
  const context = { depth: work.context.depth + 1, budget: work.context.budget };
  /** @param {FindingKey} key */
  const unread = (key) => {
    const found = new Findings();
    found.add(key);
    const nameCheck = checkName(name);
    nameFindings({ ...work, found, kind: 'unknown' }, nameCheck);
    const findings = found.list;
    return { name, nameCheck, kind: 'unknown', findings, verdict: verdictOf(findings), inside: [], insideTotal: 0, links: [], linksTotal: 0 };
  };
  if (size > MAX_INNER || context.budget.unpacked + size > MAX_UNPACKED) {
    work.children.push({ name, report: unread('tooLarge') });
    return;
  }
  /** @type {Uint8Array} */
  let bytes;
  try {
    bytes = await read();
  } catch (error) {
    work.children.push({ name, report: unread(error instanceof ZipError && error.code === 'locked' ? 'encrypted' : 'damaged') });
    return;
  }
  context.budget.unpacked += bytes.length;
  const report = await inspect(new Blob([/** @type {Uint8Array<ArrayBuffer>} */ (bytes)]), name.split('/').at(-1) ?? name, context);
  work.children.push({ name, report });
}

/** True when a container at this depth should not be opened. @param {Work} work */
function tooDeep(work) {
  if (work.context.depth < MAX_DEPTH) return false;
  work.found.add('nested');
  return true;
}

/* ---------- ZIP, Office, OpenDocument, apps ---------- */

/** @param {Uint8Array} bytes */
const utf8 = (bytes) => new TextDecoder().decode(bytes);

/**
 * An attribute of an XML or HTML start tag, either kind of quotes or none.
 * @param {string} tag
 * @param {string} name
 */
function attribute(tag, name) {
  const match = new RegExp(String.raw`[\s:]${name}\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>"']+))`, 'i').exec(tag);
  return match ? decodeEntities(match[1] ?? match[2] ?? match[3] ?? '') : '';
}

/** Named references that occur in addresses and attribute values, including those used to hide "javascript:". */
const NAMED_ENTITIES = /** @type {Record<string, string>} */ ({ amp: '&', quot: '"', apos: "'", lt: '<', gt: '>', colon: ':', tab: '\t', newline: '\n', sol: '/', lpar: '(', rpar: ')', period: '.', nbsp: '\u00a0' });

/** A code point from a character reference; one out of range becomes U+FFFD, as browsers do. @param {number} code */
const fromReference = (code) => (Number.isInteger(code) && code >= 0 && code <= 0x10ffff ? String.fromCodePoint(code) : '\ufffd');

/**
 * Character references in an attribute value or text: numeric ones (with or without the closing ";", which browsers
 * accept) and the named ones in NAMED_ENTITIES.
 * @param {string} text
 */
const decodeEntities = (text) =>
  text
    .replace(/&#x([0-9a-f]{1,8});?/gi, (_, hex) => fromReference(Number.parseInt(hex, 16)))
    .replace(/&#(\d{1,10});?/g, (_, dec) => fromReference(Number(dec)))
    .replace(/&([a-z]+);/gi, (whole, name) => NAMED_ENTITIES[name.toLowerCase()] ?? whole);

/** Web addresses only: links the link checker can judge. @param {string} url */
const isWebLink = (url) => /^https?:\/\//i.test(url.trim());

/**
 * @param {Uint8Array} bytes
 * @param {Work} work
 */
async function inspectZip(bytes, work) {
  const { found } = work;
  const { entries, problems } = scanZip(bytes);
  if (problems.has('notZip')) {
    found.add('damaged');
    return;
  }
  if (problems.has('damaged')) found.add(entries.length ? 'partlyRead' : 'damaged');
  if (problems.has('zip64')) found.add('cantList');
  if (problems.has('encrypted')) found.add('encrypted');
  if (problems.has('traversal')) found.add('zipTraversal', entries.filter((entry) => /(^|[\\/])\.\.([\\/]|$)|^([a-z]:)?[\\/]/i.test(entry.name)).map((entry) => entry.name));
  if (problems.has('nameMismatch')) found.add('zipNameMismatch', entries.filter((entry) => entry.localName !== entry.name).map((entry) => entry.name));
  if (problems.has('duplicate')) found.add('zipDuplicate');
  // A file and a folder with the same name: WinRAR before 6.23 opened a file from the folder instead (CVE-2023-38831).
  const files = entries.filter((entry) => !entry.name.endsWith('/'));
  const folders = new Set(entries.flatMap((entry) => entry.name.split('/').slice(0, -1).map((_, i, parts) => parts.slice(0, i + 1).join('/'))));
  const sameName = files.filter((entry) => folders.has(entry.name));
  if (sameName.length) found.add('zipSameName', sameName.map((entry) => entry.name));

  /** @param {string} name */
  const entry = (name) => entries.find((item) => item.name.toLowerCase() === name.toLowerCase());
  let partsRead = 0;
  /**
   * An XML part as text. Parts too large, beyond the count or the shared budget, encrypted or broken are reported as
   * not read: a padded part must not hide what it holds.
   * @param {import('./zip.mjs').ScannedEntry | undefined} item
   */
  const text = async (item) => {
    if (!item) return '';
    const budget = work.context.budget;
    partsRead += 1;
    if (item.encrypted || item.size > MAX_PART || partsRead > MAX_PARTS || budget.unpacked + item.size > MAX_UNPACKED) {
      found.add('partlyRead');
      return '';
    }
    try {
      const data = await unzip(item, MAX_PART);
      budget.unpacked += data.length;
      return utf8(data);
    } catch {
      found.add('partlyRead');
      return '';
    }
  };

  if (entry('[Content_Types].xml')) return inspectOoxml(entries, text, work);
  const mimetype = entry('mimetype');
  const odfType = mimetype ? await text(mimetype) : '';
  if (odfType.startsWith('application/vnd.oasis.opendocument.')) return inspectOdf(entries, text, work);
  const names = new Set(files.map((item) => item.name));
  if (names.has('AndroidManifest.xml') && names.has('classes.dex')) {
    work.kind = 'apk';
    found.add('androidApp');
    return;
  }
  if (names.has('META-INF/MANIFEST.MF') && files.some((item) => item.name.endsWith('.class'))) {
    work.kind = 'jar';
    found.add('javaApp');
    return;
  }
  if (tooDeep(work)) return;
  for (const item of files) {
    await addChild(work, item.name, () => unzip(item, MAX_INNER), item.size);
  }
}

/** Relationships whose target outside the file is a link to follow, not something fetched. */
const LINK_RELATIONSHIPS = new Set(['hyperlink']);

/** A target on another computer: a web address, a network share (UNC or file://host/), or WebDAV. @param {string} target */
const isNetworkTarget = (target) => /^(?:https?:|\\\\|\/\/|file:\/{0,2}\\\\|file:\/\/(?!\/|localhost\/)[^/]|webdav)/i.test(target.trim());

/** Programs a link can start: a hyperlink to one of these runs it (the PowerPoint mouse-over attack). */
const PROGRAM_TARGET = /^(?:"?[a-z]:\\[^"]*\\)?"?(?:cmd|powershell|pwsh|mshta|rundll32|regsvr32|wscript|cscript|certutil|bitsadmin|msiexec|conhost|explorer|forfiles|curl)(?:\.exe)?\b/i;

/**
 * A hyperlink that runs something or opens a file on another computer instead of a web page: a command, a program's
 * path, a network share, or a Windows protocol such as search-ms: or ms-msdt:.
 * @param {string} target
 */
function linksToProgram(target) {
  const trimmed = target.trim();
  if (/^(?:https?|mailto):/i.test(trimmed) || trimmed.startsWith('#')) return false;
  const path = trimmed.replace(/[?#].*$/, '').replace(/^"|"$/g, '');
  const ending = path.split(/[\\/]/).at(-1)?.split('.').at(-1)?.toLowerCase() ?? '';
  return isNetworkTarget(trimmed) || PROGRAM_TARGET.test(trimmed) || /^(?:ms-[a-z-]+|search-ms|search):/i.test(trimmed) || (path.includes('.') && RISKY_EXTENSIONS.has(ending));
}

/**
 * Word, Excel and PowerPoint files. Macros are known by content type and relationship type, not by the usual part
 * name (MS-OFFMACRO2); relationship types are matched by their last segment, as Strict and Transitional files use
 * different addresses (ECMA-376).
 * @param {import('./zip.mjs').ScannedEntry[]} entries
 * @param {(entry: import('./zip.mjs').ScannedEntry | undefined) => Promise<string>} text
 * @param {Work} work
 */
async function inspectOoxml(entries, text, work) {
  const { found } = work;
  const names = entries.map((entry) => entry.name);
  work.kind = names.some((name) => /^word\//i.test(name)) ? 'docx' : names.some((name) => /^xl\//i.test(name)) ? 'xlsx' : names.some((name) => /^ppt\//i.test(name)) ? 'pptx' : 'docx';
  const types = await text(entries.find((entry) => entry.name === '[Content_Types].xml'));
  /** @type {{ type: string, target: string, external: boolean }[]} */
  const relationships = [];
  for (const entry of entries.filter((item) => /\.rels$/i.test(item.name))) {
    for (const [tag] of (await text(entry)).matchAll(/<(?:\w+:)?Relationship\b[^>]*>/g)) {
      relationships.push({ type: attribute(tag, 'Type').split('/').at(-1) ?? '', target: attribute(tag, 'Target'), external: /^external$/i.test(attribute(tag, 'TargetMode')) });
    }
  }
  /** @param {string} type */
  const related = (type) => relationships.filter((item) => item.type.toLowerCase() === type.toLowerCase());

  // A macro-enabled main part type alone is not enough: Word keeps it for .docm files that have no macros.
  if (/vbaProject/i.test(types) || related('vbaProject').length || names.some((name) => /vbaProject\.bin$/i.test(name))) found.add('macros');
  if (/macrosheet\+xml/i.test(types) || related('xlMacrosheet').length || related('xlIntlMacrosheet').length) found.add('macroSheet');
  if (/activeX/i.test(types) || related('control').length) found.add('activeX');
  // OLE objects (.bin) can wrap any file and run it on a double click; embedded Office files (a chart's workbook) are
  // checked like any file inside.
  const embedded = entries.filter((entry) => /\/embeddings\/[^/]+$/i.test(entry.name));
  const objects = embedded.filter((entry) => !/\.(docx|docm|xlsx|xlsm|xlsb|pptx|pptm|sldx|sldm)$/i.test(entry.name));
  if (objects.length || related('oleObject').some((item) => !item.external)) found.add('embedded', objects.map((entry) => entry.name.split('/').at(-1) ?? entry.name));
  // Parts fetched from another computer when the file opens. Local paths (a template in the user's own folder, a link
  // to another workbook) are ordinary in office documents and not reported.
  const remote = relationships.filter((item) => item.external && !LINK_RELATIONSHIPS.has(item.type) && isNetworkTarget(item.target));
  if (remote.length) found.add('remote', remote.map((item) => item.target));
  const hyperlinks = relationships.filter((item) => item.external && LINK_RELATIONSHIPS.has(item.type));
  work.links.push(...hyperlinks.filter((item) => isWebLink(item.target)).map((item) => item.target));
  const programs = hyperlinks.filter((item) => linksToProgram(item.target));
  if (programs.length) found.add('linkToProgram', programs.map((item) => item.target));
  // PowerPoint's "run program" action on a click or a mouse-over.
  for (const entry of entries.filter((item) => /^ppt\/slides\/[^/]+\.xml$/i.test(item.name))) {
    if (/ppaction:\/\/program/i.test(await text(entry))) found.add('linkToProgram');
  }

  // DDE fields: Word field codes may be split over several runs, so the instructions are joined first.
  let instructions = '';
  for (const entry of entries.filter((item) => /^word\/[^/]+\.xml$/i.test(item.name))) {
    const xml = await text(entry);
    instructions += [...xml.matchAll(/<w:instrText\b[^>]*>([^<]*)<\/w:instrText>/g)].map((match) => match[1]).join('');
    instructions += [...xml.matchAll(/<w:fldSimple\b[^>]*>/g)].map((match) => ` ${attribute(match[0], 'w:instr')} `).join('');
  }
  let excelDde = false;
  for (const entry of entries.filter((item) => /^xl\/externalLinks\/[^/]+\.xml$/i.test(item.name))) excelDde ||= /<(?:\w+:)?ddeLink\b/.test(await text(entry));
  if (/\bDDE(?:AUTO)?\b/i.test(decodeEntities(instructions)) || excelDde) found.add('dde');
  const files = embedded.filter((item) => !objects.includes(item));
  if (!files.length || tooDeep(work)) return;
  for (const entry of files) await addChild(work, entry.name.split('/').at(-1) ?? entry.name, () => unzip(entry, MAX_INNER), entry.size);
}

/**
 * OpenDocument files: macros in Basic/ or Scripts/, encryption in the manifest.
 * @param {import('./zip.mjs').ScannedEntry[]} entries
 * @param {(entry: import('./zip.mjs').ScannedEntry | undefined) => Promise<string>} text
 * @param {Work} work
 */
async function inspectOdf(entries, text, work) {
  const { found } = work;
  work.kind = 'odf';
  // Each Basic library lists itself in script-lb.xml and dialog-lb.xml; its modules are the other files in it.
  if (entries.some((entry) => /^Basic\/.+\/(?!script-lb\.xml$|dialog-lb\.xml$)[^/]+\.xml$/i.test(entry.name) || /^Scripts\/.+[^/]$/i.test(entry.name))) found.add('macros');
  const manifest = await text(entries.find((entry) => entry.name === 'META-INF/manifest.xml'));
  if (/encryption-data\b/.test(manifest)) found.add('encrypted');
  const content = await text(entries.find((entry) => entry.name === 'content.xml'));
  work.links.push(...[...content.matchAll(/xlink:href\s*=\s*"([^"]*)"/g)].map((match) => decodeEntities(match[1])).filter(isWebLink));
}

/* ---------- Compound files: .doc, .xls, .ppt, .msg, .msi ---------- */

/**
 * Class IDs of Windows Installer files as stored in a compound file's root (Data1–3 little-endian):
 * 000C1084-… installer, 000C1086-… patch. From Wine's msi source; no Microsoft page found (research §8).
 */
const INSTALLER_CLASSES = new Set(['84100c0000000000c000000000000046', '86100c0000000000c000000000000046']);
/**
 * Outlook message properties (MS-OXMSG): an attachment's long and short file names, as UTF-16 (001F) or 8-bit (001E)
 * text, its data (0102), and an attached message, stored as a storage (000D).
 */
const MSG_NAMES = ['__substg1.0_3707001F', '__substg1.0_3707001E', '__substg1.0_3704001F', '__substg1.0_3704001E'];
const MSG_DATA = '__substg1.0_37010102';
const MSG_MESSAGE = '__substg1.0_3701000D';
/** Longest attachment name read; longer ones are cut. */
const MAX_NAME_BYTES = 64 * 1024;

/**
 * @param {Uint8Array} bytes
 * @param {Work} work
 */
async function inspectCfb(bytes, work) {
  const { found } = work;
  /** @type {ReturnType<typeof readCfb>} */
  let cfb;
  try {
    cfb = readCfb(bytes);
  } catch (error) {
    if (!(error instanceof CfbError)) throw error;
    found.add('damaged');
    return;
  }
  const { entries } = cfb;
  const root = entries[0];
  /** @param {string} path */
  const at = (path) => entries.find((entry) => entry.path.toLowerCase() === path.toLowerCase());
  /** @param {string} name */
  const anyNamed = (name) => entries.some((entry) => entry.name === name);

  if (INSTALLER_CLASSES.has(root.clsid)) {
    work.kind = 'msi';
    found.add('installer');
    return;
  }
  if (at('WordDocument')) work.kind = 'doc';
  else if (at('Workbook') || at('Book')) work.kind = 'xls';
  else if (at('PowerPoint Document')) work.kind = 'ppt';
  else if (at('__properties_version1.0')) work.kind = 'msg';

  // An Office 2007+ file locked with a password is a compound file holding the encrypted package (MS-OFFCRYPTO).
  if (at('EncryptionInfo') && at('EncryptedPackage')) {
    work.kind = 'officeLocked';
    found.add('encrypted');
    return;
  }
  if (at('Macros') || at('_VBA_PROJECT_CUR') || entries.some((entry) => /(^|\/)VBA\/_VBA_PROJECT$/i.test(entry.path))) found.add('macros');
  if (at('ObjectPool') || entries.some((entry) => /^MBD[0-9A-F]{8}$/i.test(entry.name)) || anyNamed('\u0001Ole10Native')) found.add('embedded');

  const workbook = at('Workbook') ?? at('Book');
  if (workbook) {
    try {
      readSheets(cfb.read(workbook, MAX_INNER), found);
    } catch {
      found.add('partlyRead');
    }
  }
  if (work.kind === 'msg') await messageAttachments(cfb, work);
}

/**
 * Excel 97–2003 sheets (MS-XLS): a BoundSheet8 record (0x0085) per sheet, with its visibility (hsState, 2 = very
 * hidden) and type (dt, 1 = Excel 4.0 macro sheet), up to the end of the workbook's global part (EOF, 0x000A).
 * FILEPASS (0x002F) there means the workbook is encrypted.
 * @param {Uint8Array} stream
 * @param {Findings} found
 */
function readSheets(stream, found) {
  const view = new DataView(stream.buffer, stream.byteOffset, stream.byteLength);
  // After FILEPASS only a BoundSheet8's position is left plain; its visibility and type are encrypted (MS-XLS).
  let encrypted = false;
  for (let at = 0, count = 0; at + 4 <= stream.length && count < 100_000; count += 1) {
    const type = view.getUint16(at, true);
    const size = view.getUint16(at + 2, true);
    if (type === 0x000a) break;
    if (type === 0x002f) {
      encrypted = true;
      found.add('encrypted');
    }
    if (type === 0x0085 && !encrypted && size >= 6 && at + 10 <= stream.length) {
      if ((stream[at + 8] & 0x03) === 2) found.add('veryHidden');
      if (stream[at + 9] === 0x01) found.add('macroSheet');
    }
    at += 4 + size;
  }
}

/**
 * An Outlook message's attached files, each checked like a file of its own.
 * @param {ReturnType<typeof readCfb>} cfb
 * @param {Work} work
 * @param {string} [base]  The storage that holds the attachments: "" for the message itself, or an attached message.
 * @param {string} [prefix]  Shown before the names of an attached message's attachments ("Fwd.msg/").
 */
async function messageAttachments(cfb, work, base = '', prefix = '') {
  const pattern = new RegExp(`^${base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}${base ? '/' : ''}__attach_version1\\.0_#[0-9A-F]{8}$`, 'i');
  const storages = cfb.entries.filter((entry) => entry.type === 'storage' && pattern.test(entry.path));
  if (!storages.length || tooDeep(work)) return;
  for (const storage of storages) {
    /** @param {string} name */
    const stream = (name) => cfb.entries.find((entry) => entry.path === `${storage.path}/${name}`);
    const nameStream = MSG_NAMES.map(stream).find(Boolean);
    let name = storage.name;
    if (nameStream) {
      const raw = cfb.read({ ...nameStream, size: Math.min(nameStream.size, MAX_NAME_BYTES) }, MAX_NAME_BYTES);
      name = (nameStream.name.endsWith('001F') ? new TextDecoder('utf-16le') : new TextDecoder('windows-1252')).decode(raw).replace(/\0[\s\S]*$/, '') || storage.name;
    }
    const data = stream(MSG_DATA);
    const message = stream(MSG_MESSAGE);
    if (data) await addChild(work, `${prefix}${name}`, async () => cfb.read(data, MAX_INNER), data.size);
    // An attached message: its own attachments are checked as one more level down.
    else if (message && message.type === 'storage' && !prefix) await messageAttachments(cfb, work, message.path, `${name}/`);
    else if (message) work.found.add('nested');
    else work.found.add('partlyRead');
  }
}

/* ---------- RTF ---------- */

/**
 * Embedded objects in RTF: `\object` groups with `\objdata`, whose hex data starts with an OLE 1.0 header that names
 * the object's class. `\objupdate` makes Word load the object as the document opens. Equation.3 is the old Equation
 * Editor, exploited through CVE-2017-11882 (research §3).
 * @param {Uint8Array} bytes
 * @param {Work} work
 */
function inspectRtf(bytes, work) {
  const { found } = work;
  const text = byteString(bytes);
  /** @type {string[]} */
  const classes = [];
  for (const match of text.matchAll(/\\objclass\s+([^\\{}]+)/gi)) classes.push(match[1].trim());
  for (const match of text.matchAll(/\\objdata\b([\s\S]{0,4096})/gi)) {
    const hex = match[1].replace(/\{\\\*[^}]*\}/g, '').replace(/[^0-9a-f]/gi, '');
    const ole = Uint8Array.from(hex.slice(0, 1024).match(/../g) ?? [], (pair) => Number.parseInt(pair, 16));
    // OLE 1.0: version (4 bytes), format (4), class name length (4), class name (with a closing zero).
    if (ole.length >= 12) {
      const length = new DataView(ole.buffer).getUint32(8, true);
      if (length > 1 && length < 128 && ole.length >= 12 + length) classes.push(byteString(ole.subarray(12, 12 + length - 1)));
    }
  }
  if (/\\object\b/i.test(text) || /\\objdata\b/i.test(text)) found.add('embedded', classes);
  if (/\\objupdate\b/i.test(text)) found.add('autoUpdate');
  if (classes.some((name) => /^equation\.3$/i.test(name.trim()))) found.add('equationEditor');
  if (/\\fldinst\b[^}]*\bDDE(?:AUTO)?\b/i.test(text)) found.add('dde');
  work.links.push(...[...text.matchAll(/HYPERLINK\s+"([^"]+)"/g)].map((match) => match[1]).filter(isWebLink));
}

/* ---------- PDF ---------- */

/** A PDF name ends at white space or a delimiter (ISO 32000-1 §7.2.2). */
const NAME_END = String.raw`(?=[\s/[\]<>(){}%]|$)`;
/** Names whose escaped spelling hides them from simple checks (pdfid counts these). */
const PDF_KEYWORDS = new Set(['JS', 'JavaScript', 'AA', 'OpenAction', 'Launch', 'EmbeddedFile', 'EmbeddedFiles', 'RichMedia', 'XFA', 'SubmitForm', 'GoToR', 'GoToE', 'ImportData', 'URI', 'AcroForm', 'Encrypt', 'ObjStm']);

/**
 * PDF actions and attachments (ISO 32000-1 §12.6, research §8). Names are matched after #xx escapes are decoded.
 * Encrypted PDFs encrypt strings and streams, not dictionaries, so their actions are still visible.
 * @param {Uint8Array} bytes
 * @param {Work} work
 */
async function inspectPdf(bytes, work) {
  const { found } = work;
  const text = byteString(bytes);
  const decoded = pdfNames(text);
  if (/\/Encrypt\s*(?:<<|\d+\s+\d+\s+R)/.test(decoded)) found.add('encrypted');
  const { objects, versions, unreadable } = await pdfObjects(bytes, text);
  if (unreadable) found.add('partlyRead');
  // Every version of every object: a reader follows the cross-reference table, so a later copy with the same number
  // (even one written inside a stream's data) must not hide the earlier one from these checks.
  const all = versions.size ? [...versions.values()].flat().map(pdfNames) : [decoded];
  /** @param {string} name */
  const pattern = (name) => new RegExp(`/${name}${NAME_END}`);
  /** @param {string} name */
  const bodies = (name) => all.filter((body) => pattern(name).test(body));
  /** A string written in place or as a reference to another object. @param {string} source @param {string} key */
  const value = (source, key) => {
    const direct = new RegExp(String.raw`/${key}\s*(?=[(<])(?!<<)`).exec(source);
    const token = direct ? stringToken(source, direct.index + direct[0].length) : '';
    if (token) return pdfString(token);
    const reference = new RegExp(String.raw`/${key}\s+(\d+)\s+\d+\s+R`).exec(source);
    const target = reference ? objects.get(Number(reference[1]))?.trim() ?? '' : '';
    return /^[(<]/.test(target) ? pdfString(stringToken(target, 0)) : '';
  };
  /** The file named by an action's /F, written as a string or a file specification. @param {string} body */
  const fileOf = (body) => value(body, 'F') || value(body, 'UF') || value(/\/Win\s*<<[^>]*/.exec(body)?.[0] ?? '', 'F');

  if (bodies('JS').length || bodies('JavaScript').length) found.add('pdfJavaScript');
  // Automatic: an action when the document opens or on page, field and document events; and the document-level
  // JavaScript name tree, which runs "when the document is opened" (§12.6.4.16).
  // Opening on a given page (GoTo) is ordinary; any other action on opening is not.
  /** @param {string} action */
  const acts = (action) => [...pdfNames(action).matchAll(/\/S\s*\/(\w+)/g)].some((match) => match[1] !== 'GoTo');
  const openAction = all.some((body) => {
    const reference = /\/OpenAction\s+(\d+)\s+\d+\s+R/.exec(body);
    const direct = /\/OpenAction\s*(<<[\s\S]*?>>)/.exec(body)?.[1];
    return (direct !== undefined && acts(direct)) || (reference !== null && (versions.get(Number(reference[1])) ?? []).some(acts));
  });
  if (openAction || bodies('AA').length || all.some((body) => /\/JavaScript\s*(?:<<|\d+\s+\d+\s+R)/.test(body))) found.add('pdfAutoAction');
  const launch = bodies('Launch');
  if (launch.length) found.add('pdfLaunch', launch.map(fileOf));
  const remote = [...bodies('GoToR'), ...bodies('GoToE'), ...bodies('ImportData')];
  if (remote.length) found.add('pdfRemote', remote.map(fileOf));
  const submit = bodies('SubmitForm');
  if (submit.length) found.add('pdfSubmit', submit.map(fileOf));
  if (bodies('RichMedia').length) found.add('pdfMedia');
  if (bodies('XFA').length) found.add('pdfXfa');
  work.links.push(...bodies('URI').map((body) => value(body, 'URI')).filter(isWebLink));

  // Names spelled with escapes that a PDF reader decodes, used to hide them from simple checks.
  const hidden = new Set([...text.matchAll(/\/[^\s/[\]<>(){}%]*#[0-9A-Fa-f]{2}[^\s/[\]<>(){}%]*/g)].map((match) => pdfNames(match[0]).slice(1)).filter((name) => PDF_KEYWORDS.has(name)));
  if (hidden.size) found.add('pdfObfuscated', [...hidden].map((name) => `/${name}`));

  // Attached files: each file specification with an embedded file stream (§7.11.4).
  const specs = all.filter((body) => /\/EF\s*<</.test(body));
  if (specs.length || bodies('EmbeddedFiles').length || all.some((body) => /\/Subtype\s*\/FileAttachment\b/.test(body))) {
    found.add('pdfAttachments', specs.map((body) => value(body, 'UF') || value(body, 'F')));
  }
  if (!specs.length || tooDeep(work)) return;
  // Where each object starts in the file, found once (the last copy of a number is the one readers use).
  /** @type {Map<number, { at: number, end: number }>} */
  const positions = new Map();
  const headers = [...text.matchAll(/(?:^|[\r\n\s])(\d+)\s+\d+\s+obj\b/g)];
  headers.forEach((match, i) => positions.set(Number(match[1]), { at: match.index + match[0].length, end: headers[i + 1]?.index ?? text.length }));
  for (const spec of specs) {
    const number = Number(/\/EF\s*<<[^>]*?\/(?:UF|F)\s+(\d+)\s+\d+\s+R/.exec(spec)?.[1] ?? Number.NaN);
    const position = positions.get(number);
    if (!position) continue;
    const { at } = position;
    const endobj = text.indexOf('endobj', at);
    const body = text.slice(at, endobj === -1 ? position.end : Math.min(endobj, position.end));
    const name = value(spec, 'UF') || value(spec, 'F') || `${number}`;
    const declared = Number(/\/Length\s+(\d+)/.exec(body)?.[1] ?? 0);
    await addChild(work, name, async () => {
      // Inflated no further than a file inside may be, and than the shared budget allows: a small stream can
      // inflate to gigabytes.
      const data = await streamData(bytes, at, body, objects, Math.min(MAX_INNER, MAX_UNPACKED - work.context.budget.unpacked));
      if (data === null) throw new Error('stream not decoded, or larger than allowed');
      return ascii(data);
    }, declared);
  }
}

/* ---------- Web pages and SVG ---------- */

/**
 * HTML and SVG, read as text, never shown. What phishing pages and HTML smuggling use: scripts, password forms,
 * automatic redirects, files carried inside the page as base64 or data: addresses (T1027.006), SVG foreignObject.
 * @param {Uint8Array} bytes
 * @param {Work} work
 */
function inspectPage(bytes, work) {
  const { found } = work;
  const text = bytes[0] === 0xff && bytes[1] === 0xfe ? new TextDecoder('utf-16le').decode(bytes) : bytes[0] === 0xfe && bytes[1] === 0xff ? new TextDecoder('utf-16be').decode(bytes) : utf8(bytes);
  const tags = [...text.matchAll(/<[a-z][^>]*>/gi)].map((match) => match[0]);
  // An event handler may follow a space, a slash ("<svg/onload=…>") or a closing quote.
  const handlers = tags.some((tag) => /[\s/"']on[a-z]{3,}\s*=/i.test(tag));
  // Browsers drop tabs and line breaks anywhere in an address and spaces or control characters before it.
  /** @param {string} url */
  const runsScript = (url) => /^(?:javascript|vbscript):/i.test(url.replace(/[\t\n\r]/g, '').replace(/^[\u0000-\u0020]+/, ''));
  const scriptLinks = tags.some((tag) => ['href', 'xlink:href', 'action', 'formaction', 'src'].some((name) => runsScript(attribute(tag, name))));
  if (/<script\b/i.test(text) || handlers || scriptLinks) found.add('pageScript');

  // The type is read after character references are decoded: type="pass&#119;ord" is a password box too.
  const passwordBox = tags.some((tag) => /^<input\b/i.test(tag) && attribute(tag, 'type').trim().toLowerCase() === 'password');
  if (passwordBox || /\.type\s*=\s*["']password["']|\btype\s*:\s*["']password["']/i.test(text)) {
    const actions = tags.filter((tag) => /^<form\b/i.test(tag)).map((tag) => attribute(tag, 'action')).filter(Boolean);
    found.add('passwordForm', actions);
  }
  const refresh = tags.find((tag) => /^<meta\b/i.test(tag) && /^refresh$/i.test(attribute(tag, 'http-equiv')));
  if (refresh) {
    const target = /url\s*=\s*['"]?([^'"]+)/i.exec(attribute(refresh, 'content'))?.[1]?.trim() ?? '';
    found.add('refresh', [target]);
    if (isWebLink(target)) work.links.push(target);
  }
  const base64 = /[A-Za-z0-9+/]{20000,}={0,2}/.test(text) || /\batob\s*\(/.test(text);
  const dataFile = tags.some((tag) => /^data:(?!image\/)/i.test(attribute(tag, 'href').trim()));
  // Saving: a script that builds a Blob or sets a link's download name, or a tag with a download attribute. The plain
  // word "download" in a newsletter's text is not one.
  const saves = /\bnew\s+Blob\s*\(|msSaveOrOpenBlob|msSaveBlob|\.download\s*=/i.test(text) || tags.some((tag) => /[\s/"']download(?:[\s=>/]|$)/i.test(tag));
  if ((base64 || dataFile) && saves) found.add('smuggling');
  if (/<foreignObject\b/i.test(text)) found.add('foreignObject');

  for (const tag of tags) {
    for (const name of ['href', 'xlink:href', 'action', 'src']) {
      const url = attribute(tag, name);
      if (isWebLink(url)) work.links.push(url.trim());
    }
  }
  // Pages that send the visitor elsewhere from a script.
  for (const match of text.matchAll(/location(?:\.href)?\s*=\s*["'](https?:\/\/[^"']+)["']|location\.(?:replace|assign)\s*\(\s*["'](https?:\/\/[^"']+)["']/g)) work.links.push(match[1] ?? match[2]);
}

/* ---------- Shortcuts ---------- */

/**
 * What a Windows shortcut (.lnk) runs: MS-SHLLINK §2.1–2.5. The target is the local path in LinkInfo, else the
 * network path, else the relative path; many malicious shortcuts give it only in the environment-variable block.
 * @param {Uint8Array} bytes
 * @returns {{ target: string, arguments: string, workingDir: string }}
 */
export function readLnk(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const out = { target: '', arguments: '', workingDir: '' };
  if (bytes.length < 0x4c) return out;
  const flags = view.getUint32(0x14, true);
  const unicode = (flags & 0x80) !== 0;
  let at = 0x4c;
  /** @param {number} from @param {number} [limit] */
  const cString = (from, limit = 520) => {
    let end = from;
    while (end < Math.min(bytes.length, from + limit) && bytes[end] !== 0) end += 1;
    return byteString(bytes.subarray(from, end));
  };
  try {
    if (flags & 0x01) at += 2 + view.getUint16(at, true);
    if (flags & 0x02) {
      const info = at;
      const size = view.getUint32(info, true);
      const infoFlags = view.getUint32(info + 8, true);
      if (infoFlags & 0x01) out.target = cString(info + view.getUint32(info + 0x10, true));
      if (!out.target && infoFlags & 0x02) {
        const network = info + view.getUint32(info + 0x14, true);
        out.target = cString(network + view.getUint32(network + 8, true));
      }
      at += size;
    }
    /** @returns {string} */
    const nextString = () => {
      const count = view.getUint16(at, true);
      const length = unicode ? count * 2 : count;
      const value = unicode ? new TextDecoder('utf-16le').decode(bytes.subarray(at + 2, at + 2 + length)) : byteString(bytes.subarray(at + 2, at + 2 + length));
      at += 2 + length;
      return value;
    };
    const strings = { name: '', relative: '', workingDir: '', arguments: '', icon: '' };
    if (flags & 0x04) strings.name = nextString();
    if (flags & 0x08) strings.relative = nextString();
    if (flags & 0x10) strings.workingDir = nextString();
    if (flags & 0x20) strings.arguments = nextString();
    if (flags & 0x40) strings.icon = nextString();
    out.arguments = strings.arguments;
    out.workingDir = strings.workingDir;
    out.target ||= strings.relative;
    // Extra data blocks: size, signature; EnvironmentVariableDataBlock 0xA0000001 holds the target (ANSI, then UTF-16).
    for (let count = 0; at + 8 <= bytes.length && count < 64; count += 1) {
      const size = view.getUint32(at, true);
      if (size < 8) break;
      if (view.getUint32(at + 4, true) === 0xa0000001 && size >= 0x314) {
        const wide = new TextDecoder('utf-16le').decode(bytes.subarray(at + 268, at + 788)).replace(/\0[\s\S]*$/, '');
        out.target ||= wide || cString(at + 8, 260);
      }
      at += size;
    }
  } catch {
    // A shortcut cut short: what was read so far is still worth showing.
  }
  return out;
}

/** @param {Uint8Array} bytes @param {Work} work */
function inspectLnk(bytes, work) {
  const { target, arguments: args } = readLnk(bytes);
  work.found.add('shortcut', [[target, args].join(' ')]);
}

/**
 * An internet shortcut (.url): an INI file. URL= is where it leads; WorkingDirectory= on a remote share let one
 * run code from there (CVE-2025-33053, research §8).
 * @param {Uint8Array} bytes
 * @param {Work} work
 */
function inspectUrlFile(bytes, work) {
  const text = utf8(bytes);
  /** @param {string} key */
  const field = (key) => new RegExp(String.raw`^\s*${key}\s*=\s*(.*)$`, 'im').exec(text)?.[1]?.trim() ?? '';
  const url = field('URL');
  work.found.add('shortcut', [url]);
  if (isWebLink(url)) work.links.push(url);
  const folder = field('WorkingDirectory');
  if (folder) work.found.add('remoteFolder', [folder]);
}

/**
 * Windows library (.library-ms) and search connector (.searchConnector-ms) files: the folders they open, often on
 * another computer (research §8).
 * @param {Uint8Array} bytes
 * @param {Work} work
 */
function inspectLocations(bytes, work) {
  const text = utf8(bytes);
  work.found.add('shortcut', [...text.matchAll(/<url>\s*([^<]+?)\s*<\/url>/gi)].map((match) => decodeEntities(match[1])));
}

/* ---------- Apple configuration profiles ---------- */

/** Payload types in plain words (Apple Device Management reference, research §8). */
const PAYLOADS = /** @type {Record<string, string>} */ ({
  'com.apple.vpn.managed': 'vpn',
  'com.apple.security.root': 'certificate',
  'com.apple.mdm': 'mdm',
  'com.apple.wifi.managed': 'wifi',
  'com.apple.mail.managed': 'mail',
  'com.apple.dnsSettings.managed': 'dns',
  'com.apple.webClip.managed': 'webClip',
  'com.apple.applicationaccess': 'restrictions',
});

/**
 * What a configuration profile sets up: its payload types, as plain-word keys ("other" for the rest).
 * @param {Uint8Array} bytes
 * @param {Work} work
 */
function inspectProfile(bytes, work) {
  const text = byteString(bytes.subarray(0, 4 * 1024 * 1024));
  const types = [...text.matchAll(/<key>\s*PayloadType\s*<\/key>\s*<string>\s*([^<]+?)\s*<\/string>/g)].map((match) => match[1]).filter((type) => type !== 'Configuration');
  work.found.add('profile', types.map((type) => PAYLOADS[type] ?? 'other'));
  if (/<key>\s*EncryptedPayloadContent\s*<\/key>/.test(text)) work.found.add('encrypted');
}

/* ---------- Archives besides ZIP, and disk images ---------- */

/**
 * A gzip file holds one file: unpacked and checked like a file inside an archive.
 * @param {Uint8Array} bytes
 * @param {string} name
 * @param {Work} work
 */
async function inspectGzip(bytes, name, work) {
  if (tooDeep(work)) return;
  if (typeof DecompressionStream !== 'function') {
    work.found.add('cantList');
    return;
  }
  const inner = name.replace(/\.tgz$/i, '.tar').replace(/\.gz$/i, '') || name;
  await addChild(work, inner, async () => {
    const reader = new Blob([/** @type {Uint8Array<ArrayBuffer>} */ (bytes)]).stream().pipeThrough(new DecompressionStream('gzip')).getReader();
    /** @type {Uint8Array[]} */
    const chunks = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > MAX_INNER) {
        await reader.cancel();
        throw new Error('too large');
      }
      chunks.push(value);
    }
    const out = new Uint8Array(total);
    chunks.reduce((offset, chunk) => (out.set(chunk, offset), offset + chunk.length), 0);
    return out;
  }, 0);
}

/**
 * A tar archive: 512-byte headers (name at 0, size in octal at 124, type at 156, ustar prefix at 345), each
 * followed by the file's data rounded up to 512 bytes.
 * @param {Uint8Array} bytes
 * @param {Work} work
 */
async function inspectTar(bytes, work) {
  if (tooDeep(work)) return;
  /** @param {number} from @param {number} length */
  const field = (from, length) => byteString(bytes.subarray(from, from + length)).replace(/\0[\s\S]*$/, '');
  let longName = '';
  for (let at = 0; at + 512 <= bytes.length;) {
    if (bytes.subarray(at, at + 512).every((byte) => byte === 0)) break;
    const size = Number.parseInt(field(at + 124, 12).trim() || '0', 8);
    if (!Number.isFinite(size) || size < 0) {
      work.found.add('partlyRead');
      break;
    }
    const prefix = field(at + 257, 6).startsWith('ustar') ? field(at + 345, 155) : '';
    const type = String.fromCharCode(bytes[at + 156]);
    const from = at + 512;
    const data = bytes.subarray(from, Math.min(bytes.length, from + size));
    // GNU tar writes a long name as an "L" entry before the file; pax as a "path=" record in an "x" entry.
    if (type === 'L') longName = utf8(data).replace(/\0[\s\S]*$/, '');
    else if (type === 'x') longName = /(?:^|\n)\d+ path=([^\n]*)\n/.exec(utf8(data))?.[1] ?? longName;
    else {
      const name = longName || utf8(ascii(prefix ? `${prefix}/${field(at, 100)}` : field(at, 100)));
      longName = '';
      // Regular files: "0", the old "\0", and "7" (contiguous), which tools unpack as ordinary files.
      if (['0', '\0', '7'].includes(type) && from + size <= bytes.length) await addChild(work, name, async () => data, size);
    }
    at = from + Math.ceil(size / 512) * 512;
  }
}

/** Directories and directory records read from one disc image: far more than real images hold. */
const MAX_ISO_DIRECTORIES = 256;
const MAX_ISO_RECORDS = 20_000;

/**
 * Lists an ISO 9660 disc image (ECMA-119, research §8): Joliet names when there are any, plain names otherwise.
 * Only the directory sectors and the files' own bytes are read, so large images work too. Hidden entries are
 * reported: a visible shortcut that runs a hidden program is a common pattern in such images.
 * @param {Blob} file
 * @param {Work} work
 */
async function inspectIso(file, work) {
  const { found } = work;
  const sector = 2048;
  /** @type {{ lba: number, size: number } | null} */
  let root = null;
  let joliet = false;
  for (let index = 16; index < 32; index += 1) {
    const descriptor = await readRange(file, index * sector, sector);
    if (descriptor.length < 190 || byteString(descriptor.subarray(1, 6)) !== 'CD001' || descriptor[0] === 255) break;
    const view = new DataView(descriptor.buffer, descriptor.byteOffset, descriptor.byteLength);
    const record = { lba: view.getUint32(158, true), size: view.getUint32(166, true) };
    const escape = byteString(descriptor.subarray(88, 91));
    if (descriptor[0] === 2 && /^%\/[@CE]$/.test(escape)) {
      root = record;
      joliet = true;
    } else if (descriptor[0] === 1 && !joliet) {
      root = record;
    }
  }
  if (!root) {
    found.add('cantList');
    return;
  }
  if (tooDeep(work)) return;
  /** @type {{ lba: number, size: number, path: string }[]} */
  const queue = [{ ...root, path: '' }];
  const seen = new Set();
  /** @type {string[]} */
  const hidden = [];
  // Directories may point at each other or at themselves: every directory is read once, and the walk stops after a
  // bounded number of directories and records.
  let records = 0;
  for (let visited = 0; queue.length && visited < MAX_ISO_DIRECTORIES; visited += 1) {
    const directory = /** @type {{ lba: number, size: number, path: string }} */ (queue.shift());
    if (seen.has(directory.lba)) continue;
    seen.add(directory.lba);
    const data = await readRange(file, directory.lba * sector, Math.min(directory.size, 1024 * 1024));
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    for (let at = 0; at < data.length;) {
      const length = data[at];
      if (length === 0) {
        at = (Math.floor(at / sector) + 1) * sector;
        continue;
      }
      if (at + 33 > data.length) break;
      records += 1;
      if (records > MAX_ISO_RECORDS || work.childTotal >= MAX_INSIDE) {
        found.add('partlyRead');
        queue.length = 0;
        break;
      }
      const flags = data[at + 25];
      const nameLength = data[at + 32];
      const raw = data.subarray(at + 33, at + 33 + nameLength);
      at += length;
      if (nameLength === 1 && raw[0] <= 1) continue;
      const base = joliet ? new TextDecoder('utf-16be').decode(raw) : byteString(raw);
      const name = base.replace(/;\d+$/, '').replace(/\.$/, '');
      const path = directory.path ? `${directory.path}/${name}` : name;
      const lba = view.getUint32(at - length + 2, true);
      const size = view.getUint32(at - length + 10, true);
      if (flags & 0x01 && hidden.length < MAX_VALUES) hidden.push(path);
      if (flags & 0x02) {
        if (path.split('/').length < 8 && !seen.has(lba) && queue.length < MAX_ISO_DIRECTORIES) queue.push({ lba, size, path });
        continue;
      }
      await addChild(work, path, () => readRange(file, lba * sector, size), size);
    }
  }
  if (hidden.length) found.add('hiddenFiles', hidden);
}

/* ---------- Example ---------- */

/** @param {string} text */
const bytesOf = (text) => new TextEncoder().encode(text);

/**
 * Three harmless files that show the checker's verdicts: a "PDF" whose name hides that it is a Windows program (a
 * 128-byte stub that can't run), a web page with a password form that sends what is typed elsewhere, and a Word
 * document marked as having macros, with an empty macro part.
 * @returns {File[]}
 */
export function exampleFiles() {
  const program = new Uint8Array(128);
  program.set(ascii('MZ'));
  const page = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Delivery notice</title></head>
<body><h1>Your parcel is waiting</h1><p>Sign in to arrange delivery.</p>
<form action="https://parcel-delivery-notice.example/login" method="post">
<input type="email" name="email"><input type="password" name="password"><button>Sign in</button>
</form></body></html>
`;
  const part = (/** @type {string} */ name, /** @type {Uint8Array} */ data) => ({ name, rawName: ascii(name), flags: 0, method: 0, crc: crc32(data), size: data.length, data });
  const document = writeZip([
    part('[Content_Types].xml', bytesOf('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="bin" ContentType="application/vnd.ms-office.vbaProject"/><Override PartName="/word/document.xml" ContentType="application/vnd.ms-word.document.macroEnabled.main+xml"/></Types>')),
    part('_rels/.rels', bytesOf('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>')),
    part('word/_rels/document.xml.rels', bytesOf('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.microsoft.com/office/2006/relationships/vbaProject" Target="vbaProject.bin"/></Relationships>')),
    part('word/document.xml', bytesOf('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Quarterly report</w:t></w:r></w:p></w:body></w:document>')),
    part('word/vbaProject.bin', new Uint8Array(0)),
  ]);
  return [
    new File([program], 'Invoice‮fdp.exe', { type: 'application/pdf' }),
    new File([bytesOf(page)], 'Delivery notice.html', { type: 'text/html' }),
    new File([document], 'Report.docm', { type: 'application/vnd.ms-word.document.macroEnabled.12' }),
  ];
}

/* ---------- Page wiring ---------- */

/** Files checked at once; more are left out. */
export const MAX_FILES = 10;

/** "javaClass" → "java-class", as the page writes labels: data-kind-java-class. @param {string} key */
const attributeName = (key) => key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
/** The page's words for a kind of file. @param {HTMLElement} labels @param {string} kind */
const kindLabel = (labels, kind) => labels.getAttribute(`data-kind-${attributeName(kind)}`) ?? labels.getAttribute('data-kind-unknown') ?? '';

/**
 * One file's card, from the page's template.
 * @param {HTMLTemplateElement} template
 * @param {FileReport} report
 */
function card(template, report) {
  const element = /** @type {HTMLElement} */ (/** @type {HTMLElement} */ (template.content.firstElementChild).cloneNode(true));
  /** @template {HTMLElement} T @param {string} name @returns {T} */
  const part = (name) => /** @type {T} */ (element.querySelector(`[data-js="attachment-${name}"]`));
  element.dataset.verdict = report.verdict;
  // Only findings that call for care colour the card; "nothing found" stays neutral, never approving.
  element.dataset.state = report.verdict === 'none' || report.verdict === 'locked' ? 'ok' : 'warn';
  part('name').textContent = report.nameCheck.visible;
  const verdict = part('verdict');
  verdict.textContent = verdict.dataset[report.verdict] ?? '';
  const advice = part('advice');
  advice.textContent = advice.dataset[report.verdict] ?? '';
  const kind = part('kind');
  kind.textContent = kindLabel(kind, report.kind);

  for (const item of /** @type {HTMLElement[]} */ ([...element.querySelectorAll('[data-finding]')])) {
    const finding = report.findings.find((entry) => entry.key === item.dataset.finding);
    item.hidden = !finding;
    if (!finding) continue;
    const values = /** @type {HTMLElement | null} */ (item.querySelector('[data-js="attachment-values"]'));
    if (!values) continue;
    const shown = finding.key === 'profile' ? finding.values.map((value) => values.getAttribute(`data-payload-${attributeName(value)}`) ?? value) : finding.values;
    values.hidden = shown.length === 0;
    values.replaceChildren(...shown.map((value) => {
      const line = document.createElement('code');
      line.textContent = value;
      return line;
    }));
  }
  part('findings').hidden = report.findings.length === 0;

  const inside = part('inside');
  inside.hidden = report.insideTotal === 0;
  fillInto(part('inside-title'), part('inside-title').dataset.template, { n: String(report.insideTotal) });
  const insideList = part('inside-list');
  insideList.replaceChildren(...report.inside.map((item) => {
    const row = document.createElement('li');
    row.dataset.verdict = item.verdict;
    const name = document.createElement('span');
    name.textContent = item.name;
    name.translate = false;
    const label = document.createElement('span');
    label.className = 'facts__why';
    label.textContent = `${kindLabel(kind, item.kind)} · ${insideList.dataset[item.verdict] ?? ''}`;
    row.append(name, label);
    return row;
  }));
  const more = part('inside-more');
  more.hidden = report.insideTotal <= report.inside.length;
  more.textContent = fillText(more.dataset.template, { n: String(report.insideTotal - report.inside.length) });

  const links = part('links');
  links.hidden = report.linksTotal === 0;
  fillInto(part('links-title'), part('links-title').dataset.template, { n: String(report.linksTotal) });
  const linkList = part('links-list');
  linkList.replaceChildren(...report.links.map((link) => {
    const row = document.createElement('li');
    const address = document.createElement('span');
    address.className = 'verdict__address';
    address.translate = false;
    address.dir = 'ltr';
    address.textContent = link.url;
    const judged = document.createElement('span');
    judged.className = 'facts__why';
    judged.textContent = link.warnings ? fillText(linkList.dataset.warn, { n: String(link.warnings) }) : (linkList.dataset.ok ?? '');
    row.dataset.state = link.warnings ? 'warn' : 'ok';
    row.append(address, judged);
    return row;
  }));
  const linksMore = part('links-more');
  linksMore.hidden = report.linksTotal <= report.links.length;
  linksMore.textContent = fillText(linksMore.dataset.template, { n: String(report.linksTotal - report.links.length) });
  return element;
}

/** @param {HTMLElement} root */
export function init(root) {
  /** @template {Element} T @param {string} name @returns {T} */
  const find = (name) => /** @type {T} */ (root.querySelector(`[data-js="attachment-${name}"]`));
  const input = /** @type {HTMLInputElement} */ (find('file'));
  const results = /** @type {HTMLElement} */ (find('results'));
  const template = /** @type {HTMLTemplateElement} */ (find('template'));
  const summary = /** @type {HTMLElement} */ (find('summary'));
  const example = /** @type {HTMLButtonElement} */ (find('example'));
  if (!input || !results || !template) return;
  /** Counts choices: results of an earlier choice that finish late are dropped. */
  let run = 0;

  /** @param {File[]} files */
  const open = async (files) => {
    run += 1;
    const current = run;
    const chosen = files.slice(0, MAX_FILES);
    summary.textContent = summary.dataset.reading ?? '';
    results.replaceChildren();
    /** @type {HTMLElement[]} */
    const cards = [];
    for (const file of chosen) {
      try {
        cards.push(card(template, await inspectFile(file, file.name)));
      } catch (error) {
        console.error('[lockwell] Could not check the chosen file.', error);
        const failed = card(template, { name: file.name, nameCheck: checkName(file.name), kind: 'unknown', findings: [{ key: 'damaged', level: 'locked', values: [] }], verdict: 'locked', inside: [], insideTotal: 0, links: [], linksTotal: 0 });
        cards.push(failed);
      }
      if (current !== run) return;
    }
    results.replaceChildren(...cards);
    summary.textContent = fillText(files.length > MAX_FILES ? summary.dataset.capped : summary.dataset.done, { n: String(chosen.length), max: String(MAX_FILES) });
  };

  input.addEventListener('change', () => {
    if (input.files?.length) open([...input.files]);
  });
  receiveFiles(root, (_first, files) => open(files));
  example?.addEventListener('click', () => open(exampleFiles()));
}

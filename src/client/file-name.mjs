// @ts-check
/**
 * @file Reading a file name the way an attacker might have built it: endings that run something, a harmless ending
 * placed before the real one, direction controls that reverse the end, padding. Shared by the attachment checker and
 * the email header analyzer (attachment names); sources in docs/research/tool-file-check.md §2.
 */

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
export const OPENS_SOMETHING = new Set(['cer', 'crt', 'der', 'theme', 'lib', 'library-ms', 'search-ms']);

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

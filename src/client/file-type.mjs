// @ts-check
/**
 * @file What a file really is, from its bytes, and what its name claims: shared by the attachment checker.
 */
/**
 * Browsers take a file's type from its name ("File.type comes from the extension only"), so a file renamed from
 * .exe to .pdf still says application/pdf. This module reads the first bytes, a few fixed places further in (disk
 * images) and the end of the file instead. Signatures: docs/research/tool-file-check.md §1 and §8, and the WHATWG
 * MIME Sniffing Standard (last updated 2026-10-19) §6.1–6.2 and §7.1 for pictures, sound, video and HTML.
 */
import { readRange } from './file-read.mjs';

/**
 * @typedef {'program' | 'shortcut' | 'script' | 'diskImage' | 'archive' | 'document' | 'web' | 'picture' | 'audio'
 *   | 'video' | 'text' | 'unknown'} Group
 *   program: runs as code when opened (Windows, Mac, Linux, Android, Java, help files that run scripts, installers).
 *   shortcut: points elsewhere and runs or opens that (Windows shortcuts, internet shortcuts, search connectors).
 *   script: text that a system runs as a program (.js, .vbs, .ps1, .bat…), recognised by name and content.
 *   web: HTML and SVG, which a browser shows and can run scripts in.
 * @typedef {object} FileType
 * @property {string} kind  A short id, e.g. "exe", "zip", "pdf", "html"; "unknown" when nothing matched.
 * @property {Group} group
 */

/** Bytes read from the start: enough for every signature, the PDF and HTML rules, and a text check. */
const HEAD_BYTES = 64 * 1024;
/** Bytes read from the end, for formats that sign their last bytes (disk images). */
const TAIL_BYTES = 512;

/** @param {Uint8Array} bytes @param {number} at @param {number[]} signature  -1 matches any byte. */
const matches = (bytes, at, signature) => at + signature.length <= bytes.length && signature.every((byte, i) => byte === -1 || bytes[at + i] === byte);
/** @param {string} text */
const ascii = (text) => Array.from(text, (char) => char.charCodeAt(0));

/**
 * Fixed signatures at the start of the file, checked in order. Sources in the research log §1 unless noted.
 * @type {[string, Group, number[], number?][]}  kind, group, signature, offset.
 */
const SIGNATURES = [
  ['elf', 'program', [0x7f, 0x45, 0x4c, 0x46]],
  ['macho', 'program', [0xfe, 0xed, 0xfa, 0xce]],
  ['macho', 'program', [0xfe, 0xed, 0xfa, 0xcf]],
  ['macho', 'program', [0xce, 0xfa, 0xed, 0xfe]],
  ['macho', 'program', [0xcf, 0xfa, 0xed, 0xfe]],
  // MS-SHLLINK §2.1: HeaderSize 0x4C, then the class identifier 00021401-0000-0000-C000-000000000046.
  ['lnk', 'shortcut', [0x4c, 0, 0, 0, 0x01, 0x14, 0x02, 0, 0, 0, 0, 0, 0xc0, 0, 0, 0, 0, 0, 0, 0x46]],
  ['cfb', 'document', [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]],
  ['zip', 'archive', [0x50, 0x4b, 0x03, 0x04]],
  // An empty ZIP archive is only its end record.
  ['zip', 'archive', [0x50, 0x4b, 0x05, 0x06]],
  ['rar', 'archive', [0x52, 0x61, 0x72, 0x21, 0x1a, 0x07, 0x00]],
  ['rar', 'archive', [0x52, 0x61, 0x72, 0x21, 0x1a, 0x07, 0x01, 0x00]],
  ['7z', 'archive', [0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c]],
  ['gzip', 'archive', [0x1f, 0x8b, 0x08]],
  ['cab', 'archive', ascii('MSCF')],
  ['xar', 'archive', ascii('xar!')],
  ['tar', 'archive', ascii('ustar'), 257],
  // Word opens a file as RTF from "{\\rt" on (research §1 lists "{\\rtf"; the review showed "{\\rtx" opens too).
  ['rtf', 'document', ascii('{\\rt')],
  // MS-ONESTORE §2.3.1: the file format GUID {7B5C52E4-D88C-4DA7-AEB1-5378D02996D3}, bytes as stored.
  ['onenote', 'document', [0xe4, 0x52, 0x5c, 0x7b, 0x8c, 0xd8, 0xa7, 0x4d, 0xae, 0xb1, 0x53, 0x78, 0xd0, 0x29, 0x96, 0xd3]],
  // Compiled HTML Help: can run scripts, and both Gmail and Outlook block it.
  ['chm', 'program', ascii('ITSF')],
  ['vhdx', 'diskImage', ascii('vhdxfile')],
  // WHATWG MIME Sniffing §6.1 (pictures) and §6.2 (sound and video).
  ['jpeg', 'picture', [0xff, 0xd8, 0xff]],
  ['png', 'picture', [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]],
  ['gif', 'picture', ascii('GIF87a')],
  ['gif', 'picture', ascii('GIF89a')],
  ['webp', 'picture', [...ascii('RIFF'), -1, -1, -1, -1, ...ascii('WEBPVP')]],
  ['ico', 'picture', [0, 0, 1, 0]],
  ['ico', 'picture', [0, 0, 2, 0]],
  ['wav', 'audio', [...ascii('RIFF'), -1, -1, -1, -1, ...ascii('WAVE')]],
  ['avi', 'video', [...ascii('RIFF'), -1, -1, -1, -1, ...ascii('AVI ')]],
  ['aiff', 'audio', [...ascii('FORM'), -1, -1, -1, -1, ...ascii('AIFF')]],
  ['mp3', 'audio', ascii('ID3')],
  ['ogg', 'audio', [...ascii('OggS'), 0]],
  ['midi', 'audio', [...ascii('MThd'), 0, 0, 0, 6]],
  ['webm', 'video', [0x1a, 0x45, 0xdf, 0xa3]],
];

/** Sizes of the BMP information header that follows the 14-byte file header (BITMAPCOREHEADER to BITMAPV5HEADER). */
const BMP_INFO_SIZES = new Set([12, 16, 40, 52, 56, 64, 108, 124]);

/**
 * A Windows or DOS program: "MZ", then either a PE header where the DOS header points (e_lfanew at 0x3C) or bytes that
 * aren't text. Plain text that happens to start "MZ" ("MZ Bank statement") is not a program.
 * @param {Uint8Array} head
 */
function isProgram(head) {
  if (!matches(head, 0, ascii('MZ'))) return false;
  if (head.length >= 0x40) {
    const pe = head[0x3c] | (head[0x3d] << 8) | (head[0x3e] << 16) | (head[0x3f] << 24);
    if (pe > 0 && pe + 4 <= head.length && matches(head, pe, [0x50, 0x45, 0, 0])) return true;
  }
  return head.subarray(0, 4096).some(isBinaryByte);
}

/** A BMP picture: "BM", zero reserved fields and a known information header size, not text such as "BMI,…". @param {Uint8Array} head */
const isBmp = (head) => head.length >= 18 && matches(head, 0, ascii('BM')) && head[6] === 0 && head[7] === 0 && head[8] === 0 && head[9] === 0 && BMP_INFO_SIZES.has(head[14] | (head[15] << 8));

/** HEIF and AVIF picture brands (photo tool), and QuickTime/MP4 video brands, in an ISO media `ftyp` box. */
const PICTURE_BRANDS = new Set(['heic', 'heix', 'heim', 'heis', 'hevc', 'hevx', 'mif1', 'mif2', 'mif3', 'msf1', 'miaf', 'avif', 'avis']);

/**
 * ISO 9660 volume descriptors start "CD001" at byte 1 of sectors 16, 17 and 18 (2,048-byte sectors).
 */
const ISO_OFFSETS = [0x8001, 0x8801, 0x9001];

/** Bytes that don't occur in text (WHATWG MIME Sniffing §7.1, "binary data byte"). @param {number} byte */
const isBinaryByte = (byte) => byte <= 0x08 || byte === 0x0b || (byte >= 0x0e && byte <= 0x1a) || (byte >= 0x1c && byte <= 0x1f);

/**
 * Start tags that make a text HTML (WHATWG MIME Sniffing §7.1), each followed by a space or ">", plus meta and
 * link elements: a saved .html file opens as a web page whatever it starts with, and mail pages often start with meta.
 */
const HTML_STARTS = ['<!DOCTYPE HTML', '<HTML', '<HEAD', '<SCRIPT', '<IFRAME', '<H1', '<DIV', '<FONT', '<TABLE', '<A', '<STYLE', '<TITLE', '<B', '<BODY', '<BR', '<P', '<META', '<LINK', '<!--'];
/** An SVG document: its root element after an optional XML declaration, comments and doctype. */
const SVG_START = /^(?:<\?xml[^>]*>\s*)?(?:<!--[\s\S]*?-->\s*|<!DOCTYPE[^>]*>\s*)*<svg[\s>]/i;

/**
 * The type of a text file, from its first characters.
 * @param {string} text  The start of the file as text, without a byte order mark.
 * @returns {FileType}
 */
export function textType(text) {
  const start = text.replace(/^[\s\0]+/, '');
  const upper = start.slice(0, 64).toUpperCase();
  if (/^<\?xml[\s\S]{0,2048}<(svg)[\s>]/i.test(start.slice(0, 4096)) || SVG_START.test(start.slice(0, 8192))) return { kind: 'svg', group: 'web' };
  if (HTML_STARTS.some((tag) => upper.startsWith(tag) && (tag === '<!--' || /[\s>]/.test(upper[tag.length] ?? '')))) return { kind: 'html', group: 'web' };
  // Windows may write property sections such as "[{000214A0-…}]" before [InternetShortcut].
  if (/^(?:\[\{[0-9A-F-]+\}\][^[]*)*\[InternetShortcut\]/i.test(start.slice(0, 8192))) return { kind: 'url', group: 'shortcut' };
  if (/^<\?xml[\s\S]{0,512}<libraryDescription[\s>]/i.test(start.slice(0, 2048)) || /^<libraryDescription[\s>]/i.test(start)) return { kind: 'libraryMs', group: 'shortcut' };
  if (/^<\?xml[\s\S]{0,512}<searchConnectorDescription[\s>]/i.test(start.slice(0, 2048)) || /^<searchConnectorDescription[\s>]/i.test(start)) return { kind: 'searchMs', group: 'shortcut' };
  if (/^<\?xml[\s\S]{0,1024}<plist[\s>][\s\S]*<key>\s*PayloadContent\s*<\/key>/i.test(start.slice(0, 16384))) return { kind: 'mobileconfig', group: 'program' };
  if (/^<\?xml/i.test(start)) return { kind: 'xml', group: 'text' };
  if (/^#!/.test(start)) return { kind: 'shebang', group: 'script' };
  return { kind: 'text', group: 'text' };
}

/**
 * What the file is, from its bytes. Reads the first HEAD_BYTES, the last TAIL_BYTES and a few fixed places.
 * @param {Blob} file
 * @param {(blob: Blob, offset: number, length: number) => Promise<Uint8Array>} [read]
 * @returns {Promise<FileType>}
 */
export async function detectType(file, read = readRange) {
  if (file.size === 0) return { kind: 'empty', group: 'unknown' };
  const head = await read(file, 0, Math.min(HEAD_BYTES, file.size));
  if (isProgram(head)) return { kind: 'exe', group: 'program' };
  if (isBmp(head)) return { kind: 'bmp', group: 'picture' };
  for (const [kind, group, signature, offset = 0] of SIGNATURES) {
    if (!matches(head, offset, signature)) continue;
    // An MZ program may be a self-extracting archive; it is a program either way.
    return { kind, group };
  }
  // Mach-O "fat" files and Java class files share CA FE BA BE; the next four bytes are a small count of
  // architectures in the first, a class file version (45 and up) in the second.
  if (matches(head, 0, [0xca, 0xfe, 0xba, 0xbe]) && head.length >= 8) {
    const next = ((head[4] << 24) >>> 0) + (head[5] << 16) + (head[6] << 8) + head[7];
    return next < 45 ? { kind: 'macho', group: 'program' } : { kind: 'javaClass', group: 'program' };
  }
  // "%PDF-" may follow a few bytes of junk at the start (as the document tool accepts it).
  if (String.fromCharCode(...head.subarray(0, 1024)).includes('%PDF-')) return { kind: 'pdf', group: 'document' };
  // ISO media: `ftyp` at byte 4, or a QuickTime file starting with its movie or data box.
  if (matches(head, 4, ascii('ftyp')) && head.length >= 12) {
    const brand = String.fromCharCode(...head.subarray(8, 12));
    return PICTURE_BRANDS.has(brand) ? { kind: 'heif', group: 'picture' } : { kind: 'mp4', group: 'video' };
  }
  if (['moov', 'mdat', 'wide'].some((type) => matches(head, 4, ascii(type)))) return { kind: 'mp4', group: 'video' };

  for (const offset of ISO_OFFSETS) {
    if (offset + 5 > file.size) break;
    if (matches(await read(file, offset, 5), 0, ascii('CD001'))) return { kind: 'iso', group: 'diskImage' };
  }
  const tail = await read(file, Math.max(0, file.size - TAIL_BYTES), Math.min(TAIL_BYTES, file.size));
  // A VHD ends with a 512-byte footer that starts "conectix" (research §8).
  if (tail.length === TAIL_BYTES && matches(tail, 0, ascii('conectix'))) return { kind: 'vhd', group: 'diskImage' };
  // Apple disk images end with a 512-byte trailer that starts "koly" (research §8, secondary source).
  if (tail.length === TAIL_BYTES && matches(tail, 0, ascii('koly'))) return { kind: 'dmg', group: 'diskImage' };

  // A ZIP archive with bytes in front of it (as self-extractors and some mail tools leave): archive tools find its
  // directory from the end record, which is within the last 64 KB (a comment of up to 65,535 bytes follows it).
  const end = await read(file, Math.max(0, file.size - 0xffff - 22), Math.min(file.size, 0xffff + 22));
  for (let i = end.length - 22; i >= 0; i -= 1) {
    if (matches(end, i, [0x50, 0x4b, 0x05, 0x06]) && i + 22 + (end[i + 20] | (end[i + 21] << 8)) === end.length) return { kind: 'zip', group: 'archive' };
  }

  const sample = head.subarray(0, 4096);
  if (!sample.some(isBinaryByte)) {
    const bom = matches(head, 0, [0xef, 0xbb, 0xbf]) ? 3 : 0;
    return textType(new TextDecoder().decode(head.subarray(bom, Math.min(head.length, 32768))));
  }
  // UTF-16 text (with a byte order mark) has zero bytes but is text.
  if (matches(head, 0, [0xff, 0xfe]) || matches(head, 0, [0xfe, 0xff])) {
    return textType(new TextDecoder(head[0] === 0xff ? 'utf-16le' : 'utf-16be').decode(head.subarray(2, Math.min(head.length, 32768))));
  }
  return { kind: 'unknown', group: 'unknown' };
}

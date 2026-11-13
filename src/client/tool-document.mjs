// @ts-check
/**
 * @file Tool "Document metadata": shows and clears metadata in Office files and checks PDFs.
 */
/**
 * Document metadata: shows what a Word, Excel, PowerPoint or PDF file says
 * about who made it, and saves a cleaned copy of the Office formats.
 *
 * Office files (.docx, .xlsx, .pptx) are ZIP archives. Cleaning writes a new
 * archive in which the property files are emptied and the dates of the
 * entries are reset; every other entry is copied as it is, compressed bytes
 * and all. PDFs are only read: removing metadata from a PDF reliably means
 * rewriting it, which a small tool can't do safely.
 *
 * The file never leaves the browser.
 */
import { receiveFiles } from './files.mjs';
import { concat, crc32, startsWith } from './bytes.mjs';

/** A file this tool can't process; `code` picks the message shown. */
export class DocumentError extends Error {
  /** @param {'unsupported' | 'old' | 'damaged' | 'browser'} code */
  constructor(code) {
    super(`Document can't be processed: ${code}`);
    this.name = 'DocumentError';
    this.code = code;
  }
}

/**
 * @typedef {'tracked' | 'commentsPart' | 'custom' | 'xmp'} Flag
 *
 * @typedef {object} DocumentReport
 * @property {'docx' | 'xlsx' | 'pptx' | 'pdf'} kind
 * @property {Record<string, string>} fields  Row name → value, only for values that are present.
 * @property {Set<Flag>} flags
 * @property {Uint8Array<ArrayBuffer> | null} clean  The cleaned file, or null where cleaning isn't offered (PDF).
 */

/* ---------- ZIP ---------- */

const SIG = { local: 0x04034b50, central: 0x02014b50, end: 0x06054b50 };
/** Bit 0 of the flags: the entry is encrypted. Bit 11: the name is UTF-8. */
const FLAG_ENCRYPTED = 1;
const FLAG_UTF8 = 1 << 11;
/** 1 January 1980, the earliest date a ZIP entry can carry. */
const DOS_DATE_ZERO = 0x0021;
/** Uncompressed property files are a few kilobytes; anything far larger is not one. */
const MAX_PART_BYTES = 64 * 1024 * 1024;

/**
 * @typedef {object} ZipEntry
 * @property {string} name
 * @property {Uint8Array} rawName
 * @property {number} flags
 * @property {number} method  0 = stored, 8 = deflated.
 * @property {number} crc
 * @property {number} size  Uncompressed size.
 * @property {Uint8Array} data  The entry's bytes as stored in the archive.
 */

/**
 * Lists the entries of a ZIP archive.
 * @param {Uint8Array} bytes
 * @returns {ZipEntry[]}
 * @throws {DocumentError} "damaged" for archives that are broken, encrypted or use extensions this reader doesn't handle.
 */
export function readZip(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const damaged = () => new DocumentError('damaged');

  // The directory is at the end, after an optional comment of up to 65,535 bytes.
  let end = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 0xffff); i -= 1) {
    if (view.getUint32(i, true) === SIG.end) {
      end = i;
      break;
    }
  }
  if (end === -1) throw damaged();
  const count = view.getUint16(end + 10, true);
  let at = view.getUint32(end + 16, true);
  // 0xFFFF / 0xFFFFFFFF mean "see the ZIP64 record": archives over 4 GB, not documents.
  if (count === 0xffff || at === 0xffffffff) throw damaged();

  /** @type {ZipEntry[]} */
  const entries = [];
  const decoder = new TextDecoder();
  for (let n = 0; n < count; n += 1) {
    if (at + 46 > bytes.length || view.getUint32(at, true) !== SIG.central) throw damaged();
    const flags = view.getUint16(at + 8, true);
    const compressedSize = view.getUint32(at + 20, true);
    const nameLength = view.getUint16(at + 28, true);
    const local = view.getUint32(at + 42, true);
    if (flags & FLAG_ENCRYPTED) throw damaged();
    if (local + 30 > bytes.length || view.getUint32(local, true) !== SIG.local) throw damaged();
    const dataStart = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
    if (dataStart + compressedSize > bytes.length || at + 46 + nameLength > bytes.length) throw damaged();
    const rawName = bytes.subarray(at + 46, at + 46 + nameLength);
    entries.push({
      name: decoder.decode(rawName),
      rawName,
      flags,
      method: view.getUint16(at + 10, true),
      crc: view.getUint32(at + 16, true),
      size: view.getUint32(at + 24, true),
      data: bytes.subarray(dataStart, dataStart + compressedSize),
    });
    at += 46 + nameLength + view.getUint16(at + 30, true) + view.getUint16(at + 32, true);
  }
  return entries;
}

/**
 * Writes a ZIP archive. Entries keep their bytes and names; dates are reset
 * and every optional field that could carry information is left out.
 * @param {ZipEntry[]} entries
 * @returns {Uint8Array<ArrayBuffer>}
 */
export function writeZip(entries) {
  /** @type {Uint8Array[]} */
  const files = [];
  /** @type {Uint8Array[]} */
  const directory = [];
  let offset = 0;

  for (const entry of entries) {
    // The shared part of both headers: version, flags, method, time, date, checksum, sizes, name length.
    const common = new DataView(new ArrayBuffer(26));
    common.setUint16(0, 20, true);
    common.setUint16(2, entry.flags & FLAG_UTF8, true);
    common.setUint16(4, entry.method, true);
    common.setUint16(6, 0, true);
    common.setUint16(8, DOS_DATE_ZERO, true);
    common.setUint32(10, entry.crc, true);
    common.setUint32(14, entry.data.length, true);
    common.setUint32(18, entry.size, true);
    common.setUint16(22, entry.rawName.length, true);
    common.setUint16(24, 0, true); // no extra field
    const shared = new Uint8Array(common.buffer);

    const local = new Uint8Array(4);
    new DataView(local.buffer).setUint32(0, SIG.local, true);
    files.push(local, shared, entry.rawName, entry.data);

    const central = new DataView(new ArrayBuffer(46));
    central.setUint32(0, SIG.central, true);
    central.setUint16(4, 20, true); // made by: plain ZIP 2.0, no system named
    new Uint8Array(central.buffer).set(shared, 6);
    central.setUint32(42, offset, true); // comment length, disk and attributes stay 0
    directory.push(new Uint8Array(central.buffer), entry.rawName);

    offset += 4 + shared.length + entry.rawName.length + entry.data.length;
  }

  const directorySize = directory.reduce((sum, part) => sum + part.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, SIG.end, true);
  end.setUint16(8, entries.length, true);
  end.setUint16(10, entries.length, true);
  end.setUint32(12, directorySize, true);
  end.setUint32(16, offset, true);
  return concat([...files, ...directory, new Uint8Array(end.buffer)]);
}

/**
 * An entry's contents, decompressed.
 * @param {ZipEntry} entry
 * @returns {Promise<Uint8Array>}
 */
export async function unzip(entry) {
  if (entry.method === 0) return entry.data;
  if (entry.method !== 8) throw new DocumentError('damaged');
  if (typeof DecompressionStream !== 'function') throw new DocumentError('browser');
  if (entry.size > MAX_PART_BYTES) throw new DocumentError('damaged');
  try {
    const stream = new Blob([/** @type {Uint8Array<ArrayBuffer>} */ (entry.data)]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  } catch {
    throw new DocumentError('damaged');
  }
}

/* ---------- Office documents ---------- */

const XML_HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
const VT = 'xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"';
/** Property files with nothing in them, which every Office program accepts. */
const EMPTY_PARTS = {
  'docProps/core.xml': `${XML_HEAD}<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"/>`,
  'docProps/app.xml': `${XML_HEAD}<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" ${VT}/>`,
  'docProps/custom.xml': `${XML_HEAD}<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/custom-properties" ${VT}/>`,
  // Written by Apple's programs (TextEdit, Pages export): names the software.
  'docProps/meta.xml': `${XML_HEAD}<meta xmlns="http://schemas.apple.com/cocoa/2006/metadata"/>`,
};

const OFFICE_KINDS = /** @type {const} */ ([
  ['word/document.xml', 'docx'],
  ['xl/workbook.xml', 'xlsx'],
  ['ppt/presentation.xml', 'pptx'],
]);

/** @param {string} text */
function decodeXml(text) {
  return text
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

/**
 * The text of the first `<tag>…</tag>` in an XML file, or "" if absent or empty.
 * @param {string} xml
 * @param {string} tag  e.g. "dc:creator"
 */
export function xmlText(xml, tag) {
  const match = new RegExp(`<${tag}(?:\\s[^>]*)?>([^<]*)</${tag}>`).exec(xml);
  return match ? decodeXml(match[1]).trim() : '';
}

/** "2026-11-09T14:03:22Z" → "2026-11-09 14:03" @param {string} value */
const shortDate = (value) => value.replace(/^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2}).*$/, '$1 $2');

/**
 * Keeps only the fields that have a value.
 * @param {Record<string, string>} fields
 */
const present = (fields) => Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== ''));

/**
 * @param {Uint8Array} bytes
 * @returns {Promise<DocumentReport>}
 */
async function inspectOffice(bytes) {
  const entries = readZip(bytes);
  const names = new Set(entries.map((entry) => entry.name));
  const kind = OFFICE_KINDS.find(([part]) => names.has(part))?.[1];
  if (!kind || !names.has('[Content_Types].xml')) throw new DocumentError('unsupported');

  const decoder = new TextDecoder();
  /** @param {string} name */
  const read = async (name) => {
    const entry = entries.find((candidate) => candidate.name === name);
    return entry ? decoder.decode(await unzip(entry)) : '';
  };
  const [core, app, custom, meta] = await Promise.all(['core', 'app', 'custom', 'meta'].map((part) => read(`docProps/${part}.xml`)));

  const revision = xmlText(core, 'cp:revision');
  const minutes = xmlText(app, 'TotalTime');
  const fields = present({
    author: xmlText(core, 'dc:creator'),
    lastAuthor: xmlText(core, 'cp:lastModifiedBy'),
    company: xmlText(app, 'Company'),
    manager: xmlText(app, 'Manager'),
    title: xmlText(core, 'dc:title'),
    subject: xmlText(core, 'dc:subject'),
    keywords: xmlText(core, 'cp:keywords'),
    comments: xmlText(core, 'dc:description'),
    created: shortDate(xmlText(core, 'dcterms:created')),
    modified: shortDate(xmlText(core, 'dcterms:modified')),
    printed: shortDate(xmlText(core, 'cp:lastPrinted')),
    // A file saved once and never edited says nothing by these two.
    revision: Number(revision) > 1 ? revision : '',
    editTime: Number(minutes) > 0 ? minutes : '',
    software: [xmlText(app, 'Application'), xmlText(app, 'AppVersion')].filter(Boolean).join(' ') || xmlText(meta, 'generator'),
    template: xmlText(app, 'Template'),
  });

  /** @type {Set<Flag>} */
  const flags = new Set();
  if (/<property[\s>]/.test(custom)) flags.add('custom');
  if ([...names].some((name) => /^(word\/comments[^/]*\.xml|xl\/comments\d*\.xml|ppt\/comments\/.+\.xml)$/.test(name))) flags.add('commentsPart');
  if (kind === 'docx' && /<w:(ins|del|moveFrom|moveTo) /.test(await read('word/document.xml'))) flags.add('tracked');

  const clean = writeZip(
    entries.map((entry) => {
      const empty = EMPTY_PARTS[/** @type {keyof typeof EMPTY_PARTS} */ (entry.name)];
      if (empty === undefined) return entry;
      const data = new TextEncoder().encode(empty);
      return { ...entry, method: 0, crc: crc32(data), size: data.length, data };
    }),
  );
  return { kind, fields, flags, clean };
}

/* ---------- PDF ---------- */

/**
 * The text of a PDF string object: "(…)" with escapes, or "<hex>".
 * Strings starting with the bytes FE FF are UTF-16.
 * @param {string} token
 */
export function pdfString(token) {
  let raw = '';
  if (token.startsWith('<')) {
    const hex = token.slice(1, -1).replace(/\s/g, '');
    for (let i = 0; i + 1 < hex.length; i += 2) raw += String.fromCharCode(Number.parseInt(hex.slice(i, i + 2), 16));
  } else {
    const escapes = { n: '\n', r: '\r', t: '\t', b: '\b', f: '\f' };
    raw = token
      .slice(1, -1)
      .replace(/\\(\r\n|\r|\n)/g, '')
      .replace(/\\([0-7]{1,3})|\\(.)/g, (_, octal, char) =>
        octal ? String.fromCharCode(Number.parseInt(octal, 8) & 0xff) : (escapes[/** @type {keyof typeof escapes} */ (char)] ?? char),
      );
  }
  if (raw.startsWith('þÿ')) {
    let text = '';
    for (let i = 2; i + 1 < raw.length; i += 2) text += String.fromCharCode((raw.charCodeAt(i) << 8) | raw.charCodeAt(i + 1));
    return text.trim();
  }
  return raw.trim();
}

/** "D:20261109140322+04'00'" → "2026-11-09 14:03" @param {string} value */
const pdfDate = (value) => value.replace(/^D:(\d{4})(\d{2})(\d{2})(?:(\d{2})(\d{2}))?.*$/, (_, y, m, d, h, min) => `${y}-${m}-${d}${h ? ` ${h}:${min}` : ''}`);

/** Info dictionary keys → report rows. */
const PDF_KEYS = { Author: 'author', Title: 'title', Subject: 'subject', Keywords: 'keywords', Creator: 'software', Producer: 'producer', CreationDate: 'created', ModDate: 'modified' };

/**
 * @param {Uint8Array} bytes
 * @returns {DocumentReport}
 */
function inspectPdf(bytes) {
  // One character per byte, so offsets and binary streams survive.
  const text = new TextDecoder('latin1').decode(bytes);
  // In an encrypted PDF the strings are scrambled; showing them would be noise.
  if (/\/Encrypt\s/.test(text)) throw new DocumentError('damaged');

  // The properties live in the object the trailer calls /Info. If it can't be
  // found (it may sit in a compressed part), fall back to the whole file.
  const reference = /\/Info\s+(\d+)\s+(\d+)\s+R/.exec(text);
  const object = reference ? new RegExp(`(?:^|[\\r\\n\\s])${reference[1]}\\s+${reference[2]}\\s+obj([\\s\\S]*?)endobj`).exec(text)?.[1] : undefined;
  const source = object ?? text;

  /** @type {Record<string, string>} */
  const fields = {};
  for (const [key, row] of Object.entries(PDF_KEYS)) {
    const match = new RegExp(`/${key}\\s*(\\((?:\\\\[\\s\\S]|[^\\\\)])*\\)|<[0-9A-Fa-f\\s]*>)`).exec(source);
    const value = match ? pdfString(match[1]) : '';
    if (value) fields[row] = row === 'created' || row === 'modified' ? pdfDate(value) : value;
  }

  /** @type {Set<Flag>} */
  const flags = new Set();
  const xmp = /<x:xmpmeta[\s\S]*?<\/x:xmpmeta>/.exec(text)?.[0];
  if (xmp) {
    flags.add('xmp');
    const creator = /<dc:creator>[\s\S]*?<rdf:li[^>]*>([^<]*)<\/rdf:li>/.exec(xmp)?.[1];
    fields.author ??= creator ? decodeXml(creator).trim() : '';
    fields.software ??= xmlText(xmp, 'xmp:CreatorTool');
    fields.producer ??= xmlText(xmp, 'pdf:Producer');
  }
  return { kind: 'pdf', fields: present(fields), flags, clean: null };
}

/** True when the report has anything to show. @param {DocumentReport} report */
export const hasFindings = ({ fields, flags }) => Object.keys(fields).length > 0 || flags.size > 0;

/**
 * Reads a document: what it says about its author, and (for Office files) the same document without it.
 * @param {Uint8Array} bytes
 * @returns {Promise<DocumentReport>}
 * @throws {DocumentError}
 */
export async function inspectDocument(bytes) {
  if (startsWith(bytes, 0, 'PK\x03\x04')) return inspectOffice(bytes);
  // "%PDF-" may follow a few bytes of junk at the start of the file.
  if (new TextDecoder('latin1').decode(bytes.subarray(0, 1024)).includes('%PDF-')) return inspectPdf(bytes);
  // The container of .doc, .xls and .ppt before 2007.
  if (startsWith(bytes, 0, '\xd0\xcf\x11\xe0')) throw new DocumentError('old');
  throw new DocumentError('unsupported');
}

/* ---------- Page wiring ---------- */

const MAX_BYTES = 40 * 1024 * 1024;
const MIME = {
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
};

/**
 * "Report final.docx" → "Report final-clean.docx"
 * @param {string} name
 * @param {string} extension
 */
export function cleanName(name, extension) {
  const base = name.replace(/\.[^.]*$/, '') || 'document';
  return `${base}-clean.${extension}`;
}

/** @param {HTMLElement} root */
export function init(root) {
  /** @template {Element} T @param {string} name @returns {T} */
  const find = (name) => /** @type {T} */ (root.querySelector(`[data-js="${name}"]`));
  const file = /** @type {HTMLInputElement} */ (find('document-file'));
  const message = /** @type {HTMLElement} */ (find('document-message'));
  const facts = /** @type {HTMLElement} */ (find('document-facts'));
  const save = /** @type {HTMLElement} */ (find('document-save'));
  const download = /** @type {HTMLAnchorElement} */ (find('document-download'));
  const pdfNote = /** @type {HTMLElement} */ (find('document-pdf'));
  const keptNote = /** @type {HTMLElement} */ (find('document-kept'));
  const rows = /** @type {HTMLElement[]} */ ([...facts.querySelectorAll('[data-row]')]);
  let objectUrl = '';

  /** @param {string} key  A data-* message on the status line. */
  const fail = (key) => {
    message.textContent = message.dataset[key] ?? '';
    for (const element of [facts, save, pdfNote, keptNote]) element.hidden = true;
  };

  /** @param {File | undefined} chosen */
  const open = async (chosen) => {
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    objectUrl = '';
    if (!chosen) return fail('');
    if (chosen.size > MAX_BYTES) return fail('tooLarge');

    let report;
    try {
      report = await inspectDocument(new Uint8Array(await chosen.arrayBuffer()));
    } catch (error) {
      if (!(error instanceof DocumentError)) console.error('[lockwell] Could not read the chosen document.', error);
      return fail(error instanceof DocumentError ? error.code : 'damaged');
    }
    if (!hasFindings(report)) return fail('none');

    message.textContent = message.dataset.found ?? '';
    for (const row of rows) {
      const name = row.dataset.row ?? '';
      const value = report.fields[name];
      row.hidden = value === undefined && !report.flags.has(/** @type {Flag} */ (name));
      const cell = row.querySelector('dd');
      if (cell && value !== undefined) cell.textContent = value;
    }
    facts.hidden = false;
    pdfNote.hidden = report.kind !== 'pdf';
    keptNote.hidden = report.kind === 'pdf' || !(report.flags.has('tracked') || report.flags.has('commentsPart'));

    save.hidden = report.clean === null;
    if (report.clean && report.kind !== 'pdf') {
      objectUrl = URL.createObjectURL(new Blob([report.clean], { type: MIME[report.kind] }));
      download.href = objectUrl;
      download.download = cleanName(chosen.name, report.kind);
    }
  };

  file.addEventListener('change', () => open(file.files?.[0]));
  receiveFiles(root, open);
}

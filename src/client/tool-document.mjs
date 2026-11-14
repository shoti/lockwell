// @ts-check
/**
 * @file Tool "Document metadata": shows and clears metadata in Office files and checks PDFs.
 */
/**
 * Document metadata: shows what a Word, Excel, PowerPoint, OpenDocument or
 * PDF file says about who made it, and saves a cleaned copy of the Office and
 * OpenDocument formats.
 *
 * Every finding has a status: removed in the clean copy, found but left in
 * (with how to remove it by hand), or not checked. A file the tool can't read
 * is never reported as having nothing in it, and neither is a part of a file
 * the tool doesn't know: such parts are listed by name as not checked.
 *
 * Office and OpenDocument files are ZIP archives. Cleaning writes a new
 * archive: property files emptied, author names on comments and changes
 * replaced with "Author", their dates removed, paths, printer names, document
 * IDs and editing-session IDs blanked, signatures, custom XML, co-authoring
 * records and the preview picture removed, and the metadata of embedded
 * photos removed; every other part is copied as it is, compressed bytes and
 * all. Part names are compared without regard to case and parts are read in
 * the encoding they declare; XML is matched by local name, whatever the
 * prefix, with either kind of quotes.
 *
 * The clean copy is checked twice before it is offered: read again by the same
 * code, and searched, byte by byte and independently of that code, for every
 * name, account, path and ID the first reading found (as UTF-8, UTF-16 and XML
 * character references). Only the document's own text may still contain them:
 * a name typed in a letter is content, not metadata.
 *
 * PDFs are only read: removing data from a PDF reliably means rewriting it,
 * which a small tool can't do safely.
 * Sources: docs/research/tool-document-metadata.md.
 *
 * The file never leaves the browser.
 */
import { receiveFiles } from './files.mjs';
import { ascii, byteString, crc32, startsWith } from './bytes.mjs';
import { fillInto, fillText } from './fill.mjs';
import { hasFindings as photoHasFindings, inspectPhoto } from './tool-photo.mjs';
import { initSave } from './save.mjs';
import { pdfNames, pdfObjects, pdfString, streamData, stringToken } from './pdf.mjs';
import { FLAG_UTF8, ZipError, cleanArchive, readZip as readZipEntries, unzip as unzipEntry, writeZip } from './zip.mjs';

export { pdfNames, pdfString, writeZip };

/**
 * A file this tool can't process; `code` picks the message shown.
 * "zip64": an archive in the ZIP64 format, which this reader doesn't handle.
 */
export class DocumentError extends Error {
  /** @param {'unsupported' | 'old' | 'locked' | 'encrypted' | 'damaged' | 'zip64' | 'browser'} code */
  constructor(code) {
    super(`Document can't be processed: ${code}`);
    this.name = 'DocumentError';
    this.code = code;
  }
}

/**
 * @typedef {'removed' | 'kept' | 'unchecked'} Status  What the clean copy does about a finding.
 * @typedef {{ key: string, status: Status, values: string[] }} Finding
 *
 * @typedef {object} DocumentReport
 * @property {'docx' | 'xlsx' | 'pptx' | 'odt' | 'ods' | 'odp' | 'pdf'} kind
 * @property {string} extension  The file's own extension, which the clean copy keeps ("docm", "ppsx", "ott").
 * @property {string} mime
 * @property {Record<string, string>} fields  Property name → value, only for values that are present.
 * @property {Finding[]} findings
 * @property {Uint8Array<ArrayBuffer> | null} clean  The cleaned file, or null where cleaning isn't offered (PDF) or failed its check.
 * @property {boolean} verified  The clean copy was read again and searched, and nothing that was meant to go was found.
 */

/* ---------- ZIP ---------- */

/** Uncompressed property files are a few kilobytes; anything far larger is not one. */
const MAX_PART_BYTES = 64 * 1024 * 1024;

/** @typedef {import('./zip.mjs').ZipEntry} ZipEntry */

/** The archive reader's errors, as this tool's. @param {unknown} error */
const asDocumentError = (error) => (error instanceof ZipError ? new DocumentError(error.code) : error);

/**
 * Lists the entries of a ZIP archive (zip.mjs).
 * @param {Uint8Array} bytes
 * @returns {ZipEntry[]}
 * @throws {DocumentError} "damaged" for broken archives and archives with two entries of the same name (in any case),
 *   "locked" for encrypted entries, "zip64" for the ZIP64 format.
 */
export function readZip(bytes) {
  try {
    return readZipEntries(bytes);
  } catch (error) {
    throw asDocumentError(error);
  }
}

/**
 * An entry's contents, decompressed, at most MAX_PART_BYTES (zip.mjs).
 * @param {ZipEntry} entry
 * @returns {Promise<Uint8Array>}
 */
export async function unzip(entry) {
  try {
    return await unzipEntry(entry, MAX_PART_BYTES);
  } catch (error) {
    throw asDocumentError(error);
  }
}

/**
 * Compresses a changed part for the clean copy.
 * @param {Uint8Array} data
 * @returns {Promise<Uint8Array | null>}  null where the browser can't.
 */
async function deflate(data) {
  if (typeof CompressionStream !== 'function') return null;
  try {
    const stream = new Blob([/** @type {Uint8Array<ArrayBuffer>} */ (data)]).stream().pipeThrough(new CompressionStream('deflate-raw'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  } catch {
    return null;
  }
}

/* ---------- XML helpers ---------- */

const XML_HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
/** The name that replaces authors' names on comments and changes. */
const PLACEHOLDER = 'Author';
/** The date that replaces dates the schema requires (where it allows none, the date is removed). */
const PLACEHOLDER_DATE = '1980-01-01T00:00:00Z';
/** Any namespace prefix, or none: elements and attributes are matched by local name. */
const NS = String.raw`(?:[\w.-]+:)?`;
/** The end of an element's name: "annotation" is not "annotation-end". */
const END = String.raw`(?=[\s/>])`;
/** An attribute's value in either kind of quotes: group 1 or 2. */
const VALUE = `(?:"([^"]*)"|'([^']*)')`;

/** @param {string} text */
const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** @param {string} text */
function decodeXml(text) {
  return text
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => safeCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, code) => safeCodePoint(Number(code)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

/** @param {number} code */
const safeCodePoint = (code) => (code <= 0x10ffff ? String.fromCodePoint(code) : '');

/** @param {string} text */
const encodeXml = (text) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** @param {string} local  A local name, or several as "a|b". */
const attributePattern = (local) => new RegExp(String.raw`(\s${NS}(?:${local})\s*=\s*)(?:"[^"]*"|'[^']*')`, 'g');
/** Start tags of an element. @param {string} element  A local name, or several as "a|b". */
const tagPattern = (element) => new RegExp(String.raw`<${NS}(?:${element})${END}[^>]*>`, 'g');
/** An element holding only text: groups 1 start tag, 3 text, 4 end tag. @param {string} local */
const elementPattern = (local) => new RegExp(String.raw`(<(${NS}${local})(?:\s[^>]*)?>)([^<]*)(</\2\s*>)`, 'g');

/** @param {string[]} values */
const unique = (values) => [...new Set(values.filter((value) => value !== '' && value !== PLACEHOLDER && value !== PLACEHOLDER_DATE))];

/**
 * The text of the first element of this name in an XML file, or "" if absent or empty.
 * @param {string} xml
 * @param {string} tag  e.g. "dc:creator"; only the local name counts.
 */
export function xmlText(xml, tag) {
  const match = elementPattern(tag.replace(/^.*:/, '')).exec(xml);
  return match ? decodeXml(match[3]).trim() : '';
}

/** Every element's text of this local name, decoded, without repeats. @param {string} xml @param {string} local */
const elementTexts = (xml, local) => unique([...xml.matchAll(elementPattern(local))].map((match) => decodeXml(match[3]).trim()));

/** @param {string} xml @param {string} local @param {string} value */
const setElementText = (xml, local, value) => xml.replace(elementPattern(local), (_, open, _name, _text, close) => `${open}${value}${close}`);

/**
 * Every value of an attribute, decoded, without repeats or placeholders.
 * @param {string} xml
 * @param {string} local  e.g. "author"
 * @param {string} [element]  Only on this element (local names, "a|b").
 */
function attributeValues(xml, local, element) {
  const tags = element ? xml.match(tagPattern(element)) ?? [] : [xml];
  const pattern = new RegExp(String.raw`\s${NS}(?:${local})\s*=\s*${VALUE}`, 'g');
  return unique(tags.flatMap((tag) => [...tag.matchAll(pattern)].map((match) => decodeXml(match[1] ?? match[2] ?? '').trim())));
}

/**
 * Changes start tags: all of them, or those of one element.
 * @param {string} xml @param {string | undefined} element @param {(tag: string) => string} change
 */
const onTags = (xml, element, change) => (element ? xml.replace(tagPattern(element), change) : change(xml));

/** @param {string} xml @param {string} local @param {string} value @param {string} [element] */
const setAttribute = (xml, local, value, element) => onTags(xml, element, (tag) => tag.replace(attributePattern(local), (_, head) => `${head}"${value}"`));

/** @param {string} xml @param {string} local @param {string} [element] */
const removeAttribute = (xml, local, element) => onTags(xml, element, (tag) => tag.replace(attributePattern(local), ''));

/** Removes an element, empty or with content. @param {string} xml @param {string} local */
const removeElement = (xml, local) => xml.replace(new RegExp(String.raw`<(${NS}(?:${local}))${END}[^>]*/>|<(${NS}(?:${local}))${END}[^>]*>[\s\S]*?</\2\s*>`, 'g'), '');

/** True when an attribute of this name has a value other than the placeholders. @param {string} xml @param {string} local @param {string} [element] */
const hasAttribute = (xml, local, element) => attributeValues(xml, local, element).length > 0;

/**
 * The text of an XML part in the encoding it uses: a byte order mark, UTF-16 without one, or the declaration.
 * @param {Uint8Array} bytes
 * @returns {{ text: string, encoding: string }}
 */
export function decodePart(bytes) {
  const [first, second] = bytes;
  let label = 'utf-8';
  if ((first === 0xff && second === 0xfe) || (first === 0x3c && second === 0)) label = 'utf-16le';
  else if ((first === 0xfe && second === 0xff) || (first === 0 && second === 0x3c)) label = 'utf-16be';
  else if (!(first === 0xef && second === 0xbb)) {
    const declared = /^\s*<\?xml[^>]*?\sencoding\s*=\s*["']([\w.:-]+)["']/.exec(byteString(bytes.subarray(0, 256)))?.[1]?.toLowerCase() ?? 'utf-8';
    // A UTF-16 declaration on single-byte text is wrong; the bytes win.
    if (!declared.startsWith('utf-16')) label = declared;
  }
  try {
    const decoder = new TextDecoder(label);
    return { text: decoder.decode(bytes), encoding: decoder.encoding };
  } catch {
    // An encoding the browser doesn't know: unreadable, which is not the same as empty.
    throw new DocumentError('damaged');
  }
}

/** True when a part holds XML, in whatever encoding. @param {Uint8Array} bytes */
function isXml(bytes) {
  const head = bytes.subarray(0, 8);
  if ((head[0] === 0xff && head[1] === 0xfe) || (head[0] === 0xfe && head[1] === 0xff) || (head[0] === 0x3c && head[1] === 0) || (head[0] === 0 && head[1] === 0x3c)) return true;
  return /^(\xef\xbb\xbf)?\s*</.test(byteString(head));
}

/**
 * Keeps only the fields that have a value.
 * @param {Record<string, string>} fields
 */
const present = (fields) => Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== ''));

/** "2026-11-09T14:03:22Z" → "2026-11-09 14:03" @param {string} value */
const shortDate = (value) => value.replace(/^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2}).*$/, '$1 $2');

/** Collects findings, one per key. */
class Findings {
  constructor() {
    /** @type {Finding[]} */
    this.list = [];
  }

  /**
   * @param {string} key
   * @param {Status} status
   * @param {string[]} [values]
   */
  add(key, status, values = []) {
    if (!this.list.some((item) => item.key === key)) this.list.push({ key, status, values });
  }

  /**
   * Adds the finding only when there are values.
   * @param {string} key @param {Status} status @param {string[]} values
   */
  addValues(key, status, values) {
    if (values.length) this.add(key, status, values);
  }
}

/* ---------- Office Open XML and OpenDocument ---------- */

const VT = 'xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"';
/** Property parts with nothing in them, which every Office program accepts. */
const EMPTY = {
  core: `${XML_HEAD}<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"/>`,
  app: `${XML_HEAD}<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" ${VT}/>`,
  custom: `${XML_HEAD}<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/custom-properties" ${VT}/>`,
  // Written by Apple's programs (TextEdit, Pages export): names the software.
  apple: `${XML_HEAD}<meta xmlns="http://schemas.apple.com/cocoa/2006/metadata"/>`,
};

/**
 * Where each property part is: named by a relationship of the package (the Open XML SDK writes the core properties
 * as "package/services/metadata/core-properties/<id>.psmdcp"), or at the usual place.
 */
const PROPERTY_PARTS = /** @type {const} */ ([
  ['core', /\/metadata\/core-properties$/i, 'docProps/core.xml'],
  ['app', /\/(extended-properties|extendedProperties)$/i, 'docProps/app.xml'],
  ['custom', /\/(custom-properties|customProperties)$/i, 'docProps/custom.xml'],
]);

const OFFICE_KINDS = /** @type {const} */ ([
  ['word/document.xml', 'docx'],
  ['xl/workbook.xml', 'xlsx'],
  ['ppt/presentation.xml', 'pptx'],
]);
/** The main part's content type → the file's own extension (macro-enabled files, templates, slide shows). */
const OFFICE_EXTENSIONS = {
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml': 'docx',
  'application/vnd.ms-word.document.macroenabled.main+xml': 'docm',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.template.main+xml': 'dotx',
  'application/vnd.ms-word.template.macroenabledtemplate.main+xml': 'dotm',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml': 'xlsx',
  'application/vnd.ms-excel.sheet.macroenabled.main+xml': 'xlsm',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.template.main+xml': 'xltx',
  'application/vnd.ms-excel.template.macroenabled.main+xml': 'xltm',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml': 'pptx',
  'application/vnd.ms-powerpoint.presentation.macroenabled.main+xml': 'pptm',
  'application/vnd.openxmlformats-officedocument.presentationml.slideshow.main+xml': 'ppsx',
  'application/vnd.ms-powerpoint.slideshow.macroenabled.main+xml': 'ppsm',
  'application/vnd.openxmlformats-officedocument.presentationml.template.main+xml': 'potx',
  'application/vnd.ms-powerpoint.template.macroenabled.main+xml': 'potm',
};
/** OpenDocument "mimetype" → kind and extension. */
const ODF_KINDS = /** @type {Record<string, ['odt' | 'ods' | 'odp', string]>} */ ({
  'application/vnd.oasis.opendocument.text': ['odt', 'odt'],
  'application/vnd.oasis.opendocument.spreadsheet': ['ods', 'ods'],
  'application/vnd.oasis.opendocument.presentation': ['odp', 'odp'],
  'application/vnd.oasis.opendocument.text-template': ['odt', 'ott'],
  'application/vnd.oasis.opendocument.spreadsheet-template': ['ods', 'ots'],
  'application/vnd.oasis.opendocument.presentation-template': ['odp', 'otp'],
});

/** Pictures the photo tool can clean, and those that may carry metadata it can't read. */
const CLEANABLE_PICTURE = /\.(jpe?g|png|webp)$/i;
const OTHER_PICTURE = /\.(tiff?|heic|heif|avif|jxr|wdp)$/i;
/** Relationship types that are part of the content, not of who made it: links in the text. */
const CONTENT_LINK = /\/hyperlink$/i;
/** A link to a file on someone's computer or network: "file:", a network share, a drive letter, a home folder. */
const LOCAL_PATH = /^(file:|\\\\|[a-z]:[\\/])|[\\/]Users[\\/]/i;

/**
 * An archive being read and rewritten: the text of its parts, and the changes the clean copy makes.
 * Part names are compared without regard to case, as the formats require.
 */
class Package {
  /** @param {ZipEntry[]} entries */
  constructor(entries) {
    this.entries = entries;
    /** @type {Map<string, ZipEntry>} */
    this.byName = new Map(entries.map((entry) => [entry.name.toLowerCase(), entry]));
    /** @type {Map<string, Promise<{ text: string, encoding: string }>>} */
    this.cache = new Map();
    /** @type {Map<string, Uint8Array | null>} New contents of parts, by their name in the archive; null drops the part. */
    this.changes = new Map();
    /** Parts the tool knows and has inspected, by lower-case name (besides those matched by a known pattern). */
    this.known = new Set();
  }

  /** @param {string} name */
  entry(name) {
    return this.byName.get(name.toLowerCase());
  }

  /** @param {string} name */
  has(name) {
    return this.byName.has(name.toLowerCase());
  }

  /** The names of parts that match, compared without regard to case. @param {RegExp} pattern */
  matching(pattern) {
    const insensitive = new RegExp(pattern.source, `${pattern.flags.replace(/[gi]/g, '')}i`);
    return this.entries.map((entry) => entry.name).filter((name) => insensitive.test(name));
  }

  /** @param {string} name */
  decoded(name) {
    const entry = this.entry(name);
    if (!entry) return Promise.resolve({ text: '', encoding: 'utf-8' });
    let cached = this.cache.get(entry.name);
    if (!cached) {
      cached = unzip(entry).then(decodePart);
      this.cache.set(entry.name, cached);
    }
    return cached;
  }

  /** The text of a part, or "" if there is none. @param {string} name */
  async text(name) {
    return (await this.decoded(name)).text;
  }

  /**
   * Changes a part's text for the clean copy (starting from earlier changes). A changed part is written as UTF-8.
   * @param {string} name
   * @param {(xml: string) => string} change
   */
  async edit(name, change) {
    const entry = this.entry(name);
    if (!entry) return;
    const current = this.changes.get(entry.name);
    if (current === null) return;
    const original = await this.decoded(entry.name);
    const xml = current ? new TextDecoder().decode(current) : original.text;
    let next = change(xml);
    if (next === xml) return;
    if (!current && original.encoding !== 'utf-8') next = next.replace(/^(\s*<\?xml[^>]*?\sencoding\s*=\s*)["'][^"']*["']/, '$1"UTF-8"');
    this.changes.set(entry.name, new TextEncoder().encode(next));
  }

  /** @param {string} name @param {string | Uint8Array} content */
  replace(name, content) {
    const entry = this.entry(name);
    if (entry) this.changes.set(entry.name, typeof content === 'string' ? new TextEncoder().encode(content) : content);
  }

  /** @param {string} name */
  drop(name) {
    const entry = this.entry(name);
    if (entry) this.changes.set(entry.name, null);
  }

  /** @param {string[]} names */
  know(...names) {
    for (const name of names) this.known.add(name.toLowerCase());
  }

  /** The clean archive: changed parts compressed again, the rest copied byte for byte. */
  async write() {
    /** @type {ZipEntry[]} */
    const out = [];
    for (const entry of this.entries) {
      if (!this.changes.has(entry.name)) {
        out.push(entry);
        continue;
      }
      const data = this.changes.get(entry.name);
      if (!data) continue;
      const packed = await deflate(data);
      out.push(packed && packed.length < data.length ? { ...entry, method: 8, crc: crc32(data), size: data.length, data: packed } : { ...entry, method: 0, crc: crc32(data), size: data.length, data });
    }
    return writeZip(out);
  }
}

/**
 * Where a relationship points, as a part name ("word/settings.xml" + "../media/a.png" → "word/media/a.png").
 * @param {string} relsName  e.g. "word/_rels/settings.xml.rels"
 * @param {string} target
 */
function resolveTarget(relsName, target) {
  let path = target;
  try {
    path = decodeURIComponent(target);
  } catch {
    // Not percent-encoded: use it as written.
  }
  if (path.startsWith('/')) return path.slice(1);
  const base = relsName.replace(/_rels\/[^/]*$/, '').split('/').filter(Boolean);
  for (const part of path.split('/')) {
    if (part === '..') base.pop();
    else if (part !== '.') base.push(part);
  }
  return base.join('/');
}

/**
 * @typedef {object} Relationship
 * @property {string} rels  The relationships part it is in.
 * @property {string} id
 * @property {string} type
 * @property {string} target
 * @property {string} part  The target as a part name ("" for external targets).
 * @property {boolean} external
 * @property {string} xml
 */

/**
 * The relationships of an archive.
 * @param {Package} pack
 * @returns {Promise<Relationship[]>}
 */
async function relationships(pack) {
  /** @type {Relationship[]} */
  const out = [];
  for (const rels of pack.matching(/(^|\/)_rels\/[^/]*\.rels$/)) {
    for (const [xml] of (await pack.text(rels)).matchAll(tagPattern('Relationship'))) {
      const attribute = (/** @type {string} */ name) => attributeValues(xml, name)[0] ?? '';
      const external = /^external$/i.test(attribute('TargetMode'));
      const target = attribute('Target');
      out.push({ rels, id: attribute('Id'), type: attribute('Type'), target, part: external ? '' : resolveTarget(rels, target), external, xml });
    }
  }
  return out;
}

/**
 * Removes a part from the clean copy, with its own relationships and the relationships and content-type entry that name it.
 * @param {Package} pack
 * @param {string} name
 */
async function dropPart(pack, name) {
  const actual = pack.entry(name)?.name;
  if (!actual) return;
  pack.drop(actual);
  pack.know(actual);
  const own = actual.replace(/([^/]*)$/, '_rels/$1.rels');
  if (pack.has(own)) pack.drop(own);
  for (const rel of await relationships(pack)) {
    if (!rel.external && rel.part.toLowerCase() === actual.toLowerCase()) await pack.edit(rel.rels, (xml) => xml.replace(rel.xml, ''));
  }
  await pack.edit('[Content_Types].xml', (xml) => xml.replace(new RegExp(String.raw`<${NS}Override${END}[^>]*\sPartName\s*=\s*["']/${escapeRegExp(actual)}["'][^>]*>`, 'gi'), ''));
}

/**
 * Removes a part from an OpenDocument clean copy, with its manifest entry.
 * @param {Package} pack
 * @param {string} name
 */
async function dropOdfPart(pack, name) {
  pack.drop(name);
  pack.know(name);
  await pack.edit('META-INF/manifest.xml', (xml) =>
    xml.replace(new RegExp(String.raw`<(${NS}file-entry)${END}[^>]*\s${NS}full-path\s*=\s*["']${escapeRegExp(name)}["'][^>]*?(?:/>|>[\s\S]*?</\1\s*>)`, 'g'), ''),
  );
}

/** The printer's name at the start of a DEVMODE: up to 32 UTF-16 characters. @param {Uint8Array} bytes */
function printerName(bytes) {
  if (bytes.length < 64) return '';
  const name = new TextDecoder('utf-16le').decode(bytes.subarray(0, 64)).replace(/\0[\s\S]*$/, '');
  return /^[\p{L}\p{N}\p{P}\p{Zs}]+$/u.test(name) ? name.trim() : '';
}

/**
 * Pictures inside the document: those whose metadata the clean copy removes, and those the tool can't read.
 * @param {Package} pack
 * @param {Findings} findings
 * @param {RegExp} folder
 */
async function pictures(pack, findings, folder) {
  let cleaned = 0;
  /** @type {string[]} */
  const unread = [];
  for (const name of pack.matching(folder)) {
    pack.know(name);
    if (OTHER_PICTURE.test(name)) unread.push(name);
    if (!CLEANABLE_PICTURE.test(name)) continue;
    const entry = /** @type {ZipEntry} */ (pack.entry(name));
    try {
      const report = await inspectPhoto(/** @type {Uint8Array<ArrayBuffer>} */ (await unzip(entry)));
      if (!photoHasFindings(report.findings)) continue;
      // A picture whose clean copy failed its check is reported as not checked, not left as it was in silence.
      if (!report.clean) {
        unread.push(name);
        continue;
      }
      cleaned += 1;
      pack.replace(name, report.clean);
    } catch {
      unread.push(name);
    }
  }
  if (cleaned) findings.add('media', 'removed', [String(cleaned)]);
  findings.addValues('mediaUnchecked', 'unchecked', unread);
}

/**
 * "CN=Nino Beridze, O=…" → "Nino Beridze" for each signer a signature names (the certificate's subject; the issuer
 * when no subject is written out, as for a certificate a person made for themselves).
 * @param {string} xml
 */
function signers(xml) {
  const subjects = elementTexts(xml, 'X509SubjectName');
  return unique((subjects.length ? subjects : elementTexts(xml, 'X509IssuerName')).map((name) => /CN=([^,]+)/.exec(name)?.[1]?.trim() ?? name));
}

/**
 * What every Office or OpenDocument file is checked for, whatever program made it: what was found in the archive,
 * shared by the readers.
 * @typedef {object} Collected
 * @property {string[]} people  Names and accounts of people, replaced with "Author".
 * @property {string[]} external  Paths and links to other files, left in.
 * @property {boolean} dates  Dates on comments and changes, removed.
 */

/**
 * The property parts of an Office file, by the relationships of the package and their usual names.
 * @param {Package} pack
 * @param {Relationship[]} rels
 */
function propertyParts(pack, rels) {
  const root = rels.filter((rel) => /^_rels\/\.rels$/i.test(rel.rels) && !rel.external);
  return PROPERTY_PARTS.map(([kind, type, usual]) => {
    const names = [...root.filter((rel) => type.test(rel.type)).map((rel) => pack.entry(rel.part)?.name ?? ''), pack.entry(usual)?.name ?? ''];
    if (kind === 'core') names.push(...pack.matching(/\.psmdcp$/));
    return /** @type {const} */ ([kind, [...new Set(names.filter(Boolean))]]);
  });
}

/**
 * The properties of an Office file, emptied in the clean copy.
 * @param {Package} pack
 * @param {Relationship[]} rels
 * @param {Findings} findings
 */
async function officeProperties(pack, rels, findings) {
  /** @type {Record<string, string>} */
  const text = { core: '', app: '', custom: '' };
  for (const [kind, names] of propertyParts(pack, rels)) {
    for (const name of names) {
      text[kind] += await pack.text(name);
      pack.replace(name, EMPTY[kind]);
      pack.know(name);
    }
  }
  const apple = pack.entry('docProps/meta.xml')?.name;
  const meta = apple ? await pack.text(apple) : '';
  if (apple) {
    pack.replace(apple, EMPTY.apple);
    pack.know(apple);
  }
  const { core, app, custom } = text;
  const revision = xmlText(core, 'revision');
  const minutes = xmlText(app, 'TotalTime');
  if (tagPattern('property').test(custom)) findings.add('custom', 'removed');
  return present({
    author: xmlText(core, 'creator'),
    lastAuthor: xmlText(core, 'lastModifiedBy'),
    company: xmlText(app, 'Company'),
    manager: xmlText(app, 'Manager'),
    title: xmlText(core, 'title'),
    subject: xmlText(core, 'subject'),
    keywords: xmlText(core, 'keywords'),
    comments: xmlText(core, 'description'),
    created: shortDate(xmlText(core, 'created')),
    modified: shortDate(xmlText(core, 'modified')),
    printed: shortDate(xmlText(core, 'lastPrinted')),
    // A file saved once and never edited says nothing by these two.
    revision: Number(revision) > 1 ? revision : '',
    editTime: Number(minutes) > 0 ? minutes : '',
    software: [xmlText(app, 'Application'), xmlText(app, 'AppVersion')].filter(Boolean).join(' ') || xmlText(meta, 'generator'),
    template: xmlText(app, 'Template'),
  });
}

/** Word elements that record a change, and carry its author and date. */
const WORD_CHANGES = 'ins|del|moveFrom|moveTo|rPrChange|pPrChange|sectPrChange|tblPrChange|trPrChange|tcPrChange|tblGridChange|numberingChange|cellIns|cellDel|cellMerge|customXmlInsRangeStart|customXmlDelRangeStart|customXmlMoveFromRangeStart|customXmlMoveToRangeStart|moveFromRangeStart|moveToRangeStart';

/**
 * Word: people, comments and changes in every part (the glossary of building blocks too), editing sessions, dates,
 * document IDs, the template and the mail merge source.
 * @param {Package} pack
 * @param {Relationship[]} rels
 * @param {Findings} findings
 * @param {Collected} found
 */
async function readWord(pack, rels, findings, found) {
  /** @type {string[]} */
  const commenters = [];
  /** @type {string[]} */
  const editors = [];
  /** @type {string[]} */
  const ids = [];
  /** @type {string[]} */
  const merge = [];
  let tracked = false;
  let rsid = false;
  let comments = false;
  for (const name of pack.matching(/^word\/.+\.xml$/)) {
    const xml = await pack.text(name);
    if (/^word\/comments[^/]*\.xml$/i.test(name)) {
      commenters.push(...attributeValues(xml, 'author', 'comment'));
      if (tagPattern('comment').test(xml)) comments = true;
    } else {
      editors.push(...attributeValues(xml, 'author', WORD_CHANGES));
      if (tagPattern('ins|del|moveFrom|moveTo').test(xml)) tracked = true;
    }
    if (/^word\/people\.xml$/i.test(name)) found.people.push(...attributeValues(xml, 'author', 'person'), ...attributeValues(xml, 'userId'));
    if (new RegExp(String.raw`\s${NS}rsid\w*\s*=|<${NS}rsids\b`).test(xml)) rsid = true;
    if (hasAttribute(xml, 'date|dateUtc')) found.dates = true;
    ids.push(...attributeValues(xml, 'val', 'docId'));
    for (const [block] of xml.matchAll(new RegExp(String.raw`<(${NS}mailMerge)${END}[\s\S]*?</\1\s*>`, 'g'))) merge.push(...attributeValues(block, 'val', 'query|connectString|udl'));
    await pack.edit(name, (text) => {
      let out = setAttribute(text, 'author', PLACEHOLDER);
      out = setAttribute(out, 'initials', 'A');
      out = removeAttribute(out, String.raw`rsid\w*`);
      out = removeElement(out, 'rsids');
      // Dates on comments and changes are optional: removed, not replaced.
      out = removeAttribute(out, 'date|dateUtc');
      out = removeElement(out, 'docId');
      return removeElement(out, 'presenceInfo');
    });
  }
  findings.addValues('commentAuthors', 'removed', unique(commenters));
  findings.addValues('revisionAuthors', 'removed', unique(editors));
  findings.addValues('documentIds', 'removed', unique(ids));
  if (rsid) findings.add('rsid', 'removed');
  if (tracked) findings.add('tracked', 'kept');
  if (comments) findings.add('commentsPart', 'kept');

  // The template the document was based on, by its path on the author's computer.
  for (const rel of rels.filter((item) => /\/attachedTemplate$/i.test(item.type))) {
    findings.addValues('template', 'removed', [rel.target]);
    await pack.edit(rel.rels, (xml) => xml.replace(rel.xml, ''));
    const source = rel.rels.replace(/_rels\/([^/]*)\.rels$/, '$1');
    await pack.edit(source, (xml) => xml.replace(new RegExp(String.raw`<${NS}attachedTemplate${END}[^>]*\s${NS}id\s*=\s*["']${escapeRegExp(rel.id)}["'][^>]*/>`), ''));
  }
  return merge;
}

/**
 * Excel: people (threaded comments, pivot tables, the shared-workbook log), comment authors, dates, the saved folder,
 * the document ID, hidden sheets, and paths in connections and names.
 * @param {Package} pack
 * @param {Findings} findings
 * @param {Collected} found
 */
async function readExcel(pack, findings, found) {
  for (const name of pack.matching(/^xl\/persons\/[^/]+\.xml$/)) {
    const xml = await pack.text(name);
    found.people.push(...attributeValues(xml, 'displayName', 'person'), ...attributeValues(xml, 'userId', 'person'));
    // Excel requires both attributes: placeholders, as PowerPoint does.
    await pack.edit(name, (text) => setAttribute(setAttribute(setAttribute(text, 'displayName', PLACEHOLDER, 'person'), 'userId', PLACEHOLDER, 'person'), 'providerId', 'None', 'person'));
  }
  for (const name of pack.matching(/^xl\/pivotCache\/[^/]+\.xml$/)) {
    found.people.push(...attributeValues(await pack.text(name), 'refreshedBy'));
    await pack.edit(name, (text) => setAttribute(text, 'refreshedBy', PLACEHOLDER));
  }
  const log = pack.matching(/^xl\/revisions\/[^/]+\.xml$/);
  for (const name of log) {
    const xml = await pack.text(name);
    found.people.push(...attributeValues(xml, 'userName', 'header'), ...attributeValues(xml, 'name', 'userInfo'));
    if (hasAttribute(xml, 'dateTime')) found.dates = true;
    await pack.edit(name, (text) => setAttribute(setAttribute(setAttribute(text, 'userName', PLACEHOLDER), 'name', PLACEHOLDER, 'userInfo'), 'dateTime', PLACEHOLDER_DATE));
  }
  if (log.length) findings.add('tracked', 'kept');

  /** @type {string[]} */
  const commenters = [];
  const legacy = pack.matching(/^xl\/comments[^/]*\.xml$/);
  for (const name of legacy) {
    const authors = [...(await pack.text(name)).matchAll(elementPattern('author'))].map((match) => decodeXml(match[3]).trim());
    commenters.push(...authors);
    await pack.edit(name, (xml) => {
      let out = setElementText(xml, 'author', PLACEHOLDER);
      // Excel starts each note with its author's name ("Nino Beridze:") as text.
      for (const author of unique(authors)) out = out.replace(new RegExp(String.raw`(<${NS}t\b[^>]*>)${escapeRegExp(encodeXml(author))}:`, 'g'), `$1${PLACEHOLDER}:`);
      return out;
    });
  }
  findings.addValues('commentAuthors', 'removed', unique(commenters));
  const threaded = pack.matching(/^xl\/threadedComments\/[^/]+\.xml$/);
  for (const name of threaded) {
    if (hasAttribute(await pack.text(name), 'dT')) found.dates = true;
    await pack.edit(name, (xml) => setAttribute(xml, 'dT', PLACEHOLDER_DATE));
  }
  if (legacy.length || threaded.length) findings.add('commentsPart', 'kept');

  const workbook = await pack.text('xl/workbook.xml');
  findings.addValues('absPath', 'removed', attributeValues(workbook, 'url', 'absPath'));
  findings.addValues('documentIds', 'removed', attributeValues(workbook, 'documentId', 'revisionPtr'));
  await pack.edit('xl/workbook.xml', (xml) => removeElement(xml.replace(new RegExp(String.raw`<(${NS}AlternateContent)${END}(?:(?!</\1)[\s\S])*?absPath[\s\S]*?</\1\s*>`, 'g'), ''), 'absPath|revisionPtr'));
  const hidden = (workbook.match(tagPattern('sheet')) ?? []).filter((tag) => /^(hidden|veryHidden)$/.test(attributeValues(tag, 'state')[0] ?? ''));
  findings.addValues('hiddenSheets', 'kept', hidden.map((tag) => attributeValues(tag, 'name')[0] ?? ''));
  // Names that point into a workbook on someone's computer: 'C:\Users\…\[book.xlsx]Sheet'!A1
  for (const text of elementTexts(workbook, 'definedName')) found.external.push(...[...text.matchAll(/'?((?:[a-z]:\\|\\\\|file:)[^'!]*)'?!/gi)].map((match) => match[1]));
  for (const name of pack.matching(/^xl\/connections\.xml$/)) {
    const xml = await pack.text(name);
    found.external.push(...attributeValues(xml, 'sourceFile|odcFile'), ...attributeValues(xml, 'connection|command', 'dbPr|olapPr'), ...attributeValues(xml, 'url', 'webPr'));
  }
}

/**
 * PowerPoint: people, comment dates, co-authoring records, speaker notes and hidden slides.
 * @param {Package} pack
 * @param {Findings} findings
 * @param {Collected} found
 */
async function readPowerPoint(pack, findings, found) {
  for (const name of pack.matching(/^ppt\/commentAuthors\.xml$/)) {
    found.people.push(...attributeValues(await pack.text(name), 'name', 'cmAuthor'));
    await pack.edit(name, (text) => setAttribute(setAttribute(text, 'name', PLACEHOLDER, 'cmAuthor'), 'initials', 'A', 'cmAuthor'));
  }
  for (const name of pack.matching(/^ppt\/authors\.xml$/)) {
    const xml = await pack.text(name);
    found.people.push(...attributeValues(xml, 'name', 'author'), ...attributeValues(xml, 'userId', 'author'));
    await pack.edit(name, (text) => setAttribute(setAttribute(setAttribute(setAttribute(text, 'name', PLACEHOLDER, 'author'), 'initials', 'A', 'author'), 'userId', PLACEHOLDER, 'author'), 'providerId', 'None', 'author'));
  }
  const comments = pack.matching(/^ppt\/comments\/[^/]+\.xml$/);
  for (const name of comments) {
    if (hasAttribute(await pack.text(name), 'dt|created', 'cm|reply')) found.dates = true;
    // "dt" on the older comments is optional; "created" on the newer ones is required.
    await pack.edit(name, (xml) => setAttribute(removeAttribute(xml, 'dt', 'cm'), 'created', PLACEHOLDER_DATE, 'cm|reply'));
  }
  if (comments.length || pack.matching(/^ppt\/commentAuthors\.xml$/).length) findings.add('commentsPart', 'kept');

  // Records of who edited together, kept for co-authoring: names, accounts and the editing sessions.
  /** @type {string[]} */
  const coauthors = [];
  const records = [...pack.matching(/^ppt\/changesInfos\/[^/]+\.xml$/), ...pack.matching(/^ppt\/revisionInfo\.xml$/)];
  for (const name of records) {
    const xml = await pack.text(name);
    coauthors.push(...attributeValues(xml, 'name'), ...attributeValues(xml, 'userId'));
    await dropPart(pack, name);
  }
  // Named by the people in them, or by the parts when no name is written (the editing sessions alone).
  if (records.length) findings.add('coauthoring', 'removed', unique(coauthors).length ? unique(coauthors) : records);

  const notes = pack.matching(/^ppt\/notesSlides\/[^/]+\.xml$/).length;
  if (notes) findings.add('notes', 'kept', [String(notes)]);
  let hidden = 0;
  for (const name of pack.matching(/^ppt\/slides\/[^/]+\.xml$/)) if (/^(0|false)$/.test(attributeValues(await pack.text(name), 'show', 'sld')[0] ?? '')) hidden += 1;
  if (hidden) findings.add('hiddenSlides', 'kept', [String(hidden)]);
}

/**
 * Parts of an Office file the readers know: anything else is listed as not checked.
 * XML parts in the document's own folder are content (and searched in the independent check).
 */
const OFFICE_PARTS = [
  /^\[Content_Types\]\.xml$/i,
  /(^|\/)_rels\/[^/]*\.rels$/i,
  /^docMetadata\/LabelInfo\.xml$/i,
  /^(word|xl|ppt)\/.+\.(xml|vml)$/i,
  /^(word|xl|ppt)\/(.+\/)?media\/[^/]+$/i,
  /^(word|xl|ppt)\/(.+\/)?embeddings\/[^/]+$/i,
  /^(word|xl|ppt)\/printerSettings\/[^/]+$/i,
  /^(word|xl|ppt)\/fonts\/[^/]+$/i,
  /\/$/,
];

/**
 * Word, Excel and PowerPoint: what each part says, and the clean copy's changes.
 * @param {Package} pack
 * @param {'docx' | 'xlsx' | 'pptx'} kind
 * @param {Findings} findings
 */
async function readOffice(pack, kind, findings) {
  const rels = await relationships(pack);
  const fields = await officeProperties(pack, rels, findings);
  /** @type {Collected} */
  const found = { people: [], external: [], dates: false };
  /** @type {string[]} */
  let merge = [];
  if (kind === 'docx') merge = await readWord(pack, rels, findings, found);
  if (kind === 'xlsx') await readExcel(pack, findings, found);
  if (kind === 'pptx') await readPowerPoint(pack, findings, found);
  findings.addValues('people', 'removed', unique(found.people));
  if (found.dates) findings.add('dates', 'removed');

  // A picture of the first page, kept for file browsers.
  const thumbnails = [...rels.filter((rel) => /^_rels\/\.rels$/i.test(rel.rels) && /\/metadata\/thumbnail$/i.test(rel.type) && !rel.external).map((rel) => rel.part), ...pack.matching(/^docProps\/thumbnail\.[a-z]+$/)];
  for (const name of new Set(thumbnails)) {
    if (!pack.has(name)) continue;
    findings.add('thumbnail', 'removed');
    await dropPart(pack, name);
  }
  // The printer, by name.
  /** @type {string[]} */
  const printers = [];
  for (const name of pack.matching(/\/printerSettings\/[^/]+\.bin$/)) {
    const bytes = await unzip(/** @type {ZipEntry} */ (pack.entry(name)));
    const printer = printerName(bytes);
    if (!printer) continue;
    printers.push(printer);
    const blank = bytes.slice();
    blank.fill(0, 0, 64);
    pack.replace(name, blank);
  }
  findings.addValues('printer', 'removed', unique(printers));

  // Signatures name the signer, and cleaning breaks them anyway.
  const signatures = pack.matching(/^_xmlsignatures\/.+[^/]$/);
  /** @type {string[]} */
  const signed = [];
  for (const name of signatures) {
    if (/\.xml$/i.test(name)) signed.push(...signers(await pack.text(name)));
    await dropPart(pack, name);
  }
  if (signatures.length) findings.add('signatures', 'removed', unique(signed).length ? unique(signed) : signatures);
  // Custom XML: properties a document system (SharePoint and others) stores in the file, with user names.
  const custom = pack.matching(/^customXml\/.+[^/]$/);
  for (const name of custom) await dropPart(pack, name);
  if (custom.length) findings.add('customXml', 'removed');

  await pictures(pack, findings, /^(word|xl|ppt)\/(.+\/)?media\/[^/]+$/);
  findings.addValues('embedded', 'unchecked', pack.matching(/^(word|xl|ppt)\/(.+\/)?embeddings\/[^/]+$/));
  const macros = pack.matching(/(^|\/)vbaProject\.bin$/);
  pack.know(...macros);
  findings.addValues('macros', 'unchecked', macros);
  const links = rels.filter((rel) => rel.external && !/\/attachedTemplate$/i.test(rel.type) && (!CONTENT_LINK.test(rel.type) || LOCAL_PATH.test(rel.target)));
  findings.addValues('external', 'kept', unique([...links.map((rel) => rel.target), ...found.external, ...merge]));
  const labels = [];
  for (const name of pack.matching(/^docMetadata\/LabelInfo\.xml$/)) labels.push(...attributeValues(await pack.text(name), 'siteId'));
  findings.addValues('labels', 'kept', unique(labels));
  findings.addValues('unknownParts', 'unchecked', unknownParts(pack, OFFICE_PARTS));
  return fields;
}

/** @param {Package} pack @param {RegExp[]} patterns */
const unknownParts = (pack, patterns) => pack.entries.map((entry) => entry.name).filter((name) => !pack.known.has(name.toLowerCase()) && !patterns.some((pattern) => pattern.test(name)));

/** "PT2H5M30S" → 125 (minutes) @param {string} duration */
function minutesOf(duration) {
  const match = /^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:([\d.]+)S)?$/.exec(duration);
  if (!match) return 0;
  return Number(match[1] ?? 0) * 1440 + Number(match[2] ?? 0) * 60 + Number(match[3] ?? 0);
}

/** OpenDocument fields that show a person's name in the text: the author, the sender, who printed it. */
const ODF_NAME_FIELDS = ['author-name', 'author-initials', 'initial-creator', 'creator', 'sender-firstname', 'sender-lastname', 'sender-initials', 'printed-by'];

/** An empty meta.xml with the same root element. @param {string} meta */
const emptyMeta = (meta) => `${XML_HEAD}${meta.match(tagPattern('document-meta'))?.[0] ?? '<office:document-meta xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0">'}<office:meta/></office:document-meta>`;

/** Parts of an OpenDocument file the reader knows. */
const ODF_PARTS = [
  /^mimetype$/,
  /^(content|styles|meta|settings)\.xml$/,
  /^manifest\.rdf$/,
  /^META-INF\/manifest\.xml$/,
  /^Object \d+\/(content|styles|meta|settings)\.xml$/,
  // Pictures of embedded objects drawn by the program, and its own window settings.
  /^ObjectReplacements\//,
  /^Configurations2\//,
  /^layout-cache$/,
  /\/$/,
];

/**
 * OpenDocument text, spreadsheets and presentations.
 * @param {Package} pack
 * @param {Findings} findings
 */
async function readOpenDocument(pack, findings) {
  // In a password-protected file every part but the manifest is encrypted: unreadable, which is not the same as empty.
  if (tagPattern('encryption-data').test(await pack.text('META-INF/manifest.xml'))) throw new DocumentError('locked');
  const meta = await pack.text('meta.xml');
  const revision = xmlText(meta, 'editing-cycles');
  const minutes = minutesOf(xmlText(meta, 'editing-duration'));
  const fields = present({
    author: xmlText(meta, 'initial-creator'),
    lastAuthor: xmlText(meta, 'creator'),
    title: xmlText(meta, 'title'),
    subject: xmlText(meta, 'subject'),
    keywords: elementTexts(meta, 'keyword').join(', '),
    comments: xmlText(meta, 'description'),
    created: shortDate(xmlText(meta, 'creation-date')),
    modified: shortDate(xmlText(meta, 'date')),
    printed: shortDate(xmlText(meta, 'print-date')),
    printedBy: xmlText(meta, 'printed-by'),
    revision: Number(revision) > 1 ? revision : '',
    editTime: minutes > 0 ? String(minutes) : '',
    software: xmlText(meta, 'generator'),
    template: attributeValues(meta, 'href', 'template')[0] ?? '',
  });
  if (tagPattern('user-defined').test(meta)) findings.add('custom', 'removed');
  if (pack.has('meta.xml')) pack.replace('meta.xml', emptyMeta(meta));

  // Embedded objects (charts, formulas) are documents of their own, with their own properties.
  /** @type {string[]} */
  const embedded = [];
  for (const name of pack.matching(/^Object \d+\/meta\.xml$/)) {
    const xml = await pack.text(name);
    embedded.push(...['initial-creator', 'creator', 'printed-by'].flatMap((local) => elementTexts(xml, local)));
    pack.replace(name, emptyMeta(xml));
  }
  findings.addValues('embeddedProperties', 'removed', unique(embedded));

  /** @type {string[]} */
  const commenters = [];
  /** @type {string[]} */
  const editors = [];
  /** @type {string[]} */
  const named = [];
  let dates = false;
  const notes = new RegExp(String.raw`<(${NS}annotation)${END}[\s\S]*?</\1\s*>`, 'g');
  const changes = new RegExp(String.raw`<(${NS}change-info)${END}[\s\S]*?</\1\s*>`, 'g');
  /** Comments and changes: names and initials replaced, dates set to the placeholder (change-info requires one). @param {string} block */
  const anonymise = (block) => setElementText(setElementText(setElementText(block, 'creator', PLACEHOLDER), 'creator-initials', 'A'), 'date', PLACEHOLDER_DATE);
  for (const name of pack.matching(/^(Object \d+\/)?(content|styles)\.xml$/)) {
    const xml = await pack.text(name);
    for (const [note] of xml.matchAll(notes)) commenters.push(xmlText(note, 'creator'));
    for (const [change] of xml.matchAll(changes)) editors.push(xmlText(change, 'creator'));
    if ([...xml.matchAll(notes), ...xml.matchAll(changes)].some(([block]) => elementTexts(block, 'date').length > 0)) dates = true;
    if (tagPattern('changed-region').test(xml)) findings.add('tracked', 'kept');
    if (tagPattern('annotation').test(xml)) findings.add('commentsPart', 'kept');
    const text = xml.replace(notes, '').replace(changes, '');
    named.push(...ODF_NAME_FIELDS.flatMap((local) => elementTexts(text, local)));
    await pack.edit(name, (content) => content.replace(notes, anonymise).replace(changes, anonymise));
  }
  findings.addValues('commentAuthors', 'removed', unique(commenters));
  findings.addValues('revisionAuthors', 'removed', unique(editors));
  if (dates) findings.add('dates', 'removed');
  findings.addValues('nameFields', 'kept', unique(named));

  // Settings: the printer, and the address book or database last used for mail merge.
  /** @type {string[]} */
  const printers = [];
  /** @type {string[]} */
  const sources = [];
  let setup = false;
  const item = new RegExp(String.raw`(<${NS}config-item${END}[^>]*>)([^<]*)(?=<)`, 'g');
  const blanked = /^(PrinterName|PrinterSetup|CurrentDatabaseDataSource|CurrentDatabaseCommand)$/;
  for (const name of pack.matching(/^(Object \d+\/)?settings\.xml$/)) {
    for (const [, tag, value] of (await pack.text(name)).matchAll(item)) {
      const key = attributeValues(tag, 'name')[0] ?? '';
      if (key === 'PrinterName') printers.push(decodeXml(value).trim());
      if (key === 'PrinterSetup' && value.trim()) setup = true;
      if (key === 'CurrentDatabaseDataSource') sources.push(decodeXml(value).trim());
    }
    await pack.edit(name, (xml) => xml.replace(item, (whole, tag) => (blanked.test(attributeValues(tag, 'name')[0] ?? '') ? tag : whole)));
  }
  if (unique(printers).length || setup) findings.add('printer', 'removed', unique(printers));
  findings.addValues('dataSource', 'removed', unique(sources));

  for (const name of pack.matching(/^Thumbnails\/.+[^/]$/)) {
    if (/\.png$/i.test(name)) findings.add('thumbnail', 'removed');
    await dropOdfPart(pack, name);
  }
  // Signatures name the signer, and cleaning breaks them anyway.
  /** @type {string[]} */
  const signed = [];
  const signatures = pack.matching(/^META-INF\/[^/]*signatures[^/]*\.xml$/);
  for (const name of signatures) {
    signed.push(...signers(await pack.text(name)));
    await dropOdfPart(pack, name);
  }
  if (signatures.length) findings.add('signatures', 'removed', unique(signed).length ? unique(signed) : signatures);
  await pictures(pack, findings, /^(Object \d+\/)?Pictures\/.+[^/]$/);
  const macros = pack.matching(/^(Basic|Scripts|Dialogs)\/.+[^/]$/);
  pack.know(...macros);
  findings.addValues('macros', 'unchecked', macros);
  findings.addValues('unknownParts', 'unchecked', unknownParts(pack, ODF_PARTS));
  return fields;
}

/* ---------- The independent check of the clean copy ---------- */

/** Elements that hold the document's own text: a name typed there is content, not metadata. */
const TEXT_ELEMENTS = new Set(['t', 'delText', 'p', 'h', 'span', 'a', 'v', 'text', 'ruby-base', 'ruby-text']);

/** XML without the text of the document itself (what is inside the elements above). @param {string} xml */
function withoutDocumentText(xml) {
  /** @type {string[]} */
  const open = [];
  let out = '';
  let last = 0;
  for (const match of xml.matchAll(/<[^>]*>/g)) {
    if (!TEXT_ELEMENTS.has(open.at(-1) ?? '')) out += xml.slice(last, match.index);
    const tag = match[0];
    out += tag;
    last = match.index + tag.length;
    if (tag.startsWith('</')) open.pop();
    else if (!tag.endsWith('/>') && !/^<[?!]/.test(tag)) open.push(/^<([^\s/>]+)/.exec(tag)?.[1]?.replace(/^.*:/, '') ?? '');
  }
  return out + xml.slice(last);
}

/** @param {Uint8Array} haystack @param {Uint8Array} needle */
function containsBytes(haystack, needle) {
  for (let at = haystack.indexOf(needle[0]); at !== -1 && at + needle.length <= haystack.length; at = haystack.indexOf(needle[0], at + 1)) {
    let matched = 1;
    while (matched < needle.length && haystack[at + matched] === needle[matched]) matched += 1;
    if (matched === needle.length) return true;
  }
  return false;
}

/** A value as UTF-8, UTF-16LE and UTF-16BE bytes. @param {string} value */
function encodings(value) {
  const little = new Uint8Array(value.length * 2);
  const big = new Uint8Array(value.length * 2);
  for (let i = 0; i < value.length; i += 1) {
    const unit = value.charCodeAt(i);
    little[i * 2] = unit & 0xff;
    little[i * 2 + 1] = unit >> 8;
    big[i * 2] = unit >> 8;
    big[i * 2 + 1] = unit & 0xff;
  }
  return [new TextEncoder().encode(value), little, big];
}

/** Findings whose values identify someone or something and must not be in the clean copy. */
const SEARCHED = new Set(['people', 'commentAuthors', 'revisionAuthors', 'coauthoring', 'template', 'absPath', 'printer', 'dataSource', 'documentIds', 'embeddedProperties', 'signatures']);
/** Properties searched for the same way. Dates, counts and software names are checked by reading the copy again. */
const SEARCHED_FIELDS = ['author', 'lastAuthor', 'company', 'manager', 'printedBy'];

/**
 * The names, accounts, paths and IDs the first reading found and the clean copy removes.
 * @param {Record<string, string>} fields
 * @param {Finding[]} findings
 */
const secretsOf = (fields, findings) =>
  unique([...SEARCHED_FIELDS.map((key) => fields[key] ?? ''), ...findings.filter((item) => item.status === 'removed' && SEARCHED.has(item.key)).flatMap((item) => item.values)].map((value) => value.trim())).filter((value) => value.length >= 3);

/**
 * Searches every part of the clean copy for the secrets, independently of the readers: XML in the encoding it
 * declares with character references decoded, anything else as UTF-8 and UTF-16 bytes. In XML, the document's own
 * text doesn't count, nor does a value reported as left in that contains the secret.
 * @param {Uint8Array} bytes
 * @param {string[]} secrets
 * @param {string[]} allowed  Values reported as found and left in.
 * @returns {Promise<string[]>}  The secrets still there.
 */
export async function leftIn(bytes, secrets, allowed) {
  const left = new Set();
  if (!secrets.length) return [];
  for (const entry of readZip(bytes)) {
    const data = await unzip(entry);
    let text = null;
    if (isXml(data)) {
      try {
        text = decodeXml(withoutDocumentText(decodePart(data).text));
      } catch {
        // An encoding this browser can't decode: searched as bytes below.
      }
    }
    if (text !== null) {
      for (const secret of secrets) {
        // A value reported as left in (a path with the user's name in it) excuses the secret inside it, nothing more.
        let rest = text;
        for (const value of allowed) if (value.includes(secret)) rest = rest.split(value).join('');
        if (rest.includes(secret)) left.add(secret);
      }
    } else {
      for (const secret of secrets) if (encodings(secret).some((needle) => containsBytes(data, needle))) left.add(secret);
    }
  }
  return [...left];
}

/**
 * The extension of an Office file, from its main part's content type: a macro-enabled file, a template or a slide
 * show keeps its own.
 * @param {Package} pack
 * @param {'docx' | 'xlsx' | 'pptx'} kind
 * @param {string} main  The main part.
 */
async function officeExtension(pack, kind, main) {
  const types = await pack.text('[Content_Types].xml');
  const override = (types.match(tagPattern('Override')) ?? []).find((tag) => (attributeValues(tag, 'PartName')[0] ?? '').toLowerCase() === `/${main}`);
  const type = (override ? attributeValues(override, 'ContentType')[0] ?? '' : '').toLowerCase();
  return OFFICE_EXTENSIONS[/** @type {keyof typeof OFFICE_EXTENSIONS} */ (type)] ?? kind;
}

/**
 * @param {Uint8Array} bytes
 * @param {boolean} verify  Check the clean copy before offering it.
 * @returns {Promise<DocumentReport>}
 */
async function inspectArchive(bytes, verify) {
  const pack = new Package(readZip(bytes));
  const mimetype = pack.has('mimetype') ? (await pack.text('mimetype')).trim() : '';
  const odf = ODF_KINDS[mimetype];
  const office = OFFICE_KINDS.find(([part]) => pack.has(part));
  if (!odf && !(office && pack.has('[Content_Types].xml'))) throw new DocumentError('unsupported');
  const [main, officeKind] = office ?? ['', 'docx'];
  const kind = odf ? odf[0] : officeKind;
  const extension = odf ? odf[1] : await officeExtension(pack, officeKind, main);

  const findings = new Findings();
  const fields = odf ? await readOpenDocument(pack, findings) : await readOffice(pack, officeKind, findings);
  if (Object.keys(fields).length) findings.add('properties', 'removed');
  findings.list.sort((a, b) => ORDER.indexOf(a.key) - ORDER.indexOf(b.key));

  /** @type {Uint8Array<ArrayBuffer> | null} */
  let clean = await pack.write();
  let verified = false;
  if (verify) {
    // Read again by the same code: anything still found that was meant to go means the copy is not offered...
    const again = await inspectArchive(clean, false);
    const reread = Object.keys(again.fields).length === 0 && !again.findings.some((item) => item.status === 'removed');
    // ...and searched without it, for every name, path and ID the first reading found.
    const kept = findings.list.filter((item) => item.status === 'kept').flatMap((item) => item.values);
    verified = reread && (await leftIn(clean, secretsOf(fields, findings.list), kept)).length === 0;
    if (!verified) clean = null;
  }
  return { kind, extension, mime: MIME[/** @type {keyof typeof MIME} */ (extension)] ?? 'application/octet-stream', fields, findings: findings.list, clean, verified };
}

/** The order findings are listed in. */
const ORDER = [
  'properties', 'custom', 'people', 'commentAuthors', 'revisionAuthors', 'coauthoring', 'dates', 'template', 'absPath', 'printer', 'dataSource', 'rsid', 'documentIds',
  'thumbnail', 'media', 'embeddedProperties', 'signatures', 'customXml',
  'tracked', 'commentsPart', 'notes', 'hiddenSheets', 'hiddenSlides', 'nameFields', 'external', 'labels',
  'revisions', 'annotations', 'attachments', 'forms', 'formValues', 'pdfSignatures', 'scripts', 'xmp', 'documentId',
  'propertiesUnchecked', 'objectsUnchecked', 'xmpUnchecked', 'embedded', 'mediaUnchecked', 'macros', 'unknownParts',
];

/* ---------- PDF ---------- */

/** "D:20261109140322+04'00'" → "2026-11-09 14:03" @param {string} value */
const pdfDate = (value) => value.replace(/^D:(\d{4})(\d{2})(\d{2})(?:(\d{2})(\d{2}))?.*$/, (_, y, m, d, h, min) => `${y}-${m}-${d}${h ? ` ${h}:${min}` : ''}`);

/** Info dictionary keys → report rows. */
const PDF_KEYS = { Author: 'author', Title: 'title', Subject: 'subject', Keywords: 'keywords', Creator: 'software', Producer: 'producer', CreationDate: 'created', ModDate: 'modified' };
/** Annotations people add (comments, highlights, stamps…), as opposed to form fields and links. */
const MARKUP = /\/Subtype\s*\/(Text|FreeText|Highlight|Underline|Squiggly|StrikeOut|Ink|Stamp|Caret|Popup|Square|Circle|Line|Polygon|PolyLine|FileAttachment|Sound|Redact)\b/;

/**
 * What an XMP packet says: every author, the title, the software and the document IDs, written as elements or as
 * attributes (as Adobe's programs write them).
 * @param {string} xmp
 */
function readXmp(xmp) {
  /** @param {string} local */
  const items = (local) => [...(new RegExp(String.raw`<${NS}${local}${END}[\s\S]*?</${NS}${local}\s*>`).exec(xmp)?.[0] ?? '').matchAll(/<rdf:li\b[^>]*>([^<]*)<\/rdf:li>/g)].map((match) => decodeXml(match[1]).trim()).filter(Boolean);
  /** @param {string} local */
  const one = (local) => xmlText(xmp, local) || attributeValues(xmp, local)[0] || '';
  return {
    author: unique(items('creator')).join(', '),
    title: items('title')[0] ?? '',
    software: one('CreatorTool'),
    producer: one('Producer'),
    ids: unique(['DocumentID', 'OriginalDocumentID'].flatMap((local) => [...elementTexts(xmp, local), ...attributeValues(xmp, local)])),
  };
}

/**
 * @param {Uint8Array} bytes
 * @returns {Promise<DocumentReport>}
 */
async function inspectPdf(bytes) {
  // One character per byte, so offsets and binary streams survive.
  const text = byteString(bytes);
  // In an encrypted PDF the strings are scrambled: it can't be read, which is not the same as having nothing.
  // The dictionary may be a reference ("/Encrypt 5 0 R") or written in place ("/Encrypt<<…>>").
  if (/\/Encrypt\s*(?:<<|\d+\s+\d+\s+R)/.test(pdfNames(text))) throw new DocumentError('encrypted');
  const findings = new Findings();
  const { objects, unreadable } = await pdfObjects(bytes, text);
  const all = [...objects.values()].map(pdfNames);

  /** A string value that may be written in place or as a reference to another object. @param {string} source @param {string} key */
  const value = (source, key) => {
    const direct = new RegExp(String.raw`/${key}\s*(?=[(<])(?!<<)`).exec(source);
    const token = direct ? stringToken(source, direct.index + direct[0].length) : '';
    if (token) return pdfString(token);
    const reference = new RegExp(String.raw`/${key}\s+(\d+)\s+\d+\s+R`).exec(source);
    const target = reference ? objects.get(Number(reference[1]))?.trim() ?? '' : '';
    return /^[(<]/.test(target) ? pdfString(stringToken(target, 0)) : '';
  };

  /** @type {Record<string, string>} */
  const fields = {};
  const infoReference = [...text.matchAll(/\/Info\s+(\d+)\s+\d+\s+R/g)].at(-1);
  const info = infoReference ? objects.get(Number(infoReference[1])) : undefined;
  if (infoReference && info === undefined) findings.add('propertiesUnchecked', 'unchecked');
  for (const [key, row] of Object.entries(PDF_KEYS)) {
    const found = info ? value(info, key) : '';
    if (found) fields[row] = row === 'created' || row === 'modified' ? pdfDate(found) : found;
  }

  // XMP: plain in the file, or in a compressed metadata stream.
  /** @type {string[]} */
  const packets = [...text.matchAll(/<x:xmpmeta[\s\S]*?<\/x:xmpmeta>/g)].map((match) => new TextDecoder().decode(ascii(match[0])));
  for (const match of text.matchAll(/(?:^|[\r\n\s])(\d+)\s+\d+\s+obj\b/g)) {
    const at = match.index + match[0].length;
    const body = text.slice(at, text.indexOf('endobj', at));
    if (!/\/Type\s*\/Metadata\b/.test(body) || !/\/Filter\b/.test(body)) continue;
    const data = await streamData(bytes, at, body, objects);
    if (data === null) findings.add('xmpUnchecked', 'unchecked');
    else packets.push(new TextDecoder().decode(ascii(data)));
  }
  /** @type {string[]} */
  const ids = [];
  for (const xmp of packets) {
    findings.add('xmp', 'kept');
    const read = readXmp(xmp);
    fields.author ||= read.author;
    fields.title ||= read.title;
    fields.software ||= read.software;
    fields.producer ||= read.producer;
    ids.push(...read.ids);
  }
  const kept = present(fields);
  if (Object.keys(kept).length) findings.add('properties', 'kept');
  if (unreadable) {
    findings.add('propertiesUnchecked', 'unchecked');
    // Comments, attachments, forms and scripts may sit in the parts that couldn't be read, too.
    findings.add('objectsUnchecked', 'unchecked');
  }

  // Earlier versions: every save that appends changes ends with its own %%EOF. A file built for fast web view has one extra.
  const ends = (text.match(/%%EOF/g) ?? []).length - (/\/Linearized\b/.test(text.slice(0, 2048)) ? 1 : 0);
  if (ends > 1) findings.add('revisions', 'kept', [String(ends - 1)]);
  const markup = all.filter((body) => MARKUP.test(body));
  findings.addValues('annotations', 'kept', unique(markup.map((body) => value(body, 'T'))));
  if (!findings.list.some((item) => item.key === 'annotations') && all.some((body) => /\/Type\s*\/Annot\b/.test(body) && !/\/Subtype\s*\/(Widget|Link)\b/.test(body) && /\/Contents\s*[(<]/.test(body))) findings.add('annotations', 'kept');
  const files = all.filter((body) => /\/Type\s*\/Filespec\b/.test(body) && /\/EF\b/.test(body)).map((body) => value(body, 'UF') || value(body, 'F'));
  if (files.length || all.some((body) => /\/Type\s*\/EmbeddedFile\b|\/EmbeddedFiles\b/.test(body))) findings.add('attachments', 'kept', unique(files));
  // Form fields, with what was typed into them (text fields and choices).
  // A field's type may be set on its parent, so any widget that isn't a signature or a button counts.
  const typed = unique(all.filter((body) => /\/FT\s*\/(Tx|Ch)\b/.test(body) || (/\/Subtype\s*\/Widget\b/.test(body) && !/\/FT\s*\/(Sig|Btn)\b/.test(body))).map((body) => value(body, 'V')));
  if (typed.length) findings.add('formValues', 'kept', typed);
  else if (/\/AcroForm\b/.test(pdfNames(text)) && all.some((body) => /\/Fields\s*\[\s*\d/.test(body))) findings.add('forms', 'kept');
  findings.addValues('pdfSignatures', 'kept', unique(all.filter((body) => /\/Type\s*\/Sig\b/.test(body)).map((body) => value(body, 'Name'))));
  if (all.some((body) => /\/(JavaScript|JS)\b/.test(body))) findings.add('scripts', 'kept');
  // Links to files on someone's computer or network.
  const links = all.flatMap((body) => [value(body, 'URI'), /\/S\s*\/(Launch|GoToR)\b/.test(body) ? value(body, 'F') : '']);
  findings.addValues('external', 'kept', unique(links.filter((link) => LOCAL_PATH.test(link))));
  const id = [...text.matchAll(/\/ID\s*\[\s*<([0-9A-Fa-f]+)>/g)].at(-1)?.[1];
  findings.addValues('documentId', 'kept', unique([id ? id.toUpperCase() : '', ...ids]));
  findings.list.sort((a, b) => ORDER.indexOf(a.key) - ORDER.indexOf(b.key));
  return { kind: 'pdf', extension: 'pdf', mime: MIME.pdf, fields: kept, findings: findings.list, clean: null, verified: false };
}

/** True when the report has anything to show. @param {DocumentReport} report */
export const hasFindings = ({ fields, findings }) => Object.keys(fields).length > 0 || findings.length > 0;

/** Names of an OLE compound file's streams, written in UTF-16 in its directory. @param {Uint8Array} bytes @param {string} name */
const hasStream = (bytes, name) => containsBytes(bytes, encodings(name)[1]);

/**
 * Reads a document: what it says about its author, and (for Office and OpenDocument files) the same document without it.
 * @param {Uint8Array} bytes
 * @returns {Promise<DocumentReport>}
 * @throws {DocumentError}
 */
export async function inspectDocument(bytes) {
  if (startsWith(bytes, 0, 'PK\x03\x04')) return inspectArchive(bytes, true);
  // "%PDF-" may follow a few bytes of junk at the start of the file.
  if (byteString(bytes.subarray(0, 1024)).includes('%PDF-')) return inspectPdf(bytes);
  // An OLE compound file: a password-protected Office file keeps its document in "EncryptedPackage"; a .doc, .xls or .ppt from before 2007 has none.
  if (startsWith(bytes, 0, '\xd0\xcf\x11\xe0')) throw new DocumentError(hasStream(bytes, 'EncryptedPackage') ? 'locked' : 'old');
  throw new DocumentError('unsupported');
}

/* ---------- Page wiring ---------- */

const MAX_BYTES = 40 * 1024 * 1024;
/** The type of each clean copy, by its extension. */
const MIME = {
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  docm: 'application/vnd.ms-word.document.macroEnabled.12',
  dotx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.template',
  dotm: 'application/vnd.ms-word.template.macroEnabled.12',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  xlsm: 'application/vnd.ms-excel.sheet.macroEnabled.12',
  xltx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.template',
  xltm: 'application/vnd.ms-excel.template.macroEnabled.12',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  pptm: 'application/vnd.ms-powerpoint.presentation.macroEnabled.12',
  ppsx: 'application/vnd.openxmlformats-officedocument.presentationml.slideshow',
  ppsm: 'application/vnd.ms-powerpoint.slideshow.macroEnabled.12',
  potx: 'application/vnd.openxmlformats-officedocument.presentationml.template',
  potm: 'application/vnd.ms-powerpoint.template.macroEnabled.12',
  odt: 'application/vnd.oasis.opendocument.text',
  ods: 'application/vnd.oasis.opendocument.spreadsheet',
  odp: 'application/vnd.oasis.opendocument.presentation',
  ott: 'application/vnd.oasis.opendocument.text-template',
  ots: 'application/vnd.oasis.opendocument.spreadsheet-template',
  otp: 'application/vnd.oasis.opendocument.presentation-template',
  pdf: 'application/pdf',
};

/**
 * A small Word document made here, for "Try an example": a name in the
 * properties, a comment, a tracked change, a template path and a printer.
 */
export function exampleDocument() {
  const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
  const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  const printer = new Uint8Array(220);
  for (const [index, char] of [...'Newsroom Printer 4F'].entries()) printer[index * 2] = char.charCodeAt(0);
  /** @type {Record<string, string | Uint8Array>} */
  const parts = {
    '[Content_Types].xml': `${XML_HEAD}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="bin" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.printerSettings"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/comments.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.comments+xml"/><Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>`,
    '_rels/.rels': `${XML_HEAD}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL}/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="${REL}/extended-properties" Target="docProps/app.xml"/></Relationships>`,
    'word/_rels/document.xml.rels': `${XML_HEAD}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL}/comments" Target="comments.xml"/><Relationship Id="rId2" Type="${REL}/settings" Target="settings.xml"/><Relationship Id="rId3" Type="${REL}/printerSettings" Target="printerSettings/printerSettings1.bin"/></Relationships>`,
    'word/document.xml': `${XML_HEAD}<w:document ${W}><w:body><w:p w:rsidR="00A1B2C3"><w:r><w:t xml:space="preserve">Draft for the board. </w:t></w:r><w:commentRangeStart w:id="0"/><w:ins w:id="1" w:author="Nino Beridze" w:date="2026-11-09T14:00:00Z"><w:r><w:t>Source: the regional office.</w:t></w:r></w:ins><w:commentRangeEnd w:id="0"/><w:r><w:commentReference w:id="0"/></w:r></w:p></w:body></w:document>`,
    'word/comments.xml': `${XML_HEAD}<w:comments ${W}><w:comment w:id="0" w:author="Giorgi Kapanadze" w:initials="GK" w:date="2026-11-09T15:00:00Z"><w:p><w:r><w:t>Can we name the source?</w:t></w:r></w:p></w:comment></w:comments>`,
    'word/settings.xml': `${XML_HEAD}<w:settings ${W}><w:attachedTemplate r:id="rId1"/><w:rsids><w:rsidRoot w:val="00A1B2C3"/><w:rsid w:val="00A1B2C3"/></w:rsids></w:settings>`,
    'word/_rels/settings.xml.rels': `${XML_HEAD}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL}/attachedTemplate" Target="file:///C:\\Users\\nino.beridze\\AppData\\Roaming\\Microsoft\\Templates\\Normal.dotm" TargetMode="External"/></Relationships>`,
    'word/printerSettings/printerSettings1.bin': printer,
    'docProps/core.xml': `${XML_HEAD}<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:creator>Nino Beridze</dc:creator><cp:lastModifiedBy>Giorgi Kapanadze</cp:lastModifiedBy><cp:revision>12</cp:revision><dcterms:created xsi:type="dcterms:W3CDTF">2026-11-02T09:12:00Z</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">2026-11-09T15:04:00Z</dcterms:modified></cp:coreProperties>`,
    'docProps/app.xml': `${XML_HEAD}<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>Microsoft Office Word</Application><Company>Example Newsroom</Company><TotalTime>94</TotalTime></Properties>`,
  };
  const encoder = new TextEncoder();
  return writeZip(
    Object.entries(parts).map(([name, content]) => {
      const data = typeof content === 'string' ? encoder.encode(content) : content;
      return { name, rawName: encoder.encode(name), flags: FLAG_UTF8, method: 0, crc: crc32(data), size: data.length, data };
    }),
  );
}

/** @param {HTMLElement} root */
export function init(root) {
  /** @template {Element} T @param {string} name @param {ParentNode} [scope] @returns {T} */
  const find = (name, scope = root) => /** @type {T} */ (scope.querySelector(`[data-js="${name}"]`));
  const file = /** @type {HTMLInputElement} */ (find('document-file'));
  const summary = /** @type {HTMLElement} */ (find('document-summary'));
  const reports = /** @type {HTMLElement} */ (find('document-reports'));
  const template = /** @type {HTMLTemplateElement} */ (find('document-template'));
  const allBox = /** @type {HTMLElement} */ (find('document-all'));
  const all = initSave(/** @type {HTMLElement} */ (find('save', allBox)));
  /** The save areas of the cards shown, so their object URLs can be released. @type {ReturnType<typeof initSave>[]} */
  let saves = [];
  /** Counts batches: a batch that is no longer the latest stops adding to the page. */
  let run = 0;

  /**
   * One file's report card.
   * @param {File} chosen
   */
  const report = async (chosen) => {
    const card = /** @type {HTMLElement} */ (/** @type {HTMLElement} */ (template.content.firstElementChild).cloneNode(true));
    const message = /** @type {HTMLElement} */ (find('document-message', card));
    const save = initSave(/** @type {HTMLElement} */ (find('save', card)));
    find('document-name', card).textContent = chosen.name;
    /** @param {string} key */
    const fail = (key) => {
      message.textContent = message.dataset[key] ?? '';
      return { card, save, clean: null };
    };
    if (chosen.size > MAX_BYTES) return fail('tooLarge');

    /** @type {DocumentReport} */
    let result;
    try {
      result = await inspectDocument(new Uint8Array(await chosen.arrayBuffer()));
    } catch (error) {
      if (!(error instanceof DocumentError)) console.error('[lockwell] Could not read the chosen document.', error);
      return fail(error instanceof DocumentError ? error.code : 'damaged');
    }
    if (!hasFindings(result)) return fail('none');
    message.textContent = message.dataset.found ?? '';

    for (const row of /** @type {HTMLElement[]} */ ([...card.querySelectorAll('[data-js="document-fields"] [data-row]')])) {
      const value = result.fields[row.dataset.row ?? ''];
      row.hidden = value === undefined;
      const cell = row.querySelector('dd');
      if (cell && value !== undefined) cell.textContent = value;
    }
    for (const group of /** @type {HTMLElement[]} */ ([...card.querySelectorAll('[data-group]')])) {
      const status = group.dataset.group;
      let shown = false;
      for (const item of /** @type {HTMLElement[]} */ ([...group.querySelectorAll('[data-finding]')])) {
        const found = result.findings.find((candidate) => candidate.key === item.dataset.finding && candidate.status === status);
        item.hidden = !found;
        if (!found) continue;
        shown = true;
        if (!item.dataset.template) continue;
        const target = /** @type {HTMLElement} */ (item.querySelector('[data-js="document-text"]') ?? item);
        fillInto(target, item.dataset.template, { values: found.values.join(', ') });
      }
      group.hidden = !shown;
    }
    /** @type {HTMLElement} */ (find('document-pdf', card)).hidden = result.kind !== 'pdf';
    const verified = /** @type {HTMLElement} */ (find('document-verified', card));
    const cleanable = result.kind !== 'pdf';
    verified.hidden = !cleanable;
    verified.textContent = (result.clean ? verified.dataset.ok : verified.dataset.failed) ?? '';
    if (!result.clean || !cleanable) return { card, save, clean: null };
    save.offer({ blob: new Blob([result.clean], { type: result.mime }), original: chosen.name, extension: result.extension, fallback: 'document', suffix: 'clean' });
    return { card, save, clean: { name: chosen.name, extension: result.extension, data: result.clean } };
  };

  /** @param {File[]} files */
  const open = async (files) => {
    run += 1;
    const current = run;
    for (const save of saves) save.clear();
    saves = [];
    all.clear();
    allBox.hidden = true;
    reports.replaceChildren();
    summary.textContent = '';
    /** @type {{ save: ReturnType<typeof initSave>, clean: { name: string, extension: string, data: Uint8Array } }[]} */
    const done = [];
    for (const chosen of files) {
      const result = await report(chosen);
      // A newer batch started meanwhile: this card belongs to nothing on the page.
      if (current !== run) {
        result.save.clear();
        return;
      }
      saves.push(result.save);
      reports.append(result.card);
      if (result.clean) done.push({ save: result.save, clean: result.clean });
    }
    // Announced once the report is complete.
    summary.textContent = files.length === 1 ? (summary.dataset.one ?? '') : fillText(summary.dataset.several, { n: String(files.length) });
    if (done.length < 2) return;
    // Several clean copies: one archive with all of them, each named the way its own card would save it.
    const offerAll = () => {
      const archive = cleanArchive(
        done.map(({ save, clean }) => ({ original: clean.name, extension: clean.extension, data: clean.data, neutral: save.isNeutral() })),
        { fallback: 'document', suffix: 'clean' },
      );
      all.offer({ blob: new Blob([archive], { type: 'application/zip' }), original: 'documents', extension: 'zip', fallback: 'documents', suffix: 'clean' });
    };
    for (const { save } of done) save.onRename(offerAll);
    allBox.hidden = false;
    offerAll();
  };

  file.addEventListener('change', () => open([...(file.files ?? [])]));
  receiveFiles(root, (_, files) => open(files));
  find('document-example').addEventListener('click', () => {
    const example = new File([exampleDocument()], 'Board report 2026-11-09.docx', { type: MIME.docx });
    open([example]);
  });
}

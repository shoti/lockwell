// @ts-check
/**
 * @file Builds small test files byte by byte, from the format specifications, independently of the site's readers:
 * ZIP (APPNOTE 6.3.10 §4.3), compound files (MS-CFB §2), Windows shortcuts (MS-SHLLINK §2), ISO 9660 images
 * (ECMA-119), PDF files (ISO 32000-1 §7.5) with the PDF filters' encoders (§7.4), and JPEG (ITU T.81 markers) and PNG
 * (chunks, with zlib image data) headers around placeholder data. No real-world sample is used:
 * nothing here can run.
 */
import { crc32, deflateRawSync, deflateSync } from 'node:zlib';

/** @param {number} n */
export const u16 = (n) => [n & 0xff, (n >>> 8) & 0xff];
/** @param {number} n */
export const u32 = (n) => [n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff];
/** @param {string} text */
export const utf8 = (text) => new TextEncoder().encode(text);
/** @param {string} text */
export const latin1 = (text) => Uint8Array.from(text, (char) => char.charCodeAt(0));
/** @param {string} text */
export const utf16le = (text) => Uint8Array.from([...text].flatMap((char) => u16(char.charCodeAt(0))));
/** @param {...(ArrayLike<number>)} parts */
export const join = (...parts) => Uint8Array.from(parts.flatMap((part) => Array.from(part)));

/** A file that starts like a Windows program and can't run: "MZ" and zeros. */
export const PROGRAM_STUB = join(latin1('MZ'), new Uint8Array(126));
/** The first bytes of a JPEG picture. */
export const JPEG_STUB = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, ...latin1('JFIF'), 0, 1, 1, 0, 0, 1, 0, 1, 0, 0, 0xff, 0xd9]);

/**
 * @typedef {object} ZipItem
 * @property {string} name
 * @property {Uint8Array | string} [data]
 * @property {number} [flags]
 * @property {boolean} [deflate]
 */

/** A ZIP archive. @param {ZipItem[]} items */
export function zip(items) {
  /** @type {number[]} */
  const out = [];
  /** @type {number[]} */
  const central = [];
  for (const { name, data = '', flags = 0, deflate = false } of items) {
    const raw = typeof data === 'string' ? utf8(data) : data;
    const stored = deflate ? deflateRawSync(raw) : raw;
    const nameBytes = utf8(name);
    const shared = [...u16(flags), ...u16(deflate ? 8 : 0), ...u32(0), ...u32(crc32(raw)), ...u32(stored.length), ...u32(raw.length), ...u16(nameBytes.length), ...u16(0)];
    const offset = out.length;
    out.push(...u32(0x04034b50), ...u16(20), ...shared, ...nameBytes, ...stored);
    central.push(...u32(0x02014b50), ...u16(20), ...u16(20), ...shared, ...u16(0), ...u16(0), ...u16(0), ...u32(0), ...u32(offset), ...nameBytes);
  }
  const start = out.length;
  out.push(...central, ...u32(0x06054b50), ...u16(0), ...u16(0), ...u16(items.length), ...u16(items.length), ...u32(central.length), ...u32(start), ...u16(0));
  return Uint8Array.from(out);
}

const CONTENT_TYPES = (/** @type {string} */ extra) => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>${extra}</Types>`;
/** @param {string} body */
const RELS = (body) => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${body}</Relationships>`;
const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';

/**
 * A Word document (.docx) with optional extra parts and relationships.
 * @param {{ body?: string, types?: string, rels?: string, parts?: ZipItem[] }} [options]
 */
export function docx({ body = '<w:p><w:r><w:t>Hello</w:t></w:r></w:p>', types = '', rels = '', parts = [] } = {}) {
  return zip([
    { name: '[Content_Types].xml', data: CONTENT_TYPES(`<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>${types}`) },
    { name: '_rels/.rels', data: RELS('<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>') },
    { name: 'word/_rels/document.xml.rels', data: RELS(rels) },
    { name: 'word/document.xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:document ${W}><w:body>${body}</w:body></w:document>`, deflate: true },
    ...parts,
  ]);
}

/**
 * A compound file, version 3 (512-byte sectors). Streams under 4,096 bytes go to the mini stream, larger ones to
 * regular sectors, as MS-CFB requires. Storages are made from the paths. Each storage's children are chained as
 * right siblings (a valid, unbalanced tree).
 * @param {{ path: string, data: Uint8Array }[]} streams
 * @param {{ rootClsid?: number[] }} [options]  rootClsid: 16 bytes as stored.
 */
export function cfb(streams, { rootClsid = new Array(16).fill(0) } = {}) {
  /** @typedef {{ name: string, type: 1 | 2 | 5, children: number[], data?: Uint8Array, start: number, size: number }} Node */
  /** @type {Node[]} */
  const nodes = [{ name: 'Root Entry', type: 5, children: [], start: 0xfffffffe, size: 0 }];
  /** @type {Map<string, number>} */
  const ids = new Map([['', 0]]);
  for (const { path, data } of streams) {
    const parts = path.split('/');
    let parent = 0;
    parts.forEach((name, index) => {
      const key = parts.slice(0, index + 1).join('/');
      let id = ids.get(key);
      if (id === undefined) {
        id = nodes.length;
        const last = index === parts.length - 1;
        nodes.push({ name, type: last ? 2 : 1, children: [], data: last ? data : undefined, start: 0xfffffffe, size: last ? data.length : 0 });
        ids.set(key, id);
        nodes[parent].children.push(id);
      }
      parent = id;
    });
  }
  const small = nodes.filter((node) => node.type === 2 && node.data && node.data.length < 4096);
  const large = nodes.filter((node) => node.type === 2 && node.data && node.data.length >= 4096);
  // Mini stream: 64-byte sectors.
  /** @type {number[]} */
  const miniFat = [];
  /** @type {number[]} */
  const mini = [];
  for (const node of small) {
    const data = /** @type {Uint8Array} */ (node.data);
    const count = Math.ceil(data.length / 64);
    node.start = count ? miniFat.length : 0xfffffffe;
    for (let i = 0; i < count; i += 1) miniFat.push(i === count - 1 ? 0xfffffffe : miniFat.length + 1);
    mini.push(...data, ...new Array(count * 64 - data.length).fill(0));
  }
  const sector = 512;
  const dirSectors = Math.ceil(nodes.length / 4);
  const miniFatSectors = miniFat.length ? Math.ceil((miniFat.length * 4) / sector) : 0;
  const miniSectors = Math.ceil(mini.length / sector);
  /** @type {number[]} */
  const fat = [0xfffffffd];
  /** @param {number} count */
  const chain = (count) => {
    const first = fat.length;
    for (let i = 0; i < count; i += 1) fat.push(i === count - 1 ? 0xfffffffe : fat.length + 1);
    return count ? first : 0xfffffffe;
  };
  const dirStart = chain(dirSectors);
  const miniFatStart = chain(miniFatSectors);
  const miniStart = chain(miniSectors);
  nodes[0].start = miniSectors ? miniStart : 0xfffffffe;
  nodes[0].size = mini.length;
  /** @type {number[]} */
  const largeData = [];
  for (const node of large) {
    const data = /** @type {Uint8Array} */ (node.data);
    node.start = chain(Math.ceil(data.length / sector));
    largeData.push(...data, ...new Array(Math.ceil(data.length / sector) * sector - data.length).fill(0));
  }
  if (fat.length > 128) throw new Error('test compound file too large for one FAT sector');

  /** @param {number} id */
  const entry = (id) => {
    const node = nodes[id];
    const out = new Uint8Array(128);
    const view = new DataView(out.buffer);
    const name = utf16le(node.name);
    out.set(name.subarray(0, 62));
    view.setUint16(64, Math.min(name.length, 62) + 2, true);
    out[66] = node.type;
    out[67] = 1;
    view.setUint32(68, 0xffffffff, true);
    // Right sibling: the next child of the same parent.
    const parent = nodes.find((other) => other.children.includes(id));
    const siblings = parent?.children ?? [];
    const next = siblings[siblings.indexOf(id) + 1];
    view.setUint32(72, id === 0 || next === undefined ? 0xffffffff : next, true);
    view.setUint32(76, node.children.length ? node.children[0] : 0xffffffff, true);
    if (id === 0) out.set(rootClsid, 80);
    view.setUint32(116, node.start, true);
    view.setUint32(120, node.size, true);
    return out;
  };
  const directory = new Uint8Array(dirSectors * sector);
  nodes.forEach((_, id) => directory.set(entry(id), id * 128));
  for (let id = nodes.length; id < dirSectors * 4; id += 1) {
    // Unused entries: empty, with no siblings or child.
    new DataView(directory.buffer).setUint32(id * 128 + 68, 0xffffffff, true);
    new DataView(directory.buffer).setUint32(id * 128 + 72, 0xffffffff, true);
    new DataView(directory.buffer).setUint32(id * 128 + 76, 0xffffffff, true);
  }

  const header = new Uint8Array(sector);
  const view = new DataView(header.buffer);
  header.set([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
  view.setUint16(24, 0x3e, true);
  view.setUint16(26, 3, true);
  view.setUint16(28, 0xfffe, true);
  view.setUint16(30, 9, true);
  view.setUint16(32, 6, true);
  view.setUint32(44, 1, true);
  view.setUint32(48, dirStart, true);
  view.setUint32(56, 4096, true);
  view.setUint32(60, miniFatSectors ? miniFatStart : 0xfffffffe, true);
  view.setUint32(64, miniFatSectors, true);
  view.setUint32(68, 0xfffffffe, true);
  view.setUint32(72, 0, true);
  for (let i = 0; i < 109; i += 1) view.setUint32(76 + i * 4, i === 0 ? 0 : 0xffffffff, true);
  const fatSector = new Uint8Array(sector).fill(0xff);
  fat.forEach((value, i) => new DataView(fatSector.buffer).setUint32(i * 4, value, true));
  const miniFatBytes = new Uint8Array(miniFatSectors * sector).fill(0xff);
  miniFat.forEach((value, i) => new DataView(miniFatBytes.buffer).setUint32(i * 4, value, true));
  const miniBytes = new Uint8Array(miniSectors * sector);
  miniBytes.set(mini);
  return join(header, fatSector, directory, miniFatBytes, miniBytes, largeData);
}

/**
 * A Windows shortcut (MS-SHLLINK): header, a LinkInfo with a local base path, and Unicode arguments.
 * @param {string} target
 * @param {string} args
 */
export function lnk(target, args) {
  const header = new Uint8Array(0x4c);
  const view = new DataView(header.buffer);
  view.setUint32(0, 0x4c, true);
  header.set([0x01, 0x14, 0x02, 0, 0, 0, 0, 0, 0xc0, 0, 0, 0, 0, 0, 0, 0x46], 4);
  // HasLinkInfo | HasArguments | IsUnicode
  view.setUint32(0x14, 0x02 | 0x20 | 0x80, true);
  const path = join(latin1(target), [0]);
  const volume = join(u32(0x11), u32(3), u32(0), u32(0x10), [0]);
  const infoHeader = 0x1c;
  const size = infoHeader + volume.length + path.length + 1;
  const info = join(u32(size), u32(infoHeader), u32(1), u32(infoHeader), u32(infoHeader + volume.length), u32(0), u32(size - 1), volume, path, [0]);
  const strings = join(u16(args.length), utf16le(args));
  return join(header, info, strings, u32(0));
}

/**
 * An ISO 9660 image: a primary volume descriptor, a terminator, a root directory and each file's data.
 * @param {{ name: string, data: Uint8Array, hidden?: boolean }[]} files  Names as stored, e.g. "README.TXT;1".
 */
export function iso(files) {
  const sector = 2048;
  const rootSector = 18;
  /** @param {number} lba @param {number} size @param {number} flags @param {Uint8Array} name */
  const record = (lba, size, flags, name) => {
    const length = 33 + name.length + (name.length % 2 === 0 ? 1 : 0);
    const out = new Uint8Array(length);
    out[0] = length;
    out.set([...u32(lba), ...u32(lba).reverse(), ...u32(size), ...u32(size).reverse()], 2);
    out[25] = flags;
    out.set([1, 0, 0, 1], 28);
    out[32] = name.length;
    out.set(name, 33);
    return out;
  };
  let next = rootSector + 1;
  const placed = files.map((file) => {
    const lba = next;
    next += Math.max(1, Math.ceil(file.data.length / sector));
    return { ...file, lba };
  });
  const directory = join(record(rootSector, sector, 2, Uint8Array.of(0)), record(rootSector, sector, 2, Uint8Array.of(1)), ...placed.map((file) => record(file.lba, file.data.length, file.hidden ? 1 : 0, latin1(file.name))));
  const image = new Uint8Array(next * sector);
  const pvd = new Uint8Array(sector);
  pvd.set([1, ...latin1('CD001'), 1]);
  pvd.set(record(rootSector, sector, 2, Uint8Array.of(0)), 156);
  image.set(pvd, 16 * sector);
  image.set([255, ...latin1('CD001'), 1], 17 * sector);
  image.set(directory, rootSector * sector);
  for (const file of placed) image.set(file.data, file.lba * sector);
  return image;
}

/* ---------- PDF (ISO 32000-1 §7.5), written here without the site's PDF code ---------- */

/**
 * One indirect object: its text between "obj" and "endobj", or a stream. A stream's dictionary text is written
 * without its brackets; `length` is what /Length says: a number, a reference written as text ("9 0 R"), or null
 * for no /Length (default: the data's real length).
 * @typedef {{ num: number, gen?: number, body?: string, stream?: { dict?: string, data: Uint8Array | string, length?: number | string | null, eol?: string } }} PdfPart
 */

/**
 * @typedef {object} PdfSpec
 * @property {PdfPart[]} [objects]
 * @property {{ num: number, objects: { num: number, body: string }[], deflate?: boolean }} [packed]  An object stream.
 * @property {'table' | 'stream' | 'none'} [xref]  How the section is written; "none" writes no cross-reference data.
 * @property {number[]} [widths]  /W of a cross-reference stream.
 * @property {boolean} [predictor]  Write the cross-reference stream with the PNG Up predictor (Columns = sum of /W).
 * @property {number} [xrefNum]  Object number of the cross-reference stream.
 * @property {number[]} [free]  Numbers this section marks free (deleted).
 * @property {string | null} [root]  /Root, default "1 0 R"; null leaves it out.
 * @property {string} [trailer]  More trailer entries, as text.
 * @property {number | null} [prev]  /Prev; default: the base's last section, if there is a base.
 * @property {number} [startxref]  Overrides the offset written after "startxref".
 * @property {string} [header]
 * @property {string} [junk]  Bytes before the header.
 * @property {boolean} [relative]  Write offsets counted from the header instead of from the start of the file.
 * @property {Uint8Array} [base]  Append to this file as an incremental update (§7.5.6).
 */

/** @param {Uint8Array | string} data */
const bytesOf = (data) => (typeof data === 'string' ? latin1(data) : data);

/** @param {PdfPart} part */
export function pdfObject({ num, gen = 0, body, stream }) {
  if (!stream) return latin1(`${num} ${gen} obj\n${body ?? 'null'}\nendobj\n`);
  const data = bytesOf(stream.data);
  const length = stream.length === undefined ? `/Length ${data.length}` : stream.length === null ? '' : `/Length ${stream.length}`;
  return join(latin1(`${num} ${gen} obj\n<< ${stream.dict ?? ''} ${length} >>\nstream${stream.eol ?? '\n'}`), data, latin1('\nendstream\nendobj\n'));
}

/** The offset after the last "startxref" of a file. @param {Uint8Array} file */
export function lastStartxref(file) {
  const text = String.fromCharCode(...file.subarray(Math.max(0, file.length - 64)));
  return Number(/startxref\s+(\d+)\s+%%EOF\s*$/.exec(text)?.[1]);
}

/**
 * A PDF, or an incremental update appended to one, with its cross-reference data computed from where each
 * object landed.
 * @param {PdfSpec} spec
 */
export function pdfFile(spec) {
  const { objects = [], packed, xref = 'table', widths = [1, 4, 2], free = [], root = '1 0 R', trailer = '', base, relative = false } = spec;
  /** @type {Uint8Array[]} */
  const parts = [];
  let length = 0;
  /** @param {Uint8Array} bytes */
  const add = (bytes) => {
    parts.push(bytes);
    length += bytes.length;
  };
  let origin = 0;
  if (base) {
    add(base);
  } else {
    if (spec.junk) add(latin1(spec.junk));
    origin = relative ? length : 0;
    add(join(latin1(`${spec.header ?? '%PDF-1.7'}\n%`), [0xe2, 0xe3, 0xcf, 0xd3], latin1('\n')));
  }
  /** @type {Map<number, number | [number, number] | null>} */
  const entries = new Map();
  for (const part of objects) {
    entries.set(part.num, length - origin);
    add(pdfObject(part));
  }
  if (packed) {
    const heads = [];
    let body = '';
    for (const object of packed.objects) {
      heads.push(`${object.num} ${body.length}`);
      body += `${object.body}\n`;
    }
    const head = `${heads.join(' ')}\n`;
    const raw = latin1(head + body);
    const deflate = packed.deflate ?? true;
    entries.set(packed.num, length - origin);
    add(pdfObject({ num: packed.num, stream: { dict: `/Type /ObjStm /N ${packed.objects.length} /First ${head.length}${deflate ? ' /Filter /FlateDecode' : ''}`, data: deflate ? deflateSync(raw) : raw } }));
    packed.objects.forEach((object, index) => entries.set(object.num, [packed.num, index]));
  }
  for (const num of free) entries.set(num, null);
  const prev = spec.prev !== undefined ? spec.prev : base ? lastStartxref(base) : null;
  const tail = `${root === null ? '' : ` /Root ${root}`}${prev === null ? '' : ` /Prev ${prev}`} ${trailer}`;
  const at = length - origin;
  if (xref === 'table') {
    if (!base) entries.set(0, null);
    const numbers = [...entries.keys()].sort((a, b) => a - b);
    let text = 'xref\n';
    for (let i = 0; i < numbers.length; ) {
      let j = i;
      while (j + 1 < numbers.length && numbers[j + 1] === numbers[j] + 1) j += 1;
      text += `${numbers[i]} ${j - i + 1}\n`;
      for (let k = i; k <= j; k += 1) {
        const value = entries.get(numbers[k]);
        if (Array.isArray(value)) throw new Error('a classic table cannot list packed objects');
        text += value === null || value === undefined ? `0000000000 ${numbers[k] === 0 ? 65535 : '00001'} f\r\n` : `${String(value).padStart(10, '0')} 00000 n\r\n`;
      }
      i = j + 1;
    }
    const size = Math.max(...numbers) + 1;
    add(latin1(`${text}trailer\n<< /Size ${size}${tail} >>\nstartxref\n${spec.startxref ?? at}\n%%EOF\n`));
  } else if (xref === 'stream') {
    const num = spec.xrefNum ?? Math.max(0, ...entries.keys()) + 1;
    entries.set(num, at);
    if (!base) entries.set(0, null);
    const numbers = [...entries.keys()].sort((a, b) => a - b);
    const index = [];
    for (let i = 0; i < numbers.length; ) {
      let j = i;
      while (j + 1 < numbers.length && numbers[j + 1] === numbers[j] + 1) j += 1;
      index.push(numbers[i], j - i + 1);
      i = j + 1;
    }
    /** @param {number} value @param {number} width */
    const field = (value, width) => Array.from({ length: width }, (_, i) => Math.floor(value / 256 ** (width - 1 - i)) % 256);
    const rows = numbers.map((n) => {
      const value = entries.get(n);
      const [type, second, third] = value === null || value === undefined ? [0, 0, n === 0 ? 65535 : 1] : Array.isArray(value) ? [2, value[0], value[1]] : [1, value, 0];
      // With a type field of width 0, every entry is type 1 (§7.5.8.2): free entries are written as offset 0.
      return [...(widths[0] === 0 ? [] : field(type, widths[0])), ...field(widths[0] === 0 && type !== 1 ? 0 : second, widths[1]), ...field(widths[0] === 0 && type !== 1 ? 0 : third, widths[2])];
    });
    const columns = widths.reduce((a, b) => a + b, 0);
    const raw = spec.predictor ? pngUp(rows, columns) : Uint8Array.from(rows.flat());
    const parms = spec.predictor ? ` /DecodeParms << /Columns ${columns} /Predictor 12 >>` : '';
    const size = Math.max(...numbers) + 1;
    add(pdfObject({ num, stream: { dict: `/Type /XRef /Size ${size} /W [${widths.join(' ')}] /Index [${index.join(' ')}] /Filter /FlateDecode${parms}${tail}`, data: deflateSync(raw) } }));
    add(latin1(`startxref\n${spec.startxref ?? at}\n%%EOF\n`));
  } else {
    add(latin1(`trailer\n<< /Size 1${tail} >>\n%%EOF\n`));
  }
  return join(...parts);
}

/** Rows written with the PNG "Up" predictor, each with its tag byte (RFC 2083 §6). @param {number[][]} rows @param {number} columns */
export function pngUp(rows, columns) {
  const out = [];
  let above = new Array(columns).fill(0);
  for (const row of rows) {
    out.push(2, ...row.map((byte, i) => (byte - above[i] + 256) % 256));
    above = row;
  }
  return Uint8Array.from(out);
}

/**
 * A catalog, a page tree and simple pages; objects 1 (catalog), 2 (pages), then each page and its content.
 * @param {number} count
 * @param {Partial<PdfSpec>} [spec]
 */
export function simplePdf(count, spec = {}) {
  /** @type {PdfPart[]} */
  const objects = [{ num: 1, body: '<< /Type /Catalog /Pages 2 0 R >>' }];
  const kids = [];
  for (let i = 0; i < count; i += 1) {
    const page = 3 + i * 2;
    kids.push(`${page} 0 R`);
    objects.push({ num: page, body: `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents ${page + 1} 0 R /Resources << >> >>` });
    objects.push({ num: page + 1, stream: { data: `BT /F1 12 Tf 72 720 Td (Page ${i + 1}) Tj ET` } });
  }
  objects.splice(1, 0, { num: 2, body: `<< /Type /Pages /Kids [${kids.join(' ')}] /Count ${count} >>` });
  return pdfFile({ objects, ...spec });
}

/**
 * LZW as §7.4.4.2 describes the encoder: a clear code first, 9- to 12-bit codes high bit first, widths growing one
 * code early when `early` is 1, a clear code when the table is full, and EOD.
 * @param {Uint8Array} input @param {0 | 1} [early]
 */
export function lzwEncode(input, early = 1) {
  /** @type {Map<string, number>} */
  let table = new Map();
  let next = 258;
  let width = 9;
  /** @type {number[]} */
  const out = [];
  let buffer = 0;
  let bits = 0;
  /** @param {number} code */
  const put = (code) => {
    buffer = buffer * 2 ** width + code;
    bits += width;
    while (bits >= 8) {
      out.push(Math.floor(buffer / 2 ** (bits - 8)) & 0xff);
      bits -= 8;
      buffer %= 2 ** bits;
    }
  };
  let sinceReset = 0;
  const reset = () => {
    table = new Map();
    next = 258;
    width = 9;
    sinceReset = 0;
  };
  put(256);
  let current = '';
  for (const byte of input) {
    const extended = current + String.fromCharCode(byte);
    if (current === '' || (extended.length > 1 && table.has(extended))) {
      current = extended;
      continue;
    }
    put(current.length === 1 ? current.charCodeAt(0) : /** @type {number} */ (table.get(current)));
    sinceReset += 1;
    table.set(extended, next);
    next += 1;
    if (next + early > 2 ** width && width < 12) width += 1;
    if (next === 4096 - early) {
      put(256);
      reset();
    }
    current = String.fromCharCode(byte);
  }
  if (current) {
    put(current.length === 1 ? current.charCodeAt(0) : /** @type {number} */ (table.get(current)));
    // The decoder adds an entry after this code (unless it is the first since a clear), which may widen EOD.
    if (sinceReset > 0 && next + early >= 2 ** width && width < 12) width += 1;
  }
  put(257);
  if (bits > 0) out.push(Math.floor(buffer * 2 ** (8 - bits)) & 0xff);
  return Uint8Array.from(out);
}

/** ASCII85 as §7.4.3 describes the encoder, with "z" for whole zero groups and "~>" at the end. @param {Uint8Array} input */
export function ascii85Encode(input) {
  let out = '';
  for (let i = 0; i < input.length; i += 4) {
    const group = [...input.subarray(i, i + 4)];
    const n = group.length;
    while (group.length < 4) group.push(0);
    let value = ((group[0] * 256 + group[1]) * 256 + group[2]) * 256 + group[3];
    if (n === 4 && value === 0) {
      out += 'z';
      continue;
    }
    const digits = [];
    for (let k = 0; k < 5; k += 1) {
      digits.unshift(String.fromCharCode((value % 85) + 33));
      value = Math.floor(value / 85);
    }
    out += digits.slice(0, n + 1).join('');
  }
  return `${out}~>`;
}

/* ---------- Pictures: JPEG and PNG ---------- */

/** @param {number} marker @param {number[] | Uint8Array} data */
export const segment = (marker, data) => join([0xff, marker, (data.length + 2) >> 8, (data.length + 2) & 0xff], data);
/** JFIF with a density: units 1 = per inch, 2 = per centimetre. @param {number} units @param {number} x @param {number} [y] */
export const jfif = (units, x, y = x) => segment(0xe0, join(latin1('JFIF\0'), [1, 2, units, x >> 8, x & 0xff, y >> 8, y & 0xff, 0, 0]));
/** A frame header: precision, height, width, components. */
const frame = (/** @type {number} */ marker, /** @type {{ bits?: number, width: number, height: number, components?: number }} */ { bits = 8, width, height, components = 3 }) =>
  segment(marker, [bits, height >> 8, height & 0xff, width >> 8, width & 0xff, components, ...Array.from({ length: components }, (_, i) => [i + 1, 0x11, 0]).flat()]);
export const TABLES = join(segment(0xdb, [0, ...new Array(64).fill(1)]), segment(0xc4, [0, ...new Array(16).fill(0)]));
// Scan data with a stuffed 0xFF00 and a restart marker, which are not segments.
export const SCAN = join(segment(0xda, [1, 1, 0, 0, 0x3f, 0]), [0x12, 0xff, 0x00, 0x34, 0xff, 0xd0, 0x56]);
/** @param {{ width?: number, height?: number, components?: number, marker?: number, bits?: number, head?: Uint8Array[], tail?: number[] }} [spec] */
export function jpegFile({ width = 40, height = 30, components = 3, marker = 0xc0, bits = 8, head = [jfif(1, 300)], tail = [] } = {}) {
  return join([0xff, 0xd8], ...head, TABLES, frame(marker, { bits, width, height, components }), SCAN, [0xff, 0xd9], tail);
}

/** @param {string} type @param {Uint8Array | number[]} data */
export const chunk = (type, data) => {
  const crc = crc32(join(latin1(type), data));
  return join(be32(data.length), latin1(type), data, be32(crc));
};
/** @param {number} n */
export const be32 = (n) => [n >>> 24, (n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
/** @param {{ width?: number, height?: number, colorType?: number, bitDepth?: number, interlace?: number, extra?: Uint8Array[] }} [spec] */
export function pngFile({ width = 3, height = 2, colorType = 2, bitDepth = 8, interlace = 0, extra = [] } = {}) {
  const channels = colorType === 0 ? 1 : colorType === 2 ? 3 : 4;
  const raw = new Uint8Array(height * (1 + width * channels)).map((_, i) => (i % (1 + width * channels) === 0 ? 0 : (i * 37) & 0xff));
  const z = deflateSync(raw);
  return join([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], chunk('IHDR', [...be32(width), ...be32(height), bitDepth, colorType, 0, 0, interlace]), ...extra,
    chunk('IDAT', z.subarray(0, 5)), chunk('IDAT', z.subarray(5)), chunk('IEND', []));
}

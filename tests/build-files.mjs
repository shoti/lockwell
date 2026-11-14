// @ts-check
/**
 * @file Builds small test files byte by byte, from the format specifications, independently of the site's readers:
 * ZIP (APPNOTE 6.3.10 §4.3), compound files (MS-CFB §2), Windows shortcuts (MS-SHLLINK §2) and ISO 9660 images
 * (ECMA-119). No real-world sample is used: nothing here can run.
 */
import { crc32, deflateRawSync } from 'node:zlib';

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

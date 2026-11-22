// @ts-check
/**
 * @file Reading IP addresses written in mail headers and naming the special ranges they fall in.
 */
/**
 * Ranges from the IANA IPv4 and IPv6 Special-Purpose Address Registries (both updated 2025-10-09, read 2026-11-22;
 * docs/research/tool-email-headers.md §9). An address in none of them is "public". Multicast (224.0.0.0/4, ff00::/8)
 * is not in those registries and is reported as "public" too: it never appears as a sender.
 */

/**
 * @typedef {'public' | 'private' | 'shared' | 'loopback' | 'linkLocal' | 'documentation' | 'uniqueLocal' | 'thisNetwork'
 *   | 'protocol' | 'benchmarking' | 'relay' | 'reserved' | 'broadcast' | 'unspecified' | 'translation' | 'discard'
 *   | 'teredo' | 'sixToFour' | 'srv6'} IpClass
 *
 * @typedef {object} Ip
 * @property {4 | 6} family
 * @property {Uint8Array} bytes  4 or 16 bytes.
 * @property {string} text  The address in its usual short form ("192.0.2.1", "2001:db8::1").
 */

/** Addresses of a network inside an organisation or a home, not on the open internet. */
export const INTERNAL = new Set(/** @type {IpClass[]} */ (['private', 'shared', 'loopback', 'linkLocal', 'uniqueLocal']));

/** @type {[string, number, IpClass][]} */
const V4_RANGES = [
  ['0.0.0.0', 8, 'thisNetwork'],
  ['10.0.0.0', 8, 'private'],
  ['100.64.0.0', 10, 'shared'],
  ['127.0.0.0', 8, 'loopback'],
  ['169.254.0.0', 16, 'linkLocal'],
  ['172.16.0.0', 12, 'private'],
  ['192.0.0.0', 24, 'protocol'],
  ['192.0.2.0', 24, 'documentation'],
  ['192.31.196.0', 24, 'protocol'], // AS112-v4 (added after review E28, like the three below)
  ['192.52.193.0', 24, 'protocol'], // AMT
  ['192.88.99.0', 24, 'relay'],
  ['192.168.0.0', 16, 'private'],
  ['192.175.48.0', 24, 'protocol'], // Direct Delegation AS112 Service
  ['198.18.0.0', 15, 'benchmarking'],
  ['198.51.100.0', 24, 'documentation'],
  ['203.0.113.0', 24, 'documentation'],
  ['255.255.255.255', 32, 'broadcast'],
  ['240.0.0.0', 4, 'reserved'],
];

/** @type {[string, number, IpClass][]} IPv4-mapped addresses (::ffff:0:0/96) are classed by the IPv4 address they carry. */
const V6_RANGES = [
  ['::1', 128, 'loopback'],
  ['::', 128, 'unspecified'],
  ['64:ff9b::', 96, 'translation'],
  ['64:ff9b:1::', 48, 'translation'],
  ['100::', 64, 'discard'],
  ['100:0:0:1::', 64, 'protocol'], // Dummy IPv6 Prefix (review E28, like the ones below)
  ['2001:db8::', 32, 'documentation'],
  ['2001::', 32, 'teredo'],
  ['2001:2::', 48, 'benchmarking'],
  ['2001::', 23, 'protocol'], // IETF Protocol Assignments: AMT, AS112-v6, ORCHIDv2, DETs and the anycast addresses
  ['2620:4f:8000::', 48, 'protocol'], // Direct Delegation AS112 Service
  ['2002::', 16, 'sixToFour'],
  ['3fff::', 20, 'documentation'],
  ['5f00::', 16, 'srv6'],
  ['fc00::', 7, 'uniqueLocal'],
  ['fe80::', 10, 'linkLocal'],
];

/**
 * Four decimal parts, each 0 to 255, no leading zeros (an old reader would take "010" as octal).
 * @param {string} text
 * @returns {Uint8Array | null}
 */
function parseV4(text) {
  const parts = text.split('.');
  if (parts.length !== 4) return null;
  const bytes = new Uint8Array(4);
  for (let i = 0; i < 4; i += 1) {
    const part = parts[i];
    if (!/^\d{1,3}$/.test(part) || (part.length > 1 && part[0] === '0')) return null;
    const value = Number(part);
    if (value > 255) return null;
    bytes[i] = value;
  }
  return bytes;
}

/**
 * Eight groups of up to four hex digits, "::" for a run of zero groups, and optionally an IPv4 address at the end.
 * @param {string} text
 * @returns {Uint8Array | null}
 */
function parseV6(text) {
  if (text.length > 45 || !/^[0-9a-f:.]+$/i.test(text)) return null;
  const halves = text.split('::');
  if (halves.length > 2) return null;
  /** @param {string} half @returns {number[] | null} */
  const groups = (half) => {
    if (half === '') return [];
    /** @type {number[]} */
    const out = [];
    const parts = half.split(':');
    for (let i = 0; i < parts.length; i += 1) {
      const part = parts[i];
      if (i === parts.length - 1 && part.includes('.')) {
        const v4 = parseV4(part);
        if (!v4) return null;
        out.push((v4[0] << 8) | v4[1], (v4[2] << 8) | v4[3]);
      } else if (/^[0-9a-f]{1,4}$/i.test(part)) {
        out.push(parseInt(part, 16));
      } else {
        return null;
      }
    }
    return out;
  };
  const head = groups(halves[0]);
  const tail = halves.length === 2 ? groups(halves[1]) : [];
  if (!head || !tail) return null;
  // An IPv4 part may only end the address.
  if (halves.length === 2 && halves[0].includes('.')) return null;
  const missing = 8 - head.length - tail.length;
  if (halves.length === 1 ? missing !== 0 : missing < 1) return null;
  const all = [...head, ...new Array(halves.length === 2 ? missing : 0).fill(0), ...tail];
  return Uint8Array.from(all.flatMap((group) => [group >> 8, group & 0xff]));
}

/** @param {Uint8Array} bytes */
const v4Text = (bytes) => Array.from(bytes).join('.');

/**
 * The short form of RFC 5952: lowercase, no leading zeros, the longest run of two or more zero groups as "::".
 * @param {Uint8Array} bytes
 */
function v6Text(bytes) {
  const groups = Array.from({ length: 8 }, (_, i) => (bytes[i * 2] << 8) | bytes[i * 2 + 1]);
  let [bestStart, bestLength] = [-1, 0];
  for (let i = 0; i < 8; ) {
    if (groups[i] !== 0) {
      i += 1;
      continue;
    }
    let j = i;
    while (j < 8 && groups[j] === 0) j += 1;
    if (j - i > bestLength && j - i >= 2) [bestStart, bestLength] = [i, j - i];
    i = j;
  }
  // An IPv4 address carried in IPv6 (::ffff:0:0/96) is written with its dots: ::ffff:10.0.0.1 (RFC 5952 §5; review E28).
  if (groups.slice(0, 5).every((group) => group === 0) && groups[5] === 0xffff) return `::ffff:${v4Text(bytes.subarray(12))}`;
  const hex = groups.map((group) => group.toString(16));
  if (bestStart === -1) return hex.join(':');
  return `${hex.slice(0, bestStart).join(':')}::${hex.slice(bestStart + bestLength).join(':')}`;
}

/**
 * Reads an IP address as mail headers write it: bare, in brackets ("[192.0.2.1]"), with RFC 5321's "IPv6:" tag
 * ("[IPv6:2001:db8::1]") or with a zone ("fe80::1%eth0").
 * @param {string} input
 * @returns {Ip | null}
 */
export function parseIp(input) {
  let text = input.trim();
  if (text.startsWith('[') && text.endsWith(']')) text = text.slice(1, -1).trim();
  if (/^ipv6:/i.test(text)) text = text.slice(5);
  const zone = text.indexOf('%');
  if (zone > 0 && text.includes(':')) text = text.slice(0, zone);
  const v4 = parseV4(text);
  if (v4) return { family: 4, bytes: v4, text: v4Text(v4) };
  if (!text.includes(':')) return null;
  const v6 = parseV6(text);
  return v6 ? { family: 6, bytes: v6, text: v6Text(v6) } : null;
}

/**
 * True when the first `length` bits of the two addresses agree.
 * @param {Uint8Array} bytes
 * @param {Uint8Array} prefix
 * @param {number} length
 */
function inRange(bytes, prefix, length) {
  for (let bit = 0; bit < length; bit += 1) {
    const mask = 0x80 >> bit % 8;
    if ((bytes[bit >> 3] & mask) !== (prefix[bit >> 3] & mask)) return false;
  }
  return true;
}

/** @type {{ v4: [Uint8Array, number, IpClass][], v6: [Uint8Array, number, IpClass][] } | null} */
let ranges = null;

/** The ranges as bytes, read once. */
function rangeBytes() {
  ranges ??= {
    v4: V4_RANGES.map(([prefix, length, name]) => [/** @type {Ip} */ (parseIp(prefix)).bytes, length, name]),
    v6: V6_RANGES.map(([prefix, length, name]) => [/** @type {Ip} */ (parseIp(prefix)).bytes, length, name]),
  };
  return ranges;
}

/**
 * Which special range an address is in, or "public".
 * @param {Ip} ip
 * @returns {IpClass}
 */
export function ipClass(ip) {
  const { v4, v6 } = rangeBytes();
  let { bytes, family } = ip;
  // ::ffff:a.b.c.d is an IPv4 address written for IPv6.
  if (family === 6 && bytes.subarray(0, 10).every((byte) => byte === 0) && bytes[10] === 0xff && bytes[11] === 0xff) {
    bytes = bytes.subarray(12);
    family = 4;
  }
  const table = family === 4 ? v4 : v6;
  return table.find(([prefix, length]) => inRange(bytes, prefix, length))?.[2] ?? 'public';
}

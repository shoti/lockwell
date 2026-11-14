// @ts-check
/**
 * @file Reading XMP metadata (location, device, people, dates) from the text of an XMP packet.
 */
import { dateTime, device, joinValues, oneLine } from './metadata-text.mjs';

/** The most XMP text read: real packets are a few kilobytes. */
export const MAX_XMP = 256 * 1024;
/** What a blanked XMP item holds: an empty, well-formed packet. */
export const EMPTY_XMP = '<x:xmpmeta xmlns:x="adobe:ns:meta/"/>';

/** @param {string} text */
function unescapeXml(text) {
  /** @type {Record<string, string>} */
  const named = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
  return text.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (whole, name) => {
    if (name[0] !== '#') return named[name.toLowerCase()] ?? whole;
    const code = name[1] === 'x' || name[1] === 'X' ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10);
    return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : '';
  });
}

/**
 * The values of one XMP property, written either as an attribute or as an
 * element (plain, or a list of rdf:li). Elements are found with indexOf, so a
 * packet built of unclosed tags takes linear time, not quadratic.
 * @param {string} xmp
 * @param {string} name  With its usual prefix, e.g. "exif:GPSLatitude".
 */
function xmpValues(xmp, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const out = [];
  for (const match of xmp.matchAll(new RegExp(`\\s${escaped}\\s*=\\s*(["'])([^"']*)\\1`, 'g'))) out.push(match[2]);
  const open = new RegExp(`<${escaped}(?=[\\s/>])[^>]*>`, 'g');
  const close = `</${name}>`;
  for (let match = open.exec(xmp); match; match = open.exec(xmp)) {
    if (match[0].endsWith('/>')) continue;
    const end = xmp.indexOf(close, open.lastIndex);
    // No closing tag after this one means none after any later one either.
    if (end === -1) break;
    const inner = xmp.slice(open.lastIndex, end);
    const items = [...inner.matchAll(/<rdf:li(?:\s[^>]*)?>([^<]*)<\/rdf:li>/g)].map((item) => item[1]);
    out.push(...(items.length ? items : [inner]));
    open.lastIndex = end + close.length;
  }
  return out.map((value) => oneLine(unescapeXml(value.replace(/<[^>]*>/g, '')))).filter(Boolean);
}

/**
 * "41,42.906N" or "33,51,35.9S" (CIPA DC-010 §A.2.4.4) → signed degrees.
 * @param {string | undefined} value
 */
function xmpCoordinate(value) {
  const match = /^(\d+(?:\.\d+)?),(\d+(?:\.\d+)?)(?:,(\d+(?:\.\d+)?))?([NSEW])$/i.exec(value?.trim() ?? '');
  if (!match) return null;
  const degrees = Number(match[1]) + Number(match[2]) / 60 + Number(match[3] ?? 0) / 3600;
  return /[SW]/i.test(match[4]) ? -degrees : degrees;
}

/** "5125/10" → 512.5 @param {string | undefined} value */
function xmpRational(value) {
  const match = /^(-?\d+)(?:\/(\d+))?$/.exec(value?.trim() ?? '');
  if (!match || match[2] === '0') return null;
  return Number(match[1]) / Number(match[2] ?? 1);
}

/**
 * Reads XMP: the same kinds of values as EXIF, plus place names and captions.
 * @param {string} xmp
 */
export function parseXmp(xmp) {
  /** @param {...string} names  The first property with a value wins. */
  const first = (...names) => {
    for (const name of names) {
      const [value] = xmpValues(xmp, name);
      if (value) return value;
    }
    return '';
  };
  /** @param {...string} names  All values of all of them. */
  const all = (...names) => joinValues(names.flatMap((name) => xmpValues(xmp, name)));

  const latText = first('exif:GPSLatitude');
  const lonText = first('exif:GPSLongitude');
  const lat = xmpCoordinate(latText);
  const lon = xmpCoordinate(lonText);
  const altitude = xmpRational(first('exif:GPSAltitude'));
  const direction = xmpRational(first('exif:GPSImgDirection'));
  /** @type {Record<string, string>} */
  const fields = {
    camera: device(first('tiff:Make'), first('tiff:Model')),
    lens: first('exifEX:LensModel', 'aux:Lens'),
    serial: first('exifEX:BodySerialNumber', 'aux:SerialNumber'),
    lensSerial: first('exifEX:LensSerialNumber', 'aux:LensSerialNumber'),
    owner: first('exifEX:CameraOwnerName', 'aux:OwnerName'),
    artist: all('dc:creator', 'tiff:Artist', 'exifEX:Photographer'),
    copyright: first('dc:rights'),
    uniqueId: first('exif:ImageUniqueID', 'exifEX:ImageUniqueID'),
    taken: dateTime(first('exif:DateTimeOriginal', 'photoshop:DateCreated', 'xmp:CreateDate')),
    software: first('xmp:CreatorTool'),
    altitude: altitude === null ? '' : String(Math.round(first('exif:GPSAltitudeRef') === '1' ? -altitude : altitude)),
    direction: direction === null ? '' : String(Math.round(direction) % 360),
    caption: first('dc:description'),
    keywords: all('dc:subject'),
    place: all('Iptc4xmpCore:Location', 'photoshop:City', 'photoshop:State', 'photoshop:Country'),
  };
  for (const key of Object.keys(fields)) if (!fields[key]) delete fields[key];
  return {
    fields,
    location: lat !== null && lon !== null && Math.abs(lat) <= 90 && Math.abs(lon) <= 180 && !(lat === 0 && lon === 0) ? { lat, lon } : null,
    // Ultra HDR and other gain-map photos declare the gain map here.
    hdr: xmp.includes('http://ns.adobe.com/hdr-gain-map/1.0/'),
    // Anything beyond an empty packet: editing history, descriptions, tool settings.
    content: xmp.trim() !== '' && xmp.replace(/\s+/g, '') !== EMPTY_XMP.replace(/\s+/g, ''),
    /** The coordinates as written, to search the clean copy for. */
    coordinates: [latText, lonText].filter(Boolean),
  };
}

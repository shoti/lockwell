// @ts-check
/**
 * @file Tests for telling what a file really is from its bytes.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { detectType, textType } from '../src/client/file-type.mjs';

/** @param {string} text */
const ascii = (text) => Array.from(text, (char) => char.charCodeAt(0));
/** @param {...(number[] | Uint8Array)} parts */
const blob = (...parts) => new Blob([Uint8Array.from(parts.flatMap((part) => [...part]))]);
/** @param {Blob} file */
const kindOf = async (file) => {
  const { kind, group } = await detectType(file);
  return `${kind}/${group}`;
};

describe('detectType', () => {
  it('knows programs, shortcuts and installers by their first bytes, whatever the name', async () => {
    assert.equal(await kindOf(blob(ascii('MZ'), new Array(100).fill(0))), 'exe/program');
    assert.equal(await kindOf(blob([0x7f, 0x45, 0x4c, 0x46, 2, 1])), 'elf/program');
    assert.equal(await kindOf(blob([0xcf, 0xfa, 0xed, 0xfe, 7, 0, 0, 1])), 'macho/program');
    assert.equal(await kindOf(blob([0xca, 0xfe, 0xba, 0xbe, 0, 0, 0, 2])), 'macho/program', 'a universal Mach-O with two architectures');
    assert.equal(await kindOf(blob([0xca, 0xfe, 0xba, 0xbe, 0, 0, 0, 61])), 'javaClass/program', 'a Java class file, version 61');
    const lnk = [0x4c, 0, 0, 0, 0x01, 0x14, 0x02, 0, 0, 0, 0, 0, 0xc0, 0, 0, 0, 0, 0, 0, 0x46];
    assert.equal(await kindOf(blob(lnk, new Array(60).fill(0))), 'lnk/shortcut');
    assert.equal(await kindOf(blob(ascii('ITSF'), [3, 0, 0, 0])), 'chm/program');
  });

  it('knows archives, documents and disk images', async () => {
    assert.equal(await kindOf(blob([0x50, 0x4b, 0x03, 0x04, 20, 0])), 'zip/archive');
    assert.equal(await kindOf(blob(ascii('Rar!'), [0x1a, 0x07, 0x01, 0x00])), 'rar/archive');
    assert.equal(await kindOf(blob([0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c, 0, 4])), '7z/archive');
    assert.equal(await kindOf(blob(new Array(257).fill(0), ascii('ustar'), [0, 0x30, 0x30])), 'tar/archive');
    assert.equal(await kindOf(blob([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])), 'cfb/document');
    assert.equal(await kindOf(blob(ascii('{\\rtf1\\ansi'))), 'rtf/document');
    assert.equal(await kindOf(blob(ascii('junk\r\n%PDF-1.7\n'))), 'pdf/document', 'a PDF may follow a few bytes of junk');
    assert.equal(await kindOf(blob(ascii('vhdxfile'), new Array(8).fill(0))), 'vhdx/diskImage');
    const iso = new Uint8Array(0x8800);
    iso.set([1, ...ascii('CD001'), 1], 0x8000);
    assert.equal(await kindOf(new Blob([iso])), 'iso/diskImage', 'an ISO image is known by its volume descriptor, 32 KB in');
    const vhd = new Uint8Array(2048);
    vhd.set(ascii('conectix'), 2048 - 512);
    assert.equal(await kindOf(new Blob([vhd])), 'vhd/diskImage', 'a VHD is known by its footer');
  });

  it('knows pictures, sound and video (WHATWG MIME Sniffing tables)', async () => {
    assert.equal(await kindOf(blob([0xff, 0xd8, 0xff, 0xe0])), 'jpeg/picture');
    assert.equal(await kindOf(blob([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])), 'png/picture');
    assert.equal(await kindOf(blob(ascii('RIFF'), [1, 2, 3, 4], ascii('WEBPVP8 '))), 'webp/picture');
    assert.equal(await kindOf(blob([0, 0, 0, 24], ascii('ftypheic'), [0, 0, 0, 0])), 'heif/picture');
    assert.equal(await kindOf(blob([0, 0, 0, 20], ascii('ftypqt  '), [0, 0, 0, 0])), 'mp4/video');
    assert.equal(await kindOf(blob([0, 0, 0, 8], ascii('wide'))), 'mp4/video', 'a QuickTime file without ftyp');
    assert.equal(await kindOf(blob(ascii('ID3'), [4, 0, 0])), 'mp3/audio');
    assert.equal(await kindOf(blob(ascii('OggS'), [0, 2])), 'ogg/audio');
  });

  it('reads text to tell web pages, shortcuts and profiles from plain text', async () => {
    assert.equal(await kindOf(blob(ascii('  \n<!DOCTYPE html><html><body>Log in</body></html>'))), 'html/web');
    assert.equal(await kindOf(blob([0xef, 0xbb, 0xbf], ascii('<html lang="en">'))), 'html/web', 'after a byte order mark');
    assert.equal(await kindOf(blob(ascii('<?xml version="1.0"?>\n<svg xmlns="http://www.w3.org/2000/svg"><script>x()</script></svg>'))), 'svg/web');
    assert.equal(await kindOf(blob(ascii('[InternetShortcut]\r\nURL=https://example.com/\r\n'))), 'url/shortcut');
    assert.equal(await kindOf(blob(ascii('#!/bin/sh\nrm -rf ~\n'))), 'shebang/script');
    assert.equal(await kindOf(blob(ascii('Meeting at 6, bring the documents.'))), 'text/text');
    const utf16 = Uint8Array.from([0xff, 0xfe, ...ascii('<html>').flatMap((c) => [c, 0])]);
    assert.equal(await kindOf(new Blob([utf16])), 'html/web', 'UTF-16 text is still text');
  });

  it('does not take near misses or short files for something they are not', async () => {
    assert.equal(await kindOf(blob(ascii('MX'))), 'text/text');
    assert.equal(await kindOf(blob([0x50, 0x4b, 0x03])), 'unknown/unknown', 'cut off before the signature ends, and not text');
    assert.equal(await kindOf(blob(ascii('<a'))), 'text/text', 'a tag name must be followed by a space or ">"');
    assert.equal(await kindOf(new Blob([])), 'empty/unknown');
    assert.equal(await kindOf(blob([0, 1, 2, 3, 0xff, 0xfe, 0xfd])), 'unknown/unknown');
  });
});

describe('textType', () => {
  it('knows Windows search connectors, libraries and Apple configuration profiles', () => {
    assert.equal(textType('<?xml version="1.0"?>\n<searchConnectorDescription xmlns="x">').kind, 'searchMs');
    assert.equal(textType('<?xml version="1.0"?>\n<libraryDescription xmlns="x">').kind, 'libraryMs');
    const profile = '<?xml version="1.0"?><!DOCTYPE plist><plist version="1.0"><dict><key>PayloadContent</key><array/></dict></plist>';
    assert.deepEqual(textType(profile), { kind: 'mobileconfig', group: 'program' });
  });
});

// @ts-check
/**
 * @file Tests for reading compound files (.doc, .xls, .msg, .msi): directory and streams, and hostile layouts.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { CfbError, isCfb, readCfb } from '../src/client/cfb.mjs';
import { cfb, latin1 } from './build-files.mjs';

describe('readCfb', () => {
  it('lists storages and streams with their paths, and reads small and large streams', () => {
    const large = Uint8Array.from({ length: 5000 }, (_, i) => i % 251);
    const bytes = cfb([
      { path: 'WordDocument', data: latin1('word data') },
      { path: 'Macros/VBA/dir', data: latin1('vba') },
      { path: 'Macros/PROJECT', data: latin1('ID="{1}"') },
      { path: 'Data', data: large },
    ]);
    assert.ok(isCfb(bytes));
    const file = readCfb(bytes);
    assert.deepEqual(file.entries.map((entry) => `${entry.type}:${entry.path}`).sort(), ['root:', 'storage:Macros', 'storage:Macros/VBA', 'stream:Data', 'stream:Macros/PROJECT', 'stream:Macros/VBA/dir', 'stream:WordDocument']);
    const stream = (/** @type {string} */ path) => file.read(/** @type {import('../src/client/cfb.mjs').CfbEntry} */ (file.entries.find((entry) => entry.path === path)), 1e6);
    assert.equal(String.fromCharCode(...stream('WordDocument')), 'word data', 'from the mini stream');
    assert.equal(String.fromCharCode(...stream('Macros/PROJECT')), 'ID="{1}"');
    assert.deepEqual(stream('Data'), large, 'from regular sectors');
  });

  it('reads the root class ID', () => {
    const clsid = [0x84, 0x10, 0x0c, 0, 0, 0, 0, 0, 0xc0, 0, 0, 0, 0, 0, 0, 0x46];
    assert.equal(readCfb(cfb([{ path: 'x', data: latin1('1') }], { rootClsid: clsid })).entries[0].clsid, '84100c0000000000c000000000000046');
  });

  it('refuses a stream larger than the caller allows', () => {
    const file = readCfb(cfb([{ path: 'Big', data: new Uint8Array(6000) }]));
    assert.throws(() => file.read(file.entries[1], 1000), CfbError);
  });

  it('throws CfbError, never loops, on sector chains and directory trees that loop', () => {
    const bytes = cfb([{ path: 'A', data: new Uint8Array(5000) }]);
    // The FAT is sector 0, right after the 512-byte header. Point the directory's sector (1) at itself.
    const looped = bytes.slice();
    new DataView(looped.buffer).setUint32(512 + 4, 1, true);
    assert.throws(() => readCfb(looped), CfbError);
    // The root entry's child is the stream (1); make the stream its own right sibling.
    const tree = bytes.slice();
    new DataView(tree.buffer).setUint32(1024 + 128 + 72, 1, true);
    assert.throws(() => readCfb(tree), CfbError);
  });

  it('throws CfbError for files that are cut short or not compound files', () => {
    const bytes = cfb([{ path: 'A', data: new Uint8Array(5000) }]);
    assert.throws(() => readCfb(bytes.subarray(0, 700)), CfbError);
    assert.throws(() => readCfb(latin1('not a compound file at all, just text').slice()), CfbError);
    for (let cut = 0; cut < bytes.length; cut += 97) {
      try {
        const file = readCfb(bytes.subarray(0, cut));
        for (const entry of file.entries) file.read(entry, 1e6);
      } catch (error) {
        assert.ok(error instanceof CfbError, `cut at ${cut}: ${error}`);
      }
    }
  });
});

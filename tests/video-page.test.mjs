// @ts-check
/**
 * @file Tests for the video metadata page: its wiring, driven with the small fake DOM.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { FakeElement, installDom } from './fake-dom.mjs';
import { exampleVideo, init } from '../src/client/tool-video.mjs';

const VALUES = ['taken', 'timeZone', 'place', 'camera', 'lens', 'serial', 'lensSerial', 'uniqueId', 'software', 'author', 'copyright', 'title', 'description', 'keywords', 'fileName'];
const FLAGS = ['emptyLocation', 'thumbnail', 'xmp', 'c2pa', 'cameraData', 'samsung', 'frameData', 'timecode', 'dataTrack', 'gpsLog', 'hiddenData', 'trackNames', 'other'];
const LEFT = ['encoderName', 'subtitles', 'unknownBox'];

/** A fake element whose descendants are found by data-js name. @param {string} tag @param {Record<string, string>} [dataset] @param {Record<string, FakeElement>} [inside] */
function element(tag, dataset = {}, inside = {}) {
  const out = new FakeElement(tag, dataset);
  for (const [name, child] of Object.entries(inside)) out.select[`[data-js="${name}"]`] = [child];
  return out;
}

/** The panel as the template renders it, with the messages the client reads from data attributes. */
function page() {
  const rows = [
    element('div', { row: 'location' }, { 'video-coordinates': element('span'), 'video-accuracy': element('span', { template: 'Accurate to about {value} m.' }) }),
    element('div', { row: 'route' }, { 'video-route': element('span', { template: '{n} positions', unread: '{n} entries' }), 'video-route-ends': element('span', { template: 'From {first} to {last}' }) }),
    ...VALUES.map((key) => element('div', { row: key }, { 'video-value': element('span') })),
    ...FLAGS.map((key) => element('div', { row: key, flag: '' })),
  ];
  // As in the template: every row starts hidden.
  for (const item of rows) item.hidden = true;
  const facts = element('dl');
  facts.select['[data-row]'] = rows;
  const left = element('section');
  left.select['[data-left]'] = LEFT.map((key) => element('li', { left: key }, { 'video-left-names': element('span') }));
  const save = element('div', {}, Object.fromEntries(['neutral', 'neutral-name', 'download', 'share', 'status', 'hint'].map((name) => [`save-${name}`, element(name === 'download' ? 'a' : 'span')])));
  const message = element('p', {
    reading: 'Reading…',
    found: 'Found:',
    none: 'Nothing found.',
    unsupported: 'Not a video.',
    photo: 'A photo.',
    damaged: 'Damaged.',
    tooLarge: 'Too large.',
    fragmented: 'Fragmented.',
    readFailed: 'Could not read.',
  });
  const report = element('article', {}, { 'video-name': element('h3'), save });
  const parts = {
    'video-file': element('input'),
    'video-report': report,
    'video-message': message,
    'video-facts': facts,
    'video-left': left,
    'video-verified': element('p', { ok: 'Checked.', failed: 'Not offered.' }),
    'video-summary': element('p', { done: 'The video has been checked.' }),
    'video-example': element('button'),
  };
  const root = element('section', {}, parts);
  /** @param {string} key */
  const row = (key) => /** @type {FakeElement} */ (rows.find((item) => item.dataset.row === key));
  return { root, row, save, ...parts };
}

/** Lets the tool's awaits run, until the report is announced. @param {FakeElement} summary */
async function settled(summary) {
  for (let i = 0; i < 200 && !summary.textContent; i += 1) await new Promise((resolve) => setTimeout(resolve, 2));
}

/** Runs `test` with the fake DOM in place. @param {(view: ReturnType<typeof page>) => Promise<void>} test */
async function withPage(test) {
  const dom = installDom();
  Object.assign(globalThis, { HTMLInputElement: class {} });
  try {
    const view = page();
    init(/** @type {HTMLElement} */ (/** @type {unknown} */ (view.root)));
    await test(view);
  } finally {
    dom.restore();
    delete (/** @type {Record<string, unknown>} */ (globalThis)).HTMLInputElement;
  }
}

describe('video page', () => {
  it('shows what the example reveals, checks the clean copy and offers it', () =>
    withPage(async ({ row, save, ...view }) => {
      view['video-example'].click();
      await settled(view['video-summary']);
      assert.equal(view['video-message'].textContent, 'Found:');
      assert.equal(view['video-report'].hidden, false);
      assert.equal(row('location').hidden, false);
      assert.equal(row('location').select['[data-js="video-coordinates"]'][0].textContent, '41.69980, 44.80360');
      assert.equal(row('route').select['[data-js="video-route"]'][0].textContent, '3 positions');
      assert.equal(row('route').select['[data-js="video-route-ends"]'][0].hidden, false);
      assert.equal(row('serial').select['[data-js="video-value"]'][0].textContent, 'EX7-2026-004512');
      assert.equal(row('camera').select['[data-js="video-value"]'][0].textContent, 'Example Phone 7');
      assert.equal(row('trackNames').hidden, false);
      assert.equal(row('xmp').hidden, true);
      assert.equal(view['video-verified'].textContent, 'Checked.');
      assert.equal(save.hidden, false, 'the copy is offered');
      assert.match(save.select['[data-js="save-download"]'][0].href ?? '', /^blob:/);
      assert.equal(view['video-summary'].textContent, 'The video has been checked.');
    }));

  it('says the copy was not offered when checking it fails, instead of staying on "Reading…"', () =>
    withPage(async ({ save, ...view }) => {
      // The copy is built as a Blob after the original was read; make reading the copy fail, as when the file
      // changes on disk or a cloud file can no longer be fetched.
      const RealBlob = globalThis.Blob;
      globalThis.Blob = class extends RealBlob {
        /** @returns {Blob} */
        slice() {
          throw new Error('the file could not be read again');
        }
      };
      const { error: errors, warn } = console;
      console.error = () => {};
      console.warn = () => {};
      try {
        view['video-example'].click();
        await settled(view['video-summary']);
      } finally {
        globalThis.Blob = RealBlob;
        console.error = errors;
        console.warn = warn;
      }
      assert.equal(view['video-message'].textContent, 'Found:');
      assert.equal(view['video-verified'].textContent, 'Not offered.');
      assert.equal(save.hidden, true);
      assert.equal(view['video-summary'].textContent, 'The video has been checked.');
    }));

  it('says what it can read when the file is not a video, and offers nothing', () =>
    withPage(async ({ save, ...view }) => {
      const file = view['video-file'];
      Object.assign(file, { files: [new File(['This is a text, not a video.'], 'notes.txt')] });
      file.dispatchEvent({ type: 'change' });
      await settled(view['video-summary']);
      assert.equal(view['video-message'].textContent, 'Not a video.');
      assert.equal(view['video-facts'].hidden, true);
      assert.equal(save.hidden, true);
    }));

  it('a video chosen while another is still being read replaces it', () =>
    withPage(async ({ row, ...view }) => {
      /** @type {() => void} */
      let release = () => {};
      const gate = new Promise((resolve) => {
        release = () => resolve(undefined);
      });
      const real = new Blob([exampleVideo()]);
      // A slow file: every read waits for the gate. The tool only uses name, size, type and slice.
      const slow = {
        name: 'slow.mov',
        size: real.size,
        type: 'video/quicktime',
        /** @param {number} start @param {number} end */
        slice: (start, end) => ({ arrayBuffer: async () => (await gate, real.slice(start, end).arrayBuffer()) }),
      };
      const file = view['video-file'];
      Object.assign(file, { files: [slow] });
      file.dispatchEvent({ type: 'change' });
      Object.assign(file, { files: [new File(['not a video either, just words'], 'second.txt')] });
      file.dispatchEvent({ type: 'change' });
      await settled(view['video-summary']);
      release();
      await new Promise((resolve) => setTimeout(resolve, 30));
      assert.equal(view['video-report'].select['[data-js="video-name"]'][0].textContent, 'second.txt');
      assert.equal(view['video-message'].textContent, 'Not a video.');
      assert.equal(row('location').hidden, true, 'the older file added nothing');
    }));
});

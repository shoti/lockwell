// @ts-check
/**
 * @file Each tool's controls; every label and message lives here, not in client code.
 */
/**
 * The controls of each tool. Everything a tool can say is rendered here, in
 * the page's language, as text or data attributes; the browser modules
 * (src/client/tool-*.mjs) only fill in values and show or hide rows. That keeps
 * translations in one place and the client free of HTML building.
 */
import { html } from '../html.mjs';
import { icons } from './icons.mjs';

/** @typedef {import('./layout.mjs').Ctx} Ctx */
/** @typedef {import('../html.mjs').SafeHtml} SafeHtml */

/**
 * Copy button plus the line that reports the result. `from` names the
 * data-js of the element whose text is copied (see src/client/copy.mjs).
 * @param {Ctx} ctx
 * @param {string} from
 */
function copyButton({ t }, from) {
  return html`<button class="button button--small" type="button" data-js="copy" data-copy-from="${from}" data-status="${from}-status" data-done="${t('tools.copied')}" data-failed="${t('tools.copyFailed')}">${icons.copy}<span>${t('tools.copy')}</span></button>`;
}

/**
 * A file chooser whose button and "no file" text are in the page's language.
 * The real input stays in charge (see .file in CSS); files.mjs shows the
 * chosen file's name in place of the "no file" text.
 * @param {Ctx} ctx
 * @param {string} id
 * @param {string} name  data-js name.
 * @param {string} accept
 */
function filePicker({ t }, id, name, accept) {
  return html`<div class="file">
          <input class="file__input" type="file" id="${id}" accept="${accept}" data-js="${name}">
          <span class="button button--ghost button--small file__button" aria-hidden="true">${icons.file}<span>${t('tools.chooseFile')}</span></span>
          <span class="file__name" aria-hidden="true" data-js="file-name" data-empty="${t('tools.noFile')}">${t('tools.noFile')}</span>
        </div>`;
}

/**
 * @param {string} id
 * @param {string} name  data-js name.
 * @param {string} label
 * @param {boolean} checked
 */
function option(id, name, label, checked) {
  return html`<label class="option" for="${id}"><input class="checkbox checkbox--small" type="checkbox" id="${id}" data-js="${name}"${checked ? html` checked` : null}><span>${label}</span></label>`;
}

/** @param {Ctx} ctx */
function passwordPanel(ctx) {
  const { t } = ctx;
  /** @param {string} key */
  const s = (key) => t(`tools.items.password.${key}`);
  return html`<div class="tool__result">
        <p class="field__label" id="password__label">${s('output')}</p>
        <p class="tool__value tool__value--secret" data-js="password-output" aria-labelledby="password__label" translate="no"></p>
        <div class="tool__actions">
          ${copyButton(ctx, 'password-output')}
          <button class="button button--ghost button--small" type="button" data-js="password-new">${icons.refresh}<span>${s('new')}</span></button>
        </div>
        <p class="tool__status" role="status" data-js="password-output-status"></p>
        <div class="meter" data-js="password-meter"><div class="meter__bar"></div></div>
        <p class="meter__label" data-js="password-strength" data-template="${s('strength')}" data-weak="${s('weak')}" data-fair="${s('fair')}" data-strong="${s('strong')}" data-very-strong="${s('veryStrong')}" data-empty="${s('noSets')}"></p>
        <p class="meter__label" data-js="password-time" data-template="${s('time')}" data-instant="${s('times.instant')}" data-minutes="${s('times.minutes')}" data-hours="${s('times.hours')}" data-days="${s('times.days')}" data-months="${s('times.months')}" data-years="${s('times.years')}" data-centuries="${s('times.centuries')}" data-forever="${s('times.forever')}"></p>
      </div>
      <fieldset class="field">
        <legend class="field__label">${s('mode')}</legend>
        <label class="option" for="password__mode-password"><input class="radio" type="radio" name="password-mode" id="password__mode-password" value="password" data-js="password-mode" checked><span>${s('modePassword')}</span></label>
        <label class="option" for="password__mode-pin"><input class="radio" type="radio" name="password-mode" id="password__mode-pin" value="pin" data-js="password-mode"><span>${s('modePin')}</span></label>
      </fieldset>
      <div class="field">
        <label class="field__label" for="password__length">${s('length')}: <output class="field__value" for="password__length" data-js="password-length-value">20</output></label>
        <input class="range" type="range" id="password__length" min="8" max="64" step="1" value="20" data-js="password-length">
      </div>
      <fieldset class="field" data-js="password-sets">
        <legend class="field__label">${s('sets')}</legend>
        ${option('password__lower', 'password-lower', s('lower'), true)}
        ${option('password__upper', 'password-upper', s('upper'), true)}
        ${option('password__digits', 'password-digits', s('digits'), true)}
        ${option('password__symbols', 'password-symbols', s('symbols'), true)}
        ${option('password__avoid', 'password-avoid', s('avoid'), false)}
      </fieldset>`;
}

/** @param {Ctx} ctx */
function linksPanel(ctx) {
  const { t } = ctx;
  /** @param {string} key */
  const s = (key) => t(`tools.items.links.${key}`);
  return html`<div class="field">
        <label class="field__label" for="links__input">${s('input')}</label>
        <textarea class="textarea" id="links__input" rows="3" autocomplete="off" autocapitalize="off" spellcheck="false" data-js="links-input"></textarea>
      </div>
      <div class="tool__result">
        <p class="field__label" id="links__label">${s('output')}</p>
        <p class="tool__value" data-js="links-output" aria-labelledby="links__label" translate="no"></p>
        <div class="tool__actions">
          ${copyButton(ctx, 'links-output')}
        </div>
        <p class="tool__status" role="status" data-js="links-output-status"></p>
        <p class="tool__message" role="status" data-js="links-message" data-removed="${s('removed')}" data-clean="${s('clean')}" data-invalid="${s('invalid')}" data-unwrapped="${s('unwrapped')}" data-several="${s('several')}"></p>
      </div>`;
}

/** Warning signs the link checker can show, in the order they are listed (see tool-check.mjs). */
const LINK_WARNINGS = ['redirect', 'userinfo', 'brandSubdomain', 'nestedDomain', 'brandLookalike', 'typo', 'mixedScript', 'lookalikeScript', 'ip', 'shortener', 'http', 'port', 'deepSubdomain', 'fileTld', 'download'];

/** @param {Ctx} ctx */
function checkPanel(ctx) {
  const { t } = ctx;
  /** @param {string} key */
  const s = (key) => t(`tools.items.check.${key}`);
  return html`<div class="field">
        <label class="field__label" for="check__input">${s('input')}</label>
        <textarea class="textarea" id="check__input" rows="3" autocomplete="off" autocapitalize="off" spellcheck="false" data-js="check-input"></textarea>
      </div>
      <div class="verdict" data-js="check-result" hidden>
        <p class="field__label">${s('leads')}</p>
        <p class="verdict__site" data-js="check-site" translate="no"></p>
        <p class="verdict__host" data-js="check-host" translate="no"></p>
        <p class="facts__why" data-js="check-several" data-template="${s('several')}" hidden></p>
        <p class="verdict__summary" role="status" data-js="check-verdict" data-ok="${s('ok')}" data-warn="${s('warn')}" data-invalid="${s('invalid')}"></p>
        <ul class="verdict__list">
          ${LINK_WARNINGS.map((warning) => html`<li data-js="check-warning" data-warning="${warning}" data-template="${s(`warnings.${warning}`)}" hidden></li>`)}
        </ul>
      </div>`;
}

/** @param {Ctx} ctx */
function redactPanel(ctx) {
  const { t } = ctx;
  /** @param {string} key */
  const s = (key) => t(`tools.items.redact.${key}`);
  /** @param {string} name @param {SafeHtml} icon @param {string} label */
  const action = (name, icon, label) =>
    html`<button class="button button--ghost button--small" type="button" data-js="redact-${name}">${icon}<span>${label}</span></button>`;
  /** A button that shows only an icon; its name is read out and shown on hover. @param {string} name @param {SafeHtml} icon @param {string} label */
  const iconAction = (name, icon, label) =>
    html`<button class="button button--ghost button--small button--icon" type="button" aria-label="${label}" title="${label}" data-js="redact-${name}">${icon}</button>`;
  /** @param {string} mode @param {SafeHtml} icon @param {string} label */
  const modeButton = (mode, icon, label) =>
    html`<button class="button button--ghost button--small" type="button" aria-pressed="${mode === 'box' ? 'true' : 'false'}" data-js="redact-mode" data-mode="${mode}">${icon}<span>${label}</span></button>`;
  return html`<div class="field">
        <label class="field__label" for="redact__file">${s('file')}</label>
        ${filePicker(ctx, 'redact__file', 'redact-file', 'image/*')}
        <p class="facts__why">${s('pasteHint')}</p>
      </div>
      <p class="tool__message" role="status" data-js="redact-message" data-unsupported="${s('unsupported')}" data-too-large="${s('tooLarge')}" data-resized="${s('resized')}" data-encode-failed="${s('encodeFailed')}"></p>
      <div class="redact" data-js="redact-editor" hidden>
        <div class="tool__actions" role="group" aria-label="${s('modes')}">
          ${modeButton('box', icons.square, s('modeBox'))}
          ${modeButton('ellipse', icons.circle, s('modeEllipse'))}
          ${modeButton('marker', icons.pen, s('modeMarker'))}
          ${modeButton('crop', icons.crop, s('modeCrop'))}
        </div>
        <div class="field">
          <label class="field__label" for="redact__size">${s('markerSize')}</label>
          <input class="range" type="range" id="redact__size" min="1" max="12" step="1" value="4" disabled data-js="redact-size">
        </div>
        <div class="redact__view" data-zoom="1" data-js="redact-view">
          <canvas class="redact__canvas" tabindex="0" role="application" aria-label="${s('canvas')}" aria-describedby="redact__help" data-js="redact-canvas"></canvas>
        </div>
        <div class="redact__bar">
          <div class="tool__actions">
            ${action('undo', icons.undo, s('undo'))}
            ${action('redo', icons.redo, s('redo'))}
          </div>
          <div class="tool__actions redact__zoom">
            ${iconAction('zoom-out', icons.minus, s('zoomOut'))}
            <span class="redact__zoom-value" data-js="redact-zoom-value" translate="no">100%</span>
            ${iconAction('zoom-in', icons.plus, s('zoomIn'))}
          </div>
        </div>
        <div class="tool__actions">
          ${action('remove', icons.trash, s('remove'))}
          ${action('uncrop', icons.crop, s('removeCrop'))}
          ${action('clear', icons.trash, s('clearAll'))}
        </div>
        <p class="tool__status" role="status" data-js="redact-count" data-template="${s('count')}" data-cropped="${s('cropped')}"></p>
        <p class="facts__why" id="redact__help">${s('help')}</p>
        <div class="tool__actions">
          <button class="button button--small" type="button" data-js="redact-check">${icons.eye}<span>${s('check')}</span></button>
        </div>
        <div class="redact__result" tabindex="-1" role="group" aria-labelledby="redact__result" data-js="redact-result" hidden>
          <p class="field__label" id="redact__result">${s('resultTitle')}</p>
          <p class="facts__why">${s('resultHelp')}</p>
          <canvas class="redact__saved" data-js="redact-result-canvas"></canvas>
          <p class="facts__why" data-js="redact-result-info" translate="no"></p>
          <div class="tool__actions">
            <a class="button button--small" data-js="redact-download">${icons.download}<span>${s('download')}</span></a>
            <button class="button button--ghost button--small" type="button" data-js="redact-copy" data-done="${s('copied')}" data-failed="${s('copyFailed')}">${icons.copy}<span>${s('copyImage')}</span></button>
          </div>
          <p class="tool__status" role="status" data-js="redact-result-status"></p>
        </div>
      </div>`;
}

/** Rows of the photo report: those with a value JS fills in, then those that only say what was found. */
const PHOTO_VALUES = ['location', 'camera', 'taken', 'software'];
const PHOTO_FLAGS = ['exif', 'xmp', 'iptc', 'comment', 'thumbnail', 'trailing', 'text', 'other'];

/** @param {Ctx} ctx */
function photoPanel(ctx) {
  const { t } = ctx;
  /** @param {string} key */
  const s = (key) => t(`tools.items.photo.${key}`);
  return html`<div class="field">
        <label class="field__label" for="photo__file">${s('file')}</label>
        ${filePicker(ctx, 'photo__file', 'photo-file', 'image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp')}
        <p class="facts__why">${s('pasteHint')}</p>
      </div>
      <div class="tool__result">
        <p class="tool__message" role="status" data-js="photo-message" data-found="${s('found')}" data-none="${s('none')}" data-unsupported="${s('unsupported')}" data-heic="${s('heic')}" data-too-large="${s('tooLarge')}" data-damaged="${s('damaged')}"></p>
        <dl class="facts" data-js="photo-facts" hidden>
          ${PHOTO_VALUES.map((row) => html`<div class="facts__row" data-row="${row}" hidden><dt>${s(`rows.${row}`)}</dt><dd translate="no"></dd></div>`)}
          ${PHOTO_FLAGS.map((row) => html`<div class="facts__row" data-row="${row}" hidden><dt>${s(`rows.${row}`)}</dt><dd>${s(`flags.${row}`)}</dd></div>`)}
        </dl>
        <p class="tool__actions" data-js="photo-save" hidden>
          <a class="button button--small" data-js="photo-download">${icons.download}<span>${s('download')}</span></a>
        </p>
      </div>`;
}

/** What the hidden character detector looks for, in the order it is listed (see tool-hidden.mjs). */
const HIDDEN_KINDS = ['zeroWidth', 'bidi', 'tags', 'softHyphen', 'spaces', 'trailing', 'lookalike'];

/** @param {Ctx} ctx */
function hiddenPanel(ctx) {
  const { t } = ctx;
  /** @param {string} key */
  const s = (key) => t(`tools.items.hidden.${key}`);
  return html`<div class="field">
        <label class="field__label" for="hidden__input">${s('input')}</label>
        <textarea class="textarea" id="hidden__input" rows="6" autocomplete="off" autocapitalize="off" spellcheck="false" data-js="hidden-input"></textarea>
      </div>
      <div class="tool__result" data-js="hidden-result" hidden>
        <p class="tool__message" role="status" data-js="hidden-summary" data-none="${s('none')}" data-found="${s('found')}"></p>
        <div class="tool__result" data-js="hidden-details" hidden>
          <dl class="facts">
            ${HIDDEN_KINDS.map(
              (kind) => html`<div class="facts__row" data-row="${kind}" hidden>
              <dt><span data-js="hidden-name">${s(`rows.${kind}`)}</span> <span class="count" data-js="hidden-count" translate="no"></span></dt>
              <dd>${s(`flags.${kind}`)}</dd>
            </div>`,
            )}
          </dl>
          <p class="tool__note" data-js="hidden-secret" data-template="${s('secret')}" translate="no" hidden></p>
          <p class="field__label" id="hidden__marked">${s('marked')}</p>
          <p class="facts__why" data-js="hidden-truncated" hidden>${s('truncated')}</p>
          <div class="marked" tabindex="0" role="group" aria-labelledby="hidden__marked" data-js="hidden-marked" translate="no"></div>
          <p class="field__label" id="hidden__clean">${s('clean')}</p>
          <p class="tool__value tool__value--text" tabindex="0" data-js="hidden-clean" aria-labelledby="hidden__clean" translate="no"></p>
          <div class="tool__actions">
            ${copyButton(ctx, 'hidden-clean')}
          </div>
          <p class="tool__status" role="status" data-js="hidden-clean-status"></p>
        </div>
      </div>`;
}

/** Rows of the document report: those with a value, then those that only say what was found. */
const DOCUMENT_VALUES = ['author', 'lastAuthor', 'company', 'manager', 'title', 'subject', 'keywords', 'comments', 'created', 'modified', 'printed', 'revision', 'editTime', 'software', 'producer', 'template'];
const DOCUMENT_FLAGS = ['tracked', 'commentsPart', 'custom', 'xmp'];

/** @param {Ctx} ctx */
function documentPanel(ctx) {
  const { t } = ctx;
  /** @param {string} key */
  const s = (key) => t(`tools.items.document.${key}`);
  return html`<div class="field">
        <label class="field__label" for="document__file">${s('file')}</label>
        ${filePicker(ctx, 'document__file', 'document-file', '.docx,.xlsx,.pptx,.pdf,application/pdf')}
        <p class="facts__why">${s('dropHint')}</p>
      </div>
      <div class="tool__result">
        <p class="tool__message" role="status" data-js="document-message" data-found="${s('found')}" data-none="${s('none')}" data-unsupported="${s('unsupported')}" data-old="${s('old')}" data-too-large="${s('tooLarge')}" data-damaged="${s('damaged')}" data-browser="${s('browser')}"></p>
        <dl class="facts" data-js="document-facts" hidden>
          ${DOCUMENT_VALUES.map((row) => html`<div class="facts__row" data-row="${row}" hidden><dt>${s(`rows.${row}`)}</dt><dd translate="no"></dd></div>`)}
          ${DOCUMENT_FLAGS.map((row) => html`<div class="facts__row" data-row="${row}" hidden><dt>${s(`rows.${row}`)}</dt><dd>${s(`flags.${row}`)}</dd></div>`)}
        </dl>
        <p class="tool__note" data-js="document-kept" hidden>${s('kept')}</p>
        <p class="tool__note" data-js="document-pdf" hidden>${s('pdfOnly')}</p>
        <p class="tool__actions" data-js="document-save" hidden>
          <a class="button button--small" data-js="document-download">${icons.download}<span>${s('download')}</span></a>
        </p>
      </div>`;
}

/** The browser report: groups of rows; `why` rows get a short explanation. Rows are filled by tool-browser.mjs. */
const BROWSER_GROUPS = [
  { key: 'place', rows: [{ key: 'languages', why: true }, { key: 'timeZone', why: true }] },
  {
    key: 'device',
    rows: [
      { key: 'userAgent', why: true },
      { key: 'os', why: true },
      { key: 'model', why: false },
      { key: 'platform', why: false },
      { key: 'gpu', why: true },
      { key: 'cores', why: false },
      { key: 'memory', why: false },
      { key: 'screen', why: true },
      { key: 'window', why: false },
      { key: 'colors', why: false },
      { key: 'touch', why: false },
    ],
  },
  {
    key: 'settings',
    rows: [
      { key: 'theme', why: false },
      { key: 'motion', why: true },
      { key: 'contrast', why: false },
      { key: 'cookies', why: false },
      { key: 'dnt', why: true },
      { key: 'gpc', why: true },
    ],
  },
  { key: 'signature', rows: [{ key: 'canvas', why: true }, { key: 'fonts', why: true }] },
  { key: 'network', rows: [{ key: 'connection', why: false }, { key: 'referrer', why: true }] },
];
const BROWSER_TOKENS = ['yes', 'no', 'on', 'off', 'unset', 'unsupported', 'none', 'dark', 'light', 'unknown'];

/** Fields of the autofill demonstration: [name, autocomplete token]. The visitor sees the first two only. */
const AUTOFILL_VISIBLE = [
  ['name', 'name'],
  ['email', 'email'],
];
const AUTOFILL_HIDDEN = [
  ['phone', 'tel'],
  ['company', 'organization'],
  ['address', 'street-address'],
  ['city', 'address-level2'],
  ['zip', 'postal-code'],
  ['country', 'country-name'],
];

/** @param {Ctx} ctx */
function browserPanel(ctx) {
  const { t } = ctx;
  /** @param {string} key */
  const s = (key) => t(`tools.items.browser.${key}`);
  // Words the client may show instead of a raw value, e.g. data-token-yes="Yes".
  const tokens = BROWSER_TOKENS.map((token) => html` data-token-${token}="${s(`tokens.${token}`)}"`);
  /** @param {{ key: string, why: boolean }} row */
  const factRow = ({ key, why }) =>
    html`<div class="facts__row" data-row="${key}"><dt>${s(`rows.${key}`)}</dt><dd><span class="facts__value" data-js="browser-value" translate="no"></span>${why ? html`<span class="facts__why">${s(`why.${key}`)}</span>` : null}</dd></div>`;

  return html`<div class="report" data-js="browser-facts"${tokens}>
        <div class="fingerprint" data-row="fingerprint">
          <p class="field__label">${s('fingerprint')}</p>
          <p class="fingerprint__value" data-js="browser-value" translate="no"></p>
          <p class="facts__why">${s('fingerprintWhy')}</p>
        </div>
        ${BROWSER_GROUPS.map(
          (group) => html`<section class="report__group" aria-labelledby="browser__${group.key}">
          <h2 class="report__title" id="browser__${group.key}">${s(`groups.${group.key}`)}</h2>
          <dl class="facts">
            ${group.rows.map(factRow)}
            ${group.key === 'network' ? html`<div class="facts__row"><dt>${s('rows.ip')}</dt><dd><span class="facts__why">${s('why.ip')}</span></dd></div>` : null}
          </dl>
        </section>`,
        )}
      </div>
      <section class="autofill" aria-labelledby="browser__autofill">
        <h2 class="report__title" id="browser__autofill">${s('autofill.heading')}</h2>
        <p class="autofill__intro">${s('autofill.intro')}</p>
        <form class="autofill__form" data-js="autofill-form" autocomplete="on" novalidate>
          ${AUTOFILL_VISIBLE.map(
            ([name, token]) => html`<div class="field">
            <label class="field__label" for="autofill__${name}">${s(`autofill.${name}`)}</label>
            <input class="input" type="${name === 'email' ? 'email' : 'text'}" id="autofill__${name}" name="${name}" autocomplete="${token}" data-js="autofill-visible">
          </div>`,
          )}
          <div class="autofill__unseen" aria-hidden="true">
            ${AUTOFILL_HIDDEN.map(
              ([name, token]) => html`<label for="autofill__${name}">${s(`autofill.${name}`)}</label><input type="${name === 'phone' ? 'tel' : 'text'}" id="autofill__${name}" name="${name}" autocomplete="${token}" tabindex="-1" data-js="autofill-hidden" data-label="${s(`autofill.${name}`)}">`,
            )}
          </div>
          <div class="autofill__result" data-js="autofill-result" hidden>
            <p class="autofill__message" role="status" data-js="autofill-message" data-leaked="${s('autofill.leaked')}" data-safe="${s('autofill.safe')}"></p>
            <ul class="autofill__list" data-js="autofill-list" translate="no"></ul>
            <button class="button button--ghost button--small" type="button" data-js="autofill-clear">${s('autofill.clear')}</button>
          </div>
        </form>
        <p class="facts__why">${s('autofill.note')}</p>
        <p class="facts__why">${s('autofill.tip')}</p>
      </section>
      <section class="cannot" aria-labelledby="browser__cannot">
        <h2 class="report__title" id="browser__cannot">${s('cannot.heading')}</h2>
        <ul class="cannot__list">
          ${[1, 2, 3, 4, 5].map((n) => html`<li>${s(`cannot.item${n}`)}</li>`)}
        </ul>
      </section>`;
}

/** @type {Record<import('../tools.mjs').Tool['key'], (ctx: Ctx) => SafeHtml>} */
export const PANELS = {
  password: passwordPanel,
  links: linksPanel,
  check: checkPanel,
  redact: redactPanel,
  document: documentPanel,
  hidden: hiddenPanel,
  photo: photoPanel,
  browser: browserPanel,
};

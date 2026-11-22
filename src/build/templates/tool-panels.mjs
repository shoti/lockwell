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
import { absoluteUrl, localePath } from '../site.mjs';
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
 * @param {boolean} [multiple]  Several files at once.
 */
function filePicker({ t }, id, name, accept, multiple = false) {
  return html`<div class="file">
          <input class="file__input" type="file" id="${id}"${accept ? html` accept="${accept}"` : null} data-js="${name}"${multiple ? html` multiple` : null}>
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

/**
 * @param {string} name  Radio group name.
 * @param {string} id
 * @param {string} value
 * @param {string} js  data-js name.
 * @param {string} label
 * @param {boolean} checked
 */
function radio(name, id, value, js, label, checked) {
  return html`<label class="option" for="${id}"><input class="radio" type="radio" name="${name}" id="${id}" value="${value}" data-js="${js}"${checked ? html` checked` : null}><span>${label}</span></label>`;
}

/** @param {Ctx} ctx */
function passwordPanel(ctx) {
  const { t } = ctx;
  /** @param {string} key */
  const s = (key) => t(`tools.items.password.${key}`);
  return html`<div class="tool__result">
        <p class="field__label" id="password__label">${s('output')}</p>
        <p class="tool__value tool__value--secret" data-js="password-output" aria-labelledby="password__label" translate="no"></p>
        <p class="tool__value tool__value--secret" data-js="password-mask" aria-hidden="true" translate="no" hidden></p>
        <div class="tool__actions">
          ${copyButton(ctx, 'password-output')}
          <button class="button button--ghost button--small" type="button" data-js="password-new">${icons.refresh}<span>${s('new')}</span></button>
          <button class="button button--ghost button--small" type="button" data-js="password-hide" aria-pressed="false" data-show="${s('show')}" data-hide="${s('hide')}">${icons.eye}<span>${s('hide')}</span></button>
        </div>
        <p class="tool__status" role="status" data-js="password-output-status"></p>
        <div data-js="password-strength-box">
          <div class="meter" data-js="password-meter"><div class="meter__bar"></div></div>
          <p class="meter__label" data-js="password-strength" data-template="${s('strength')}" data-weak="${s('weak')}" data-fair="${s('fair')}" data-strong="${s('strong')}" data-very-strong="${s('veryStrong')}" data-empty="${s('noSets')}"></p>
          <p class="meter__label" data-js="password-time" data-template="${s('time')}" data-instant="${s('times.instant')}" data-minutes="${s('times.minutes')}" data-hours="${s('times.hours')}" data-days="${s('times.days')}" data-months="${s('times.months')}" data-years="${s('times.years')}" data-centuries="${s('times.centuries')}" data-forever="${s('times.forever')}"></p>
        </div>
        <p class="meter__label" data-js="password-pin" data-codes="${s('pinCodes')}" data-lockout="${s('pinLockout')}" hidden></p>
      </div>
      <fieldset class="field">
        <legend class="field__label">${s('mode')}</legend>
        ${radio('password-mode', 'password__mode-password', 'password', 'password-mode', s('modePassword'), true)}
        ${radio('password-mode', 'password__mode-passphrase', 'passphrase', 'password-mode', s('modePassphrase'), false)}
        ${radio('password-mode', 'password__mode-pin', 'pin', 'password-mode', s('modePin'), false)}
      </fieldset>
      <div class="field" data-js="password-length-box">
        <label class="field__label" for="password__length">${s('length')}: <output class="field__value" for="password__length" data-js="password-length-value">20</output></label>
        <input class="range" type="range" id="password__length" min="8" max="64" step="1" value="20" data-js="password-length">
      </div>
      <div class="field" data-js="password-words-box" hidden>
        <label class="field__label" for="password__words">${s('words')}: <output class="field__value" for="password__words" data-js="password-words-value">6</output></label>
        <input class="range" type="range" id="password__words" min="4" max="10" step="1" value="6" data-js="password-words">
      </div>
      <fieldset class="field" data-js="password-sets">
        <legend class="field__label">${s('sets')}</legend>
        ${option('password__lower', 'password-lower', s('lower'), true)}
        ${option('password__upper', 'password-upper', s('upper'), true)}
        ${option('password__digits', 'password-digits', s('digits'), true)}
        ${option('password__symbols', 'password-symbols', s('symbols'), true)}
        ${option('password__avoid', 'password-avoid', s('avoid'), false)}
      </fieldset>
      <div class="field" data-js="password-presets">
        <p class="field__label">${s('presets')}</p>
        <div class="tool__actions">
          <button class="button button--ghost button--small" type="button" data-js="password-preset-symbols">${s('presetSymbols')}</button>
          <button class="button button--ghost button--small" type="button" data-js="password-preset-16">${s('preset16')}</button>
        </div>
      </div>
      <fieldset class="field" data-js="password-phrase" hidden>
        <legend class="field__label">${s('separator')}</legend>
        ${radio('password-separator', 'password__sep-hyphen', '-', 'password-separator', s('sepHyphen'), true)}
        ${radio('password-separator', 'password__sep-space', ' ', 'password-separator', s('sepSpace'), false)}
        ${radio('password-separator', 'password__sep-dot', '.', 'password-separator', s('sepDot'), false)}
        ${radio('password-separator', 'password__sep-none', '', 'password-separator', s('sepNone'), false)}
        ${option('password__capital', 'password-capital', s('capital'), false)}
        ${option('password__digit', 'password-digit', s('digit'), false)}
      </fieldset>`;
}

/**
 * A share button for browsers with the Web Share API; laid out from the first
 * paint where the head script found one (data-share), absent elsewhere.
 * @param {Ctx} ctx
 * @param {string} name  data-js name.
 */
function shareButton({ t }, name) {
  return html`<button class="button button--ghost button--small share-only" type="button" data-js="${name}">${icons.share}<span>${t('tools.share')}</span></button>`;
}

/** @param {Ctx} ctx */
function linksPanel(ctx) {
  const { t } = ctx;
  /** @param {string} key */
  const s = (key) => t(`tools.items.links.${key}`);
  return html`<div class="field">
        <label class="field__label" for="links__input">${s('input')}</label>
        <textarea class="textarea" id="links__input" rows="3" autocomplete="off" autocapitalize="off" spellcheck="false" data-js="links-input"></textarea>
        <div class="tool__actions">
          <button class="button button--ghost button--small" type="button" data-js="links-example" data-example="${s('exampleText')}">${icons.eye}<span>${t('tools.example')}</span></button>
        </div>
      </div>
      <div class="tool__result">
        <p class="field__label" id="links__label">${s('output')}</p>
        <p class="tool__value" data-js="links-output" aria-labelledby="links__label" translate="no"></p>
        <div class="tool__actions">
          ${copyButton(ctx, 'links-output')}
          ${shareButton(ctx, 'links-share')}
        </div>
        <p class="tool__status" role="status" data-js="links-output-status"></p>
        <p class="tool__message" role="status" data-js="links-message" data-removed="${s('removed')}" data-clean="${s('clean')}" data-invalid="${s('invalid')}" data-unwrapped="${s('unwrapped')}" data-several="${s('several')}" data-shared="${s('shared')}" data-lookup="${s('lookup')}" data-short="${s('short')}" data-email="${s('email')}" data-secret="${s('secret')}"></p>
        <div class="tool__result" data-js="links-diff-box" hidden>
          <p class="field__label" id="links__diff">${s('diff')}</p>
          <div class="marked" tabindex="0" role="group" aria-labelledby="links__diff" data-js="links-diff" translate="no"></div>
        </div>
      </div>`;
}

/**
 * Warning signs the link checker can show, most telling first; each verdict
 * lists them in this order (see tool-check.mjs).
 */
const LINK_WARNINGS = [
  'textMismatch', 'redirect', 'userinfo', 'brandElsewhere', 'brandSubdomain', 'nestedDomain', 'brandLookalike', 'typo', 'latinLookalike', 'mixedScript',
  'lookalikeScript', 'sharedHost', 'publicPage', 'brandPath', 'carriedUrl', 'carriedEmail', 'ip', 'shortener', 'hiddenTarget', 'mailTracking', 'http', 'port',
  'deepSubdomain', 'fileTld', 'download',
];

/** @param {Ctx} ctx */
function checkPanel(ctx) {
  const { t } = ctx;
  /** @param {string} key */
  const s = (key) => t(`tools.items.check.${key}`);
  return html`<div class="field">
        <label class="field__label" for="check__input">${s('input')}</label>
        <textarea class="textarea" id="check__input" rows="3" autocomplete="off" autocapitalize="off" spellcheck="false" data-js="check-input"></textarea>
        <div class="tool__actions">
          <button class="button button--ghost button--small" type="button" data-js="check-example" data-example="${s('exampleText')}">${icons.eye}<span>${t('tools.example')}</span></button>
        </div>
      </div>
      <div class="field qr-only">
        <label class="field__label" for="check__qr">${s('qr')}</label>
        ${filePicker(ctx, 'check__qr', 'check-qr', 'image/*')}
        <p class="facts__why">${s('qrHint')}</p>
      </div>
      <p class="facts__why qr-absent">${s('qrAbsent')}</p>
      <p class="tool__message" role="status" data-js="check-summary" data-one="${s('one')}" data-invalid="${s('invalid')}" data-data="${s('scheme.data')}" data-javascript="${s('scheme.javascript')}" data-other="${s('scheme.other')}" data-several="${s('several')}" data-capped="${s('capped')}" data-qr-none="${s('qrNone')}" data-qr-failed="${s('qrFailed')}"></p>
      <div class="verdicts" data-js="check-results"></div>
      <template data-js="check-template">
        <article class="verdict">
          <p class="field__label" data-js="check-leads" data-first="${s('leadsFirst')}">${s('leads')}</p>
          <p class="verdict__site" data-js="check-site" translate="no"></p>
          <p class="verdict__address" dir="ltr" translate="no"><span class="verdict__dim" data-js="check-before"></span><strong data-js="check-site-part"></strong><span class="verdict__dim" data-js="check-after"></span></p>
          <p class="verdict__host" data-js="check-ascii" data-template="${s('ascii')}" translate="no" hidden></p>
          <p class="facts__why" data-js="check-shown" data-template="${s('shown')}" hidden></p>
          <p class="facts__why" data-js="check-defanged" hidden>${s('defanged')}</p>
          <p class="verdict__summary" data-js="check-verdict" data-ok="${s('ok')}" data-warn="${s('warn')}"></p>
          <ul class="verdict__list">
            ${LINK_WARNINGS.map((warning) => html`<li data-js="check-warning" data-warning="${warning}" data-template="${s(`warnings.${warning}`)}" hidden></li>`)}
          </ul>
        </article>
      </template>`;
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
        <div class="tool__actions">
          <button class="button button--ghost button--small" type="button" data-js="redact-example">${icons.eye}<span>${t('tools.example')}</span></button>
        </div>
      </div>
      <div class="tool__note redact__replace" role="alertdialog" aria-labelledby="redact__replace" data-js="redact-replace" hidden>
        <p id="redact__replace">${s('replaceText')}</p>
        <div class="tool__actions">
          <button class="button button--small" type="button" data-js="redact-replace-no">${s('replaceNo')}</button>
          <button class="button button--ghost button--small" type="button" data-js="redact-replace-yes">${s('replaceYes')}</button>
        </div>
      </div>
      <p class="tool__message" role="status" data-js="redact-message" data-unsupported="${s('unsupported')}" data-too-large="${s('tooLarge')}" data-resized="${s('resized')}" data-animated="${s('animated')}" data-encode-failed="${s('encodeFailed')}"></p>
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
          ${option('redact__straight', 'redact-straight', s('straight'), false)}
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
        <div class="redact__bar">
          <div class="tool__actions" role="group" aria-label="${s('moveGroup')}">
            ${iconAction('move-left', icons.arrowLeft, s('moveLeft'))}
            ${iconAction('move-up', icons.arrowUp, s('moveUp'))}
            ${iconAction('move-down', icons.arrowDown, s('moveDown'))}
            ${iconAction('move-right', icons.arrowRight, s('moveRight'))}
          </div>
          <div class="tool__actions" role="group" aria-label="${s('sizeGroup')}">
            ${iconAction('narrower', icons.narrower, s('narrower'))}
            ${iconAction('wider', icons.wider, s('wider'))}
            ${iconAction('shorter', icons.shorter, s('shorter'))}
            ${iconAction('taller', icons.taller, s('taller'))}
          </div>
        </div>
        <div class="tool__actions">
          ${action('add', icons.plus, s('addArea'))}
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
          <p class="redact__verified" data-js="redact-verified" data-ok="${s('verified')}" data-ok-jpeg="${s('verifiedJpeg')}" data-thin="${s('verifiedThin')}" data-empty="${s('verifiedEmpty')}" data-failed="${s('verifyFailed')}" data-blocked="${s('verifyBlocked')}"></p>
          ${saveBox(ctx, s('download'))}
          <div class="tool__actions">
            <button class="button button--ghost button--small" type="button" data-js="redact-copy" data-done="${s('copied')}" data-failed="${s('copyFailed')}">${icons.copy}<span>${s('copyImage')}</span></button>
          </div>
          <p class="tool__status" role="status" data-js="redact-result-status"></p>
        </div>
      </div>`;
}

/** Crop proportions offered by the photo editor, after "free" and "original" (see RATIOS in tool-editor.mjs). */
const EDITOR_RATIOS = ['1:1', '4:3', '3:4', '3:2', '2:3', '16:9', '9:16'];
/** Longer sides the photo editor offers in one press, in pixels. */
const EDITOR_LONG_SIDES = [1080, 1600, 2048, 4096];
/** The photo editor's sliders and where each starts (see ADJUSTMENTS in editor-color.mjs). */
const EDITOR_ADJUSTMENTS = [
  ['exposure', -100], ['brightness', -100], ['contrast', -100], ['highlights', -100], ['shadows', -100], ['saturation', -100],
  ['warmth', -100], ['tint', -100], ['sharpen', 0], ['soften', 0], ['vignette', 0],
];
/** The photo editor's filters (see PRESETS in editor-color.mjs). */
const EDITOR_PRESETS = ['none', 'mono', 'sepia', 'warm', 'cool', 'vivid', 'faded'];
/** Colours offered in one press for text and drawings, as #rrggbb (the only form the editor accepts). */
const EDITOR_SWATCHES = [['black', '#000000'], ['white', '#ffffff'], ['red', '#e53935'], ['orange', '#fb8c00'], ['yellow', '#fdd835'], ['green', '#43a047'], ['blue', '#1e88e5']];
/** What the Draw tool draws (see tool-editor.mjs). */
const EDITOR_SHAPES = /** @type {const} */ ([['pen', 'pen'], ['highlighter', 'highlighter'], ['line', 'lineTool'], ['arrow', 'arrowTool'], ['rect', 'square'], ['ellipse', 'circle']]);

/** @param {Ctx} ctx */
function editorPanel(ctx) {
  const { t } = ctx;
  /** @param {string} key */
  const s = (key) => t(`tools.items.editor.${key}`);
  /** @param {string} name @param {SafeHtml} icon @param {string} label */
  const action = (name, icon, label) =>
    html`<button class="button button--ghost button--small" type="button" data-js="editor-${name}">${icon}<span>${label}</span></button>`;
  /** A button that shows only an icon; its name is read out and shown on hover. @param {string} name @param {SafeHtml} icon @param {string} label */
  const iconAction = (name, icon, label) =>
    html`<button class="button button--ghost button--small button--icon" type="button" aria-label="${label}" title="${label}" data-js="editor-${name}">${icon}</button>`;
  /** @param {string} key @param {SafeHtml} icon @param {string} label */
  const toolButton = (key, icon, label) =>
    html`<button class="button button--ghost button--small" type="button" aria-pressed="${key === 'crop' ? 'true' : 'false'}" data-js="editor-tool" data-tool="${key}">${icon}<span>${label}</span></button>`;
  /** @param {string} name  data-js name, and the id after "editor__". @param {string} label @param {string} min @param {string} max */
  const numberField = (name, label, min, max) => html`<div class="field editor__number">
              <label class="field__label" for="editor__${name}">${label}</label>
              <input class="input" type="number" inputmode="numeric" id="editor__${name}" min="${min}" max="${max}" step="1" data-js="editor-${name}">
            </div>`;
  /** A range with a number field beside it. @param {string} name @param {string} label @param {number} min @param {number} max @param {number} value */
  const slider = (name, label, min, max, value) => html`<div class="field">
              <label class="field__label" for="editor__${name}">${label}</label>
              <div class="editor__row">
                <input class="range" type="range" id="editor__${name}" min="${String(min)}" max="${String(max)}" step="1" value="${String(value)}" data-js="editor-${name}">
                <input class="input editor__amount" type="number" inputmode="numeric" min="${String(min)}" max="${String(max)}" step="1" value="${String(value)}" aria-label="${label}" data-js="editor-${name}-number">
              </div>
            </div>`;
  /**
   * A colour chooser, with a row of common colours when `swatches` is set.
   * @param {string} name @param {string} label @param {string} value @param {boolean} swatches
   */
  const colorField = (name, label, value, swatches) => html`<div class="field">
              <label class="field__label" for="editor__${name}">${label}</label>
              <div class="editor__row editor__colors">
                <input class="editor__color" type="color" id="editor__${name}" value="${value}" data-js="editor-${name}">
                ${swatches
                  ? EDITOR_SWATCHES.map(([key, color]) => html`<button class="editor__swatch editor__swatch--${key}" type="button" aria-label="${s(`colors.${key}`)}" title="${s(`colors.${key}`)}" data-js="editor-swatch" data-for="${name}" data-color="${color}"></button>`)
                  : null}
              </div>
            </div>`;
  const [linkBefore, linkAfter] = s('redactLink').split('{link}');
  return html`<div class="field">
        <label class="field__label" for="editor__file">${s('file')}</label>
        ${filePicker(ctx, 'editor__file', 'editor-file', 'image/*')}
        <p class="facts__why">${s('pasteHint')}</p>
        <div class="tool__actions">
          <button class="button button--ghost button--small" type="button" data-js="editor-example">${icons.eye}<span>${t('tools.example')}</span></button>
        </div>
      </div>
      <div class="tool__note editor__replace" role="alertdialog" aria-labelledby="editor__replace" data-js="editor-replace" hidden>
        <p id="editor__replace">${s('replaceText')}</p>
        <div class="tool__actions">
          <button class="button button--small" type="button" data-js="editor-replace-no">${s('replaceNo')}</button>
          <button class="button button--ghost button--small" type="button" data-js="editor-replace-yes">${s('replaceYes')}</button>
        </div>
      </div>
      <p class="tool__message" role="status" data-js="editor-message" data-unsupported="${s('unsupported')}" data-too-large="${s('tooLarge')}" data-resized="${s('resized')}" data-animated="${s('animated')}" data-encode-failed="${s('encodeFailed')}" data-blocked="${s('blocked')}"></p>
      <div class="editor" data-js="editor-editor" hidden>
        <div class="editor__stage">
          <div class="editor__bar">
            <div class="tool__actions">
              ${action('undo', icons.undo, s('undo'))}
              ${action('redo', icons.redo, s('redo'))}
            </div>
            <div class="tool__actions editor__zoom">
              ${iconAction('zoom-out', icons.minus, s('zoomOut'))}
              <span class="editor__zoom-value" data-js="editor-zoom-value" translate="no">100%</span>
              ${iconAction('zoom-in', icons.plus, s('zoomIn'))}
            </div>
            <div class="tool__actions">
              ${action('compare', icons.eye, s('compare'))}
              ${action('reset', icons.refresh, s('reset'))}
            </div>
          </div>
          <div class="editor__view" data-zoom="1" data-js="editor-view">
            <canvas class="editor__canvas" tabindex="0" role="application" aria-label="${s('canvas')}" aria-describedby="editor__help" data-js="editor-canvas"></canvas>
          </div>
          <p class="tool__status" role="status" data-js="editor-status" data-template="${s('status')}"></p>
          <p class="facts__why" id="editor__help">${s('help')}</p>
        </div>
        <div class="editor__controls">
          <div class="tool__actions" role="group" aria-label="${s('tools')}">
            ${toolButton('crop', icons.crop, s('toolCrop'))}
            ${toolButton('resize', icons.resize, s('toolResize'))}
            ${toolButton('adjust', icons.sliders, s('toolAdjust'))}
            ${toolButton('filters', icons.palette, s('toolFilters'))}
            ${toolButton('text', icons.type, s('toolText'))}
            ${toolButton('draw', icons.pen, s('toolDraw'))}
          </div>
          <div class="editor__panel" data-js="editor-panel" data-tool="crop">
            <div class="tool__actions" role="group" aria-label="${s('turnGroup')}">
              ${iconAction('rotate-left', icons.rotateLeft, s('rotateLeft'))}
              ${iconAction('rotate-right', icons.rotateRight, s('rotateRight'))}
              ${iconAction('flip-h', icons.flipH, s('flipH'))}
              ${iconAction('flip-v', icons.flipV, s('flipV'))}
            </div>
            <div class="field">
              <label class="field__label" for="editor__angle">${s('straighten')}</label>
              <div class="editor__row">
                <input class="range" type="range" id="editor__angle" min="-45" max="45" step="0.1" value="0" data-js="editor-angle">
                <input class="input editor__amount" type="number" inputmode="decimal" min="-45" max="45" step="0.1" value="0" aria-label="${s('straightenDegrees')}" data-js="editor-angle-number">
                ${iconAction('angle-reset', icons.refresh, s('straightenReset'))}
              </div>
            </div>
            <div class="field">
              <label class="field__label" for="editor__aspect">${s('aspect')}</label>
              <div class="editor__row">
                <select class="select" id="editor__aspect" data-js="editor-aspect">
                  <option value="free">${s('aspectFree')}</option>
                  <option value="original">${s('aspectOriginal')}</option>
                  ${EDITOR_RATIOS.map((ratio) => html`<option value="${ratio}">${ratio}</option>`)}
                </select>
                ${iconAction('aspect-swap', icons.swap, s('aspectSwap'))}
              </div>
            </div>
            <div class="editor__bar">
              <div class="tool__actions" role="group" aria-label="${s('moveGroup')}">
                ${iconAction('move-left', icons.arrowLeft, s('moveLeft'))}
                ${iconAction('move-up', icons.arrowUp, s('moveUp'))}
                ${iconAction('move-down', icons.arrowDown, s('moveDown'))}
                ${iconAction('move-right', icons.arrowRight, s('moveRight'))}
              </div>
              <div class="tool__actions" role="group" aria-label="${s('sizeGroup')}">
                ${iconAction('narrower', icons.narrower, s('narrower'))}
                ${iconAction('wider', icons.wider, s('wider'))}
                ${iconAction('shorter', icons.shorter, s('shorter'))}
                ${iconAction('taller', icons.taller, s('taller'))}
              </div>
            </div>
            <div class="tool__actions">
              ${action('uncrop', icons.crop, s('removeCrop'))}
            </div>
          </div>
          <div class="editor__panel" data-js="editor-panel" data-tool="resize" hidden>
            <div class="editor__sizes">
              ${numberField('width', s('width'), '1', '100000')}
              ${numberField('height', s('height'), '1', '100000')}
            </div>
            ${option('editor__lock', 'editor-lock', s('lock'), true)}
            ${numberField('percent', s('percent'), '1', '1000')}
            <div class="tool__actions" role="group" aria-label="${s('longGroup')}">
              ${EDITOR_LONG_SIDES.map((side) => html`<button class="button button--ghost button--small" type="button" data-js="editor-long" data-size="${String(side)}">${s('longSide').replace('{n}', String(side))}</button>`)}
            </div>
            <div class="tool__actions">
              ${action('original', icons.refresh, s('original'))}
            </div>
            <p class="tool__status" role="status" data-js="editor-size-note" data-enlarged="${s('enlarged')}" data-limit="${s('limit')}"></p>
          </div>
          <div class="editor__panel" data-js="editor-panel" data-tool="adjust" hidden>
            ${EDITOR_ADJUSTMENTS.map(([key, min]) => {
              const name = s(`adjustments.${key}`);
              const reset = s('resetOne').replace('{name}', name);
              return html`<div class="field">
              <label class="field__label" for="editor__${key}">${name}</label>
              <div class="editor__row">
                <input class="range" type="range" id="editor__${key}" min="${String(min)}" max="100" step="1" value="0" data-js="editor-adjust" data-key="${key}">
                <input class="input editor__amount" type="number" inputmode="numeric" min="${String(min)}" max="100" step="1" value="0" aria-label="${name}" data-js="editor-adjust-number" data-key="${key}">
                <button class="button button--ghost button--small button--icon" type="button" aria-label="${reset}" title="${reset}" data-js="editor-adjust-reset" data-key="${key}">${icons.refresh}</button>
              </div>
            </div>`;
            })}
            <div class="tool__actions">
              ${action('reset-all', icons.refresh, s('resetAll'))}
            </div>
          </div>
          <div class="editor__panel" data-js="editor-panel" data-tool="filters" hidden>
            <div class="tool__actions" role="group" aria-label="${s('toolFilters')}">
              ${EDITOR_PRESETS.map((key) => html`<button class="button button--ghost button--small" type="button" aria-pressed="${key === 'none' ? 'true' : 'false'}" data-js="editor-preset" data-preset="${key}">${s(`presets.${key}`)}</button>`)}
            </div>
            <p class="facts__why">${s('filtersHelp')}</p>
          </div>
          <div class="editor__panel" data-js="editor-panel" data-tool="text" hidden>
            <div class="tool__actions">
              ${action('add-text', icons.plus, s('addText'))}
            </div>
            <div class="field">
              <label class="field__label" for="editor__text">${s('text')}</label>
              <textarea class="textarea" id="editor__text" rows="3" dir="auto" data-js="editor-text" data-new-text="${s('newText')}"></textarea>
            </div>
            <div class="field">
                <label class="field__label" for="editor__font">${s('font')}</label>
                <select class="select" id="editor__font" data-js="editor-font">
                  ${['site', 'sans', 'serif', 'mono'].map((font) => html`<option value="${font}">${s(`fonts.${font}`)}</option>`)}
                </select>
              </div>
              <div class="field">
                <label class="field__label" for="editor__align">${s('align')}</label>
                <select class="select" id="editor__align" data-js="editor-align">
                  ${['start', 'center', 'end'].map((align) => html`<option value="${align}"${align === 'center' ? html` selected` : null}>${s(`aligns.${align}`)}</option>`)}
                </select>
              </div>
            ${slider('text-size', s('textSize'), 5, 300, 60)}
            ${colorField('text-color', s('color'), '#ffffff', true)}
            <div class="tool__actions">
              ${option('editor__bold', 'editor-bold', s('bold'), true)}
              ${option('editor__italic', 'editor-italic', s('italic'), false)}
            </div>
            ${slider('text-opacity', s('opacity'), 10, 100, 100)}
            ${option('editor__outline', 'editor-outline', s('outline'), true)}
            ${colorField('outline-color', s('outlineColor'), '#000000', false)}
            ${option('editor__background', 'editor-background', s('background'), false)}
            ${colorField('background-color', s('backgroundColor'), '#000000', false)}
          </div>
          <div class="editor__panel" data-js="editor-panel" data-tool="draw" hidden>
            <div class="tool__actions" role="group" aria-label="${s('shape')}">
              ${EDITOR_SHAPES.map(([shape, icon]) => html`<button class="button button--ghost button--small" type="button" aria-pressed="${shape === 'pen' ? 'true' : 'false'}" data-js="editor-shape" data-shape="${shape}">${icons[icon]}<span>${s(`shapes.${shape}`)}</span></button>`)}
            </div>
            ${colorField('stroke', s('color'), '#e53935', true)}
            ${slider('stroke-width', s('thickness'), 1, 60, 6)}
            ${option('editor__fill', 'editor-fill', s('fill'), false)}
            ${colorField('fill-color', s('fillColor'), '#fdd835', false)}
            ${slider('stroke-opacity', s('opacity'), 10, 100, 100)}
            <p class="facts__why">${s('drawHelp')}</p>
          </div>
          <div class="editor__panel" role="group" aria-labelledby="editor__object" data-js="editor-object" hidden>
            <p class="field__label" id="editor__object">${s('object')}</p>
            <p class="tool__status" role="status" data-js="editor-selected" data-none="${s('selectedNone')}" data-text="${s('selectedText')}" data-drawing="${s('selectedDrawing')}"></p>
            <div class="editor__bar">
              <div class="tool__actions" role="group" aria-label="${s('layerMove')}">
                ${iconAction('layer-left', icons.arrowLeft, s('moveLeft'))}
                ${iconAction('layer-up', icons.arrowUp, s('moveUp'))}
                ${iconAction('layer-down', icons.arrowDown, s('moveDown'))}
                ${iconAction('layer-right', icons.arrowRight, s('moveRight'))}
              </div>
              <div class="tool__actions" role="group" aria-label="${s('layerSize')}">
                ${iconAction('layer-smaller', icons.minus, s('smaller'))}
                ${iconAction('layer-larger', icons.plus, s('larger'))}
              </div>
            </div>
            <div class="field">
              <label class="field__label" for="editor__rotation">${s('rotation')}</label>
              <input class="input editor__amount" type="number" inputmode="decimal" id="editor__rotation" min="-180" max="180" step="1" value="0" data-js="editor-layer-rotation">
            </div>
            <div class="tool__actions">
              ${action('duplicate', icons.copy, s('duplicate'))}
              ${action('forward', icons.arrowUp, s('forward'))}
              ${action('backward', icons.arrowDown, s('backward'))}
              ${action('delete', icons.trash, s('delete'))}
            </div>
          </div>
        </div>
        <div class="editor__save" role="group" aria-labelledby="editor__save">
          <p class="field__label" id="editor__save">${s('saveTitle')}</p>
          <div class="tool__actions" role="radiogroup" aria-label="${s('format')}">
            ${radio('editor-format', 'editor__jpeg', 'image/jpeg', 'editor-format', 'JPEG', true)}
            ${radio('editor-format', 'editor__png', 'image/png', 'editor-format', 'PNG', false)}
            ${radio('editor-format', 'editor__webp', 'image/webp', 'editor-format', 'WebP', false)}
          </div>
          <p class="tool__status" data-js="editor-format-note" data-no-webp="${s('noWebp')}"></p>
          <div class="field">
            <label class="field__label" for="editor__quality">${s('quality')}</label>
            <div class="editor__row">
              <input class="range" type="range" id="editor__quality" min="1" max="100" step="1" value="92" data-js="editor-quality">
              <span class="editor__quality-value" data-js="editor-quality-value" translate="no">92</span>
            </div>
          </div>
          <div class="tool__actions">
            <button class="button button--small" type="button" data-js="editor-create">${icons.eye}<span>${s('create')}</span></button>
          </div>
          <div class="editor__result" tabindex="-1" role="group" aria-labelledby="editor__result" data-js="editor-result" hidden>
            <p class="field__label" id="editor__result">${s('resultTitle')}</p>
            <p class="facts__why">${s('resultHelp')}</p>
            <canvas class="editor__saved" data-js="editor-result-canvas"></canvas>
            <p class="facts__why" data-js="editor-result-info" data-kb="${s('kb')}" data-mb="${s('mb')}" translate="no"></p>
            ${saveBox(ctx, s('download'))}
            <div class="tool__actions">
              <button class="button button--ghost button--small" type="button" data-js="editor-copy" data-done="${s('copied')}" data-failed="${s('copyFailed')}">${icons.copy}<span>${s('copyImage')}</span></button>
            </div>
            <p class="tool__status" role="status" data-js="editor-result-status"></p>
          </div>
        </div>
      </div>
      <p class="facts__why">${linkBefore}<a href="${ctx.url('/tools/image-redaction/')}">${s('redactLinkText')}</a>${linkAfter ?? ''}</p>`;
}

/**
 * Rows of the photo report, in the order they are listed: named values (see
 * Findings.fields in tool-photo.mjs), then kinds of data that are only named.
 * `unit` rows show the value inside their text ("{value} m"); `why` rows explain.
 */
const PHOTO_VALUES = [
  { key: 'altitude', unit: true },
  { key: 'direction', unit: true },
  { key: 'gpsTime', unit: true },
  { key: 'place' },
  { key: 'taken' },
  { key: 'camera' },
  { key: 'lens' },
  { key: 'serial', why: true },
  { key: 'lensSerial', why: true },
  { key: 'owner' },
  { key: 'artist' },
  { key: 'copyright' },
  { key: 'caption' },
  { key: 'keywords' },
  { key: 'uniqueId', why: true },
  { key: 'software' },
  { key: 'profile', why: true, unnamed: true },
];
const PHOTO_FLAGS = ['exif', 'xmp', 'iptc', 'photoshop', 'comment', 'thumbnail', 'trailing', 'c2pa', 'hdr', 'unread', 'other'];
/** What clean copies can keep (PhotoReport.kept); "profile" has the choice to drop it. */
const PHOTO_KEPT = ['thumbnail', 'xmp', 'exif', 'auxiliary', 'other'];
const PHOTO_ERRORS = ['unsupported', 'compact', 'optimised', 'tooLarge', 'batchLimit', 'damaged'];

/** @param {Ctx} ctx */
function photoPanel(ctx) {
  const { t } = ctx;
  /** @param {string} key */
  const s = (key) => t(`tools.items.photo.${key}`);
  return html`<div class="field">
        <label class="field__label" for="photo__file">${s('file')}</label>
        ${filePicker(ctx, 'photo__file', 'photo-file', 'image/jpeg,image/png,image/webp,image/heic,image/heif,image/avif,.jpg,.jpeg,.png,.webp,.heic,.heif,.avif', true)}
        <p class="facts__why">${s('pasteHint')}</p>
        <div class="tool__actions">
          <button class="button button--ghost button--small" type="button" data-js="photo-example">${icons.eye}<span>${t('tools.example')}</span></button>
        </div>
      </div>
      <p class="visually-hidden" role="status" data-js="photo-summary" data-one="${s('one')}" data-several="${s('several')}"></p>
      <div class="reports" data-js="photo-reports"></div>
      <div class="reports__all" data-js="photo-all" hidden>
        ${saveBox(ctx, s('downloadAll'))}
      </div>
      <template data-js="photo-template">
        <article class="file-report">
          <h3 class="file-report__name" data-js="photo-name" translate="no"></h3>
          <p class="tool__message" data-js="photo-message" data-found="${s('found')}" data-none="${s('none')}"${PHOTO_ERRORS.map((code) => html` data-${code.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}="${s(code)}"`)}></p>
          <figure class="photo-preview" data-js="photo-preview" hidden>
            <canvas class="photo-preview__picture" data-js="photo-preview-canvas" role="img" aria-label="${s('previewLabel')}"></canvas>
            <figcaption class="facts__why">${s('previewCaption')}</figcaption>
          </figure>
          <dl class="facts" data-js="photo-facts" hidden>
            <div class="facts__row" data-row="location" hidden><dt>${s('rows.location')}</dt><dd>
              <span translate="no" data-js="photo-coordinates"></span>
              <span class="tool__actions">${copyButton(ctx, 'photo-coordinates')}<span class="tool__status" role="status" data-js="photo-coordinates-status"></span></span>
              <span class="facts__why">${s('why.location')}</span>
            </dd></div>
            ${PHOTO_VALUES.map(
              ({ key, unit, why, unnamed }) => html`<div class="facts__row" data-row="${key}" hidden><dt>${s(`rows.${key}`)}</dt><dd><span translate="no" data-js="photo-value"${unit ? html` data-template="${s(`units.${key}`)}"` : null}${unnamed ? html` data-unnamed="${s('unnamedProfile')}"` : null}></span>${why ? html` <span class="facts__why">${s(`why.${key}`)}</span>` : null}</dd></div>`,
            )}
            <div class="facts__row" data-row="texts" hidden><dt>${s('rows.texts')}</dt><dd>
              <ul class="photo-texts" data-js="photo-texts" data-compressed="${s('textCompressed')}" data-more="${s('textMore')}"></ul>
              <template data-js="photo-text-template"><li><strong translate="no" data-js="photo-text-key"></strong>: <span class="photo-texts__body" translate="no" data-js="photo-text-body"></span> <span class="facts__why" data-js="photo-text-cut" hidden>${s('textCut')}</span></li></template>
              <span class="facts__why">${s('why.texts')}</span>
            </dd></div>
            ${PHOTO_FLAGS.map((row) => html`<div class="facts__row" data-row="${row}" data-flag hidden><dt>${s(`rows.${row}`)}</dt><dd>${s(`flags.${row}`)}</dd></div>`)}
          </dl>
          <section class="file-report__group file-report__group--kept" data-js="photo-kept" hidden>
            <h4 class="file-report__title">${s('keptTitle')}</h4>
            <ul class="findings">
              ${PHOTO_KEPT.map((key) => html`<li data-kept="${key}" hidden>${s(`kept.${key}`)}</li>`)}
              <li data-kept="profile" hidden>${s('kept.profile')}
                <label class="option"><input class="checkbox checkbox--small" type="checkbox" data-js="photo-drop-profile"><span>${s('dropProfile')}</span></label>
              </li>
            </ul>
            <p class="facts__why">${s('keptHow')}</p>
          </section>
          <p class="tool__note" data-js="photo-verified" data-ok="${s('verified')}" data-metadata-only="${s('verifiedMetadataOnly')}" data-failed="${s('verifyFailed')}" hidden></p>
          ${saveBox(ctx, s('download'))}
        </article>
      </template>`;
}

/** Video values, in the order they are listed (Findings.fields in tool-video.mjs). */
const VIDEO_VALUES = [
  { key: 'taken' },
  { key: 'timeZone' },
  { key: 'place' },
  { key: 'camera' },
  { key: 'lens' },
  { key: 'serial', why: true },
  { key: 'lensSerial', why: true },
  { key: 'uniqueId', why: true },
  { key: 'software' },
  { key: 'author' },
  { key: 'copyright' },
  { key: 'title' },
  { key: 'description' },
  { key: 'keywords' },
  { key: 'fileName', why: true },
];
const VIDEO_FLAGS = ['emptyLocation', 'thumbnail', 'xmp', 'c2pa', 'cameraData', 'samsung', 'frameData', 'timecode', 'dataTrack', 'gpsLog', 'hiddenData', 'trackNames', 'other'];
/** What stays in the clean copy (VideoReport.leftIn). */
const VIDEO_LEFT = ['encoderName', 'subtitles', 'unknownBox'];
const VIDEO_ERRORS = ['unsupported', 'photo', 'damaged', 'tooLarge', 'fragmented', 'readFailed'];

/** @param {Ctx} ctx */
function videoPanel(ctx) {
  const { t } = ctx;
  /** @param {string} key */
  const s = (key) => t(`tools.items.video.${key}`);
  /** "tooLarge" → "too-large" @param {string} key */
  const dataName = (key) => key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
  return html`<div class="field">
        <label class="field__label" for="video__file">${s('file')}</label>
        ${filePicker(ctx, 'video__file', 'video-file', 'video/mp4,video/quicktime,video/3gpp,video/3gpp2,video/x-m4v,.mp4,.mov,.m4v,.3gp,.3g2')}
        <p class="facts__why">${s('fileHint')}</p>
        <div class="tool__actions">
          <button class="button button--ghost button--small" type="button" data-js="video-example">${icons.eye}<span>${t('tools.example')}</span></button>
        </div>
      </div>
      <p class="visually-hidden" role="status" data-js="video-summary" data-done="${s('done')}"></p>
      <article class="file-report" data-js="video-report" hidden>
        <h3 class="file-report__name" data-js="video-name" translate="no"></h3>
        <p class="tool__message" data-js="video-message" data-reading="${s('reading')}" data-found="${s('found')}" data-none="${s('none')}"${VIDEO_ERRORS.map((code) => html` data-${dataName(code)}="${s(`errors.${code}`)}"`)}></p>
        <dl class="facts" data-js="video-facts" hidden>
          <div class="facts__row" data-row="location" hidden><dt>${s('rows.location')}</dt><dd>
            <span translate="no" data-js="video-coordinates"></span>
            <span class="facts__why" data-js="video-accuracy" data-template="${s('accuracy')}" hidden></span>
            <span class="tool__actions">${copyButton(ctx, 'video-coordinates')}<span class="tool__status" role="status" data-js="video-coordinates-status"></span></span>
            <span class="facts__why">${s('why.location')}</span>
          </dd></div>
          <div class="facts__row" data-row="route" hidden><dt>${s('rows.route')}</dt><dd>
            <span data-js="video-route" data-template="${s('route')}" data-unread="${s('routeUnread')}"></span>
            <span class="facts__why" translate="no" data-js="video-route-ends" data-template="${s('routeEnds')}" hidden></span>
            <span class="facts__why">${s('why.route')}</span>
          </dd></div>
          ${VIDEO_VALUES.map(
            ({ key, why }) => html`<div class="facts__row" data-row="${key}" hidden><dt>${s(`rows.${key}`)}</dt><dd><span translate="no" data-js="video-value"></span>${why ? html` <span class="facts__why">${s(`why.${key}`)}</span>` : null}</dd></div>`,
          )}
          ${VIDEO_FLAGS.map((row) => html`<div class="facts__row" data-row="${row}" data-flag hidden><dt>${s(`rows.${row}`)}</dt><dd>${s(`flags.${row}`)}</dd></div>`)}
        </dl>
        <section class="file-report__group file-report__group--kept" data-js="video-left" hidden>
          <h4 class="file-report__title">${s('leftTitle')}</h4>
          <ul class="findings">
            ${VIDEO_LEFT.map((key) => html`<li data-left="${key}" hidden>${s(`left.${key}`)} <span translate="no" data-js="video-left-names"></span></li>`)}
          </ul>
        </section>
        <p class="tool__note">${s('stays')}</p>
        <p class="tool__note" data-js="video-verified" data-ok="${s('verified')}" data-failed="${s('verifyFailed')}" hidden></p>
        ${saveBox(ctx, s('download'))}
      </article>`;
}

/**
 * Everything the attachment checker can find (FINDINGS in src/client/tool-attachment.mjs, same order), and whether a
 * finding lists values under it: names, addresses, commands.
 */
const ATTACHMENT_FINDINGS = /** @type {const} */ ([
  ['program', false], ['script', false], ['installer', false], ['androidApp', false], ['javaApp', false], ['profile', true], ['shortcut', true], ['riskyExtension', true], ['riskyOpen', true], ['insideProgram', true],
  ['bidi', true], ['doubleExtension', true], ['padded', false], ['mismatch', true], ['zipSameName', true], ['zipTraversal', true], ['zipNameMismatch', true], ['zipDuplicate', false], ['hiddenFiles', true], ['veryHidden', false], ['pdfObfuscated', true], ['insideDisguise', true],
  ['macros', false], ['macroSheet', false], ['activeX', false], ['dde', false], ['remote', true], ['embedded', true], ['autoUpdate', false], ['equationEditor', false],
  ['pdfJavaScript', false], ['pdfAutoAction', false], ['pdfLaunch', true], ['pdfRemote', true], ['pdfSubmit', true], ['pdfAttachments', true], ['pdfMedia', false], ['pdfXfa', false],
  ['pageScript', false], ['passwordForm', true], ['smuggling', false], ['refresh', true], ['foreignObject', false], ['remoteFolder', true], ['linkToProgram', true], ['diskImage', false], ['insideActive', true],
  ['encrypted', false], ['cantList', false], ['tooLarge', false], ['damaged', false], ['partlyRead', false], ['nested', false], ['insideLocked', true],
  ['webPage', false], ['svgPage', false],
]);

/** What the attachment checker can say a file is (detectType's kinds, refined by the checker). */
const ATTACHMENT_KINDS = [
  'exe', 'elf', 'macho', 'javaClass', 'jar', 'apk', 'msi', 'chm', 'mobileconfig', 'shebang', 'lnk', 'url', 'libraryMs', 'searchMs',
  'iso', 'vhd', 'vhdx', 'dmg', 'zip', 'rar', '7z', 'gzip', 'tar', 'cab', 'xar',
  'docx', 'xlsx', 'pptx', 'officeLocked', 'odf', 'doc', 'xls', 'ppt', 'msg', 'cfb', 'rtf', 'onenote', 'pdf', 'html', 'svg', 'xml', 'text',
  'jpeg', 'png', 'gif', 'webp', 'bmp', 'ico', 'heif', 'mp3', 'wav', 'aiff', 'ogg', 'midi', 'mp4', 'webm', 'avi', 'unknown', 'empty',
];

/** What a configuration profile can set up, in plain words (PAYLOADS in tool-attachment.mjs, plus "other"). */
const PROFILE_PAYLOADS = ['vpn', 'certificate', 'mdm', 'wifi', 'mail', 'dns', 'webClip', 'restrictions', 'other'];

/** The checker's verdicts, most serious first, and "none". */
const ATTACHMENT_VERDICTS = ['program', 'disguise', 'active', 'locked', 'none'];

/** "javaClass" → "java-class", the attribute form the client reads back with getAttribute. @param {string} key */
const attributeName = (key) => key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);

/** @param {Ctx} ctx */
function attachmentPanel(ctx) {
  const { t } = ctx;
  /** @param {string} key */
  const s = (key) => t(`tools.items.attachment.${key}`);
  /** data-program="…" data-disguise="…" … from one group of strings. @param {string} group */
  const byVerdict = (group) => ATTACHMENT_VERDICTS.map((verdict) => html` data-${verdict}="${s(`${group}.${verdict}`)}"`);
  return html`<div class="field">
        <label class="field__label" for="attachment__file">${s('file')}</label>
        ${filePicker(ctx, 'attachment__file', 'attachment-file', '', true)}
        <p class="facts__why">${s('fileHint')}</p>
        <div class="tool__actions">
          <button class="button button--ghost button--small" type="button" data-js="attachment-example">${icons.eye}<span>${t('tools.example')}</span></button>
        </div>
      </div>
      <p class="tool__message" role="status" data-js="attachment-summary" data-reading="${s('reading')}" data-done="${s('done')}" data-capped="${s('capped')}"></p>
      <div class="verdicts" data-js="attachment-results"></div>
      <p class="tool__note">${s('limit')}</p>
      <template data-js="attachment-template">
        <article class="verdict attachment">
          <h3 class="file-report__name" data-js="attachment-name" translate="no" dir="ltr"></h3>
          <p class="verdict__summary" data-js="attachment-verdict"${byVerdict('verdicts')}></p>
          <p data-js="attachment-advice"${byVerdict('advice')}></p>
          <dl class="facts">
            <div class="facts__row"><dt>${s('type')}</dt><dd data-js="attachment-kind"${ATTACHMENT_KINDS.map((kind) => html` data-kind-${attributeName(kind)}="${s(`kinds.${kind}`)}"`)}></dd></div>
          </dl>
          <section class="file-report__group" data-js="attachment-findings">
            <h4 class="file-report__title">${s('foundTitle')}</h4>
            <ul class="findings">
              ${ATTACHMENT_FINDINGS.map(
                ([key, listed]) => html`<li data-finding="${key}" hidden>${s(`findings.${key}`)}${listed ? html` <span class="attachment__values" data-js="attachment-values" translate="no" dir="ltr"${key === 'profile' ? PROFILE_PAYLOADS.map((payload) => html` data-payload-${attributeName(payload)}="${s(`payloads.${payload}`)}"`) : null}></span>` : null}</li>`,
              )}
            </ul>
          </section>
          <section class="file-report__group" data-js="attachment-inside" hidden>
            <h4 class="file-report__title" data-js="attachment-inside-title" data-template="${s('insideTitle')}"></h4>
            <ul class="findings" data-js="attachment-inside-list"${byVerdict('levels')}></ul>
            <p class="facts__why" data-js="attachment-inside-more" data-template="${s('insideMore')}" hidden></p>
          </section>
          <section class="file-report__group" data-js="attachment-links" hidden>
            <h4 class="file-report__title" data-js="attachment-links-title" data-template="${s('linksTitle')}"></h4>
            <ul class="findings" data-js="attachment-links-list" data-ok="${s('linkOk')}" data-warn="${s('linkWarn')}"></ul>
            <p class="facts__why" data-js="attachment-links-more" data-template="${s('linksMore')}" hidden></p>
            <p class="facts__why">${s('linksHint')} <a href="${ctx.url('/tools/link-checker/')}">${t('tools.items.check.title')}</a></p>
          </section>
        </article>
      </template>`;
}

/**
 * Everything the email header analyzer can find (FINDINGS in src/client/tool-email.mjs, same order), and the other
 * wordings some of them have (Finding.variant).
 */
const EMAIL_FINDINGS = /** @type {const} */ ([
  ['dmarcFail', 'warn', []], ['spoofedSender', 'warn', []], ['replyElsewhere', 'warn', ['free']], ['nameIsAddress', 'warn', []], ['lookalikeDomain', 'warn', ['script']], ['riskyAttachment', 'warn', []],
  ['nameHidden', 'warn', []], ['severalFrom', 'warn', []], ['filterSaidSpam', 'warn', []], ['dkimLength', 'warn', []], ['arcBroken', 'warn', []],
  ['noChecks', 'note', ['claimed', 'none']], ['partial', 'note', []], ['spfFail', 'note', []], ['spfSoftfail', 'note', []], ['dkimFail', 'note', []],
  ['freeMailbox', 'note', []], ['signedByOther', 'note', []], ['fakeReply', 'note', []], ['dateOdd', 'note', ['future', 'old']], ['slowHop', 'note', []],
  ['backwards', 'note', []], ['plainHop', 'note', []], ['privateOrigin', 'note', []], ['forwarded', 'note', []], ['oldDkim', 'note', []],
  ['bulkSender', 'info', []], ['mailingList', 'info', []], ['autoReply', 'info', []], ['software', 'info', []], ['senderAddress', 'info', []],
  ['messageIdElsewhere', 'info', []], ['encryptedInTransit', 'info', []], ['remoteImages', 'info', []],
]);

/** Result words the analyzer explains, per method (KNOWN_RESULTS in tool-email.mjs). */
const EMAIL_RESULTS = /** @type {const} */ ({
  spf: ['pass', 'fail', 'softfail', 'neutral', 'none', 'temperror', 'permerror', 'policy', 'hardfail'],
  dkim: ['pass', 'fail', 'neutral', 'none', 'policy', 'temperror', 'permerror'],
  dmarc: ['pass', 'fail', 'none', 'temperror', 'permerror', 'bestguesspass'],
  arc: ['pass', 'fail', 'none'],
  compauth: ['pass', 'fail', 'softpass', 'none'],
});

/** Kinds of IP address (IpClass in src/client/ip.mjs), each shown with one of four plain labels. */
const EMAIL_IP_CLASSES = /** @type {const} */ ({
  public: 'classPublic', private: 'classInternal', shared: 'classInternal', loopback: 'classInternal', linkLocal: 'classInternal', uniqueLocal: 'classInternal',
  documentation: 'classDocumentation', thisNetwork: 'classSpecial', protocol: 'classSpecial', benchmarking: 'classSpecial', relay: 'classSpecial', reserved: 'classSpecial',
  broadcast: 'classSpecial', unspecified: 'classSpecial', translation: 'classSpecial', discard: 'classSpecial', teredo: 'classSpecial', sixToFour: 'classSpecial', srv6: 'classSpecial',
});

/** Microsoft's spam-filter values the analyzer explains (research §5): SFV and CAT values, and the other fields. */
const EMAIL_FILTER_VALUES = /** @type {const} */ ({
  sfv: ['nspm', 'spm', 'sks', 'skb', 'blk', 'sfe', 'ska', 'ski', 'skn', 'skq'],
  cat: ['phsh', 'hphsh', 'hphish', 'spoof', 'spm', 'hspm', 'bulk', 'malw', 'amp', 'bimp', 'dimp', 'gimp', 'uimp', 'intos', 'sap', 'ftbp', 'ospm'],
});
const EMAIL_FILTER_FIELDS = ['sfv', 'cat', 'scl', 'bcl', 'cip', 'ctry', 'dir', 'sfty', 'x-spam-status'];

/** The rows of "Who sent it", in order; the ones with a same/other note compare with the From address. */
const EMAIL_IDENTITY = /** @type {const} */ ([['name', false], ['address', false], ['replyTo', true], ['returnPath', true], ['signedBy', false], ['sender', false], ['list', false], ['handoff', false]]);

/**
 * Where each mail program shows a message's headers, with the menu labels exactly as the vendor writes them, in
 * English in both languages (research §6 and §14). Only paths confirmed on the vendor's own page are listed.
 */
const EMAIL_HOWTO = /** @type {const} */ ([
  ['gmail', ['Reply', 'More', 'Show original', 'Copy to clipboard']],
  ['outlook', ['More actions', 'View', 'View message details', 'Message details']],
  ['outlookClassic', ['File', 'Properties', 'Internet headers']],
  ['icloud', ['More', 'Show All Headers']],
  ['yahoo', ['More options', 'View Raw Message']],
  ['proton', ['More', 'View headers', 'More options', 'View Headers']],
  ['appleMail', ['View', 'Message', 'All Headers']],
]);

/**
 * A sentence with menu labels in it: "{1}" is the first label, shown bold and left untranslated.
 * @param {string} text
 * @param {readonly string[]} labels
 */
function withLabels(text, labels) {
  return text.split(/\{(\d)\}/).map((part, index) => (index % 2 ? html`<strong translate="no">${labels[Number(part) - 1]}</strong>` : html`${part}`));
}

/**
 * "How to get the headers": static steps shown above the tool, so they work without JavaScript and never move.
 * @param {Ctx} ctx
 */
function emailHowto(ctx) {
  const { t } = ctx;
  /** @param {string} key */
  const s = (key) => t(`tools.items.email.${key}`);
  return html`<section class="email__howto" aria-labelledby="email__howto">
        <h2 class="file-report__title" id="email__howto">${s('howto.title')}</h2>
        <p class="facts__why">${s('howto.intro')}</p>
        ${EMAIL_HOWTO.map(([client, labels]) => html`<details class="email__client">
          <summary>${s(`howto.${client}.name`)}</summary>
          <p>${withLabels(s(`howto.${client}.steps`), labels)}</p>
        </details>`)}
        <p class="facts__why">${s('howto.others')}</p>
      </section>`;
}

/** @param {Ctx} ctx */
function emailPanel(ctx) {
  const { t } = ctx;
  /** @param {string} key */
  const s = (key) => t(`tools.items.email.${key}`);
  /** data-class-private="…" and so on, on an element that shows an IP address. */
  const classes = [...Object.entries(EMAIL_IP_CLASSES).map(([name, label]) => html` data-class-${attributeName(name)}="${s(label)}"`), html` data-invalid="${s('classInvalid')}"`];
  return html`<div class="field">
        <label class="field__label" for="email__input">${s('input')}</label>
        <textarea class="textarea" id="email__input" rows="8" autocomplete="off" autocapitalize="off" spellcheck="false" dir="ltr" data-js="email-input"></textarea>
        <p class="facts__why">${s('inputHint')}</p>
      </div>
      <div class="field">
        <label class="field__label" for="email__file">${s('file')}</label>
        ${filePicker(ctx, 'email__file', 'email-file', '.eml,.msg,message/rfc822')}
      </div>
      <div class="tool__actions">
        <button class="button button--small" type="button" data-js="email-check">${icons.search}<span>${s('check')}</span></button>
        <button class="button button--ghost button--small" type="button" data-js="email-clear">${icons.trash}<span>${s('clear')}</span></button>
      </div>
      <div class="tool__actions" role="group" aria-label="${t('tools.example')}">
        <span class="facts__why">${t('tools.example')}:</span>
        ${[1, 2, 3].map((n) => html`<button class="button button--ghost button--small" type="button" data-js="email-example" data-example="${n - 1}">${icons.eye}<span>${s(`example${n}`)}</span></button>`)}
      </div>
      <p class="tool__message" role="status" data-js="email-message" data-empty="${s('messages.empty')}" data-not-headers="${s('messages.notHeaders')}" data-too-large="${s('messages.tooLarge')}" data-read-failed="${s('messages.readFailed')}" data-msg-no-headers="${s('messages.msgNoHeaders')}"></p>
      <div class="email" data-js="email-report" hidden>
        <article class="verdict email__verdict" data-js="email-verdict-card">
          <p class="verdict__summary" data-js="email-verdict" data-warn="${s('verdicts.warn')}" data-unchecked="${s('verdicts.unchecked')}" data-none="${s('verdicts.none')}"></p>
          <div class="tool__actions">
            <button class="button button--ghost button--small" type="button" data-js="copy" data-copy-from="email-summary-text" data-status="email-summary-text-status" data-done="${t('tools.copied')}" data-failed="${t('tools.copyFailed')}">${icons.copy}<span>${s('copySummary')}</span></button>
            <span class="facts__why" role="status" data-js="email-summary-text-status"></span>
          </div>
          <pre class="email__summary" data-js="email-summary-text" hidden></pre>
        </article>

        <section class="file-report__group" aria-labelledby="email__who">
          <h3 class="file-report__title" id="email__who">${s('whoTitle')}</h3>
          <dl class="facts" data-js="email-identity">
            ${EMAIL_IDENTITY.map(([row, compared]) => html`<div class="facts__row" data-row="${row}" hidden><dt>${s(`identity.${row}`)}</dt><dd>${row === 'address'
              ? html`<span class="verdict__address" data-js="email-address" translate="no" dir="ltr"></span>`
              : html`<span${row === 'name' ? null : html` class="verdict__address"`} data-js="email-value" translate="no"${row === 'name' ? null : html` dir="ltr"`}></span>`}${compared
              ? html`<span class="facts__why" data-js="email-same" data-same="${s(`identity.${row}Same`)}" data-other="${s(`identity.${row}Other`)}"></span>`
              : null}${row === 'handoff' ? html`<span class="facts__why" data-js="email-class"${classes}></span>` : null}</dd></div>`)}
          </dl>
        </section>

        <section class="file-report__group" aria-labelledby="email__checks">
          <h3 class="file-report__title" id="email__checks">${s('checksTitle')}</h3>
          <p class="facts__why" data-js="email-receiver" data-named="${s('receiver.named')}" data-provider="${s('receiver.provider')}" data-unnamed="${s('receiver.unnamed')}" data-none="${s('receiver.none')}"></p>
          <ul class="findings email__checks" data-js="email-checks"></ul>
          <p class="facts__why" data-js="email-checks-none">${s('checksNone')}</p>
          <template data-js="email-check-template">
            <li class="email__check">
              <span class="email__check-head"><strong data-js="email-check-method"${Object.keys(EMAIL_RESULTS).map((method) => html` data-${method}="${s(`methods.${method}`)}"`)}></strong> <code data-js="email-check-result" translate="no"></code></span>
              <span data-js="email-check-meaning" data-unknown="${s('meanings.unknown')}"${Object.entries(EMAIL_RESULTS).flatMap(([method, results]) => results.map((result) => html` data-${method}-${result}="${s(`meanings.${method}.${result}`)}"`))}></span>
              <span class="facts__why" data-js="email-check-domain" data-plain="${s('domain.plain')}" data-same="${s('domain.same')}" data-other="${s('domain.other')}"></span>
              <span class="attachment__values" data-js="email-check-comments" translate="no" dir="ltr"></span>
              <span class="email__claimed" data-js="email-check-claimed">${s('claimed')}</span>
            </li>
          </template>
        </section>

        <section class="file-report__group" data-js="email-filter" aria-labelledby="email__filter" hidden>
          <h3 class="file-report__title" id="email__filter">${s('filterTitle')}</h3>
          <ul class="findings" data-js="email-filter-list"${EMAIL_FILTER_FIELDS.map((field) => html` data-${field}="${s(`filter.${field}`)}"`)}${Object.entries(EMAIL_FILTER_VALUES).flatMap(([field, values]) => values.map((value) => html` data-${field}-${value}="${s(`filter.${field}Values.${value}`)}"`))}></ul>
        </section>

        <section class="file-report__group" data-js="email-route-section" aria-labelledby="email__route">
          <h3 class="file-report__title" id="email__route">${s('routeTitle')}</h3>
          <p class="facts__why">${s('routeHint')}</p>
          <ol class="findings email__route" data-js="email-route" data-seconds="${s('units.seconds')}" data-minutes="${s('units.minutes')}" data-hours="${s('units.hours')}" data-days="${s('units.days')}"></ol>
          <p class="facts__why" data-js="email-dates" data-template="${s('dates')}" hidden></p>
          <template data-js="email-hop-template">
            <li class="email__hop">
              <span class="verdict__address" data-js="email-hop-path" data-template="${s('hop.path')}" translate="no" dir="ltr"></span>
              <span class="facts__why" data-js="email-hop-address" data-template="${s('hop.address')}"${classes}></span>
              <span class="facts__why" data-js="email-hop-protocol" data-tls-auth="${s('hop.tlsAuth')}" data-tls="${s('hop.tls')}" data-auth="${s('hop.auth')}" data-plain="${s('hop.plain')}" data-unknown="${s('hop.unknown')}"></span>
              <span class="facts__why" data-js="email-hop-time" data-template="${s('hop.time')}"></span>
              <span class="facts__why" data-js="email-hop-delay" data-template="${s('hop.delay')}"></span>
              <span class="email__claimed" data-js="email-hop-claimed">${s('hopClaimed')}</span>
            </li>
          </template>
        </section>

        <section class="file-report__group" data-js="email-findings" aria-labelledby="email__findings">
          <h3 class="file-report__title" id="email__findings">${s('findingsTitle')}</h3>
          <ul class="findings">
            ${EMAIL_FINDINGS.map(([key, level, variants]) => html`<li data-finding="${key}" data-level="${level}" hidden><strong class="email__level">${s(`levels.${level}`)}</strong> <span data-js="email-finding-text" data-template="${s(`findings.${key}`)}"${variants.map((variant) => html` data-${variant}="${s(`findings.${key}${variant[0].toUpperCase()}${variant.slice(1)}`)}"`)}></span></li>`)}
          </ul>
        </section>

        <section class="file-report__group" data-js="email-body" aria-labelledby="email__body" hidden>
          <h3 class="file-report__title" id="email__body">${s('body.title')}</h3>
          <p class="facts__why" data-js="email-body-unread" hidden>${s('body.unread')}</p>
          <div class="email__body-part" data-js="email-links" hidden>
            <p class="field__label" data-js="email-links-title" data-template="${s('body.linksTitle')}"></p>
            <ul class="findings" data-js="email-links-list" data-ok="${s('body.linkOk')}" data-warn="${s('body.linkWarn')}"></ul>
            <p class="facts__why" data-js="email-links-more" data-template="${s('body.more')}" hidden></p>
            <p class="facts__why">${s('body.linksHint')} <a href="${ctx.url('/tools/link-checker/')}">${t('tools.items.check.title')}</a></p>
          </div>
          <div class="email__body-part" data-js="email-attachments" hidden>
            <p class="field__label" data-js="email-attachments-title" data-template="${s('body.attachmentsTitle')}"></p>
            <ul class="findings" data-js="email-attachments-list" data-risky="${s('body.attachmentRisky')}" data-ok="${s('body.attachmentOk')}" data-unnamed="${s('body.unnamed')}" data-bytes="${s('body.bytes')}" data-kb="${s('body.kb')}" data-mb="${s('body.mb')}"></ul>
            <p class="facts__why" data-js="email-attachments-more" data-template="${s('body.more')}" hidden></p>
            <p class="facts__why">${s('body.attachmentsHint')} <a href="${ctx.url('/tools/attachment-checker/')}">${t('tools.items.attachment.title')}</a></p>
          </div>
        </section>

        <p class="facts__why email__next">${s('next')} <a href="${ctx.url('/guides/phishing/#pause')}">${s('nextPause')}</a> · <a href="${ctx.url('/guides/phishing/#report')}">${s('nextReport')}</a> · <a href="${ctx.url('/tools/link-checker/')}">${t('tools.items.check.title')}</a> · <a href="${ctx.url('/tools/attachment-checker/')}">${t('tools.items.attachment.title')}</a> · <a href="${ctx.url('/guides/sensitive-email/#what-email-reveals')}">${s('nextReveals')}</a></p>

        <details class="email__headers">
          <summary data-js="email-headers-count" data-template="${s('headersTitle')}"></summary>
          <p class="facts__why" data-js="email-unread" data-template="${s('unread')}" hidden></p>
          <dl class="facts" data-js="email-headers"></dl>
          <template data-js="email-header-template">
            <div class="facts__row"><dt data-js="email-header-name" translate="no"></dt><dd class="verdict__address" data-js="email-header-value" translate="no" dir="ltr"></dd></div>
          </template>
        </details>
      </div>
      <p class="tool__note">${s('limit')}</p>`;
}

/** What the hidden character detector looks for, in the order it is listed (see KINDS in tool-hidden.mjs). */
const HIDDEN_KINDS = ['zeroWidth', 'bidi', 'tags', 'softHyphen', 'spaces', 'trailing', 'lookalike', 'doubleSpace', 'quotes', 'dashes', 'fullwidth', 'mathLetters', 'compatibility', 'composition', 'dotless', 'georgianCase'];

/** @param {Ctx} ctx */
function hiddenPanel(ctx) {
  const { t } = ctx;
  /** @param {string} key */
  const s = (key) => t(`tools.items.hidden.${key}`);
  return html`<div class="field">
        <label class="field__label" for="hidden__input">${s('input')}</label>
        <textarea class="textarea" id="hidden__input" rows="6" autocomplete="off" autocapitalize="off" spellcheck="false" data-js="hidden-input"></textarea>
        <div class="tool__actions">
          <button class="button button--ghost button--small" type="button" data-js="hidden-example" data-example="${s('exampleText')}">${icons.eye}<span>${t('tools.example')}</span></button>
        </div>
      </div>
      <div class="field">
        <label class="field__label" for="hidden__file">${s('file')}</label>
        ${filePicker(ctx, 'hidden__file', 'hidden-file', '.txt,.md,.csv,text/plain')}
        <p class="facts__why" role="status" data-js="hidden-file-message" data-unsupported="${s('fileUnsupported')}" data-too-large="${s('fileTooLarge')}">${s('fileHint')}</p>
      </div>
      ${option('hidden__normalise', 'hidden-normalise', s('normalise'), false)}
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
          <p class="facts__why" role="status" data-js="hidden-mark-info">${s('markHint')}</p>
          <p class="field__label" id="hidden__clean">${s('clean')}</p>
          <p class="tool__value tool__value--text" tabindex="0" data-js="hidden-clean" aria-labelledby="hidden__clean" translate="no"></p>
          <div class="tool__actions">
            ${copyButton(ctx, 'hidden-clean')}
          </div>
          <p class="tool__status" role="status" data-js="hidden-clean-status"></p>
        </div>
      </div>
      <section class="compare" aria-labelledby="hidden__compare">
        <h2 class="report__title" id="hidden__compare">${s('compare.heading')}</h2>
        <p class="facts__why">${s('compare.intro')}</p>
        <div class="field">
          <label class="field__label" for="hidden__other">${s('compare.input')}</label>
          <textarea class="textarea" id="hidden__other" rows="6" autocomplete="off" autocapitalize="off" spellcheck="false" data-js="hidden-other"></textarea>
        </div>
        <p class="tool__message" role="status" data-js="hidden-compare-summary" data-same="${s('compare.same')}" data-found="${s('compare.found')}" data-too-long="${s('compare.tooLong')}" data-too-different="${s('compare.tooDifferent')}" data-needs-first="${s('compare.needsFirst')}"></p>
        <div class="marked" tabindex="0" role="group" aria-labelledby="hidden__compare" data-js="hidden-compare" translate="no" hidden></div>
      </section>`;
}

/**
 * A save area for a cleaned file (see src/client/save.mjs): a neutral-name
 * option, the download link, sharing where the browser can, and what to do
 * if saving fails. Works inside templates, so it uses no ids.
 * @param {Ctx} ctx
 * @param {string} label  The download button's text.
 */
function saveBox({ t }, label) {
  return html`<div class="save" data-js="save" hidden>
          <label class="option"><input class="checkbox checkbox--small" type="checkbox" data-js="save-neutral"><span>${t('tools.save.neutral')} <span class="save__name" data-js="save-neutral-name" translate="no"></span></span></label>
          <div class="tool__actions">
            <a class="button button--small" data-js="save-download">${icons.download}<span>${label}</span></a>
            <button class="button button--ghost button--small share-only" type="button" data-js="save-share">${icons.share}<span>${t('tools.share')}</span></button>
          </div>
          <p class="tool__status" role="status" data-js="save-status" data-no-share="${t('tools.save.noShare')}" data-failed="${t('tools.save.failed')}"></p>
          <p class="save__hint" data-js="save-hint">${t('tools.save.hint')}</p>
        </div>`;
}

/** Document properties with a value, in the order they are listed. */
const DOCUMENT_VALUES = ['author', 'lastAuthor', 'company', 'manager', 'title', 'subject', 'keywords', 'comments', 'created', 'modified', 'printed', 'printedBy', 'revision', 'editTime', 'software', 'producer', 'template'];
/** Findings by the group they can appear in (see Finding in tool-document.mjs). */
const DOCUMENT_FINDINGS = {
  removed: [
    'properties', 'custom', 'people', 'commentAuthors', 'revisionAuthors', 'coauthoring', 'dates', 'template', 'absPath', 'printer', 'dataSource', 'rsid', 'documentIds',
    'thumbnail', 'media', 'embeddedProperties', 'signatures', 'customXml',
  ],
  kept: [
    'properties', 'tracked', 'commentsPart', 'notes', 'hiddenSheets', 'hiddenSlides', 'nameFields', 'external', 'labels',
    'revisions', 'annotations', 'attachments', 'forms', 'formValues', 'pdfSignatures', 'scripts', 'xmp', 'documentId',
  ],
  unchecked: ['propertiesUnchecked', 'objectsUnchecked', 'xmpUnchecked', 'embedded', 'mediaUnchecked', 'macros', 'unknownParts'],
};
const DOCUMENT_ERRORS = ['unsupported', 'old', 'locked', 'encrypted', 'tooLarge', 'damaged', 'zip64', 'browser'];
/** What the file picker offers: Word, Excel and PowerPoint files with their macro-enabled, template and slide-show kinds, OpenDocument and PDF. */
const DOCUMENT_ACCEPT = '.docx,.docm,.dotx,.dotm,.xlsx,.xlsm,.xltx,.xltm,.pptx,.pptm,.ppsx,.ppsm,.potx,.potm,.odt,.ods,.odp,.ott,.ots,.otp,.pdf,application/pdf';

/** @param {Ctx} ctx */
function documentPanel(ctx) {
  const { t } = ctx;
  /** @param {string} key */
  const s = (key) => t(`tools.items.document.${key}`);
  /** @param {'removed' | 'kept' | 'unchecked'} group */
  const findingRow = (group) => (/** @type {string} */ key) =>
    key === 'properties'
      ? html`<li data-finding="properties" hidden><dl class="facts" data-js="document-fields">
              ${DOCUMENT_VALUES.map((row) => html`<div class="facts__row" data-row="${row}" hidden><dt>${s(`rows.${row}`)}</dt><dd translate="no"></dd></div>`)}
            </dl></li>`
      : html`<li data-finding="${key}" data-template="${s(`findings.${key}`)}" hidden>${group === 'kept' ? html`<span data-js="document-text"></span> <span class="facts__why">${s(`how.${key}`)}</span>` : null}</li>`;
  return html`<div class="field">
        <label class="field__label" for="document__file">${s('file')}</label>
        ${filePicker(ctx, 'document__file', 'document-file', DOCUMENT_ACCEPT, true)}
        <p class="facts__why">${s('dropHint')}</p>
        <div class="tool__actions">
          <button class="button button--ghost button--small" type="button" data-js="document-example">${icons.eye}<span>${t('tools.example')}</span></button>
        </div>
      </div>
      <p class="visually-hidden" role="status" data-js="document-summary" data-one="${s('one')}" data-several="${s('several')}"></p>
      <div class="reports" data-js="document-reports"></div>
      <div class="reports__all" data-js="document-all" hidden>
        ${saveBox(ctx, s('downloadAll'))}
      </div>
      <template data-js="document-template">
        <article class="file-report">
          <h3 class="file-report__name" data-js="document-name" translate="no"></h3>
          <p class="tool__message" data-js="document-message" data-found="${s('found')}" data-none="${s('none')}"${DOCUMENT_ERRORS.map((code) => html` data-${code.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}="${s(code)}"`)}></p>
          ${(/** @type {const} */ (['removed', 'kept', 'unchecked'])).map(
            (group) => html`<section class="file-report__group file-report__group--${group}" data-group="${group}" hidden>
            <h4 class="file-report__title">${s(`groups.${group}`)}</h4>
            <ul class="findings">
              ${DOCUMENT_FINDINGS[group].map(findingRow(group))}
            </ul>
          </section>`,
          )}
          <p class="tool__note" data-js="document-pdf" hidden>${s('pdfOnly')}</p>
          <p class="tool__note" data-js="document-verified" data-ok="${s('verified')}" data-failed="${s('verifyFailed')}" hidden></p>
          ${saveBox(ctx, s('download'))}
        </article>
      </template>`;
}

/**
 * The browser report: groups of rows; `why` rows get a short explanation. Rows are filled by tool-browser.mjs.
 * `rating`: how identifying the detail was in large studies (docs/research/tool-browser-check.md);
 * `protected`: the row can say the browser protects it; `template`: the value is shown inside a sentence.
 */
const BROWSER_GROUPS = [
  { key: 'place', rows: [{ key: 'languages', why: true, rating: 'some' }, { key: 'timeZone', why: true, rating: 'some', protected: true }] },
  {
    key: 'device',
    rows: [
      { key: 'userAgent', why: true, rating: 'strong' },
      { key: 'os', why: true },
      { key: 'model', why: false },
      { key: 'platform', why: false, rating: 'some' },
      { key: 'gpu', why: true, rating: 'strong' },
      { key: 'cores', why: false, rating: 'some' },
      { key: 'memory', why: false },
      { key: 'screen', why: true, rating: 'some', protected: true },
      { key: 'pixelRatio', why: true },
      { key: 'window', why: true, rating: 'strong', protected: true },
      { key: 'colors', why: false, rating: 'barely' },
      { key: 'touch', why: false, rating: 'some' },
    ],
  },
  {
    key: 'settings',
    rows: [
      { key: 'theme', why: false },
      { key: 'motion', why: true },
      { key: 'contrast', why: false },
      { key: 'cookies', why: false, rating: 'barely' },
      { key: 'dnt', why: true, rating: 'some' },
      { key: 'gpc', why: true },
    ],
  },
  { key: 'signature', rows: [{ key: 'canvas', why: true, rating: 'strong', protected: true }, { key: 'fonts', why: true, rating: 'strong' }] },
  {
    key: 'extra',
    rows: [
      { key: 'keyboard', why: true },
      { key: 'voices', why: true, template: true },
      { key: 'blocker', why: true },
    ],
  },
  { key: 'network', rows: [{ key: 'connection', why: false }, { key: 'referrer', why: true }] },
];
const BROWSER_TOKENS = ['yes', 'no', 'on', 'off', 'unset', 'unsupported', 'none', 'dark', 'light', 'unknown', 'notSeen'];
/** The studies behind the ratings (docs/research/tool-browser-check.md); names of people and papers aren't translated. */
const RATING_SOURCES = [
  { label: 'Eckersley 2010', url: 'https://coveryourtracks.eff.org/static/browser-uniqueness.pdf' },
  { label: 'Laperdrix et al. 2016', url: 'https://hal.science/hal-01285470/document' },
  { label: 'Gómez-Boix et al. 2018', url: 'https://hal.science/hal-01718234/document' },
  { label: 'Andriamilanto et al. 2022', url: 'https://arxiv.org/pdf/2006.09511' },
];
/** Next steps per browser family (data-browser, set by the head script in assets.mjs) and the guide item each points to. */
const BROWSER_STEPS = [
  { family: 'firefox', item: 'content-blocker' },
  { family: 'safari', item: 'private-window-limits' },
  { family: 'brave', item: 'content-blocker' },
  { family: 'chromium', item: 'choose-browser' },
  { family: 'other', item: 'choose-browser' },
];

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
  const tokens = BROWSER_TOKENS.map((token) => html` data-token-${token.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}="${s(`tokens.${token}`)}"`);
  // Everything the script reveals later already has its place: the "Changed" mark sits invisible beside the value,
  // and a protection note shares one grid cell with the explanation it replaces, so nothing below moves (rule 4).
  /** @param {{ key: string, why: boolean, rating?: string, protected?: boolean, template?: boolean }} row */
  const factRow = ({ key, why, rating, protected: guarded, template }) =>
    html`<div class="facts__row" data-row="${key}"><dt>${s(`rows.${key}`)}${rating ? html` <span class="rating rating--${rating}">${s(`ratings.${rating}`)}</span>` : null}</dt><dd><span class="facts__line"><span class="facts__value" data-js="browser-value" translate="no"${template ? html` data-template="${s(`templates.${key}`)}"` : null}></span><span class="facts__changed" data-changed>${s('compare.mark')}</span></span>${guarded ? html`<span class="facts__notes" data-js="browser-notes"><span class="facts__why">${s(`why.${key}`)}</span><span class="facts__protected" data-protected>${s(`protected.${key}`)}</span></span>` : why ? html`<span class="facts__why">${s(`why.${key}`)}</span>` : null}</dd></div>`;

  return html`<div class="report" data-js="browser-facts"${tokens}>
        <div class="fingerprint" data-row="fingerprint">
          <p class="field__label">${s('fingerprint')}</p>
          <p class="facts__line"><span class="fingerprint__value" data-js="browser-value" translate="no"></span><span class="facts__changed" data-changed>${s('compare.mark')}</span></p>
          <div class="facts__notes" data-js="browser-fingerprint-notes">
            <p class="facts__why" data-js="browser-fingerprint-why">${s('fingerprintWhy')}</p>
            <p class="facts__protected" data-js="browser-fingerprint-protected">${s('fingerprintProtected')}</p>
          </div>
        </div>
        ${BROWSER_GROUPS.map(
          (group) => html`<section class="report__group" aria-labelledby="browser__${group.key}">
          <h2 class="report__title" id="browser__${group.key}">${s(`groups.${group.key}`)}</h2>
          <dl class="facts">
            ${group.rows.map(factRow)}
            ${group.key === 'network'
              ? html`<div class="facts__row"><dt>${s('rows.ip')}</dt><dd>
              <span class="facts__value" role="status" data-js="browser-ip-value" translate="no"></span>
              <span class="tool__actions"><button class="button button--ghost button--small" type="button" data-js="browser-ip">${s('ipButton')}</button></span>
              <span class="tool__status" role="status" data-js="browser-ip-status" data-failed="${s('ipFailed')}"></span>
              <span class="facts__why">${s('why.ip')}</span>
            </dd></div>`
              : null}
          </dl>
        </section>`,
        )}
        <p class="facts__why report__sources">${s('ratingsNote')} ${RATING_SOURCES.map(({ label, url }, i) => html`${i ? '; ' : ''}<a href="${url}" target="_blank" rel="external noopener noreferrer">${label}</a>`)}.</p>
      </div>
      <section class="steps" aria-labelledby="browser__steps">
        <h2 class="report__title" id="browser__steps">${s('steps.heading')}</h2>
        ${BROWSER_STEPS.map(({ family, item }) => html`<p class="steps__family" data-family="${family}">${s(`steps.${family}`)} <a href="${ctx.url('/guides/browser/')}#${item}">${s('steps.guide')}</a></p>`)}
      </section>
      <section class="compare-settings" aria-labelledby="browser__compare">
        <h2 class="report__title" id="browser__compare">${s('compare.heading')}</h2>
        <p class="facts__why">${s('compare.intro')}</p>
        <div class="tool__actions">
          <button class="button button--ghost button--small" type="button" data-js="browser-compare-remember" disabled>${s('compare.remember')}</button>
          <button class="button button--ghost button--small" type="button" data-js="browser-compare-forget" disabled>${s('compare.forget')}</button>
        </div>
        <p class="tool__status" role="status" data-js="browser-compare-status" data-remembered="${s('compare.remembered')}" data-failed="${s('compare.failed')}" data-forgotten="${s('compare.forgotten')}" data-changed="${s('compare.changed')}" data-same="${s('compare.same')}"></p>
      </section>
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
        <p class="field__label">${s('autofill.browsersHeading')}</p>
        <ul class="facts__why autofill__browsers">
          ${['firefox', 'chromium', 'safari', 'study'].map((key) => html`<li>${s(`autofill.browsers.${key}`)}</li>`)}
        </ul>
        <p class="facts__why">${s('autofill.tip')}</p>
      </section>
      <section class="cannot" aria-labelledby="browser__cannot">
        <h2 class="report__title" id="browser__cannot">${s('cannot.heading')}</h2>
        <ul class="cannot__list">
          ${[1, 2, 3, 4, 5].map((n) => html`<li>${s(`cannot.item${n}`)}</li>`)}
        </ul>
      </section>`;
}

/** Warnings about a typed password (see passwordWarnings in tool-encrypt.mjs), in the order they are listed. */
const ENCRYPT_WARNINGS = ['tooShort', 'short', 'oneClass', 'run', 'name', 'text', 'mismatch'];
/** What the message line can say (data-* in kebab case on it; see MESSAGES in tool-encrypt.mjs). */
const ENCRYPT_MESSAGES = [
  'locking', 'checking', 'opening', 'locked', 'opened', 'needsInput', 'wrongPassword', 'damaged', 'notLocked', 'newerVersion', 'tooLarge',
  'bundleTooLarge', 'unsupported', 'readFailed', 'cancelled', 'verifyFailed',
];
const ENCRYPT_UNITS = ['b', 'kb', 'mb', 'gb'];
/** The example's password: shown to everyone, so it is a demonstration and nothing else. */
const ENCRYPT_EXAMPLE_PASSWORD = 'example-only-pocket-violin-tundra-spark';

/** @param {string} name */
const kebab = (name) => name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);

/** @param {Ctx} ctx */
function encryptPanel(ctx) {
  const { t, site, lang } = ctx;
  /** @param {string} key */
  const s = (key) => t(`tools.items.encrypt.${key}`);
  const page = absoluteUrl(site, localePath(site, lang, '/tools/file-encryption/'));
  /** A password field with its show/hide button. @param {string} name @param {string} label */
  const passwordField = (name, label) => html`<div class="field">
            <label class="field__label" for="encrypt__${name}">${label}</label>
            <div class="encrypt__password">
              <input class="input" type="password" id="encrypt__${name}" data-js="encrypt-${name}" autocomplete="new-password" autocapitalize="off" autocorrect="off" spellcheck="false" translate="no" dir="ltr">
              <button class="button button--ghost button--small" type="button" data-js="encrypt-${name}-show" aria-controls="encrypt__${name}" aria-pressed="false" data-show="${s('show')}" data-hide="${s('hide')}">${icons.eye}<span>${s('show')}</span></button>
            </div>
          </div>`;
  return html`<div class="encrypt" data-js="encrypt"${ENCRYPT_UNITS.map((unit) => html` data-${unit}="${s(`units.${unit}`)}"`)}>
      <fieldset class="field">
        <legend class="field__label">${s('mode')}</legend>
        <div class="segmented">
          ${radio('encrypt-mode', 'encrypt__mode-lock', 'lock', 'encrypt-mode', s('modeLock'), true)}
          ${radio('encrypt-mode', 'encrypt__mode-open', 'open', 'encrypt-mode', s('modeOpen'), false)}
        </div>
      </fieldset>
      <div class="encrypt__mode" data-js="encrypt-lock">
        <fieldset class="field">
          <legend class="field__label">${s('what')}</legend>
          ${radio('encrypt-what', 'encrypt__what-text', 'text', 'encrypt-what', s('whatText'), true)}
          ${radio('encrypt-what', 'encrypt__what-file', 'file', 'encrypt-what', s('whatFile'), false)}
        </fieldset>
        <div class="field" data-js="encrypt-text-box">
          <label class="field__label" for="encrypt__text">${s('text')}</label>
          <textarea class="textarea" id="encrypt__text" rows="5" dir="auto" autocomplete="off" spellcheck="false" data-js="encrypt-text"></textarea>
          <p class="facts__why" data-js="encrypt-text-size"></p>
        </div>
        <div class="field" data-js="encrypt-file-box" hidden>
          <label class="field__label" for="encrypt__file">${s('file')}</label>
          ${filePicker(ctx, 'encrypt__file', 'encrypt-file', '')}
          <p class="facts__why" data-js="encrypt-file-size">${s('fileHint')}</p>
        </div>
        <fieldset class="field">
          <legend class="field__label">${s('passwordKind')}</legend>
          ${radio('encrypt-password-kind', 'encrypt__kind-made', 'made', 'encrypt-password-kind', s('made'), true)}
          ${radio('encrypt-password-kind', 'encrypt__kind-own', 'own', 'encrypt-password-kind', s('own'), false)}
        </fieldset>
        <div class="tool__result" data-js="encrypt-made">
          <p class="field__label" id="encrypt__passphrase-label">${s('passphrase')}</p>
          <p class="tool__value tool__value--secret" data-js="encrypt-passphrase" aria-labelledby="encrypt__passphrase-label" translate="no" dir="ltr"></p>
          <div class="tool__actions">
            ${copyButton(ctx, 'encrypt-passphrase')}
            <button class="button button--ghost button--small" type="button" data-js="encrypt-another">${icons.refresh}<span>${s('another')}</span></button>
          </div>
          <p class="tool__status" role="status" data-js="encrypt-passphrase-status"></p>
          <p class="facts__why" data-js="encrypt-bits" data-template="${s('bits')}"></p>
        </div>
        <div class="encrypt__own" data-js="encrypt-own" hidden>
          ${passwordField('password', s('password'))}
          <div class="field" data-js="encrypt-repeat-box">
            <label class="field__label" for="encrypt__repeat">${s('repeat')}</label>
            <input class="input" type="password" id="encrypt__repeat" data-js="encrypt-repeat" autocomplete="new-password" autocapitalize="off" autocorrect="off" spellcheck="false" translate="no" dir="ltr">
          </div>
          <ul class="findings" data-js="encrypt-warnings">
            ${ENCRYPT_WARNINGS.map((key) => html`<li data-warning="${key}" hidden>${s(`warnings.${key}`)}</li>`)}
          </ul>
          <p class="facts__why">${s('ownHint')}</p>
          <p class="facts__why">${s('keyboard')}</p>
        </div>
        <p class="tool__note">${s('noRecovery')}</p>
        <div class="tool__actions">
          <button class="button" type="button" data-js="encrypt-lock-button" disabled>${icons.lock}<span>${s('lock')}</span></button>
        </div>
        <div class="tool__result encrypt__result" data-js="encrypt-locked" hidden>
          <p class="encrypt__verified" data-js="encrypt-verified" data-full="${s('verified')}" data-ends="${s('verifiedEnds')}"></p>
          <div class="field" data-js="encrypt-armour-box" hidden>
            <label class="field__label" for="encrypt__armour">${s('armour')}</label>
            <textarea class="textarea encrypt__armour" id="encrypt__armour" rows="6" readonly translate="no" dir="ltr" spellcheck="false" data-js="encrypt-armour"></textarea>
            <div class="tool__actions">
              ${copyButton(ctx, 'encrypt-armour')}
              ${shareButton(ctx, 'encrypt-armour-share')}
            </div>
            <p class="tool__status" role="status" data-js="encrypt-armour-status"></p>
            <p class="facts__why" data-js="encrypt-long" data-template="${s('long')}" hidden></p>
          </div>
          <div data-js="encrypt-lock-save">${saveBox(ctx, s('saveLocked'))}</div>
          <p class="facts__why">${s('nameHint')}</p>
          <section class="encrypt__how" aria-labelledby="encrypt__how">
            <h3 class="file-report__title" id="encrypt__how">${s('howTitle')}</h3>
            <ol class="encrypt__steps">
              ${[1, 2, 3].map((n) => html`<li>${s(`how${n}`)}</li>`)}
            </ol>
            <p class="field__label" id="encrypt__sentence-label">${s('sentenceLabel')}</p>
            <p class="tool__value tool__value--text" data-js="encrypt-sentence" aria-labelledby="encrypt__sentence-label">${s('sentence').replace('{url}', page)}</p>
            <div class="tool__actions">
              ${copyButton(ctx, 'encrypt-sentence')}
            </div>
            <p class="tool__status" role="status" data-js="encrypt-sentence-status"></p>
          </section>
        </div>
      </div>
      <div class="encrypt__mode" data-js="encrypt-open" hidden>
        <div class="field">
          <label class="field__label" for="encrypt__locked-file">${s('lockedFile')}</label>
          ${filePicker(ctx, 'encrypt__locked-file', 'encrypt-locked-file', '.lockwell')}
          <p class="facts__why">${s('lockedFileHint')}</p>
        </div>
        <div class="field">
          <label class="field__label" for="encrypt__locked-text">${s('lockedText')}</label>
          <textarea class="textarea encrypt__armour" id="encrypt__locked-text" rows="4" translate="no" dir="ltr" autocomplete="off" autocapitalize="off" spellcheck="false" data-js="encrypt-locked-text"></textarea>
          <div class="tool__actions">
            <button class="button button--ghost button--small" type="button" data-js="encrypt-example" data-password="${ENCRYPT_EXAMPLE_PASSWORD}" data-text="${s('exampleText')}">${icons.eye}<span>${t('tools.example')}</span></button>
          </div>
        </div>
        ${passwordField('open-password', s('password'))}
        <div class="tool__actions">
          <button class="button" type="button" data-js="encrypt-open-button" disabled>${icons.lock}<span>${s('open')}</span></button>
        </div>
        <div class="tool__result encrypt__result" data-js="encrypt-opened" hidden>
          <h3 class="file-report__title">${s('inside')}</h3>
          <dl class="facts">
            <div class="facts__row"><dt>${s('kind')}</dt><dd data-js="encrypt-kind" data-text="${s('kinds.text')}" data-file="${s('kinds.file')}" data-files="${s('kinds.files')}"></dd></div>
            <div class="facts__row" data-js="encrypt-name-row"><dt>${s('name')}</dt><dd data-js="encrypt-name" translate="no" dir="ltr"></dd></div>
            <div class="facts__row"><dt>${s('size')}</dt><dd data-js="encrypt-size"></dd></div>
          </dl>
          <div class="field" data-js="encrypt-plain-box" hidden>
            <label class="field__label" for="encrypt__plain">${s('plain')}</label>
            <textarea class="textarea" id="encrypt__plain" rows="6" readonly dir="auto" spellcheck="false" data-js="encrypt-plain"></textarea>
            <div class="tool__actions">
              ${copyButton(ctx, 'encrypt-plain')}
            </div>
            <p class="tool__status" role="status" data-js="encrypt-plain-status"></p>
          </div>
          <div data-js="encrypt-open-save">${saveBox(ctx, s('saveOpened'))}</div>
        </div>
      </div>
      <p class="tool__message" role="status" data-js="encrypt-message"${ENCRYPT_MESSAGES.map((key) => html` data-${kebab(key)}="${s(`messages.${key}`)}"`)}></p>
      <div class="tool__actions">
        <button class="button button--ghost button--small" type="button" data-js="encrypt-reset">${icons.trash}<span>${s('reset')}</span></button>
      </div>
    </div>`;
}

/** Content some tools show above their controls, readable without JavaScript. */
export const INTROS = /** @type {Partial<Record<import('../tools.mjs').Tool['key'], (ctx: Ctx) => SafeHtml>>} */ ({ email: emailHowto });

/** @type {Record<import('../tools.mjs').Tool['key'], (ctx: Ctx) => SafeHtml>} */
export const PANELS = {
  password: passwordPanel,
  links: linksPanel,
  check: checkPanel,
  redact: redactPanel,
  editor: editorPanel,
  document: documentPanel,
  hidden: hiddenPanel,
  photo: photoPanel,
  video: videoPanel,
  attachment: attachmentPanel,
  email: emailPanel,
  encrypt: encryptPanel,
  browser: browserPanel,
};

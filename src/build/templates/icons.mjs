// @ts-check
/**
 * @file Inline SVG icons used by the templates.
 */
import { raw } from '../html.mjs';

/** Inline SVG icons (24×24, stroke-based, inherit currentColor). Decorative: hidden from screen readers. */

/** @param {string} body */
const icon = (body) =>
  raw(`<svg class="icon" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${body}</svg>`);

/**
 * A filled 16×16 mark (brand logos are solid shapes, not strokes); sized like the others by `.icon`.
 * @param {string} path
 */
const filledIcon = (path) =>
  raw(`<svg class="icon" viewBox="0 0 16 16" width="20" height="20" fill="currentColor" aria-hidden="true" focusable="false"><path d="${path}"/></svg>`);

export const icons = {
  // GitHub mark from GitHub's Octicons (mark-github, MIT license).
  github: filledIcon('M8 0c4.42 0 8 3.58 8 8a8.013 8.013 0 0 1-5.45 7.59c-.4.08-.55-.17-.55-.38 0-.27.01-1.13.01-2.2 0-.75-.25-1.23-.54-1.48 1.78-.2 3.65-.88 3.65-3.95 0-.88-.31-1.59-.82-2.15.08-.2.36-1.02-.08-2.12 0 0-.67-.22-2.2.82-.64-.18-1.32-.27-2-.27-.68 0-1.36.09-2 .27-1.53-1.03-2.2-.82-2.2-.82-.44 1.1-.16 1.92-.08 2.12-.51.56-.82 1.28-.82 2.15 0 3.06 1.86 3.75 3.64 3.95-.23.2-.44.55-.51 1.07-.46.21-1.61.55-2.33-.66-.15-.24-.6-.83-1.23-.82-.67.01-.27.38.01.53.34.19.73.9.82 1.13.16.45.68 1.31 2.69.94 0 .67.01 1.3.01 1.49 0 .21-.15.45-.55.38A7.995 7.995 0 0 1 0 8c0-4.42 3.58-8 8-8Z'),
  clock:icon('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>'),
  list: icon('<path d="M9 6h11M9 12h11M9 18h11"/><path d="m3.5 6 1 1 2-2M3.5 12l1 1 2-2M3.5 18l1 1 2-2"/>'),
  calendar: icon('<rect x="3.5" y="5" width="17" height="15" rx="2"/><path d="M3.5 10h17M8 3v4M16 3v4"/>'),
  arrowRight: icon('<path d="M5 12h14M13 6l6 6-6 6"/>'),
  arrowLeft: icon('<path d="M19 12H5M11 6l-6 6 6 6"/>'),
  arrowUp: icon('<path d="M12 19V5M6 11l6-6 6 6"/>'),
  arrowDown: icon('<path d="M12 5v14M6 13l6 6 6-6"/>'),
  wider: icon('<path d="M3 12h18M7 8l-4 4 4 4M17 8l4 4-4 4"/>'),
  narrower: icon('<path d="M3 12h6M15 12h6M6 9l3 3-3 3M18 9l-3 3 3 3"/>'),
  taller: icon('<path d="M12 3v18M8 7l4-4 4 4M8 17l4 4 4-4"/>'),
  shorter: icon('<path d="M12 3v6M12 15v6M9 6l3 3 3-3M9 18l3-3 3 3"/>'),
  sun: icon('<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M4.6 4.6l1.4 1.4M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4 6 18M18 6l1.4-1.4"/>'),
  moon: icon('<path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5Z"/>'),
  eyeOff: icon('<path d="M3 3l18 18"/><path d="M10.6 5.1A10 10 0 0 1 12 5c5.5 0 9 5.5 9 7a11 11 0 0 1-2.4 3.4M6.5 6.6C4.3 8 3 10.6 3 12c0 1.5 3.5 7 9 7a9.7 9.7 0 0 0 4.5-1.1"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/>'),
  code: icon('<path d="m8 8-4 4 4 4M16 8l4 4-4 4M14 5l-4 14"/>'),
  device: icon('<rect x="6" y="2.5" width="12" height="19" rx="2.5"/><path d="M10.5 18.5h3"/>'),
  alert: icon('<path d="M12 3.5 2.5 20h19L12 3.5Z"/><path d="M12 10v4.5M12 17.5v.01"/>'),
  printer: icon('<path d="M7 9V3.5h10V9"/><rect x="3.5" y="9" width="17" height="8" rx="2"/><path d="M7 14h10v6.5H7z"/>'),
  search: icon('<circle cx="11" cy="11" r="6.5"/><path d="m16 16 4.5 4.5"/>'),
  key: icon('<circle cx="8" cy="15" r="4.5"/><path d="m11.2 11.8 8.3-8.3M16 7l3 3M13.5 9.5l2 2"/>'),
  link: icon('<path d="M10 14a4.5 4.5 0 0 0 6.4 0l3-3a4.5 4.5 0 0 0-6.4-6.4l-1 1"/><path d="M14 10a4.5 4.5 0 0 0-6.4 0l-3 3a4.5 4.5 0 0 0 6.4 6.4l1-1"/>'),
  image: icon('<rect x="3.5" y="4.5" width="17" height="15" rx="2"/><circle cx="9" cy="10" r="1.5"/><path d="m4 17 5-4.5 3.5 3 3-2.5 5 4"/>'),
  monitor: icon('<rect x="3" y="4.5" width="18" height="12" rx="2"/><path d="M9 20h6M12 16.5V20"/>'),
  copy: icon('<rect x="8.5" y="8.5" width="11" height="11" rx="2"/><path d="M15.5 8.5v-2a2 2 0 0 0-2-2h-7a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h2"/>'),
  refresh: icon('<path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3"/><path d="M19.5 4.5v4.5H15"/>'),
  download: icon('<path d="M12 4v11M7.5 10.5 12 15l4.5-4.5M5 19.5h14"/>'),
  share: icon('<path d="M12 14.5V3.5M8 7.5l4-4 4 4"/><path d="M8 10.5H6a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-8a1 1 0 0 0-1-1h-2"/>'),
  shield: icon('<path d="M12 3 4.5 6v5.5c0 4.5 3 8 7.5 9.5 4.5-1.5 7.5-5 7.5-9.5V6L12 3Z"/><path d="m9 12 2 2 4-4"/>'),
  marker: icon('<rect x="3.5" y="4.5" width="17" height="15" rx="2"/><rect x="7" y="9" width="10" height="5" rx="1" fill="currentColor"/>'),
  file: icon('<path d="M6.5 3.5h7.5l4 4V20a.5.5 0 0 1-.5.5h-11A.5.5 0 0 1 6 20V4a.5.5 0 0 1 .5-.5Z"/><path d="M14 3.5V8h4M9 12.5h6M9 16h6"/>'),
  eye: icon('<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z"/><circle cx="12" cy="12" r="3"/>'),
  undo: icon('<path d="M8 8H4V4"/><path d="M4.5 8a8 8 0 1 1-1 6"/>'),
  trash: icon('<path d="M4.5 7h15M9.5 7V4.5h5V7M6.5 7l1 12.5h9l1-12.5"/>'),
  check: icon('<path d="m5 12.5 4.5 4.5L19 7.5"/>'),
  plus: icon('<path d="M12 5v14M5 12h14"/>'),
  minus: icon('<path d="M5 12h14"/>'),
  redo: icon('<path d="M16 8h4V4"/><path d="M19.5 8a8 8 0 1 0 1 6"/>'),
  square: icon('<rect x="4.5" y="5.5" width="15" height="13" rx="1.5"/>'),
  circle: icon('<ellipse cx="12" cy="12" rx="8.5" ry="7"/>'),
  pen: icon('<path d="m4 20 1-4.5L16.5 4a2.1 2.1 0 0 1 3 3L8 18.5 4 20Z"/><path d="m14.5 6 3 3"/>'),
  crop: icon('<path d="M7 3v14h14"/><path d="M3 7h14v14"/>'),
  edit: icon('<path d="M4 20h4L19 9l-4-4L4 16v4Z"/><path d="m13.5 6.5 4 4"/>'),

  // Guide subjects (the `icon:` front matter key; names listed in GUIDE_ICONS, frontmatter.mjs).
  phoneLock: icon('<rect x="6" y="2.5" width="12" height="19" rx="2.5"/><rect x="9.5" y="11" width="5" height="4" rx="1"/><path d="M10.5 11V9.5a1.5 1.5 0 0 1 3 0V11"/>'),
  phoneShield: icon('<rect x="6" y="2.5" width="12" height="19" rx="2.5"/><path d="M12 8 9.5 9v2.3c0 1.7 1 3 2.5 3.7 1.5-.7 2.5-2 2.5-3.7V9L12 8Z"/>'),
  phoneAlert: icon('<rect x="6" y="2.5" width="12" height="19" rx="2.5"/><path d="M12 7.5v5M12 15.5v.01"/>'),
  chat: icon('<path d="M4 5h16a1 1 0 0 1 1 1v9.5a1 1 0 0 1-1 1h-9.5L6 20v-3.5H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Z"/><path d="M8 11h.01M12 11h.01M16 11h.01"/>'),
  chatLock: icon('<path d="M4 5h16a1 1 0 0 1 1 1v9.5a1 1 0 0 1-1 1h-9.5L6 20v-3.5H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Z"/><rect x="9.5" y="10" width="5" height="3.5" rx="0.75"/><path d="M10.5 10V9a1.5 1.5 0 0 1 3 0v1"/>'),
  hook: icon('<circle cx="15.5" cy="4" r="1.5"/><path d="M15.5 5.5V14a5 5 0 0 1-10 0v-3.5l3 3"/>'),
  at: icon('<circle cx="12" cy="12" r="3.5"/><path d="M15.5 12v1.5a2.5 2.5 0 0 0 5 0V12a8.5 8.5 0 1 0-3.3 6.7"/>'),
  globe: icon('<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.4 2.5 3.6 5.5 3.6 9s-1.2 6.5-3.6 9c-2.4-2.5-3.6-5.5-3.6-9S9.6 5.5 12 3Z"/>'),
  pin: icon('<path d="M12 21s-6.5-6-6.5-11a6.5 6.5 0 0 1 13 0c0 5-6.5 11-6.5 11Z"/><circle cx="12" cy="10" r="2.5"/>'),
  sparkle: icon('<path d="M11 3.5c.6 4 2.5 5.9 6.5 6.5-4 .6-5.9 2.5-6.5 6.5-.6-4-2.5-5.9-6.5-6.5 4-.6 5.9-2.5 6.5-6.5Z"/><path d="M18.5 15.5v5M16 18h5"/>'),
  laptop: icon('<rect x="4.5" y="5" width="15" height="10.5" rx="1.5"/><path d="M2.5 19h19"/>'),
  cloud: icon('<path d="M7 18.5a4.5 4.5 0 0 1-.5-9 6 6 0 0 1 11.5 1.5 3.8 3.8 0 0 1-.5 7.5"/><path d="M12 20v-7.5M9 15.5l3-3 3 3"/>'),
  wifi: icon('<path d="M2.5 9a14 14 0 0 1 19 0M5.5 12.5a9.5 9.5 0 0 1 13 0M8.5 16a5 5 0 0 1 7 0"/><path d="M12 19.5v.01"/>'),
  lifebuoy: icon('<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="3.5"/><path d="m5.6 5.6 3.9 3.9M14.5 14.5l3.9 3.9M18.4 5.6l-3.9 3.9M9.5 14.5l-3.9 3.9"/>'),
  map: icon('<path d="M9 4 3.5 6v14L9 18l6 2 5.5-2V4L15 6 9 4Z"/><path d="M9 4v14M15 6v14"/>'),
  userLock: icon('<circle cx="10" cy="7.5" r="3.5"/><path d="M3.5 20a6.5 6.5 0 0 1 9-6"/><rect x="14.5" y="15" width="6" height="5" rx="1"/><path d="M15.75 15v-1.5a1.75 1.75 0 0 1 3.5 0V15"/>'),
  mail: icon('<rect x="3" y="5.5" width="18" height="13" rx="2"/><path d="m3.5 7 8.5 6 8.5-6"/>'),
  megaphone: icon('<path d="M3.5 10v4h3l9 5V5l-9 5h-3Z"/><path d="m6.5 14 1.5 5.5h2.5L9 15.5M19 9a4 4 0 0 1 0 6"/>'),
  suitcase: icon('<rect x="3.5" y="7.5" width="17" height="12" rx="2"/><path d="M9 7.5V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2.5M3.5 12.5h17"/>'),
  bug: icon('<rect x="7.5" y="7.5" width="9" height="12" rx="4.5"/><path d="M9.5 7.5a2.5 2.5 0 0 1 5 0M12 11v8.5M3.5 13h4M16.5 13h4M4.5 8.5l3 2M19.5 8.5l-3 2M4.5 19l3-2M19.5 19l-3-2"/>'),
  idCard: icon('<rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="8.5" cy="10.5" r="2"/><path d="M5.5 16a3 3 0 0 1 6 0M14 10h4M14 13.5h4"/>'),
  incognito: icon('<path d="M3 11h18M5.5 11 7 5.5h10l1.5 5.5"/><circle cx="7.5" cy="16" r="2.5"/><circle cx="16.5" cy="16" r="2.5"/><path d="M10 16h4"/>'),
  folderLock: icon('<path d="M3.5 6.5a1 1 0 0 1 1-1h4.5l2 2h8.5a1 1 0 0 1 1 1V18a1 1 0 0 1-1 1h-15a1 1 0 0 1-1-1V6.5Z"/><rect x="9.5" y="12.5" width="5" height="3.5" rx="0.75"/><path d="M10.5 12.5v-1a1.5 1.5 0 0 1 3 0v1"/>'),
  // Article subjects (the `icon:` front matter key; names listed in ARTICLE_ICONS, frontmatter.mjs).
  lock: icon('<rect x="5" y="10.5" width="14" height="10" rx="2"/><path d="M8.5 10.5v-3a3.5 3.5 0 0 1 7 0v3M12 14.5v2"/>'),
  robot: icon('<rect x="4.5" y="8" width="15" height="11" rx="2.5"/><circle cx="12" cy="3.5" r="1"/><path d="M12 4.5V8M9 12.5V14M15 12.5V14M2.5 12v3M21.5 12v3"/>'),
  logIn: icon('<path d="M14 4h4.5A1.5 1.5 0 0 1 20 5.5v13a1.5 1.5 0 0 1-1.5 1.5H14"/><path d="M4 12h11M11 8l4 4-4 4"/>'),
  users: icon('<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><path d="M16 4.6a3.5 3.5 0 0 1 0 6.8M18.5 14.3a6.5 6.5 0 0 1 3 5.7"/>'),
};

/**
 * The Lockwell padlock mark. Colors come from CSS classes (.logo__bg / .logo__fg
 * in 05-components.css), so it follows the theme without var() in SVG attributes.
 */
export const logo = raw(
  '<svg class="logo" viewBox="0 0 32 32" width="32" height="32" aria-hidden="true" focusable="false">' +
    '<rect class="logo__bg" width="32" height="32" rx="9"/>' +
    '<path class="logo__shackle" d="M11.5 14.5v-3.2a4.5 4.5 0 0 1 9 0v3.2" fill="none" stroke-width="2.4" stroke-linecap="round"/>' +
    '<rect class="logo__fg" x="8.5" y="14" width="15" height="11.5" rx="3"/>' +
    '<circle class="logo__bg" cx="16" cy="19" r="1.7"/>' +
    '<path class="logo__keyhole" d="M16 19.8v2.4" stroke-width="1.8" stroke-linecap="round"/>' +
    '</svg>',
);

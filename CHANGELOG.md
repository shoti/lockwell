# Changelog

Notable changes to the site's content and behaviour. Each guide also shows the
date its sources were last checked.

## Unreleased: photo editor (November 2026)

### Tools
- New photo editor (`/tools/image-editor/`, after Image redaction): crop with
  free or fixed proportions, straighten, turn, mirror and resize; eleven
  colour and sharpness sliders and seven filters; text and drawings (pen,
  highlighter, line, arrow, rectangle, ellipse) that can be moved, resized
  and turned by pointer or keyboard; saves as JPEG, PNG or WebP (WebP only
  where the browser can write it). The saved copy is drawn fresh from the
  photo's pixels, so it has none of the original's hidden data; the preview
  shows the saved file itself. It has no tool for blurring part of a
  picture and points to Image redaction for hiding things.
- Shared code for the image tools (box geometry, undo history, canvas
  helpers, zoom) moved out of the image redaction tool; that tool is
  unchanged.

## Unreleased: pre-launch audit (November 2026)

### Content
- Re-checked the high-risk guides, the three articles and every emergency
  contact against primary sources read on 15 November 2026; corrected
  overstated, outdated or unsourced claims in both languages and linked the
  sources next to them.
- Guides where a step can carry legal risk now show a fixed "not legal advice"
  notice.
- The date on each guide is now labelled "Sources checked" and shows when its
  sources were actually read (it had been moved to 14 November without a
  re-check).
- Session-only progress no longer promises it is always gone when the tab
  closes: a browser that reopens closed tabs may restore it.

### Site
- New privacy page (every value saved in the browser, the one request the IP
  button makes, how to delete data) and terms of use, linked from the footer,
  the tools and search.
- `/.well-known/security.txt`; private vulnerability reporting linked from the
  issue chooser.
- HTTP Strict Transport Security and Cross-Origin-Resource-Policy headers.
- Screen readers hear "For everyone (12 guides)" instead of "For everyone12".
- `npm run audit` (links, structure, unicode, parity, claims, headless privacy
  run); CI runs all but the headless run; weekly link and claims check;
  `data/claims.json`.

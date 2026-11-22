# Changelog

Notable changes to the site's content and behaviour. Each guide also shows the
date its sources were last checked.

## Unreleased: file encryption (November 2026)

### Tools
- New file and text encryption tool (`/tools/file-encryption/`, in "Before you
  share" after Document metadata). It locks a text, a file or several files
  (put in one ZIP archive) with a password in the browser and opens what it
  locked. The default password is six random words; a typed one gets
  warnings, never a "strong" label. Every result is opened again and compared
  with the input before it is offered. Locked text survives chats and mail;
  large files go straight to a file chosen in the save dialog where the
  browser has one (no limit of ours), and up to 1 GB elsewhere. Names of
  opened files are checked like the attachment checker's. Only the browser's
  own Web Crypto is used (PBKDF2-HMAC-SHA-256, HKDF, AES-256-GCM in 64 KiB
  chunks); nothing is uploaded.
- The format is public: `docs/ENCRYPTED-FORMAT.md`, with a test vector, and
  `scripts/lockbox-open.mjs`, a reference decryptor for Node 22.
- Saving: an exact-name mode and a "neutral name by default" option in the
  shared save box.

## Unreleased: email header analyzer (November 2026)

### Tools
- New email header analyzer (`/tools/email-headers/`, in "Check something
  suspicious" after the attachment checker). Paste a message's headers or the
  whole message, or drop an `.eml` or Outlook `.msg` file. It shows who the
  message says it is from, what the receiving provider's SPF, DKIM, DMARC, ARC
  and Microsoft composite checks found, the spam filter's verdict, the route
  the message took, and plain-language findings (spoofed sender, reply going
  elsewhere, lookalike domains, risky attachment names, forwarded or mailing
  list mail). Results written by servers the receiving provider doesn't run
  are shown as claims, not checks. With a whole message it also lists the
  links and attachment names. A short guide on the page, which works without
  JavaScript, shows where seven mail apps and sites show the full headers.
  Nothing is uploaded and no lookups are made.
- The attachment checker's file-name checks moved into a shared module so the
  email tool can use them; that tool is unchanged.

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

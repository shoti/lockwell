# Content guide

How to write and format Lockwell guides and articles. The build checks most of
these rules and stops with a file name and line number when something is wrong.

There are two kinds of content:

- **Guides** are checklists: things to do, each with a tick box, a priority
  and step-by-step instructions per device or app.
- **Articles** are for reading: they explain how something works or why it
  matters, and link to the guides for the steps.

## Where content lives

```
content/
  site.json            site URL, repository URL, languages
  i18n/ka.json         interface text (buttons, labels) — Georgian
  i18n/en.json         interface text — English (same keys as ka.json)
  ka/guides/*.md       Georgian guides
  en/guides/*.md       English guides (same file names)
  ka/articles/*.md     Georgian articles
  en/articles/*.md     English articles (same file names)
  ka/figures/*.svg     Georgian figures (drawings that explain a step)
  en/figures/*.svg     English figures (same file names)
  ka/pages/*.md        home.md, about.md, …
  en/pages/*.md
```

The file name is the URL: `content/ka/guides/messaging.md` becomes
`/guides/messaging/`, and the English version becomes `/en/guides/messaging/`.
Articles work the same way under `/articles/`.
Use lowercase letters, digits and dashes only.

## Guide front matter

```md
---
title: Make your messaging apps private
description: One or two sentences for search results (about 150 characters).
summary: One line shown under the title and on guide cards.
audience: everyone
group: start
order: 2
time: 30
reviewed: 2026-11-09
status: draft
---
```

| Key | Meaning |
|---|---|
| `title` | Page heading and browser title. Write it as an action. |
| `description` | Shown by Google. Say what the reader will be able to do. |
| `summary` | Short lead under the title. |
| `audience` | The track the guide belongs to: `everyone` (ordinary people who want sensible protection) or `high-risk` (activists, journalists, anyone with a reason to expect targeted attention). Required, the same in both languages. See "The two tracks" below. |
| `group` | The topic group inside the track, the same in both languages. For `everyone`: `start`, `habits`, `devices`, `recovery`. For `high-risk`: `plan`, `basics`, `situations`, `threats`, `teams`. The guides list and its sidebar show guides under these headings. |
| `order` | Reading order within its track (1 = first): the lists, "Next guide" and "Continue" follow it. Each guide in a track needs its own number, the same in both languages, and the numbers must run group by group (all of `start`, then all of `habits`, and so on). |
| `time` | Rough minutes to finish everything. |
| `reviewed` | Date someone last checked every step on a real device. |
| `status` | `draft` shows a warning and hides the page from search engines. Remove it (or set `published`) once a native speaker and a second person have reviewed the guide. |
| `progress` | Optional. `session` forgets checklist progress when the tab is closed. Use it for sensitive topics (protests, journalism, leaving an abusive relationship), so a shared or seized phone doesn't reveal what was read. Required for `audience: high-risk`. Must match in both languages. Default: `local` (kept until cleared). |

The build warns when `reviewed` is more than a year old.

### The two tracks

The guides index lists two sections: "For everyone" first, then "For people
at higher risk". The home page shows the first track and links to the second.

A `high-risk` guide:

- must set `progress: session` (the build fails otherwise);
- gets a fixed notice under its title, saying that no checklist makes anyone
  fully safe and pointing to the threat-modelling guide
  (`guides/threat-modelling.md`). Don't repeat that notice in the text;
- must say, for every step, what the step does **not** protect against, and
  send readers to expert help instead of improvising where a mistake could
  put them in danger.

## Guide body

```md
Intro paragraph: why this matters, in two or three sentences.

## Protect your account with a PIN {#account-pin .essential}

What to do and why it matters.

### WhatsApp

1. Open **Settings → Account → Two-step verification**.
2. …

### iPhone {.ios}

1. …

> [!warning]
> Never share the code an app sends you by SMS.
```

- **`##` = one checklist item.** It needs:
  - a **stable id** `{#account-pin}`. People's saved progress is stored by this
    id, so **never change or reuse an id after publishing**. Both languages
    must use the same ids in the same order.
  - a **priority**: `.essential`, `.recommended` or `.advanced`.
  - Ids use lowercase letters, digits and dashes, must be unique on the page,
    and can't be `main` (used by the layout).
- **`###` = one tab** of step-by-step instructions (a device or an app).
  Optional keys `{.ios}`, `{.android}`, `{.desktop}` link tabs across items:
  choosing "Android" once switches every item to Android, and the visitor's
  device is pre-selected. Leave the key off for app tabs (WhatsApp, Google…).
  Any other key fails the build.
- **Callouts:** `> [!note]`, `> [!tip]`, `> [!warning]`.

## Articles

```md
---
title: What end-to-end encryption means, and what it doesn't
description: One or two sentences for search results (about 150 characters).
summary: One line shown under the title and on article cards.
published: 2026-11-11
status: draft
---

Opening paragraph: the question this article answers.

## A section {#optional-id}

Text, lists and callouts. Link to the guide that has the steps:
[messaging guide](/guides/messaging/).
```

| Key | Meaning |
|---|---|
| `title`, `description`, `summary` | As for guides. |
| `published` | Date the article first went live. Articles are listed newest first. |
| `updated` | Optional. Date of the last change in substance (not typo fixes). Shown next to the published date. |
| `status` | `draft`, as for guides. |

- The reading time is worked out from the text; don't write it.
- Use `##` for sections and `###` below them. Add `{#id}` to a heading only
  if something links to it. Don't add priorities or platform keys: those are
  for guides.
- The articles section (header link, home page block, `/articles/`) appears
  in a language once that language has at least one article. An article
  without a translation is fine; the build prints a reminder.
- Put instructions in a guide, not in an article. An article explains and
  then links to the steps.

## What the site does with your content

- **Search** (`/search/`) lists every guide, checklist step and article, and
  searches their text: each step's main text, and from platform tabs the tab
  name and the **bold** menu and setting names. Put menu names in bold so they
  can be found. Nothing else to do when you add content.
- **The feed** (`/feed.xml`, `/en/feed.xml`) lists guides and articles that
  are not drafts, newest first. It appears once a language has something
  published. A guide moves to the top when its `reviewed` date changes, an
  article when `updated` changes.
- **"Essential only"** on a guide is offered when the guide mixes essential
  and other steps, so give every step an honest priority.

## Supported Markdown

`**bold**`, `*italic*`, `` `code` ``, `[link](https://…)`, lists (`-` and
`1.`, one level only), headings `##`–`####`, callouts and figures (below). No
raw HTML, other images, tables or code blocks; the build rejects them.

- **Numbered lists count 1, 2, 3…** with no gaps. A list can't continue after
  a callout or paragraph; put the callout below the list instead.
- **Continuing a list item** on the next line needs two spaces of indent.
- **Phone codes and other asterisks:** write codes in backticks
  (`` `*#21#` ``) and a literal asterisk as `\*`. `*italic*` must start with a
  letter. A stray `*` fails the build, so a code can never turn into italics.

**Links**
- External: full `https://` URL. They open with `rel="noreferrer"`, so the
  other site isn't told where the visitor came from.
- Internal: write the path without the language, ending in `/`:
  `[messaging guide](/guides/messaging/)`. It automatically points to the
  same language. Broken internal links fail the build.
- Anchors: `[step](/guides/messaging/#account-pin)` or `[step](#account-pin)`
  link to an item or heading id. Anchors that don't exist fail the build.

## Figures

A figure is a drawing that makes a hard idea easier to see: what a VPN hides,
how an account is taken over, why a black box isn't redaction. Add one only
where the text alone is hard to follow. Put it on a line of its own:

```md
![The caption shown under the figure](figure:link-anatomy)
```

- The drawing is `content/<lang>/figures/link-anatomy.svg`, one file per
  language with the same name. Both languages place the same figures in the
  same checklist items; the build checks this.
- The caption is one sentence: the takeaway, not a description of the picture.
  It may use **bold**, *italic* and links.
- A figure may appear once per page, not inside a callout or a list.
- **Restate the guide, add nothing.** Every statement in a figure must already
  be in the text around it, so its facts come from the same sources.
- Figures are drawn into the page as inline SVG: they use the site's font,
  follow the light and dark themes and print with the guide. Search doesn't
  index them.

**Drawing rules** (the build rejects anything else, with the line number):

- One `<svg viewBox="0 0 340 H">` with `<title>` first (the name a screen
  reader reads out) and an optional `<desc>` next (a full text version of what
  the figure shows; write one, since the drawing's own text isn't read out).
- Elements: `g`, `rect`, `circle`, `ellipse`, `line`, `polyline`, `polygon`,
  `path`, `text`, `tspan`. No scripts, links, images, `style`, `id`, `fill` or
  other presentation attributes, and no external references.
- Colours and type come only from classes (`box`, `box-good`, `box-bad`,
  `line-warn`, `fill-muted`, `t-sm`, `t-b`, `t-good`…; the full list is
  `FIGURE_CLASSES` in `src/build/figures.mjs`). *Good* is teal, *bad* red,
  *warn* amber, *info* blue, as on the rest of the site.
- Draw 340 units wide. Text is 15 (default), 13 (`t-sm`) or 17 (`t-lg`), so
  the smallest text is about 12px on a phone. Wrap long lines yourself:
  Georgian lines are longer than English ones, so lay out each language
  separately.
- Text may only use characters in the site's font (Latin, Georgian, common
  punctuation, arrows and ✓); the build names any character that is missing.

## Writing style

- **Plain language.** Write for someone who has never changed a privacy
  setting. One idea per sentence. Explain any technical word the first time.
- **Action first.** Start steps with a verb: "Open…", "Turn on…".
- **Why, briefly.** Every item explains the risk in one or two sentences,
  without scaring people.
- **Georgian:** use the formal **თქვენ** form. Keep app menu names in
  English in **bold** (most phones in Georgia show them in English), and add
  Georgian case endings after them with a hyphen: `**Log out**-ს`.
- **Never use all caps** for Georgian text, and never add
  `text-transform: uppercase` in CSS: it turns Georgian into Mtavruli capitals,
  which are hard to read.
- **Be honest about limits.** If a step reduces risk but doesn't remove it,
  say so.
- **Check on a real device** before updating `reviewed`. Menus change often;
  if a path differs between phone models, say so.

## Before you open a pull request

```sh
npm run check   # tests + build; fix anything it reports
npm run dev     # preview at http://localhost:4000
```

# Contributing to Lockwell

Thank you for helping! You can contribute without writing any code.

## Ways to help

- **Fix or update a guide.** Menus in apps change often. Open an issue with
  the "Content correction" template, or edit the Markdown file directly.
- **Translate or review Georgian text.** Native-speaker review is the most
  valuable contribution right now.
- **Suggest a new guide or article** with the "New guide idea" template.
- **Improve the site** (design, accessibility, performance, build).

For content, read [docs/CONTENT-GUIDE.md](docs/CONTENT-GUIDE.md) first.

## Run it locally

Requires [Node.js](https://nodejs.org) 22 or newer. There is nothing to
install: the project has **no dependencies**.

```sh
npm run dev     # build, serve at http://localhost:4000, rebuild on changes
npm test        # unit and build tests
npm run check   # tests + production build; run this before a pull request
```

The dev server only accepts connections from your own computer. To preview on
a phone on the same Wi-Fi, run `HOST=0.0.0.0 npm run dev` (anyone on that
network can then open it).

Type checking runs in CI. To run it locally without adding dependencies:

```sh
npm install --no-save --ignore-scripts typescript@7.0.2 @types/node@22.20.5 && npx tsc -p jsconfig.json
```

## Project principles

These are deliberate. Please keep them in pull requests.

1. **No dependencies.** The build and dev server use only Node's built-in
   modules; the site uses plain HTML, CSS and JavaScript. Proposing a
   dependency needs an issue and a strong reason first.
2. **No third-party requests.** No CDNs, analytics, external fonts or embeds.
   Everything is served from our own domain. The tests enforce this.
3. **Works without JavaScript.** Pages are complete static HTML. JS only adds
   saved progress, tabs and the theme toggle. The one exception is the tools
   under `/tools/`: they can't work without it, so their pages say so and
   still explain the tool.
4. **Accessible.** WCAG 2.2 AA: real form controls, visible focus, keyboard
   support, sufficient contrast in both themes.
5. **Both languages.** Georgian is the default. Every change to content or UI
   text should exist in `ka` and `en`.

## Code conventions

- **JavaScript:** ES modules, `// @ts-check` with JSDoc types on every file
  (your editor shows type errors; CI runs `tsc`). Small single-purpose
  functions. No classes where a function will do.
- **HTML from code:** always use the `html` tagged template from
  `src/build/html.mjs`. It escapes everything. Never build HTML by string
  concatenation. The Markdown renderers return trusted `SafeHtml`; `raw()` is
  only for the project's own constants (icons, CSP, head script).
- **Client JS:** find elements with `data-js="…"` attributes, never with
  styling classes. Every feature must do nothing when its elements are
  missing. Use the helpers in `storage.mjs` for all browser storage.
- **No layout jumps:** never reveal UI from JS with `hidden`. Give JS-only
  elements the `js-only` class (CSS shows them from the first paint when JS is
  on) and reserve space for anything JS fills in.
- **CSS:** use the tokens in `src/styles/02-tokens.css`, never raw colors or
  sizes. Put rules in the right cascade layer. Mobile-first. Logical
  properties (`margin-inline`, `padding-block`…).
- **Errors:** messages say what failed, where (file and line) and how to fix it.
- **No inline scripts or styles.** The Content-Security-Policy blocks them.
  The one exception, the head script in `src/build/assets.mjs`, is allowed by its hash.
- **File headers:** none needed. Licenses are declared for the whole
  repository in `REUSE.toml`, and Git records who wrote what, so don't add
  copyright, license or author lines to files. A code file may start with a
  one-line `@file` comment saying what it does.

## Project layout

```
content/          guides, articles, pages and UI text (see docs/CONTENT-GUIDE.md)
src/build/        static site generator (Node, no dependencies)
  build.mjs         entry point: content → dist/ (built in a temp folder, swapped in on success)
  routes.mjs        which pages exist and how each is rendered
  assets.mjs        CSS, JS, fonts, CSP, head script, _headers
  content.mjs       loads and validates content/
  markdown.mjs      Markdown subset parser
  figures.mjs       loads, validates and renders figures (an SVG subset)
  links.mjs         link validation and broken-link check
  search.mjs        what the search page lists (guides, steps, articles, tools)
  tools.mjs         the list of tools under /tools/
  feed.mjs          Atom feed of published guides and articles
  dev.mjs           local server with rebuild on change
  templates/        page templates
src/client/       browser JavaScript (ES modules); tool-*.mjs load only on their tool's page
src/styles/       CSS, concatenated in file-name order
src/public/       files copied as-is (fonts, icons, social images)
scripts/          one-off maintenance scripts (font subsetting)
tests/            node:test tests
```

## Pull requests

- Keep each pull request focused on one thing.
- Run `npm run check`.
- For content: say which device and app versions you checked.
- Never change an existing checklist item id. Saved progress depends on it.

## License of your contributions

You keep the copyright on what you write. By opening a pull request you agree
to license it under the same terms as the rest of the project: code under the
[MIT License](LICENSE), and guides, pages, UI text and images under
[CC BY-SA 4.0](LICENSE-CONTENT.md). There is nothing to sign.

<!--
SPDX-FileCopyrightText: 2026 Shota Mtvarelishvili <mtvarelishvili@proton.me>
SPDX-License-Identifier: MIT
-->

# Lockwell

**Practical online privacy guides for people in Georgia, in Georgian and English.**

Short, step-by-step checklists that help you protect your accounts, phone and
conversations. No tracking, no ads, no cookies.

Website: [lockwell.org](https://lockwell.org/)

> [!NOTE]
> There are 25 guides in two tracks: 12 for everyone and 13 for people at
> higher risk, such as journalists, activists and human rights defenders. They
> are written from vendor and expert sources and fact-checked, but have not yet
> been tested on real devices or reviewed by a native Georgian speaker.
> Corrections are welcome.

## Features

- **Checklists by topic.** Each step has a priority (essential, recommended,
  advanced) and instructions per device or app.
- **Articles** that explain in plain language why the steps matter.
- **In-browser tools**: password and PIN generator, link checker and cleaner,
  photo and document metadata viewer and remover, image redaction, hidden
  character detector, and a "what your browser reveals" check. Nothing is
  uploaded.
- **Private by design.** Progress is saved only in your browser, search runs
  on the page, and there are no third-party requests, enforced by a strict
  Content-Security-Policy and by tests.
- **Fast and accessible.** Static HTML that works without JavaScript, light and
  dark themes, WCAG 2.2 AA, printable.
- **No dependencies.** Plain HTML, CSS and JavaScript, built by a small Node
  script.

## Quick start

Requires Node.js 22 or later. There is nothing to install.

```sh
npm run dev     # http://localhost:4000, rebuilds on change
npm test        # run the tests
npm run check   # tests and production build into dist/
```

## Deployment

The site is hosted on Cloudflare Pages, which builds and deploys every push to
`main` with `npm run check` and publishes `dist/`. The build also writes
`dist/_headers`, so Cloudflare sends the security headers. GitHub Actions runs
the tests, a type check and the build on pull requests and on `main`.

## Contributing

Corrections, Georgian reviews, translations and new guides are welcome. See
[CONTRIBUTING.md](CONTRIBUTING.md) and the [content guide](docs/CONTENT-GUIDE.md).
To report a security problem, see [SECURITY.md](SECURITY.md).

## License

Created and maintained by [Shota Mtvarelishvili](https://github.com/shoti).

- Code: [MIT](LICENSE)
- Guides and text: [CC BY-SA 4.0](LICENSE-CONTENT.md)
- FiraGO font: [SIL Open Font License 1.1](src/public/fonts/OFL.txt)

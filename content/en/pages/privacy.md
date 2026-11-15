---
title: Privacy — what Lockwell stores and sends
heading: Privacy
description: What this site saves in your browser, the one request a tool can make, why there are no cookies, and how to delete what is saved.
---

This page explains what lockwell.org saves in your browser and what your browser sends to it. Last updated 15 November 2026.

## Requests and cookies {#requests}

- Every font, script, style and image on this site comes from lockwell.org itself. The site loads no analytics scripts, no ads and nothing from other companies. Its security policy tells your browser to refuse anything that doesn't come from this site.
- The site sets no cookies.
- Search, the checklists and the tools run in your browser. What you type, tick or open in them is not sent anywhere.
- The one exception is the **Show my IP address** button on the [browser check](/tools/browser-check/). Only when you press it, your browser makes one request to `https://lockwell.org/cdn-cgi/trace`, an address on this site that Cloudflare, which hosts the site, answers itself. Like opening any page, the request carries your IP address and your browser's usual headers. It carries nothing you typed. The page then shows the address and country from the answer.

<!-- TODO(next-iteration: hosting logs): what the host records about visits is described on the About page and is out of scope for this page until the next iteration. -->

## What is saved in your browser {#storage}

The site saves a few small values so that it remembers your choices. They stay in this browser and are never sent to the site. Every name starts with `lockwell:`.

- `lockwell:theme`: light or dark, if you chose one with the theme button. Kept in local storage.
- `lockwell:platform`: whether you last chose iPhone, Android or computer instructions. Kept in local storage, or in session storage while you read a guide for people at higher risk.
- `lockwell:progress:` followed by a short code: the steps you ticked in one guide. The code is not the guide's name, but the page itself shows which guide it belongs to. General guides keep it in local storage; guides for people at higher risk keep it in session storage.
- `lockwell:browser-compare`: the values you chose to remember on the browser check, so that it can show what changed. Kept in session storage.

Local storage stays until you delete it. Session storage is kept only in its tab and is normally deleted when you close the tab; a browser that reopens closed tabs may restore it. In a private window, or if your browser blocks site data, nothing is saved and the site still works.

## Delete what is saved {#delete}

- Press **Clear saved data** at the bottom of any page. It deletes every `lockwell:` value from both kinds of storage in this browser. It needs JavaScript.
- Or delete the site data for lockwell.org in your browser's settings.
- Each browser and device keeps its own copy, so repeat this on every one you used.

## Contact {#contact}

Corrections and questions: open an issue on [GitHub](https://github.com/shoti/lockwell/issues) or write to mtvarelishvili (at) proton.me. To report a security problem with the site, see [security.txt](https://lockwell.org/.well-known/security.txt). See also the [terms of use](/terms/).

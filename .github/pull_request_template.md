## What changed

## Checklist

- [ ] `npm run check` passes (tests + build)
- [ ] Content changes exist in both `content/ka/` and `content/en/`, or I explained why not
- [ ] I didn't change any existing item id (`{#id}`). Saved progress depends on them
- [ ] I updated `reviewed:` only on guides whose sources I re-read (it is shown as "Sources checked"); never just to refresh the date
- [ ] Every new or changed fact links a primary source (vendor help page, agency, court document, the study itself) next to it; time-sensitive numbers say "as of <month year>"
- [ ] Time-sensitive claims I checked are in `data/claims.json` with today's `checked_on`
- [ ] Nothing new about Georgian law, and no Georgian organisation or helpline that wasn't confirmed on its own site
- [ ] Guides where a step can carry legal risk have `legal: true`
- [ ] `npm run audit` passes (links, parity, unicode, claims, runtime privacy check)
- [ ] No new dependencies, external scripts, fonts or embeds

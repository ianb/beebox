---
title: "Landmark links are titled from the filename, not the card's title"
workstream: unattached
area: beebox
labels: [navigation]
filed-by: agent
discovered-by: agent
discovered-in: worktree-journey-walks-oct — A-lending journey walk, 2026-10-08
---

In the A-lending walk the folder view and the place menu listed loan cards as
"Cake Carrier Marisol" and similar. The cards' own titles were nicer, such as
"Cake carrier (Marisol's)". The walker said the names "read like filenames"
([report](../../beebox/test/user-stories/journeys/A-lending/reports/2026-10-08.md), row 35, shots 10 and 25).

## Mechanism

`buildLink` takes the link title from the path:
`const title = titleFromFilename(parsed.path)`
(`beebox/src/core/landmark/resolve/link-build.ts:69`). The card's `title:`
field is not read. A card title with punctuation (an apostrophe, brackets)
cannot survive the filename round trip, so the filename is a lossy source.

## Not obvious

Reading the title needs a card read per link, and the resolver already reads
cards for derived links in some tiers. Check whether the cost is acceptable
for a landmark that expands to hundreds of cards, or whether the index entry
can carry the title.

## Related

[Apostrophes are lost in slugged filenames and the titles derived from them](2026-09-02-apostrophes-lost-in-slugs-and-titles.md)
(the same lossy filename-to-title path).

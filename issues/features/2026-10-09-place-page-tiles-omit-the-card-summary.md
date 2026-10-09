---
title: "Place-page tiles show only a card's title, not its summary"
workstream: unattached
area: beebox
filed-by: agent
discovered-by: agent
discovered-in: worktree-journey-walks-oct — A-lending, B-inventory journey walks, 2026-10-09
---

A place page lists its cards as tiles with the title only. The card type can
define a one-line summary, and the tile does not show it.

- A-lending: the Loans page lists five loans by title. The loan type's
  `summarize` line ("<person> has it · back by <date>") appears on no surface
  the walker looked at. The walker asked for date lent, back-by, and status in a
  list that is easy to scan (Note 12).
- B-inventory: the Inventory page lists both containers, one line each. The
  walker's earlier wish for a page of all containers is now half met. It has no
  count and no summary, so it does not answer "what is in the tray?".
- C-reconnecting: the walker wanted "where things stand" as four names, one line
  each, and found it only inside quoted paragraphs.

## Mechanism

`LinkTile` renders the label or title and, when `hidePath` is off, the path
(`beebox/src/frontend/src/components/landmarks/LandmarkSection.tsx:250-298`). It
has no detail line. Place tiles dropped their paths in `00db2a570`, which left a
one-line tile with nothing under the title.

## Why the fix is not obvious

The summary is the `detail` line that a card type's `summarize` hook sets
(`beebox/src/core/file-summary.ts:31`: "most cards have none"). A resolved
place link carries a ref, label, title, existence, source, and prominence, but
no detail (`beebox/src/core/landmark/resolve/link-build.ts:20-39`). Showing it
means summarizing each linked card, which costs a read per tile in a large
`expand` group. A tile for a card whose type has no summary needs a rule.
Whether a summary also belongs on the Plate, search, and other lists is the
broader question in
[collection-views-are-badly-defined](2026-08-19-collection-views-are-badly-defined.md).

Related: [structured-card-front-hides-its-facts](../decisions/2026-10-08-structured-card-front-hides-its-facts.md)
(the same facts hidden on the card's own front).
[Landmark arrival](../../beebox/docs/implemented-plans/landmark-arrival.md).

Reports: [A-lending](../../beebox/test/user-stories/journeys/A-lending/reports/2026-10-09.md) R6,
[B-inventory](../../beebox/test/user-stories/journeys/B-inventory/reports/2026-10-09.md) row 57,
[C-reconnecting](../../beebox/test/user-stories/journeys/C-reconnecting/reports/2026-10-09.md) row 46.

---
title: "Search section results repeat the card summary instead of the matching passage"
workstream: unattached
area: beebox
filed-by: agent
discovered-by: agent
discovered-in: worktree-journey-walk — journey C and independent verification
priority: normal
---

A person looking for Bram's uncertain contact history got seven results from
one friends document. Even the result labelled Bram repeated the whole-card
summary about Marisol and Noor. The section names differed, but the previews
could not help the person choose.

## Verified mechanism

`beebox/src/core/search/extract/core.ts:122,136` gives each section the card's title
and `contains`. `beebox/src/core/search/query/core.ts:215` prefers nonempty `contains`
over section content for the snippet. Matching title/contains/content at
`query.ts:44` also lets a card-title query return all its sections.

Both the walk and a separate browser inspection returned seven entries for
this single card. Screenshot 25 shows the Bram heading above the same general
summary. This is a preview/relevance problem independent of the section-target
navigation defect. A summary result may legitimately show `contains`; a section
result needs a preview that distinguishes its matching content.

Evidence: [journey C report](../../beebox/test/user-stories/journeys/C-reconnecting/reports/2026-09-21.md),
actions 37 and 44, screenshots 20 and 25. Related:
[section navigation](2026-09-21-search-section-results-drop-their-destination.md).

## Re-encounter 2026-10-08 (journey walks)

Seen in the [B2 walk](../../beebox/test/user-stories/journeys/B-inventory/reports/2026-10-08-2.md) (row 64): searching "tape" found the drawer and listed the tray twice, one entry per section, each showing the card's `contains` summary, which does not say "tape". The priority may be stale given the recurrence.

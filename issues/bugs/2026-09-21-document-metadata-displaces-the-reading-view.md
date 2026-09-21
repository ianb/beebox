---
title: "Document metadata takes the first screen even with Properties closed"
workstream: unattached
area: beebox
filed-by: agent
discovered-by: agent
discovered-in: worktree-journey-walk — journey C and independent verification
---

A person trying to read a saved friends page first saw `contains`,
`prominence: primary`, and later `symbol: glyph`, then a repeated document
heading. The useful people and status occupied the remaining space or fell
below it. The separate Properties control was closed.

Journey C's 1280 × 577 desktop view exposed this on both split and focused
cards. The walker repeatedly asked why the first screen held labels for someone
else instead of their friends. It could read the content after navigating down;
this is a reading hierarchy problem, not missing data.

## Verified mechanism

`beebox/src/frontend/src/components/MarkdownCardView.tsx:83` filters out `theme`
and the outer title, then renders the remaining frontmatter above the body
through `FrontmatterFields` at line 98. This includes common card metadata.
`components/themes/CardProperties.tsx:21` separately presents prominence.
Thus closing Properties does not remove the technical fields from the reading
surface. DocSchema's body example also repeats its title as an H1.

Decide what belongs in the ordinary document reading surface and what belongs
under Properties. Do not hide meaningful domain fields from all card types as
an incidental fix for generic documents.

Evidence: [journey C report](../../beebox/user-stories/journeys/C-reconnecting/reports/2026-09-21.md),
actions 6, 19, 38, and closing remarks; screenshots 05, 09, 21, 29.
Related: the earlier [vocabulary sweep](../closed/bugs/2026-08-08-implementation-vocab-leaks-into-ui.md)
fixed other surfaces; this is a distinct default-renderer mechanism.

## Re-encounter, 2026-09-21 - journey F

Household Jobs and Ser vs Estar both displayed `contains` and
`prominence: primary` above the useful content with Properties closed.
Screenshots 09 and 16 independently show the same default-renderer mechanism.
The walker could read the saved work but repeatedly called these labels
bookkeeping. No document-rendering change was made.

Evidence: [journey F report](../../beebox/user-stories/journeys/F-newcomer/reports/2026-09-21.md).

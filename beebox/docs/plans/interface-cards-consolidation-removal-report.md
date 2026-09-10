---
title: "Interface card consolidation — removal report"
status: active
workstream: interface-as-cards
issues: []
---
# Interface card consolidation — removal report

Implementation is in progress under the [consolidation plan](interface-cards-consolidation.md).
Counts are physical lines including comments and blanks, not performance claims.
A negative net removal means growth. Moved behavior counts at its destination.

## Baseline and accounting

- Planning baseline: `2fe4d4d897d3a7bb97da505989eab74c3a280878`.
- Implementation start: `e72487d1dad6c473a4cf124b1c2724cee1e79214`.
  Intervening commits only change planning documents.
- Frontend source baseline: **625 files / 75,482 lines**, tracked `.ts`, `.tsx`,
  and `.css` under `beebox/src/frontend/src/`.
- Counts use `git diff --numstat --find-renames <start> <end>` and
  `git diff --name-status --find-renames <start> <end>`; totals group frontend
  production, other production/tooling, tests, and documentation separately.
- Stage ranges are adjacent and nonoverlapping. Cumulative comparison begins at
  implementation start. Unrelated main changes are excluded by commit attribution.
  No stage is counted as complete before its required checks pass.

## Stage results

Results will be recorded with each implementation commit. No deletion total is
claimed yet.

| Stage | Commit range | Frontend added / deleted / net removed | Other production added / deleted / net removed | Tests added / deleted | Docs/other added / deleted |
|---|---|---|---|---|---|
| A: single-card entry | Pending | — | — | — | — |
| B: canonical seeds/cohorts | Pending | — | — | — | — |
| C: Questions/Landmarks | Pending | — | — | — | — |
| D: History | Pending | — | — | — | — |
| E: Storage/Admin/utilities | Pending | — | — | — | — |
| F: alternate presentation removal | Pending | — | — | — | — |

## Retired UI and surviving behavior

Record actual deleted wrappers, controls, presentation branches, and state fields
here as they are retired. Keep source/media/capture dialogs, recipient history,
the draft/emission runtime, native bindings, and ambient replies. Legacy URL and
old-history read adapters are reported as retained, not hidden from the count.

## Verification and limits

Stage tests, browser walkthroughs IC-1 through IC-9, knowledge audits, independent
review, and any manual or deployment checks still outstanding will be listed with
the final totals. No bundle-size, speed, device, or production claim follows from
a line-count reduction.

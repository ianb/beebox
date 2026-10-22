---
title: "Place tiles for people show only names, though each person card has a one-line status"
workstream: unattached
area: beebox
filed-by: agent
discovered-by: agent
discovered-in: worktree-journey-walks-late-oct — C-reconnecting walk, 2026-10-22
---

The C-reconnecting walker wanted "a plain per-friend list (name, last contact, next step) on the box page, scannable at a glance." The Box page's "Also here" tiles showed four names only. Each person card had a `contains:` sentence that was close to that line, for example "Marisol suggested a Thursday dinner … she countered Saturday Oct 31 with Sunday lunch, which works; you still need to reply." The agent wrote a status paragraph on the Box page instead, and that paragraph goes stale (it said "tonight").

Report: [C-reconnecting](../../beebox/test/user-stories/journeys/C-reconnecting/reports/2026-10-22.md) (rows 36, 37).

## Mechanism

The [closed tile-summary fix](../closed/features/2026-10-09-place-page-tiles-omit-the-card-summary.md) named this journey. It shows the type's `summarize` detail under a tile's title (`TileDetail`, `beebox/src/frontend/src/components/landmarks/LandmarkSection.tsx:258-261`). The person type sets only a title (`beebox/src/schemas/person.tsx:65`), so its tiles get no detail.

## Why the fix is not obvious

`contains` is written for agents and search. It can be long, and it is not always phrased for the person; the card view already moved it to Properties as an internal field ([closed](../closed/bugs/2026-09-29-card-view-shows-internal-contains-field.md)). Options: fall back to `contains` when a type has no detail; give the person type a detail from its own fields; or let a place page show a status table of its cards.

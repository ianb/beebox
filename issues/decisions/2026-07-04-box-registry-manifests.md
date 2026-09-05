---
title: "Two-and-a-half box registries: unify or document as separate?"
workstream: unknown
---

2026-07-04 · needs adjudication — boxholder wants to put this to an agent
with the boxes-as-packages/hub context.

Registering a box is not one act, though the docs read as if it were:

- **`bbx boxes add`** writes the scheduler's manifest (`boxes.json`),
  validated via `.bbx-box` marker checks. Consumed by `bbx scheduler start`
  (and only that — `bbx serve` never reads it; see
  `beebox/src/cli/commands/serve.ts`).
- **`hub.json`** is the hub's routing manifest — per-box entries, slug
  collision-checked, `lazy` flag; consumed by `bbx hub`
  (`beebox/src/hub/`). Hand-edited, no CLI.
- **`bbx activity`** is a third consumer of `boxes.json`, reading it for a
  purpose unrelated to scheduling.

So serving and scheduling registration are separate systems with different
validation, plus a piggybacking third reader. A box that should be served,
scheduled, and reported on gets registered 2× in different formats.

Question to adjudicate: **unify into one manifest** (consolidation
preference says yes; but the hub is deliberately an independent first-class
component per boxes-as-packages-v2, and the scheduler runs on machines with
no hub) **or keep two, cross-documented** (each doc names the other; a
`bbx boxes add --hub` convenience could bridge). Migration cost of
unification: both file formats have live prod instances.

Refs: `beebox/docs/scheduler.md`, `beebox/docs/adding-a-box.md`,
`beebox/src/hub/CLAUDE.md`,
`beebox/docs/implemented-plans/boxes-as-packages-v2.md`.

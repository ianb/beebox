# Two-and-a-half box registries: unify or document as separate?

2026-07-04 · needs adjudication — boxholder wants to put this to an agent
with the boxes-as-packages/hub context.

Registering a box is not one act, though the docs read as if it were:

- **`cb boxes add`** writes the scheduler's manifest (`boxes.json`),
  validated via `.cb-box` marker checks. Consumed by `cb scheduler start`
  (and only that — `cb serve` never reads it; see
  `callback-box/src/cli/commands/serve.ts`).
- **`hub.json`** is the hub's routing manifest — per-box entries, slug
  collision-checked, `lazy` flag; consumed by `cb hub`
  (`callback-box/src/hub/`). Hand-edited, no CLI.
- **`cb activity`** is a third consumer of `boxes.json`, reading it for a
  purpose unrelated to scheduling.

So serving and scheduling registration are separate systems with different
validation, plus a piggybacking third reader. A box that should be served,
scheduled, and reported on gets registered 2× in different formats.

Question to adjudicate: **unify into one manifest** (consolidation
preference says yes; but the hub is deliberately an independent first-class
component per boxes-as-packages-v2, and the scheduler runs on machines with
no hub) **or keep two, cross-documented** (each doc names the other; a
`cb boxes add --hub` convenience could bridge). Migration cost of
unification: both file formats have live prod instances.

Refs: `callback-box/docs/scheduler.md`, `callback-box/docs/adding-a-box.md`,
`callback-box/src/hub/CLAUDE.md`,
`callback-box/docs/implemented-plans/boxes-as-packages-v2.md`.

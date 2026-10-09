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

Refs: `beebox/docs/scheduler.md`, `beebox/docs/server/boxes.md`,
`beebox/src/hub/AGENTS.md`,
`beebox/docs/implemented-plans/boxes-as-packages-v2.md`.

## Decision (2026-10-06)

The developer's message: "I don't really understand this one and don't know if
I even care. But maybe we just do it according to whatever you think."

Decided: **keep the two manifests, and cross-document them.** Checked on main:
the split still exists. `~/.config/beebox/boxes.json` (`bbx boxes`) feeds the
scheduler and `bbx activity` (`beebox/src/core/box/boxes-config.ts`,
`beebox/src/core/schedule/scheduler/core.ts`); `hub.json`
(`beebox/src/hub/config.ts`) is the hub's routing table, and `bbx serve` reads
neither (`beebox/src/cli/commands/serve.ts:137`). They answer different
questions on different machines: the scheduler runs where no hub exists, and
the hub is an independent component. Unifying them would migrate two live
formats for no user-visible gain.

Remaining work is documentation: each manifest's doc names the other and says
which command writes it (`beebox/docs/scheduler.md`,
`beebox/docs/server/boxes.md`, the hub docs). A `bbx boxes add --hub`
convenience is optional and not part of this decision.

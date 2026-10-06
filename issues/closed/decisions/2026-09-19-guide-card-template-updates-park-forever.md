---
title: "Guide cards learn, so their template updates park on every install once a box has learned anything"
workstream: refresh-maps-correctness
area: beebox
filed-by: agent
discovered-by: agent
discovered-in: split from issues/bugs/2026-09-12-procedure-templates-ship-pre-one-root-paths.md (closed by refresh-maps-correctness)
resolution: implemented
---

> Closed: the decision is recorded (a box agent merges the update). Implementing
> a resolution path is handed to
> [parked template resolution](../../features/2026-08-24-parked-template-resolution-path.md),
> which now carries this as an explicit requirement and stays open.

A guide card is a learning surface: `triage-rules` accumulate
`source: inferred` entries. Once a box learns anything, its guide differs
from the template permanently, and `installTemplateFile` parks every later
update under `_config/_template-updates/`. `test1` was in that state on
2026-09-12.

**Decided (boxholder, 2026-09-19): a box agent merges the update.** Not
`boxOwnedFields` and not install-once — a guide's learned entries and an
upstream revision can both be right, and reconciling them is judgment. The
box agent reads the parked copy against the live card and writes the merge.

That needs a resolution path to exist, which is
[parked template resolution](../../features/2026-08-24-parked-template-resolution-path.md):
something that shows local, parked and last stock, and records the result so
the box stops being asked. This issue only records the decision.

Done by hand on `test1` (2026-09-19) to see the shape: the live
`intake.guide.card` was the parked copy plus one learned rule, and the live
`main.personality.card` was ahead of the parked copy on every point —
learned entries had already answered its `unresolved:` questions. The merge
was "keep the live card", plus one junk empty `relationships` entry dropped.
A mechanical rule that preferred either side would have been wrong.

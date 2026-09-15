---
title: "V2_LAYOUT_SNAPSHOT is exported only so knip stops flagging V2_LAYOUT"
workstream: glm-v2-layout
area: beebox
priority: normal
labels: [dead-code, migrations]
resolution: implemented
filed-by: agent
discovered-in: knip-sweep schedule, run 20260908-191814
---

**Closed 2026-09-15** — resolved by deletion (commit `9d46946d6`). The recovery
pointer in the module header turned out to be alive: `d7d3a19d3~1` resolves and
is reachable from `main`, and its `box-layout-spec.ts` matches the snapshot's 35
path/area pairs exactly, so the copy was redundant. Took the first option; the
header now points at the git record and drops the incorrect "exhaustive OVER"
claim. Verified: knip reports no finding for the file, beebox typecheck clean,
full beebox suite shows only the two pre-existing unrelated failures it shows
without the change.


`beebox/src/core/migrations/one-root-mapping.ts:100` exports
`V2_LAYOUT_SNAPSHOT`, and its own comment says why:

> Referencing it here keeps `pnpm lint:knip` from flagging the constant as
> unused while still serving its documentation role.

Nothing imports it, so knip now flags the export instead — the finding moved
rather than went away. Underneath, `V2_LAYOUT` feeds nothing either: the
module header says it exists "so this module's exhaustiveness switch has
something to be exhaustive OVER", but that switch runs over the hand-written
`V2TopLevel` union, which is declared independently.

The sweep left both in place rather than deleting them, because the value at
stake is documentary and the header's recovery pointer may no longer work:
it names `git show d7d3a19d3~1:./src/lib/box-layout-spec.ts`, and main's
history was rewritten in 2026-09, so that hash may not resolve. Deleting the
frozen v2 layout with no way to get it back is not a call the sweep should
make alone.

Pick one:

- Delete `V2_LAYOUT_SNAPSHOT` and `V2_LAYOUT`. Check first whether the v2
  layout is recorded anywhere that survives — `docs/implemented-plans/one-root-box-layout.md`
  or a resolvable commit. If it is, this is the honest outcome.
- Or keep the table and make it earn the export: give it a real consumer
  (a doctest that checks the mapping covers every v2 path, which is the
  parity claim the comment gestures at) instead of a self-reference.
- Or move the paths into the module doc comment as prose, so the record
  survives without pretending to be code.

Either of the first two also lets the header's "exhaustive OVER" claim be
corrected or made true.

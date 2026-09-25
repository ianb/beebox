---
title: "The companion document gives no sign the agent is editing it"
workstream: unattached
area: beebox
labels: [journey-findings, ui-sensibility]
filed-by: agent
discovered-by: agent
discovered-in: worktree-user-stories-refresh — journey A, 2026-08-25 walk
priority: normal
---

## Recovery assessment (2026-09-21)

The concern remains plausible, not freshly reproduced. Current
`beebox/src/frontend/src/components/chat/workspace/WorkspaceCanvas.tsx:24-60`
renders tabs and FileView without agent-turn/mutation state. Initial loading is
not an in-progress edit indicator; existing text remains available during a
refresh. Related [card edit highlighting](../features/2026-08-01-card-diff-view-edit-highlighting.md)
is a separate question of showing changes, rather than showing that work is
underway. Preserve this as historical user evidence pending focused UI testing.


> Recovered 2026-09-21 from `worktree-user-stories-refresh` at `f914fcb4e`.
> The account below describes the 2026-08-25 walk, not a new reproduction.
> Source line numbers in that account are historical. Current disposition is recorded below.


Journey A's walker had the lending document open beside the chat — the
side-by-side they praised — through a 70-second turn that was editing that very
document:

> "The document panel gave no sign anything was happening — all the activity
> was over in the chat column — so for a good chunk of it I was looking at a
> stale list wondering if I'd been heard."

The live update itself works (an earlier turn's edit appeared "no refresh, no
'go check'" — and they loved it). What is missing is the in-between state: a
document mid-edit looks identical to a document at rest.

Same walk, same gap, other direction: they once caught the document showing an
already-resolved todo the plate had correctly dropped, and it self-corrected
moments later — "at the moment I looked, the document and the plate disagreed,
and nothing on screen told me one of them was catching up."

The fix shape is one indicator on the companion panel while an agent turn is
mutating files under it — the chat column already knows a turn is running and
which pill it is on.

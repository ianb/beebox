---
title: "ui-scan annotations doctest is red: `bbx-panel-tabs` and `bbx-panel-close` are documented but appear nowhere in source"
workstream: interface-as-cards
resolution: implemented
area: beebox
priority: normal
filed-by: agent
discovered-by: agent
discovered-in: worktree-sdk-update — the post-bump full-suite gate
---

`beebox/test/frontend/lib/ui-scan/annotations.doctest.md:166` asserts that every
id in the annotations table appears at least once in the source. Two do not:

```
found:  ["bbx-panel-tabs: 0", "bbx-panel-close: 0"]
wanted: []
```

Reproduces in isolation (`pnpm exec tap
test/frontend/lib/ui-scan/annotations.doctest.md` → 6 pass, 2 fail), so it is
not a batched-run flake. It is also **not** related to the Agent SDK pin: it
fails identically at `0.3.260` and `0.3.263`, checked by setting the bump aside
and reinstalling.

Most likely the two panel ids were renamed or removed from the components while
the annotations table kept its entries, in which case the fix is to update the
table. Worth confirming which of the two happened before editing, since the
opposite reading — the ids are correct and the components lost their
annotations — has the same symptom and the opposite fix.

Filed from the `sdk-update` schedule because the mechanism that would normally
catch and bisect this did not: the most recent `full-suite` run classified
itself as "25 files failed (environment)" and filed nothing.

## Resolution

Resolved by `ed2787dcc`. The workspace redesign removed the companion-wide close control, so its old
`bbx-panel-close` contract entry has been removed. `bbx-panel-tabs` still exists
in `WorkspaceCanvas.tsx`, selected conditionally alongside distinct mobile and
right-pane IDs. The source check now parses JSX ID attributes with TypeScript
and includes their literal alternatives instead of only matching `id="..."`.
The table points to the current component; uniqueness and kebab-case checks
remain in place.

Reproduced the reported two failures in isolation, then verified all eight
assertions pass after the fix. This is a focused rerun, not a full-suite result.

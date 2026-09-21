---
title: "Browse name guard calls a visible search result covered"
workstream: unattached
area: browse
filed-by: agent
discovered-by: agent
discovered-in: worktree-journey-walk — journey C and independent verification
---

The journey walker clicked the visible first search result twice, including a
fresh snapshot and scroll-into-view retry. `bin/browse` refused it as `covered`.
The independent replay produced the same refusal, while `elementFromPoint` at
the result centre returned the result button itself (`centerHitsOwnResult: true`).
This is a harness defect, not evidence of an app overlay blocking search.

## Verified mechanism

`browse/src/act.ts:237–254` passes the snapshot accessible name to the point
check. `browse/src/controls.ts:262–275,285–291` compares that name against DOM
attributes/raw `textContent`. Whitespace normalization does not insert spaces
between adjacent block contents. SearchResults renders title, type, path and
snippet as separate elements without an explicit accessible label or `bbx-` id.

The snapshot begins `Reconnecting with friends doc todos/Reconnecting…`.
Raw text begins `Reconnecting with friendsdoctodos/Reconnecting…`.
The mismatch is rejected before the actual occlusion check at lines 318–323.
The diagnostic truncates its display to 40 characters; truncation is not the
cause of the comparison failure.

Retain real stale-ref and occlusion protections while making this name check
agree with the accessible target. A regression should use adjacent title/badge/
path/snippet elements, not merely a plain text button.

Evidence: [journey C report](../../beebox/user-stories/journeys/C-reconnecting/reports/2026-09-21.md),
actions 45–47, screenshot 25. Related historical guard introduction:
[click reported success without dispatch](../closed/bugs/2026-08-21-browse-click-on-a-ref-does-not-dispatch.md).
The old silent-dispatch defect and this false refusal are different failures.

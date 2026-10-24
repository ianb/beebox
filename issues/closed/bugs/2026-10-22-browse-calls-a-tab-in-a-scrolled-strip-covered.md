---
title: "bin/browse refuses a tab scrolled out of its strip as \"covered\" by the strip, not \"offscreen\""
workstream: unattached
area: browse
labels: [harness]
filed-by: agent
discovered-by: agent
discovered-in: worktree-journey-walks-late-oct — F-newcomer walk, 2026-10-22
resolution: implemented
---

Resolved 2026-10-22 by the journey-walks-late-oct fix commit. The check scrolls a target clipped by a scroll container, and reports `offscreen` naming the container if that fails.

In the F-newcomer walk six tabs filled the sidecar strip, and the Home tab scrolled out of it. A click on the tab was refused as `covered`, and the covering element that the refusal named was the strip itself. The walker prompt says that only `offscreen` can be fixed by scrolling, so the walker gave up on the tab.

The check scrolls the target into view, then refuses `covered` when the element at the click point is not the target (`browse/src/controls.ts:299-322`). A target clipped by its own scroll container fails that test with the container on top.

Report: [F-newcomer](../../../beebox/test/user-stories/journeys/F-newcomer/reports/2026-10-22.md) (row 47, H4).

## Fix direction

When the covering element is a scroll container that holds the target, report `offscreen (inside a scrolled container)` and suggest `scrollintoview`. Find out first why `scrollIntoView` in the check did not bring the tab into the strip's visible area.

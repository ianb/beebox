---
title: "Manually verify Bee Box Clerk tab arrangement Apply and Undo"
workstream: tab-organizer-clerk
area: clerk
needs: [manual-testing]
filed-by: agent
discovered-in: worktree-tab-organizer-clerk — following up after the guarded tab-arrangement feature landed
---

> **⏳ Awaiting manual testing** — the feature landed in `86614e16`, with viewer polish in `29da64ec`; exercise a real Chrome Apply and best-effort Undo. Only Ian clears this.

The tab-arrangement flow has automated coverage and browser verification of the
card viewer. It has not completed an end-to-end test in the real Bee Box Clerk
extension against live Chrome tabs.

## Manual testing

1. Build `beebox-clerk/dist/chrome-mv3/`, then reload that unpacked extension
   in Chrome. This avoids the separate
   [stale unpacked-build bug](../bugs/2026-08-06-clerk-unpacked-build-silently-stale.md).
2. Share the current window to a selected box. Confirm the organizer opens in a
   normal browser tab.
3. Have the box agent reorder tabs and mark at least one tab as deleted. Set the
   arrangement card to `ready`.
4. In the organizer, check and uncheck deletion choices. Confirm titles wrap,
   URLs stay on one truncated line, and deleted tabs remain in context without
   strike-through.
5. Before one Apply attempt, add or move an uncaptured tab in the affected
   window. Confirm Clerk refuses the whole proposal and leaves every tab in
   place.
6. Share again to get a fresh capture. Apply a proposal that reorders tabs,
   creates or rearranges a window, and closes at least one marked tab. Confirm
   the resulting live layout matches the proposal.
7. Use **Best-effort undo** immediately. Confirm the captured window layout is
   restored and closed tabs reopen at their original URLs. Back/forward history
   for reopened tabs is not expected to survive.

Also try the all-windows share once if convenient. Incognito tabs must not be
captured or changed.

Clear `needs: [manual-testing]` only after the stale-preflight, successful Apply,
and best-effort Undo cases all behave as described.

---
title: "Decide whether card previews replace a transient tab or accumulate"
workstream: unattached
needs: [decision]
area: beebox
labels: [ui, navigation]
filed-by: agent
discovered-by: Ian
discovered-in: worktree-paper-cards — planning multi-pane card navigation
---

Opening card links currently accumulates tabs until the unpinned-tab cap evicts
older entries. A file-browser-style alternative would keep one transient preview
slot: another ordinary open replaces it, while focusing, editing, or pinning the
preview promotes it to a durable tab.

Choose the default interaction before multi-pane navigation makes the behavior
harder to change. Replacement reduces tab churn but can make a card disappear
when the user expected it to remain; accumulation is predictable but creates
cleanup work and weakens spatial continuity. The decision must cover link opens,
agent-requested opens, keyboard-modified opens, and mobile, and explain how users
promote a preview deliberately. Individual pinning and the current tab cap were
implemented by
[pin-a-sidecar-tab](../closed/features/2026-08-30-pin-a-sidecar-tab.md).

## Re-encounter, 2026-09-21 - journey C

A newcomer explicitly preferred chat over manipulating pages and ended unsure
why Browse returned and why tabs accumulated when they only wanted one friends
page. Screenshots 05, 07 and 27-29 preserve the changing pane/tab arrangements.
This is evidence of cleanup and spatial-orientation cost, not proof that a
transient-slot policy is the right remedy.

One return route is independently explained: `TodoViewCard.tsx:76,98` links the
origin through `/browse/<file>` with the raw path as text. `router.tsx:165` and
`lib/browse-card-state.ts:88` translate that into the Browse card with the file
as detail. The person expected a direct document link and instead returned to
a browsing context. The earlier Browse reappearance when opening The Plate
(action 11) has not been traced to the same mechanism.

Evidence: [journey C report](../../beebox/user-stories/journeys/C-reconnecting/reports/2026-09-21.md),
actions 6-13 and 52-54, plus closing remarks. No navigation behavior changed.

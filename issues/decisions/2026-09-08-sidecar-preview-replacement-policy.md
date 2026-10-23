---
title: "Decide whether card previews replace a transient tab or accumulate"
workstream: unattached
needs: [decision]
area: beebox
labels: [ui, navigation]
filed-by: agent
discovered-by: Ian
discovered-in: worktree-paper-cards — planning multi-pane card navigation
priority: backlog
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

Evidence: [journey C report](../../beebox/test/user-stories/journeys/C-reconnecting/reports/2026-09-21.md),
actions 6-13 and 52-54, plus closing remarks. No navigation behavior changed.

## Re-encounter, 2026-09-21 - journey F

Opening The Plate again brought Browse and prior tabs into view; the person
used two minus controls to get back to chat. Screenshots 10 and 18 preserve
that context. Per-conversation `sessionStorage` restoration is explicit in
`sidecar-tabs-storage.ts:72–109`, but this does not establish the exact cause
of every pane transition in the walk. This is another observation of spatial
orientation cost, not proof that replacement is the right policy or that
restoration itself is a defect.

Evidence: [journey F report](../../beebox/test/user-stories/journeys/F-newcomer/reports/2026-09-21.md).

## Re-encounter 2026-10-08 (journey walks)

Still relevant. [C-reconnecting](../../beebox/test/user-stories/journeys/C-reconnecting/reports/2026-10-08.md) (row 26) and [F-newcomer](../../beebox/test/user-stories/journeys/F-newcomer/reports/2026-10-08.md) (rows 27, 39, 112): clicking the Plate badge opens The Plate and a Browse tab beside it, and the chat disappears (F shot 07: tabs "Household jobs", "Browse", "The Plate", no chat). Opening "briefing" made a second tab and removed the chat again. F's summary: never sure what a click would do. The badge case has its own new issue; the replacement policy underneath it is still undecided. The priority may be stale given the recurrence.

## Re-encounter 2026-10-09 (journey walks)

Still relevant, per [F](../../beebox/test/user-stories/journeys/F-newcomer/reports/2026-10-09.md) (rows 29, 71). Row 29: the walker clicked Marta in the todo view and the whole list opened on the right with the chat gone; the click was on Marta, not the title, and the todo opens its card in the chat pane, so the walker misread it. Row 71: a reply arrived unseen while "Things to do" filled the chat pane, and the walker closed the pane to see it. The turn context says `transcript="hidden"` (12:40:44); no unseen-reply sign was found in `components/chat/everywhere/`. Not reproduced.

## Re-encounter 2026-10-22 (journey walks)

Three walks; the priority may be stale.

- [F-newcomer](../../beebox/test/user-stories/journeys/F-newcomer/reports/2026-10-22.md) (row 48): six tabs by the end. Settings and Admin, opened once to find notifications, stayed open. The walker: "tabs pile up and I never asked for Settings/Admin to stay open." The Home tab scrolled out of the strip. The strip fix of 2026-10-16 held: no tab was squeezed to "×".
- [H-handover](../../beebox/test/user-stories/journeys/H-handover/reports/2026-10-22.md) (rows 9, 27): tabs piled up in the left pane, two of them "Back fence"; "a bit confusing".
- [G-paperwork](../../beebox/test/user-stories/journeys/G-paperwork/reports/2026-10-22.md) (row 33) and H (row 6): a count on the Box page ("1 to do", "4 overdue") opened Todos in the chat's pane, so the chat left the screen and the next reply arrived unseen. That mechanism is filed as [reply unseen while cards cover the chat](../closed/bugs/2026-10-22-reply-unseen-while-cards-cover-the-chat.md).

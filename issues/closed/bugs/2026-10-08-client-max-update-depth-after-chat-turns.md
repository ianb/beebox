---
title: "The browser logs \"Maximum update depth exceeded\" right after chat turns"
workstream: unattached
area: beebox
labels: [frontend]
filed-by: agent
discovered-by: agent
discovered-in: worktree-journey-walks-oct — A-lending, B-inventory, C-reconnecting, D-chemistry and F-newcomer journey walks, 2026-10-08
resolution: implemented
---

Fixed 2026-10-08. `WorkspaceCanvas` gathered its card callbacks with a rest
spread (`{ children, ...callbacks }`). A rest object is new on every render,
so the React Compiler rebuilt every `WorkspaceCard` element whenever the
transcript changed, and every open card re-rendered on every streamed token.
`CardTodos` (`components/todo/CardTodos.tsx:67-69`) runs an effect on
`[children, result]` that calls `setHasOpenTarget`. With a todo-bearing card
open, each token render therefore scheduled one update from a passive effect.
React counts consecutive passive flushes that schedule updates. A fast burst
of final-reply tokens took the count past 50, and React logged the warning on
the next update. The fix destructures the two callbacks by name in
`components/chat/workspace/WorkspaceCanvas/view.tsx`.

Reproduced in the worktree's test1 with a todo card open in a panel and a
turn that edited it and streamed a ~250-word reply (3 of 3 runs). A patched
dev React recorded `CardTodos` as the only passive-effect update in each
counted flush, and `InteractiveChat` as the update between them. After the
fix, during the same turn `WorkspaceCard` rendered once, `FileView` twice
(the card edit's data refresh) and `InteractiveChat` 108 times. No warning
appeared in two runs, one of them with unpatched React. The commits that
added the app-bar place stack (b10225461, e22c56ead) took no part in the loop.

React reports "Maximum update depth exceeded" in each box's
`.beebox/client-debug.log`, within about a second of a chat turn finishing
(or of its first text). The cause is not traced. Nothing visible broke in any
walk. The count is the evidence:

| Walk | Errors | Notes |
|---|---|---|
| [A-lending](../../../beebox/test/user-stories/journeys/A-lending/reports/2026-10-08.md) (R2) | 5 | About 0.5 s after turn completion; not every turn |
| [B-inventory](../../../beebox/test/user-stories/journeys/B-inventory/reports/2026-10-08.md) (R2) | 3 | Each after a turn that edited a card open in a panel |
| [C-reconnecting](../../../beebox/test/user-stories/journeys/C-reconnecting/reports/2026-10-08.md) (row 49) | 1 | One second after turn 6 |
| [D-chemistry](../../../beebox/test/user-stories/journeys/D-chemistry/reports/2026-10-08.md) (R4) | 7 in 5 root-chat turns | None in the scoped chat, which had no panels |
| [F-newcomer](../../../beebox/test/user-stories/journeys/F-newcomer/reports/2026-10-08.md) (R1) | 2 | One second after turns 4 and 5 |

The [second B-inventory walk](../../../beebox/test/user-stories/journeys/B-inventory/reports/2026-10-08-2.md) (R5)
had none, although a turn edited a card that was open. The B-inventory
"open edited card" correlation therefore does not hold exactly; D-chemistry
also saw open-card edits with no error.

## What is known

A loop of state updates runs after a turn ends. Candidates, not checked:
the app-bar place publisher
(`beebox/src/frontend/src/components/app-bar-chrome.tsx`, `publishPlace`
stores a new object on every call), the chat workspace store, and card
live-refresh on a bus event. Reproduce first with a doctest or browse session
that sends one turn with a card panel open, then bisect on the component stack
React prints in `client-debug.log`.

---
title: "A chat keeps the title \"New conversation\" after it fills up"
workstream: unattached
area: beebox
filed-by: agent
discovered-by: agent
discovered-in: worktree-journey-walks-oct — B-inventory, C-reconnecting, D-chemistry, F-newcomer journey walks, 2026-10-08
---

Every chat the walkers opened kept a placeholder name for its whole life.

- B-inventory: the place pill said "New conversation" on a full chat. The
  walker asked: "name or button?" Three chats in the second walk were named
  "New conversation" and one "Conversation" after a reload.
- F-newcomer: the top-right label changed from "New conversation" to
  "Conversation" after a reload; a second chat still read "New conversation"
  after its first turn.
- D-chemistry: the Landmarks list showed the first chat by its whole first
  message, because the chat has no title.
- C-reconnecting: same label on the pill.

## Mechanism

`beebox/src/frontend/src/components/chat/everywhere/resolve-conversation.ts:61,67`
hard-codes the label "New conversation" for both a reserved session and a
fresh start. Chat cards hold metadata only, and nothing derives a title from
the first exchange. F-newcomer's 2026-09-21 walk (row 54) saw the same.

## Open question

Who writes the title: the agent after the first turn, a cheap model call, or
a truncated first message. The pill label and the chat list both need the
same source. Related:
[chats bind to a landmark once](2026-08-25-chats-bind-to-a-landmark-once-and-never-move.md).

Reports:
[B](../../beebox/test/user-stories/journeys/B-inventory/reports/2026-10-08.md) (rows 44, 46),
[B2](../../beebox/test/user-stories/journeys/B-inventory/reports/2026-10-08-2.md) (rows 36, 60, 68),
[D](../../beebox/test/user-stories/journeys/D-chemistry/reports/2026-10-08.md) (row 63),
[F](../../beebox/test/user-stories/journeys/F-newcomer/reports/2026-10-08.md) (row 83).

## 2026-10-08: no generated title existed in the walks

Left open by the fix batch; the fix needs the open question above answered.
Titles come only from the nightly chat-review title pass
([chat titles plan](../../beebox/docs/implemented-plans/chat-titles.md),
400-character gate). A walk on a fresh box never runs it, so there was no
title to reach the label. "New conversation" and "Conversation" are the
frontend's fallbacks in `resolve-conversation.ts`; the plan says the chip
shows nothing for an untitled chat (Track C), so these strings also drift
from it. A fix chooses when a chat gets its first title (after the first
turn, by which writer) and what an untitled chat shows meanwhile. Not
checked: whether a title written while the chat is open reaches the label
without a reload; the label is set once when the conversation resolves.

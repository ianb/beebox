---
title: "A message sent while cards cover the chat gets a reply that nothing shows"
workstream: unattached
area: beebox
labels: [chat, navigation]
filed-by: agent
discovered-by: agent
discovered-in: worktree-journey-walks-late-oct — C-reconnecting, G-paperwork and H-handover walks, 2026-10-22
resolution: implemented
---

Resolved 2026-10-22 by the journey-walks-late-oct fix commit. The ambient reply panel now also shows the selected conversation while its transcript is off screen, including a plain-text reply's first lines; it hides when the transcript is visible.

The composer stays live when no pane shows the chat. A person can send a message there. The reply arrives, and nothing on screen shows it. Three walks met this:

- C-reconnecting: the person pressed "Focus card", typed a request, and sent it. The screen showed "Thinking…", then nothing. The person decided that the message was lost, went "Back to split", and sent it again. The agent answered twice and said "It looks like this came through twice."
- H-handover: two messages, one after "4 overdue" opened Todos in the chat's pane and one after "Focus card". The walker found each reply only by guessing a pane control ("Minimize cards", "Back to split"). "I sent a message and nothing visible happened for me." "I would use it again but only if the reply stopped hiding."
- G-paperwork: "1 to do" on the Box page opened Todos in the chat's pane. The walker sent a message and "thought my message had not gone (it had)".

The H walker named this as the one failure that nearly decided against the product.

Reproduced twice after the walks: browse session `aa-c-1` (focus layout, reply not in the DOM until "Back to split") and `aa-h-1` (focus layout, reply "Ok." arrived; the "Conversation activity" region stayed empty).

Reports: [C-reconnecting](../../../beebox/test/user-stories/journeys/C-reconnecting/reports/2026-10-22.md) (rows 20, 21), [H-handover](../../../beebox/test/user-stories/journeys/H-handover/reports/2026-10-22.md) (rows 6, 14, 41, 51), [G-paperwork](../../../beebox/test/user-stories/journeys/G-paperwork/reports/2026-10-22.md) (rows 27, 33). The F-newcomer 2026-10-09 walk saw it first (row 71) without a mechanism.

## How the chat leaves the screen

- A list link opens in the pane opposite its own (`beebox/src/frontend/src/components/chat/workspace/use-open-beside/open-beside.ts:17-20`). On the root page in the left pane, "4 overdue" or "1 to do" opens Todos in the right pane, which held the chat. With cards in both panes the projection has no transcript (`beebox/src/frontend/src/components/chat/workspace/state-model.ts:239-256`).
- "Focus card": the focus layout has no transcript (`state-model.ts:233-237`).

The turn context records `transcript="hidden"`. The chat prompt then tells the agent to make important output self-contained in callouts (`beebox/src/core/chat/session/prompts.ts:132`). The C agent did so. No surface renders the callout.

## Why no sign appears

The ambient reply panel exists for a conversation the person cannot see, but it never shows the selected conversation: `if (selected || hidden) return null;` (`beebox/src/frontend/src/components/chat/ambient/AmbientReplies/AmbientSessionReply.tsx:80`). The comment says that the selected conversation "already has its own transcript and composer". That is false when the transcript is hidden. The `hidden` flag on line 70 already covers `selected && transcriptVisible`, so the `selected` test on line 80 is the part that hides this case.

## Why the fix is not obvious

Options: show the ambient panel for the selected conversation while its transcript is hidden; bring the chat back when the person sends; or keep a compact reply strip above the composer in the focus layout. The second option changes the layout under the person.

Related: [sidecar preview replacement policy](../../decisions/2026-09-08-sidecar-preview-replacement-policy.md) (which pane a link opens in), [plate badge pushed the chat off screen](2026-10-08-plate-badge-opens-browse-and-hides-chat.md) (closed; another trigger for the same layout).

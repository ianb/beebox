---
title: "Design review: the emoji ack badges on user messages are mostly not helpful"
workstream: unattached
needs: [design]
area: beebox
labels: [chat, frontend, agents]
filed-by: agent
discovered-by: Ian
discovered-in: main — boxholder discussion, 2026-09-27
priority: normal
---

When the agent does a discrete action in reply to a message, it emits an
`<ack>` tag, and the chat shows it as a small emoji badge on the corner of
the user's message bubble. The developer has used this enough to have
opinions, and finds it mostly not helpful. Start the review by asking the
developer for those opinions; do not design from the code alone.

## What exists

- **The agent side.** The chat system prompt tells the agent to emit
  `<ack>` for a discrete action instead of describing it in prose
  (`beebox/src/core/chat/session/prompts.ts:144-151`). Kinds: `created`,
  `appended`, `edited`, `todo-added`, `todo-completed`, and `no-response`,
  with an optional `ref` and optional inner text.
- **The icons.** `ACK_KINDS` in
  `beebox/src/frontend/src/lib/structured-output-parsing.ts:25-32`:
  ✨ created, ＋ appended, ✎ edited, 📋 todo added, ✓ done, and ✓ also for
  no response. Two kinds share one icon.
- **The placement.** `components/chat/ack-badge.tsx`: one badge per ack in
  the corner of the user's bubble, beside the audio badges. Tapping a badge
  opens a small dialog with the label and a link to `ref`.
- **Other features depend on acks.**
  - With `prose="off"` (narration mode), only `<ack>` and `<callout>`
    render (`prompts.ts:140`).
  - Narration mode tells the agent to prefer a silent `<ack>` for work done
    (`prompts.ts:193-195`).
  - `no-response` is how the agent says it deliberately did nothing.
  - The "do your bookkeeping silently" rule says an `<ack>` covers routine
    upkeep (`prompts.ts:23`).

## Questions for the review

- What a person needs to know after the agent acts, and whether an icon on
  their own message tells them that. The badge sits on the user's message,
  not the agent's reply, and its meaning is hidden until tapped.
- Whether the six kinds are the right distinctions, and whether icons can
  carry them.
- What replaces the ack where the prompt depends on it: narration mode,
  `no-response`, and silent bookkeeping.
- Whether the change also needs the chat prompt and
  `docs/narration-mode.md` in the box package docs to change. Prompt
  changes go through the agent guide's ledger and a knowledge audit.

Related: [reply to selected text with an emoji](2026-09-01-selected-text-emoji-reply.md)
is the user-to-agent direction of a similar idea.

## Re-encounter 2026-10-08 (journey walks)

Seen in the [A-lending walk](../../beebox/test/user-stories/journeys/A-lending/reports/2026-10-08.md) (rows 45, 79) and the [F-newcomer walk](../../beebox/test/user-stories/journeys/F-newcomer/reports/2026-10-08.md) (row 26). The ack badge is a 14 px icon-only button (`F/components/chat/ack-badge.tsx:68-87`). Its "Edited — …" text is only an `aria-label` and the click dialog, with no `title`. The A walker (notes 8 and 11) described "tiny purple pencil icons above the message, with no label", listed them under "Do not understand", and liked them once they were explained. F saw the same names ("Edited — noted what you want this for", "Created") on the person's own messages. The priority may be stale given the recurrence.

---
title: "In a Codex chat, text streams in, tool calls run, then new text replaces the earlier text instead of following it"
workstream: unattached
area: beebox
labels: [codex, chat, streaming]
filed-by: agent
discovered-by: Ian
discovered-in: "main session — boxholder report, 2026-11-06"
---

The boxholder has seen this in Codex chats, more than once but not recently:
some assistant text appears, then some tool calls, then new assistant text
appears in place of the old text. The earlier text is gone from the view. They
saw it in a Codex chat on a hosted box but cannot say where in the
conversation, so there is no known example turn.

Not known yet: whether the earlier text comes back on reload (a live-view
merge bug) or is also missing from history (a transcript bug).

Leads, to check:

- `beebox/src/services/claude-chat/codex-chat.ts` (`onEvent`): each completed
  Codex `agent_message` item becomes its own `assistant` event, with the item
  id as `uuid` when there is one (`codexSdkItemId`). A Codex turn often has
  several agent messages with tool calls between them. If the frontend or the
  session's turn text (`turnText` in `src/core/chat/session/run/core.ts`)
  keys streaming text per turn, or by a missing or repeated `uuid`, a later
  message would replace an earlier one. The Claude backend's assistant
  messages differ in shape, so the merge may assume Claude's.
- History reload goes through `src/core/chat/session/codex-transcript/core.ts`.
  Compare what it rebuilds for a turn with several agent messages against what
  the live stream showed.
- Different symptom, same area: [Codex thread projection stalls](../watch/2026-09-12-codex-thread-projection-stalls-mid-rollout.md)
  (a reply vanishes and never returns, an upstream indexing failure).

Reproduce: a Codex chat turn that writes text, runs a tool, and writes more
text (for example "say one sentence, list the files in X, then say another").
Watch the live view, then reload and compare. A unit test can feed
`codex-chat.ts` two `agent_message` items around a tool item and check that the
history and the live client state both keep both texts.

## Found 2026-11-08: deliberate folding

This is the chat's own folding, added in 05665521a (2026-10-23, plan
`chat-progress-fold`, issue `2026-10-08-chat-agent-narrates-implementation-steps`).
`groupIntoParts` in `beebox/src/frontend/src/components/chat/assistant-parts.ts`
folds text written before a later tool call into the activity row as a note;
the reply is the text after the last tool call, and while a turn streams "the
newest line shows until the next step folds it". The earlier text is not lost:
it is in the activity row. The live stream (`STREAM_TEXT` in
`machines/chatMachine/machine.ts`) only appends, and history
(`codex-transcript/core.ts`) keeps every agent message.

Codex shows it more than Claude because it writes many in-between messages:
one hosted-box thread has 181 assistant messages marked `phase: commentary`
and 62 marked `phase: final_answer` in its rollout. The ChatGPT and Codex
apps collapse commentary the same way. Codex's phase is not used here: the
SDK's `AgentMessageItem` type (0.164.0) carries only `id`, `type`, and `text`,
so the fold uses position (before a later tool call) instead.

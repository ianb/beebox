---
title: "Chat hides Claude 5 progress updates inside the collapsed thinking row, so an answer written there never shows"
workstream: chat-text-drop
area: beebox
filed-by: agent
discovered-by: agent
discovered-in: worktree-chat-text-drop — diagnosing a production report of chat turns that showed no reply
---

On a production box, two chat turns on `claude-fable-5-1` showed the user
only the collapsed "thinking, ran 2 commands" row. The user saw no reply.
Each turn's API message had three blocks: an empty thinking block, a
thinking block with 317–341 characters, and a Bash `tool_use`. There was no
text block. The final message of the first turn was a bare `<ack>` (111
characters).

**Cause.** Claude 5-family models can write a *progress update* before a
tool call. The API returns it as a `thinking` block with text, and returns
only a summary of it. Claude Code requests `thinking.display: "updates"`
for these models, so their reasoning blocks are empty and any thinking text
is an update. In these turns the model put its whole answer into updates,
so the user was meant to see that text. The chat UI grouped the updates with
reasoning under the collapsed row.

**Not the cause.**
- Claude Code did not drop the blocks. `apiBlockIndex` is contiguous in
  both messages. Across about 4,000 production messages since that field
  appeared on 2026-09-04, no message has a gap.
- `<ack>` did not fail to render. By design it renders as a badge on the
  preceding user message.

**Upstream reports.**
- anthropics/claude-code#91939: Fable 5.1 emits the final answer as a
  thinking block.
- anthropics/claude-code#85443: the same signature, read as a transcript
  drop.
- anthropics/claude-code#96947

**Fix.**
- Thinking text from Claude 5-family models renders as a visible line, in
  order between tool groups. This applies to history and the live stream
  (`writesProgressUpdates` in `beebox/src/shared/model-ids.ts`).
- A `no-response` ack does not hide a turn that has an update.
- The chat prompt tells the agent to put its answer in the final reply text.
- Test: `beebox/test/frontend/progress-updates.doctest.md`.

The full answer cannot be recovered after the fact. The API returns only
the update's summary.

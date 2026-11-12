---
title: "A second tab can keep stale conversation settings after a missed or out-of-order update"
workstream: unattached
area: beebox
labels: [chat]
filed-by: agent
discovered-by: agent
discovered-in: worktree-demo-support — cross-model review of the conversation strip (codex gpt-6-sol)
---

A conversation's settings (narration, prose, and now the strip's card) reach
an open page in two ways: one read when the conversation mounts, and a
`chat-features-changed` push on each change. Two sequences leave a tab with
old settings until a reload or the next change.

1. **An old read lands after a newer push.** The page reads the settings on
   mount and applies the answer without a check
   (`beebox/src/frontend/src/components/chat/everywhere/InteractiveChat/use-chat-model.ts:119`).
   If that read was taken before a change, and its answer arrives after the
   push for the change, the tab goes back to the old value. The push handler
   replaces the map and does not cancel the pending read
   (`beebox/src/frontend/src/components/chat/InteractiveChat-helpers.ts:174`).
2. **A push is missed while the socket is down.** The push is transient
   (`beebox/src/webapp/routes/chat/register.ts`, `emitTransient(
   "chat-features-changed", …)`), so it is not replayed. On reconnect the
   page refreshes history and tasks and does not read the settings again
   (`beebox/src/frontend/src/components/chat/everywhere/InteractiveChat/ws.ts:255`).

What a person sees: in a second tab, narration mode or the strip shows the
state from before the change. With the strip this is more visible than with
narration, because the agent changes it and the person expects to see it.

This behaviour predates the strip; the strip did not change either path.
It was not fixed with the strip because the fix touches the shared settings
path of every conversation.

Possible fix, not designed: give each settings read and push a per-session
sequence number so an older read cannot apply after a newer push, and read
the settings again on reconnect under the same rule.

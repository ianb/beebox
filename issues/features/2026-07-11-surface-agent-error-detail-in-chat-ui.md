---
title: "Surface truncated agent-error detail in the chat turn-failed UI"
workstream: fix-bugs
area: callback-box
filed-by: agent
discovered-in: worktree-fix-bugs — bug-queue validation; split out of the closed box-child-stderr issue
next-action: reconfirm
---

When a chat turn ends `is_error=true`, the client shows only "the run reported
an error with no detail (subtype: …)"
(`src/frontend/src/machines/chat-actors.ts:170`), even though the server side
(`warnErroredTurn`, `src/core/chat/session/messages.ts:355`) already has the
SDK's result text — exactly the detail that distinguishes "unavailable model"
from "unresumable session" from "server error". The server-side logging half of
this shipped (child output now lands in `.callback-box/hub-child.log`; see
[box-child-stderr-not-surfaced](../closed/bugs/2026-07-07-box-child-stderr-not-surfaced.md)),
so failures are diagnosable after the fact — but the user still gets a generic
message.

The open question is how much of the SDK result text is safe/useful to show:
it can contain internal paths or prompt fragments. Likely shape: carry a
truncated (say 200-char) form of the result text on the turn-failed event and
render it collapsed/expandable in the error bubble.

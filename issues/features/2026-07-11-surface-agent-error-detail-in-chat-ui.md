---
title: "Surface truncated agent-error detail in the chat turn-failed UI"
workstream: fix-bugs
area: beebox
filed-by: agent
discovered-in: worktree-fix-bugs — bug-queue validation; split out of the closed box-child-stderr issue
priority: backlog
---

> `reconfirm?` checked 2026-09-05: unchanged since the 2026-08-18 check — the result message's `errors` field is still captured nowhere in `message-types.ts` / `messages.ts`.

> **Checked 2026-08-18 — still live, and the real gap is sharper than filed.**
> Tagged `reconfirm`; removed.
>
> The line this issue cites (`chat-actors.ts:170`, now `:191-195`) already
> surfaces `msg.result` — but that landed in `3fde511c` on 2026-06-13, a month
> *before* this was filed, so it was never the missing piece. It covers only
> `subtype: "success"` with `is_error: true` (an unavailable model, say).
>
> **The actual gap:** the SDK's `SDKResultError` variants
> (`error_during_execution`, `error_max_turns`, `error_max_budget_usd`,
> `error_max_structured_output_retries`) carry their detail in an
> **`errors: string[]`** field rather than `result`
> (`sdk.d.ts:4529-4553`). `adaptSdkMessage`'s `"result"` case
> (`src/core/chat/session/messages.ts:240-252`) copies only `msg.result` and is
> gated by `if (msg.subtype === "success")`, so `errors` is never captured into
> `ChatMessageResult` (`src/core/chat/message-types.ts:134-145`) and never
> reaches the frontend. No other path surfaces it either — `STREAM_ERROR` in
> `chatMachine.ts` / `chat-actions.ts` does not.
>
> So precisely the failures a user most needs explained — unresumable session,
> server error, turns or budget exhausted — are the ones that still produce the
> generic no-detail message. That is the thing to build.
>
> Also unbuilt from the issue's "likely shape": the 200-char truncation and the
> collapsed/expandable treatment. What ships today is untruncated plain text for
> the single case it handles.

When a chat turn ends `is_error=true`, the client shows only "the run reported
an error with no detail (subtype: …)"
(`src/frontend/src/machines/chat-actors.ts:170`), even though the server side
(`warnErroredTurn`, `src/core/chat/session/messages.ts:355`) already has the
SDK's result text — exactly the detail that distinguishes "unavailable model"
from "unresumable session" from "server error". The server-side logging half of
this shipped (child output now lands in `.beebox/hub-child.log`; see
[box-child-stderr-not-surfaced](../closed/bugs/2026-07-07-box-child-stderr-not-surfaced.md)),
so failures are diagnosable after the fact — but the user still gets a generic
message.

The open question is how much of the SDK result text is safe/useful to show:
it can contain internal paths or prompt fragments. Likely shape: carry a
truncated (say 200-char) form of the result text on the turn-failed event and
render it collapsed/expandable in the error bubble.

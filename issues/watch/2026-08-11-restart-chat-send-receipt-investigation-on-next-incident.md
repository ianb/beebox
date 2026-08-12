---
title: "Restart the chat send receipt investigation after the next real incident"
workstream: send-receipt-logging
area: callback-box
filed-by: agent
discovered-in: worktree-send-receipt-logging — after landing send receipt diagnostics
---

The instrumentation for
[chat sends that appear unconfirmed after they succeeded](../bugs/2026-08-04-chat-send-receipts-fail-often-message-actually-sent.md)
is deployed. The failure trigger is still unknown. More speculative work before
another incident would not add evidence.

## Trigger

Reopen this investigation when the boxholder next sees any of these symptoms:

- A sent message returns to the composer.
- A sent message remains in the composer after it appears in chat history.
- The UI reports that a message failed or was not confirmed, but the turn ran.
- The client logs `[chat] Send failed with network error, retrying...` during a
  send that later succeeds.

Record the approximate incident time, surface (web or iOS), and whether the app
or tab was backgrounded. Do not record the message content.

## Investigation procedure

1. Start a new worktree for the receipt investigation.
2. Inspect `.callback-box/client-debug.log` around the incident time.
3. Find the `[chat-send-diagnostic]` entries for the affected emission ID.
4. Compare the millisecond offsets for dispatch, POST attempts and responses,
   local receipt settlement, visibility and network changes, event-bus state,
   turn-stream progress, and durable-history observation.
5. Decide from the observed ordering whether the next work is a fix, more
   instrumentation, or a narrower reproduction.

This procedure concerns a developer's live box. Keep incident-specific findings
out of the public repository until the boxholder scrubs and approves them. Use a
private issue for unsanitized notes. Structural code findings can later update the
linked public bug.

Do not close this watch item merely because the diagnostic entry exists. Close it
when the next incident has been investigated and the resulting work has been
routed to an actionable issue or fix.

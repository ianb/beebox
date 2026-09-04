---
title: "The stream watchdog can fail even when chat has an explicit session ID"
workstream: unknown
area: beebox
filed-by: agent
discovered-in: browse-ws-auth — reconciling field-test evidence after the WebSocket auth fix
labels: [soft-launch, field-test-findings]
priority: normal
---

The stream watchdog did not recover an established chat after its WebSocket
failed. The page had an explicit session ID throughout the turn. The server
completed the turn, but the UI showed "Agent is working" for more than 15
minutes. A reload revealed the completed reply.

This is broader than the originally documented null-session gap. The stuck
turn was the session's second turn, and screenshot metadata records the same
concrete `?session=<id>` URL before send, after send, nine minutes later, and
into the next activity. `chatMachine` initializes `context.sessionId` from an
explicit `sessionInput`, so the leading theory that most-active history was
displayed while the machine stayed at `sessionId: null` does not fit this run.

The evidence does not yet distinguish among these remaining paths:

- the watchdog effect never started;
- its HTTP polls failed;
- its polls continued to report busy after the server completed;
- the effect restarted often enough that it never accumulated three idle
  results;
- `STREAM_RECOVER` was sent but did not leave the streaming state.

The run did not capture browser console logs, so the existing warning messages
cannot settle which path occurred. A short reproduction should record the
machine session ID, each watchdog poll result, effect cleanup/restart, and the
`STREAM_RECOVER` transition.

## Browse-key fix control (same field run)

The next operator item ran after the browse-key cookie fix. It opened the same
explicit session, sent another message, and displayed the assistant reply
within 31 seconds without a reload. This is the first in-situ confirmation that
the cookie fix restored realtime delivery in the field-test operator flow. It
does not explain why the fallback watchdog failed in the earlier WS-dead turn;
that remains this issue's scope.

Related:

- [chat-status-lies-after-completion](../closed/bugs/2026-08-08-chat-status-lies-after-completion.md)
  documents the watchdog and its accepted null-session gap.
- [browse-key-ws-upgrade-headers](../closed/bugs/2026-08-09-browse-key-ws-upgrade-headers.md)
  records the harness-specific socket failure and its fix.

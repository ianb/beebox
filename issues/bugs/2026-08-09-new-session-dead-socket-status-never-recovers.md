---
title: "A dead socket on a new chat leaves 'Agent is working' unrecoverable"
area: callback-box
filed-by: agent
discovered-in: browse-ws-auth — reconciling field-test evidence after the WebSocket auth fix
labels: [soft-launch, field-test-findings]
---

The stream watchdog cannot recover a new chat when its WebSocket dies before
the first `system/init` frame. The chat machine is streaming, but it has no
session ID to pass to `chat.statusAll`. The watchdog therefore has no pollable
identity and never sends `STREAM_RECOVER`.

A field-test run reached this state. The server completed the first turn in 18
seconds, but the UI showed "Agent is working" with no partial text for about
seven minutes. Both WS-fed completion paths were absent. The operator stopped
the run as blocked.

The browse-key cookie fix closes the harness-specific cause, but the recovery
gap remains reachable for any real user whose socket dies before the first
frame on a new chat. The existing watchdog implementation explicitly accepted
this gap when it was added. The field-test evidence shows that it needs a
fallback, such as a bootstrap/status query that can resolve the assigned
session before polling `chat.statusAll`.

Related:

- [chat-status-lies-after-completion](../closed/bugs/2026-08-08-chat-status-lies-after-completion.md)
  documents the watchdog and its accepted null-session gap.
- [browse-key-ws-upgrade-headers](../closed/bugs/2026-08-09-browse-key-ws-upgrade-headers.md)
  records the harness-specific socket failure and its fix.

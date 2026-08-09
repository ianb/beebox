---
title: "cb serve went unresponsive for ~4 minutes, then self-healed silently"
area: callback-box
filed-by: agent
discovered-in: worktree-integration-tests — field-test operator prototype (Priya, activity 2)
labels: [field-test-findings, code-error]
---

During the field-test prototype, the served app stopped responding entirely:
no clicks landed, and two successive page navigations each hung for ~2 minutes
before timing out with no response. On the third attempt the app loaded
normally with all state intact — no error shown, no reconnect notice, no trace
in the UI that anything happened.

Context: standalone `cb serve <box> --port 3555` (fresh `cb init` box, dev
build), immediately after rapid navigation between the three card views
(chat side panel → browse page → full card view) and keyboard scroll attempts.
A real chat-agent turn had completed a minute or two earlier.

Low information — filed so the symptom is on record. Worth checking when it
recurs: whether the Node process was blocked (event-loop stall — a sync FS
walk? search-index rebuild? git operation on the box?), whether it correlates
with the chat session pool, and whether anything landed in the box's
`.callback-box/` logs. The field-test harness (agent-field-tests plan) will
surface this class of stall as a harness event if it recurs in runs.

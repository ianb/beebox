---
title: "Modules at the line cap force a refactor or packed lines for a small change"
workstream: unattached
area: beebox
filed-by: agent
discovered-by: agent
discovered-in: "worktree-retrospective — retrospective 20261031-234313"
---

Sessions report that a one-line change pushes a module over the line or function
cap, so they refactor first or compress code. Modules named so far:
`realtimeTranscriptionMachine.ts`, chat `run/core.ts`, `createHubServer`,
`services/claude-chat/core.ts`, and `workstreams-app/src/server/main/documents-service.ts`.

Decide for each module whether it has a natural split.

Evidence:
- `issue-suggestions/20261030T181942Z-plan-reviewed.md`
- `unattached/20261030T044934Z-implemented.md`
- the earlier retrospective watch item `files-at-line-cap`, seen in three prior packets

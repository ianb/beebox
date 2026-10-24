---
title: "Agent quota collection exists twice: `bin/agent-quotas-*` and the workstreams app's `quota-*`"
workstream: unattached
area: router
labels: [code-quality]
filed-by: agent
discovered-by: agent
discovered-in: worktree-dup-sweep-backend — backend pass of the functional-duplication sweep
resolution: implemented
---

Closed 2026-10-23 by commit 98ce20b14 (worktree-dup-sweep-backend): the workstreams app's `quota-*` modules own collection; `bin/agent-quotas.ts` is a thin CLI and the bin copies are deleted.

Two modules read the Claude and Codex usage quotas, parse them, and cache the
Claude result:

- `bin/agent-quotas.ts`, `bin/agent-quotas-parse.ts`,
  `bin/agent-quotas-requests.ts`, `bin/agent-quotas-collect.ts` (about 800
  lines).
- `workstreams-app/src/server/main/quota-parse.ts`, `quota-requests.ts`,
  `quota-collect.ts`, plus `quota-glm*.ts` (about 640 lines).

`requestCodexRateLimits` is the same function in both
(`bin/agent-quotas-requests.ts:93`, `workstreams-app/src/server/main/quota-requests.ts:56`):
it starts `codex app-server`, speaks JSON-RPC over readline, and stops the
child with SIGTERM and then SIGKILL. `requestClaudeUsage`, `readClaudeCache`,
`writeClaudeCache`, `parseCodexQuota` and `parseClaudeQuota` also exist in both.
A fix in one copy does not reach the other.

## Why this is not a mechanical merge

- The output types differ: `bin` returns `AgentQuota`; the workstreams app
  returns its own `Quota` (`workstreams-app/src/shared/documents.ts`).
- Only the workstreams app collects GLM quotas, and it injects its request
  functions for tests.
- The error shapes differ (`requestError` against `QuotaRequestError`).

Decide which module owns quota collection and which shape it returns. The
other then becomes a caller.

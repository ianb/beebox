---
title: "Box-authored card schemas load inside the server process, so they can read its credentials"
workstream: unattached
area: beebox
labels: [security, env]
filed-by: agent
discovered-by: agent
discovered-in: worktree-agent-ad8cceee119235ca5 — cross-model security review (codex gpt-6-astra) of the view metadata env fix
---

`src/schemas.ts:342` loads each box schema with `await import(...)` in the
calling process. In a box server that process keeps `BBX_HUB_SECRET` and
`BBX_DIAG_API_KEY` in `process.env` and reads them per request
(`src/webapp/auth.ts`, `src/core/mobile/session.ts`). An agent can write a
schema file, so its top-level code can read those values. Under the hub, an
agent holding `BBX_HUB_SECRET` could forge the hub's identity headers at a
sibling box's port (`src/lib/credential-env.ts`).

This comes from reading the source; no exploit was run. It is an execution
boundary, so an environment allowlist cannot close it.

Decision needed: load schemas in a child process, which changes their execution
contract and the cost of every schema load, or remove the secrets from the
server's `process.env` after startup, or accept this under the trust model and
state it in `docs/security-report.md`.

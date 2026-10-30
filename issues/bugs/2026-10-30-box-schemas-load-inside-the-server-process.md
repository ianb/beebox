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

Update 2026-10-30, boxholder decision: `bbx serve` now moves its credentials out
of `process.env` at startup (`src/lib/server-secrets.ts`).
`test/hub.e2e.test.ts` runs a real hub and box, and a schema there finds neither
`BBX_HUB_SECRET` nor `BBX_DIAG_API_KEY` in the environment.

A schema that targets the secrets can still get them, so this issue stays open.
Found by reading the source; none was run:

- It can import `lib/server-secrets.js` from the same process and call
  `serverSecret`.
- On Linux, `/proc/self/environ` keeps the environment the process started with.
  `process.env` deletion does not change it. This exposes `BBX_DIAG_API_KEY` and
  `BBX_VAPID_PRIVATE_KEY` from `/etc/beebox/box.env` on a unit host, and also
  `BBX_HUB_SECRET` under a spawning hub.
- A process of the box's user can read the unit's credential file under
  `/run/credentials/`, if the unit's sandbox does not hide it from that process.

The hub secret's reach depends on the hub mode. A spawning hub
(`startSpawning`, `src/cli/commands/hub.ts`) gives every child one secret, so it
is valid at a sibling's port. A unit host mints one per box
(`src/hub/secrets.ts`), so it is valid only at that box.

Done when schemas load outside the process that holds the credentials, or the
boxholder accepts the remaining routes under the trust model and
`docs/security-report.md` says so.

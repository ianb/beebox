---
title: "View metadata import runs box-authored view code with the server's whole environment"
workstream: agent-ad8cceee119235ca5
area: beebox
labels: [security, env]
filed-by: agent
discovered-by: agent
discovered-in: worktree-agent-a80db54b588f8698c — cross-model security review (codex gpt-6-astra) of the credential table
resolution: implemented
---

**Closed (implemented, 2026-10-30):** The metadata import child now gets the agent profile's allowlist with BBX_SPAWN_PROFILE=agent (agentAllowlistEnv in src/core/script-env/core.ts), and bbx view check's render child gets buildScriptEnv. test/credential-visibility/every-consumer.test.ts pins both at the process boundary (viewMeta, viewRender columns); test/webapp/views/compiler.test.ts checks that a view exporting process.env.BBX_HUB_SECRET gets nothing. The engine-audience spreads found in the same audit are filed as 2026-10-30-upgrade-and-migrate-spawn-box-code-with-the-callers-whole-env.

`src/webapp/views/compiler/meta-import.ts` `runInSubprocess` spawns Node with
no `env` option, so the child gets the server's `process.env`. The runner
imports the compiled view, which is box-authored code. A view that exports
`name = process.env.BBX_HUB_SECRET` returns the secret as ordinary view
metadata (`getViewMeta()`, reached when the server lists views). Under the hub
the server env holds `BBX_HUB_SECRET`, `BBX_DIAG_API_KEY`, and
`BBX_VAPID_PRIVATE_KEY`; outside it, also `BBX_SESSION_SECRET`.

`src/cli/commands/view/command.ts` `checkOneView` also spawns
`bbx view render-one` with no `env`; when an agent runs `bbx view check` that
env is already the agent profile, but a server-side caller would pass its own.

Agent runs, tricks, and procedure shells start from `buildScriptEnv`
(`src/core/script-env/core.ts`); `src/lib/credential-env.ts` lists what the
agent profile may see. Direction: pass `buildScriptEnv(boxRoot)` to both
spawns, add a column for each to
`test/credential-visibility/every-consumer.test.ts`, and check that view
compile and render still find what they need (they run on the agent profile
when an agent runs them today).

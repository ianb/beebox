---
title: "Server-side commits run the box's Git hooks with the server's whole environment"
workstream: unattached
area: beebox
labels: [security, env]
filed-by: agent
discovered-by: agent
discovered-in: worktree-agent-ad8cceee119235ca5 — cross-model security review (codex gpt-6-astra) of the view metadata env fix
---

`src/lib/git/core/commit-env.ts` `commitEnvironment` starts from `process.env`
and removes only Git override keys. `commitPaths`
(`src/lib/git/core/operations.ts:335`) passes the result to `git commit` with
hooks enabled, and `src/webapp/routes/api/register/files-write.ts:159` reaches
it from the server. An agent can write `.git/hooks/pre-commit` in its box, so
the hook receives `BBX_HUB_SECRET` and every other server variable on the next
commit made through the app.

Other Git calls that use `simpleGit` without an `env` also inherit the whole
environment. Those that fire hooks need the same audit.

This comes from reading the source; no exploit was run. The fix was left out of
the view metadata work for two reasons: the hook environment must keep what the
validation hook needs (`src/core/install-validation-hooks.ts`), and
[box schemas load inside the server](2026-10-30-box-schemas-load-inside-the-server-process.md)
gives box code the same values until that is decided.

Direction: build the commit environment from an allowlist, keep the Git variables
hooks depend on, and add a column to
`test/credential-visibility/every-consumer.test.ts` that reads the environment
from a real hook.

---
title: "The browser host and the maintenance controller's command start with the caller's whole environment"
workstream: child-env-allowlist
area: beebox
labels: [security, env]
filed-by: agent
discovered-by: agent
discovered-in: worktree-child-env-allowlist — process.env spread sweep after the Git/CLI/engine allowlists
resolution: implemented
---

**Closed (implemented, 2026-11-08):** Browser host fixed: it now gets browserHostEnvironment(), the agent allowlist plus AGENT_BROWSER_EXECUTABLE_PATH (beebox/src/core/browser/host/start.ts), pinned by the browserHost matrix column. The maintenance controller's command is left as is by design: in production it is the deploy's own root-run activation script, and deploy/deploy.sh sources /home/beebox/.env right before it so the script receives the hub environment; it runs no box code.

Two spawn sites outside the 2026-11-08 allowlist work still copy `process.env`
into a child:

- `src/core/browser/host/start.ts:168` starts `bbx engine browser-host` with
  `env: process.env`. The box server spawns it, and it runs the agent's
  browser, so the server's provider keys and unlisted variables reach the
  process that drives agent-chosen pages.
- `src/cli/commands/maintenance/controller.ts:147` runs the maintained command
  with `{ ...process.env, BBX_MAINTENANCE_PERMITS }`. It runs from an operator
  shell or the deploy, like the `bbx upgrade`/`bbx migrate` children fixed in
  `docs/implemented-plans/child-env-allowlist.md`.

The server seals its own named secrets out of `process.env` at startup
(`src/lib/server-secrets.ts`), so what leaks is provider API keys and any
unlisted variable.

Direction: the browser host likely takes `engineChildEnvironment()` or the
tooling allowlist (check what agent-browser and Chromium need: DISPLAY, fonts,
proxies). The maintenance command takes `engineChildEnvironment()` plus the
permits. Add each to `test/credential-visibility/every-consumer.test.ts`.

The `src/field-test/` runners also spread `process.env`; they are dev tools
and not part of this item.

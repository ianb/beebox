---
title: "`bbx upgrade` and `bbx migrate` run box-reachable code with the caller's whole environment"
workstream: unattached
area: beebox
labels: [security, env]
filed-by: agent
discovered-by: agent
discovered-in: worktree-agent-ad8cceee119235ca5 — spawn audit while fixing the view metadata env leak
---

Three engine-audience spawn sites pass `{ ...process.env, ...boxWorkEnvironment() }`
to a child that can run box-authored code:

- `src/cli/commands/upgrade.ts` `defaultRunner` runs `pnpm install` in the box
  package. A box package's dependencies and lifecycle scripts run during the
  install.
- `src/cli/commands/migrate.ts` `runProcedure` runs `bbx procedure run`. The
  procedure's shell steps rebuild their env from `buildScriptEnv`
  (`src/core/procedure/shell.ts`), but the intermediate `bbx` process holds the
  caller's whole environment.
- `src/core/migration-run.ts` `runMigrationScript` runs an engine migrator
  under `tsx`. The migrator is engine code, but it reads box files and can
  compile box views.

Also `src/scripts/migrate/engine-link-spec/run.ts` passes `env: process.env` to
a `pnpm install --lockfile-only` in the box.

These run from the deploy sweep or an operator shell, so the environment is
the operator's rather than the box server's; on 2026-10-30 no box server or hub
code called them (`core/migration-sweep.ts` is imported only by
`cli/commands/migrate.ts`). The exposure is whatever the operator or deploy
environment holds. Direction: decide which profile an engine-audience child
gets (`buildToolingScriptEnv` for `bbx` children; a narrow allowlist such as
`publish/prepare/core/project.ts`'s `commandEnvironment` for `pnpm install`),
then add each to `test/credential-visibility/every-consumer.test.ts`.

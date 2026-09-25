---
title: "dev scripts into bin"
workstream: unknown
area: monorepo
priority: important
resolution: implemented
---

The worktree-tooling instance of this is now **implemented** (2026-08,
`worktree-worktree-seam`): [the worktree control surface
plan](../../beebox/docs/plans/worktree-control-surface.md) promoted
`.claude/hooks/worktree-create.sh`/`worktree-remove.sh` into `bin/workstreams`
subcommands for exactly the reason below — a hook path claims the logic
belongs to one agent frontend. That work applied the principle to worktree
tooling only. The broader `pnpm exec` audit across other scripts, READMEs, and
CLAUDE.md files is still untouched and stays open here.

`bin/` is the brand for the project's first-class dev tools — `bin/browse`, `bin/workstreams`, `bin/bbx`. Anything an agent or developer reaches for regularly should live there as a thin wrapper, not be invoked via `pnpm exec <tool>`. A local path (`bin/foo`) tells the agent "this is ours, look at the source if you need to understand it"; `pnpm exec foo` looks like an upstream tool with no local affordances. Audit `pnpm exec` invocations across scripts, READMEs, and CLAUDE.md files — anything used more than once or twice is a candidate to pull out.


## Audit performed 2026-09-12 — nothing left worth promoting

Ran the audit this issue asks for, across scripts, READMEs and CLAUDE.md files
(excluding `closed/`). Every remaining `pnpm exec` invocation, by tool:

| tool | uses |
|---|---|
| `tsx` | 95 |
| `tap` | 16 |
| `eslint` | 7 |
| `tsc` | 5 |
| `bbx` | 2 |
| `wrangler`, `scan-uploader`, `lint-staged` | 1 each |

The principle does not apply to what is left. `tsx`, `tap`, `eslint` and `tsc`
are **runners**, not project tools — they genuinely are upstream, and a
`bin/tsx` wrapper would assert a local affordance that does not exist. They
account for 123 of the 128 uses.

The 95 `tsx` calls are overwhelmingly `pnpm exec tsx <one of our scripts>`, so
the local thing in each line is the script path, already visible. The largest
documented cluster is the user-stories pipeline
(`beebox/user-stories/README.md`, `journeys/README.md` — 9 lines invoking
`validate-discovery.ts`, `apply-consolidation.ts`, `make-batches.ts`,
`freeze.ts`, `render.ts`, `stale.ts`, `apply-recheck.ts`, `prepare.ts`,
`collect.ts`). That is one pipeline's many steps rather than a tool reached for
regularly — the issue's own bar is "used more than once or twice" as a *tool*,
and each of these is used once.

Meanwhile `bin/` now holds ~40 first-class entries, and the worktree-tooling
instance (the one that motivated this) shipped in 2026-08.

Closing as done: the audit is the deliverable, and its answer is that the
remaining calls are correctly `pnpm exec`. If the user-stories pipeline ever
grows a single front door, that is the moment to reopen — file it fresh rather
than reviving this.

---
title: "Scheduled sessions and direct commits land deployed-path changes without a smoke walk"
workstream: smoke-review
area: monorepo
labels: [tests]
filed-by: agent
discovered-by: agent
discovered-in: worktree-smoke-review — the weekly smoke-tier review, 2026-09-23
---

The smoke tier gates a landing only when the landing goes through `/finish`:
`bin/finish-verify` runs `bin/smoke` before `bin/land`. Two other landing
paths reach `main` with deployed-path changes and run no walk:

1. **Scheduled sessions that call `bin/land` directly.** The prompts for
   `sdk-update`, `knip-sweep` and `supplemental-lint` each tell the session to
   run tests and then `bin/land`. None of them mentions `bin/smoke`, and
   `bin/land` does not run it. These schedules change what boots:
   `sdk-update` bumps agent-SDK and Codex pins in `beebox/package.json` and
   `pnpm-lock.yaml`, and `knip-sweep` deletes code across `beebox/src`. A
   dependency bump and a deletion whose consumer the tests do not cover are
   both failures that a boot-and-walk shows and a unit tier does not.
2. **Commits made directly on `main`** in the main checkout. These do not go
   through `/finish` at all.

This is a different hole from the known `bin/`-only gap. That gap is a
deliberate rule about which paths count as code. These landings do touch
deployed paths, so the rule says they should be walked.

## Evidence

Window 2026-09-16T19:28Z to 2026-09-23T19:38Z. A landing counts as code when
its first-parent diff matches `DEPLOYED_PATHS_PATTERN`
(`bin/deployed-paths.ts`). A landing counts as walked when
`beebox-smoke-log.jsonl` has a run on the same branch in the 6 hours before
the merge.

- 53 code landings; 38 walked; 15 not walked.
- No walk is logged after 2026-09-21T19:10Z. Both code landings since then are
  schedule merges.

Schedule merges with no walk (6):

- `44ca9d361` 2026-09-22 `worktree-sdk-update` (`beebox/package.json`, `pnpm-lock.yaml`)
- `a0730c635` 2026-09-19 `worktree-sdk-update`
- `816e8ff67` 2026-09-18 `worktree-sdk-update`
- `faaf325f6` 2026-09-17 `worktree-sdk-update`
- `58dcd6e6b` 2026-09-23 `worktree-knip-sweep` (deletions in `beebox/src/cli/commands/`
  and elsewhere). The only logged walk on this branch is from 2026-09-10, and
  it is red.
- `a038b16e4` 2026-09-19 `worktree-supplemental-lint` (`beebox/src/core/box/file-watcher.ts`,
  `beebox/src/schemas/registry.ts`)

Direct commits on `main` with no walk (9). Three change only doctests and are
arguably exempt:

- `3db19d271` `beebox/src/frontend/src/components/admin/SecretsSection-forms.tsx`
- `b0bd513c8` `beebox/src/frontend/src/components/admin/CodexSection.tsx`
- `7da5cdd67` `beebox/src/core/todo/count.ts`, `beebox/src/core/agent-guide/todos.ts`
- `ea8e67884` `beebox/src/core/migration-sweep.ts`
- `98523aef7` `beebox/plugins/beebox-codex/scripts/run-bbx.sh`
- `777b1b0a8` `beebox/deploy/deploy.sh`
- `d09451cd6`, `2f5c50466`, `0d65810d0`: doctest-only

No bug in this window is traced to one of these landings. The hourly full-suite
run caught no regressions on `main`. The finding is structural: the gate does
not run on these paths.

## What would close it

This is a question of where the check lives. It does not require a new walk
step. Options for the session that takes this:

- Make `bin/land` run `bin/smoke` when the branch diff touches a deployed path.
  That covers schedules and any other caller in one place. The cost is the
  walk's disruption: it restarts the worktree's dev-server generation and
  needs the shared dev router to be up. An unattended schedule would then fail
  to land when the router is down.
- Add `bin/smoke` to each landing schedule's prompt, before `bin/land`. This is
  narrower, and each new landing schedule must remember to add it.

Direct commits on `main` are a process question (the main session is for small
tasks) more than a tier question. Record them here so a later review can see
whether they keep appearing.

---
title: "`engine-link-spec-2026-10` fails on every production box, and its repair question cannot commit"
workstream: engine-link-migration-fix
area: beebox
labels: [deploy, migrations]
filed-by: agent
discovered-by: agent
discovered-in: worktree-engine-link-migration-fix — failed production deploys since 2026-10-21
resolution: implemented
---

**Closed:** The lockfile refresh uses `--prefer-offline`, and migration questions carry no machine path (this workstream's fix commit).

Every production deploy since 2026-10-21T13:44Z failed. On each production box,
`engine-link-spec-2026-10` stayed pending, and `box-shape-record-2026-10` waited
behind it. Two defects caused this.

1. **The lockfile refresh cannot resolve offline.** The migration ran
   `pnpm install --lockfile-only --offline`
   (`beebox/src/scripts/migrate/engine-link-spec/run.ts`). A changed `link:`
   spec makes pnpm re-resolve the box's direct dependencies. The server's pnpm
   metadata cache did not hold them, so pnpm failed with
   `ERR_PNPM_NO_OFFLINE_META` for `typescript`. The run restored both files and
   exited 1. The tests inject a fake refresh, so no real pnpm cache was
   exercised. A real pnpm 10.26 with an empty or partial cache reproduces the
   failure; `--prefer-offline` fetches only the missing metadata and changes
   only the `beebox` importer lines. The server has registry access: the
   deploy already runs `pnpm install` in each box.
2. **The repair question fails the box commit lint.** The bounded repair
   (`beebox/src/core/migration-repair.ts`) quotes the failure in its question.
   The failure names `/home/<user>/` paths, and the card lint refuses a machine
   path. The question stayed uncommitted. Because it changed after the
   migration's output baseline, the next pass's migration commit carried it
   too and failed the same way. A box whose script then succeeded still could
   not commit (`commit-failed`). The question is now written with `~<user>/`,
   and the sweep rewrites an older migration question before it commits.

The repair agent ran once per box (2026-10-20, 4 to 6 turns each). It did not
rerun hourly: an unanswered question returns before any agent attempt.

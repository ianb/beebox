---
title: "Retire the sweep's rewrite of machine paths in old migration questions"
workstream: unattached
activate-on: 2026-11-22
category: code-quality
area: beebox
labels: [migrations]
filed-by: agent
discovered-by: agent
discovered-in: worktree-engine-link-migration-fix — fixing the engine-link-spec-2026-10 rollout
---

`applyMigration` in `beebox/src/core/migration-sweep.ts` calls
`redactMigrationQuestions` (`beebox/src/core/migration-repair.ts`) before each
migration commit. It exists only for migration questions written before
`runBoundedAttempt` redacted machine paths. Those questions blocked every
production box's migration commit in October 2026.

Remove the call and the function when no box holds such a question. The check:
on each production box and on the development machine's boxes, no
`_bookkeeping/questions/Migration_*.question.card` contains `/home/<user>/` or
`/Users/<user>/` (`findAbsoluteMachinePaths` in
`beebox/src/lib/absolute-path-check.ts` returns nothing for each). Keep the
write-time redaction in `runBoundedAttempt`.

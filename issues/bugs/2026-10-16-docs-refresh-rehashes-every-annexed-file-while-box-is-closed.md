---
title: "A docs refresh re-hashes every annexed file through git-annex while the box is closed, so a large box is unreachable for minutes"
workstream: unattached
area: beebox
labels: [annex, migrations]
filed-by: agent
discovered-by: Ian
discovered-in: main session — the boxholder's iOS app showed "Box is closed for docs refresh", 2026-10-16
---

On 2026-10-16 a personal box on the dev host (4.1 GB, 19,896 tracked files,
10,015 of them annexed) was closed for about 10 minutes. The hourly
`box-convergence` schedule ran `bbx engine migrate --sweep --repair`. Its docs
refresh took maintenance at 12:24:42Z, phase `exclusive`. Every request in
that window got `503: Box is closed for docs refresh`. The iOS app showed that
text as its whole page (see Related).

While it was closed, one `git add -A` under the sweep ran for more than 8
minutes in state `U`, fed by `git-annex filter-process`. Two samples 5 seconds
apart showed 0.04 s and 0.08 s of CPU. The filter had an old, unchanged JPEG in
`_bookkeeping/archive/` open, while only 9 small text files were actually
modified. The run then finished without a docs commit, and the box reopened.
The schedule's log for that run was empty at the time, so the outcome (error
or no change) is not confirmed.

## Mechanism

`changedMigrationPaths` (`beebox/src/core/migration-recovery.ts:91-110`):

1. `withTemporaryIndex` copies the real index, which has fresh stat data.
2. `read-tree <snapshot.tree>` replaces every entry. A plain `read-tree`
   discards the cached stat data (verified on a scratch repo: all entries show
   `mtime: 0:0` afterward; with `read-tree -m` none do).
3. `git add -A` must then re-clean every tracked file. For each annexed file,
   git pipes the whole file through `git-annex filter-process`, which hashes it
   and consults the keys database. For this box that is 10,015 files and most
   of 4 GB, all inside the maintenance window.

`captureMigrationSnapshot` (`:49-88`) does not have the problem: it runs
`add -A` on the copied real index before any `read-tree`.

## Fix direction

- Use `read-tree -m <snapshot.tree>` so entries whose content matches keep
  their stat data, or skip the `read-tree` and run `add -A` on the fresh index
  copy, then diff against `snapshot.tree`. Check that the tracked-path
  semantics stay the same (a path tracked in the snapshot but now ignored).
- A doctest on an annexed temp box can assert that `changedMigrationPaths`
  does not invoke the clean filter for unchanged annexed files (count filter
  invocations, or time a box with many annexed files).

## Also worth deciding

- Nothing bounds how long a maintenance holder keeps a box closed. A stalled
  child (here, minutes with almost no CPU) keeps it closed with no alert.
  Consider a time budget with an alert, or at least a log line naming the
  current step (see
  [closed box shows migration progress](../features/2026-10-06-closed-box-shows-migration-progress.md)).
- Whether git-annex itself was slow per file or blocked (the keys database is
  SQLite; the sample showed it open by the filter only). The stack sample was
  attempted too late; the process had exited. If this recurs before the fix,
  `sample <pid>` on the `git-annex filter-process` would answer it.

## Related

- [iOS unreachable box shows a blank screen](2026-09-12-ios-unreachable-box-shows-a-blank-screen.md):
  the same day's symptom on the phone.
- [One-root migration per-file git mv is slow (closed)](../closed/code-quality/2026-09-05-one-root-migration-per-file-git-mv-is-slow.md):
  an earlier case of a large annexed box making a migration slow.

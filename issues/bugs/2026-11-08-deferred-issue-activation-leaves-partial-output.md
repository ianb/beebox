---
title: "A failed deferred-issue activation left its output in main, and every later run failed on that leftover"
workstream: unattached
area: dev-tooling
labels: [schedules, issues]
filed-by: agent
discovered-by: agent
discovered-in: "main session — supplemental-lint land refused on a dirty main, 2026-11-08"
---

On 2026-11-06 the hourly `deferred-issues` schedule activated
`issues/code-quality/2026-10-09-retire-claude-md-box-compat.md` (due that day). It
wrote the activated copy to `issues/code-quality/` and then failed before the
commit. The copy stayed in the main checkout, untracked, and the deferred
original stayed in place. From then on every run failed with
`ActivationDestinationExistsError: activation destination already exists`
(`bin/deferred-issues.ts`, about line 163), and the untracked file made main
dirty, so the supplemental-lint sweep's `bin/land` refused on 2026-11-07. The
leftover was removed by hand on 2026-11-08.

`runActivationTransaction` is meant to restore a clean tree on failure
(`restoreCleanRepository` resets, restores, and deletes untracked `.md`
files). It did not here. The 2026-11-06 run's log was not found, so the first
failure's cause is unknown.

To fix:

- Find why the restore did not remove the activated copy (the failure may have
  come before the transaction, or the restore itself may have failed).
- When the destination exists and is an exact activated copy of the deferred
  source, finish the move (delete the source, commit) instead of failing
  every hour.
- Keep each run's log, so the first failure of a schedule can be read later.

Update 2026-11-08: The leftover came back at the 10:33 local run, and that
run's log shows the cause: `activation changed non-Markdown files:
beebox/src/core/migrations.ts`. Activation rewrites every reference to the
moved issue, and `beebox/src/core/migrations.ts:142` names the deferred path in
a comment. The job refuses changes outside Markdown, and the restore puts
`migrations.ts` back but leaves the activated `.md` copy. Every later run then
fails on the leftover. While that comment points at `issues/deferred/`, the
same thing happens each time the copy is removed. A fix needs either
activation that may rewrite references in code comments, or a restore that
also deletes the new copy and reports the refusal once instead of hourly.

Fixed 2026-11-09 in `bin/deferred-issues.ts`: the restore now unstages before
it lists untracked files, so a staged activated copy is removed. Activation
also accepts a non-Markdown change when the file differs from HEAD only by the
moved issues' repo-relative paths, as the `migrations.ts` comment does; any
other non-Markdown change is still refused.

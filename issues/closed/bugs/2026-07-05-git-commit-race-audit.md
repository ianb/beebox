---
title: "git commit race audit"
workstream: unknown
resolution: implemented
---

**Closed 2026-07-09:** audit found 33 sites; all in-scope sites converted to
`stageAndCommitPaths` (promoted from clerk.ts into `lib/git.ts`, c1e65a22) —
non-connector sweep in f438f54b, telegram in 5c93f7a9, gmail/drive/calendar
(incl. the directory-staging rework in google-calendar.ts) in 5dcd611e.
Per-site decision was commitPaths everywhere; no process-wide mutex needed
(cross-process same-path commits remain on the index-lock retry, recorded as
deliberate). Plan: `beebox/docs/implemented-plans/architectural-review-followups.md`
Track 2.

Deferred from Track H (plan `docs/implemented-plans/architectural-review.md`): a card
mutation's `stageFiles` + `commit` are two non-atomic git ops sharing one
`.git/index.lock`. Two mutations on *different* files (so `withCardLock`
doesn't serialize them) can interleave staging into the shared index and get
co-committed under the wrong attribution, or race two `git commit`s
(currently retried once on lock collision by `cli/lib/git.ts`).

Known exposed sites (from the Track H audit): todos, scheduler, admin,
answer, telegram webhook (two commits), plus every connector sync. The model
fix is `clerk.ts`'s pattern — `commitPaths` (scoped commit) +
`isNothingToCommitError` tolerance. The audit should decide per-site between
commitPaths adoption and a process-wide git mutex.

# Audit git stage→commit races across mutation sites

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

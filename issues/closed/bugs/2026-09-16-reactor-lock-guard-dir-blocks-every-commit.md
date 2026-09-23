---
title: "The reactor lock's guard directory fails the box-root vocabulary check, so no commit succeeds while a reactor runs"
workstream: card-self-refs
area: beebox
filed-by: agent
discovered-by: agent
discovered-in: main — production box feedback triage (bbx feedback)
resolution: implemented
---

> **Closed** — `d8233fd4c` took the derived option: `src/lib/lock-guard.ts`
> exports `lockGuardPath`/`LOCK_GUARD_SUFFIX`, and
> `box-root-vocabulary.ts`'s `isBoxRootVocabularyName` accepts
> `<listed .lock name>.guard` for every tooling entry, covering future locks
> too. No `.gitignore` change: the guard directory is always empty
> (proper-lockfile only `mkdir`s and `utimes` it), and git does not track
> empty directories, so the pattern gap named above has no effect.

While a reactor holds its lock, every commit in the box fails pre-commit.
This includes `bbx finish`, which a reactor job must run to complete.

The error is `Box root: .bbx-reactor.lock.guard: the box root is a closed vocabulary`.

## Cause

- `beebox/src/lib/file-lock.ts` takes a lock by `mkdir` of `<path>.guard`.
  The guard directory exists for the full life of the lock.
- `beebox/src/lib/box-root-vocabulary.ts:55` lists `.bbx-reactor.lock`
  but not `.bbx-reactor.lock.guard`.
- The box `.gitignore` pattern `.bbx-*.lock` does not match the guard
  directory either.

The same failure class hit `.bbx-maps-ignore` on 2026-09-05 (commit
`f036c06b3`).

## Evidence

Box agents on one production box filed this five times (2026-09-05, 09-14 twice,
09-15 twice). One agent removed a stale guard by hand after a reactor
process died, to unblock its commit. Others could not commit their job's work.

## Open question

Add the one name, or derive `<name>.guard` for every tooling entry in the
vocabulary so a future lock does not repeat this. The second option also
covers locks added later.

---
title: "file-lock: empty-file publication window lets two holders acquire the same lock"
needs: [design]
area: callback-box
filed-by: agent
discovered-in: worktree-open-source-readiness — Codex review of the overnight security fixes
---

**HIGH. Found by a Codex cross-model review (2026-07-21), verified against
source.** This is a pre-existing defect in the cross-process lock primitive,
surfaced because the mobile device-store fix
([mobile-device-store-unlocked-rmw](../closed/bugs/2026-07-17-mobile-device-store-unlocked-rmw.md))
now leans on it for a security-critical revoke. It undermines that fix's
premise.

`writeExclusive()` (`src/lib/file-lock.ts:216`) does `fs.open(path, "wx")`
and *then* asynchronously writes the holder JSON (`:226`). Between the open
and the write the lock file exists but is **empty**. A contender in that
window calls `readHolder()` (`:194`), which treats empty/whitespace content
as "no holder" (`:204` returns null), then `acquireLock` reclaims it —
`unlinkIgnoringMissing` at `:261` deletes the winner's lock and
`writeExclusive` at `:262` succeeds. **Both callers now believe they hold
the lock.**

Exploit sequence (the revoke-loss the device-store fix was supposed to
prevent):

1. A compromised device floods bearer-auth requests.
2. Verifier V creates the empty lock file (open, pre-write).
3. Revoker R reads it empty, deletes it, acquires its own.
4. Both read the un-revoked store.
5. R writes `revokedAt`.
6. V writes its stale copy (only `lastUsedAt`) — **restoring the revoked
   device.**

In-process contention is worse: holder identity is only PID/host/boot-epoch,
so `releaseLock()` (`:277`) can delete a co-PID holder's lock. The added
concurrency doctest passes because it never forces the empty-file window.

Fix direction (needs care — `file-lock.ts` backs *every* cross-process lock,
incl. `local-users.ts` auth): make acquisition atomic against its own
content — e.g. write the holder JSON to a temp file then `link()`/`rename()`
it into place with O_EXCL semantics so the lock file is never observably
empty; and/or give holders a random token so a reclaim can't delete a live
foreign holder. Regression test must force the open-before-write gap.
Codex's stated single-most-important pre-publication fix.

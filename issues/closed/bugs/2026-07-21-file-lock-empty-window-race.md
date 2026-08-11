---
title: "file-lock: cross-process reclaim/release can let two holders acquire the same lock"
workstream: open-source-readiness
area: callback-box
filed-by: agent
discovered-in: worktree-open-source-readiness — Codex review of the overnight security fixes
labels: [soft-launch]
resolution: implemented
---

**CLOSED 2026-07-21 — resolved via proper-lockfile (commit `7cf6a9c5`), with
one residual accepted by boxholder decision.** The two *reachable* races are
gone: the empty-file publication window and the unconditional-unlink
reclaim/release race (the first two Codex verdicts) — both were hittable by
ordinary concurrent contention (a device flooding requests) and both are now
impossible, because exclusion is proper-lockfile's atomic guard-dir `mkdir`
and there is no hand-rolled unlink-by-path anywhere.

**Accepted residual (boxholder call, 2026-07-21): the lease-steal race.** A
third Codex pass (verdict HOLE) found the limitation inherent to *every*
lease/staleness-based lock (proper-lockfile's own README documents it): if a
holder pauses **>5 min mid-critical-section**, a contender can steal the
stale lock and the original holder can then silently delete the new holder's
guard. Boxholder: *"we're overengineering something that's probably not going
to fail this badly."* Accepted because reachability is near-nil for the
security-critical caller — the device-store RMW is **synchronous and
sub-millisecond** (no `await` between acquire and release, verified at
`pairing.ts:198`), so triggering it needs the process suspended >5 min in a
microsecond window: it does not happen on the Linux deploy path (no
mid-syscall hibernation) and is astronomically unlikely on macOS dev (which
isn't the security boundary). Unlike the first two holes, it cannot be
reached by request flooding. The stricter fixes considered and declined as
over-engineering: fencing-token CAS on the device-store write; switching to
`flock` (native addon). Documented as an accepted limitation in
`callback-box/docs/todo-security.md` for the SECURITY.md security report.

---

## Original investigation (kept for the record)

**Two prior Codex verdicts were HOLE**; the reimplementation history below is
why the primitive is now proper-lockfile-backed rather than hand-rolled.

**What the first fix got right (keep):** `writeLockAtomic` writes the holder
JSON to a temp sibling then hard-`link()`s it onto the path — the lock name
is never observably empty, and `link` gives single-winner O_EXCL against
concurrent *fresh* creators. That part is sound.

**Where the race moved — the reclaim/release `unlink()` is unconditional
(verified against source):**

- `acquireLock` (`src/lib/file-lock.ts:296-298`): after an `EEXIST` and a
  stale read that says dead/absent, it does an **unconditional**
  `unlinkIgnoringMissing(path)` (297) then re-links (298). Interleaving, no
  dead process required: A holds → B and C both `link`→EEXIST → A releases
  (unlinks) → B reads null, links its lock, returns holding → **C, on its
  stale null read, unlinks B's live lock** (297) and links its own. Both
  hold. The missing invariant: *the path may be deleted only if it still
  refers to the exact holder that was inspected.*
- Same stale-delete defect in `inspectLock` (`:337`) and `scanLocks`
  (`:382`) — inspect a dead/malformed inode, pause, then unlink a
  newly-published live holder.
- `releaseLock` (`:325-330`): reads token (325), checks match (329), unlinks
  (330) — the unlink is **not** conditional on the token still being present.
  A reclaim between 329 and 330 (or a `forceAcquireLock`) means the unlink
  deletes the *new* holder. `readHolder` also turns every read error (not
  just ENOENT) into `null` (`:222`), so a transient IO/permission error can
  authorize deleting a live lock.

The device store hits this directly (`pairing.ts:198-218` acquire/release
around the RMW) — two hub/serve processes reclaiming a crash-stale lock can
overlap and lose the revoke, the exact security property the device-store
fix depended on. The current doctests pass trivially: the 40-way test keeps
the winner alive so losers never exercise 296-299; the "never empty" test
only reads *after* acquire completes.

**Fix directions (this is now a `needs: decision`, not a one-shot):**

1. **Redesign reclaim + release around atomic `rename()` as the single
   serialization point** — never unconditional-unlink-by-path. To reclaim a
   confirmed-dead lock, `rename(path → quarantine.<token>)`: exactly one
   racer's rename finds the source present (the other gets ENOENT and retries
   from the top), so the specific inode is claimed atomically; then link the
   fresh lock into the now-absent path (EEXIST → a fresh acquirer beat us,
   retry). Release renames-then-verifies-token rather than reads-then-unlinks.
   Harder to get exactly right — must go through a **fix → Codex re-verify
   loop**, not another blind attempt.
2. **Adopt a proven primitive.** `proper-lockfile` (mtime-freshness staleness,
   no unlink-then-recreate reclaim race) or an OS `flock`/`fcntl` advisory
   lock (kernel-atomic, auto-releases on process death — sidesteps manual
   liveness detection and reclaim entirely). NOTE: this collides with a
   standing `code-style.md`/CLAUDE.md decision ("don't roll your own with
   `proper-lockfile`; use `file-lock.ts`") — that decision predates knowing
   this primitive has a reclaim race, so it's worth the boxholder revisiting.

**The real recommendation:** a hand-rolled correct cross-process lock is a
known-hard problem, and this one has failed adversarial review twice. Rather
than a third blind fix attempt, this wants either (2) a proven primitive, or
(1) a deliberate rename-based redesign driven through a Codex verify loop —
boxholder's call on which, because it touches a standing style decision and
is the #1 pre-publication blocker (the security-critical device-store revoke
depends on it). Pre-existing liveness caveats also remain (PID reuse in-boot;
>30s wall-clock shifts vs the boot-epoch heuristic; hostname change) — lower
stakes, but a proven primitive would retire those too.

---

## Implementation (proper-lockfile) — 2026-07-21, awaiting Codex re-review

Took fix direction (2): replaced `file-lock.ts`'s home-grown internals with
**`proper-lockfile`** (pure-JS, no native addon — chosen over `flock` to avoid a
node-gyp rebuild liability), preserving the public API
(`acquireLock`/`releaseLock`/`inspectLock`/`forceAcquireLock`/`scanLocks`,
`LockHeldError`). Callers (`pairing.ts`, `local-users.ts`, `transient-state.ts`,
`schedule/state.ts`, `reactor/engine.ts`, `search/refresh.ts`,
`push-subscriptions.ts`, `question-transition.ts`) are unchanged.

**The new exclusion invariant.** Mutual exclusion is now entirely
`proper-lockfile`'s atomic `mkdir` of a *guard directory* (`<path>.guard`):
`mkdir` fails `EEXIST` if it already exists, so at most one process holds the
lock. There is **no unconditional unlink-by-path anywhere** — the reclaim/release
race is gone because reclaim is `proper-lockfile`'s mtime compare-and-swap, not a
read-then-unlink-then-recreate. A **diagnostic sidecar file** at `<path>`
(`{pid, hostname, acquiredAt, metadata}`) is written *after* the guard `mkdir`
wins and is read *only* for diagnostics (`LockHeldError.holder`, `inspectLock`,
`scanLocks`); it never participates in the acquire decision, so no sidecar state
(empty, missing, torn, stale, concurrently rewritten) can admit a second holder.
Every on-disk deletion happens either via `proper-lockfile`'s own `release`
(verifies ownership, cancels refresh timer, removes guard dir) or via
`scanLocks`'s reclaim, which removes a dead holder's sidecar+guard *only while
atomically holding the lock*. The one deliberate foreign-guard eviction is
`forceAcquireLock` (documented; no production callers).

**Stale / onCompromised / sleep decisions.**
- `stale = 5 min`. While a holder is alive, `proper-lockfile` refreshes the guard
  mtime every `stale/2` (2.5 min), so a live lock stays fresh for an unbounded
  hold — hold duration need not fit under `stale`. 5 min sits under `cb tick`'s
  10-min per-script SIGKILL timeout, so a wedged run's lock always clears before
  the run is force-killed.
- `onCompromised` logs LOUDLY (`console.error`) and drops the in-process release
  entry; it does NOT throw (the default handler throws → unhandled rejection).
- **macOS-sleep tradeoff (called out for scrutiny):** `proper-lockfile`'s refresh
  is a `setTimeout`, paused during system sleep. A sleep longer than `stale` can
  make a live-but-sleeping holder's guard look stale and be stolen. The 5-min
  threshold means a *normal brief* sleep does not false-trigger; a longer sleep
  can, but the victim's `onCompromised` fires loudly, so it is observable, never
  silent (unlike the old silent double-acquire). Callers with short acquire
  budgets (pairing/local-users/transient-state retry ~5 s) fail *loud* against a
  crashed holder rather than block the full 5 min — a thrown lock error, never a
  silent lost update.

**Diagnostic surface changes.** `LockHolder` dropped the `bootEpochSeconds` and
`token` fields (liveness is now `proper-lockfile`'s job); it keeps
`{pid, hostname, acquiredAt, metadata}` — the only fields any caller reads
(`schedule/state.ts` uses `holder.pid`/`acquiredAt`/`metadata`; `LockHeldError`
uses `holder.pid`). `inspectLock` no longer deletes dead locks (it uses
`.check()`, side-effect-free; it had no production callers) — dead-lock cleanup
lives in `scanLocks` and on the next `acquireLock`. When a lock is held but its
sidecar is momentarily unwritten/torn, diagnostics report a stand-in holder
(`pid: -1`) rather than "free".

**For the Codex re-review to scrutinize:**
1. `proper-lockfile`'s release removes the guard dir based on its in-memory
   registry without re-verifying mtime ownership at release time — so a lock
   stolen from us during a >`stale` sleep, then released by us, could rmdir the
   thief's guard (the thief's `onCompromised` then fires loudly). This is the
   narrowed, loud residual of the sleep tradeoff; is it acceptable?
2. `scanLocks`/reclaim briefly holds the guard while cleaning a dead/free entry,
   which can hand a concurrent acquirer a spurious `ELOCKED` for that entry.
   Acceptable? (Only when the entry was already dead/free; all callers treat
   `LockHeldError` as non-fatal.)
3. The sidecar-vs-guard split and the `unknownHolder()` fallback.
4. `stale = 5 min` vs the callers' ~5 s retry budgets (fail-loud on crashed
   holder).

---

## Original report (first Codex round — the empty-window, now fixed)

**HIGH. Found by a Codex cross-model review (2026-07-21), verified against
source.** This is a pre-existing defect in the cross-process lock primitive,
surfaced because the mobile device-store fix
([mobile-device-store-unlocked-rmw](2026-07-17-mobile-device-store-unlocked-rmw.md))
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

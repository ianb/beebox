---
title: "file-lock: cross-process reclaim/release can let two holders acquire the same lock"
needs: [design, decision]
area: callback-box
filed-by: agent
discovered-in: worktree-open-source-readiness — Codex review of the overnight security fixes
---

**REOPENED 2026-07-21 — the first fix closed the empty-window but MOVED the
race; the primitive still isn't mutually exclusive.** A second Codex
adversarial review (targeted at this file, verdict HOLE) found it, verified
against source. This has now failed adversarial review **twice**, which is
itself the signal (see "The real recommendation" below).

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

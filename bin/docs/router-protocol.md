# Router concurrency protocol

`bin/router.ts` supervises a lazily-spawned vite+fastify pair per worktree,
racing HTTP requests, idle timers, child-process exits, and explicit
stop/retry actions against each other over a single in-memory `worktrees`
map. Six of its last twenty commits (as of the 2026-07 architectural review)
were concurrency fixes to this same comment-guarded machinery — the bugs are
subtle, non-obvious from the code shape alone, and easy to reintroduce by a
well-intentioned refactor. This doc promotes the six incident-derived
invariants out of inline comments (where they're easy to read past) into one
place that anyone touching worktree lifecycle code should read first. Each
invariant still has a pointing comment at its code site — this doc explains
*why*; the code comment marks *where*.

The lifecycle state model these invariants operate over was formalized (Phase 2,
2026-07-11): the worktree state machine — a stable per-generation
`WorktreeHandle` shell, an immutable `WorktreeLifecycle` discriminated union
(`starting`/`ready`/`stopping`/`failed`), a `LEGAL_TRANSITIONS` table, and the
guarded `transitionLifecycle` setter — lives in `bin/router-lifecycle.ts`
(pure, zero-I/O, unit-testable). `router.ts` owns the effects and drives the
transitions; the pidfile store (invariant #6) lives in `bin/router-pidfile.ts`.
`worktrees.get(name) === handle` is the single cross-generation guard, and
because the handle is never replaced through its lifecycle it now works
uniformly *during* startup, not only after ready.

If you're about to change `ensureRunning`, `startWorktree`, `stopWorktree`,
`onChildExit`, the pidfile store (`router-pidfile.ts`), the lifecycle
transitions (`router-lifecycle.ts`), or the PID-file/`worktrees`-map shapes:
read this first.

## 1. The pidfile is single-slot — never delete a newer generation's

**Where:** `createPidStore` in `bin/router-pidfile.ts`.

Each worktree's pidfile (`~/.cache/callback-box/pids/<name>.json`) holds only
the *current* generation's PIDs — there's no history. A teardown racing a
fresh start must not delete a pidfile that a newer generation has already
written, or that generation becomes invisible to the startup sweep (an
untracked orphan if the router later dies before a clean shutdown).

**Fix shape:** generation-aware callers pass `expect: { vitePid, fastifyPid }`;
`remove` reads the on-disk record first and skips the unlink if the PIDs don't
match what the caller thinks it's tearing down. Generation-agnostic callers
(full router shutdown) omit `expect` and always unlink.

**Correction (2026-07-11): the pid-match check alone was NOT sufficient.** Read
the record, then unlink, are two separate awaits — so a newer generation's
`write` could land *between* a stale `remove`'s read and its unlink and still be
clobbered (the record matched at read time, then got overwritten, then the
unlink deleted the new record anyway). The generation guard closes the window
only when combined with the per-name serialization of invariant #6; on its own
it is itself TOCTOU. The store now enforces both together.

## 2. Registering a worktree's start must be atomic — no `await` between check and set

**Where:** `ensureRunning` in `bin/router-core.ts` (moved here from `router.ts`
in Phase B, 2026-07-11).

`ensureRunning` checks the `worktrees` map, and if the worktree isn't already
running or starting, registers a `"starting"` placeholder and kicks off
`startWorktree`. If there is *any* `await` between reading the map and writing
the placeholder back, two near-simultaneous cold requests for the same
worktree both observe an empty map, both call `startWorktree`, and each spawns
a full vite+fastify pair — a leaked generation (the loser's pair stays alive,
unreferenced, until its eventual exit is swallowed by invariant #4's
replaced-generation guard).

**Fix shape:** the placeholder object and its `startPromise` are constructed
and written into the map in the same synchronous stretch of code, with
`startWorktree` itself (not `ensureRunning`) responsible for the worktree
lookup/404 check that used to happen — and `await` — before registration.

## 3. Swallow the execa child-process promise immediately at spawn time

**Where:** `startWorktree` in `bin/router-core.ts` (moved here from
`router.ts` in Phase B, 2026-07-11), on both the `fastify` and `vite`
`execa()` results.

`execa()` returns a promise that rejects when the child exits non-zero — a
router routinely killing children on idle-shutdown or generation replacement
means that promise is *expected* to reject, often minutes after the call site
that would naturally `catch` it has already returned. An un-caught rejection
surfaces later as an `unhandledRejection` and crashes the whole router process
— every worktree, not just the one whose child exited. This was a real
incident (fixed 2026-06-04).

**Fix shape:** attach a no-op `.catch()` to the execa promise at the same
place it's created — never later, and never only on the success path — so the
rejection is handled the instant Node would otherwise flag it. Actual exit
handling (killing the sibling process, updating `worktrees` state, removing
the pidfile) happens via the separate `.on("exit", …)` event, not through this
promise.

## 4. A teardown must verify the exiting child still belongs to the map's current entry

**Where:** `onChildExit` in `bin/router-core.ts` (moved here from `router.ts`
in Phase B, 2026-07-11).

Fastify drains open browser sockets for up to ~10s after `SIGTERM` before its
process actually exits. By the time that delayed `exit` event fires, a
reconnecting client has often already triggered a fresh generation for the
same worktree name. Tearing down "by name" — i.e. trusting that an exit event
for `name` means *the current* entry for `name` should die — kills the *new*
generation instead of the old one. The client then restarts it, which
eventually exits too (draining for another ~10s), restarting the cycle: a
self-sustaining restart storm with a fresh vite port every iteration (the
2026-06-09 "main restarts every 10s" incident).

**Fix shape:** every exit/teardown handler compares the entry object identity
(`worktrees.get(name) === exited`), not just the name — a stale exit from a
replaced generation reduces to a log line instead of tearing down the live
entry. The same identity-check discipline applies to `stopWorktree`, which
drops its own map entry before any `await` for exactly this reason (see its
comment).

## 5. A completed startup must re-check it's still the current generation before publishing

**Where:** `startWorktree`'s terminal sites in `bin/router-core.ts` (moved
here from `router.ts` in Phase B, 2026-07-11; the `ready` and `failed`
transitions), guarded by `worktrees.get(name) === handle`.

A cold start runs for seconds (spawn → dashboard → `waitForHttp`, up to 30s).
During that window the generation it belongs to can be superseded: a
`/__router/stop/<name>` unlinks the handle from the map, and a later request may
register a fresh generation in its place. If the slow start then publishes its
terminal state *unconditionally*, two incidents follow: (a) a stop issued during
a cold start doesn't actually stop it — the children come up and the completed
start silently **resurrects** the map entry the user asked to remove; (b) a slow
startup *failure* (stuck in `waitForHttp`'s loop) overwrites a newer generation
with a stale `failed` record, clobbering it.

**Fix shape:** every asynchronous startup completion re-checks
`worktrees.get(name) === handle` before it transitions to `ready`/`failed`. If
the handle is no longer the map's current generation, the start is superseded:
it kills its own spawned children (its handle's PIDs), removes its own pidfile
(via the serialized store, #6), transitions its (detached) handle to `stopping`,
and resolves **without publishing** — it never reappears in the map. With the
stable-shell model this is one identity check at each terminal site, because the
handle registered by `ensureRunning` in `starting` is the *same object* the
terminal transitions flip in place; there is no map-replacement step that could
outrace the guard.

**Correction (2026-07-11, cross-phase review): the failure catch's SCOPE was
not wide enough.** Only `waitForHttp`'s own `try`/`catch` reached this guarded
check — a rejection from the dashboard-start spawn or `pidStore.write`, both of
which run *after* both children are spawned but *before* that `try`, bypassed
it entirely: neither child got killed, no pidfile cleanup ran, and no terminal
transition happened, leaking both processes. The fix widens the `try` to cover
dashboard-start through `waitForHttp` as one region sharing the same catch (a
`failurePhase` variable tracks which stage failed, for the captured-error
page), so every completion path — not just the readiness probes — now reaches
this guard.

(A separate, legitimate restart still happens when a *live*
HTTP request is mid-flight: `proxyWithRetry` re-runs `ensureRunning` against a
non-ready handle and cold-starts a fresh generation — that's the request
re-establishing intent, not the superseded start resurrecting itself.)

## 6. Pidfile write/remove must be serialized per name

**Where:** `createPidStore` in `bin/router-pidfile.ts`.

Invariant #1's generation guard (`remove` reads the record, compares PIDs, then
unlinks) is itself TOCTOU across its own awaits: generation N+1's `write` can
land between N's read and N's unlink, so N sees a matching record, then N+1
overwrites it, then N's unlink deletes N+1's fresh record — the exact loss the
guard was meant to prevent.

**Fix shape:** `write` and `remove` for a given worktree name run through a
small in-process promise chain (a `Map<name, Promise>` tail, the `withCardLock`
pattern — bin/ can't import callback-box internals, so it's restated locally),
so a `remove`'s read+unlink is atomic relative to any `write` for the same name.
Every current-generation pidfile op — `startWorktree` (write + failure/self-clean
remove), `stopWorktree`, `onChildExit`, and full-router `shutdown` — routes
through the store. `sweepStaleChildren` touches pidfiles directly, but only at
boot, before the server listens, so no worktree op can race it.

## Fifth candidate that stays OUT of the state machine: proxy-retry body replay

**Where:** `proxyWithRetry` / `proxyOnce` / `replayableBodyLength` in
`bin/router.ts`.

Proxying consumes the request's body stream, so a naive retry after a transient
upstream error (`ECONNREFUSED`/`ECONNRESET`/`EPIPE` — a cold or just-killed port)
would re-send the request with an empty body, wedging an upstream that waits
forever for JSON that never arrives (a real "wedged chat" incident, a POST that
raced an idle shutdown). The fix buffers a request's body up front when it's
small and of known length (`content-length` ≤ 1 MiB), and replays that buffer on
each attempt; larger or unknown-length bodies get exactly one attempt.
Superseded starts (#5) surface here too: `ensureRunning` may resolve to a
non-ready handle, which `proxyWithRetry` treats as a transient upstream and
retries against the fresh generation.

This is a request-level concern (buffering + retry loop around a single logical
request), not part of the worktree lifecycle state machine, and it is
deliberately left as-is — described here for completeness, not formalized. It
does not read or write `worktrees`-map state beyond the `ensureRunning`
handshake every request already performs.

## Related but separate: orphan sweeping

Two more mechanisms guard against leaked processes but aren't part of the
same race-condition family above — they clean up *after* a crash rather than
preventing a race during normal operation: `sweepStaleChildren` (kills PIDs
recorded in stale pidfiles at router startup) and `reclaimOrphans` in
`bin/process-cleanup.ts` (pattern-matches vite/fastify/agent-browser processes
pidfiles can't see, e.g. from an older router generation). See the comments at
their call sites in the boot sequence at the bottom of `router.ts`.

## Status: state machine formalized + effects-injected + tested (2026-07-11)

Phase 1 (2026-07-09) was the conservative doc-browser extraction
(`bin/router-docs.ts`) plus the first write-up of invariants #1–#4 — pure code
motion, no state-machine change. Phase 2 (2026-07-11,
`callback-box/docs/plans/router-state-formalization.md`) then did the fuller
option from `issues/decisions/2026-07-06-architectural-review-open-decisions.md`
(item 1), in three sub-phases:

- **A** — the formal lifecycle (`bin/router-lifecycle.ts`) and the two live-race
  fixes it uncovered: invariant #5 (guarded publication) and #6 (pidfile
  serialization), which the earlier four-invariant framing didn't cover.
- **B** — the lifecycle engine moved into `bin/router-core.ts`
  (`createRouterCore(effects, config)`), driven by an injected `RouterEffects`
  surface (spawn / killGroup / waitForHttp / timers / clock / pidfile store /
  hub-config / getPort / resolution); `router.ts` builds the real effects and
  runs boot + signal handlers in an import-safe `main()`.
- **C** — incident tests with deterministic fakes.

**Each invariant now has a test** (proven non-vacuous by neutering):

- #1/#6 (single-slot + per-name serialization) → `bin/router-core.test.ts`
  "pidfile serialization…" (barrier-gated fs backend on `createPidStore`).
- #2 (atomic registration / dedupe) → "dedupe…" and "404 corollary…".
- #3 (swallow at spawn time) → "rejection discipline…".
- #4 (identity-checked teardown) → "stale exit…". NOTE: in the stable-shell
  model this safety is *doubly* enforced — `onChildExit` operates on the passed
  handle and checks both identity AND phase — so the identity `if` alone is not
  solely load-bearing; the test guards the historically dangerous regression
  (name-based teardown, the 2026-06-09 storm), which is the load-bearing failure.
- #5 (guarded publication) → "stop-during-start…" and "stale failure…". NOTE:
  the failure-path clobber-prevention is now *structural* (the terminal
  transitions the detached handle in place and never re-sets the map); the
  runtime guard's uniquely-observable job is routing a superseded failure to
  `stopping` (self-clean) vs `failed`, which the #5b test asserts.
- transition table + stable-shell identity → `bin/router-lifecycle.test.ts`.

**Cross-phase review fixes (2026-07-11):** the phased reviews each looked at
one sub-phase in isolation; a follow-up whole-composition pass found two gaps
only visible across all three:

- Invariant #5's guarded-publication catch didn't cover the whole cold-start
  region — see the Correction under invariant #5 above. Covered by
  "pidStore.write failure…" in `bin/router-core.test.ts`.
- `stopAllChildren()` (full-router shutdown) killed only `ready`/`stopping`
  generations' children; an in-flight `starting` generation has no PIDs on its
  handle yet, so it was neither unlinked nor awaited and could finish spawning
  *after* shutdown's teardown, orphaning a fresh vite+fastify pair. Fixed by
  having `stopAllChildren` unlink any `starting` handle (superseding it, so
  invariant #5's own guard makes it self-clean) and await its settlement;
  `router.ts`'s `shutdown()` also now closes the HTTP server *before* draining
  children, so no new request can trigger a fresh `ensureRunning()` during the
  drain. Covered by "shutdown supersedes an in-flight start…" in
  `bin/router-core.test.ts`.

Deliberate non-goals recorded at close-out: status accuracy for the in-flight
`stopping` phase (handles are unlinked before the transition, so it's never
observed on the map); formalizing the proxy-retry body-replay machinery (it
stays a request-level concern, see its section above); and the name-scoped
dashboard-socket hazard a superseded self-clean can trip
(`issues/bugs/2026-07-11-router-superseded-selfclean-kills-replacement-dashboard.md`).

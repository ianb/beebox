---
title: "Router Phase 2 — WorktreeState Formalization"
status: implemented
workstream: unknown
issues: []
---
# Router Phase 2 — WorktreeState Formalization

The "fuller option" from the architectural review's router item
(`issues/decisions/2026-07-06-architectural-review-open-decisions.md` item 1,
boxholder: do it in phases): a formal worktree lifecycle with a transition
function, injected effects (clock/spawner/fs), and unit tests with fakes that
reproduce the documented incidents (`bin/docs/router-protocol.md`). Phase 1
(the conservative doc-browser extraction + protocol doc) landed 2026-07-09.

> **STATUS: IMPLEMENTED (Phases A+B+C landed 2026-07-11).** Codex-reviewed at
> each phase. Phase A shipped `bin/router-lifecycle.ts` + `bin/router-pidfile.ts`,
> adopted them in `router.ts`, and landed invariants #5 (guarded publication) and
> #6 (pidfile serialization). Phase B split the lifecycle engine into
> `bin/router-core.ts` (`createRouterCore(effects, config)`) driven by an injected
> `RouterEffects` surface, with `router.ts` building the real effects and running
> boot + signal handlers in an import-safe `main()`. Phase C added the incident
> tests (`bin/router-core.test.ts`, `bin/router-lifecycle.test.ts`) with
> deterministic fakes, each proven non-vacuous by neutering. B+C codex review
> reproduced two honesty findings (below). Verified: typecheck clean, 60 tests
> green, isolated-router smoke on the real effects path (cold→ready→proxy,
> unexpected-exit teardown, explicit stop, idle stop, stop-during-start, 404/
> no-phantom).
>
> **Deliberately left (recorded non-goals):** (1) *stale-exit safety is doubly
> enforced* in the stable-handle model — onChildExit operates on the passed
> handle and checks both identity AND phase, so the identity line alone is not
> solely load-bearing; the incident test guards against the historically
> dangerous regression (name-based teardown, the 2026-06-09 bug), not the
> identity `if` in isolation. (2) *Invariant #5's failure-path clobber-prevention
> is now structural* — the failure terminal transitions the detached handle in
> place and never re-sets the map, so a stale `failed` cannot overwrite a newer
> generation regardless of the runtime guard; the guard's remaining
> uniquely-observable job is routing a superseded failure to `stopping`
> (self-clean) vs `failed`, which the #5b test asserts. (3) *stopping-phase
> status accuracy* (handles are unlinked before the transition, so `stopping` is
> never observed on the map). (4) *proxy-retry body-replay* stays a request-level
> concern, untouched. (5) The name-scoped dashboard-socket hazard a superseded
> self-clean can trip is filed as `issues/bugs/2026-07-11-router-superseded-
> selfclean-kills-replacement-dashboard.md` (pre-existing class, low severity).

Scoping record (2026-07-11): `bin/router.ts` is 1407 lines post-extraction.
It is a **script, not a module**: zero exports; a top-level async boot IIFE
(:1380-1407) that acquires the router pidfile, sweeps orphans, and
(eventually, after several awaits) binds the port; signal handlers installed
**synchronously at import** (:1341-1346, before the IIFE's first await);
module-level singletons (`worktrees` map :318, `server`, `proxy`,
`shuttingDown`); lifecycle functions `let`-bound for later monkey-patching
(:1371-1376). Map-centric lifecycle logic runs roughly from the `EntryState`
declaration (:263) through `sleep()` (:745); HTTP/WS plumbing ~38%;
boot/shutdown ~20%.

## Corrected identity model (codex findings 2-3)

Today's code does NOT mutate one entry through its lifecycle: `ensureRunning`
installs a `"starting"` placeholder (:348-354), and `startWorktree`
REPLACES it with a brand-new object at both the failed (:592) and ready
(:605-622) paths. The generation token invariant #4 actually compares is the
*ready* entry captured when exit listeners attach (:626-633, checked at
:650-652) — not the placeholder.

The formalization adopts the **stable-shell design**:

```ts
interface WorktreeHandle {                 // ONE object per generation,
  readonly name: string;                   // created in ensureRunning,
  readonly startedAt: number;              // NEVER replaced or copied
  lifecycle: WorktreeLifecycle;            // immutable union, swapped whole
}
type WorktreeLifecycle =                    // a true discriminated union;
  | { phase: "starting"; startPromise: … } // each variant carries exactly
  | { phase: "ready"; vite; fastify; … }   // its legal fields
  | { phase: "stopping"; reason: "exited" | "requested"; … }
  | { phase: "failed"; lastError: CapturedError };
```

- **Identity lives on the handle** (`worktrees.get(name) === handle`); the
  union value is replaced immutably via
  `transitionLifecycle(handle, nextVariant)` (a guarded setter taking the
  COMPLETE destination variant, not a phase string — you cannot enter
  `ready` without supplying children/ports). This resolves the
  mutation-vs-union typing tension without casts: TS types the union
  honestly; reference identity is the shell's job. The transition table
  (`LEGAL_TRANSITIONS`) + `invariant()` guard mirror
  `beebox/src/core/chat/session/lifecycle.ts`.
- This IS a semantic change from today's replace-the-object flow (the
  placeholder and ready entry become one object). The exit-listener /
  stale-teardown guards compare handles; a new generation = a new handle,
  so cross-generation safety is preserved and becomes *more* uniform (the
  same handle check works during startup, not just after ready).
- `stopping` carries an explicit `reason` (codex finding 12): `"exited"`
  (unexpected child exit → sibling kill + detached cleanup, today's
  `"dead"`) vs `"requested"` (explicit/idle stop → awaited cleanup). The
  awaited-vs-detached cleanup contracts stay exactly as they are; the
  retry endpoint relies on `stopWorktree` completion.
- Map-visibility semantics unchanged: `stopWorktree` still unlinks the
  handle from the map before its first await; absent = cold. Status
  accuracy for in-flight teardown stays a recorded non-goal.

## New invariants (live bugs found by the plan review — MUST fix)

**#5 — Guarded publication.** `startWorktree` currently publishes its
terminal state unconditionally (`worktrees.set` at :592 failed, :622 ready).
Consequences, verified by trace: `/__router/stop/<name>` during a cold start
does not stop it — children spawn anyway and the completed start silently
resurrects the map entry, clobbering whatever generation replaced it; a
slow startup *failure* (stuck in `waitForHttp`'s 30s loop) can likewise
overwrite a newer generation with a stale `failed` record. Fix: every
asynchronous startup completion re-checks `worktrees.get(name) === handle`
before transitioning to `ready`/`failed`; a superseded start instead kills
its own spawned children (its handle's pids), removes its own pidfile
(guarded, see #6), and resolves without publishing. With the stable shell,
this check is one line at each terminal site.

**#6 — Pidfile serialization.** `removePidFile`'s generation guard
(:196-208) is itself TOCTOU: read-compare then unlink are separate awaits,
so generation N+1's `writePidFile` can land between N's read and N's unlink
and still lose its record. Fix: serialize pidfile write/remove per name
through a small in-process Map-of-promises chain in the pidfile module
(the `withCardLock` pattern, local to bin/ — bin can't import beebox
internals), so a remove's read+unlink is atomic relative to writes. The
protocol doc's §1 gets corrected (it currently claims the pid-match check
suffices).

Both get incident-style tests (Phase C) proven non-vacuous by neutering.

## Hard constraints (from the incident history)

1. **The execa `.catch(() => {})` attaches at the spawn call site,
   immediately** (invariant #3) — before ANY subsequent code, not merely
   before `startWorktree` returns (the `waitForHttp` failure path throws
   between spawn and return). Effects injection must keep the catch inside
   the spawn effect or on the very next line.
2. **`ensureRunning` ordering contract** (invariant #2, stated as an
   invariant rather than today's accidental shape): construct handle →
   `worktrees.set` → THEN invoke startup, with no `await` between the map
   `.get()` check and `.set()`. The 404/resolve check stays inside startup,
   after registration (`e25d530f`: unknown names must not leave phantom
   entries; the detached `.catch` cleanup at :363-366 keeps covering it).
   An injected resolver must not be able to run before registration.
3. **Scope discipline:** the proxy-retry body-replay machinery (:1206-1290,
   the "wedged chat" fix) stays OUT of the state machine. Extend
   `router-protocol.md` with a section describing it as-is; nothing more.

## Phase A — lifecycle module + the two fixes

New `bin/router-lifecycle.ts` (pure, zero I/O, exported): the handle/union
types, `LEGAL_TRANSITIONS`, `transitionLifecycle`, derived predicates
(`isServing`, …). `router.ts` adopts it AND lands invariants #5/#6 (the
publication guard and pidfile serialization) — this phase is explicitly
"formalize + fix", not behavior-preserving; the behavior deltas are exactly:
stop-during-start now actually stops (superseded starts self-clean), stale
failures can't clobber newer generations, pidfile ops serialize per name,
placeholder/ready become one object. Everything else byte-equivalent.
Verify: isolated-router smoke (floor, § Verification), typecheck, codex.

## Phase B — factory + effects injection

1. **Script→module split:** lifecycle machinery moves into a factory
   (`createRouterCore(effects, config)`) owning the `worktrees` map;
   `router.ts` becomes: build real effects → create core → wire HTTP/WS →
   `main()` (boot IIFE + signal handlers) that runs only when executed as
   a script — importing must neither bind ports nor install signal
   handlers (both currently happen at/near import; handlers synchronously).
   The tab-title monkey-patching becomes an explicit hook on the factory.
2. **`RouterEffects`** — enumerated exactly (codex finding 10):
   - spawn: lifecycle execa ×2 (:475, :503) AND dashboard execa call sites
     ×4 (stop-before-start :522, start :530, inline stop-on-failed-startup
     :573, `stopDashboard` :692);
   - `killGroup`, `pidAlive`;
   - `waitForHttp` (its internal per-probe timeouts stay inside the
     effect — the fake replaces the whole probe, decided here);
   - timers: `setTimer(ms, fn): TimerHandle` + `clearTimer(handle)` with
     defined semantics — returns a cancelable handle, real impl `unref()`s
     escalation timers, callbacks run through a try/catch that logs. ALL
     five escalation sites route through it (:567, :661, :677, :1326
     shutdown-path, plus the idle timer in `touch` :410). Escalation
     handles are stored on the handle's lifecycle variant (so teardown can
     cancel them and fakes can enumerate them) — a small behavior
     improvement over today's fire-and-forget, recorded as such;
   - `now()`, `sleep`;
   - pidfile store (read/write/remove — the serialized module from #6);
   - hub-config write; `getPort`; worktree/box resolution.
   Log-stream creation stays real (tests point BBX_STATE_DIR at tmp).
3. Boot-time sweeps (`sweepStaleChildren`, `reclaimOrphans`) stay in
   `main()`, unchanged.

## Phase C — incident tests with fakes

`bin/router-lifecycle.test.ts` + `bin/router-core.test.ts`, auto-run by the
root `pnpm test` glob, house style per `bin/router-issues.test.ts`. Fakes:
pausable in-memory pidfile store (reads/writes/unlinks gated on
test-controlled barriers), fake spawner returning controllable child stubs
(capturable exit callbacks fired at will; rejectable promise; pid), manual
clock owning all `TimerHandle`s.

Every incident test MUST fail when its guard is neutered (verify by
temporarily removing the guard, as the tRPC lock tests did):

1. **Pidfile TOCTOU (#6):** barrier-controlled interleaving — N's remove
   reads, PAUSE, N+1 writes, resume N's unlink → N+1's record must survive
   (fails against the old read-then-unlink code). A synchronous fake store
   cannot express this; the barriers are the point.
2. **TOCTOU dedupe (#2):** `Promise.all([ensure(x), ensure(x)])` → one
   spawn set, same handle for both callers (deterministic today since
   `ensureRunning` has no internal await; catches any regression that
   introduces one). 404 corollary: unknown name leaves no map entry —
   awaiting a microtask flush first (the cleanup runs in a detached
   `.catch`).
3. **Rejection discipline (#3):** the fake child's promise rejects on the
   microtask immediately after the spawn effect returns — before any
   subsequent line of `startWorktree` runs — and the test's
   `unhandledRejection` listener must stay silent. This pins
   catch-at-spawn-site, not merely catch-before-return.
4. **Stale exit (#4):** start A → SIGTERM A → register B (same name) →
   fire A's captured exit callback → B's handle untouched, still mapped.
   Separately (NOT claimed as an identity-guard test — the escalation
   callback closes over A's pids and cannot reach B by construction):
   advance the fake clock past KILL_GRACE and assert the SIGKILL went to
   exactly A's process-group ids.
5. **Guarded publication (#5):** (a) stop-during-start: stop while the
   fake spawner holds startup mid-await → completed start must NOT
   re-appear in the map, and its own children get killed; (b) stale
   failure: A stuck in waitForHttp, B installed, A's failure completes →
   B unaffected, no `failed` record for B's name.
6. Transition-table tests (illegal transition → invariant throw) and a
   handle-identity-stability test (transitions never change the handle
   reference).

## Verification

The isolated-router smoke (`BBX_STATE_DIR` + `ROUTER_PORT`: cold
start, ready proxy, idle stop, failed+retry) is the FLOOR, not the proof —
it exercises none of the racy boundaries. The deterministic Phase C fakes
carry the real verification weight, plus these targeted isolated-router
checks: stop issued during a (real, slow) cold start; retry immediately
after a failure; a kill of the fastify child while ready (unexpected-exit
path). NEVER touch the live shared router; it picks changes up only after
main-merge + boxholder restart. `bin/` has an intentionally empty eslint
config — quality rides on the root tsconfig (strict +
exactOptionalPropertyTypes + noUncheckedIndexedAccess), tests, and review.

## Execution

Sequential single-territory agents (bin/ only): Agent 1 = Phase A;
Agent 2 = Phases B+C (the tests validate the injection immediately). Each:
codex review foreground before final commit; stage-own-files + plain
`git commit` (no pathspec — lint-staged hazard,
`issues/bugs/2026-07-10-pathspec-commit-lint-staged-clobber.md`).

Close-out: update `router-protocol.md` (correct §1's overclaim; add
invariants #5/#6 and the proxy-retry fifth-candidate section; point the
invariants at the transition table + tests), update the open-decisions
issue item 1 (phase 2 done; deliberate non-goals recorded: stopping-phase
status accuracy, proxy-retry formalization), retire this plan to
implemented-plans on merge.

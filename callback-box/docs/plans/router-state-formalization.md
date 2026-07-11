# Router Phase 2 — WorktreeState Formalization

The "fuller option" from the architectural review's router item
(`issues/decisions/2026-07-06-architectural-review-open-decisions.md` item 1,
boxholder: do it in phases): a formal `WorktreeState` transition function,
injected effects (clock/spawner/fs), and unit tests with fakes that reproduce
the four documented incidents (`bin/docs/router-protocol.md`). Phase 1 (the
conservative doc-browser extraction + protocol doc) landed 2026-07-09.

> **STATUS: IN IMPLEMENTATION (2026-07-11).**

Scoping record (2026-07-11): `bin/router.ts` is 1407 lines post-extraction —
~42% lifecycle machinery (:159-745), ~38% HTTP/WS plumbing, ~20%
boot/shutdown. It is a **script, not a module**: zero exports, a top-level
boot IIFE (:1380-1407) that acquires the router pidfile, sweeps orphans, and
binds the port ON IMPORT, module-level singletons (`worktrees` map :318,
`server`, `proxy`, `shuttingDown`), and top-level `process.on(SIGINT/…)`
handlers. The lifecycle functions are `let`-bound for later monkey-patching
(:1371-1376). All of that must change shape before any unit test can import
anything.

## Hard constraints (non-negotiable, from the incident history)

1. **Object identity IS the generation signal.** Invariant #4's guard is
   `worktrees.get(name) === exited` — reference identity of the
   `WorktreeEntry`, not any field. The state module MUST keep entries
   mutated in place through a guarded transition function; it must NEVER
   adopt immutable-update style (`{...entry, state}` creates a new object
   and silently breaks the guard). This is a documented design decision, in
   the module doc comment, with a test that fails if an update changes
   identity.
2. **`stopWorktree` deletes its map entry before any `await`** (same
   invariant). The map is the routing table: absent = cold. Phase A is
   behavior-preserving — do NOT make `stopping` map-observable to improve
   `/__router/status` accuracy; note it as a possible later enhancement in
   the issue instead.
3. **The execa `.catch(() => {})` attaches at the spawn call site before any
   await** (invariant #3). Effects injection must not move it later.
4. **`ensureRunning`'s placeholder registration stays synchronous** — no
   `await` between the `worktrees.get()` check and `worktrees.set()`
   (invariant #2), and the 404/resolve check stays AFTER registration
   (`e25d530f`: unknown names must not leave phantom entries — the
   `.catch` cleanup at :363-366 keeps covering that path).
5. **Scope discipline:** the proxy-retry body-replay machinery
   (:1206-1290, the "wedged chat" fix) is a fifth invariant candidate the
   protocol doc doesn't cover. It is OUT of scope — do not fold it into the
   state machine. If the formalization makes its coupling clearer, extend
   `router-protocol.md` with a fifth section describing it as-is, nothing
   more.

## Phase A — state module (behavior-preserving)

New `bin/router-lifecycle.ts` (pure, zero I/O, exports), mirroring the house
pattern `callback-box/src/core/chat/session/lifecycle.ts`:

- `WorktreePhase = "starting" | "ready" | "stopping" | "failed"` — plus
  absent-from-map as the implicit cold state. Current code also has
  `"dead"`; scoping showed `"dead"` and `"stopping"` are set on entries
  already unlinked from the map (never externally observable). KEEP the
  phases on the entry object (the in-flight teardown closure reads them)
  but the transition table documents which phases are map-visible
  (`starting|ready|failed`) vs teardown-local (`stopping|dead` — fold
  `dead` into `stopping` if the closure logic permits it verbatim;
  otherwise keep both and say why).
- A `WorktreeEntry` discriminated union on `phase` where each variant
  carries exactly its legal fields (today: one interface, all-optional
  fields — `starting` entries carry none of `vite/fastify/ports`,
  `ready` carries all). Preserve the mutation-in-place requirement: the
  union is over a mutable object whose `phase` narrows via the transition
  function; TS-wise this likely means a single object type plus a
  `phase`-keyed view/narrowing helper rather than a literal union of
  separate object types (a literal union + in-place mutation don't mix
  cleanly) — the implementer chooses the strongest typing that keeps
  identity stable, and documents the tradeoff.
- `LEGAL_TRANSITIONS: Record<WorktreePhase, readonly WorktreePhase[]>` +
  `transitionWorktree(entry, to)` guarded by `invariant()` — every
  `entry.state =` assignment in router.ts funnels through it.
- Derived predicates (`isServing(entry)`, etc.) replacing scattered
  `entry.state === "ready"` checks.
- `router.ts` adopts the module with ZERO behavior change; the diff is
  mechanical adoption. Verify: isolated-router smoke (cold start, ready
  proxy, idle stop, failed + retry paths), `git diff` review, codex.

## Phase B — factory + effects injection

1. **Script→module split:** extract the lifecycle machinery into a factory
   (e.g. `createRouterCore(effects, config)` in a new `bin/router-core.ts`,
   or in-place in router.ts — implementer's call, but the factory owns the
   `worktrees` map, and `router.ts` becomes: build real effects → create
   core → wire HTTP/WS plumbing → `main()` boot guarded so importing never
   binds ports or installs signal handlers. The `let`-bound monkey-patching
   (:1371-1376, tab-title wrapping) becomes an explicit hook or wrapper
   passed to the factory, not mutation of module bindings.
2. **`RouterEffects` interface** covering the ~10 seams from scoping:
   spawn (the two lifecycle execa calls AND the two inline dashboard
   execa calls), `killGroup`, `pidAlive`, `waitForHttp`, `sleep`, `now()`,
   `setTimer`/`clearTimer` (idle timer + the four SIGKILL-escalation
   timeouts), pidfile read/write/remove, hub-config write, `getPort`,
   worktree/box resolution (`resolveWorktree`/`readBoxes`). Real
   implementations are the existing functions, moved or wrapped; behavior
   identical. Log-stream creation may stay real (tests point it at a tmp
   dir) — implementer judgment, documented.
3. The boot-time sweeps (`sweepStaleChildren`, `reclaimOrphans`) stay in
   `main()` — out of the per-worktree core, unchanged.
4. Verify: isolated-router smoke again (the REAL router path must be
   byte-equivalent in behavior), typecheck, lint, codex on the diff with
   specific attention to constraint 3 (catch-attachment timing) and timer
   ownership.

## Phase C — incident tests with fakes

New `bin/router-lifecycle.test.ts` (+ `router-core.test.ts` if split),
auto-picked-up by the root `pnpm test` glob (`bin/*.test.ts`), following
`bin/router-issues.test.ts` house style. Fakes: an in-memory pidfile store,
a fake spawner returning controllable `ChildProc`-shaped stubs (capturable
`exit` callbacks the test fires at will; rejectable promise; pid), a manual
clock for the idle/SIGKILL timers.

Tests, one per incident (each MUST fail if its guard is removed — verify by
temporarily neutering the guard, like the tRPC lock tests did):
1. **Pidfile clobber:** teardown of generation N races generation N+1's
   pidfile write; N's remove must no-op (the `expect` check) — N+1's
   record survives.
2. **TOCTOU dedupe:** `Promise.all([ensure(x), ensure(x)])` → exactly one
   spawn; both callers get the same entry. Plus the `e25d530f` corollary:
   an unknown name 404s without leaving a map entry.
3. **Unhandled-rejection discipline:** fake child rejects its promise
   AFTER `startWorktree` has returned/thrown (deferred rejection); assert no
   unhandledRejection (listener installed by the test).
4. **Stale-exit generation safety:** start A; SIGTERM A; register B for
   the same name BEFORE firing A's captured exit callback; fire it; assert
   B untouched. Also: A's SIGKILL-escalation timer firing late must not
   touch B (fake clock advance).
Plus transition-table tests (illegal transition → invariant throw) and the
identity-stability test from constraint 1.

## Execution

Sequential single-territory agents (bin/ only; no fan-out, no shared-file
contention): Agent 1 = Phase A; Agent 2 = Phases B+C (tests immediately
validate the injection). Each: codex review foreground before final commit;
stage-own-files + plain `git commit` (no pathspec — lint-staged hazard,
`issues/bugs/2026-07-10-pathspec-commit-lint-staged-clobber.md`).

Constraints carried from phase 1: NEVER touch the live shared router — all
verification via the isolated harness (`CALLBACK_STATE_DIR` + `ROUTER_PORT`);
the live router picks changes up only after main-merge + boxholder restart.
`bin/` has an intentionally empty eslint flat config — code quality rides on
tsc (root tsconfig: strict + exactOptionalPropertyTypes +
noUncheckedIndexedAccess) and review, not lint.

Close-out: update `router-protocol.md` (invariants now reference the
transition table + tests; add the fifth-candidate note), update the
open-decisions issue item 1 (phase 2 done; anything deliberately left —
e.g. status-accuracy for stopping, proxy-retry formalization — recorded
there), retire this plan to implemented-plans on merge.

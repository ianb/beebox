---
title: "Dev router: survive load, and leave a record"
status: implemented
workstream: router-resilience
issues:
  - ../../../issues/closed/bugs/2026-09-15-dev-router-transient-failures-are-permanent-and-unlogged.md
  - ../../../issues/closed/bugs/2026-08-18-failed-worktree-reports-owner-session-required.md
---
# Dev router: survive load, and leave a record

On 2026-09-15 a momentary CPU shortage made the dev router park the `main`
worktree as permanently failed. Every box under it served 502 for about three
hours, including the boxholder's phone, and the only record of the cause was one
line in a terminal that had to be pasted in by hand. This plan removes the three
defects behind that outage and closes the host-level contention that triggered
it.

**Issues addressed:**
`issues/bugs/2026-09-15-dev-router-transient-failures-are-permanent-and-unlogged.md`
(all three defects) and
`issues/bugs/2026-08-18-failed-worktree-reports-owner-session-required.md`
(track 6, added on the boxholder's ruling this session). The contention lever was handed over by
`issues/closed/bugs/2026-09-15-full-suite-red-glm-v2-layout-64cad1b8.md`, closed
`wontfix` the same day: *"the lever is scheduling (don't overlap full-suite with
finish-verify) or raising the per-file ceiling for the slowest files"*. That
issue is already closed and is not reopened; this plan takes the lever.

## Smallest fix and budget

The smallest change that fixes the observed failure is one number: raise
`waitForHttp`'s `timeoutMs` in `workstreams-app/src/router/router-worktree-start.ts:276` from 30000. That
is rejected as the whole fix, and the issue says why — *"The timeout is the
secondary lever"*. A bigger fixed number still loses to a bigger load spike, and
it makes every genuine breakage (bad config, syntax error) take that much longer
to report.

Six tracks, all in `workstreams-app/src/router/` except track 5 in `bin/`:

| Track | Source | Test |
|---|---|---|
| 1. Child-exit race + elastic budget | ~200 | ~250 |
| 2. Bounded `waitForHttp` retry | ~120 | ~200 |
| 3. Durable router log | ~150 | ~150 |
| 4. Mobile bootstrap retry | ~80 | ~150 |
| 5. Full-run fan-out cap | ~90 | ~130 |
| 6. A down worktree answers 503 | ~70 | ~110 |
| **Total** | **~710** | **~990** |

About 1,700 changed lines (additions plus deletions), plus roughly 120 lines of
authored documentation in `bin/docs/router-operations.md` and
`beebox/docs/plans/change-based-test-selection.md`. No generated output. This is
**not** a BIG CHANGE; it sits below the 2,000-line threshold.

What the fuller design buys over the one-number fix: tracks 1 and 2 together
mean a load spike costs a slow page load instead of a three-hour outage, and a
genuinely broken worktree reports *faster* than today rather than slower. Track
3 is what makes the next incident diagnosable at all. Track 5 removes the
trigger rather than absorbing it.

## Stated preferences this plan trades against

- **Principle 4 — resilient AND never silent** (`beebox/docs/engineering-principles.md:49`):
  *"'logs' means at a level someone will actually see, carrying enough context
  (box, card, operation) to debug from the log line alone."* Track 3 exists
  because the router currently fails this twice: `router-config.ts:122` writes
  only to a terminal, and `deny()` (`router-auth.ts:383`) is a pure function
  that logs nothing at all. The same principle constrains track 2: a retry that
  silently papers over a real break would be invisible degradation, so every
  retry attempt is logged and the terminal parked state is unchanged.
- **Principle 6 — right-sized defensiveness** (`:75`). Track 1 adds handling for
  a child that dies during startup, which is a state that genuinely happens
  (`router-worktree-start.ts:199-208` documents an observed `EADDRINUSE` death
  on `main`, 2026-08-18). It does not add handling for states the lifecycle
  types already exclude.
- **"Nothing retries forever"** (memory, and the issue: *"the repo's rule is that
  nothing retries forever, and a stranded terminal state must stay visible"*).
  Track 2's retry is bounded by attempt count and by phase; after the bound the
  worktree parks exactly as it does today.
- **"Minimize invented concepts; prefer primitives"** (memory). Track 2 adds two
  fields to the existing `FailedLifecycle` variant rather than a new phase;
  `LEGAL_TRANSITIONS` (`router-lifecycle.ts:193`) is untouched. Track 5 reuses
  the existing semaphore and the existing `-j` injection pattern rather than
  adding a scheduler.
- **"Scope anchored to the incident"** (memory). Supervising the router process
  (launchd) is the structural fix for "a console-run router is load-bearing
  infrastructure". It is explicitly NOT in scope; see that section.
- **`bin/docs/router-protocol.md`** is authoritative for anything touching the
  lifecycle: *"If you're about to change `ensureRunning` (`router-core.ts`),
  `startWorktree` (`router-worktree-start.ts`) … read this first."* Tracks 1 and
  2 both do; the invariant analysis is under each track's Direction.

## What already exists

Reuse, not rebuild, in every case below.

- **The effects seam.** `RouterEffects` (`router-effects.ts:62`) already injects
  `waitForHttp`, `spawn`, `setTimer`, `now`, and `sleep`, *"Enumerated
  deliberately so a reviewer can grep the core for a raw
  `execa`/`setTimeout`/`Date.now`/`fs` call and know it's a bug"*. Every track-1
  and track-2 behaviour is therefore testable with no real router and no real
  clock.
- **The deterministic harness.** `workstreams-app/test/router/router-core-harness.ts`
  provides `FakeClock` (owning every `TimerHandle` the core arms), a
  controllable spawner with capturable exit callbacks, and manual readiness
  probes. `FakeProbeTimeoutError` (`:41`) already models the exact failure this
  plan is about. Tracks 1 and 2 extend this harness; they do not build a new one.
- **The failure record.** `CapturedError` (`router-lifecycle.ts:28`) already
  carries `phase`, and `router-worktree-start.ts:274` already sets
  `progress.failurePhase = "waitForHttp"` before the wait. Track 2 needs no new
  plumbing to tell a load timeout from a spawn failure — the data is there and
  unused.
- **The retry endpoint.** `POST /__router/retry/<name>` and `clearFailed`
  (`router-core.ts:71`) already drop a `failed` record and start a fresh
  generation. Track 2 reuses `clearFailed` rather than writing a second path.
- **The retry loop.** `proxyWithRetry` (`router-proxy.ts:185`) already
  re-resolves the handle every attempt, buffers replayable bodies
  (`MAX_REPLAY_BODY_BYTES`, `:92`), and treats a superseded generation as a
  transient via `WorktreeNotReadyError` (`:151`). Track 4 moves the bootstrap
  inside machinery that already exists; it writes no new retry logic.
- **The per-worktree log files.** `prepareStart` already opens
  `<logDir>/<name>.log` and tees both children into it
  (`router-worktree-start.ts:72`, `captureOutput` `:147`). Track 3 adds a
  router-level file beside them in the same directory, not a new logging system.
- **The test semaphore.** `bin/test-locks.ts` gives two slots, a careful-tier
  barrier, and pid/boot-time/age staleness. `acquire()` returns `concurrency` and
  `test-ledger.ts:68` already threads it into `runUnderSlot`, so track 5 consumes
  a value that is already computed and already recorded. Note its meaning
  precisely: it counts runs holding a slot *when this one started*
  (`bin/test-ledger-lib.ts:69`), which is what makes the cap acquire-time only —
  see Open design questions.
- **The `-j` injection pattern.** `tierCommand` (`bin/test-tiers.ts:173`)
  already rewrites a bare `tap` argv to add `-j1` for the careful tier:
  *"-j1 is what 'carefully' means: the flakes in this tier are contention."*
  Track 5 reuses that shape, but not that call site — `tierCommand` runs before
  the semaphore is acquired and cannot see `concurrency`. See track 5's
  Direction.
- **Host gating.** `waitForQuietHost` (`schedules/full-suite/run.ts:77`) already
  defers the batch when load1 exceeds `availableParallelism() *
  QUIET_LOAD_PER_CORE`, and `bin/host-pressure.ts` already reads memory
  pressure for both the wrapper and the schedule. Track 5 does not add a new
  gate; it closes the hole that this one cannot see (below).

**Searched and found nothing:** no log-rotation helper exists anywhere in
`bin/`, `workstreams-app/src/`, or `beebox/src/lib/` — track 3 writes the size
cap itself, in about fifteen lines. No existing code reads `os.loadavg()` inside
the router.

### Related open issues

All 365 open issue files were swept by keyword, symptom, filename slug, and
frontmatter `area:`. Only the anchor issue is *resolved* by this plan, so it is
the only entry in the frontmatter `issues:` list. These neighbours bear on the
design and are recorded so the next reader does not re-derive them:

- **`issues/bugs/2026-08-18-failed-worktree-reports-owner-session-required.md`**
  (area router, priority normal) — *"When a worktree is in state `failed`, a
  client asking for a box inside it gets `{"error": "owner-session-required"}`…
  The actual problem was that the worktree's hub had crashed on startup 45
  minutes earlier."* This is very likely the anchor issue's unexplained request;
  see Open design questions. NOT in scope, with rationale below.
- **`issues/bugs/2026-08-21-ipv4-ipv6-port-collision-serves-wrong-process.md`**
  (backlog) — reports the same `Mobile session bootstrap failed` 401 and
  independently records the logging hole: *"The 401 path does not log — only the
  502 throw path does."* Tracks 3 and 4 remove that hole, so this issue's
  diagnosis story improves, but its own defect (an IPv4/IPv6 bind collision
  handing out a held port) is untouched and it stays open.
- **`issues/deferred/2026-09-02-fixed-timeout-budgets-fail-under-host-load.md`**
  (workstream test-overload, `activate-on: 2026-09-18`) — the parent of this
  plan's timeout theme, consolidating three earlier filings: *"under concurrent
  worktree load (load averages 19–40, up to 11 sibling `pnpm test`/lint
  processes), tests with fixed wall-clock budgets time out."* Track 1 is the
  router's instance of that pattern and track 5 attacks the contention that
  produces it, but this plan does not resolve the beebox-side test budgets, so
  it is deliberately NOT listed in `issues:` — `/finish` would close it
  prematurely, three days before its own check-in. The ledger measurement in
  track 5 is evidence that belongs to it; add it there when it activates.
- **`issues/bugs/2026-08-24-router-core-shutdown-test-flakes-under-load.md`**
  (normal) — a router-core timing assertion that fails only when the suite loads
  the machine. Track 5 should reduce its frequency; it is not a fix, and the
  issue stays open.
- **`issues/code-quality/2026-07-04-logging-consolidation.md`** — a
  boxholder-ruled direction, quoted under track 3.

**Explicit negatives, which are findings:** no open issue mentions
`bin/test-locks.ts`, the test semaphore, `.taprc`'s `jobs:`, `SIGALRM`, or
`finish-verify` overlapping `full-suite` — the semaphore mechanism is entirely
untracked in the open queue, and the anchor issue is the only place the
schedule-overlap coupling is written down at all. Likewise nothing mentions
`/__router/retry`, `waitForHttp`, or worktree cold start outside the anchor
issue. And **no open issue holds the argument that the dev router is
unsupervised, load-bearing infrastructure** — that theme appears only inside
other issues' prose. If the boxholder wants it tracked, nothing currently does;
see NOT in scope.

## Prior art (external)

Two design decisions depend on external premises; both are verified against the
code we actually run rather than documentation.

- **tap cannot change `-j` mid-run.** `jobs` is resolved when tap starts, so a
  run admitted at fan-out 6 cannot be throttled when a second run arrives. This
  is why track 5 caps at acquire time rather than adapting continuously. No
  upstream mechanism for dynamic job control was found in the tap configuration
  surface `.taprc` exposes.
- **`http-proxy-3` fires `proxyRes` before its `writeHeaders` pass**, which
  `router-proxy.ts:69-74` already relies on and documents by citing
  `web-incoming.ts`. Track 4 changes nothing about that ordering and inherits
  the guarantee.

No other design decision here rests on an external premise: the lifecycle, the
semaphore, and the logging are all our own code.

## Tracks / scope

### Track 1 — a dying child is a signal, not a timeout

**What.** During startup, watch for either child exiting, and fail the start
immediately when one does. With that signal in place, raise the readiness budget
from 30s to 180s.

**Why this needs to change.** Exit listeners are attached only in
`publishGeneration` (`router-worktree-start.ts:392-399`), which runs *after*
readiness. So between spawn and ready, the 30-second stopwatch is the only thing
distinguishing "Vite is slow" from "Vite is dead". Those two need opposite
responses and currently get the same one. The measured cost of conflating them:
`beebox/.taprc:44-45` records `hub-e2e` at 8.4s solo against 110.8s loaded, and the
ledger measurement in track 5 puts p90 file inflation at 3.05x under two
concurrent full runs. A fixed 30s cannot straddle that.

**Direction.** Move exit-listener attachment from `publishGeneration` into
`spawnGeneration`, storing the first exit on the `Generation` record. Add one
effect-free helper:

```ts
/** Rejects as soon as either child exits; never resolves on its own. */
function childDeath(generation: Generation): Promise<never>;
```

`bringUpGeneration` then races it:

```ts
progress.failurePhase = "waitForHttp";
await Promise.race([
  Promise.all([
    effects.waitForHttp(frontendPort, { reqPath: baseUrl, timeoutMs: READY_BUDGET_MS, label: `vite/${name}` }),
    effects.waitForHttp(backendPort, { reqPath: "/healthz", timeoutMs: READY_BUDGET_MS, label: `fastify/${name}` }),
  ]),
  childDeath(generation),
]);
```

A child death sets `progress.failurePhase = "childExit"` before rejecting, so the
parked `CapturedError.phase` distinguishes it from a budget expiry — which is
exactly what track 2 dispatches on.

**One listener, attached once, for the whole generation.** The first design here
attached startup listeners and detached them when the race settled, leaving
`publishGeneration` to attach its own. That is wrong twice. It opens a window
between `waitForHttp` resolving and `publishGeneration` running
(`router-worktree-start.ts:392`) in which a dying child has no listener at all,
so a `ready` handle could be published over a child that is already gone. And it
cannot be built as described: `SpawnedChild` exposes only
`on(event: "exit", …)` (`router-effects.ts:31`) with no detach, so "detach the
startup listener" would mean widening the effects interface and the fake
spawner to match.

So the listener is attached once in `spawnGeneration` and never removed. Its
handler dispatches on the handle's current phase:

```ts
const onExit = (code: number | null, signal: NodeJS.Signals | null): void => {
  log(`[${name}] ${label} exited code=${code} signal=${signal}`);
  if (handle.lifecycle.phase === "starting") failReadiness(new ChildExitError(label, code, signal));
  else onChildExit(state, handle);
};
```

`failReadiness` settles the `childDeath` promise; it is idempotent, so a second
child exiting after the first changes nothing. `publishGeneration` no longer
attaches exit listeners — it inherits the ones already in place, which is what
closes the window. This needs `handle` in `spawnGeneration`'s scope; it is
already threaded to every other function in the file.

`READY_BUDGET_MS = 180_000`. The budget is now a backstop for a wedged-but-alive
child, not the mechanism that catches breakage, so it can afford to be generous.
A bad config kills Vite in about two seconds and now reports in about two
seconds, which is *faster* than today.

**Invariant analysis** (`bin/docs/router-protocol.md`). Invariant #3 — *"swallow
the execa rejection at the spawn site — the VERY NEXT line, before any await"* —
is unaffected: the `fastify.catch` / `vite.catch` lines stay exactly where they
are, and the new `.on("exit")` attachment goes after them, matching the existing
ordering comment at `router-worktree-start.ts:189-197`. Invariant #5's guarded
publication is untouched: `failStart` still checks `worktrees.get(name) !==
handle` before parking.

**Vocabulary lock-ins.** `"childExit"` as a `CapturedError.phase` value, beside
the existing `"dashboard-start"`, `"pidStore.write"`, and `"waitForHttp"`.
`READY_BUDGET_MS` as the exported name of the budget.

**First implementation chunk.** Attach exit listeners in `spawnGeneration`, add
`childDeath`, race it in `bringUpGeneration`, record the `"childExit"` phase,
raise the budget. Harness gains a `killChild(which)` control; tests assert that
a child exit fails the start in the same tick and that a slow-but-alive child is
still awaited past 30s.

### Track 2 — a load timeout retries, bounded; everything else parks

**What.** When a start fails in the `waitForHttp` phase specifically, allow a
small number of automatic restarts with backoff before parking permanently.

**Why this needs to change.** `ensureRunning` (`router-core.ts:94`) parks every
failure forever, and its comment states the intent: *"Auto-restarting on every
page-fetch would mask the failure and burn CPU / log noise — a broken worktree
should *look* broken."* That reasoning is correct for a deterministic failure and
wrong for a stopwatch losing to load, and the phase that tells them apart is
already recorded. Track 1 makes parking rare; track 2 makes it recoverable when
it still happens.

**Direction.** Two fields on the existing `FailedLifecycle` variant — no new
phase, no change to `LEGAL_TRANSITIONS`:

```ts
export interface FailedLifecycle {
  readonly phase: "failed";
  readonly lastError: CapturedError;
  /** Automatic restarts already spent on this parked slot. */
  readonly attempts: number;
  /** Clock time the next automatic restart becomes allowed, or null when
   *  this failure is terminal (wrong phase, or attempts exhausted). */
  readonly retryAfter: number | null;
}
```

`failStart` computes both. `retryAfter` is non-null only when
`captured.phase === "waitForHttp"` and `attempts < MAX_AUTO_RETRIES` (3), using
backoff `effects.now() + RETRY_BACKOFF_MS[attempts]` (2s, 8s, 30s). Every other
phase — `"childExit"`, `"spawn"`, `"pidStore.write"`, `"dashboard-start"` —
parks terminally on the first failure, which is stricter than today for the
child-exit case and identical for the rest.

`ensureRunning` gains one branch before its existing throw:

```ts
const failed = failedLifecycle(existing);
if (failed) {
  if (failed.retryAfter !== null && effects.now() >= failed.retryAfter) {
    log(`[${name}] retrying parked waitForHttp failure (attempt ${failed.attempts + 1}/${MAX_AUTO_RETRIES})`);
    clearFailed(state, name);          // existing path, reused
    return ensureRunning(state, name); // carries attempts forward
  }
  throw statusError(failed.lastError.message, 502);
}
```

**Where the attempt count actually lives.** It cannot live on the handle, and an
earlier draft of this plan wrongly implied it could fall out of existing code.
It cannot: `clearFailed` deletes the map entry and returns `boolean`
(`router-worktree-teardown.ts:294-302`), and `createStartingHandle` takes only
`{ name, startedAt }` (`router-lifecycle.ts:244`). A handle is per-generation and
the retry destroys the generation, so any count stored there resets on the very
event it is meant to bound.

`CoreState` therefore gains one field — `retryAttempts: Map<string, number>`,
keyed by worktree name, beside the existing `worktrees` map. `failStart` reads
and increments it; `failedLifecycle.attempts` is a copy for rendering and never
the authority. Two eviction rules, both deliberate:

- **A successful `ready` publication deletes the entry.** A worktree that comes
  up has no retry history worth keeping.
- **An explicit `POST /__router/retry/<name>` deletes it too.** A human asking
  for a retry is a fresh start, not the fourth of three. This preserves today's
  behaviour, where the endpoint always works.

The map is bounded by the number of worktrees and holds one integer each.
Requests arriving before `retryAfter` get today's immediate 502 rather than
queueing, which keeps a parked worktree cheap under a burst.

**Ordering matters, for a narrower reason than it first appears.** Track 2 lands
after track 1, but not because a retry would discard a nearly-finished compile:
`failStart` calls `killChildren` before it parks anything
(`router-worktree-start.ts:294`), so by the time a retry could fire, both
children are already dead. The real reason is frequency. Without track 1's
longer budget and its early-exit signal, parking is *common* under load, so the
retry would fire often, and each firing spawns a fresh vite+hub pair into the
same contention that caused the timeout — three times over, on backoff. Track 1
makes parking rare, which is what turns the retry into insurance rather than an
amplifier.

**Vocabulary lock-ins.** `attempts` / `retryAfter` on `FailedLifecycle`;
`MAX_AUTO_RETRIES`; `RETRY_BACKOFF_MS`.

**First implementation chunk.** Add both fields, compute them in `failStart`,
branch in `ensureRunning`, thread the count through `clearFailed`. Tests: a
`waitForHttp` failure retries up to the bound and then parks; a `childExit`
failure parks on the first failure; a request before `retryAfter` gets 502
without spawning; the bound survives interleaved requests.

### Track 3 — a record that outlives the terminal

**What.** Tee `log()` to a size-capped file, log auth denials, and stamp the
host's load average onto startup failures.

**Why this needs to change.** The issue measured it:
`grep -c "\[router " ~/.cache/beebox/logs/main.log` returns 0. `router-config.ts:122`
is a bare `console.log`, so every `[router …]` line lives only in the scrollback
of whoever started the router. `deny()` (`router-auth.ts:383`) returns a decision
and logs nothing, so a refused request leaves no trace whatsoever. Three failures
on 2026-09-15 were diagnosed from a file mtime, a box child log, and a
hand-pasted console line; one remains unexplained. Post-mortems are routine here,
so the bar is that a future agent can find this log and read it cold.

**The one-way-to-log ruling.** `issues/code-quality/2026-07-04-logging-consolidation.md`
records a boxholder decision: *"there should be one way to log everywhere more
or less. If not then we should fix it."* It names `makeLog`
(`beebox/src/core/chat-session-log.ts`) as the house pattern against ~900 raw
`console.*` calls. This track does **not** adopt `makeLog` and does not add a
second convention either: `workstreams-app/`'s router cannot import beebox
internals (the same constraint that makes `router-lifecycle.ts` restate
`invariant` locally, `:24`), and `log()` in `router-config.ts` is already the
router's single logger — *"Every router module logs through this one line
format."* Track 3 changes where that one logger writes, not how many loggers
exist, which keeps principle 8 (one way to do each thing) satisfied for this
component and leaves the repo-wide migration to its own issue.

**Direction.**

1. `log()` writes to `$BBX_STATE_DIR/logs/router.log` as well as stdout, same
   `[router <iso>] …` format so existing reading habits transfer. Append mode,
   capped at 16MB with exactly one rollover to `router.log.1`. Write failures
   are swallowed after one stderr warning — a full disk must not take the router
   down, and the console output still works.
2. `deny()`'s call sites log `method`, `path`, `route.kind`, and `reason`. No
   headers, no cookie values, no bearer tokens. The function stays pure; the
   logging happens where the decision is consumed, so `authorizeRouterRequest`
   remains unit-testable without a logger. **Both consumers, not just the HTTP
   one:** `writeDeny` in `router.ts` renders the HTTP denial, but a refused
   WebSocket upgrade is `if (!decision.allow) { socket.destroy(); return; }`
   (`router-upgrade.ts:49-51`) — entirely silent today, and a plausible source of
   the anchor issue's unexplained request, since an iOS client reconnecting
   during an outage upgrades rather than navigates. WS denials log at the same
   four fields. They are throttled to one line per (reason, path) per ten
   seconds, because a reconnecting client retries on a timer and an unthrottled
   line would bury the log it is meant to make readable.
3. `failStart` includes `os.loadavg()[0]` in the logged line, so "this was
   contention" is recorded rather than reconstructed a day later. This is the
   only new `os` read in the router and it goes through a new
   `effects.load1()` so the harness stays deterministic.
4. About twenty lines in `bin/docs/router-operations.md` naming the file path
   and the line shapes. This is the half that makes the log *findable*; a log a
   future agent cannot locate is the failure this track is fixing.

**Vocabulary lock-ins.** `router.log` / `router.log.1` as the filenames;
`ROUTER_LOG_MAX_BYTES`; `effects.load1()`.

**First implementation chunk.** The file tee plus rotation, with the rotation
boundary extracted as a pure function so a doctest reaches it without writing
16MB.

### Track 4 — the bootstrap joins the retry loop it already sits in

**What.** Let a failed mobile session bootstrap retry, and report the box's own
reason instead of flattening every failure into one string.

**Why this needs to change.** The bootstrap sits inside `proxyWithRetry`'s
`for (;;)` loop, whose comment describes precisely this case: *"after a
kill/restart race the worktree's new generation listens on different ports, so
retrying the original target would hammer a dead port."* It uses none of it — a
`null` from `bootstrapMobileSessionCookie` writes 401 and returns
(`router-proxy.ts:243-246`). Worse, `bootstrapPending` is cleared *before* the
attempt (`:237`), so a retry would proxy with no session cookie and fail more
quietly. And `bootstrapMobileSessionCookie` collapses every non-204 into `null`
(`router-mobile-bootstrap.ts:73`), so a transient port race is indistinguishable
from a revoked pairing — which is how a working device token read as a dead one
on 2026-09-15.

**Direction.** Change the return to a discriminated result, per principle 5 —
the caller genuinely dispatches on why:

```ts
type BootstrapOutcome =
  | { ok: true; cookies: string[] }
  | { ok: false; kind: "transient"; status: number }   // 5xx, 502, connection refused
  | { ok: false; kind: "rejected"; status: number; reason: string };  // the box's own 401/403
```

`bootstrapPending` is cleared only on `ok: true`. A `transient` outcome falls
into the existing retry path exactly as `WorktreeNotReadyError` does, so the
loop re-resolves the handle and retries against the new generation's port. A
`rejected` outcome writes 401 carrying the box's own reason ("Mobile device
token is invalid or revoked"), which is the case that genuinely means re-pair
the device.

**Vocabulary lock-ins.** `BootstrapOutcome` and its two failure kinds.

**First implementation chunk.** The result type and the `bootstrapPending`
ordering fix together — they are one bug, and splitting them would leave a
window where a retry proxies without a cookie.

### Track 5 — cap the fan-out when the host is already running a suite

**What.** A full-mode test run that starts while another run holds a slot gets
half the parallelism.

**Why this needs to change, with the measurement.** The semaphore counts *runs*;
the scarce resource is *cores*. Two slots at `.taprc`'s `jobs: 6` is twelve tap
processes on a twelve-logical / eight-performance-core machine, with nothing left
for the router's Vite compile, the hubs, the box children, or the agent sessions.

`.taprc:36-41` says this was never measured under load: *"Half the cores bounds
that contention while keeping the suite reasonably fast; the loaded-machine
parallelism probe did not revalidate this setting."* It has now been measured,
from the ledger's own records (`<git-common-dir>/beebox-test-ledger.jsonl`, 933
runs, `concurrency` recorded per run and `durations` recorded per file, so files
pair against themselves):

| Comparison | Median | p90 | Max |
|---|---|---|---|
| Full-mode file, 2 concurrent runs vs solo | **1.69x** | **3.05x** | 6.03x |
| Selected-mode file, same comparison | 1.43x | 1.69x | 10.58x (one outlier) |

805 full-mode files and 632 selected-mode files, each compared against itself
with at least five solo and three concurrent samples. 88 full-mode files inflate
past 3x; `test/core/docs-refresh.doctest.md` goes 17.2s to 85.9s. Read the
median and p90, not the max: selected mode's 10.58x is a single file
(`test/core/commands/pdf-extract-integration.doctest.md`) against a p90 of
1.69x. The harm is concentrated in full-run overlap, which is exactly the
2026-09-15 shape.

**What this measurement does and does not establish.** `concurrency` is recorded
at slot-acquire time (`bin/test-ledger-lib.ts:69`), so it counts runs already
holding a slot when this one *started* — not overlap during the run. Two
consequences, both stated rather than smoothed over. First, a run that begins
alone and is joined halfway records `concurrency: 0`, so the solo bucket is
contaminated with partially-contended runs and the real inflation is *at least*
the figures above. Second, and more important for the design, see Open design
questions: an acquire-time cap throttles the joiner but never the incumbent.

The other half of the measurement decides the mechanism: **642 of 756 runs with
a recorded value ran solo**. Lowering `.taprc`'s `jobs` globally would slow 85%
of runs to fix the other 15%, so the cap is conditional, not static.

`waitForQuietHost` (`schedules/full-suite/run.ts:77`) cannot close this: it gates
at batch start, so a `finish-verify` beginning twenty minutes later is invisible
to it, and the semaphore admits that second run without either party
re-checking.

**Direction.** One pure function in `bin/test-tiers.ts`, beside the existing
`-j1` injection:

```ts
/** Fan-out for a run, given what else holds a slot. Full runs halve when they
 *  are not alone; selected runs are short and are left alone. */
export function capJobs(input: {
  args: string[];
  mode: "full" | "selected";
  concurrency: number | null;
  cores: number;
}): string[];
```

An explicit `-j` in argv always wins, matching `tierCommand`'s precedence rule.
`concurrency === null` (the fail-open path where no lock could be taken) means no
cap — a lock directory that cannot be used is already not a reason to refuse to
test, and it is not a reason to run slowly either.

**The hook point is not `tierCommand`, and the difference matters.**
`tierCommand` builds the tap argv at `bin/test-ledger.ts:274-281`, *before* the
semaphore is acquired at `:66-68`, so it cannot see `concurrency` at all.
`capJobs` therefore runs in `runUnderSlot` (`:123`), which receives both
`concurrency` and `context.mode`, and it rewrites an argv that has already been
built. This plan claims only that `capJobs` reuses the *shape* of `tierCommand`'s
`-j1` injection, not its call site. Two consequences to implement deliberately:
the explicit-`-j` scan runs over the built args (including any `-j` `tierCommand`
itself added for the careful tier, which must not be overridden), and the cap
appends its flag only when that scan finds none — never a second `-j` that tap
would resolve by last-wins.

Worst case becomes 6 + 3 = 9 rather than 12, and the common solo full run is
unchanged — so no landing gets slower except one that was already contending,
where it is a smaller share of a machine that was overcommitted anyway.

**Vocabulary lock-ins.** `capJobs` as the function name; "fan-out" for the
per-run job count in prose, distinct from "slots" for semaphore capacity.

**First implementation chunk.** `capJobs` plus its unit tests, then the call site
in `runUnderSlot`, then the `.taprc:36-41` comment updated to record that the
probe has now been run and what it found.

### Track 6 — a down worktree is unavailable, not unauthorized

**What.** When the worktree behind a box request is `failed`, answer 503 naming
the real failure instead of letting the request fall through to a control-route
401.

**Why this needs to change.** Boxholder ruling, this session: *"the
owner-session-required error message is also a bad error message! Should be…
whatever the real error is"* and *"I don't see why we'd have a 401 instead of
503, a down worktree is unavailable, not unauthorized."* That matches the
standing filing,
`issues/bugs/2026-08-18-failed-worktree-reports-owner-session-required.md`: *"401
with `owner-session-required` is a claim about the caller. A crashed dependency
is a claim about the server — 503 with a reason is the honest shape."*

The cost is measured, not hypothetical. It cost about half an hour on 2026-08-18,
and it is the most likely explanation of the anchor issue's still-unexplained
request: `classifyRouterRoot` maps the bare root to `control-read`
(`router-auth.ts:262`), whose denial reason is `owner-session-required`
(`:491`), so any client that falls back to a non-box path while its worktree is
down gets an authentication error for a liveness failure.

**Direction.** The router already knows the worktree is down —
`failedLifecycle(handle)` is exactly that fact, and `router-pages.ts:198` already
renders it for browsers with the captured error and a retry button. The gap is
that an API client never reaches that surface. So:

1. **Liveness is checked before authorization is reported.** For a request whose
   first path segment names a worktree currently parked `failed`, the response is
   `503` with a JSON body naming the worktree, the failure phase, and the retry
   endpoint — regardless of whether the caller held a credential. This is the
   ordering that matters: today the auth answer is computed first and a liveness
   problem is reported in its vocabulary.
2. **Disclosure stays bounded**, which is the design question the 2026-08-18
   issue raised and left open: *"Don't leak more than the caller may know."* The
   503 body names the worktree state and nothing else — no captured child output,
   no paths, no ports. A worktree name is already in the URL the caller sent, so
   this discloses nothing the caller did not supply, and the `phase` string is a
   closed vocabulary (`"waitForHttp"`, `"childExit"`, `"spawn"`, …) rather than
   free text from a child process.
3. **The bare root stays 401.** A request for `/` names no worktree, so there is
   no liveness fact to report and `owner-session-required` is the honest answer
   there. This track narrows where that reason can appear; it does not remove it.

Track 3's denial logging and this track are complementary: 3 records what was
refused, 6 stops refusing for the wrong reason.

**Vocabulary lock-ins.** The 503 body shape `{ error: "worktree-unavailable",
worktree, phase, retry }`.

**First implementation chunk.** The liveness-before-auth branch plus the 503
body, with the "is this worktree parked?" lookup as a pure function over the
handle so the decision is unit-testable without a server.

## Could this be simpler?

The simplest version that plausibly works is track 1 alone, with the budget
raised and nothing else: one file, about thirty lines, and the 2026-09-15 outage
does not happen.

What the rest buys, each traced to a stated preference:

- **Track 2** buys recovery when parking still happens. The simple version fails
  whenever a start loses for any reason the child-exit race cannot see — a
  wedged-but-alive Vite, a slow disk, a budget that is still too small on a worse
  day — and the cost of that failure is the boxholder's phone serving 502 until a
  human notices. The boxholder named this directly: *"that timeout then left the
  router kind of permanently broken (because it wouldn't try again)."*
- **Track 3** buys the next post-mortem. The simple version leaves principle 4
  violated in the same two places, and the still-unexplained
  `owner-session-required` request stays unexplained forever. This is the
  cheapest track and the issue argues it is the most valuable: *"This is the
  defect that made the other two expensive."*
- **Track 4** is a separate bug that happens to share a page. It is in scope
  because it is in the same issue and the same file, and because leaving it means
  a transient port race keeps reading as a revoked device pairing — which sent
  the 2026-09-15 investigation down a wrong path for real minutes.
- **Track 5** buys removing the trigger rather than absorbing it. Without it the
  suite keeps producing load-induced red that costs a triage cycle each time; the
  closed full-suite issue is one such cycle already spent.

Deliberately *not* built, having been considered: a supervisor for a wedged-
but-alive child (the budget is the backstop, and `killChildren` already runs on
the failure path); a dynamic fan-out that adapts mid-run (tap cannot change `-j`
after start, per Prior art); a new lifecycle phase for "retrying" (two fields on
the existing variant carry the same information, per *minimize invented
concepts*); a log viewer UI (the file plus a doc pointer is what a post-mortem
needs, and the failed-startup page at `router-pages.ts:198` already surfaces the
captured error to a human in a browser).

## Subplans

None. Each track is a single design decision with a settled shape; none needs a
research-and-decide step of its own. Track 5's open question about the per-file
ceiling is recorded below rather than made a subplan, because no part of this
plan depends on its answer.

## Failure modes

> **Critical gap:** none outstanding. The one identified while planning — a
> `router.log` write failure taking the router down, which would convert an
> observability improvement into an outage — is resolved in track 3's Direction
> by swallowing write errors after a single stderr warning.

| What can fail | Test exists? | Handling exists? | Clear-or-silent? |
|---|---|---|---|
| Both children exit at once; the race handler runs twice and double-fails the start | New (harness `killChild` both) | New — listeners detach when the race settles | Clear: second call is a no-op |
| A child exits *after* readiness but before `publishGeneration` runs | New | New — one continuous listener dispatches on phase, so no window exists; `onChildExit` still guards on `worktrees.get(name) === handle` | Clear: tears down the generation |
| The phase-dispatching listener fires during `stopping` (a superseded self-clean) | New | Existing — `onChildExit`'s generation guard makes it a no-op | Clear |
| WS denial logging floods the log when a client reconnects on a timer | New | New — one line per (reason, path) per 10s | Clear: throttled, not dropped silently |
| `retryAttempts` entry outlives its worktree | New | New — evicted on `ready` and on explicit retry | Clear: one integer per worktree name |
| Retry storm: many requests arrive past `retryAfter` at once | New | Existing — `ensureRunning`'s atomic registration (invariant #2) dedupes | Clear: one generation starts |
| `attempts` resets because a retry goes through a path that rebuilds the slot | New (interleaved-request test) | New — `clearFailed` returns the count and seeds the fresh handle | Would be silent; the test is the guard |
| Retry fires while the boxholder is mid-`POST /__router/retry` | New | Existing — `clearFailed` is idempotent and returns whether it cleared | Clear |
| `router.log` disk full or directory unwritable | New (injected write failure) | New — one stderr warning, then silent stdout-only | Clear once, then deliberately quiet |
| Rotation races two writes at the 16MB boundary | New (pure boundary function) | New — rename-then-reopen, append-only | Clear: worst case a few lines land in `.1` |
| `deny()` logging leaks a bearer token or cookie | New (assert the logged shape) | New — the call site logs four named fields, never the header map | Clear: test pins the field list |
| A `rejected` bootstrap is misclassified as `transient` and retries a dead pairing | New | New — classification is on the box's status code | Clear: bounded by `retries` |
| A box request arrives while its worktree is parked; the 503 body leaks child output or paths | New (assert the body shape) | New — the body carries worktree, a closed-vocabulary phase, and the retry path only | Clear: test pins the field list |
| The liveness branch swallows a genuine auth failure on a healthy worktree | New | New — the branch fires only when `failedLifecycle(handle)` is non-null | Clear: 401 still reported for a running worktree |
| `capJobs` caps a run that explicitly asked for `-j` | New | New — explicit argv wins, matching `tierCommand` | Clear |
| `capJobs` reads `concurrency: null` (lock unavailable) and caps anyway | New | New — null means no cap | Clear |
| A run starts solo, caps as solo, and is joined by a second run later | New (pure-function test) | Partial — the joiner caps to 3, the incumbent stays at 6 | **Silent**, and accepted: worst case is 9 concurrent jobs rather than 12. See Open design questions |

## Agent-flow / user-flow edge cases

- **Wrong tag / wrong field** — ADDRESSED. The only new dispatch is on
  `CapturedError.phase`, whose values are a closed set written in one place
  (`router-worktree-start.ts`) and read in one place (`failStart`). A new phase
  string that nobody dispatches on parks terminally, which is the safe default.
- **Stale ref** — ADDRESSED. `retryAfter` is compared against `effects.now()`,
  and a superseded generation is already caught by invariant #5's
  `worktrees.get(name) !== handle` guard at both terminals
  (`router-worktree-start.ts:314`, `:351`).
- **Two agents touching the same thing** — ADDRESSED. Concurrent cold requests
  are deduped by invariant #2's atomic registration; concurrent test runs are
  the subject of track 5. A manual `POST /__router/retry` racing an automatic
  retry is covered in the Failure modes table.
- **Hand-edit drift** — ADDRESSED for track 5: `.taprc`'s `jobs:` stays the
  hand-editable knob and keeps its meaning (solo fan-out); `capJobs` only ever
  reduces it. Not applicable to tracks 1-4, which add no hand-edited surface.
- **Fabricated free-form value** — Not applicable: no track adds a free-form
  field an agent fills in. Stated rather than skipped, per the template.
- **Validation error UX** — ADDRESSED. Track 4 is largely *about* this: the 401
  an iOS device receives will name the box's own reason, so an agent reading it
  can tell "re-pair the device" from "the worktree was restarting".
- **Partial migration / transition state** — ADDRESSED. Nothing here has on-disk
  shape. `FailedLifecycle` lives only in memory, so a router restart is the whole
  migration. `router.log` is created on first write. The only ordering
  requirement is track 2 after track 1, stated in track 2's Direction.

## NOT in scope

- **Supervising the router process** (launchd, or any restart-on-crash). This is
  the real structural answer to "a console-run router is load-bearing
  infrastructure", and the boxholder raised it as context rather than a task. It
  is a separate decision about how the dev machine is run, and scoping it in here
  would widen a bug fix into an infrastructure change. Track 3 removes the part
  that hurts most — losing the record — without touching how the router is
  started.
- **A "starting…" page for long cold starts.** Track 1 raises the readiness
  budget to 180s, so a request against a genuinely wedged child now waits longer
  than it used to before getting a 502. The clean mitigation is serving the
  existing page shell after ~20s while the start continues in the background.
  Deferred deliberately: it is a UX addition on a path that track 1 makes rare,
  and it belongs after we see whether the longer wait is felt at all.
- **Changing the semaphore's slot count.** Two slots was chosen against a
  measured thrash point (`change-based-test-selection.md`: *"One slot was
  rejected as inviting lockups… two bounds contention below the thrash point"*).
  Track 5 changes the fan-out per slot, which is the number that was never
  validated, and leaves the slot count alone.
- **Raising or lowering tap's per-file timeout.** See Open design questions: the
  ceiling that actually fired is not the one `.taprc` configures, and tuning a
  number we cannot yet locate would be guesswork.
- **Making the router not load-bearing.** This plan makes the router fail less
  and makes its failures diagnosable. It does **not** reduce how much depends on
  the router, and it does not let anything survive the router's own death. Filed
  as `issues/decisions/2026-09-15-dev-router-is-load-bearing-and-cannot-survive-its-own-restart.md`,
  because the obvious version would make outages worse rather than better:
  `sweepStaleChildren` (`workstreams-app/src/router/router-real-effects.ts:179-193`)
  **kills** every pidfile-tracked child on boot, so a supervised restart would
  tear down every worktree and then cold-start them all at once — the exact
  failure tracks 1 and 2 exist to prevent. Adoption on boot is the prerequisite,
  and the decision underneath both is whether the boxholder's phone should be
  paired to a dev-router URL at all (`beebox/docs/mobile-contract.md:21-23`).

## Open design questions

- **Where does the ~1,000,000ms per-file ceiling come from?** The three
  2026-09-15 failures died on `SIGALRM` at `time=1003967ms`, but `.taprc:48` sets
  `timeout: 300` and `schedules/full-suite/run.ts:73` states *"tap kills files at
  its 300s budget"*. `grep -rn "TAP_TIMEOUT"` over the repo returns nothing, and
  `tierCommand` injects no timeout flag. So a ~16.7-minute ceiling is in force
  and the repo does not say why. **Lean:** tap's per-file timer is reset by
  subtest activity, making `timeout` a per-subtest idle budget rather than a
  per-file wall-clock one — unverified. This does not block any track; it is the
  prerequisite for ever tuning the ceiling, which is why that tuning is NOT in
  scope.
- **Is the unexplained `owner-session-required` request the 2026-08-18 defect?**
  `classifyRouterRoot` maps the bare root to `control-read`
  (`router-auth.ts:262`), whose denial reason is `owner-session-required`
  (`:491`) — so a client that asks for a non-box path gets it. The anchor issue
  concluded *"something requested a non-box path, and there is no record of
  what"*, and the 2026-08-18 issue reports exactly that shape from iOS when the
  worktree behind a box is down. **Lean:** they are the same thing — an iOS
  client falling back to a non-box path during the outage. Unverified, and it
  cannot be verified retroactively; track 3's denial logging is what settles it
  the next time it happens. Nothing in this plan depends on the answer.
- **An acquire-time cap throttles the joiner but never the incumbent — is 9
  concurrent jobs good enough?** `capJobs` can only act when a run starts, so in
  the 2026-09-15 shape the hourly batch (which started first, recording
  `concurrency: 0`) keeps `-j6` and only the later `finish-verify` drops to
  `-j3`. Worst case falls from 12 to 9, not to 6, and tap cannot be re-jobbed
  mid-run (see Prior art). The alternative is a static `-j3` for every full-mode
  run, which reaches 6 in the worst case but also slows a solo full run —
  including a human's `finish-verify` on an otherwise idle machine — by roughly
  2x. **Lean:** ship the conditional cap and measure, because 9 is materially
  better than 12 and costs nobody anything, then revisit with the overlap data
  the next question describes. **Settled this session:** the boxholder accepted
  the conditional cap with the asymmetry stated ("the contention cap is fine or
  whatever"), so track 5 ships as written and the residual — a worst case of 9
  concurrent jobs rather than 6 — is an accepted risk, not an open question.
- **What measurement would settle that?** Today's ledger records `concurrency`
  only at acquire (`bin/test-ledger-lib.ts:69`), which cannot see overlap that
  begins mid-run. Recording slot acquire and release timestamps would make true
  overlap duration computable, and turn "how often is a run joined after it
  starts?" from a guess into a query. That is a small addition to the ledger
  record and is NOT in scope here; it is the prerequisite for ever revisiting
  the question above with evidence rather than a lean.
- **Should `READY_BUDGET_MS` be elastic rather than fixed at 180s?** A budget
  scaled by `os.loadavg()` would track the actual contention instead of
  guessing a number that covers the worst observed case. **Lean:** no, for now —
  a fixed generous budget plus track 1's child-exit race plus track 2's retry
  already covers the failure, and a load-scaled budget is a third mechanism
  where two suffice. Revisit only if a 180s budget is seen to expire on a
  healthy generation.

## Knowledge audits

Skip, with rationale: no track adds an agent-facing concept. Nothing here
introduces a tag, card shape, schema field, or box convention — the router and
the test semaphore are dev-machine infrastructure that box agents never see, and
`beebox/src/dev/knowledge-audits.yaml` tests what a box agent learned from
box-loaded guidance. The dev-facing documentation this plan does add goes to
`bin/docs/router-operations.md`, which is read by agents working in this repo
and is not audit surface.

## What will hold this after it ships

The decisions worth protecting are extracted as pure functions so the cheap
tiers reach them, rather than tested in place through a heavier tier:

- **`workstreams-app/test/router/router-core.test.ts`** (node:test, existing
  tier) covers tracks 1 and 2 through the existing harness. This is the tier
  that already reproduces the documented races, and it needs one new control —
  `killChild(which)` on the fake spawner — to reach every new path. No new mock
  is written by the author of the bug: the harness predates this work and its
  `FakeProbeTimeoutError` already models the failure.
- **The retry decision is the risky part of track 2**, so it becomes a pure
  function — `retryDecision({ phase, attempts, now, retryAfter })` in
  `router-lifecycle.ts` (already pure and zero-I/O) — and is unit-tested
  directly. `ensureRunning` then only executes the decision.
- **Track 3's rotation boundary** is likewise pure (`shouldRotate({ bytes,
  max })`), so nothing writes 16MB in a test.
- **Track 4** extends `workstreams-app/test/router/router-mobile-bootstrap.test.ts`,
  which already exists; the classification of a box response into a
  `BootstrapOutcome` is a pure function over a status code.
- **Track 5** extends `bin/test-tiers.ts`'s existing test file with `capJobs`
  cases. Note the trap this avoids: testing the cap by actually running two
  suites would take an hour and be nondeterministic; the pure function makes it
  microseconds.

**No new test tier.** Every track lands in a tier that already exists, which
matters because a new tier is a norm every future agent inherits.

No tour is involved: none of this is a walk-through-the-UI behaviour, and the
behaviour that must stay true is in doctests and unit tests as above.

## Implementation order

Chunks are commit boundaries, not ship boundaries; the plan ships as one piece
when every chunk is done and the boxholder says so.

1. **Track 3, the file tee.** First because it is independent, low-risk, and
   makes every later chunk verifiable in the field rather than only in tests.
   Rotation boundary as a pure function, then the tee, then the doc paragraph.
2. **Track 3, denial logging and the load stamp.** Separable from chunk 1 and
   touching a different file (`router-auth.ts`).
3. **Track 4, the bootstrap.** Self-contained, no dependency on any other track,
   and it removes an active source of misdiagnosis.
4. **Track 1, child-exit race and the budget.** The first lifecycle change; it
   must land before track 2.
5. **Track 2, bounded retry.** Depends on chunk 4 for the `"childExit"` phase it
   dispatches against.
6. **Track 6, the 503.** Touches `router-auth.ts`/`router-dispatch.ts` and reads
   the lifecycle without changing it, so it lands after tracks 1 and 2 have
   settled what `failed` means and which phases can produce it.
7. **Track 5, `capJobs`.** Independent of every router change; last because it is
   the one chunk outside `workstreams-app/`, and keeping it separate keeps the
   router history readable.

## Rollout shape

Tests first, per `beebox/docs/testing.md`. Done-when is the following passing:

- `pnpm --dir workstreams-app test:router` — the existing suite, plus new cases
  for: a child exit failing a start immediately; a slow-but-alive child awaited
  past 30s; a `waitForHttp` failure retrying to the bound then parking; a
  `childExit` failure parking on the first failure; a request before `retryAfter`
  getting 502 without a spawn; `attempts` surviving interleaved requests;
  `router.log` rotation at the boundary; a write failure warning once then
  staying quiet; `deny()` logging exactly four named fields; a refused WS upgrade
  logging once and a reconnect burst logging once per throttle window; a
  `transient` bootstrap retrying and a `rejected` one not; a child exiting while
  the handle is `starting` failing the start, and the same listener calling
  `onChildExit` once the handle is `ready`; a `retryAttempts` entry evicted on
  `ready` and on explicit retry; a box request against a parked worktree
  answering 503 with the pinned body shape; the same request against a running
  worktree still answering 401 when the credential is genuinely missing; the bare
  root still answering `owner-session-required`.
- `bin/test-tiers.test.ts` — `capJobs` cases: explicit `-j` wins; `concurrency:
  null` does not cap; a full run at concurrency 1 halves; a selected run never
  caps.
- `pnpm typecheck` and `pnpm lint` clean, both of which run behind
  `bin/with-slot.ts` and so are themselves subject to track 5's contention.

**Field verification**, because the tests above run against fakes and the point
of this plan is behaviour on a real loaded machine. After merge, and only with
the boxholder starting it (the shared router is theirs to restart —
`bin/CLAUDE.md:34`): confirm `~/.cache/beebox/logs/router.log` exists and carries
`[router …]` lines, which is the exact `grep -c` the issue reports as returning
0 today. An isolated second router (`BBX_STATE_DIR` + `ROUTER_PORT`) can
demonstrate the log and rotation without touching the live one.

No migration: nothing in this plan has on-disk shape. `router.log` appears on
first write, and `FailedLifecycle`'s new fields live only in memory, so a router
restart completes the transition.

No knowledge audits land with this plan, per that section.

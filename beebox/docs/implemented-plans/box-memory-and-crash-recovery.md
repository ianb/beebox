---
title: "Box child memory probes and crash recovery"
status: implemented
workstream: box-memory-and-crash-recovery
issues: []
---
# Box child memory probes and crash recovery

On 2026-10-25 a local box's `bbx engine serve` child ran out of heap. Restarts
then failed on a stale startup lock until the supervisor stopped trying, and the
box stayed down until a human sent SIGHUP. This plan makes a crashed child come
back without a human. It also adds always-on memory probes, so the next leak can
be diagnosed from what the probes leave behind.

**Issues addressed:** none filed. Related closed incidents, both diagnosed with
temporary instrumentation that was later removed:
`issues/closed/bugs/2026-08-04-chat-history-parse-transient-oom.md`,
`issues/closed/bugs/2026-08-05-box-watcher-unbounded-scale-oom.md`. Related
accepted limitation: `issues/closed/bugs/2026-07-21-file-lock-empty-window-race.md`.

## Design

No design section: process supervision and diagnostics. A person sees one
change: a crashed box comes back by itself, after seconds instead of never.

## Smallest fix and budget

Smallest fix: put `admission.lock` on the `request` stale profile (one line). The
supervisor's existing five fast retries then outlast the dead holder's 15 s
window. That fixes the incident as reported.

Chosen design, three tracks:

1. Admission lock on the request profile: about 5 source lines, 40 test lines.
2. Supervisor keeps retrying an unhealthy box on a slow timer: about 45 source
   lines, 110 test lines.
3. Memory probe in the serve process: about 170 source lines, 120 test lines.

Docs: about 30 lines in `docs/server/operations.md`. Total about 520 lines.

What the fuller design buys: track 2 covers every other cause of a transient
startup failure (another default-profile lock, a full disk that clears, a slow
dependency), which track 1 does not. Track 3 is the second request.

## Stated preferences this plan trades against

- **PID-liveness reclaim was declined.** `src/lib/file-lock.ts:83-87`:
  *"PID-liveness fast reclaim (steal immediately once the holder's pid is gone)
  would remove the wait entirely and was explicitly declined (boxholder
  decision, 2026-08-01): it adds a second liveness authority next to the mtime
  CAS."* The handoff suggested it as one option. This plan does not use it. The
  request profile reaches the same result for this lock inside the existing
  model.
- **Request profile entry condition.** `src/lib/file-lock.ts:78-80`: *"That
  bound is the entry condition for the profile, not a hope: a lock whose
  critical section runs a subprocess or arbitrary caller work stays on
  `default`."* Track 1 must show that the admission critical sections meet it.
- **Stop over-engineering rare failures** (boxholder feedback). Track 3 keeps
  to fixed thresholds and fixed file caps, with no growth-rate model.
- **Keep actionable failures visible; routine success behind debug** (root
  `AGENTS.md`). The probe writes to its own file when healthy and writes to
  stderr only when a threshold is crossed.
- **Minimize invented concepts.** The probe uses V8's own sampling heap profile
  format (`.heapprofile`, which Chrome DevTools opens). It adds no subsystem
  registry.

## What already exists

- `requestScopedLock(path)` and `LOCK_STALE_MS.request = 15_000`
  (`src/lib/file-lock.ts:190-217`). Reuse.
- `withAdmission` (`src/lib/box-maintenance/admission.ts:130-132`):
  `withFileLock({ lockPath: join(directory, "admission.lock"), metadata: {}, waitMs: 10_000 }, fn)`.
  This is the lock the restarts hit. `acquireBoxStartup` (`admission.ts:360`) →
  `acquireBoxWork` → `withAdmission`, called from the hub before the spawn
  (`src/hub/supervisor/child-spawn.ts:78`). The child also calls
  `acquireBoxWork` for its box writes, so it often holds this lock.
- Supervisor latch: `markFailedOrScheduleRestart` (`src/hub/supervisor/core.ts:498-508`):
  `if (box.consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) { box.status = "unhealthy"; return; }`.
  `reloadUnhealthy` (`core.ts:380-387`) clears it on SIGHUP. Backoff is
  1, 2, 4, 8 s (`crash-backoff.ts:16-30`). Extend.
- The dev router runs `bbx hub` per checkout, so this Supervisor serves dev
  boxes (`workstreams-app/src/router/server/listener.ts:287` comments). A prod
  unit host uses `socket-provider.ts` and systemd. Track 2 does not reach that
  path. Track 1 does.
- Periodic timers in serve: `scheduleVoiceSweep`
  (`src/webapp/routes/capture/voice-lifecycle.ts:15`) shows the start/stop
  wiring; `src/webapp/server/app.ts:428` uses an unref'd `setInterval`. Reuse
  the pattern.
- Manual memory inspection: `docs/server/operations.md:104` (*"`kill -USR1
  <node-pid>` opens the inspector"*). Extend that section.
- Searched `src` for `memoryUsage`, `getHeapStatistics`, `heapsnapshot`,
  `writeHeapSnapshot`: no hits. No memory instrumentation exists.

## Prior art (external)

- V8 sampling heap profiler via the inspector `HeapProfiler.startSampling` /
  `getSamplingProfile`: https://chromedevtools.github.io/devtools-protocol/tot/HeapProfiler/ and https://nodejs.org/api/inspector.html
  Adopted as the mechanism (a platform API, not a copied project; no
  ACKNOWLEDGEMENTS entry).
- Datadog's always-on Node heap profiler uses the same sampler at a 512 KiB
  interval in production (`@datadog/pprof`, `heap.start(512 * 1024, 64)`):
  https://github.com/DataDog/pprof-nodejs . Evaluated only: it supports
  "always-on at 512 KiB is cheap". Overhead is measured in chunk 3 rather than
  assumed.
- `--heapsnapshot-near-heap-limit` (https://nodejs.org/api/cli.html#--heapsnapshot-near-heap-limitmax_count).
  The docs warn that the snapshot needs about the heap's size again in memory
  and disk, and may still fail. Evaluated and not made the default. See NOT in
  scope.

## Ontology

- **Admission lock**: `.git/bbx-maintenance/admission.lock` (existing). It moves
  from the default to the request profile.
- **Unhealthy retry**: a supervisor timer that relaunches an `unhealthy` box
  every `UNHEALTHY_RETRY_MS`. It is NOT a status. The box stays `unhealthy`
  until a launch succeeds.
- **Memory sample**: one JSON line in `.beebox/memory/samples.jsonl`:
  `{ at, pid, rssMB, heapUsedMB, heapTotalMB, heapLimitMB, externalMB, arrayBuffersMB, resources }`.
- **Heap threshold**: a fraction of `heap_size_limit` (0.5, 0.7, 0.85). Each one
  fires at most once per process.
- **Heap profile**: `.beebox/memory/<iso>-pid<pid>-<pct>.heapprofile`, the V8
  sampling profile written when a threshold fires.

## Tracks / scope

### Track 1: admission lock recovers in seconds

- **What**: `withAdmission` uses `requestScopedLock(join(directory, "admission.lock"))`.
- **Why**: a holder killed inside the section leaves a guard directory that
  blocks every admission for up to 5 min. On 2026-10-25 every restart in that
  window failed, and the supervisor's budget (about 15 s of backoff plus 10 s
  waits) ran out first. "pid -1" means the sidecar was absent or unreadable
  (`readHolder`, `file-lock.ts:327`); a kill between the guard `mkdir` and the
  sidecar rename (`file-lock.ts:369-377`) is one way to get there. An orphaned
  `admission.lock.*.tmp` from 2026-10-04 in the same box shows that window was
  hit once before. The stale guard also refuses every admitted box write from
  any process (CLI writes by box agents included) for the same 5 min, not only
  startup.
- **Direction**: the three critical sections are file operations only:
  `acquireBoxWork` (`admission.ts:148-195`: lease `acquireLock`, `inspectLock`,
  `readPhase`), `drain` (`admission.ts:328`: `scanLocks` of `work/`), and
  `complete` (`admission.ts:341-346`: `inspectLock`, `scanLocks`, release). No
  subprocess and no caller callback, so the entry condition holds.
  Timeline after this change: the dead guard's mtime is 0 to 7.5 s old at the
  crash (refresh every `stale/2`), so it is stale 7.5 to 15 s after the crash.
  The first restart's 10 s wait starts at about crash + 1 s. The second
  starts at about crash + 13 s and reclaims it.
- **Trade**: a live holder paused more than 15 s inside the section (a laptop
  sleep) can be stolen from. The lock serializes lease publication against a
  drain's empty-directory check (`admission.ts:128-129`). A steal can let a
  drain miss one writer that is mid-publication. `onCompromised` logs it after
  the fact; it does not restore exclusion. Two things must coincide: a stall of
  more than 15 s inside a millisecond section (a laptop sleep, or a GC thrash
  just before an OOM), and a maintenance drain on that box at that moment.
  Maintenance runs from deploys on the Linux host, where sleep does not occur.
  Accepted as a documented risk; the alternative (Codex review) is to keep the
  default profile and let Track 2's slow retry outlast it, which means a
  5-minute outage per crash, and on the prod unit path (no Track 2) a box that
  stays failed.
- **First chunk**: the one-line change, plus a test: a guard directory with no
  sidecar and an mtime 20 s old does not block `acquireBoxStartup`; one with a
  fresh mtime still blocks (`LockHeldError` after the wait). The existing
  publication-barrier test (`test/lib/box-maintenance.test.ts:164`) must still
  pass; it calls `acquireLock(admissionPath)` with a bare path, so it changes
  to `requestScopedLock(admissionPath)`.

### Track 2: the supervisor never gives up

- **What**: when a box reaches `MAX_CONSECUTIVE_FAILURES`, it is still marked
  `unhealthy`, and a timer retries the launch every `UNHEALTHY_RETRY_MS = 5 min`.
- **Why**: the latch converts any transient startup failure into an outage
  that needs a human. The boxholder: "a box child that crashes must come back
  without a human."
- **Direction**:
  - `crash-backoff.ts`: `export const UNHEALTHY_RETRY_MS = LOCK_STALE_MS.default;`.
    It is tied to the default stale window so that any default-profile lock a
    dead child left has cleared by the first slow retry.
  - `markFailedOrScheduleRestart`: on reaching the limit, set `unhealthy`, warn
    once on entry (`[hub] <slug> unhealthy after 5 failed starts: <lastError>; retrying every 5 min (SIGHUP retries now)`),
    and arm `box.restartTimer = setTimeout(() => void this.launch(box), unhealthyRetryMs)`
    (unref'd). A failed slow retry passes through the same function, so it
    stays `unhealthy` and re-arms. It warns only on the transition into
    `unhealthy`, not on each slow retry.
  - `launch()` sets `status = "starting"` at entry. That would hide `unhealthy`
    during a slow retry. Keep it: during a retry the box is starting, and
    `isBoxBroken` (`src/hub/health.ts`) already counts `starting` with
    `consecutiveFailures > 0` as broken (`test/hub/health.test.ts:47`).
  - `reloadUnhealthy`: clear `restartTimer` before launching, so a SIGHUP and a
    pending slow retry cannot both spawn.
  - `SupervisorOptions.unhealthyRetryMs` for tests, as with `baseBackoffMs`.
  - A maintenance refusal (`BoxMaintenanceError`, `core.ts:444-450`) on a
    resident (non-lazy) hub sets `stopped`, and nothing relaunches it. On a
    resident hub, arm the same slow timer without counting a failure. A lazy
    hub keeps today's behavior: the next request starts it.
  - `stopAll` during an in-flight launch: `launch` re-checks
    `box.status === "stopped"` after `spawnBoxChild` and after readiness, and
    kills the child it made instead of marking it running.
  - Lazy mode: `ensureRunning` on an `unhealthy` box still returns `undefined`
    (`core.ts:245-251`); the timer does the retry. A request does not trigger
    an early retry, so a phone that retries does not cause a restart storm.
- **First chunk**: the change plus a supervisor test: spawn fails 5 times, the
  status is `unhealthy`, then spawn succeeds and the box reaches `running`
  after the injected retry delay with no `reloadUnhealthy` call. Second test:
  `reloadUnhealthy` with a pending slow timer spawns once. Third: `stopAll`
  while a delayed spawn is in flight leaves no running child. Fourth: a
  resident hub whose launch is refused by maintenance relaunches on the slow
  timer once the refusal ends.

### Track 3: memory probe

- **What**: `src/webapp/server/memory-probe.ts`, started by serve for each
  served box's `.beebox/memory/`, stopped on server close.
- **Why**: two prior prod OOMs needed a temporary instrumentation patch to
  diagnose. This one left only a native stack.
- **Coverage**: the profile attributes growth of the serve process's
  JavaScript heap to allocation stacks. RSS, `external`, and `arrayBuffers`
  are sampled, so native or buffer growth shows in the series, but the probe
  names no cause for it. Subprocesses (Claude Code, ffmpeg) are not measured;
  on the unit host they share the cgroup's `MemoryMax=2G`
  (`deploy/systemd/box-sandbox.conf:34`).
- **Direction**:
  - `startMemoryProbe({ dirs, now?, read?, sampleMs?, checkMs? }): () => Promise<void>`.
  - At start: connect `inspector.Session`, run `HeapProfiler.startSampling({ samplingInterval: 512 * 1024 })`.
    If the inspector is unavailable, log one warning and run without profiles.
  - Every `checkMs` (10 s): read `process.memoryUsage()` and
    `v8.getHeapStatistics().heap_size_limit`. A pure function
    `thresholdsCrossed(fired, ratio)` returns the newly crossed thresholds. For
    the highest one: `HeapProfiler.getSamplingProfile`, write the profile to
    every dir, and `console.warn` one line with the percentage, the MB figures,
    and the file path.
  - Every `sampleMs` (60 s): append a sample line. When `samples.jsonl` passes
    1 MiB, rename it to `samples.1.jsonl` (replacing the old one). That is about
    3 days of history at about 250 bytes a line, and at most 2 MiB on disk.
  - Measured (chunk 3): with the profiler on, three 320 MB index restores ran
    within the noise of runs without it. A profile taken at a 1.2 GB heap was
    115 KB and took 120 to 330 ms, with no RSS increase.
  - Keep the newest 6 `.heapprofile` files per dir and at most 64 MiB in
    total; delete the oldest at write time. Chunk 3 measures a real profile's
    size and the peak RSS cost of taking one at a 2 GB heap; if that cost is
    not small against the cgroup headroom, the 85% threshold is dropped.
  - Write errors log once per process and never throw into the server.
  - Timers are unref'd; all work is skipped while a previous write is still
    pending.
- **First chunk**: the pure threshold function, the sample writer with
  rotation, and their tests, with no inspector yet.

### Track 4: the OOM's cause

- **What**: best effort to identify what grew to 3.9 GB live in 11 minutes.
  Findings are reported; they do not gate this plan's completion.
- **Known so far**: the last allocation was an `fs.promises` read decoded as
  UTF-8 into a two-byte string (native stack `FSReqPromise::Resolve` →
  `StringSlice<UTF8>` → `NewFromTwoByte`). The last Mark-Compact went from 4006
  to 3940 MB, so the memory was retained, not transient garbage. Activity:
  about 6 voice chat turns from iOS, TTS playback, and a voice-recording sweep
  that deleted 46 recordings. No web search ran.
- **Investigation result (2026-10-25): cause not found.** The decode on the
  stack takes Node's copying path, used only for strings under about 1M
  characters, so the last read was a small file. That rules out the large
  index files; the read was the last allocation, not the retainer. The heap
  filled at about 15:19, during the fifth turn: phone log lines stamped 15:19:02
  arrived at 15:19:36, and the voice sweep due at 15:18:57 logged at 15:19:54.
  The TTS EPIPE and the aborted fetch came after the stall, so they are
  effects. The same build ran 16 turns from 09:22 to 09:58 that day without an
  OOM. Measured against the box, read-only, and all bounded (retained after GC):
  chat history (+2 MB), chat lists (+8 MB), box home (+9 MB, 348 MB peak per
  call), landmark scan (+9 MB), after-turn title check (~0), transcript-tail
  poll (+8 MB), sweep reads (0). The merges since 2026-10-22 add no unbounded
  cache. What differed in the 15:08 session: the phone's web view reloaded
  after six hours in the background, the first sweep that deleted anything
  (46 recordings), and a longer message. The probe (Track 3) is what will
  name it next time.
- **Separate risk found**: the box's card search index is 320 MB, and
  `openSearchIndex` restores it whole on every web search query
  (`src/core/search/refresh/core.ts:94,121`). One restore, measured standalone
  on this box: 464 MB retained heap, 1.4 GB peak RSS, 2.2 s. Concurrent queries
  stack. Not this crash's cause (no search ran). Recorded as a re-encounter on
  `issues/decisions/2026-07-10-orama-vector-index-restore-cost.md`.
- **Direction**: a cause that is a separate bug is filed with the issues skill,
  and the boxholder decides whether it is fixed here.

## Could this be simpler?

The simplest version is track 1 alone. It fixes the reported incident. It fails
when a different startup lock, or anything else that clears with time, outlasts
five fast retries: the box then latches again and needs a human, which the
boxholder ruled out. Track 2 is about 45 lines and covers that whole class.

A simpler probe would log `process.memoryUsage()` every minute to stderr. That
puts routine output where failures go, and it tells you that the heap grew but
not where. The sampling profile is what ties growth to a call stack, which the
handoff asks for. The threshold function is the only decision in the probe, so
it is the only pure function.

## Subplans

none

## Failure modes

| What can fail | Test exists? | Handling exists? | Clear-or-silent? |
|---|---|---|---|
| Admission holder paused > 15 s gets stolen from; drain misses a mid-publication writer | No (accepted trade, Track 1) | `onCompromised` logs | Clear (stderr) |
| `stopAll` during an in-flight launch leaves a child running | Track 2 test | Re-check `stopped` after spawn and readiness | — |
| Maintenance refusal on a resident hub leaves the box stopped for good | Track 2 test | Slow timer, no failure counted | — |
| A slow retry and a SIGHUP spawn two children | Track 2 test | Clear the timer in `reloadUnhealthy` | — |
| A box that can never start (ABI break) retries forever | Track 2 test (it re-arms) | One spawn every 5 min; warn once on entry | Clear (status + one warn) |
| `getSamplingProfile` + `JSON.stringify` near the limit causes the OOM itself | No | Highest threshold is 85%: about 600 MB free at a 4 GB limit, about 280 MB at prod's ~1.9 GB | Clear: the crash log shows it |
| Inspector session unavailable (another tool owns it, or a build without the inspector) | Track 3 test with an injected failure | Warn once; samples continue | Clear |
| Profiler overhead slows the server | Chunk 3 microbenchmark | Raise the interval if over 2% | — |
| `.beebox/memory/` fills disk | Track 3 rotation test | 2 MiB samples + 6 profiles | — |
| A leak climbs past all thresholds within 10 s | No | Accepted: the samples show the climb; the 50% profile usually came earlier | Silent between checks |

Accepted after review (pre-existing, not changed here):

- During a development-bundle reload, `onChildExit` ignores every exit while
  `reloadPromise` is set (`src/hub/supervisor/core.ts`), including the
  replacement's. A replacement that dies between readiness and
  `maintenance.complete()` (up to the admission wait, 10 s, under contention)
  can be left marked running. Development path only.
- A child spawned while `stopAll()` runs is signaled but not awaited, so it can
  outlive the hub briefly; its orphan check (`src/webapp/server/app.ts`, every
  2 s) shuts it down.

No critical gap: every silent row is accepted above with its reason.

## Agent-flow / user-flow edge cases

- Wrong tag / wrong field: not applicable; no agent-facing vocabulary.
- Stale ref: ADDRESSED. A stale admission guard is the bug Track 1 fixes.
- Two agents touching the same card: not applicable.
- Hand-edit drift: not applicable.
- Fabricated free-form value: not applicable.
- Validation error UX: ADDRESSED. `lastError` keeps the real cause; the hub
  warning says that retries continue and that SIGHUP retries now.
- Partial migration / transition state: ADDRESSED. Old and new engines on one
  box during a deploy agree on mutual exclusion. They disagree only on when a
  dead admission guard becomes stale, and the older one waits longer.

## NOT in scope

- PID-liveness reclaim in `file-lock.ts`: declined by the boxholder on
  2026-08-01. Track 1 reaches the same recovery for this lock.
- `--heapsnapshot-near-heap-limit` by default: at a 4 GB heap it writes about
  4 GB per crash and needs about that much memory again. Documented as a
  manual opt-in through `NODE_OPTIONS` in `docs/server/operations.md`.
- A clearer "pid -1" message: diagnostics only; the hub warning carries the
  error.
- Growth-rate alerts (MB per minute): fixed thresholds of the heap limit
  answer "is this dangerous"; the sample history answers "how fast".
- The prod unit host's systemd restart policy: `beebox-box@.service:19-20`
  (`StartLimitIntervalSec=300`, `StartLimitBurst=5`) leaves a unit failed until
  a deploy or `systemctl reset-failed`, and `socket-provider.ts:198` does not
  wake a failed unit. Track 1 removes this incident's cause there. Changing
  the start limit is a boxholder decision (Open design questions); the unit
  path is not yet live in production.
- Fixing the 320 MB search-index restore: an open decision issue already
  covers it; this work added a re-encounter note.

## Open design questions

- Prod unit path: should a failed `beebox-box@` unit also retry without a
  human (for example a periodic `reset-failed` from the hub, or systemd's
  `RestartSteps`/`RestartMaxDelaySec`, which need systemd 254 or newer)? Lean:
  yes, as a follow-up in the box-isolation work, since that path is not live.
- `UNHEALTHY_RETRY_MS = 5 min` versus 1 min. Lean: 5 min. It matches the
  default stale window, and Track 1 already handles the fast case.

## Knowledge audits

None: purely infrastructural. No box-agent concept changes.

## What will hold this after it ships

- Track 1: a test in `test/lib/box-maintenance.test.ts` with a stale guard
  directory (mtime set back with `fs.utimes`), which is the incident's shape.
- Track 2: supervisor tests with the fake spawn and an injected
  `unhealthyRetryMs`, in `test/hub/supervisor.test.ts`.
- Track 3: `thresholdsCrossed` as a pure function, plus a probe test with an
  injected memory reader, small intervals, and a temp dir. It checks the
  sample line, the rotation, profile pruning, and the inspector-failure path.

## Implementation order

1. Track 1: the lock profile change and its test. Commit.
2. Track 2: the supervisor slow retry and its tests. Commit.
3. Track 3: the pure threshold function and sample writer, then the inspector
   profile, then serve wiring and an overhead microbenchmark. Commit.
4. Docs: `docs/server/operations.md` memory section (where the probe writes,
   how to open a `.heapprofile`, the `NODE_OPTIONS` opt-in). Commit.
5. Track 4 findings reported; separate bugs filed. Not a completion gate.
6. Verify end to end on the worktree's test box clone: the probe writes
   samples; a forced crash inside `withAdmission` recovers without SIGHUP.

## Rollout shape

Done when the Track 1–3 tests pass, the change-selected tests and
`pnpm typecheck` / `pnpm layout-check` pass, and the test box clone shows a
child killed while holding the admission lock returning to `running` with no
human action. No data migration: `.beebox/memory/` is new disposable state.

Verified 2026-10-25 on the worktree's test box clone under a resident hub: the
first sample appeared at startup (142 MB heap of a 4288 MB limit). A fresh
admission guard with no holder file was created and the child was SIGKILLed;
the hub's restart reclaimed the guard and the new child was serving 17 s
later, with no human action. The change-selected suite (618 files, 7391
tests) passed before the round 1 review fixes; their suites passed after.

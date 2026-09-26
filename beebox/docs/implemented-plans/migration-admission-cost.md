---
title: "Maintenance closes a box only when it has work, and says who holds it"
status: implemented
workstream: migration-admission-cost
issues:
  - ../../../issues/closed/bugs/2026-09-15-scheduled-sweep-closes-admission-before-knowing-it-has-work.md
---
# Maintenance closes a box only when it has work, and says who holds it

The hourly convergence sweep shut a box for ten minutes, refused every chat
message in that window, and then found it had nothing to apply. This plan makes
maintenance look before it closes, makes the scheduled pass yield to a box in
use, and makes every admission name its holder so a blocked drain reports who
blocked it.

**Issues addressed:**
`issues/bugs/2026-09-15-scheduled-sweep-closes-admission-before-knowing-it-has-work.md`.
Related, not addressed: `issues/bugs/2026-09-15-full-suite-red-migration-reliability-ba7121b7.md`
(resolved in `0e37ecba0`; same gate, different failure). Searched the queue for
`admission`, `drain`, `box maintenance`: no duplicates.

## Smallest fix and budget

Smallest fix: read the manifest under an ordinary work lease before
`acquireBoxMaintenance` in `sweepMigrations`, and return `current` when nothing
is pending (~40 lines). It removes the incident as observed. It leaves three
things the incident exposed: a scheduled pass still evicts a box that is in
use whenever it does have work; a blocked drain still reports nothing about
what blocked it (the incident's holder was a `bbx serve` process with no chat
subprocess, held for 90 minutes, and could not be identified before the server
restarted); and the refusal still names neither the reason nor the wait.

Chosen design, four tracks, in dependency order:

| Track | Source | Tests |
|---|---|---|
| A. Every admission names its holder; drain timeout lists holders | ~180 | ~70 |
| B. Sweep and docs refresh peek before closing | ~70 | ~70 |
| C. Scheduled sweep yields to a box in use, bounded | ~90 | ~60 |
| D. Refusal names reason and deadline; chat client retries after it | ~120 | ~50 |

About 800 changed lines plus this plan. Not a BIG CHANGE.

## Stated preferences this plan trades against

- Principle 4 (*Resilient AND never silent*): Track C makes the scheduled pass
  quieter (it defers instead of failing), so it also makes deferral visible
  after a bound. A deferral older than 24 hours is reported, not swallowed.
- Principle 6 (*Right-sized defensiveness*): Track A adds a sidecar rewrite per
  admission change. Coalesced to one write per 250 ms per process, because
  tRPC batches admit many short requests per second.
- `feedback_minimal_concepts_prefer_primitives`: Track D uses the HTTP
  `Retry-After` header rather than a bespoke field; the client reads the
  header.
- `feedback_nothing_retries_forever`: Track C's deferral and Track D's client
  retry are both bounded (24 h report; one retry, capped at the drain limit).
- Boxholder decision (2026-09-15, this workstream): "If the box has to go down
  for maintenance, then okay, but absolutely only if that's the case." Tracks B
  and C implement that rule for the scheduled path. Deploy and reload keep
  their drain.

## What already exists

- Gate: `src/lib/box-maintenance.ts`. `acquireBoxWork` (line 76) holds one
  file lock per process with an in-process count; `closeBoxMaintenance` (line
  140) writes `phase.json` then `drain()` (line 206) polls `scanLocks` until
  the work directory is empty, 10-minute default. `acquireBoxMaintenance`
  (line 224) welds close and drain. Reuse; extend.
- Lock sidecar metadata: `src/lib/file-lock.ts:372` `acquireLock(target,
  metadata)` writes `{pid, hostname, acquiredAt, metadata}` once; `scanLocks`
  (line 548) returns live holders with that metadata. No update function
  exists; Track A adds one.
- Server-side quiesce: `src/webapp/server.ts:404-419` polls
  `boxMaintenanceStatus` every second and, when a phase exists and the box is
  idle, closes idle chat runs (`registry.quiesceForMaintenance`,
  `session.pauseForMaintenance` → `restart()`), releasing their run leases. So
  an idle chat already holds nothing once maintenance closes. Reuse as is.
- Lock-free status read: `src/cli/commands/migrate.ts:270-277`
  (`--status --json`) reads `readManifest` + `computePending` +
  `migrationQuestions` with no admission. Track B's predicate is the same
  reads.
- Docs currency: `src/core/docs-refresh.ts:44` `refreshSnapshot` checks the
  pending ref and `generatedDocsAreCurrent`; Track B splits the cheap check
  out.
- Schedule result parsing: `schedules/box-convergence/results.ts`
  `resultSchema` + `resultDetail`. Track C adds a `deferred` status.
- Client send retry: `src/frontend/src/api-chat.ts:326-333` retries once on
  network `TypeError` only; 5xx throws `RequestError`. Track D adds the
  `Retry-After` path beside it. The diagnostics event
  `post-retry-scheduled` (`chat-send-diagnostics.ts:25`) exists with
  `reasonKind: "network"`; Track D adds `"maintenance"`.
- CLI top-level: `src/cli/index.ts:229` prints `BoxMaintenanceError.message`
  and exits 1. That is why the drain timeout produced no JSON line and the
  schedule reported "Unknown result".

## Prior art (external)

No design decision depends on an external premise. `Retry-After` on 503 is RFC
9110 §10.2.3; the client honours it directly.

## Tracks / scope

### A. Every admission names its holder

**What.** `acquireBoxWork` takes a `reason`. The per-process lock sidecar lists
the live reasons and when each was admitted. `drain()`'s timeout error and the
new `boxWorkHolders(boxRoot)` report them.

**Why.** The incident's blocker was never identified: the server held one
lease for 90 minutes with no chat subprocess alive, and the process was
restarted before it could be inspected. The plan's own rule
(`docs/plans/migration-reliability.md:244`: *"On drain timeout, abort
maintenance and report the blocking work"*) is unmet; today's detail is the
maintenance reason, not the blocker.

**Direction.**
- `file-lock.ts`: `updateLockMetadata(target, metadata)` rewrites the sidecar
  for a lock this process holds (no-op otherwise).
- `box-maintenance.ts`: `acquireBoxWork(boxRoot, inherited?, reason = "work")`;
  `withBoxWork(boxRoot, fn, reason?)`. The process entry keeps
  `holders: Map<symbol, { reason, since }>`; changes mark dirty and flush the
  sidecar `{ id, holders: [{ reason, since }] }` after 250 ms (unref'd), plus a
  final flush on release to zero. `workHolderSchema` parses it.
- `boxWorkHolders(boxRoot): Promise<WorkHolder[]>` — `scanLocks` on the work
  directory, flattened to `{ pid, reason, since }`, excluding this process.
- `drain()` timeout: `BoxMaintenanceError({ reason: "timeout", detail })` with
  detail `"<maintenance reason>; held by <reason> since <ISO> (pid N), …"`.
- Callers pass reasons: chat run `chat run <sessionId|new>`, HTTP
  `<METHOD> <path>`, tRPC `trpc <path>`, scheduler `scheduler pass`, chat
  schedules `chat schedule <id>`, thread session `thread <ref>`, CLI
  `bbx <command>`, startup `startup`, state migration `state migration`.

**Vocabulary lock-ins.** Sidecar field `holders`; `WorkHolder` type.

**First chunk.** `updateLockMetadata` + holders in `box-maintenance.ts` +
timeout detail + doctest in `test/lib/box-maintenance.doctest.md`. Call-site
reasons in the same commit (typecheck forces none; grep-driven).

### B. Sweep and docs refresh peek before closing

**What.** Both operations read their "is there work?" inputs under an ordinary
work lease and skip `acquireBoxMaintenance` when the answer is no.

**Why.** `src/core/migration-sweep.ts:70` closes on its first line; the
manifest read is inside the gate. `pending: []` on the incident box.

**Direction.**
- `migration-sweep.ts`: `sweepHasWork(boxRoot, refresh)` = manifest missing
  (no-manifest needs the gate to report consistently? No — `no-manifest` is a
  pure read; return it without the gate) or `computePending` non-empty or
  `migrationQuestions` non-empty or (`refresh` and `docsRefreshHasWork`).
  In `sweepMigrations`, when `!opts.withinMaintenance`: `peek = await
  peekBoxWork(boxRoot, () => sweepHasWork(...), "migration peek")`; `peek ===
  false` → `{ status: "current" }`; `peek === null` (gate closed) → proceed as
  today (the `--repair` recovery case).
- `docs-refresh.ts`: `docsRefreshHasWork(boxRoot)` = pending ref exists or
  `!generatedDocsAreCurrent`. Same peek when `!opts.withinMaintenance`.
- `box-maintenance.ts`: `peekBoxWork<T>(boxRoot, fn, reason): Promise<T |
  null>` — `withBoxWork` that returns `null` on `BoxMaintenanceError`.
  Released before any escalation, so `acquireBoxMaintenance` sees no nested
  permit.

**Vocabulary lock-ins.** none.

**First chunk.** Both predicates, `peekBoxWork`, doctests asserting no
`phase.json` is ever written on a current box (watch the gate directory).

### C. Scheduled sweep yields to a box in use

**What.** `bbx migrate --sweep --yield`: when the peek finds work but another
process holds a work lease, return `{ status: "deferred", holders }` and exit
0. The schedule passes `--yield`. Deploy (`bbx maintenance`) and reload do
not.

**Why.** Boxholder rule above. The hourly pass is convergence, not a deploy;
next hour is fine.

**Direction.**
- `SweepOptions.yield?: boolean`. After a peek that says work, close with
  `drainMs: 15_000`; a `timeout` in yield mode is `deferred` with the holders
  read back. No lease check before closing: an idle chat run holds its lease
  until the server sees a phase and closes it (`server.ts:404-419`), so
  leases alone cannot distinguish "in use" from "idle"; the brief close lets
  the server free idle runs, and only work that outlasts the wait defers
  (cross-model review finding, 2026-09-15). Sweep result type gains
  `{ status: "deferred"; holders: WorkHolder[] }`; CLI JSON exit 0.
- `results.ts`: `deferred` → `null` unless the oldest holder `since` is over
  24 h old → `"deferred; box has held work for <n>h: <holders>"`. The lease
  `since` is the durable clock; no schedule state file.
- `run.ts`: add `--yield` to the sweep invocation.

**Vocabulary lock-ins.** CLI flag `--yield`; sweep status `deferred`.

**First chunk.** All of the above with a doctest using
`test/helpers/box-maintenance-child.ts` as the foreign holder, and a
`convergence.test.ts` case for the 24 h bound.

**Follow-up (`c97fea1ad`).** The peek above only sees another work lease, not
the maintenance owner lock itself: a deploy holding that lock made
`acquireBoxMaintenance` raise a bare `LockHeldError` before any peek or drain,
which the sweep didn't classify as deferrable and the schedule alerted on
every prod box. `closeBoxMaintenance` now wraps that case in a
`BoxMaintenanceError` naming the owner from its lock sidecar
(`box-maintenance.ts`), and a yielding sweep reports it `deferred` like live
work (`migration-sweep.ts`).

### D. Refusal names the reason and deadline; the chat client retries

**What.** `phase.json` gains `until` (drain deadline). The `closed` error
reads `Box is closed for <reason>; expected to reopen by <time>`. The HTTP 503
carries `Retry-After`. The chat client waits and retries once.

**Why.** Today's message is `Box admission is closed; retry after
maintenance` with a dismiss button (`api-chat.ts:318` → `RequestError`).

**Direction.**
- `phaseSchema.until: z.string().datetime().optional()`; written by
  `closeBoxMaintenance` for the `draining` phase from `drainMs`; absent for
  `exclusive`/`ready` (unknown).
- `BoxMaintenanceError` gains `retryAfterMs?: number`; `acquireBoxWork` sets
  it from `until`. Message for `closed`: reason and local time when known.
- `box-admission.ts`: 503 with `Retry-After: <ceil(seconds)>` when present.
- `api-chat.ts`: on 503 with `Retry-After` ≤ 10 min, record
  `post-retry-scheduled { reasonKind: "maintenance", delayMs }`, wait, retry
  the same message id once. Safe: the 503 comes from the `onRequest` hook
  before the handler records anything (`box-admission.ts:36-60`). A second
  503 fails as today.

**Vocabulary lock-ins.** `until` in `phase.json`; `retryAfterMs` on the
error; `reasonKind: "maintenance"`.

**First chunk.** Backend (schema, error, header) with doctest; then client.

## Could this be simpler?

Simplest: Track B alone. It removes the incident. It fails on the case the
boxholder named: a box with real pending work is still taken away from the
person using it, hourly, and a blocked drain still says nothing about who
blocked it (the incident's real holder remains unknown). Track A is what
turns the next unexplained hold into a named one; Track C is the stated rule;
Track D is the user-facing half of principle 4.

Considered and rejected: a `peek` mode on the maintenance API. What counts as
work is per operation; `peekBoxWork` is a nine-line wrapper over
`withBoxWork`, and the predicates stay with the operations.

Considered and rejected: per-turn chat leases. The server already releases
an idle run's lease within a second of a close (`server.ts:404-419`); the
incident's holder was not a chat run.

## Subplans

none

## Failure modes

| What can fail | Test exists? | Handling exists? | Clear-or-silent? |
|---|---|---|---|
| Peek reads a stale manifest; a migration lands between peek and next sweep | no | next hourly sweep applies it | clear (one-hour delay) |
| Peek is refused because a phase exists (interrupted maintenance) | B doctest | falls through to today's recover path | clear |
| Holder arrives between the yield check and close | C doctest | 5 s drain → deferred | clear |
| Holder leaks (as in the incident) | A doctest for the report; leak itself unknown | deferral reported after 24 h with the holder's reason; deploy drain names it | clear |
| Sidecar rewrite races the lock's own release | A doctest | `updateLockMetadata` no-ops when the lock is not held | silent by design |
| `until` absent (exclusive phase, old writer) | D doctest | message omits the time; no `Retry-After`; client fails as today | clear |
| Client retries after `Retry-After` and is refused again | D doctest | fails with the reason message | clear |
| Prod engine older than the schedule's flags (`--repair` today, `--yield` next) | existing alert shows it | schedule reports "unknown option" hourly until deploy | clear, noisy |

No critical gap. The last row is pre-existing (open alert
`20260914-194454-28ae`) and resolves on the next deploy.

## Agent-flow / user-flow edge cases

- Wrong reason string at a call site — ADDRESSED: reasons are diagnostic
  only; nothing branches on them.
- Stale ref — not applicable (no card refs).
- Two agents on the same card — not applicable.
- Hand-edit drift — `phase.json` and sidecars are gate-owned; a hand-edited
  `until` fails `z.string().datetime()` and the phase read throws, as any
  malformed phase does today. ADDRESSED by existing parse.
- Fabricated value — not applicable.
- Validation error UX — the `closed` message is the UX; Track D.
- Transition state — a serve started before Track A writes no `holders`;
  `scanLocks` readers treat a missing field as `[]`. ADDRESSED in the schema.

## NOT in scope

- Identifying the incident's leaked holder: the process restarted before
  inspection. Track A makes the next one name itself; filed separately.
- Per-turn chat leases: the idle case is already released by the server
  poll; changing lease granularity risks cold-spawning a subprocess per turn
  (`warmCompatible` keys on the permit).
- tRPC mutations refused during maintenance get the better message but no
  auto-retry; chat send is the reported surface.
- Prod schedule flag mismatch: resolves on deploy; the alert already shows
  it.
- The fleet path in `bbx maintenance` (deploy) keeps closing every box before
  draining any; a deploy must land.

## Open design questions

- Should `--yield` defer only to interactive holders (chat, HTTP) and not to
  scheduler passes? Lean: defer to any holder; the 24 h bound reports a
  perpetually busy box either way. Settle after the first week of alerts.

## Knowledge audits

Purely infrastructural; no box-agent-facing concept. Skipped.

## What will hold this after it ships

Doctests, all in the existing tiers: `test/lib/box-maintenance.doctest.md`
(holders, timeout detail, `until`, `peekBoxWork`),
`test/core/migration-sweep.doctest.md` and `test/core/docs-refresh.doctest.md`
(no `phase.json` on a current box; deferred), `test/webapp/box-admission.doctest.md`
(`Retry-After`), `schedules/box-convergence/convergence.test.ts` (24 h bound).
The client retry is a pure decision in `api-chat.ts`; covered by its existing
test file with a mocked `fetch`.

## Implementation order

1. A — lock metadata update, holders, timeout detail, call-site reasons.
2. B — predicates, `peekBoxWork`, no-close-when-current.
3. C — `--yield`, deferred status, schedule wiring and reporting.
4. D — `until`, `Retry-After`, client retry.
5. Cross-model review; issue for the unidentified leak; docs
   (`docs/cards/migrations.md` admission section) updated.

## Rollout shape

Tests first per track, named above. Done when they pass with `pnpm typecheck`
and `pnpm lint:changed` clean. No data migration: `phase.json` and sidecar
fields are optional additions read by the same code that writes them.

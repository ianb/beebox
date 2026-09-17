---
title: "A box closure cannot outlive its maintenance owner"
status: active
workstream: box-maintenance-no-wedge
issues: []
---
# A box closure cannot outlive its maintenance owner

Box maintenance closes a box to ordinary work while a migration, deploy, or
reload changes it. On 2026-09-16 that closure outlived the process that made it,
and four local boxes refused every request until repaired by hand. This plan
makes the refusal end when the owning process ends, so no maintenance outcome
can leave a box unusable. It amends
[migration-reliability.md](migration-reliability.md), which chose to keep a box
closed after an uncertain failure.

**Issues addressed:** none filed. Searched `issues/` and `private-issues/` for
`wedge`, `bbx-maintenance`, `closed for migration`, `No running box`, and
`admission closed`; no match concerns box maintenance.

## Smallest fix and budget

The smallest fix shipped on `main` as `ea8e67884`: the sweep reopens the box
when it stops at a procedure migration. It closes one path. The boxholder asked
for the class to be closed: "We need to make sure that's proper fixed, that it
can't get wedged like that."

Chosen design, three tracks:

1. Gate rule: a phase record refuses work only while its owner lock is live.
   Estimate 120 source lines, 150 test lines.
2. Hub answers a closed or unstartable known box with an explained 503, not a
   404. Estimate 60 source lines, 60 test lines.
3. The convergence schedule writes its findings to the run log every run.
   Estimate 15 source lines, 20 test lines.

Total estimate: 425 changed lines plus this plan. Not a BIG CHANGE.

The fuller design buys the property "no status, crash, timeout, failed deploy,
or failed reload can leave a box refusing requests". Per-path fixes cannot give
that property, because each new maintenance caller adds a new path.

## Stated preferences this plan trades against

- The boxholder, 2026-09-16: an indefinitely closed box is unacceptable. On
  rolling back partial output: "We have git history to protect most cases, and
  uncommitted work is often broken rather than valuable." On repair: "any chat
  will do I guess for self-repair"; the chat "just need[s] … to come up,
  with[out] being blocked by anything."
- `migration-reliability.md:238-240`: *"After mutation or replacement begins,
  owner death leaves admission closed until a new controller reconciles the
  attempt; lock expiry alone must not reopen it."* This plan reverses that
  sentence. Trade: a box may serve with uncommitted partial migration output in
  its tree. The pre-attempt state stays in the recovery ref
  (`refs/bbx/migrations/<name>/snapshots/<attempt-id>`), and committed history is
  untouched.
- `migration-reliability.md:284-285`: *"A committed partial migration with a
  durable question can reopen; an uncertain half-applied hard failure cannot."*
  Also reversed, for the same reason.
- Engineering principle 4, *"Resilient AND never silent"*
  (`docs/engineering-principles.md:49`): the box degrades to "open with
  unfinished maintenance", and that state is reported in health, the schedule
  alert, and the hub response.
- Standing preference "nothing retries forever": the closure is bounded by the
  owner's life, which the existing drain (10 min) and execution (15 min) limits
  bound.
- Standing preference "minimize invented concepts": the rule reuses the owner
  lock's existing liveness. It removes the `recover` option and the `recovery`
  refusal. It adds no recovery mode, admin chat, or reopen command.

## What already exists

- **Owner lock with liveness.** `src/lib/box-maintenance.ts:266`:
  `acquireLock(leasePath(permit), { id: permit.id, reason: opts.reason })` takes
  `owner.lock`. `src/lib/file-lock.ts:496` `inspectLock` returns the holder
  *"or null if not held (or stale)"*. Staleness is mtime freshness, 5 minutes
  for the default profile (`file-lock.ts:186-187`). Reuse.
- **Phase record.** `.git/bbx-maintenance/phase.json`, schema at
  `box-maintenance.ts:15-19`. `release()` keeps it after an incomplete changing
  attempt (`box-maintenance.ts:286`:
  `if (completed || !changing) await rm(...)`). Reuse as the record of
  unfinished maintenance; add a `since` field.
- **Gate readers that look only at the phase file.** `acquireBoxWork`
  (`box-maintenance.ts:152`, `:186`, `:188`), `closeBoxMaintenance`
  (`:292-295`), `acquireBoxStartup` (`:344`), and the server's one-second poll
  that pauses chat (`src/webapp/server.ts:415`). None asks whether the owner is
  alive. Change each to the new rule.
- **Supervisor recognises the refusal.** `src/hub/supervisor.ts:467-471` sets
  `box.lastError` and returns with the comment *"Admission closure is not a
  crashing generation."* The hub then answers
  `404 … "No running box for …"` (`src/hub/hub-server.ts:520`). The WebSocket
  path already answers a known, not-running slug with 503
  (`hub-server.ts:561-565`). Reuse that distinction for HTTP.
- **Health check.** `src/webapp/trpc/routers/health-migrations.ts:29-35` reports
  *"Admission closed: …"*. It runs in the box child, which could not start on a
  closed box. Under the new rule it becomes reachable; reword it.
- **Fenced answer path.** `src/core/migration-answer.ts:22-26` lets a boxholder
  answer a migration question while the box is closed. Under the new rule the
  ordinary answer path works whenever no live owner holds the box, so this path
  has no remaining caller state. Remove it.
- **Schedule report dedupe.** `schedules/box-convergence/run.ts:133` alerts only
  when the message changed or 24 hours passed. Findings are written nowhere
  else, so a repeat run has an empty log and the outcome `clean`.

Closure paths verified in source, all removed by Track 1:

| Path | Where |
|---|---|
| Sweep ends `failed`, `deferred-repair`, `commit-failed` | `src/core/migration-sweep.ts:139-153` completes only `current`/`applied`/`attention`/`needs-procedure` |
| Sweep throws or hits the execution timeout after `beginChanges()` | same block; `finally` releases without `complete()` |
| Deploy with a pending procedure migration | `deploy/deploy.sh:730` runs `--sweep --within-maintenance` with no procedure runner; `:731` *"box stays closed"*; `src/cli/commands/maintenance.ts:95-101` reopens only a `ready` box |
| Deploy command fails | `maintenance.ts:100` *"Box remains closed for recovery"* |
| Dev reload replacement not ready | `src/hub/supervised-reload.ts:63` `await maintenance?.beginChanges()` then release |
| Owner process killed | phase file remains; `closeBoxMaintenance` refuses without `recover` (`box-maintenance.ts:292-295`) |

## Prior art (external)

No design decision depends on an external premise. The liveness mechanism is
proper-lockfile's mtime refresh, already characterised in
`src/lib/file-lock.ts:89-103`, including its behaviour across system sleep.
One detail matters for the rule: `inspectLock` (`file-lock.ts:496`) uses
`.check()`, which reads mtime age and never steals, so a stale-looking owner is
not evicted and its `onCompromised` handler does not fire.

## Tracks / scope

### 1. The gate refuses work only under a live owner

**What.** One function decides closure: the box is closed when `phase.json`
exists and `owner.lock` has a live holder. A phase file without a live owner is
a record of unfinished maintenance and refuses nothing.

**Why.** Every closure path above ends with the owner releasing or dying while
the phase file remains. The file alone is what refuses work today.

**Direction.**

- `boxMaintenanceStatus(boxRoot)` returns
  `{ phase: Phase; owner: WorkHolder | null } | null`. `owner` comes from
  `inspectLock(owner.lock)`. Private helper `closedPhase(directory)` returns the
  phase only when `owner !== null`; `acquireBoxWork` (both reads) and
  `acquireBoxStartup` use it.
- `acquireBoxStartup`: live owner and phase `ready` admits the prepared
  generation as today; live owner otherwise throws `closed`; no live owner is
  ordinary startup.
- `closeBoxMaintenance`: remove `opts.recover` and the `recovery` refusal. A
  prior record without a live owner never blocks a new owner. Keep the existing
  rule that a prior non-draining record starts the new attempt as `changing`, so
  an attempt that does not complete keeps the record. A completed attempt
  removes it. Remove `recover` from the sweep, `docs-refresh.ts`,
  `maintenance.ts`, and the `MaintenanceRefusal` union.
- Phase schema gains `since: z.string().datetime().optional()`, written on the
  first phase write of an attempt and carried through later writes. Optional so
  existing records parse.
- `server.ts:415` pauses chat only when `owner !== null`.
- `health-migrations.ts`: with no live owner the detail reads
  `Unfinished maintenance: <reason> since <since>`; with a live owner
  `Maintenance in progress: <reason> (pid <pid>)`. Correct the retry hint to the
  current verb, `bbx engine migrate --sweep --repair`.
- Remove `answerFencedMigrationQuestion`, the catch branch in
  `src/core/commands/answer.ts:314-322`, and both `actions.answer` admission
  exemptions (`src/webapp/box-admission.ts:19` and
  `src/webapp/trpc/trpc.ts:28`); `answerWithAdmission` becomes `withBoxWork`.
  The path exists to answer while the box is closed. Under the new rule a box
  without a live owner is open, so the ordinary answer path serves; with a live
  owner, the fenced path's own `acquireBoxMaintenance` is refused by the owner
  lock, so it cannot serve either. Rewrite
  `test/core/migration-answer.doctest.md` ("Answers during migration recovery",
  which today asserts the answer lands "without … opening admission") to assert
  the ordinary path records the answer once the owner is gone and that a live
  owner refuses it with `SERVICE_UNAVAILABLE`.
- The sweep asserts it still owns the box before each commit: `validPermit`
  against `owner.lock` (or the parent permit for a joined child) before
  `commitOutput`. A lost owner returns `commit-failed` with error
  `maintenance ownership lost` and leaves the output uncommitted under its
  recovery ref. This is the non-silent signal for the sleep and dead-parent
  cases in *Failure modes*.
- `recover` disappears from `refreshGeneratedDocs` too, and with it the
  `bbx engine docs refresh --repair` flag (`src/cli/commands/docs.ts:25-28`),
  whose only effect is `recover` (`src/core/docs-refresh.ts:71`). No script or
  doc invokes it (searched `deploy/`, `docs/`, `schedules/`, `bin/`). Existing
  doctests that pass `recover: true` drop the option.
- `migration-sweep.ts`: delete the `needs-procedure` special case added in
  `ea8e67884` only if the doctest "A procedure migration after an applied script
  reopens the box" still passes without it. It completes a consistent attempt
  and clears the record, so the default is to keep it.
- Amend `migration-reliability.md:238-240` and `:284-289` to state the new rule
  and link here.

**Vocabulary lock-ins.** "Unfinished maintenance" for a phase record without a
live owner. "Closed" only for a live owner. `since` on the phase record.

**First implementation chunk.** `box-maintenance.ts` rule change, `recover`
removal at all call sites, and doctests in
`test/lib/box-maintenance.doctest.md` (or the existing maintenance doctest):
record without owner admits work and startup; live owner refuses; new owner
over an old record succeeds; incomplete attempt keeps the record.

### 2. The hub explains a box it cannot serve

**What.** For a configured slug with no endpoint, HTTP answers 503 with the
reason. An unconfigured slug keeps 404.

**Why.** The incident's only visible symptom was
`404 {"error":"not_found","message":"No running box for …"}`.

**Direction.** After `resolveEndpoint` returns nothing for a known slug, read
`boxMaintenanceStatus(boxRoot)`. With a live owner, reply
`503 { error: "box_closed", reason, since, owner: { pid, since }, message }` and
`Retry-After` from `phase.until` when present, else 60. Otherwise reply
`503 { error: "box_unavailable", message }`. `EndpointProvider`
(`src/hub/endpoints.ts:27`) gains an optional `unavailable(slug): string |
undefined`; `Supervisor` returns `box.lastError` for a box that is not running
(stopped after a refused start, unhealthy, or crash-looping) and `undefined`
for a running box or unknown slug. A provider without the method, such as the
static test provider, yields the message `Box is not running`.

**Vocabulary lock-ins.** Error codes `box_closed` and `box_unavailable`.

**First implementation chunk.** The 503 branch and a hub doctest with a box
whose owner lock is held by the test.

### 3. The schedule log always carries its findings

**What.** `report()` writes the findings to stdout on every run. Alert dedupe
stays at 24 hours.

**Why.** A repeated finding produced an empty log and a `clean` outcome while
four boxes were unusable. This does not change whether a box stays closed; it
stays in this plan because the handoff named it as part of the incident's
visibility failure. After Track 1 a box cannot stay closed after the
sweep's process exits, so no "box closed" finding is needed; the defect left is
the empty log.

**Direction.** In `run.ts` `report()`, when `message` is non-empty and the alert
is deduped, print `[box-convergence] unchanged since <reportedAt>; alert
suppressed` and the findings. Extend `convergence.test.ts`.

## Could this be simpler?

The simplest version is per-path: call `complete()` for each remaining sweep
status, reload failure, and deploy failure. It fails on a killed owner and on
every future maintenance caller, and the boxholder asked for a fix that "can't
get wedged". The chosen rule is one predicate in one module and deletes the
`recover` option, the `recovery` refusal, and the fenced answer path.

Considered and dropped: a process-id liveness check to shorten the 5-minute
stale window after a crash. The window is bounded and explained by the 503, and
a second liveness mechanism beside the lock contradicts `file-lock.ts:86-87`.

Considered and dropped: restoring the working tree from the recovery snapshot
before reopening. The boxholder declined it; Git history and the recovery ref
cover the loss case.

## Subplans

None.

## Failure modes

| What can fail | Test exists? | Handling exists? | Clear-or-silent? |
|---|---|---|---|
| Sweep hard-fails after writing partial output; box reopens; an ordinary card write commits some of that output | Planned sweep doctest asserts the box admits work and the record and recovery ref remain | Recovery ref holds the before-image; migration stays pending with its question | Health and schedule report unfinished maintenance |
| Owner killed mid-script; box refuses for up to 5 minutes until the lock goes stale | Planned doctest with a released-without-complete owner (staleness itself is `file-lock`'s tested behaviour) | Hub 503 names the owner and reason | Clear |
| Laptop sleeps longer than 5 minutes mid-migration; on wake a reader sees the lock stale and admits work before the owner's next refresh, so a chat write overlaps the resuming script | Planned sweep doctest: an owner whose lock was reclaimed gets `commit-failed` | `inspectLock` only checks; it does not steal, so `onCompromised` does not fire. The pre-commit ownership check in Track 1 refuses the commit; output stays under the recovery ref; the pending migration and question report it | Reported by the sweep result and health. The overlap window (seconds after wake) is accepted: local laptops only, and the exposure equals an external editor's (`migration-reliability.md:595`) |
| Deploy controller dies while a joined child sweep is mid-script; the box opens while the child still writes | Same planned doctest, joined variant | The joined child's ordinary work lease excludes nothing; the pre-commit check against the parent permit refuses its commit | Reported by the child's result; deploy already prints the failure |
| Deploy fails midway; boxes reopen on a half-activated engine | Existing supervisor crash-loop doctests | Supervisor marks the box unhealthy; Track 2 reports `box_unavailable` with `lastError` | Clear |
| A delegated `join` child writes a phase after its parent died | Existing: `join` validates the parent permit against the live lock (`box-maintenance.ts:246-249`) | Throws `expired` | Clear |
| Old engine reads a record with `since` | Schema is `z.object` without `.strict()`; unknown keys are dropped | n/a | n/a |
| Hub 503 body leaks a path or pid to an unauthenticated client | Planned hub doctest | The branch sits after the auth gate (`hub-server.ts:490-493`) | n/a |

## Agent-flow / user-flow edge cases

- **Wrong tag / wrong field:** no agent-facing vocabulary is added. ADDRESSED.
- **Stale ref:** the recovery ref named in a migration question is unchanged by
  this plan. ADDRESSED.
- **Two agents touching the same card:** a chat agent may now write while an
  unfinished migration's output sits in the tree. Covered in Failure modes row 1.
  ADDRESSED as accepted risk.
- **Hand-edit drift:** a boxholder deleting `phase.json` by hand now only clears
  the record. ADDRESSED.
- **Validation error UX:** the chat agent sees unfinished maintenance through
  `bbx health` output (`box-migrations` check). ADDRESSED in Track 1.
- **Partial migration / transition state:** an engine without this change still
  refuses on the phase file alone. Boxes converge when their engine upgrades; no
  data migration. ADDRESSED.
- **iOS client:** the app showed "box returned 404". It will show 503 for a live
  closure. Whether it renders the message body is DEFERRED to an issue.

## NOT in scope

- An always-available management or admin chat. The boxholder decided any chat
  serves once the box comes up.
- Rolling back partial migration output before reopening. Declined by the
  boxholder.
- Running procedure migrations during deploy or the hourly sweep.
  `trick-secret-runtime` stays pending on the local boxes.
- A process-id liveness check. See *Could this be simpler?*
- iOS rendering of the 503 body. File an issue.
- Changing drain or execution time limits.

## Open design questions

None inside the tracks. After shipping: whether the web UI should show a banner
for unfinished maintenance beyond the health check. Lean: wait for a real case,
since the schedule alert and health check already report it.

## Knowledge audits

Skipped. The change is infrastructural. The one agent-visible surface is the
reworded `box-migrations` health message, which the agent reads at the time it
matters and does not need to know in advance.

## What will hold this after it ships

- `closedPhase` is a small decision over (phase, owner); the maintenance doctest
  reaches it with real lock files in a temporary Git repository.
- `test/core/migration-sweep.doctest.md`: after a `failed` sweep, ordinary
  `withBoxWork` succeeds and `boxMaintenanceStatus` reports the record with no
  owner.
- Hub doctest for `box_closed` and `box_unavailable`.
- `schedules/box-convergence/convergence.test.ts` for the deduped-run log.

## Implementation order

1. Track 1 gate rule, `recover` removal, doctests.
2. Track 1 callers: server poll, health message, fenced answer removal, sweep
   doctest, parent plan amendment.
3. Track 2 hub 503.
4. Track 3 schedule log.
5. Cross-model review of the branch diff; adjudicate.

## Rollout shape

Done when the doctests named above pass with typecheck and ESLint on changed
packages. No data migration. Local verification: in this worktree's `test1`
clone, write a phase record by hand with no owner and confirm the box serves
through the dev router; hold the owner lock from a script and confirm the 503.
Production picks the change up on the next deploy after landing; no maintenance
is run against production boxes from this workstream.

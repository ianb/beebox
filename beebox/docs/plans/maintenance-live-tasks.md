---
title: "Box maintenance waits for chats with live background tasks"
status: draft
workstream: maintenance-live-tasks
issues:
  - ../../../issues/bugs/2026-11-02-maintenance-quiesce-ends-chats-with-live-background-tasks.md
---
# Box maintenance waits for chats with live background tasks

Box maintenance closes chat runs that sit between turns. A chat between turns
can still run background subagents for hours, and closing its run kills them.
This plan stops routine docs refresh from taking box maintenance at all, makes
the remaining maintenance wait for (and then defer to) such a chat, and lets an
operation that cannot defer end the chat with a note that says why.

**Issues addressed:**
`issues/bugs/2026-11-02-maintenance-quiesce-ends-chats-with-live-background-tasks.md`.
Related, already closed: `issues/closed/bugs/2026-10-30-idle-eviction-kills-running-background-subagent.md`
(the sweep and live-cap paths, `docs/implemented-plans/idle-eviction-background-work.md`).
Searched `issues/` for `live background task`, `quiesce`, `maintenance-live`,
`docs refresh`: no other match.

## Verified cause (2026-11-02, read-only on production)

The maintenance owner was the hourly `box-convergence` schedule
(`schedules/box-convergence/run.ts:56`): it runs
`bbx engine migrate --sweep --repair --yield --json` over SSH on every
production box. On the affected box its SSH session opened at 14:07:12 and
18:12:13 UTC; the chat restarts began one second later. The box's
`.beebox/docs-generated-at` marker was rewritten at 18:12:18.39, just after the
third restart. No migration was pending and no migration question existed.

So the path was: the sweep's peek found `docsRefreshHasWork` true
(`src/core/migration-sweep.ts:96`: *"if (opts.refresh && await
docsRefreshHasWork(opts.boxRoot)) return null;"*), the sweep closed the box
(`:116`), the server's one-second poll closed every idle chat run
(`src/webapp/server/app.ts:444-445`), and the refresh then regenerated docs
with no content change. `docsRefreshHasWork` is mtime-based
(`src/core/docs-gen/generate/core.ts:384-385`, `newestInputMtime`), so the
subagents' card edits made it true.

The same box's journal has the same three-restart pattern at 03:37, 04:38,
05:43 UTC (convergence runs at 21:36, 22:37, 23:42 local time on 2026-11-01)
and at 08:10 UTC (the morning deploy). Seven kills in one day; six from the
schedule.

## Design

No design section: the boxholder decided the behaviour on 2026-11-02 (see the
issue's "Direction"). The one new thing a chat meets is a short note at the
start of its next turn after a deploy or reload ended its background tasks;
its wording is in Track 3.

## Smallest fix and budget

Smallest fix: in the poll's busy test, count a session with live background
tasks as busy. The yielding sweep then times out its 15 s drain and defers.
That alone stops the hourly kills, but the hourly sweep still closes the box
(and every idle chat without tasks) whenever docs inputs are touched, and a
deploy then waits its full 10-minute drain and fails.

Chosen design, three tracks:

1. Docs refresh runs as ordinary box work, never maintenance. ~50 source,
   ~60 test lines.
2. Maintenance counts live background tasks as busy; an owner that cannot
   defer sets a deadline after which those chats are ended. Owner reason is
   logged when chat is quiesced. ~60 source, ~80 test lines.
3. A run ended for maintenance with live tasks leaves a note the next turn
   reads. ~50 source, ~60 test lines.

Total estimate: ~360 changed lines plus docs. Not a BIG CHANGE.

## Stated preferences this plan trades against

- Boxholder, 2026-11-02 (issue, "Direction"): docs refresh takes only the git
  lock; exclusive maintenance waits for live-task chats with a bound, defers on
  a miss; a non-deferrable operation tells the chat why.
- `docs/implemented-plans/idle-eviction-background-work.md`: the sweep and live
  cap already skip chats with live tasks via `isWorkingInBackground`
  (`src/core/chat/session/registry/cap.ts:19`). Maintenance uses the plain
  live-task count instead: eviction may treat a 4 h silence as a hang, but the
  boxholder's rule for maintenance is "never close it while idle-with-tasks".
- `docs/implemented-plans/box-maintenance-no-wedge.md`: closure is bounded by
  the drain (10 min) and execution (15 min) limits. Kept: the new deadline is
  inside the drain window.
- Standing preference "minimize invented concepts": one optional phase field,
  one per-session note file. No new lock, no new process.

## What already exists

- **Chat runs hold box work for their whole life.** `src/core/chat/session/run/lock.ts:66`:
  *"Keep the parent admission alive across a persistent SDK run, including
  prep."* Released at `run/core.ts:198` when the run's message pump ends.
  So the drain (`src/lib/box-maintenance/admission.ts:330-340`) waits on any
  live run, idle or not. Reuse: this is what makes "do not close it" equal
  "the drain waits".
- **The poll that closes idle runs.** `src/webapp/server/app.ts:441-446`. Its
  busy test is `session.busy` only (`registry/core.ts:204`,
  `busy: s.isBusy()`; `run/core.ts:442`: a turn in progress). Change.
- **Live-task predicate.** `run/core.ts:444`
  *"isWorkingInBackground(): boolean { return this.isRunning() && this.liveTasks.isWorking(); }"*,
  with the 4 h stall bound in `run/live-tasks.ts:15`. Not reused for
  maintenance: maintenance counts the set itself (`liveTasks.count()`), so a
  silent task is never closed by a deferrable owner.
- **Yielding sweep defers on drain timeout.** `migration-sweep.ts:113-122`,
  `YIELD_DRAIN_MS = 15_000` (`:34`); the convergence report treats a deferral
  as routine until a day old (`schedules/box-convergence/results.ts:24-31`).
  Reuse unchanged.
- **Drain deadline on the phase record.** `admission.ts:17-18` `until`, written
  only for `draining` (`:300`). Precedent for the new optional field.
- **Docs generation already runs without maintenance.** Chat start
  (`run/start-run.ts:117`) and every reactor cycle (`reactor/engine/cycle.ts:111`)
  call `generateDocs`, which commits its own output under the git lock, scoped
  by `isTemplateManagedPath` (`docs-gen/generate/core.ts:280-294`). So the
  maintenance lock in `docs-refresh.ts:67` protects nothing the routine path
  does not already do unguarded. Reuse `isTemplateManagedPath`
  (`src/core/install-template-file.ts:120`) as the refresh's commit scope.
- **Git lock.** `withBoxGitLock` (`src/lib/git-lock.ts`), already taken by
  every recovery helper (`migration-recovery.ts:53, 95, 131, 145, 159`) and by
  `stageAndCommitPaths` (`lib/git/core/operations.ts:379`). Reuse; nothing new.
- **Joining a maintenance permit as ordinary work.** `acquireBoxWork` admits
  descendants of a maintenance permit in any phase
  (`admission.ts:186-189`: *"A retained descendant may finish while the owner
  drains, never once changes begin"* — with `parent.maintenance` exempt).
  So a refresh under `withBoxWork` inside the sweep's `maintenance.run`, or
  under deploy's `BBX_BOX_WORK`, is admitted without the join path.

Live-task set contents (finding the issue asked for): `adaptTaskLevel`
(`src/core/chat/session/messages.ts:129-133`) keeps every non-ambient entry of
the SDK's `background_tasks_changed` signal. The SDK documents that set as
*"Every live background task"* with `parent_task_id` for a task *"whose agent
launched this subagent, shell, monitor or workflow task"* (`sdk.d.ts:3818,
3833`). So nested subagents and `run_in_background` Bash commands are in it.

Stall clock (finding): `noteRunMessage` runs on every message the run emits
(`run/consume.ts:76`), including any nested task's `task_progress`. A subagent
waiting on an active child is not quiet. Only a whole run silent for 4 h
(for example a single silent background shell) reads as stalled; that is the
intended hang bound.

## Prior art (external)

No design decision depends on an external premise beyond the SDK type
quoted above (`node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts`, version
0.3.316).

## Ontology

- **Maintenance owner** (exists, `admission.ts:250`): the process holding
  `owner.lock`; its `reason` names it ("migration", "deployment",
  "development reload", "engine upgrade", "box backup").
- **Deferrable owner**: one whose drain timeout ends the attempt
  (sweep, upgrade, backup). Not a type; the absence of the field below.
- **`endsBackgroundTasksAt`** (new, optional ISO time on the phase record):
  the moment after which this owner will end chats that are idle with live
  background tasks. Written only by owners that cannot defer (deployment
  holder, development reload). Not a drain deadline (`until` stays that).
- **Has live tasks** (new accessor over the existing set,
  `liveTasks.count() > 0` on a running session): any live background task,
  stalled or not. Exposed in `snapshotAll` as `liveTasks: number`. Not
  `isWorkingInBackground`, whose 4 h stall exception exists for eviction;
  maintenance must not treat silence as permission to kill (Codex plan
  review, finding 3).
- **Run-ended note** (new): a per-session file
  `.beebox/chat-run-ended/<session>.json` `{ at, reason, tasks: string[] }`,
  written when maintenance ends a run with live tasks, consumed by that
  session's next turn. Not a chat message and not an event-bus event.

## Tracks / scope

### 1. Docs refresh is ordinary box work

**What.** `refreshGeneratedDocs` stops calling `acquireBoxMaintenance`. It
runs `generateDocs` under `withBoxWork({ reason: "docs refresh" })` and
commits its output with the same scope and safeguards `generateDocs` already
uses at every chat start. The sweep runs the refresh in its open peek when no
migration or question is pending, instead of closing the box for it.

**Why.** It is the cause of six of the seven kills. Its exclusivity guarded
nothing the routine path does not already do unguarded: the same generator,
template sync included, runs at every chat start (`run/start-run.ts:117`) and
reactor cycle (`reactor/engine/cycle.ts:111`).

**Direction.**
- `docs-refresh.ts`: `withBoxWork(...)` → if `docsRefreshHasWork` is false,
  `current` → `generateDocs(boxRoot, { commit: false })` → commit under the
  git lock with message "Refresh generated docs" and trailer
  `Created-By: docs-refresh`. Commit scope (one helper shared with
  `commitTemplateSyncChanges`, `docs-gen/generate/core.ts:270-296`): changed
  paths that pass `isTemplateManagedPath`, minus authored `AGENTS.md`
  (`isAuthoredAgentsMd`), minus paths dirty before the run, except paths whose
  guidance class is `generated` (engine output rewritten whole and carrying a
  DOCID line; `guidance-surfaces.ts`). The exception is what lets a retry
  commit a failed attempt's output, the job the pending-baseline ref did.
- On failure: remove the marker (so the next run retries) and throw
  `DocsRefreshError` naming the cause.
- Removed, with the reason: the recovery snapshot, the pending-baseline ref
  and the index rollback. They restore a pre-attempt index, which is only
  correct while no other writer runs: with an open box, refresh A can fail, a
  concurrent commit can land P, and A's rollback would stage a reversal of P
  (Codex plan review, finding 2). Generated output needs no recovery copy: it
  is reproducible from inputs. Dirty authored input is never in the commit.
  Template sync protects edited tracked files with the template tracker
  (`install-template-file.ts`), as on every chat start.
- `withinMaintenance` is removed from `refreshGeneratedDocs`: the ambient
  permit (sweep's `maintenance.run`) or `BBX_BOX_WORK` (deploy's
  `bbx docs refresh --within-maintenance`) admits the work through
  `acquireBoxWork`. The CLI flag stays accepted, described as a no-op kept for
  deploy scripts.
- `migration-sweep.ts` `sweepWithoutWork`: when the manifest is current and
  no question is open, run `refreshGeneratedDocs` (if `opts.refresh`) and
  return `current`. `docsRefreshHasWork` no longer forces the gate. Inside
  maintenance the post-migration refresh stays (plain box work under the
  owner's permit).
- `"docs"` leaves the CLI's `independentlyOwned` set
  (`src/cli/lib/box-admission.ts:9`).

**Vocabulary lock-ins.** None.

**First chunk.** The docs-refresh rewrite plus tests: refresh with live box
work answers without a maintenance record; a non-generated file dirty before
the run stays uncommitted; a rejected commit is retried and committed.

### 2. Maintenance counts live background tasks as busy

**What.** The poll does not quiesce a box while any running session has live
tasks, unless the phase record's `endsBackgroundTasksAt` has
passed. The deployment holder and the development reload set that deadline
60 s after closing. The poll logs the owner once per maintenance id when it
quiesces.

**Why.** Without it, any owner kills multi-hour work at once. With only the
busy rule, a deploy would wait 10 minutes and then fail its drain.

**Direction.**
- `admission.ts`: `closeBoxMaintenance` option `endBackgroundTasksAfterMs?:
  number`; the phase schema gains `endsBackgroundTasksAt` (optional
  datetime), written by every `writePhase` of that owner (fixed at close
  time). Delegated `phase()` writes carry it over from the record.
- `holdBoxes` (`cli/commands/maintenance/hold.ts:47`) and
  `reloadSupervisedBox` (`hub/supervisor/supervised-reload.ts:38`) pass
  `endBackgroundTasksAfterMs: 60_000`. Sweep, upgrade, backup do not.
  Development reload cannot usefully defer: an aborted reload clears
  `reloadRequested` (`app.ts:429`) and the next poll tick asks again
  (`app.ts:452-455`), so a deferring reload would close the box for one
  10-minute drain after another while the chat works.
- `registry.snapshotAll()` adds `liveTasks: s.liveTaskCount()`.
- Poll decision extracted as a pure function in
  `src/webapp/server/maintenance-quiesce.ts`:
  `chatMayQuiesce({ sessions, endsBackgroundTasksAt, now }): boolean` —
  false if any `busy`; false if any `liveTasks > 0` and the deadline is
  absent or in the future.
- `quiesceForMaintenance(reason)` passes the owner's reason down:
  `session.pauseForMaintenance(reason)` → `restart({ reason })` →
  `endRun(run, { tasks, sessionId, endedFor: reason })`.
- Log once per phase id: `[maintenance] Quiescing chat for <reason>
  (pid <pid>, since <since>)`. A box held by a live-task chat logs once per
  phase id: `[maintenance] <reason> waits for chat <id> with N background
  task(s)`.

**First chunk.** `chatMayQuiesce` and its unit tests, then the wiring.

### 3. The next turn learns why its tasks ended

**What.** When `endRun` ends a run with live tasks and an `endedFor` reason,
it writes the run-ended note. The session's next `sendAdmitted` reads and
deletes it and prepends one block to the turn text.

**Why.** The CLI tells the next turn the tasks "didn't finish before the
previous session ended" but not why; the boxholder asked for the cause.

**Direction.**
- `run/live-tasks.ts` `endRun(..., { endedFor?: string, boxRoot })`: if
  `count() > 0 && endedFor && sessionId`, write the note atomically
  (`writeFileAtomic`) before aborting. Task descriptions come from the live
  set (`LiveTaskEntry.description`).
- `run/core.ts` `sendAdmitted`: before `composeTurnContent`, read the note
  (do not remove). Remove it only after `run.send` returns. A failed start or
  dispatch leaves it for the next send (Codex plan review, finding 5). Prepend:
  `<run-ended at="…" reason="deployment">Box maintenance (deployment) ended
  your previous run while 1 background task was running: <description>. It
  did not finish; restart it if it is still needed.</run-ended>`
- Note lives under `.beebox/` (box state, git-ignored like
  `.beebox/chat-models/`, `state.ts:61`).

**First chunk.** Note write/take helpers and tests; then the two call sites.

## Could this be simpler?

The simplest version is the one-line busy rule (above). It fails twice:
the hourly sweep still closes every idle chat without tasks whenever docs
inputs move (Track 1 removes that load entirely), and a deploy over a
researching chat fails after 10 minutes, which the boxholder ruled out
("an operation that cannot defer (deploy) tells the chat why it stopped").
Track 3 could be dropped and the reason only logged; the boxholder asked for
the chat to be told, so it stays, as a file, not a new event type.

## Plan review

Codex `gpt-6-astra`, 2026-11-02, six findings. Accepted and folded in: commit
scope safeguards (1), removal of snapshot rollback (2), live-task count instead
of the stall predicate (3), note removed only after dispatch (5), rollout row
corrected (6). Rejected: development reload should defer (4); see Track 2 for
the retry loop that makes deferral close the box repeatedly.

## Subplans

None.

## Failure modes

| What can fail | Test exists? | Handling exists? | Clear-or-silent? |
|---|---|---|---|
| A non-generated file dirty before the refresh | Existing test, kept | Dirty-before exclusion | Clear (stays uncommitted) |
| A chat edits an engine-managed tracked file during the 1–3 s refresh window | No | Same scope `generateDocs` commits at chat start | Silent; accepted (existing behaviour) |
| Two refreshes overlap (CLI + sweep) | No | Same output; commit under git lock; nothing-to-commit is success (`operations.ts:388-394`) | Harmless |
| Refresh commit rejected | Existing test, adapted | Marker removed; retry commits generated-class output | Clear (error) |
| Live-task chat holds a deferrable owner every hour | New test (`chatMayQuiesce`) | Yield → `deferred`; report after a day | Clear (log line, report) |
| Deploy waits 60 s, ends task chat, note write fails (disk) | No | Logged; run still ends | Clear in journal, silent to chat; accepted |
| Hung task (never ends) holds deferrable maintenance off | `chatMayQuiesce` test | Sweep defers hourly; convergence reports after a day (`results.ts:24-31`); deploy ends it after 60 s | Clear |
| Deploy of this change itself: the staged CLI's holder writes the field, but the still-running old server quiesces on `busy` only and writes no note | No | None | Silent once; accepted: one deploy, same as today |
| A chat edits a template-sync input while sync reads then rewrites it | No | Template tracker edit detection | Pre-existing on every chat start; filed as an issue, not changed here |
| Note left for a session that is deleted | No | File is small, under `.beebox/` | Silent; accepted |

No critical gap: every silent row is accepted above with a reason.

## Agent-flow / user-flow edge cases

- Chat with tasks, hourly sweep with no pending migration: no closure at all
  (Track 1). ADDRESSED.
- Chat with tasks, pending migration, hourly sweep: closes, waits 15 s,
  defers, reopens; chat untouched. ADDRESSED (Track 2).
- Chat with tasks during deploy: deploy waits 60 s, chat ended, next turn gets
  the note. ADDRESSED (Tracks 2–3).
- The last background task finishes during the drain and the CLI answers its
  notification without a `send`: unverified whether `isBusy()` reads true
  then. The live set empties, so the session no longer blocks and may be
  closed mid-answer. Pre-existing (the poll had the same race for any
  idle run); DEFERRED, noted in the issue.
- Person sends a message during the drain: refused by admission as today
  (box closed). Unchanged.
- Partial rollout: the phase field is optional; readers ignore it when absent.
  ADDRESSED.

## NOT in scope

- A detached runner for multi-hour jobs that survives deploys: issue fix
  direction 4; separate design.
- Host memory sizing / OOM kills: `issues/features/2026-11-01-large-box-mode.md`.
- Notes for runs ended by a server shutdown that is not maintenance (OOM,
  manual `systemctl restart`): the cause is not known in-process; no note.
- Waking the chat after maintenance to continue on its own: needs a product
  decision about unprompted turns.
- Changing what `docsRefreshHasWork` measures (mtime vs content): the refresh
  is cheap now that it does not close the box.

## Open design questions

None. The 60 s wait before ending tasks is a chosen constant; changing it is one line.

## Knowledge audits

None: no new agent-facing convention. The run-ended block is self-describing
text in a turn.

## What will hold this after it ships

- Unit: `chatMayQuiesce` (pure), note write/take helpers, phase field
  round-trip in `admission`.
- Integration (existing tiers): `docs-refresh` tests against a temp box repo;
  `migration-sweep` peek path refreshes without a maintenance record;
  `hold.ts` writes the field; a `ChatSession` test that `pauseForMaintenance`
  with live tasks writes the note and the next send carries it.

## Implementation order

1. Track 1 (docs refresh, sweep peek, CLI admission set) + tests.
2. Track 2 (phase field, `chatMayQuiesce`, poll wiring, logging, owners) + tests.
3. Track 3 (note) + tests.
4. Issue update; docs touch-ups (`docs/box-guidance.md` or wherever
   `bbx docs refresh` admission is described).

## Rollout shape

Done when: change-selected tests, `pnpm typecheck`, `pnpm layout-check` pass,
and cross-model review findings are adjudicated. No data migration: the phase
field is optional and the note directory is created on demand.

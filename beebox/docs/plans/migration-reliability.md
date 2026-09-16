---
title: "Reliable box maintenance and migration with Git recovery"
status: partial
workstream: migration-reliability
issues:
  - ../../../issues/features/2026-09-11-local-boxes-never-converge-on-migrations.md
---
# Reliable box maintenance and migration with Git recovery

Bring configured boxes onto the shipped migrations automatically, including
boxes with unfinished edits. Use Git for recovery, the box's agent for bounded
repair, and existing questions and alerts for decisions that need a person.
Migration, deployment, and reload share one boundary: close admission to new
work, drain accepted work, perform maintenance, verify readiness, then reopen.

**Issues addressed:** [Local boxes never converge](../../../issues/features/2026-09-11-local-boxes-never-converge-on-migrations.md).
Related but not closed by this plan: [parked template resolution](../../../issues/features/2026-08-24-parked-template-resolution-path.md),
[template recurrence](../../../issues/docs-and-chores/2026-07-19-template-parks-recurrence-check.md),
[incorrect shipped procedure templates](../../../issues/bugs/2026-09-12-procedure-templates-ship-pre-one-root-paths.md),
and [one-root migration performance](../../../issues/code-quality/2026-09-05-one-root-migration-per-file-git-mv-is-slow.md).

## Smallest fix and budget

The original migration-only baseline was 400 changed source lines and 200
changed test lines; the original plan budget was 700 source and 350 test lines.
The boxholder then explicitly added a shared admission-and-drain approach for
migration, deployment, and reload. A migration-only lock cannot meet that scope.
The smallest revised fix shares admission across existing HTTP, CLI, scheduling,
and lifecycle owners, then applies dirty input under Git recovery. Estimate:
700 changed source lines and 350 changed test lines without agent recovery.

Four sequential tracks, two existing subprojects: `beebox/` and the root
`schedules/box-convergence/` integration. **BIG CHANGE — approved 2026-09-14.**
The boxholder approved the full shared-lifecycle scope and clarified that agent
estimates are aspirational; over 2,000 changed lines must be labeled and approved.
The revised implementation goal was about 2,000 source / 800 test lines, plus
owned documentation. The actual integration exceeds that estimate: the final
verification record below reports source, tests, and documentation separately,
counting additions plus deletions. Prior approval persists; material scope
changes still require discussion.

The [scope checkpoint](../reports/2026-09-14-migration-implementation-scope.md)
records the earlier estimate and pause. It is historical, not an active limit.
Keep pressure to simplify: share one admission protocol and retire the old
process-local reload counters. No new daemon, watcher, job queue, card schema,
or backup service. Idle SDK runs end at the maintenance boundary.

## Stated preferences this plan trades against

Direct boxholder decisions in this workstream, 2026-09-14:

- “wait for active work, but don't allow new active work”
- “migrating and deploying and reloading are all kind of the same thing, and
  should have the same approach. Plan that in”
- “We can make use of the in-box agent to fix issues that we didn't expect.”
- “If things come up where data loss might happen, we should discuss them.”
- “I'm okay if some failed/pending chat inputs are lost during a migration.”
- “We shouldn't let _many_ things be lost.”
- “git is a good snapshot and reversal opportunity! So if things go wrong but
  the history is in git, then it's recoverable.”

The originating handoff describes a preference for judicious design and ideally
no net code growth. That is context; the direct decisions above govern.

Recovery therefore preserves valuable content through Git, rather than requiring
all input to pass the new schema first. Reversible edits are ordinary repair
work. Substantial deletions, choosing between divergent substantive copies, or
loss of content outside recoverable history need a concrete human decision.
A few failed/pending chat inputs are permitted incidental loss, not a license
to clear an entire queue or delete successful conversation history.

`beebox/docs/engineering-principles.md:51`: “Degradation is allowed for failures that can genuinely happen; invisible
degradation is not”
justifies surfacing an unresolved migration through an actual alert.
`beebox/CLAUDE.md:5`: “Do not expand scope into adjacent cleanup, policy, schemas,
UI, or workflows without the boxholder's approval.” This excludes a general
backup framework and a template-management UI.

## What already exists

Paths here are monorepo-relative. Quoted evidence describes today's code;
proposed changes are specified in Tracks / scope.

| Existing owner and evidence | Reuse or change |
|---|---|
| `beebox/src/core/migration-run.ts:130`: `export function computePending(applied: ManifestEntry[]): Migration[]` | Keep the registry and manifest as the migration execution record; questions retain unresolved partial work. |
| `beebox/src/core/migration-sweep.ts:97`: `if (!status.clean) return { status: "skipped-dirty", pending: pending.map((m) => m.name) };` | Remove dirty as an automatic refusal. |
| `beebox/src/core/migration-run.ts:140`: “a soft, per-card failure — record it and continue” | Keep continuation; make unresolved per-card repair durable and visible. |
| `beebox/src/core/migration-sweep.ts:136`: `await restoreManifest(boxRoot, snapshot);` | Preserve failed-commit rollback; also restore the staged manifest to its prior index state. |
| `beebox/src/lib/git.ts:288`: `await withBoxGitLock(boxRoot, async () => {` and line 290: `await unstageOversizedBlobs(boxRoot);` | Keep normal Git/large-file protection. Do not use a blind whole-tree commit for migration outputs. |
| `beebox/src/lib/git.ts:366`: `export async function stageAndCommitPaths(` | Stage untracked output as well as changes, then commit only those paths with hooks. |
| `beebox/src/lib/git-lock.ts:296`: “cannot acquire logs loudly and runs” | This lock is not exclusive migration ownership; use the existing fail-closed file-lock primitive for shared admission. |
| `beebox/src/cli/commands/tick-helpers.ts:83`: `export async function findBusyBlockers(` | Retain diagnostics; these probes alone cannot close admission or account for request preparation. |
| `beebox/deploy/server-bin/bbx-wait-quiet:4`: “Always exits 0: the wait is advisory, never a hard block.” | Deploy wait is a courtesy, not proof of exclusion. |
| `beebox/src/core/agent/index.ts:154`: `export function createAgent(options: {` | Invoke the box's configured engine through this existing interface. |
| `beebox/src/core/agent/types.ts:38`: `maxTurns?: number;` | Bound repair; deterministic retry remains the completion authority. |
| `beebox/src/core/procedure/engine.ts:172`: `await stageAll(boxRoot);` | Do not introduce a generic repair procedure: its startup commit would entangle invalid input before repair begins. |
| `beebox/src/core/question-alert.ts:69`: `export async function checkPendingQuestionsAndNotify(` | Reuse question notifications; retain schedule alerts when no notification channel is configured. |
| `workstreams-app/src/router/router-real-effects.ts:66`: `const line = text.split("\n").find((l) => l.startsWith("BOXES="));` | Use the existing local box list. |
| `bin/lib/worktree-create.sh:418`: `grep -v '^BOXES=' "$main_env" > "$worktree_path/beebox/.env"` | Preserve worktree isolation. |
| `beebox/src/core/docs-refresh.ts:91`: `if (!status.clean) return { status: "skipped-dirty" };` | Generated guidance must use the same dirty-input policy. |
| `beebox/scripts/update-template-stock-hashes.ts:20`: “exists because the forward-only path above cannot see its own past.” | Existing historical-hash adoption is sufficient; do not invent a second template ledger. |

History reviewed:

- `issues/closed/bugs/2026-08-18-stale-annex-largefiles-never-reapplies.md:11`:
  “box convergence now runs on its own.” Lines 12–16 name the sweep and health
  check. That prior solution still permits starvation; change application.
- `issues/closed/code-quality/2026-08-24-remove-document-card-legacy-tolerance.md:19`:
  “The card-file sweep left three boxes' *generated* agent-guide docs stale”.
  Completion must include generated guidance, not just converted cards.
- `issues/closed/bugs/2026-07-15-box-packageify-doubled-subtrees.md:10`:
  “Prod verified clean (scan below), and both affected”. The following lines
  report local repair without data loss. Read the final resolution with the
  earlier damage report; do not treat old speculation as ongoing loss.
- `issues/closed/code-quality/2026-08-24-gsheet-rename-migration-can-overwrite.md:21`:
  “without checking whether the destination exists; POSIX rename silently”.
  Lines 12–18 close the issue after a fleet census, not a safety fix. Preserve
  destination collision checks rather than treating a rename as harmless.
- `issues/code-quality/2026-09-05-one-root-migration-per-file-git-mv-is-slow.md:11`:
  “runs one
  `git mv` subprocess per planned file.” The v2 bootstrap stays
  separate; do not force it into an unattended ten-minute sweep.

Searches of the migration runner and agent interfaces found no shared dirty-box
recovery helper and no migration-specific recursive-invocation guard. Existing
Git snapshots used by field tests are HEAD tags plus ordinary commits; they do
not preserve invalid dirty input without a commit gate. Add only the small
migration-local Git helper described below.

## Prior art (external)

- [Git alternate index](https://git-scm.com/docs/git): `GIT_INDEX_FILE` selects
  a separate index. Use it to construct recovery trees without disturbing the
  caller's staging choices.
- [Git commit-tree](https://git-scm.com/docs/git-commit-tree): creates a commit
  object from a tree. Recovery objects need not advance the branch or claim
  validated application state.
- [Git update-ref](https://git-scm.com/docs/git-update-ref): retain the recovery
  object under a named ref; a printed, unreachable SHA is not durable recovery.
- [Git stash](https://git-scm.com/docs/git-stash): ordinary push rolls back the
  working tree. Do not stash/pop around a schema migration: the edit being
  restored may itself require migration.
- [git-annex add](https://git-annex.branchable.com/git-annex-add/): annex stores
  file content separately from Git. Git recovery of an annex pointer requires
  its object to remain available. This plan never drops annex content.

A disposable real-Git feasibility probe during plan authoring passed preservation
of working-tree, staged-only, and untracked versions; the real index remained
unchanged during snapshot construction, and a changed-path commit preserved
unrelated staging. It did not exercise annex or box hooks. The regression
fixtures below must verify those remaining boundaries before implementation
is accepted.

## Tracks / scope

### 1. Shared admission and maintenance boundary

**What and why.** A busy box must yield to pending maintenance. Waiting for a
quiet instant leaves a race and permits starvation. Close admission first;
accepted work can finish, but new independent work cannot keep extending it.
Use one per-box gate for migration, deploy, and reload, with lifecycle-specific
operations inside it. External editors and raw Git commands remain cooperative.

Evidence for the existing pieces and gaps:

- `beebox/src/lib/dev-bundle-reload.ts:6`: `let draining = false;` is process-local.
- `beebox/src/webapp/server.ts:391`: `beginDevBundleDrain();` precedes its idle
  check. Its request hook at line 148 rejects new mutations while draining.
- `beebox/src/lib/dev-bundle-reload.ts:49`: `export function trackMutationStart(): () => void {`
  counts accepted request work; move this responsibility to shared admission.
- `beebox/src/core/chat/schedules.ts:335`: `this.schedules.delete(schedule.id);`
  consumes a fired timer even when delivery failed. Refusal must precede claiming it.
- `beebox/src/webapp/routes/telegram.ts:76`: `const finishBackgroundWork = trackMutationStart();`
  already keeps detached delivery alive beyond the webhook response.
- `beebox/src/core/chat/session/start-run.ts:116`: “await generateDocs(opts.boxRoot).catch”
  precedes the chat-active lock. Admission must cover preparation too.
- `beebox/src/lib/file-lock.ts:140`: “budget runs out — a loud failure, never a silent unserialized run.”
  supplies fail-closed serialization; the fail-open Git lock is not suitable.
- `beebox/src/hub/child-process-utils.ts:45`: `export async function waitForExit(pids: number[], timeoutMs: number): Promise<number[]> {`
  checks process groups when waiting for shutdown. Preserve that protection.
- `beebox/deploy/deploy.sh:811`: `systemctl restart beebox-hub beebox-scheduler`
  replaces both services. Ownership cannot reside only in a dying service.

**Direction.** Add one small shared module exposing ordinary work admission and
exclusive maintenance, backed by the existing file-lock primitive. Persist its
phase under the box's Git directory, outside the working tree. The states are
open → draining → exclusive → open. Work leases are held file locks, one per
box/process with an in-process active-work count; acquire on 0→1 and release
on 1→0. Use the default heartbeat/staleness profile for long-running work.
`beebox/src/lib/file-lock.ts:82`: “PID-liveness fast reclaim” was declined in
the following lines; reuse `scanLocks` and existing ownership/compromise behavior,
not a new PID registry or liveness authority.

Admission acquires/retains the process lease **before** reading the phase; every
independent root checks the phase even when that process already holds a lease.
Maintenance serializes competing closers with its held file lock, atomically
writes the closed phase **before** scanning live work leases, and waits until
they drain. A late root can appear after an empty scan but sees closed and exits
without mutating. This ordering needs no additional serialization lock around
every request. Never wait for work while holding the Git-index lock.

An admitted root operation receives a box-scoped lease. Close admission
atomically, then wait for previously admitted leases to finish. New requests
receive the existing retryable 503 error shape; CLI actions return an explicit
maintenance/busy result. There is no new generic queue. Durable existing queues
and timers retain pending work and resume after reopening. An expired due timer
must not be deleted because admission was refused. Re-arm that same due timer
after a short delay (two seconds, matching existing delayed delivery), retrying
admission without consuming the schedule; no gate observer or new watcher. A queued next chat turn is
new work and must obtain its own admission.

Gate the actual lifetime of work, not just the HTTP response or an activity
probe: request preparation, detached delivery, complete chat runs, CLI box
commands, scheduled scripts, and scheduler housekeeping. Transfer/retain a
lease before detaching work and release it only on completion. Read-only status,
health, and recovery inspection remain available. Classify real mutations,
including OAuth callbacks and GET-triggered initialization; HTTP method alone
is insufficient. Use a common Commander action adapter for box-affecting CLI
commands with explicit read-only and maintenance exceptions. `tick --force`
does not bypass admission. Box resolution before admission must be read-only.

Already admitted agents and scripts must still be able to call their tools.
Propagate a validated, box-scoped lease capability through the existing script
and agent environment builders; register/retain children before parent release.
A live child remains counted if its parent exits. Reject unknown, expired, or
foreign-box capabilities. This permits descendants completing accepted work,
not unrelated new root work. Repair agents receive the exclusive maintenance
capability, so they can operate while ordinary admission is closed. Recursive
migration still fails immediately. Preserve environment allowlists; do not pass
all parent environment variables or make a successor server's ordinary requests
privileged merely because its launcher holds the maintenance capability.

The maintenance phase records owner attempt/generation and progress, with
liveness owned by its held file lock. After a stale owner is reclaimed through
the existing primitive, a new controller may reopen a pre-mutation attempt only
if the old generation passes existing health/canary checks and no replacement
began. After mutation or replacement begins, owner death leaves admission closed
until a new controller reconciles the attempt; lock expiry alone must not reopen
it. Expose this state in existing health and schedule diagnostics. Normal
completion and safe pre-change abort explicitly reopen the gate.

Drain has a ten-minute limit, separate from the operation's execution budget.
On drain timeout, abort maintenance and report the blocking work; do not proceed
with active writers or kill them automatically. Reopen the unchanged healthy
service after a verified pre-change abort. A changing/uncertain attempt stays
closed and raises an actionable alert. This limit bounds one attempt without
letting new work extend the drain. A hung accepted task still requires recovery;
the user's small-input-loss permission is not authority for blanket termination.

Each lifecycle uses the same boundary:

- **Migration:** its CLI/controller acquires the target box's gate, snapshots,
  applies and optionally repairs, verifies the result, then releases it. A nested
  sweep under deploy reuses that maintenance attempt instead of reacquiring.
- **Deploy:** the outer deployment controller closes every affected box in
  canonical-root order before draining them. Building and transferring staged
  artifacts can happen first; activation of mutable shipped paths happens only
  after draining and stopping old writers. Run close, drain, activation, migration, restart, verification, and reopen
  in one server-side command/session whose controller survives the service
  restarts. The current separate SSH calls cannot share a refreshed held lock.
  Hold gates across migration, hub and scheduler restart, and readiness. Release acquired gates safely if acquisition
  fails before changes. Keep unrelated boxes open. Reuse the existing deployment
  artifact flow; an immutable-release subsystem is outside this plan.
- **Reload:** keep bundle-change detection and exit code 75, but replace local
  drain policy with shared admission. The surviving hub supervisor owns the
  gate across old-child exit and replacement readiness; the child signals the
  reload request. Scheduler-only reload stops admitting another pass, finishes
  the current pass, and lets its existing service manager replace it; it does
  not close every box while no scheduler work is running. Each per-box pass,
  including housekeeping, still holds an ordinary work lease, and the successor
  must obey shared admission. Container initialization uses the maintenance
  boundary before serving; after successful convergence it releases ownership
  before `exec`, and serve checks admission before any startup mutation. No
  extra ownership transfer protocol is needed merely for container `exec`.

Readiness means the intended generation has completed required initialization
and its startup convergence has been accounted for. A bound HTTP port returning
503 is not sufficient. Use the existing health/canary checks plus the expected bundle identity
within controller readiness; do not add a new public API or acknowledgement
channel. Lazy hub startup and scheduler prestart must honor the gate. Reads may
continue where compatible; mutating startup runs only with an explicit maintenance
capability. A failure result cannot silently clear maintenance merely to serve.
A committed partial migration with a durable question can reopen; an uncertain
half-applied hard failure cannot. Scripts-only deferred repair hands ownership
to the scheduled convergence runner by releasing exclusive ownership while
retaining the closed recovery phase; it must be able to
repair a closed box without depending on normal HTTP/chat admission. Report the
unavailable box until recovery succeeds. A question alone does not make a
hard-failed box safe to reopen. Read-only question inspection remains available;
recording an answer uses a narrow maintenance-owned CLI recovery action, then
the next convergence attempt consumes it. Ordinary work cannot bypass the gate
by posing as recovery. Notifications run as part of the maintenance attempt.

**Vocabulary lock-ins.** One per-box work lease and maintenance phase record,
shared by existing callers. No separate migration lock, reload admission counter,
or deploy advisory quiet policy as a competing correctness mechanism. Activity
locks remain useful diagnostics. The dev dashboard/shared router's own lifecycle
is outside scope; do not restart it from this worktree.

**First implementation chunk.** Add cross-process fixtures proving close versus
admit ordering, accepted descendants completing, timer preservation, process
handoff, and dead-owner recovery. Extract the existing reload admission boundary
into the shared module and wire ordinary work owners before using it for mutation.

### 2. One application path with Git recovery

**What and why.** Move script application into one core path used by `--apply`
and `--sweep`. Both accept dirty input. Keep status and explicit manifest repair
commands, and keep v2 bootstrap separate. Manual mode may execute registered
procedure migrations; unattended mode reports them as requiring attention.

**Direction.** Retain `sweepMigrations` as the core owner while replacing its
policy, rather than layering a second orchestrator over it. Its typed result
carries status, completed migration names, the blocked migration/reason, recovery
ref, and repair session/question references when present. CLI formatting and
`--json` serialize that same result. “Current” means no pending migration, no unresolved migration repair question,
and successful guidance refresh. A completed pass may instead report partial
conversion requiring attention. Parked template decisions are reported separately.

Before mutation, enter the shared maintenance boundary from Track 1. Another
maintenance attempt waits or returns busy; repair-process recursive migration
fails immediately. Accepted descendants finish before snapshotting. Use short
Git lock spans for snapshots and commits, never around scripts or agent work.
External editor activity cannot be fenced by this application protocol.

Create a named recovery ref `refs/bbx/migrations/<name>/snapshots/<attempt-id>` before each
mutation phase (one migration or provisioning/refresh), so the changed-path
baseline never includes an earlier completed phase. Use a UUID for `attempt-id`;
snapshot refs live only under `snapshots/`, separate from the sibling
`repair-started` receipt. Implement a small helper beside the runner:

1. Resolve the Git directory and HEAD. Refuse an unresolved merge/index rather
   than choosing a side automatically.
2. Copy the real index to a temporary index. Write its tree to an index-recovery
   commit, then add the current tracked and non-ignored untracked files into
   that temporary index using normal Git filters. Write a working-tree recovery
   commit with HEAD and the index-recovery commit as parents. Preserve staged-only
   versions as well as the working copy.
3. Retain the tip under the named ref before returning success. Do not move HEAD,
   clear files, change the real index, disable filters, or bypass application
   hooks. These objects preserve input; they do not claim valid box data.
4. Keep ignore rules and normal annex filters. Snapshot ordinary non-ignored
   input even when it would fail application validation; do not use the
   housekeeping helper that unstages large blobs. An unrelated unlisted binary
   must not block migration. Recovery refs are local preservation objects, not
   validated/published box revisions, and are not automatically pushed. Normal
   output commits retain their hooks, including unlisted-binary checks. Do not force-add
   `.beebox/`, credentials, or all ignored files, and never drop annex objects.
   Actual snapshot I/O failure stops mutation; a required unavailable annex object
   or meaningful loss outside the snapshot is a concrete repair/human decision.
5. Keep refs after success or failure. Print the ref and a path-scoped Git restore
   example. No automatic garbage collector or blanket reset/clean is introduced.

Run scripts on the live dirty files. Compute changed paths by comparing the
recovery tree with a new temporary-index tree of the working files; comparing
only HEAD would incorrectly include pre-existing edits. Use `stageAndCommitPaths`
to stage and commit only changed paths plus the manifest, with ordinary hooks
and a recovery-ref trailer. An
already dirty file modified by migration may include its earlier edits in the
resulting commit; the recovery ref preserves the exact before-image and the
commit must say so. Unrelated dirty files and staging remain untouched.

Exit 0 permits a normal applied entry. Preserve the existing exit-2 contract:
it means per-card failures with those cards left unchanged, so one malformed
recipe must not prevent an unrelated interface-card migration. In manual or
scheduled mode, try one bounded repair and deterministic retry immediately,
before any later migration changes those inputs. If some cards still fail,
commit the successful output and manifest together with a normal question card
listing the residual failures, return a partial result, and continue the queue.
The question preserves the incomplete work even though the migration will not
run automatically again. Its eventual resolution validates the affected cards
against the then-current schema; do not replay an old migrator after later
migrations have changed those cards. Partial conversion is not data loss and
must not be presented as a fully clean result.

Deploy/container mode runs scripts without starting repair agents. On exit 2,
leave that migration pending for the scheduled repair pass, stop later entries,
and return deferred repair with partial output uncommitted under its recovery
ref. This is a bounded deferral, not an indefinite human gate. The next
scheduled pass handles it as above and continues even if that card still needs
a question. A hard structural error, failed invariant, or rejected commit leaves
the entry pending and stops later entries in every mode.

On commit rejection restore the working manifest and restore the pre-commit
index entries for **all paths staged by the attempt** from the saved index tree,
removing entries that were originally untracked. Leave other index entries
alone and retain the working output for repair. This restores the caller's
staging rather than blindly unstaging their earlier edits. Do not automatically
reset the box. Retry snapshots are labeled “pre-attempt state”, never “the
boxholder's changes”.

Provision required templates in-process before procedure execution, and refresh
engine guidance after data conversion. Reuse existing installers and generation,
with the same snapshot/path-commit boundary for generated output. Remove the
outer dirty refusal and whole-tree residue commit from docs refresh. Do not
spawn `bbx init` while holding the Git lock. Add a `commit: false` option to
`GenerateDocsOptions`, threaded to template sync,
for this caller only. The convergence runner commits its measured output;
other callers keep their default internal commits. This is needed because
`beebox/src/core/docs-gen/index.ts:313`: `const candidates = [...status.staged, ...status.modified, ...status.untracked];`
collects pre-existing dirt, not just generator output. Restore/invalidate the
existing generation marker after a failed refresh commit so a cache hit cannot
hide uncommitted output on retry. Do not claim provisioning changes to ignored
operational state are covered by a Git tree.

**Vocabulary lock-ins.** Keep the append-only migration names and manifest entry
shape. Add a CLI JSON representation of the existing result union and the Git
recovery-ref namespace. No per-card migration status or second completion ledger. A manifest-less v3
box remains an explicit enrollment decision. Legacy clean-only scripts retain
their standalone preconditions: report the concrete precondition and permit
agent repair only within the stated scope, rather than weakening all historical
migrators. The shipped v3 migration sequence is the automatic convergence target.

**First implementation chunk.** Add real-Git recovery/path-selection fixtures,
then the snapshot helper and the shared script path; remove the duplicate CLI
script loop. No agent work is required for this chunk to be reviewable.

### 3. Bounded repair by the box's agent

**What and why.** A script's unexpected input should receive a repair attempt
without requiring a person to diagnose ordinary recoverable inconsistencies.

**Direction.** Call `createAgent({ name: "migration-repair", onOutput })` directly,
with the box's configured harness and context. Do not add a generic procedure
or reuse its eager whole-tree commit. The outer runner already owns the attempt,
recovery ref, result, and deterministic verification. Retain the agent session ID
and diagnostic output in the convergence result and caller's run log.

Invoke once after a failed conversion or output commit, with `maxTurns: 12`;
then perform one deterministic retry. Do not chain repair sessions in a single
attempt. The schedule owns unattended agent work; deploy and container startup run only
scripts and report deferred repair. Apply the explicit per-box schedule timeout
in Track 4; timeout is pending with a recovery ref, never success. Do not claim a USD cap across both model engines.
The directive supplies migration name/script, failure output, affected paths,
Git recovery ref, and the following scope:

- Inspect and repair box data relevant to this failure. Preserve substantive
  content using Git; history makes ordinary reversible edits acceptable.
- Do not edit the engine/migrator, forge/remove manifest entries, weaken hooks
  or validation, run nested migration, reset/clean the box, rewrite history,
  or drop annex content. The outer runner owns completion and commits.
- Repair formatting and reconcilable structure. A few failed/pending chat inputs
  may be discarded incidentally; report the actual count. Do not invent an
  automatic numerical allowance for substantive content.
- Ask before a substantial deletion, choosing between divergent substantive
  copies, or meaningful unrecoverable loss. Supply paths, scope/count, recovery
  coverage, and the alternatives. Avoid hypothetical loss checklists.
- Return a typed outcome: repaired, needs-human with a concrete question, or
  failed with a concrete reason. Agent success alone is never migration success. A failed outcome also produces
  a concrete repair question; it is not an unlatched retry state.

Use existing question cards at a stable migration-specific path under
`_bookkeeping/questions/`; the runner writes/updates the card from validated
agent output so failure does not depend on the agent remembering to ask.
Do not overwrite an answer. An unanswered, dismissed, or expired decision
remains a stop, not permission. An answered hard-failure question is passed into the next repair attempt.
For a partial migration already recorded, its answer is handled through the
existing question directive and current-schema repair, not registry replay. Inspect the actual question content before relying on its path.
After an unsuccessful bounded repair, the same question is the durable blocker;
subsequent unattended runs report it instead of repeatedly spending agent turns.
Before invoking an agent, write a small Git ref
`refs/bbx/migrations/<name>/repair-started` pointing at this attempt's recovery
snapshot. This is a crash receipt, not a second completion ledger. Clear it only
after a verified success or a durable question is committed. If a subsequent
run finds the receipt without either outcome, it creates an interrupted-repair
question instead of launching another agent. An answered question authorizes
one further bounded attempt; if that fails, create a linked follow-up question
and preserve the earlier answer. Terminal answers are never overwritten.
Auth/unavailability before any repair starts is an operational failure, reported
for retry, not a fabricated data-loss question; remove the receipt on a verified
no-work invocation failure. A timeout of uncertain progress retains the receipt.
A deterministic retry that now succeeds may finish without asking an obsolete
question.

Call the existing question notification helper on blocked exits; failure to
notify remains visible in the command result and the schedule's alert. Capture
repair-induced changes in the final path set and verify the manifest has not
been altered by the agent before recording completion.

**Vocabulary lock-ins.** One private runtime result union for repair, the existing
question schema, a Git repair-start receipt, and one current question chain per
migration. No new job type,
agent backend, or workflow engine.

**First implementation chunk.** Add fake-agent tests for repair/retry, an agent
that falsely claims completion, a material-loss question, and a repeated unanswered
question. Then add the direct invocation and directive.

### 4. Existing triggers apply and report

**What and why.** A deploy-only attempt cannot converge local boxes or a production
box repeatedly busy during deployment.

**Direction.** Deploy and container startup call the unified operation once with repair disabled.
Replace the existing schedule's report-only status parsing with apply-and-report,
hourly, against local `BOXES` and production's own installed CLI. Each environment
compares against its own engine registry, never the workstation's registry for
production. The periodic retry is independent of the next deploy. Process boxes
sequentially. The current schedule is only a probe:
`schedules/box-convergence/run.ts:105`: `timeout: 120_000,` applies to a fleet-wide
SSH call. Replace that probe with per-box CLI invocations: a ten-minute admission/drain limit followed by a 15-minute execution
limit per box, local and remote, with a 26-minute transport limit remotely so
SSH does not kill a still-in-budget repair. Terminate the invocation's process
tree on timeout and exercise that behavior in a process fixture. Keep deploy's
separate ten-minute script limit. Set the schedule's whole-run timeout to four
hours; if it is exhausted, report the unvisited boxes as unchecked, not current.
These are explicit new limits in the existing callers, not claims about today's
schedule. No background agent outlives a failed invocation.

Only the main checkout's configured local list is eligible. Canonicalize roots
and exclude managed worktree clones and any root claimed by an active worktree's
configuration; do not infer permission from a familiar basename. A worktree without
`BOXES` has no real-box convergence targets. Use read-only worktree/router inventory
for the exclusion, not a second editable box list. Excluded ownership is reported.

`SCHEDULE_DRY_RUN=1` performs status inspection only: no snapshots, migration,
agent, question, notification, or baseline write. A broken remote command or
malformed JSON is unknown/failure, never an empty successful fleet. Emit one
important alert for unresolved failures, human decisions, or unavailable coverage;
use existing schedule state to avoid repeating identical detail every hour.
Busy alone is deferred, but continued pending work is reported on the daily
cadence even if it is always busy. A fully current result is silent; partial
conversion and outstanding questions remain attention items even with no pending registry entries. Schedule run
records prove the check occurred.

Box health derives pending names from the same manifest reader and also names
any outstanding migration question. The schedule owns delivery for unattended
attempt failures; no new polling UI. Deploy may start gated replacement services for recovery, but reopens ordinary
work only under Track 1's readiness policy. Aggregate and visibly report incomplete
convergence; never claim every box migrated. Recovery agents do not inherit authority to restart the shared
router or change credentials.

Template hash logic remains separate from migration history. Known stock updates
are installed through the existing functions; parked customization is a named
attention item. Agent repair may resolve a parked file when it blocks this
migration, using the same recovery and loss policy. Broad automatic template
merging, historical fleet hash adoption, and new accept/diff commands stay with
the related issues. Do not call parked content “updated” merely because its
replacement was downloaded.

**Vocabulary lock-ins.** Existing `BOXES`, schedule identity, question cards,
and health checks. One JSON command result replaces prose scraping.

**First implementation chunk.** Update schedule fixtures for dirty/local/prod,
remote failure, dry-run, worktree exclusion, and repeat blockers. Then replace
the existing deploy/container/schedule calls together.

## Could this be simpler?

Changing the schedule to retry the current sweep is smaller but leaves invalid
dirty input permanently blocked. A normal checkpoint commit also fails before
migration can repair that input. Ignoring dirty state and retaining `stageAll`
would mix unrelated work into commits. A stash/pop cycle could restore old-format
edits after the migration has declared completion.

The additional code buys the requested shared close/drain/maintain/reopen boundary, Git recovery for dirty input,
a bounded agent repair, and a retry independent of deployment. Consolidate the
two script loops, dirty policies, and lifecycle drain policies to pay for these.
A process-local boolean or repeated idle probe cannot fence CLI and scheduled
work or survive process replacement. Reuse file locks and existing controllers;
do not introduce a standalone maintenance service. Do not build transactional
rollback for every script or snapshot operational state wholesale. If the direct
agent path grows a second procedure engine, stop and shrink it.

## Subplans

None. Git snapshot and agent repair are parts of this single bounded operation;
the first real-Git fixtures decide whether the proposed helper meets its contract.
Failure of that design gate requires revising this plan before expanding scope.

## Failure modes

Tests marked planned are implementation acceptance gates, not passing evidence.
No silent failure listed below is accepted as the intended behavior.

| What can fail | Test exists? | Handling exists? | Clear-or-silent? |
|---|---|---|---|
| Dirty invalid card blocks its own upgrade | Old dirty-skip fixture; replace | Planned snapshot plus changed-path commit | Current skip; proposed apply or named blocker |
| Staged-only bytes or untracked input disappear | Planned real-Git restore fixture | Preserve both index and working trees | Explicit snapshot failure |
| Annex pointer exists but content is unavailable | Planned annex fixture | Keep objects; refuse a required unavailable input | Explicit affected path |
| Script returns 2 on one card | Planned partial plus later-interface fixture | Bounded repair, then recorded partial with question; continue | Durable attention item |
| Commit rejects after output staging | Existing commit-failure fixture; extend | Restore manifest and prior index entries for all attempt paths | Pending, retained ref |
| Agent claims success without fixing input | Planned fake-agent fixture | Deterministic retry, not agent verdict | Still pending |
| Agent edits manifest to escape failure | Planned fake-agent fixture | Compare to runner-owned manifest baseline | Refuse completion, preserve evidence |
| Agent needs substantial loss decision | Planned fake-agent/question fixture | Existing question plus notification and alert | Human action named |
| Repair loops every deploy/hour | Planned repeated-question fixture | Durable existing question blocks repeated repair | Report existing blocker |
| Auth failure or timeout kills repair | Planned invocation/timeout fixture | Git receipt prevents uncertain attempts repeating; no-work auth failures may retry | Operational failure or interrupted question |
| New work races gate closure | Planned cross-process fixture | Atomic registration versus closure | Deferred before mutation |
| Accepted agent needs CLI tools during drain | Planned descendant fixture | Retained validated lease | Completes, no deadlock |
| Timer fires while closed | Planned timer fixture | Admission before consuming, resume pending delivery | Pending, not lost |
| Deploy/reload controller dies | Planned process handoff fixture | Durable phase, successor reconciliation | Closed with recovery diagnostic |
| Busy task never finishes | Planned drain-timeout fixture | Abort before mutation, report blocker | No forced migration |
| Concurrent maintenance or recursive repair call | Planned process fixture | Shared ownership and reentry refusal | Busy/error |
| External editor writes during migration | External tools are outside admission | Git recovery; no filesystem transaction claim | Explicit scope limit |
| Local scheduler targets a worktree's box | Planned ownership fixture | Canonical-path exclusion from existing inventory | Excluded and reported |
| Remote CLI fails but fleet appears current | Planned remote-result fixture | Validate JSON and exit status | Unknown coverage alert |
| Guidance refresh fails after data succeeds | Planned refresh failure fixture | Data commits retained; overall result incomplete | Next attempt retries refresh |
| Human decision expires or is dismissed | Planned question lifecycle fixture | Never interpret as authorization | Remains blocked |

## Agent-flow / user-flow edge cases

- **ADDRESSED — wrong field/name:** only the runner writes the registered
  migration name to the existing manifest; validate agent result at its boundary.
- **ADDRESSED — stale ref:** resolve question and file paths live; a missing or
  changed target is evidence to inspect, not authorization to recreate content.
- **ADDRESSED — two agents:** shared admission excludes competing application writers while
  allowing the maintenance repair agent. Accepted descendants drain before
  takeover; external editors remain outside the application gate.
- **ADDRESSED — hand-edit drift:** dirty cards are snapshotted and migrated in
  place; unrelated invalid files do not enter the migration commit.
- **ADDRESSED — fabricated result:** retry and commit verification decide
  completion; a claimed repair or manifest write cannot retire a migration.
- **ADDRESSED — validation UX:** carry migration name, actual errors, paths,
  recovery ref, and the existing question link to the boxholder and repair agent.
- **ADDRESSED — partial transition:** completed earlier migrations remain
  committed; hard-failed and later entries remain pending. Per-card partial conversion
  continues with an explicit repair question. No automatic global reset.
- **ADDRESSED — recovery after later edits:** inspect the saved tree and restore
  selected files; never reset the whole box over intervening work.

## NOT in scope

- Box marker tracking, gitignore/hook migration follow-ups, and scan ingestion:
  other workstreams own them; consume their current interfaces when implementing.
- v2 one-root migration performance and automatic legacy bootstrap: separate
  operation and issue, with a different runtime and rollback contract.
- Rewriting or proving all historical migrators correct: keep existing collision
  guards and test the actual failing/retry paths exercised by this change.
- A guarantee to preserve every transient failed chat input: explicitly waived
  for small incidental loss; successful history and substantive content remain protected.
- Excluding external editors/raw Git, a new maintenance service, or a filesystem
  transaction engine. Shared admission covers Bee Box work only.
- A new release artifact system, general job queue, public maintenance API, or
  replacement of the dev dashboard/shared router lifecycle.
- General backup/export, remote replication of recovery refs, automatic ref
  deletion, or annex garbage collection: local recoverability is the requested scope.
- Template-management UI or broad autonomous rewriting of learned guides:
  independent customization decisions stay with the related issues.
- Retrospectively marking all old manifests trustworthy: old partial-success
  entries need a targeted rollout check, not a new universal ledger.

## Open design questions

No blocking choice is left in the first implementation chunks. The proposed
recovery mechanism and scope above are the direction to validate. Actual
substantive data-loss choices belong to concrete box cases during rollout;
this plan does not pre-authorize a quantity of valuable content to delete.

Net source reduction remains unverified until implementation. If snapshot
coverage or agent invocation requires a broader subsystem, use the budget
breaker instead of expanding this document's scope silently.

## Knowledge audits

Put the short recovery policy in a box-loaded guide and import that exact text
into the repair directive. Add `migration-repair-recovery` as a `knows_directly`
audit that loads that guide through an existing audit fixture's CLAUDE include,
so this tests the shipped policy without extending the audit harness: Git-backed reversible repair is allowed; meaningful
loss requires a question; a few failed/pending inputs may be discarded; manifest
forgery and engine/hook edits are forbidden. Exercise the directive with the
existing fake-agent tests as well. Run the filtered real audit on the isolated
worktree test box and record its status in `beebox/src/dev/knowledge-audits.yaml`.
This plan-only change does not yet introduce or run that agent prompt.

## What will hold this after it ships

Use the existing filesystem doctest tier and real Git repos, with the existing
annex fixture conventions. Extend `beebox/test/core/migration-sweep.doctest.md`;
add `beebox/test/core/migration-recovery.doctest.md` for recoverable dirty/index/
untracked input and `beebox/test/core/migration-repair.doctest.md` for fake-agent
failure/retry/questions. Add cross-process admission/lifecycle fixtures and extend the existing reload,
chat-schedule, and webhook tests for lifetime transfer and deferred delivery.
Keep activity, result-format, and fleet-selection policy
small enough for pure fixtures. Use root `node --import tsx --test schedules/box-convergence/*.test.ts` for
remote JSON, ownership, dry-run, and repeat-alert coverage. The current root
`package.json:28` test command includes `schedules/*/*.test.ts`. No new test tier.

During implementation run selected tests, package typecheck and lint, schedule
checks, doc-check, and the filtered knowledge audit. Perform cross-model review
on the complete diff. Plan review is not implementation or live-box evidence.

## Implementation order

1. Shared admission fixtures and normal-work adapters; lifecycle ownership and
   old-to-new process handoff. Prove closing admission actually fences all listed
   Bee Box roots before relying on it for migration.
2. Real-Git fixtures; snapshot/path-commit helper; unify the script runner and
   partial/commit-failure handling under the maintenance boundary.
3. Bounded agent repair, existing questions, manifest verification, and audit.
4. Guidance refresh, CLI JSON, deploy/container/reload integration, and existing
   schedule applying local/prod with ownership exclusions and recovery access.
5. Selected tests, filtered audit, cross-model diff review, docs, and controlled
   rollout evidence. These are commit boundaries; the plan ships as one piece
   only when the boxholder asks to land it.

## Rollout shape

First installation must account for old processes that do not know the gate.
Use a controlled stop/restart to install gate-aware HTTP, CLI, and scheduler
peers before enabling unattended maintenance. Verify old process groups are
stopped; a newly written marker cannot fence old code. Do not claim seamless
first-upgrade exclusion. No blanket force-kill policy is authorized by this plan.

Rehearse a continuously arriving stream of new tasks: maintenance must close
admission, let accepted work and nested tools finish, then take over. Verify
migration, deploy, and reload use the same gate; kill the owner during replacement
and show that recovery keeps admission closed until the intended generation is
ready. Verify a due timer and queued next turn survive and resume only afterward.
Exercise web and native clients against the existing retryable 503 contract;
no pending input may be reported as accepted when admission refused it.

First prove dirty invalid input upgrades and both pre-attempt working/index
versions can be restored from Git. Include an untracked card, a deletion, an
annexed attachment, unrelated staged invalid work, and a migration commit
rejected by the real hook. Then prove partial conversion → bounded repair →
retry → committed manifest, and an unconvertible card → durable question →
later interface migration still applied. A substantive-loss case must produce
one question with no repeated autonomous repair until answered. Kill a repair
after its start receipt is written; the next run must ask about that interrupted
attempt rather than launch a second agent.

Before applying to real boxes, run read-only status against each environment's
own engine, retain unknown/unreadable boxes in the report, and check ownership.
Rehearse on the isolated clone. When rollout is authorized, run sequentially,
retain recovery refs, and inspect diffs and blockers. Confirm both the shipped
migration effect and refreshed guidance on affected boxes; manifest counts alone
cannot prove older partial-success entries were complete. Do not bulk erase old
entries or run every retired migration to obtain that evidence.

Done means selected regression tests and the repair audit pass, the unified
manual/unattended path has been exercised, configured local and production boxes
are either verified current or have a concrete acknowledged blocker, and an
independent scheduled retry has actually converged a previously deferred box.
Report code landing, deployment, automated tests, and live convergence separately.


## Implementation verification, 2026-09-14

The measured BIG CHANGE is approximately 3,500 source lines, 2,000 test lines,
and 1,600 authored documentation/configuration lines changed (additions plus
deletions), plus 30 generated audit-history lines. The shared admission adapters,
persistent-run lifecycle, and real-process regression coverage exceed the early
estimate; they implement the approved shared lifecycle rather than adding another
convergence service.

Final change-selected verification passed all 5,571 assertions across 430 test
files. Package typecheck and lint, documentation checks, focused lifecycle and
recovery tests, and the repair-policy knowledge audit pass.

Implementation and automated verification are complete. Deployment and live
convergence evidence remain open. Current operational instructions live in
[migrations](../migrations.md), [server operations](../server-operations.md),
and the [deployment guide](../../deploy/README.md).

Real-process fixtures cover shared closure/draining, retained descendants,
reload IPC, replacement readiness before admission reopens, and failed-owner
recovery. Real Git fixtures cover working/index snapshots, unrelated staging,
normal commit-hook failure, and idempotent retry committing earlier partial
output. A disposable real git-annex fixture also verifies preserved HEAD/index,
detection of a deleted attachment, and restoration of its link and bytes while
the annex object remains available; Git history does not back up missing annex
objects. Main chat and thread-pool fixtures cover persistent SDK permissions,
fast-ACK handoff, queued turns, and due-timer retention. The filtered Claude
repair-policy audit passes with zero reads/searches against an installed-package
fixture copied from the worktree's isolated box; the original dirty test box was
not reset. Package symlink imports were not a valid recall fixture, so the audit
uses an actual installed guide file.

The admission transition uses a short existing `withFileLock` span to serialize
lease publication with the drain's zero-reader observation. This closes both
sidecar-publication and directory-enumeration races; it does not hold a lock
across ordinary work. Joined phases may mark changes, but only an explicit final
`--prepare` permits replacement startup; joined completion alone does nothing.

Recovery-answer fixtures exercise the real HTTP and CLI boundaries: an existing
pending migration question is answerable while ordinary writes stay closed; the
next bounded repair receives the saved answer. Applied partial questions wait
for normal service so their existing follow-up job can run. CLI `attention`
results permit startup while retaining warnings and structured question status.

Linux privilege switching and systemd cgroup checks still require rollout
verification. Production first installation refuses active legacy peers; old
processes cannot honor a gate they never loaded. Container recovery uses one
bounded configured-agent attempt, then operator-visible exec recovery rather
than a restart loop. No production convergence or device/client rollout is
claimed by these implementation tests.

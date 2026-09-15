# Plan Engineering Review — migration reliability

## What already exists

The plan reuses the registry/manifest, Git path-scoped commits, file locks,
existing reload admission, configured agent interface, question cards/notifications,
template installers, and existing deployment and schedule callers.

Evidence: `beebox/src/core/migration-run.ts:130` defines `computePending`;
`beebox/src/lib/git.ts:366` defines `stageAndCommitPaths`;
`beebox/src/core/agent/index.ts:154` defines `createAgent`;
`beebox/src/core/question-alert.ts:69` defines
`checkPendingQuestionsAndNotify`.

## Prior art (external) — verified

The plan cites Git's official documentation for alternate indexes,
commit-tree, update-ref, and stash, and git-annex's documentation for content
storage. A disposable real-Git experiment during authoring verified index and
working-tree recovery objects, preservation of an untracked file, and a
changed-path commit leaving unrelated staging alone. Annex filters and real
box hooks were not exercised; the plan makes those implementation gates.

## Stated preferences this plan trades against

The boxholder explicitly authorizes in-box agent repair, treats Git history as
recovery, accepts losing a few failed/pending chat inputs, and requires
substantial loss choices to be discussed. The originating handoff asks for a
small design, ideally without net growth. The plan chooses local Git recovery
and existing agent/question surfaces over a general backup or workflow system.

## Could this be simpler? (verified)

Normal checkpoint commits reproduce the dirty-invalid-input blockage. A
report-only schedule repeats the old policy. The review identified places the
first draft could shrink: per-card failure must not become a whole-queue stop;
on-disk binary debris must not become a new checkpoint gate; deploy must not
wait on repair agents. Those revisions are in the plan.

The extra index-recovery parent was retained deliberately. A human can stage
one version and continue editing; Git recovery should preserve those bytes.
The additional tree/commit is small and was exercised by the Git probe. The
reviewer's observation that system writers usually stage and commit together
does not establish that a human's index is redundant.

## Failure modes

The plan names real-Git fixtures for dirty/untracked/staged-only inputs, rejected
commits, interrupted repairs, and annex boundaries. It separately tests per-card
partial conversion, hard failures, false agent success, and manifest tampering.
A Git repair-start receipt records uncertain interrupted work so repeated
schedules cannot silently launch agents indefinitely.

## Agent-flow / user-flow edge cases

Questions preserve prior answers and use linked follow-ups after another failed
attempt. Expiry and dismissal are not authorization. A malformed recipe can
remain an attention item while later interface migrations apply. External
editing during migration remains a cooperative limitation; the plan does not
claim a global filesystem transaction or process-exclusion service.

## Findings

### Waiting for quiet did not prevent starvation

**Location in plan:** Track 1, Shared admission and maintenance boundary.
**Citation:** The human requested “wait for active work, but don't allow new
active work” and “migrating and deploying and reloading ... should have the
same approach.” `beebox/src/lib/dev-bundle-reload.ts:6`: `let draining = false;`.
**Issue:** The earlier migration plan used activity probes and a migration-only
lock; the existing reload gate was process-local. Neither excluded newly
starting CLI or scheduler work across process replacement.
**Why it matters:** A continuously busy box could still starve, and a replacement
process could reopen the race after its predecessor exited.
**Suggested action:** Share close, drain, exclusive maintenance, readiness, and
reopen across existing lifecycle owners; preserve accepted descendants and due
work without adding another service.
**Relevant preference:** The latest explicit shared-lifecycle requirement.
**Disposition:** Accepted. A new first track defines shared admission, controller
handoff, timeout/recovery, ordinary-work adapters, and first-installation limits.
The expanded authorized scope revises the budget from 700/350 to 1,100/550
changed source/test lines. No implementation is included in this plan revision.


### Per-card failures must not block unrelated migrations

**Location in plan:** Track 2, One application path with Git recovery.
**Citation:** `beebox/src/core/migration-run.ts:140`: “a soft, per-card failure — record it and continue”.
**Issue:** The first draft changed exit 2 into a permanent queue stop. That could
leave an interface migration blocked behind an unrelated unconvertible card.
**Why it matters:** It would make automatic application less reliable under
ordinary imperfect data.
**Suggested action:** Preserve continuation, add bounded repair, and keep
unresolved files in a durable attention item.
**Relevant preference:** Reliability and proportionate treatment of imperfect
input, rather than treating every discrepancy as a reason to halt.
**Disposition:** Accepted. Manual/scheduled runs attempt repair before continuing;
unresolved partial conversion is committed with a question. Deploy/container
runs defer the partial migration to the scheduled repair pass. A partial result
is not described as fully current. Hard failures still stop the queue.

### Recovery must not introduce a binary-debris gate

**Location in plan:** Track 2, One application path with Git recovery.
**Citation:** `beebox/src/core/annex/staged-unlisted.ts:9`: “pre-existing on-disk debris stops blocking unrelated commits.”
**Issue:** The first draft refused recovery when an oversized/unlisted blob
would be omitted, while the proposed temporary-index construction did not
actually omit it.
**Why it matters:** This invents another reason dirty boxes never converge.
**Suggested action:** Snapshot ordinary non-ignored input, keep Git filters,
and leave application validation on the output commits.
**Relevant preference:** Use Git recoverability without excessive preservation
machinery or unrelated blockers.
**Disposition:** Accepted the gate removal; retained index-version preservation
for human edits. Recovery refs stay local and are not automatically pushed.
Actual inability to preserve relevant input remains a concrete failure.

### Bound failed and interrupted agent attempts

**Location in plan:** Track 3, Bounded repair by the box's agent.
**Citation:** `beebox/deploy/deploy.sh:743` invokes `timeout 600 bbx migrate --sweep`.
**Issue:** A failed agent response or killed repair must not restart every hour
without durable evidence that the attempt already occurred.
**Why it matters:** Repeated agent execution is expense and repeated mutation,
not successful convergence.
**Suggested action:** Give every actual failed repair a question, retain an
interrupted-start receipt, and keep agent work out of deploy's restart window.
**Relevant preference:** A bounded repair path in existing machinery.
**Disposition:** Accepted. The schedule owns unattended agent work. A Git ref
records repair start; uncertain interruption becomes an explicit question on
next invocation. A verified no-work authentication failure can retry.

### Stage new output and restore original staging on rejection

**Location in plan:** Track 2, One application path with Git recovery.
**Citation:** `beebox/src/lib/git.ts:375`: `await stageFiles(boxRoot, paths);`.
**Issue:** Calling `commitPaths` alone misses new, untracked interface cards.
Restoring only the manifest after a rejected commit leaves other attempt output
staged for an unrelated writer.
**Why it matters:** Both are ordinary paths in the original incident and its
recovery, not unusual failures.
**Suggested action:** Use `stageAndCommitPaths`; restore the pre-attempt index
entries for all attempted paths when the commit fails.
**Relevant preference:** Preserve useful Git history and recoverability.
**Disposition:** Accepted. Restore original staging rather than unstage blindly,
which would discard a human's prior staging choices.

## NOT in scope (verified)

The draft excludes marker/hook/scan work owned elsewhere, v2 performance,
general template management, external editor exclusion, backup replication and
cleanup, and a rewrite of all historical migrations. The plan's source/test
budget applies to the whole implementation, including recovery and reporting.

## Things I checked and found clean

All template headings are present. Source citation line numbers were checked
and corrected. The existing generated-docs template commit was traced: it
collects pre-existing managed-file dirt, so the plan explicitly defers those
internal commits for convergence and commits only measured output. A failed
refresh invalidates its cache marker rather than hiding dirty generated output
behind a subsequent cache hit.

The direct agent path reuses the configured harness and leaves verification
and completion with the migration runner. It does not need procedure-engine
changes. The initial source/issue edit was preserved. No migration or repair
was executed against a real box while writing this plan.

Cross-model verification confirmed the revised commit scope, staged-version
recovery, generator commit boundary, and failure-outcome handling. It found
three remaining specification omissions, now corrected: deploy must stop at a
pending partial migration; snapshot refs and repair receipts need disjoint
paths; the schedule needs explicit per-box execution/transport limits instead
of inheriting its old two-minute fleet probe timeout. The plan now defines all
three. These were verified against the cited source and revised locally; no
third fresh review was requested.

Documentation and plan-lifecycle checks pass. Implementation tests, annex
evidence, the knowledge audit, and live convergence remain future acceptance
gates, not claims made by this review.

The shared-lifecycle extension received a separate cross-model plan review.
Three findings were adjudicated against the expanded human request:

- Accepted the simpler held-file-lock lease model. Removed the separate work
  registration store, PID liveness authority, and per-request serialization
  lock. Admission acquires before checking phase; closure writes before scanning.
  Retained parent-to-child retention ordering: a child cannot appear after its
  parent released the last lease and maintenance already began.
- Accepted a single server-side deployment controller across activation,
  restart, and verification; separate SSH sessions cannot hold one refreshed
  lock. Removed container exec handoff and unnecessary all-box gating for a
  scheduler-only replacement. Retained supervisor ownership of box reload:
  HTTP 502 alone does not exclude CLI writers or a competing migration. Reuse
  health/canary plus expected generation checks, without a new readiness channel.
- Accepted explicit timer re-arming on refused admission. Retaining a timer on
  disk alone does not guarantee another delivery attempt before process restart.

Three inaccurate source quotations in the new track were corrected against the
source, including the process-group wait's returned survivor list. Documentation
checks were rerun after the revision. Cross-process ordering and lifecycle
behavior remain implementation acceptance tests, not executed evidence.


## Implementation review, 2026-09-14

An independent Opus diff review confirmed dirty-box application and the
close-before-drain invariant, then identified exit-path defects. The response:

- Retain per-box verification: global deploy failure must not strand a ready
  box that independently passes the existing canary. Unknown manifests,
  unrun procedures, and unverified soft conversions stay closed after activation;
  the suggestion to reopen these was rejected because readiness was not proven.
- Give containers a bounded repair attempt and explicit exec recovery access;
  a blocked container waits instead of restarting its failed migration forever.
- Publish HTTP readiness after releasing startup work. Keep the completion
  assertion as an invariant; asynchronous work must finish before a caller
  declares completion. Real-process coverage proves the ordering.
- Failed prepared reloads return to an exclusive recovery phase instead of
  leaving an expired ready permission.
- Serialize work-lease publication and the zero-reader scan under a short
  existing file lock. Merely including guard directories does not prevent a
  descendant appearing after directory enumeration while its parent disappears.
- Observe delegated mutations on owner failure. Joined completion is now a
  no-op; final convergence explicitly prepares startup after the entire phase.
- Reject reopening merely because the repair agent could not start: the failed
  deterministic migration may already have changed data before that comparison.
  Report unavailability and preserve recovery rather than invent a loss question.
- Retain the per-box schedule registry, which includes Telegram thread managers,
  and the null async context, which clears inherited startup/request context as
  well as process environment. Neither duplicates the main chat runtime.

Additional integration tests found and fixed a stale retry baseline, a detached
fast-ACK permission race, readiness authentication, and a successor reload
request arriving while the previous controller was releasing. The scope remains
the approved BIG CHANGE. The second Opus pass verified the ownership, readiness,
drain, and retry fixes. It also found two integration inconsistencies: `attention`
was safe to serve but CLI exit 1 blocked Docker and upgrade, and stopping a reload
after the old child acknowledged exit retained an exclusive phase despite no data
change. Focused regressions cover both corrections. This review is not production
rollout evidence.

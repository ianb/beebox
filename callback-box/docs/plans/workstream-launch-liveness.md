---
title: "Protect a workstream while its agent launches"
status: active
workstream: streams-and-issues
issues:
  - ../../../issues/closed/bugs/2026-08-20-workstream-launch-liveness-gap.md
---

# Protect a workstream while its agent launches

This plan closes the long interval in which a worktree exists but its agent
process is not yet observable. It adds one bounded launch lease to the existing
session registry and adds `launching` to the shared liveness state set.

## Stated preferences this plan trades against

- Engineering principle 4 requires failures to be resilient and visible.
  `callback-box/docs/engineering-principles.md:51` says, *"invisible
  degradation is not"*. A failed launch must leave an inspectable state.
- Engineering principle 8 requires one implementation of an operation. The
  existing shared liveness guard remains the only answer used by destructive
  callers. The plan does not add a sweep-only pin check.
- Engineering principle 9 requires formal structure for essential complexity.
  `callback-box/docs/engineering-principles.md:108` says, *"make it explicit
  rather than implicit"*. The launch interval becomes a named registry state.
- Engineering principle 10 treats testability as architecture.
  `callback-box/docs/engineering-principles.md:118` names *"clock injection"*
  and *"a pure decision core extracted from an IO shell"* as deliberate seams.
  The lease classifier accepts an explicit current epoch.
- Engineering principle 13 requires pending intent to be visible.
  `callback-box/docs/engineering-principles.md:153` says, *"the control shows
  the intent as pending"*. The workstreams list must distinguish launching from
  dormant.
- `callback-box/CLAUDE.md:107` says, *"Read before writing."* This plan reuses
  the registry lock and liveness guard instead of adding a new state store.
- `callback-box/code-style.md:30` says, *"Never silently ignore errors"*. A
  launcher that cannot establish its lease must refuse to open the Terminal.

## What already exists

- `bin/lib/launch-session.sh:20-47` creates or resolves the worktree before it
  writes session metadata. The agent starts later at lines 48-52. The unsafe
  interval is inside this generated script for Claude. The Codex path has the
  same order at `bin/lib/launch-session.sh:61-87` and starts Codex at lines
  104-116. This plan changes both generated scripts.
- `bin/lib/launch-session.sh:138-153` owns Terminal automation for both fresh
  launches and resumes. It says, *"do script \"$LS_LAUNCHER\""*. This is the
  last synchronous boundary before the new shell runs. This plan records the
  lease immediately before that call.
- `bin/lib/session-registry.sh:54-82` has a stale-owner-aware directory lock.
  `session_registry_merge` then performs an atomic temporary-file rename at
  lines 84-119. This plan extends that implementation with token-checked launch
  begin and completion operations.
- `bin/lib/worktree-teardown.sh:185-193` initializes the shared liveness
  result. Its snapshot fast path currently returns `none` immediately
  when no agent process exists at `bin/lib/worktree-teardown.sh:203-208`. This
  plan checks the launch lease before either process path.
- `bin/workstreams:804-835` says sweep uses the shared guard because a local
  copy previously created a fail-open deletion bug. This plan preserves that
  boundary. Sweep gains protection only through `wt_other_agent_live`.
- `bin/lib/workstream-routing.sh:39-50` projects `live`, `dormant`, `removed`,
  and `uncertain` states. This plan projects an active lease as `launching` and
  an expired lease as `uncertain`, so failure does not look dormant.
- `callback-box/test/dev/launch-session.doctest.md` already builds both agent
  scripts without opening a real Terminal. `callback-box/test/dev/session-registry.doctest.md`
  exercises atomic and concurrent registry updates. `callback-box/test/dev/workstream-cull.doctest.md`
  exercises the shared liveness guard. The plan extends these three tests.

## Prior art (external)

No external search is required. This is an internal process protocol with no
third-party API or platform behavior to select. The repository's atomic session
registry and fail-closed liveness guard are the authoritative prior art. A
generic lock-file or service-manager lease would add a second ownership system
without improving this protocol, contrary to engineering principle 8.

## Tracks / scope

### Track A — Add a token-checked registry lease

**What.** Add a `launch` object to a workstream registry record. It contains a
unique token and `startedAt`. The classifier derives expiry from that timestamp
and one fixed 60-minute duration. It returns `none`, `active`, `expired`,
`failed`, or `unknown` from a record plus an explicit current epoch.

**Why this needs to change.** A process-only guard cannot observe work that has
not reached the process boundary. A durable lease can cover Terminal startup,
worktree creation, dependency installation, and agent validation.

**Direction.** Add these shell functions to `bin/lib/session-registry.sh`:

- `session_registry_begin_launch <name> <token>` atomically replaces `launch`.
- `session_registry_complete_launch <name> <token> <patch>
  [--preserve-base-sha]` atomically validates the token, merges the completed
  session patch, and removes `launch`.
- `session_registry_fail_launch <name> <token> <reason>` marks only the matching
  lease failed and records `failedAt`. Terminal automation and the generated
  shell use it for observable failures.
- `session_registry_launch_status_from_record <record> <now-epoch>` returns the
  closed state set above. Missing records are `none`. Invalid or incomplete
  launch objects are `unknown`, never `none`.

The completion token prevents an old delayed shell from clearing a newer
launch. The state lives in the existing registry lock and atomic-write path.

**Vocabulary lock-ins.** `launch` is the registry field. `active`, `expired`,
`failed`, `unknown`, and `none` are its classifier states. `launching` is both
the shared liveness state and the workstream routing state while a lease is
active. Agent liveness becomes `none | launching | live | unknown`.

**First implementation chunk.** Write red registry doctests for active,
expired, malformed, matching completion, and stale-token completion. Then add
the registry functions without changing any launcher or sweep caller.

### Track B — Feed the lease through shared liveness, inventory, and routing

**What.** Make `wt_other_agent_live` classify the registry lease only after
argv and cwd signals establish that no agent process is live. An active lease
returns `WT_AGENT_STATE=launching` with a `signal=launch-lease` reason. An
unknown lease returns `unknown`. Expired, failed, and missing leases return
`none` after the process checks.

**Why this needs to change.** All destructive paths already trust this guard.
Putting the lease here protects sweep, remove, SessionEnd, Codex teardown, and
process cleanup without duplicated deletion policy.

**Direction.** Process evidence has precedence over a lingering lease, so a
registry completion error cannot mask a real agent. `workstream_routing_json`
uses the same lease classifier. It returns `launching` with action
`wait-for-launch` for an active lease, before the stale-workstream branch. It
returns `uncertain` with action `investigate` for an expired, failed, or
malformed lease when no agent is live. `session_registry_summary` includes the
classified launch state and timestamps for the resident app and JSON CLI.

`bin/workstreams list` also emits registry-only rows whose worktree does not
exist when their launch state is active, failed, expired, or unknown. This makes
the launch visible before `git worktree add` creates the directory. The
resident app shows a Launching section and does not offer Focus or Close until
a real agent exists. A failed or expired registry-only row remains an
investigate state, offers an explicit Retry when its intended agent is known,
and ages out with the registry's 90-day retention if nobody retries it.

`workstream_resume_state` refuses a second resume while an active lease exists,
whether or not its directory has appeared. Failed and expired registry-only
launches can retry through the normal resume path; their newer token replaces
the terminal attempt.
`process-cleanup.ts` accepts `launching` and spares resources exactly as it does
for `live` and `unknown`.

**First implementation chunk.** Add a red cull doctest in which the process
snapshot says `no-agents` but an active registry lease returns `launching`.
Add routing and list tests for active, expired, failed, and registry-only
leases. Then connect the shared classifier and UI vocabulary.

### Track C — Bracket Terminal launch with the lease

**What.** Generate one unique token in `launch_session_build`. Establish its
lease before `osascript` opens Terminal. Keep it active through worktree setup
and agent-specific validation. Claude completes it atomically with the session
patch immediately before starting the agent child. Codex records session
metadata but retains the lease while its child runs, then clears it before
Codex teardown; this removes Codex's completion-to-process-visibility gap.

**Why this needs to change.** The lease must exist before the worktree can
become sweep-eligible. Starting it inside the generated shell would recreate
the current gap.

**Direction.** `launch_session_open` refuses to invoke Terminal if registry
begin fails. If Terminal automation returns a failure, it marks only its own
token failed. A successful AppleScript leaves the lease for the generated
shell. Each generated script installs an EXIT trap that marks the matching
token failed until the agent boundary. This reports worktree-creation,
validation, and ordinary shell failures immediately. Kill-9 or a shell that
never starts remains covered by expiry.

Both scripts perform a token-checked registry update after all validation. A
token mismatch aborts the older shell before it can start a second agent. A
registry lock or IO error prints a warning but permits the agent to start,
while leaving the EXIT failure trap armed. Process evidence takes precedence
over any lingering lease. Claude completion and the session patch are one
atomic write; Codex's first write retains the lease and its post-child
completion clears it.

**First implementation chunk.** Add a red launcher doctest with a fake
`osascript` that reads the registry while Terminal automation is in progress.
It must observe an active lease. Add generated-script executions that prove
ordinary setup failure becomes `failed`, stale-token completion aborts, and
completion occurs after validation and before each agent command. Then
implement the bracketing.

## Could this be simpler?

The smallest change is to treat a recent directory modification time or recent
`launchedAt` as live. That does not work. `launchedAt` is currently written only
after worktree creation, and directory modification time also changes during
installs and unrelated filesystem activity. Neither signal has an owner, a
completion operation, or a bounded failure state.

A single boolean registry field is smaller than a tokenized lease. It fails
when two delayed launch attempts overlap: the older shell can clear the newer
attempt's protection. The token and expiry are the minimum additions that make
ownership and recovery explicit, per principles 4 and 9.

Storing both ISO and epoch expiry values would avoid parsing on each read, but
it creates two sources of truth. The plan stores only `startedAt` and derives
expiry from one constant. This preserves principle 8.

## Subplans

No subplan is required. The registry, liveness guard, and launcher form one
small protocol. The related git-creation serialization issue has its own issue
and will receive a separate plan because its lock ownership and recovery rules
are different.

## Failure modes

| What can fail | Test exists? | Handling exists? | Clear-or-silent? |
| --- | --- | --- | --- |
| Registry lock cannot be acquired before Terminal opens | New launcher doctest | Refuse to open Terminal | Clear error |
| AppleScript fails after lease creation | New launcher doctest | Mark the matching lease failed and return nonzero | Clear error and failed row |
| Generated shell never starts | New registry/routing doctests | Lease expires after 60 minutes | Visible as expired and investigate |
| Worktree setup fails before agent start | New generated-script doctest | EXIT trap marks the matching lease failed | Visible immediately as failed and investigate |
| Older shell completes after a newer launch begins | New stale-token generated-script doctest | Token mismatch aborts before agent start | Clear error; newer lease remains |
| Completion lock or IO fails | New generated-script doctest | Warn, start agent, keep the failure trap armed, and let process evidence outrank the lease | Clear warning; terminal state after the child exits |
| Registry launch shape is malformed | New classifier and cull doctests | Liveness returns unknown | Clear fail-closed state |
| Process snapshot reports no agents during setup | New cull doctest | Active lease returns launching after process checks | Clear launch-lease reason |
| Lease expires during an unusually slow valid setup | Expiry classifier test | Retry can supersede after expiry; cleanup can proceed after 60 minutes | Visible as expired; no silent permanent pin |
| Claude completion clears lease just before its child is visible | Launcher ordering test; no deterministic scheduler race test | Accepted process-startup boundary; Codex avoids it by retaining the lease through its child | Named residual risk, not silent |

There is no unresolved critical gap. Each new path has a deterministic doctest
and an explicit visible failure state.

## Agent-flow / user-flow edge cases

- **Two agents launch the same workstream:** ADDRESSED for agent duplication.
  Resume refuses an active lease; a directly-started newer launch replaces the
  token and the older shell aborts before starting its agent. Serializing any
  overlapping setup mutations remains the separate concurrent-launch issue.
- **A launch fails before a worktree exists:** ADDRESSED. Registry-only rows
  make active, failed, expired, and malformed launch state inspectable; terminal
  rows can retry and are pruned after retention.
- **A launch fails after a worktree exists:** ADDRESSED. Shared liveness pins it
  until expiry. Routing then shows `uncertain` instead of `dormant`.
- **A hand-edited registry has a malformed launch object:** ADDRESSED. The
  classifier returns `unknown`, which the liveness guard treats as blocking.
- **The system clock jumps:** DEFERRED. The fixed epoch lease follows wall
  clock, as the existing registry timestamps do. This protocol does not need an
  awake-time timeout because it is recovery state across processes and reboots.
- **The boxholder removes with `--force`:** ADDRESSED. The lease is part of the
  non-overridable shared liveness answer, not a cull pin.
- **A stale launch token survives successful agent start:** ADDRESSED. Process
  evidence outranks a lingering lease. The completion and session metadata
  update normally form one atomic registry write.

## NOT in scope

- Git worktree creation serialization is not in scope. It has a separate issue
  and needs a repository-scoped critical section.
- The SessionEnd sweep performance issue is not in scope. A launch lease only
  changes deletion eligibility.
- General session heartbeats are not in scope. Existing argv and cwd signals
  remain the authority after launch.
- Automatic retries after a failed Terminal launch are not in scope. The caller
  receives the failure and can retry explicitly from the terminal row.
- A configurable lease duration is not in scope. One internal 60-minute bound
  avoids a new user-facing setting. Observable shell failures report
  immediately, so the generous bound is reserved for unobservable death.
- Eliminating Claude's final completion-to-child-visibility scheduler window is
  not in scope. Codex retains the lease through its child; Claude must clear it
  before the child so its SessionEnd hook can clean up. The remaining bounded
  process-startup window is named and covered as an ordering residual risk.

## Open design questions

There are no open questions inside the first implementation chunk. The fixed
duration can be revisited only if real launch measurements exceed 60 minutes;
that is operational tuning, not a protocol decision.

## Knowledge audits

No knowledge audit is required. The lease is internal lifecycle machinery. A
box agent does not need to recall or author its vocabulary. Repository-facing
documentation and doctests are the enforcement surfaces.

## Implementation order

1. Add the red registry lifecycle and classifier doctests.
2. Refactor the registry's lock/read/write block into one internal conditional
   update helper. Implement token-checked begin, complete, failure, and
   classification through it.
3. Add the red liveness and routing doctests.
4. Feed the shared classifier through liveness, summaries, routing, registry-only
   list rows, process cleanup, and the resident app.
5. Add the red Terminal-boundary and generated-script ordering doctests.
6. Bracket fresh launches and resumes in `launch_session_open` and the two
   generated scripts.
7. Run the focused doctests, full callback-box and workstreams-app suites,
   shellcheck/lint, typecheck, and doc-check. Loop the fake launcher 25 times
   with alternating success, synchronous failure, and stale-token supersession;
   assert no successful run lacks a lease at the Terminal boundary and no old
   token clears a new one.
8. Update the issue with the resolving behavior and move it to `closed/bugs/`.

## Rollout shape

This plan ships as one lifecycle change. There is no data migration. Existing
registry records have no `launch` field and classify as `none`. New records are
backward-compatible JSON additions.

The done-when tests are:

- `session-registry.doctest.md` proves token ownership and bounded expiry.
- `workstream-cull.doctest.md` proves sweep's shared liveness answer is
  `launching` when the process snapshot still says no agents, while real
  process evidence takes precedence.
- `launch-session.doctest.md` proves the lease exists before Terminal opens,
  fails closed when it cannot be written, records AppleScript failure, and
  proves Claude token ownership plus Codex lease retention through its child.
- `workstream-resume.doctest.md` proves resume uses the same bracket.
- `workstream-list.doctest.md` proves lease-only and expired launch rows are
  visible.
- Workstreams app doctests prove the Launching section and non-destructive
  controls.

After implementation, the plan status becomes `active` until `/finish` lands
the branch and archives the plan as implemented.

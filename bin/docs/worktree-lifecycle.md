# Worktree lifecycle and teardown

## Ownership and roots

`bin/workstreams` is agent-neutral. Hooks and launchers only translate inputs;
shared behavior belongs in `bin/lib/worktree-create.sh`,
`bin/lib/worktree-teardown.sh`, and `bin/lib/worktree-paths.sh`.

Roots derive from `git rev-parse --git-common-dir`; failure is fatal rather
than falling back to a plausible home path. Overrides are `BBX_WORKTREE_ROOT`,
`BBX_BOX_ROOT`, and `BBX_BOX_SRC`. `create` emits exactly the resulting path on
stdout; all setup logs go to stderr. Git attachment serializes; same-name
callers wait for completed setup and different-name installs may overlap.
This guarantee covers managed commands only: never overlap a create with Claude
Code's native worktree removal, which mutates Git outside this tooling.
Creation keeps the isolated `test1` box outside the monorepo, installs each
level, copies `.env` without `BOXES=`, and generates mirrors.

Post-merge dependency sync is checkout-local. A changed root lockfile triggers
one frozen install in that checkout; failure warns but does not suppress an
eligible deploy.

## Destructive-operation guard

`wt_other_agent_live` returns `none`, `launching`, `live`, or `unknown` in
`WT_AGENT_STATE`. Only `none` authorizes destruction. Treat `launching` and
`unknown` as live everywhere, including browser reclamation; `--force` skips
merge/dirty checks only. Failed `ps`, argv, or `lsof` reads preserve the tree.

Detect agents with `ps -axo pid=,comm=` and match executable-path basenames;
never `pgrep -x claude`, whose accounting name may be its version. Query argv
and cwd for those exact PIDs, never combining process outputs from different
snapshots. Sweep uses one `wt_agent_snapshot_capture`. A snapshot and
`--exclude-self-ancestor` are incompatible and must fail closed.

SessionEnd passes `--exclude-self-ancestor`, walking parent PIDs and excluding
only the nearest ending agent. Codex teardown runs after Codex exits and does
not exclude one. Keep both native/managed Claude argv and cwd-based managed
Claude/Codex signals. Nested headless Claude also passes
`--setting-sources user` so project hooks do not load. These independent guards
prevent a reviewer from deleting its parent session's tree.

## Teardown and sweep

`bin/lib/worktree-teardown.sh` is the one destructive implementation shared by
SessionEnd, WorktreeRemove, Codex teardown, and list/remove/sweep. Satellite
cleanup is separate because native WorktreeRemove owns the Git worktree.

Pidfiles are current-generation single slots; [the router
protocol](router-protocol.md) governs generation checks. Startup, signals, and
`panic` also scan scoped orphans that pidfiles miss. A browser daemon under 60
seconds old is spared while its pidfile may be pending. Every orphan decision
uses the same liveness oracle.

Auto-sweep is submitted as a unique one-shot launchd worker. A request marker
and whole-sweep lock coalesce overlap without dropping the trailing request.
Logs pair `SUBMITTED`, `START`, and `END status=…`; EXIT removes the launchd
label. SessionEnd triggers from its EXIT trap after local teardown, covering
all early returns.

Sweep preserves live/unknown trees and manual-testing cull pins. After release,
an unmerged test-box branch is pushed as `keep/<workstream>-<date>` before
deletion; push failure refuses the cull. Private worktrees are removed only
when merged and strictly clean, otherwise reported as orphans.

## Sessions and generated guidance

Managed Claude and Codex use the same create path. Codex runs in foreground so
the launcher can call `bin/codex-session-end`; tab closure can bypass it and
sweep recovers later. Teardown runs main's copy after changing to main. Only an
explicit `r` removes interactively; no TTY, timeout, EOF, or empty input keeps.
Unmerged commits retain their branch.

`bin/lib/launch-session.sh` owns argv/defaults. Codex uses full-access parity,
launch-scoped trust/doc-size overrides, and an explicit default model unless
supplied. Resume uses only the recorded, shape-validated session ID; missing
transcripts become a declared fresh session before opening a tab.

`bin/generate-agents-md.ts` mirrors tracked `CLAUDE.md`, embeds nearest scoped
rules verbatim, symlinks complete skills, and adds the root Codex preamble. It
refuses tracked AGENTS files and non-generated skill collisions. Fresh and
resumed creation regenerate; Codex launch fails closed without the root mirror.
Edit CLAUDE/rule/skill sources, never generated AGENTS files.

## Command-state contracts

`list [--json]` derives Git, router, registry, schedule, and liveness state per
call. Router `unknown` differs from known `cold`; failed Git counts are `null`.
Rows parse independently. Routing state and action remain separate; scheduled
records survive culls, and culls record a tip instead of `removed`.

The JSON joins git state, router runtime, liveness, registry description,
`routing.state` (`launching|live|scheduled|dormant|stale|removed|uncertain`),
`routing.action` (`manual-forward|resume-with-briefing|new-stream-preferred|investigate`),
and one schedule projection. A roughly 14-day `stale` state is advice, not a
resume prohibition. Scheduled rows remain sticky when their worktrees are
removed or swept and cannot be archived; disable one by setting `enabled: false`
in its `schedule.yaml`.

`resume` refuses unknown names and active launch leases. A live session gets a
unique forwarding file and may be focused, but reports manual forwarding; that
is not delivered context. `archive` is display-only and refuses schedules.
`close` and forced removal retain liveness checks. `agent-liveness` takes
absolute paths so destructive callers need no shared root assumptions.

`reset-test` hard-resets the isolated clone to `test-setup`.
`confirm-tested` clears an issue's landed manual-testing need on main, deletes
that baseline branch, and commits the transition. `release` clears the cull pin
only after merge, cleanliness, and no live agent. `down` stops one worktree;
`panic` stops the router and tracked/scoped orphan processes and wipes runtime
state, while sparing processes attributed to live sibling agents.

`bin/land` is documented in [commit guards](commit-guards.md). The resident app
shells out to the CLI rather than duplicating guards.

Background: [worktree control-surface design](../../beebox/docs/plans/worktree-control-surface.md).

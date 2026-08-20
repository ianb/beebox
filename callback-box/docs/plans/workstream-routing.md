---
title: "Route new work to an existing workstream"
status: draft
workstream: streams-and-issues
issues:
  - ../../../issues/features/2026-08-20-no-way-to-know-what-a-workstream-covers.md
  - ../../../issues/bugs/2026-08-19-one-bad-workstream-row-blanks-the-issues-page.md
---

# Route new work to an existing workstream

Make a clerical agent able to inspect existing workstreams, choose one by eye,
and hand it a new briefing without pretending that every harness has the same
delivery abilities. The result is deliberately modest: a useful list, one
resume-with-context path, and an explicit manual fallback.

## Job to be done

- When a new issue resembles work already underway, I want to see what each
  recent workstream covers and whether it can receive work, so I can reuse the
  right context without remembering every branch name.
- When the chosen workstream is dormant, I want to resume it with the reason I
  am waking it, so the restored agent does not have to infer the new task.
- When the chosen workstream is live but cannot receive a programmatic message,
  I want a durable briefing and an honest instruction to forward it, so the
  handoff does not disappear or get reported as delivered.
- When a workstream has been dormant for roughly two weeks, I want the list to
  say that a new stream is usually preferable, so old context is not revived by
  accident.

## Stated preferences this plan trades against

- Principle 4, **resilient and never silent**
  (`callback-box/docs/engineering-principles.md:49`): *"Degradation is allowed
  for failures that can genuinely happen; invisible degradation is not."* A
  bad display row stays visible as a warning, and a briefing is never called
  delivered unless an agent actually received it.
- Principle 5, **failure paths visible in signatures where callers branch**
  (`callback-box/docs/engineering-principles.md:64`): *"When callers genuinely
  dispatch on why something failed, return a discriminated Result."* Routing
  routing state and next action are closed enums in JSON, not prose inferred by
  each consumer.
- Principle 8, **one way to do each thing**
  (`callback-box/docs/engineering-principles.md:95`): *"Competing idioms are
  drift generators."* `bin/workstreams resume` remains the lifecycle operation;
  this plan does not add a parallel `route`, `send`, or mailbox command.
- Principle 10, **testability is architectural**
  (`callback-box/docs/engineering-principles.md:118`): *"a pure decision core
  extracted from an IO shell"* is the standard. Status and delivery decisions
  are pure helpers exercised before shell and Terminal integration.
- Principle 12, **the maintainer is usually an agent**
  (`callback-box/docs/engineering-principles.md:141`): *"anything enforced only
  by memory of past conversations will eventually be violated."* The CLI emits
  machine-readable state and the launch skill teaches the same path to both
  harnesses.
- Boxholder direction from the routing brief: eyeballing `workstreams list` is
  acceptable; a workstream dormant for about two weeks is probably not worth
  reviving; status, abilities, and a fallback are enough for the first version.
- Root guidance: creation and cleanup remain agent-neutral shared control
  surfaces, and the shared router is never restarted from a worktree.

## What already exists

- The launcher already accepts literal text, stdin, or a file.
  `bin/launch-worktree-session:136-143`: *"case \"$1\" in ... -) prompt=$(cat)
  ;; @*) prompt=$(cat -- \"${1#@}\") ;; *) prompt=\"$*\""*. This is the input
  grammar to reuse for resume, not replace.
- A missing `@file` already fails because the script uses `set -euo pipefail`
  (`bin/launch-worktree-session:55`) and executes `cat` directly
  (`bin/launch-worktree-session:141`). The plan preserves this loud failure and
  adds an explicit empty-briefing check when a briefing argument was supplied.
- Launches write durable session metadata. `bin/lib/launch-session.sh:35-45`
  records branch, emoji, agent, model, tty, base SHA, and `launchedAt` through
  `session_registry_merge`. The missing description belongs in this record.
- Registry writes are serialized and atomic at the file boundary.
  `bin/lib/session-registry.sh:98-116` acquires a per-name lock, writes a
  temporary JSON file, and moves it into place. The new metadata uses this
  existing boundary.
- The CLI already computes one authoritative tri-state liveness answer.
  `bin/workstreams:521-525`: *"the agent-liveness answer must come from
  wt_other_agent_live and nowhere else."* Routing derives from this answer; it
  does not reimplement process detection in TypeScript.
- Resume already distinguishes live, existing, removed, unknown, and uncertain
  states. `bin/lib/workstream-resume.sh:4-22` maps them to `focus`, `existing`,
  `liveness-unknown`, `culled`, `removed-unmerged`, and `unknown`.
- Resume does not accept a briefing. Its parser accepts only `--agent`,
  `--fresh`, `--at-final-sha`, and one name (`bin/workstreams:344-356`), and its
  generated prompt contains only generic continuation context
  (`bin/lib/workstream-resume.sh:25-35`).
- A live resume request focuses the tab immediately.
  `bin/workstreams:381-384`: *"focus) exec ... workstreams focus"*. Therefore a
  new briefing currently cannot even reach later resume preparation.
- The list already carries liveness, runtime, Git state, and registry summary in
  JSON (`bin/workstreams:583-595`), but the human table prints only worktree,
  agent, Git, and runtime (`bin/workstreams:627-635`). It has no purpose, age,
  routing state, or next handoff action.
- The app groups rows using lifecycle facts, but mixes those facts into display
  prose. `workstreams-app/src/frontend/pages/WorkstreamsPage.tsx:10-17` derives
  sections such as `Recently culled`, `Untouched`, and `In progress` locally.
  The CLI and app can therefore disagree about what is revivable.
- The list scans every directory under the worktree root
  (`bin/workstreams:543-550`). The app validates the complete returned array at
  once (`workstreams-app/src/server/workstreams-command.ts:107-125`), so one
  non-worktree directory can invalidate every page.
- Git supplies stable machine-readable worktree enumeration and explicit lock
  state. The current tool partly ignores this source by iterating directories.

## Prior art (external)

- Git documents `git worktree list --porcelain -z` as stable script output and
  says `--lock` during `worktree add` avoids the race inherent in locking after
  creation ([Git worktree documentation](https://git-scm.com/docs/git-worktree)).
  The plan uses porcelain enumeration to decide what is a worktree. It does not
  use Git's lock as a session-liveness mechanism: Git defines it as protection
  for administrative pruning/move/remove, while this repository owns a richer
  agent-aware cleanup policy.
- Claude Remote Control is already an explicit launcher capability in this
  repository: `bin/launch-worktree-session:35-40` says Claude sessions can be
  steered and Codex has no per-session analog. The external documentation search
  did not expose a supported shell API for injecting a turn into either live
  session. This plan therefore reports the capability but does not build an
  unverified sender.
- The installed Codex CLI supports a prompt when resuming a session:
  `codex resume --help` documents `[SESSION_ID] [PROMPT]`. The implementation
  must pass the composed briefing after `--last`; the current launcher does not.
  This resumes a dormant session and does not steer a concurrently live one.

## Tracks / scope

### Track A — Make the list a resilient inventory

Keep the directory scan, but admit a row only when Git recognizes the directory
as a linked worktree. A random directory under `WT_ROOT` is ignored and reported
on stderr as an anomaly; it is not emitted as a workstream row. This avoids
including the main checkout or out-of-root worktrees whose box and URL cannot be
derived here. Registry-only removed rows remain valid and retain their recorded
branch. Use `git worktree list --porcelain -z` once to build the recognized path
set; do not run a Git enumeration per directory.

At the app boundary, parse rows independently. Return valid rows plus a bounded
array of typed warnings containing the row index/name when available and the
invalid field paths. The workstreams, issues, plans, and testing views render
the valid data and one visible warning banner. Invalid top-level JSON or command
failure still fails the request because no trustworthy rows exist.

Tests first:

- Extend `workstreams-app/test/server-boundary.doctest.md`: one invalid row
  returns the other rows and a warning; invalid JSON and command failure remain
  hard errors.
- Add a shell-facing workstream inventory test around a temporary Git repo:
  linked worktrees appear, a stray directory does not, and a removed registry
  row does.

### Track B — Record a concise description without another human step

Add `--description <one-line text>` to `bin/launch-worktree-session`. The
`launch-worktree-session` skill always supplies it from the briefing it writes,
so the boxholder does not have to author duplicate text. The launcher trims
whitespace, rejects newlines and blank values, bounds the stored length, and
writes `description` in the same launch registry patch as `launchedAt`.

For compatibility, an omitted description is allowed and displayed as null,
but the launch patch omits the key entirely so resume and bookkeeping cannot
erase an existing value. Do not guess by stripping Markdown from the first briefing line: headings,
quotes, and hand-written briefs make that implicit rule unreliable. Existing
records remain valid without migration. Worktrees created directly through
`bin/workstreams create` or the Claude WorktreeCreate hook have no briefing to
summarize and continue to show no description.

Surface the description in `bin/workstreams list` and each app row. Search in
the app matches name and description. Do not backfill descriptions from issue
ownership: the filed issue establishes that most historical ownership is not
informative.

Tests first:

- Add launcher parsing tests for valid, blank, multiline, too-long, and omitted
  descriptions.
- Extend the registry/list tests to show old null descriptions and new values.
- Extend the workstreams frontend doctest with description rendering and search
  matching.

### Track C — Publish routing state separately from the next handoff action

Add two discriminated fields to each CLI row and shared app schema:

- `routing.state`: `live`, `dormant`, `stale`, `removed`, or `uncertain`.
- `routing.action`: `resume-with-briefing`, `manual-forward`,
  `new-stream-preferred`, or `investigate`.

The decision helper consumes facts already collected by the shell: worktree
presence, tri-state liveness, recorded agent, removal state, and last activity.
It does not inspect processes independently.

Last activity is an explicitly approximate display value: the newest timestamp
among `launchedAt`, a recorded removal time, the branch tip's commit time, and
the worktree directory mtime as a fallback for hook-created or uncommitted-only
work. Registry `updatedAt` is excluded because bookkeeping writes are not
evidence that work happened. A non-live workstream whose last activity is at
least 14 days old is `stale`; the table says `new stream preferred`. Unknown
timestamps yield `uncertain`. The cutoff is guidance, not a resume prohibition.

The next action is derived independently:

- any live session: `manual-forward`, because no supported sibling-session
  sender is verified;
- dormant or removed-but-revivable: `resume-with-briefing`;
- stale: `new-stream-preferred`, while explicit resume remains available;
- archived, gone, or liveness-unknown: `investigate`.

The human table gains `STATE`, `ACTION`, `AGE`, and `DESCRIPTION`. The app shows
the same fields and places stale entries away from recent dormant work.

Tests first:

- Add a pure routing-decision doctest covering every state/action pair,
  including live+unknown-agent, old-but-live, absent timestamps, and liveness
  unknown.
- Extend CLI JSON/table fixtures and the app schema/rendering doctests.

### Track D — Resume with the new briefing

Extend `bin/workstreams resume` with the launcher's existing optional briefing
forms: literal arguments, `-` for stdin, and `@file`. Extract prompt-source
parsing into one sourced helper used by launcher and resume, with explicit
errors for a missing file and for an empty supplied briefing.

For a dormant or removed-but-revivable workstream, append the new briefing to
the generic continuation prompt under an `<agent-continuation>` wrapper. The
new session receives both the archaeology context and why it was resumed. For
an existing dormant Codex session, pass the composed prompt to `codex resume
--last` as its documented optional prompt argument; the current command drops
the prompt in exactly this case.

For a live workstream, do not claim injection. Write the wrapped briefing to a
unique machine-local temporary file, focus the Terminal tab when possible, and
print `manual forwarding required: <path>`. A unique file avoids overwrite and
acknowledgment semantics. A successful dormant resume prints `launched with
briefing`.

Tests first:

- Extend workstream resume doctests for every prompt source, wrapper composition,
  and missing/empty input.
- Add a launcher-level test proving `codex resume --last` receives the prompt;
  a prompt-composition-only test would miss the current silent drop.
- Test live/manual, dormant Codex, dormant Claude, uncertain, and stale outcomes
  without opening Terminal.

### Track E — Teach the routing workflow

Update the `launch-worktree-session` skill and `bin/CLAUDE.md` with one decision
sequence:

1. Run `bin/workstreams list` and inspect description, state, delivery, and age.
2. Prefer a matching recent live/dormant workstream; prefer a new workstream
   when the candidate is stale (14 days) unless the boxholder explicitly wants
   its history.
3. Use `bin/workstreams resume <name> <briefing-source>` for an existing stream.
4. Report exactly one outcome: launched with briefing or manual forwarding
   required. Never report a live briefing as delivered.
5. Launch new workstreams sequentially. Concurrent creation is a separate
   lifecycle bug, not part of this routing plan.

The skill continues to use Codex as its default new-session harness. It does not
promise that a live Codex session is directly addressable.

Add a small knowledge audit only if a box agent is expected to route workstreams.
This workflow belongs to repository engineering agents today, whose generated
AGENTS.md and mirrored skill are the enforcement surface; a callback-box agent
does not need to know it.

## Could this be simpler?

Yes, and this plan takes the simpler options:

- No semantic recommender. Name, one-line description, owned issues, age, and
  state are enough to eyeball.
- No issue-frontmatter migration. Historical `unknown` ownership remains
  historical residue; routing metadata lives with the workstream.
- No general inter-agent mailbox. A live handoff is one uniquely named
  forwarding file with no queue or acknowledgment protocol.
- No attempt to infer a description from arbitrary Markdown. The launching
  agent supplies one explicit line while already composing the briefing.
- No second liveness implementation in the app. The shell emits the decision
  based on its existing authoritative guard.
- No unsupported terminal keystroke injection or Codex protocol experiment.
  Manual forwarding is acceptable and honest.

Removing any of Tracks A through D would leave the stated job incomplete.
Track E keeps the capability usable across sessions. The independent creation
and startup-cleanup races remain real lifecycle bugs, but do not block landing
the inventory outage fix or this routing workflow.

## Failure modes

| Failure | Visible behavior | Test exists? | Recovery |
|---|---|---|---|
| Stray directory under worktree root | CLI warning; no fake row; app still renders | Track A adds it | Remove the directory after identifying its owner |
| One malformed registry/list row | Valid rows render with warning banner | Track A adds it | Inspect named row and registry file |
| CLI emits invalid top-level JSON | App fails loudly; no partial fiction | Existing boundary test, retained | Fix the CLI/command failure and retry |
| Description absent on an old record | Null/“no description”, never inferred | Track B adds it | Add description on the next launch |
| Liveness cannot be determined | `uncertain`, action is investigate, cleanup refused | Existing liveness tests plus Track C | Retry after process inspection recovers |
| Workstream is older than 14 days | `stale — new stream preferred` | Track C adds it | Explicitly resume only when old context is wanted |
| Briefing file is missing or empty | Resume exits before launch | Track D adds it | Correct the source and rerun |
| Live agent has no sender | Unique forwarding-file path and manual instruction | Track D adds it | Human forwards the file |
| Two handoffs target the same live stream | Two unique files, neither called delivered | Track D adds it | Forward the intended file; delete stale temporary files |

## Agent-flow / user-flow edge cases

- A workstream may be live but its Terminal tab missing. State remains live;
  focus failure does not downgrade liveness or imply manual deletion is safe.
- Claude Remote Control may be enabled, but the repository has no verified
  sibling-session sender. It receives the same manual-forward action as Codex.
- A workstream can be old and live. Live wins for state; the age remains visible
  but does not recommend starting over while work is in flight.
- A removed workstream with unmerged work keeps the existing `--at-final-sha`
  or `--fresh` choice. Supplying a briefing does not bypass that safety gate.
- A removed, merged, clean workstream can disappear again after its resumed
  agent exits. The resume result warns when the restored branch has no unique
  commits and points to the pending/owned issues as the durable record.
- A description can become stale as scope evolves. A later launch may replace
  it explicitly; ordinary registry bookkeeping does not touch it.
- A handoff may contain sensitive operational context. It lives in a
  machine-local temporary directory, never in the public repository or JSON
  table, and list output never exposes its content.
- `workstreams list` remains useful when the shared router is down. Runtime is
  already `unknown` in that case (`bin/workstreams:538-542`); routing state does
  not depend on router availability.

## NOT in scope

- Semantic matching, embeddings, ranking, or automatic issue assignment.
- Backfilling the 282 historical `workstream: unknown` issue records.
- A general multi-message, multi-consumer agent mailbox.
- Researching or implementing Codex app-server thread steering.
- PTY keystroke injection into Terminal tabs.
- Concurrent worktree-creation serialization and the pre-agent sweep window;
  each is tracked as a separate lifecycle bug.
- Changing workstream teardown policy or retaining merged-clean branches merely
  because they once received a handoff.
- Restarting or redesigning the shared router.
- Moving the Markdown/docs browser; that work is being handled elsewhere.

## Open design questions

1. **Description length and replacement UX.** Proposed default: 160 Unicode
   code points, explicit replacement on every launcher invocation that supplies
   `--description`. This is enough for one scan line without turning the field
   into a second briefing.
2. **Remote-control delivery integration.** Deferred. If later research finds a
   supported sibling-session sender, add a delivered outcome only with a
   receipt that proves the turn entered the target session.

None of these questions changes the data model or the first three tracks. The
proposed defaults are safe enough to implement unless the boxholder prefers a
different interaction.

## Knowledge audits

No callback-box knowledge audit lands initially. The concepts are developer
tooling, not knowledge a box agent needs during card work. The repository-facing
contract is tested in the mirrored `launch-worktree-session` skill and generated
AGENTS.md. If routing is later exposed to box agents, add audits for the 14-day
cutoff and the distinction between manual forwarding and a resumed-with-
briefing launch in that change.

## Implementation order

1. **Inventory resilience commit** — Track A tests, Git-backed enumeration, and
   per-row app warnings. This closes the existing outage bug independently.
2. **Routing vocabulary commit** — Track C pure decision tests and JSON/schema
   fields, initially with null descriptions.
3. **Description commit** — Track B launcher/registry/list/app changes and tests.
4. **Briefed resume commit** — Track D shared prompt parsing, forwarding file,
   explicit outcomes, and tests.
5. **Workflow documentation commit** — Track E skill and mechanism docs, then
   regenerate AGENTS.md mirrors for verification without committing them.
6. Run a cross-model review of the complete implementation and surface findings
   before declaring the plan implemented.

Each commit is independently coherent, but the feature ships only when all
tracks are complete. Do not merge a partial routing vocabulary that the skill
cannot use end to end.

## Rollout shape

- Automated acceptance:
  - targeted shell inventory/registry/resume/creation tests;
  - `workstreams-app` server-boundary, service, and frontend doctests;
  - root typecheck/lint and `pnpm doc-check`;
  - existing teardown/sweep suite to prove the fail-closed guard did not fork.
- Manual acceptance uses a disposable pair of workstreams, sequentially until
  the creation-race fix is installed:
  1. Launch one Claude and one Codex stream with descriptions.
  2. Confirm `bin/workstreams list` and `/workstreams/` show the same state,
     age, next handoff action, and description.
  3. Resume a dormant disposable stream with an `@file` briefing and confirm the
     first turn contains both continuation context and the new reason.
  4. Route to live Codex and Claude streams, confirm the CLI says manual rather
     than delivered, and forward each unique temporary file.
  5. Create a stray directory and a malformed registry fixture; confirm the app
     still renders valid workstreams with a visible warning.
- No data migration is required. Existing registry records parse with null
  description/manual capability and gain new fields on their next launch.
- No shared-router restart is performed from this worktree. If app changes need
  the resident supervisor reloaded for manual acceptance, ask the boxholder to
  restart it from main after landing.

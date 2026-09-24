# The development workflow

Part of [how development happens here](development-process.md). See also
[agent coding and the checks around it](agent-coding.md), [testing](testing.md), and [technologies and AI
services](technologies.md).

## Workstreams

A piece of work gets its own worktree, branch, and session, created by the
`launch-worktree-session` skill, with an isolated clone of the test box. The
launching session writes a briefing, because the new session does not inherit
the conversation: it carries the shared understanding, the decisions already
made, and the human's actual authorization.

Sessions land on `main` with the `finish` skill, which dispatches a headless
subagent so the merge and test churn stays out of the chat.
`bin/finish-preflight` merges `main` and prints a decision sheet, and
`bin/finish-verify` runs exactly the checks that sheet named. The agent then
reviews the changed lines, reconciles the plan, closes the issues the work
resolved, and merges with `bin/land`. It cannot ask questions mid-run, so it
merges only on a clean path and otherwise stops and says what needs deciding.

Commits carry provenance. Hooks stamp `Workstream:` and, when exactly one plan
matches, `Plan:`. An `Issue:` trailer is added by hand and must name a real
public issue. One shared dev router serves every checkout by path prefix, main
and worktrees alike.

## Issues

`issues/` at the repository root is the queue: one markdown file per item, title
in frontmatter. The category is the directory: `bugs/`, `features/`,
`code-quality/`, `docs-and-chores/`, `decisions/`, `exploration/`, `watch/`.
Closed items move to `closed/<category>/`, so placement is the status.

Most items are tensions, not mandates, and being filed is not license to
implement one. Filing is at the agent's discretion: something you can just fix,
you fix; you file when it is outside your current work or genuinely unsettled.
Bodies are written in Simplified Technical English, because an issue is read
cold months later.

`next-action:` is how the maintainer hands an idea back to an agent. `discuss`
routes an item back to them; `reconfirm`, `duplicate`, `invalid`, and `fixed`
are provisional, asking the next agent to check a suspected outcome; and
`manually-confirmed` and `verify-without-me` settle a human testing gate.
`private-issues/` is the counterpart: a separate, gitignored repository for
non-public content, which public files never link into.

## Recurring work

`schedules/` holds one directory per recurring job: a `schedule.yaml` with the
cadence, an executable `run`, and a `prompt.md` when the run starts an agent.
One launchd tick drives all of them, and due-ness comes from persisted state, so
a laptop that slept catches up once. Each run's report is a durable alert
record, and a run ending with no report is itself a failure.

The current jobs: `deferred-issues` and `full-suite` hourly; `box-convergence`,
`docling-update`, and `sdk-update` daily; `cross-box-leak-scan`, `knip-sweep`,
`manual-tests`, `smoke-review`, `supplemental-lint`, and `tour-check` weekly.

## Document comments

The maintainer leaves remarks on a document in the browser, and they wait in a
store outside git. An agent lists them at pickup with `bin/comments`, reads
those on a document it opens, and clears them after acting.

## Planning

Non-trivial work gets a plan before it is built. Plans live in
`beebox/docs/plans/` under a required status header: `title`, a `status` of
`draft`, `active`, `partial`, `implemented`, `superseded`, or `parked`, a
`workstream`, and an `issues` list. A plan is a complete unit of work, designed
and shipped end to end, and it is exactly the size of work the cross-model rule
covers, so it gets reviewed by the other family first.

The taxonomy separates three things that used to be mixed: proposals, records of
shipped work, and reference documentation. When the work lands, `finish`
reconciles the plan against the diff, classifying each requirement as met,
partial, unmet, or unverifiable. A fully met plan moves to
`docs/implemented-plans/`, a partial one stays put with its prose corrected, and
an abandoned one moves to `docs/unimplemented-plans/`. Reference documentation
stays flat in `docs/` and describes the system as it works now. The conventions
are in [plans/README.md](plans/README.md).

## Exhibits

Chat is a poor medium for much of what an agent produces: it is ephemeral, and
feedback only lands if the maintainer is present. An exhibit is the alternative,
a directory they view in a browser, holding a rendered document, labeled
figures, or a small interactive page.

Every exhibit carries exactly one ask. `decide` picks among enumerated options,
`confirm` proceeds unless vetoed, `react` wants impressions, `fyi` needs
nothing. The queue only works if the type is honest; a real decision tagged
`fyi` is a decision that never gets made. Screenshot evidence goes out as one
labeled exhibit whose captions say what each figure demonstrates.

Exhibits live in a per-workstream store, so they survive a worktree cull and
never merge. A durable tool goes to `dev/apps/` instead, where the code is
tracked while its data still lands in the store.

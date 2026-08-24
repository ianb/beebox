---
title: "Scheduled monitors have no way to talk to Ian — a message queue outside git"
workstream: scheduled-task-voice
design: ../../callback-box/docs/plans/scheduled-workstreams.md
area: monorepo
needs: [design]
labels: [scheduler, workstreams, notifications]
filed-by: agent
discovered-by: Ian
discovered-in: main session — cb feedback triage
priority: normal
---

The recurring jobs — the Agent SDK update monitor, the weekly manual-test run,
periodic health monitors, the scheduler daemon — all suffer the same problem:
**it's hard for them to tell Ian anything.** Each invented its own channel, and
none of them is something he can work through later.

| Job | How it reports |
|---|---|
| `bin/update-agent-sdk-scheduled.sh` | `PushNotification` + an `osascript` notification on nonzero exit |
| `bin/manual-tests-scheduled.sh` | its own `notify()`, plus a triage agent that files `issues/` items |
| `callback-box/deploy/deploy.sh` | `notify()` / `terminal-notifier` |
| the scheduler daemon (`cb tick`) | **nothing** — writes `.callback-box/scheduler.jsonl` and hopes |

Four jobs, four mechanisms, and a macOS notification is gone the moment it's
dismissed. Recent cost: a deploy died mid-run and said nothing (the trap never
fired), and `demo-daily-rumination` was broken for six weeks with no signal.

## The idea: a queue, out of git

A message queue **outside git** that scheduled work writes to and Ian reads —
so a monitor with something to say has somewhere durable to put it that isn't a
notification (ephemeral), an issue (too heavyweight for "FYI, I bumped a
version"), or a log file (nobody reads logs).

Out of git specifically because these are *messages*, not repository state:
they'd otherwise churn commits, conflict across worktrees, and force every
routine "nothing to report" into version control.

## The workstreams fit

Each monitor could **be a workstream**, so its messages are just that
workstream's, and getting back to it is reviving the workstream — the motion
`/workstreams/` already provides. That reuses the front page, the detail view,
and the resume verb rather than building a second inbox.

Open, and the reason this isn't obvious: **a monitor probably doesn't want a
worktree.** Nothing about "the SDK monitor has 3 unread messages" needs an
isolated checkout. Not terrible if it gets one, but unnecessary — so either the
workstream registry needs to admit worktree-less workstreams, or monitors get a
lighter-weight relationship to it. That's the design question worth settling
first, because it decides whether this is a small addition or a change to what a
workstream *is*.

## Open questions

- What's a message? A line, or something with a state (unread / acted on /
  dismissed)? The second is much more useful and much more machinery.
- Where does it live — `~/.cache`, a state dir, the box? It must survive a
  worktree being removed.
- Does anything escalate? A message nobody reads for a week is the failure this
  is meant to fix, so silence needs its own answer.
- Relationship to `issues/`: a message that turns out to matter should be
  promotable to an issue, the same way feedback is.

## Read (2026-08-24)

Surveyed the four reporting paths, the workstream registry, and the exhibits
and comments stores. Three decisions, each with a recommendation.

### 1. A monitor is a workstream, and it does not need a worktree

The registry already holds workstream records with no worktree: 47 removed
workstreams render today as `path:null, runtime:{state:"absent"}` rows
(`bin/workstreams:668-712`), and `resume` recreates a checkout from that
record on demand (`bin/workstreams:447-459`). Exhibits and comments key by
name alone (`bin/lib/exhibits-store.sh`, `bin/lib/comments-store.sh`);
`bin/exhibits add --workstream <name>` writes without a checkout. Issue
`workstream:` tags key by name.

So "worktree-less workstream" is not a change to what a workstream is. It is
one new way to be born: a registry record written without `create`, plus a
flag that says the absence is by design (`standing: true`, or a `kind`).
`workstream_routing_json` (`bin/lib/workstream-routing.sh:26-70`) gets one
more branch — a standing record with no worktree is `dormant /
resume-with-briefing`, not `uncertain / investigate`. `resume` already does
the right thing: materialize a worktree and launch with the briefing. That
is the "go into the workstream and chat" motion, and it only ever hits the
dormant path — the good case.

What breaks: nothing that matters. `remove`/`close` refuse when there is no
directory (correct: nothing to remove). `focus` has no tty (correct). The
workstreams app already renders null `path`/`url`.

Not recommended: a "lighter relationship" (a monitor that is only an
exhibits namespace). It would need its own list, its own resume, its own
staleness — a second registry.

### 2. A message is an exhibit; there is no new store

The message queue the issue asks for already exists as the exhibits store:
durable, out of git, cull-proof, name-keyed, with a state model (ask →
disposition), a "what is waiting on me" page (`/main/workstreams/asks`), and
a CLI a headless process can call. Its ask vocabulary is the answer to "how
does a headless task show attention is needed":

| Monitor situation | Ask | Prose says |
|---|---|---|
| ran, found something, will act on resume | `confirm` | "Resume `knip-exports` to remove these; veto if not." |
| ran, found something, direction unclear | `decide` | the options |
| ran, something changed, no action needed | `fyi` | what changed |
| ran, nothing new | **no exhibit** | heartbeat only (below) |

"Nothing new" must not create an exhibit — that is the `fyi` dumping-ground
failure the exhibits doc warns about, and it is the maintenance doc's rule
("status notes are durable; reports are ephemeral"). The exhibit's `doc.md`
is the message body and doubles as the resume briefing, so answering the ask
leads somewhere: `bin/workstreams resume <name> @<exhibit>/doc.md`.

Comments are the wrong store: they are anchored to a document and flow
developer → agent. Promotion to an `issues/` item is the existing
constrained-triager pattern (`bin/manual-tests-scheduled.sh`), or simply the
resumed session filing it — no new mechanism.

### 3. Silence is a heartbeat problem, not a message problem

Every measured failure (deploy killed mid-run, `demo-daily-rumination` dead
six weeks) was a job that produced *nothing*. A message store cannot fix
that; the deploy fix was an out-of-band truth marker (`.last-deployed-sha` +
`bin/doctor.ts`), and that is the pattern. A standing workstream declares a
`cadence` and the runner stamps `lastRanAt` in the registry record on every
run, including no-op runs. `list`, the workstreams front page, and the asks
page derive `overdue` when `now - lastRanAt > cadence`. Nobody has to
remember to check: the row goes red on its own.

Unanswered asks escalate the same way: the asks page already has `created`
and `answered`; an unanswered `confirm`/`decide` older than N days is shown
as aged. `fyi` never escalates. The ephemeral macOS notification survives as
a pointer only ("knip-exports: 1 confirm waiting"), fired by the runner, not
as a channel.

### The weekly knip case, end to end

1. `bin/workstreams create --standing knip-exports --cadence 7d` (once). No
   worktree; registry record; exhibits dir.
2. A launchd job (the runner generalization is a sibling issue,
   run-periodic-sweeps-weekly on the `knip-exports` branch) runs weekly in the
   main checkout: `pnpm lint:knip`, compares against the previous run's
   output kept in the workstream's exhibits store (that is the ledger), stamps
   `lastRanAt`.
3. Nothing new → done. New unused exports → `bin/exhibits add --workstream
   knip-exports --ask confirm --prose "12 new unused exports since 08-17;
   resume to remove them" doc.md` where `doc.md` lists them, plus one
   notification.
4. The developer sees it on `/main/workstreams/asks` (or the notification),
   confirms, and resumes: `bin/workstreams resume knip-exports @…/doc.md` —
   a worktree appears, the agent has the list, they chat. `/finish` lands it
   and culls the worktree; the workstream stays standing.
5. If the job never runs, the row shows `overdue` after 7 days.

Prerequisite for knip specifically: the report has 33 lines of pre-existing
noise (unlisted binaries, unused deps); a weekly signal is worthless until
that is zero.

### Open for the boxholder

- Is `standing` the right word for a workstream that outlives its worktrees
  by design? (`monitor` names the job, not the workstream kind.)
- Should confirming an ask *trigger* the resume from the asks page, or stay
  a two-step (answer, then resume from a session)?
- Cadence declared in the registry (this read) vs in `docs/maintenance.md`
  (the catalog that exists) — one place, which?

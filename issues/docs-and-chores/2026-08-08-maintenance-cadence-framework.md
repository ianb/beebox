---
title: "A consistent cadence framework for periodic maintenance/update tasks — where they run, how they report, how they raise issues"
workstream: unknown
area: callback-box
needs: [design]
filed-by: agent
discovered-in: main session — boxholder wants recurring updates on a cadence
---

The boxholder wants a **coherent way to run recurring maintenance/update tasks on
a cadence** — Agent SDK updates, the security-overview.md regeneration, manual testing,
revisiting knowledge audits — answering three questions consistently: **where they
run, how they report, and how they raise issues.** Today this is a partial, ad hoc
mix: some tasks have a full automated cadence, others rely on someone remembering.

## What already exists (this is not greenfield — generalize it)

`callback-box/docs/maintenance.md` catalogs the periodic tasks, and there are
**two working scheduled agent-runner patterns** that already answer all three
questions for the tasks they cover:

- **Agent SDK release monitor** (`bin/update-agent-sdk-scheduled.sh`) — a daily
  **launchd** job resumes a persistent **Opus** session that reads each new SDK
  release, writes a filtered ledger (`docs/agent-sdk-notes.md`), auto-bumps after
  a settling window (or immediately for security/memory/correctness fixes), and
  notifies the boxholder. (Docling currency rides the same job.)
- **Manual test suite** (`bin/manual-tests-scheduled.sh`) — a weekly launchd job;
  a **constrained Sonnet** agent reviews the results, **creates or appends to the
  best-matching open `issues/` item** (edits stay uncommitted for human review,
  snapshot-guarded, cannot touch code or private issues), and raises a macOS
  notification. This is the proven "scheduled agent → raises issues → human
  confirms" model.
- **CSP violation review** (`callback-box/docs/scheduled/csp-violation-review.md`)
  — a scheduled runbook: agent analyzes new violations, reports, and *proposes*
  the harden flip but never flips it — a human confirms.

So the three questions already have *answers* for a subset: **where** = machine-local
launchd resuming a constrained agent session; **report** = a ledger doc / log +
macOS notification; **raise issues** = the constrained agent appends/creates
`issues/` items, uncommitted, human-confirmed.

## The gap

Several **judgment-heavy periodic tasks have no scheduled runner** and rely on
human memory, with inconsistent (or no) reporting:

- **security-overview.md regeneration** — designed with git-rev-anchored, diff-driven
  updates ([agent-maintained-security-report](../closed/features/2026-07-20-agent-maintained-security-report.md)),
  but no cadence home decides *when* it re-runs or where.
- **Knowledge-audit revisit** — `pnpm knowledge-audit` exists and the doc says
  "monthly is probably enough," but **nothing runs it on a cadence** — it waits
  for someone to remember (`callback-box/docs/knowledge-audits.md`).
- **Doc / prompt refresh** — the standing tension in
  [doc-refresh-cadence](2026-07-04-doc-refresh-cadence.md) (docs-claim vs. code
  adjudication) and the prompt-report/prompt-viewer drift catchers.
- **Feedback collection** — [feedback-collection-cadence](2026-07-14-feedback-collection-cadence.md)
  ("items rot before review").
- **Codex — nothing at all** (added 2026-08-15). Grep the repo: Codex appears
  in neither `docs/maintenance.md` nor this issue, and no version of it is
  pinned anywhere. The Anthropic side has a daily monitor, a filtered ledger
  (`docs/agent-sdk-notes.md`), and auto-bump after a settling window; the OpenAI
  side has none of those. The boxholder's ask is explicit: **whatever we do for
  Claude Code and the Agent SDK — update, notes, cadence — we need the same for
  Codex.**

  The asymmetry has stopped being cosmetic. Codex is now the default agent for
  worker sessions and is being trialled as a box engine, so an unwatched Codex
  is unwatched infrastructure. The concrete cost showed up the same day this
  was written: a Codex update landed mid-session, took down a live worktree
  agent with no warning, and — because the branch was merged and clean — the
  exit hook then garbage-collected the whole worktree. A release monitor would
  not have prevented the update, but it would have made it a known event rather
  than a mystery.

  Two things make Codex *harder* than the SDK case, and the design should say
  so rather than assuming symmetry: it is a CLI installed outside this repo's
  lockfile (so "pin and bump" has no obvious lever the way a package dependency
  does), and its release notes are not in the same place or format the SDK
  monitor already parses. Worth checking whether the existing monitor generalizes
  or whether this is a second job that merely reports the same way.

And reporting/issue-raising is a grab-bag across the tasks that *do* run: a ledger
doc, a log + notification, in-place status comments, or plain console.

## The design questions (grounded in what exists)

1. **Where they run.** The working pattern is **machine-local launchd** resuming a
   constrained agent — but that ties maintenance to one laptop being awake, and
   it's the wrong home for tasks that should track prod. Decide per task among:
   launchd (per-dev-machine, current), the box scheduler (`cb tick` / a scheduled
   routine), CI/GitHub Actions, or a prod-side job. Judgment tasks need an agent
   with the codebase + git (security-overview.md regen, knowledge audits), which points at
   the dev-machine/CI lane, not a box.
2. **How they report.** Standardize the sink instead of the current grab-bag:
   a durable ledger/status note for the record, plus a notification for anything
   that needs attention (the maintenance doc's own rule — "status notes are
   durable; reports are ephemeral" — is the seed).
3. **How they raise issues.** Generalize the **manual-test triager** as the
   blessed mechanism: a constrained agent that appends/creates `issues/` items,
   snapshot-guarded, uncommitted for human review, unable to touch code or private
   issues. That contract is already built and safe — reuse it rather than inventing
   per-task issue-raising.

## Shape of the deliverable

Design a reusable **scheduled-maintenance-agent harness** that generalizes the two
working launchd-agent patterns (persistent-session monitor + constrained triager),
so a new periodic task is *enrolled* (task, cadence, runner home, report sink)
rather than hand-built. Then enroll the memory-dependent tasks (security-overview.md regen,
knowledge-audit revisit, doc/prompt refresh, feedback collection) with a cadence,
and standardize report + issue-raising across all of them.

## Related

- [agent-maintained-security-report](../closed/features/2026-07-20-agent-maintained-security-report.md)
  — the security-overview.md regen that needs a cadence home; its git-rev-anchored update
  model is one concrete task this framework would schedule.
- [doc-refresh-cadence](2026-07-04-doc-refresh-cadence.md),
  [feedback-collection-cadence](2026-07-14-feedback-collection-cadence.md) — two
  existing "X has no cadence" instances this umbrella would subsume.
- [release-discipline-and-update-story](../decisions/2026-07-20-release-discipline-and-update-story.md)
  — the release/update-story decision this dovetails with.
- [meta-issues](2026-07-21-meta-issues.md) — this coordinates several tasks/issues,
  so it may itself be a meta/tracking issue.
- `callback-box/docs/maintenance.md` (the task catalog),
  `callback-box/docs/knowledge-audits.md`,
  `callback-box/docs/scheduled/csp-violation-review.md` (the runbook precedent).

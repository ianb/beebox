---
title: "Should plans carry execution state (checkboxes), or stay design documents?"
workstream: elixir-skills-review
needs: [decision]
area: beebox
filed-by: agent
discovered-in: worktree-elixir-skills-review — reviewing claude-elixir-phoenix
next-action: invalid
---

All 25 documents in `beebox/docs/plans/` contain **zero checkboxes**. Our
plans are design artifacts: `bbx-plan` produces a statement of purpose, a scope
boundary, and a "Stated preferences this plan trades against" section. Execution
state lives in the conversation and dies with it — after a compaction, a crash,
or a day away, "where were we" is reconstructed by reading the diff and asking.

The reviewed project makes the opposite bet, and it's the most load-bearing idea
in their design ([research/claude-elixir-phoenix](../../research/claude-elixir-phoenix/workflow-and-orchestration.md)):

> **Plan checkboxes ARE the state.** No separate JSON state files.

Tasks are `- [ ] [P1-T3] Description`; on completion the box is ticked *and an
inline implementation note is appended in the same edit*. Resume is: find the
first unchecked box, go. Their compaction and crash-recovery hooks all work by
reading that one file — a `StopFailure` hook writes a breadcrumb, a
`SessionStart` hook counts unchecked boxes and offers to resume, a `PreCompact`
hook re-injects the active phase's rules.

## Why this is a genuine fork, not an obvious win

**For:** state that can't drift from reality, because it *is* the record of what
happened. Survives compaction with no special machinery. Makes a
[requirements-delivered gate](../closed/features/2026-07-30-requirements-delivered-gate.md)
far more reliable — checking a diff against a checklist is tractable, checking it
against prose is where fabrication risk lives.

**Against:** it changes what a plan *is*. A task ledger and a design document
want different things from the same file — the ledger wants granular, ordered,
tickable items; the design doc wants prose about trade-offs that stays readable a
year later. `finish` already moves implemented plans to `docs/implemented-plans/`
and folds durable parts into present-tense reference docs; a plan that has
decayed into a checklist has less worth folding. Their own thinnest artifact
(`progress.md`, a chronological log) is one they admit almost nothing reads.

There's also a scale mismatch. Their model assumes one active plan driving one
agent's execution loop. We run several worktrees at once, plans often outrun any
single branch on purpose, and `issues/` already carries the "what's outstanding"
role for anything that isn't in flight right now.

## The call

Roughly three options:

1. **Leave plans as design docs.** Accept that resume is manual. Cheapest.
2. **Add an optional execution section** — a plan may carry a task list when
   someone wants one, without every plan becoming a ledger. Keeps the design-doc
   character; risks the section going stale precisely because it's optional.
3. **Adopt it properly** — `bbx-plan` emits tasks, whatever executes them ticks
   boxes with inline notes, and resume/compaction hooks read the tree.

Option 3 only pays off with the hooks around it, so it's a bigger commitment than
it looks. Not an agent's call — filed for Ian.

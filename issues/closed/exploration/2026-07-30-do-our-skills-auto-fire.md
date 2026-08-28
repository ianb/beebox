---
title: "Do our skills ever auto-fire, or only when someone types the slash command?"
workstream: elixir-skills-review
area: docs
filed-by: agent
discovered-in: worktree-elixir-skills-review — reviewing claude-elixir-phoenix
resolution: superseded
---

> Superseded 2026-08-27: consolidated into
> [run-skill-trigger-evals](../../docs-and-chores/2026-07-30-run-skill-trigger-evals.md),
> which now owns the eval run, the description rewrite, and the auto-fire question.

We write skill descriptions as if the model reads them and decides to load the
skill on its own. We have never checked whether that happens.

The reviewed project instrumented exactly this and reports "zero skill
auto-loading" as a repeated finding across 137+ sessions, plus a CHANGELOG claim
that CLAUDE.md prose routing measured "~0% firing across 400 sessions" — which is
why they moved intent detection into a `UserPromptSubmit` hook. **Their
measurement system is real and present in their tree; the measurement result is
not** (no metrics file, no report artifact ships). See
[research/claude-elixir-phoenix](../../../research/claude-elixir-phoenix/measurement.md).
Credible hypothesis, unverified number. Worth testing on our own corpus rather
than believing or dismissing.

If it's true here, a large amount of what we've written into `.claude/skills/`
and CLAUDE.md only ever reaches an agent when a human explicitly summons it, and
the "Triggers include …" clauses are decorative.

## The metric that matters

Theirs: `proactive_trigger_rate == 0` while `invocation_count >= 5` for a skill
that is model-invocable — i.e. **a skill that only ever fires when a human types
its name**. Their scorer refuses to guess when the trigger source is unknown,
explicitly because bucketing unknowns as user-slash would hide the very gap being
measured. Worth preserving that discipline.

Adjacent metrics from the same scorer that would be cheap once we're reading
transcripts at all: retry loops (same command prefix 3+ times consecutively),
user-correction density (regex for "no,", "wrong", "instead", "actually",
"that's not"), and inferred compaction events (prompt token drop >40%).

## The catch, before anyone trusts a number

Per `project_claude_code_jsonl_drop_bug`: blocks in the live stream sometimes
never reach Claude Code's `.jsonl` at all. We read those files for chat display
and have already been bitten. A naive activation count therefore **under-reports
by an unknown amount**, and "we found no auto-fires" would be indistinguishable
from "the auto-fires were dropped."

So the first task isn't the metric, it's validating the method: take a session
where we know from the live transcript that a skill auto-loaded, and confirm the
`.jsonl` shows it. Without that, don't publish a number.

## Research (incomplete)

- Does the `.jsonl` distinguish a skill loaded by the model from one invoked by
  slash command, or is that only in OTel `skill_activated` events with an
  `invocation_trigger` field (which theirs depends on)?
- Do we emit OTel at all?
- Ground-truth validation above.

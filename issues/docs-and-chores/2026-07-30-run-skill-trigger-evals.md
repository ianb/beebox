---
title: "Run trigger evals on our skills — we vendored the tool and never used it"
workstream: elixir-skills-review
area: docs
filed-by: agent
discovered-in: worktree-elixir-skills-review — reviewing claude-elixir-phoenix
---

We have 16 skills in `.claude/skills/` and **zero evidence any of them fire when
intended**. Nothing measures it.

We also already own the tooling. `.claude/skills/skill-creator/` (vendored from
Anthropic) ships `scripts/run_eval.py`, `scripts/improve_description.py`,
`scripts/aggregate_benchmark.py`, a grader subagent, an analyst pass that flags
non-discriminating and high-variance assertions, and a trigger-eval query
generator. None of it has been run here.

So this is a **routine to adopt, not code to write**.

## What "trigger eval" means concretely

From [research/claude-elixir-phoenix](../../research/claude-elixir-phoenix/measurement.md):
for each skill, hand-author a fixture of `should_trigger` and `should_not_trigger`
prompts. Hand a judge model *every* skill's name and description plus one test
prompt, ask which it would route to. A hit is the skill appearing for a
should-trigger prompt and being absent for a should-not-trigger one — so it
measures precision as well as recall, catching a skill that steals prompts
belonging to a sibling. Their pass bar is 0.75 accuracy / 0.80 precision / 0.60
recall; their cost was ~$1.50 and ~60 minutes for 51 skills on Haiku.

Two of their harness details worth copying regardless of which tool we use:

- **Hard-fail if the fixture set doesn't exactly match the skill set** — no
  missing fixtures, no orphans. Cheap way to stop the corpus and its tests
  silently diverging.
- **Separate result caches per judge model**, so a Haiku baseline and a Sonnet
  baseline never get conflated.

## Why it matters here

Our skills overlap by design in ways an eval would stress: `cb-debug` vs
`cb-codehealth` vs `/code-review`; `cb-plan` vs `launch-worktree-session`;
`cb-guide-testing` vs `cb-debug`; the three `cb-guide-*` against each other. Some
of those boundaries are stated in the descriptions and have never been checked.

Pairs with [skill-description-triggering-conditions](2026-07-30-skill-description-triggering-conditions.md)
— that item asserts a fix; this one is how we'd know whether it was needed and
whether it worked.

## Research (incomplete)

Open questions before doing this: does the vendored `skill-creator` eval path
still run against current Claude Code, what does a run cost for 16 skills, and
is a one-off baseline enough or does it want to be a periodic check?

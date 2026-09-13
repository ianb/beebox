---
title: "Run trigger evals on our skills — we vendored the tool and never used it"
workstream: elixir-skills-review
area: docs
filed-by: agent
discovered-in: worktree-elixir-skills-review — reviewing claude-elixir-phoenix
priority: backlog
---

## Current state (2026-09-12)

The checkout has 24 repository skills. Prompt-calibration shortened the original
23 descriptions and revised the shared guidance; the later browser-task skill
also received a focused workflow correction. These edits and static reviews do
not establish native skill activation rates.

The historically vendored `.agents/skills/skill-creator/scripts/run_eval.py`
path is absent from this checkout. The installed skill-creator is outside the
repository; do not assume the old eval tools are available. The [four-model decision pilot](../../beebox/docs/prompt-calibration-pilot.md)
is complete: 12 routing cases and five authority cases per model, plus a targeted
briefing-template recheck. It found and corrected example contamination; it did
not exercise native skill loading. Native loading, repeats, and full-catalog
coverage remain open. No evaluation subsystem was added.

The sections below preserve the earlier proposal and research context; their
skill counts, tool paths, and quota dates are historical.

## Consolidated (2026-08-27)

This item now owns the whole causal chain; two siblings from the same review
closed as superseded into it:

- *Do our skills ever auto-fire, or only via the slash command?*
  (`closed/exploration/2026-07-30-do-our-skills-auto-fire.md`) — the research
  question. The eval run below is its answer.
- *Skill descriptions should be triggering conditions, not workflow summaries*
  (`closed/docs-and-chores/2026-07-30-skill-description-triggering-conditions.md`)
  — the fix the eval validates. The `bbx-guide-*` descriptions are the named
  offenders (verified still true 2026-08-27: `bbx-guide-api`'s description
  summarizes the decision and points at the doc — the model answers from the
  listing and never opens the skill). A judgment call rides along: whether the
  `bbx-guide-*` trio should be skills at all or fold into their target docs.

**Deferred until Claude quota resets (Fri 2026-08-29 PM):** the eval drives
`claude -p` per query, and the fix must be validated on BOTH engines — a
codex-only window can't test it. Path fixed above: the harness lives at
`.agents/skills/skill-creator/scripts/` (the old `.claude/skills/skill-creator/`
reference was stale).

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

Our skills overlap by design in ways an eval would stress: `bbx-debug` vs
`bbx-codehealth` vs `/code-review`; `bbx-plan` vs `launch-worktree-session`;
`bbx-guide-testing` vs `bbx-debug`; the three `bbx-guide-*` against each other. Some
of those boundaries are stated in the descriptions and have never been checked.

Pairs with [skill-description-triggering-conditions](../closed/docs-and-chores/2026-07-30-skill-description-triggering-conditions.md)
— that item asserts a fix; this one is how we'd know whether it was needed and
whether it worked.

## Research (incomplete)

Open questions before doing this: does the vendored `skill-creator` eval path
still run against current Claude Code, what does a run cost for 16 skills, and
is a one-off baseline enough or does it want to be a periodic check?

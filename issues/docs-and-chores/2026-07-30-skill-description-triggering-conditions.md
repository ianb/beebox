---
title: "Skill descriptions should be triggering conditions, not workflow summaries"
area: docs
filed-by: agent
discovered-in: worktree-elixir-skills-review — reviewing claude-elixir-phoenix
---

A `description` that *summarizes what the skill does* gets acted on **instead of**
the skill body being loaded. The model has enough from the listing to answer, so
it never opens the file — and the checklists, gotchas and decision rules in the
SKILL.md never reach context. A description's job is to say *when to load this*,
not *what it says*.

Sourced from [research/claude-elixir-phoenix](../../research/claude-elixir-phoenix/authoring-craft.md),
which credits the finding to a review of the *Superpowers* project. Not verified
on our corpus — see [run-skill-trigger-evals](2026-07-30-run-skill-trigger-evals.md),
which is how we'd actually measure it.

## Where we do the anti-pattern

The three `cb-guide-*` skills, whose descriptions state what the skill explains
and then name the file holding the real content. `cb-guide-api`:

> Explains how HTTP endpoints are added in callback-box and the
> tRPC-vs-raw-Fastify decision. […] Instructional (a cb-guide-\* skill) — full
> checklist in docs/adding-api-endpoints.md.

A model reading that has been told the topic, the decision at stake, and where
the checklist lives. Opening the skill is the least attractive of its options.
`cb-guide-schemas` and `cb-guide-testing` have the same shape.

Description lengths across `.claude/skills/*/SKILL.md`, longest first:
`canvas-loop-sketch` 574, `cb-prompt-review` 536, `cb-guide-schemas` 519,
`cb-context` 490, `launch-worktree-session` 460, `cb-guide-testing` 446,
`cb-debug` 438, `cb-codehealth` 433, `cb-guide-api` 410, `cb-frontend` 394,
`cb-migration` 393, `codex` 335, `skill-creator` 333, `cb-plan` 293,
`finish` 289, `browse` 223.

## The tension

Length itself may not be our problem. The reviewed project targets ~200 chars
because ~40 skills compete for a shared skill-listing budget, where a long
description crowds out siblings and hurts routing corpus-wide. With 16 skills we
have room. So this is **not** a "shorten everything" chore — it's specifically
about descriptions that carry *content* rather than *triggers*.

Also unsettled: the `cb-guide-*` skills are deliberately thin pointers to a doc.
If the description names the doc and the skill body mostly does too, it's worth
asking whether those three should be skills at all, or whether the guide content
should move into the skill so there's something to load.

Our existing "Triggers include …" convention is the right instinct and should
probably be the *whole* description for most skills.

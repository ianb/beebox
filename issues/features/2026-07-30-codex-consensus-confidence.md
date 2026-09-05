---
title: "Treat codex/Claude agreement as a confidence signal, and remember prior triage"
workstream: elixir-skills-review
area: beebox
filed-by: agent
discovered-in: worktree-elixir-skills-review — reviewing claude-elixir-phoenix
next-action: discuss
priority: backlog
---

`.claude/skills/cross-model/` runs a cross-model review as a standalone manual pass.
Its findings are never cross-referenced against anything, and it has no memory of
what it told us last time. Two cheap improvements, both from
[research/claude-elixir-phoenix](../../research/claude-elixir-phoenix/workflow-and-orchestration.md).

## 1. Agreement as signal

When the same issue is flagged by *both* codex and a Claude-side reviewer, mark
it HIGH CONFIDENCE and never drop it as a duplicate. Agreement between two models
with different training is evidence; treating the second report as redundant
throws that away.

There's a real argument behind this beyond the heuristic. Their own research
notes concede that "writer/reviewer independence is theoretically ideal but
practically constrained" when the verifier is another instance of the same model
sharing the generator's biases. That's the case *for* our cross-model pass
existing at all — and if independence is the point, agreement across the
independence boundary is the strongest signal we get.

Their implementation detail worth copying: the codex bridge passes findings
through **verbatim**, normalising only priority and format, never editorializing
or filtering — filtering is a later, separate step. Also, they spawn the codex
track *first* in a review fan-out because it's the slowest, so its minutes
overlap the Claude-side work instead of serialising after it.

## 2. Prior-findings dedup

Before analysing, read previous review output and classify each prior finding:
Fixed → SKIP, Still-present → PERSISTENT (one line only), New → NEW (full
writeup), Reintroduced → REGRESSION. Present NEW first.

Without this, every re-run re-litigates the same dismissed issues at full length,
and the human pays the triage cost repeatedly. Their competitive analysis rates
the structural version of this — writing accepted/rejected decisions back so
future reviews respect prior triage — as one of the highest-value ideas they
found anywhere.

## Open questions

- Where prior findings live. We have no review-output directory; `codex` results
  land in the conversation. Some artifact has to persist for dedup to work, and
  that's the actual cost of this item — possibly the larger half of it.
- Whether "PERSISTENT" findings should decay. A finding we've declined three
  times is a decision, not an open issue, and should probably stop being
  reported at all rather than shrinking to one line forever.

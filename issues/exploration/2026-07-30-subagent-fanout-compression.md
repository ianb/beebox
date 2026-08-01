---
title: "Compressing subagent fan-out results, with a coverage invariant"
area: callback-box
filed-by: agent
discovered-in: worktree-elixir-skills-review — reviewing claude-elixir-phoenix
---

When we fan out subagents, each returns a full report straight into the parent's
context. This review itself ran six agents and consumed roughly 130k tokens of
subagent output in the main thread — most of which was synthesised down to a few
paragraphs.

The reviewed project puts a cheap compressor in between: a Haiku agent, low
effort, ~10 turns, no Bash, that reads N worker output *files*, picks a
compression ratio by total size, applies caller-supplied keep/compress/drop
priorities, and dedupes claims that repeat across workers. Orchestrators then
read only the consolidated summary. See
[research/claude-elixir-phoenix](../../research/claude-elixir-phoenix/workflow-and-orchestration.md).

## The part worth stealing

Not the compression — the **coverage invariant**: every input file must appear at
least once in the output, or it's flagged as a COVERAGE GAP, and the orchestrator
reads the raw file only for flagged gaps. That's what stops a summariser silently
dropping a worker's entire contribution, which is the characteristic failure of
collapsing N reports into one and is invisible from the summary alone.

Their weak points, not worth copying: "characters ÷ 4" token estimation,
arbitrary round-number thresholds, and priority tables baked into the
compressor's prompt rather than genuinely supplied per call.

## Why this may not be worth building

It requires workers to write to files rather than return text, which is a real
change to how we spawn agents and adds a directory of intermediates to manage.
For a six-agent research fan-out that happens rarely, paying the full-report cost
is probably fine — the synthesis is the valuable part and it wants the detail.

The case is stronger for anything routine and wide: a per-file sweep, a
multi-track review, a migration audit across many call sites. If we build a
recurring fan-out, build this with it; retrofitting a compressor onto ad-hoc
delegation is likely not worth it.

Related: `.claude/agents/finish.md` exists precisely to keep merge-and-test churn
out of the main thread, which is the same instinct solved by scoping rather than
compression — and is the cheaper answer when it applies.

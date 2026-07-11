---
title: "doc usage mining"
needs: [design]
area: callback-box
---

Claude Code session transcripts live as JSONL at `~/.claude/projects/<encoded-cwd>/*.jsonl`, and every `Read` tool_use carries the file path plus offset/limit. That's free data — no instrumentation needed — describing how the agent actually uses the doc corpus, which is rarely the same as how we *think* it does.

Cross-joined against the doc-graph in `src/dev/doc-graph-html.ts`, the usage data sharpens the picture:

- **High-read + always-loaded** → over-served. The doc is already in context, so re-reads mean the agent either didn't trust the context or couldn't absorb the doc at length. Candidate for trim.
- **High-read + partial-only (offset/limit always set)** → chapter-grazing. The agent only wants section X. Candidate for split — each section becomes its own file, no agent loads the irrelevant 80%.
- **High-read + outer-ring** → mis-classified by the rings. Should be promoted closer to always-loaded, or linked from a nearby `CLAUDE.md` so the agent stops having to discover it.
- **Zero-read + linked prominently** → the link is misleading or the doc is dead weight. Candidate for delete or rewrite.
- **Read-then-edited vs. read-then-ignored** → distinguishes reference docs from working surfaces — useful when deciding what to maintain vs. what to freeze.

Open questions:
- **Noise filtering.** Subagent reads, hook reads, `/clear`'d sessions, exploratory greps — all distort the picture. Weight by session not raw count; filter by tool_use_id provenance; probably ignore sessions under some token threshold.
- **Shape.** Mirror the doc-graph split: a dry `pnpm doc-usage` markdown report for the numbers, plus a fourth section in `doc-graph.html` ("What agents actually open") that overlays the rings/pillars with usage hot-spots.
- **Retention.** Transcripts are local-only and the user can clear them. Aggregate into a small persistent table so the historical signal survives clearing.

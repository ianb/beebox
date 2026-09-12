---
description: "Goose is Block's production-shaped general local agent with verified-completion recipes; Bee Box is a personal assistant built on records, not tasks."
compared:
  date: 2026-07-04
  subject: "Goose, Block (source clone studied 2026-07-04; version not recorded)"
  beebox: "2026-07-04"
  looked-for: [task/recipe model, tool approval, sub-agents, scheduling, context management]
  not-looked-for: [pricing, hosted offerings, community size, security posture]
---
# Bee Box compared with Goose

Goose, from Block (Square's parent company), is a general local agent for
coding and operations tasks: a Rust core with a CLI, a desktop app, a server,
and an editor-integration surface, extended through MCP servers. It reads as
a funded engineering team's product, with real telemetry and crash recovery.
Bee Box is a personal assistant built around a **box**: one directory, also
a git repository, holding **cards** (files with YAML frontmatter and a
markdown body), aimed at a boxholder's ongoing life, not at discrete
engineering tasks.

**Where they are similar.** Both run tool calls under some form of approval
policy, and both give an agent a way to delegate bounded work to a
subordinate process and get a result back.

**Where they differ.** Goose is organized around recipes: shareable,
parameterized task specifications with a JSON-schema response contract, that
can retry automatically until a shell check confirms the result and clean up
after a failed attempt. Bee Box has no equivalent notion of a verified,
retryable task; its unit of work is a card moving through triage, not a
recipe run. Goose's `SmartApprove` classifies each new tool as read-only or
not with one LLM call and caches the verdict, a middle ground between
approving nothing and approving everything; Bee Box currently approves
everything unconditionally. Goose runs continuous background summarization of
old tool output plus threshold-based compaction; Bee Box has no compaction of
its own, since it defers entirely to the coding agent it runs on. As of this
comparison, Goose's own scheduler had weak crash recovery (resetting stale
flags on boot, with no resume or catch-up of missed runs), which the
researchers judged did not outclass Bee Box's own wakeup design.

**What Bee Box borrowed or decided not to.** Goose's retry-until-verified
recipe model was flagged as the most valuable idea for Bee Box's own job
cards, but had not been built as of this comparison; `SmartApprove` was noted
as worth revisiting only if Bee Box narrows its unconditional tool access.

**What this comparison did not look at:** pricing, hosted offerings,
community size, or security posture.

---
area: callback-box
---

# Subagent strategy for callback-box

Currently most agent work happens in one main loop. Some tasks would benefit from parallel subagent dispatch — the question is what shape the subagents should take, and which tasks actually benefit.

**Candidate shapes:**

- *Function-shaped helpers* (like Claude Code's Explore/Plan): each subagent does a specific operation type. "Search across cards," "fetch+summarize email thread," "draft response in style X." Composable; the main agent orchestrates. Lower per-call leverage but consistent.
- *Domain-shaped helpers*: each subagent specializes in a domain (calendar, email, a specific project). The main agent dispatches a question and gets a domain-aware answer. Higher per-call leverage but raises the procedure-vs-agent boundary question — if the domain helper makes judgment calls the main agent should be making, you get inconsistent reasoning.

Probably function-shaped is the better default, with domain-shaped reserved for genuinely procedural domains (like a calendar helper that handles event creation mechanics).

**Where parallelism actually buys something:**

- Multi-source synthesis ("what's going on with Alice this month" → calendar + email + card-history searches in parallel, main agent stitches).
- Triage processing — multiple incoming items handled in parallel rather than serially.
- Multi-perspective drafting, *only if* the perspectives are grounded in different sources or different roles. Same-model-different-prompts perspectives is the iterate-loop theater problem in a different shape (see *Iterative refinement: only with grounded critique* in [prompt-audits.md](../callback-box/docs/prompt-audits.md#iterative-refinement-only-with-grounded-critique) in prompt-audits.md).

**Where parallelism doesn't help:**

- Tasks where steps depend on each other.
- Tasks where the main agent's accumulated context is what makes the work good — subagents lose that context.
- Tasks small enough that subagent spawning overhead exceeds the wall-clock savings.

Connected concern: subagents in callback-box don't inherit CLAUDE.md or rules (per [Claude Code Memory Concerns](2026-03-04-claude-code-memory-concerns.md) entry), so any subagent strategy has to pass relevant context explicitly. This makes domain-shaped subagents harder to build well than the surface tip suggests.

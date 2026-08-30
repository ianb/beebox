---
title: "oh-my-pi as a BYO-model third box engine — watch, don't build"
workstream: research-ohmypi
area: beebox
labels: [engine, vendor-risk, research]
filed-by: agent
discovered-by: Ian
discovered-in: research-ohmypi worktree — backend-alternatives follow-up
---

Reviewed 2026-08-25:
[research/backend-alternatives/2026-08-25-oh-my-pi.md](../../research/backend-alternatives/2026-08-25-oh-my-pi.md).

oh-my-pi (v18.0.5) scores higher than any harness in the July survey on the
runtime contract — real TS SDK / NDJSON RPC with steer + abort, inline image push,
fail-closed in-process tool hooks that can feed findings back into the same turn,
cost in the transcript index, structured output implemented as a tool (so it
survives tool use). Its Claude-subscription login spoofs Claude Code's OAuth client
and request fingerprint, which rules it out on the user's Claude plan. As a
third engine it would only ever be BYO non-Anthropic model (OpenRouter, Gemini,
local), at the cost of the Codex adapter again plus a Bun runtime on every deploy
target.

**Re-check triggers** (any one):
- A user asks for a provider neither the Claude nor Codex engine reaches.
- The Shape A spike
  ([provider-endpoint-config](../features/2026-07-18-provider-endpoint-config.md))
  shows the Agent SDK loop does not survive a non-Anthropic endpoint.
- omp ships a Node runtime or single binary and slows to a weekly-ish cadence.

Independent of the engine question: the review notes that same-turn validator
feedback (findings reaching the model inside the turn) was lost when Claude
validation moved to plugin PostToolUse hooks; that belongs in
[chat-backend-port-hygiene](../code-quality/2026-07-18-chat-backend-port-hygiene.md)
as an engine-contract requirement.

---
title: "Plain pi as a third box engine on OpenRouter models"
workstream: pi-engine
area: beebox
labels: [engine, vendor-risk, research]
filed-by: agent
discovered-by: Ian
discovered-in: worktree-research-pi — is plain pi enough without oh-my-pi
priority: backlog
resolution: implemented
---

> Closed 2026-10-29 as `implemented` on branch `worktree-pi-engine` (plan [pi-box-engine](../../../beebox/docs/implemented-plans/pi-box-engine.md), reference [pi-engine](../../../beebox/docs/pi-engine.md)). Divergence: pi runs only owner-added OpenRouter models, not API keys of other vendors; credentials sit in an in-memory store. Not covered: a scheduled procedure on pi, and `deepseek/deepseek-chat-v3.1` does not work.

Reviewed 2026-10-18:
[research/backend-alternatives/2026-10-18-pi.md](../../../research/backend-alternatives/2026-10-18-pi.md).

Plain pi (earendil-works/pi 1.3.0) meets the boxholder's bar on its own: it
reads walk-up `AGENTS.md` (with `CLAUDE.md` fallback) and `.agents/skills`,
takes an appended system prompt, and has a Node SDK with typed events,
steer and follow-up during a run, abort that kills tool processes, image
input, caller-chosen session ids, and USD cost per message. It replaces
oh-my-pi as the third-engine candidate. Its Claude-subscription login
impersonates Claude Code, so it would run on API keys only.

Missing, and therefore beebox code if adopted: a structured final answer
for `invokeStructured` callers (a custom result tool). Nested `AGENTS.md`
needs one appended instruction. Include expansion and rule skills reuse the
Codex engine's generated surfaces.

**Re-check triggers** (any one):
- A user asks for a provider neither the Claude nor Codex engine reaches.
- The Shape A spike
  ([provider-endpoint-config](../../features/2026-07-18-provider-endpoint-config.md))
  shows the Agent SDK loop does not survive a non-Anthropic endpoint.
- pi adds a top-level output schema (removes the one missing item).
- pi publishes an API-stability policy, or its SDK session surface breaks
  in a release (either changes the maintenance estimate).

---
title: "Provider-endpoint config: choose your model provider at install time (Shape A)"
needs: [design]
area: callback-box
filed-by: agent
discovered-in: worktree-backend-research — deep-pass backend-alternatives research
---

The ADOPT recommendation from the backend deep pass
([synthesis](../../research/backend-alternatives/2026-07-18-synthesis.md)): a
per-box or install-time provider setting — base URL, auth token, model-id map —
threaded through the two SDK entry points (`src/core/agent/run.ts` builds env at
`setupRunEnv`; `src/services/claude-chat.ts` takes `env` in
`ChatBackendStartOptions`), defaulting to today's Anthropic subscription auth.
The boxholder's model is explicitly "choose your provider up front, then it runs
on that" — no routing, no fallback logic.

What it unlocks with near-zero marginal integration: Anthropic API billing (hedge
against the paused-but-expected Agent SDK credit-pool split), OpenRouter
(vision-capable non-China models; billing diversity; can even route to Claude),
Kimi/GLM pay-per-token APIs (for users accepting their data posture — surface
the warnings), self-hosted vLLM via its native `/v1/messages` endpoint later.

Design questions:
- Where the config lives (box config vs install-level) and how auth tokens are
  stored; interaction with `buildScriptEnv`'s deliberate `ANTHROPIC_API_KEY`
  stripping (`src/core/script-env.ts`) which currently forces subscription auth.
- Model-id mapping (`src/core/model-ids.ts`) per provider; what "haiku-tier" maps
  to on each.
- Auth preflight (`src/core/agent/auth-preflight.ts` shells to `claude auth
  status`) must become provider-aware — an API-key provider has no `claude login`.
- Usage/cost attribution (`src/core/usage.ts` consumes `total_cost_usd`) — other
  providers may not report cost; degrade visibly.
- Onboarding UI: today's login flow is Claude-OAuth-shaped
  (`src/services/claude-cli.ts`).

**Blocked on the empirical spike** in
[model-backend-pluggability](../exploration/2026-07-18-model-backend-pluggability.md):
verify the SDK's full loop (tools, images, streaming, caching) against one real
non-Anthropic endpoint before designing the config surface.

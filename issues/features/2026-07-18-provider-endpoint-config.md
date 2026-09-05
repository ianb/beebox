---
title: "Provider-endpoint config: choose your model provider at install time (Shape A)"
workstream: backend-research
needs: [design]
area: beebox
filed-by: agent
discovered-in: worktree-backend-research — deep-pass backend-alternatives research
priority: backlog
---

> **Checked 2026-08-14 — still valid.** Tagged `invalid`; the premise holds, so
> the tag is removed and the issue stays open. Both technical claims are
> unchanged in code: `src/core/script-env.ts:103-106` still deletes
> `env.ANTHROPIC_API_KEY` to force subscription auth, and `src/core/agent/run.ts:196`
> still documents that. The spike it depends on,
> [model backend pluggability](../exploration/2026-07-18-model-backend-pluggability.md),
> still carries an unfilled `## Research (incomplete)`.
>
> Checked specifically whether the Codex-engine work superseded it. It does not:
> Codex is Shape B — a different *harness* — while this is Shape A, a different
> *model provider* under Claude Code via `ANTHROPIC_BASE_URL`. The Codex
> decision doc draws that line itself. This issue's own motivations (billing
> diversity, vision-capable non-China models, self-hosted vLLM) are independent
> of the vendor-independence goal Codex addressed, and remain unaddressed.

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
- Model-id mapping (`src/shared/model-ids.ts`) per provider; what "haiku-tier"
  maps to on each.
- A workload cost model (from `src/core/usage.ts` data: monthly tokens, image
  volume, cache-hit rate, tool-call counts × per-provider rates) — the research
  established viability/legality per provider; pricing comparison remains open.
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

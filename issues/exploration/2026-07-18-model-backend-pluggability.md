---
title: "Model-backend pluggability: can the Agent SDK run on an Anthropic-compatible endpoint?"
needs: [design]
filed-by: agent
discovered-in: main session — backend-alternatives research (research/backend-alternatives/README.md)
area: callback-box
---

Research on alternate agent backends
([research/backend-alternatives/README.md](../../research/backend-alternatives/README.md))
landed on one concrete, low-effort lever worth verifying, plus a clear "don't" list.

**The lever:** callback-box runs on `@anthropic-ai/claude-agent-sdk`, which is
Anthropic-model-only by design — *except* it speaks the Messages API, so pointing
`ANTHROPIC_BASE_URL` + auth token at an **Anthropic-compatible endpoint** (GLM's
`api.z.ai/api/anthropic`, Kimi-coding) could swap the model with near-zero code. We
already set `ANTHROPIC_BASE_URL` in the run path (`src/core/agent/run.ts:192`, for the
prompt-logger), so the wiring exists.

**The one thing that decides whether this is trivial or not:** does the SDK's *full
agentic loop* survive a non-Anthropic compatible endpoint — tool-use formatting,
streaming, extended thinking, and prompt caching — or only raw single-turn messages?
Cross-vendor proxies (claude-code-router, LiteLLM) are documented as **lossy exactly on
thinking-blocks and `cache_control`**, and those losses compound over long agentic
sessions (our exact shape). A true Anthropic-*compatible* endpoint should fare better
than a translating proxy, but it's *compatible*, not Anthropic's own — must be tested.

## Research (incomplete)

Spike to run: point the SDK at GLM's `/api/anthropic` with `ANTHROPIC_DEFAULT_*_MODEL`
remaps, run a real multi-turn reactor cycle, and check: (a) tools fire and results parse,
(b) streaming works, (c) thinking blocks round-trip, (d) prompt caching isn't silently
broken, (e) `tool_use`/`tool_result` turn-shape survives compaction. Record what breaks.

## Decision context (updated 2026-07-18 by the deep pass)

The deep pass
([synthesis](../../research/backend-alternatives/2026-07-18-synthesis.md)) corrected
several bullets that originally stood here:

- **Coding plans are dead for us, and task content IS inspected** (the original
  "client-whitelist, not task rule" framing was wrong for z.ai): z.ai's policy text
  says the system detects non-coding request content, enforcement reports name
  "personal assistants" as a banned pattern, and headless use trips a separate
  "SDK-based access" flag. MiniMax's plan bars non-interactive/backend use outright.
- **Anthropic vs OpenAI subscription posture diverged** (the original "API billing
  only" bullet was half wrong): Anthropic blocks third-party clients and sanctions
  our own single-tenant SDK-on-own-login pattern; OpenAI informally tolerates
  third-party ChatGPT-subscription riding — see
  [codex-sdk-second-backend](2026-07-18-codex-sdk-second-backend.md) for why we
  still don't build on it now.
- **Vision gates the provider list hard**: MiniMax and DeepSeek are disqualified
  (text-only API surfaces); Kimi API is the best China-based fit but trains on
  content with no opt-out; OpenRouter (US aggregator, per-model choice) is the
  cleanest neutral drop-in target.
- **Self-hosting is Shape A now**: vLLM ships a native Anthropic Messages endpoint
  that Claude Code runs against — the spike below applies to it too. Model/hardware
  reality says future bet, recheck in 6–12 months.
- **Boxholder scoping (2026-07-18):** resilience target is policy/pricing changes,
  NOT intermittent quality regressions; the product model is one provider chosen up
  front — no routing/fallback logic.

Concrete follow-ons filed:
[provider-endpoint-config](../features/2026-07-18-provider-endpoint-config.md)
(the ADOPT item, blocked on the spike above),
[chat-backend-port-hygiene](../code-quality/2026-07-18-chat-backend-port-hygiene.md),
[codex-sdk-second-backend](2026-07-18-codex-sdk-second-backend.md).

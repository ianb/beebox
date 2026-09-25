---
title: "Model-backend pluggability: can the Agent SDK run on an Anthropic-compatible endpoint?"
workstream: glm-v2-layout
resolution: implemented
filed-by: agent
discovered-in: main session — backend-alternatives research (research/backend-alternatives/README.md)
area: beebox
priority: backlog
---

**Closed 2026-09-15.** The spike this issue gated ran 2026-09-15 from
`worktree-glm-v2-layout` and its findings are recorded in `## Research` below;
the GLM slice it unblocked shipped with the same workstream (commits 5fb1a4e49,
fe3142614, 5ee730681, 2d3304d79 — see `beebox/docs/plans/box-glm-provider.md`).
The verdict: the SDK's full agentic loop survives a real Anthropic-compatible
endpoint, so the question this issue asked is answered. Nothing diverged from
what the issue proposed — the open follow-ons (generic provider config, quota
error strings) already live in
[provider-endpoint-config](../../features/2026-07-18-provider-endpoint-config.md),
which stays open.

Research on alternate agent backends
([research/backend-alternatives/README.md](../../../research/backend-alternatives/README.md))
landed on one concrete, low-effort lever worth verifying, plus a clear "don't" list.

**The lever:** beebox runs on `@anthropic-ai/claude-agent-sdk`, which is
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

## Research (complete 2026-09-15 — spike findings)

Spike run from `worktree-glm-v2-layout` (`scratch/glm-spike.ts`, worktree-local)
against `api.z.ai/api/anthropic` with the SDK options beebox actually sends
(`permissionMode: bypassPermissions`, local harness plugin, preset system
prompt, `outputFormat: json_schema`, `maxTurns`). Credential: the ambient
`ANTHROPIC_AUTH_TOKEN` (the `.env` `GLM_API_KEY` is a different string and 401s
— see the note below).

- (a) Tools fire and results parse: multi-turn Bash tool loop succeeded.
- (b) Streaming: message events arrive progressively (first `system` at ~1s).
- (c) Thinking blocks: present in assistant messages.
- (d) Prompt caching: WORKS — second call with the same prefix reports
  `cache_read_input_tokens: 22336`. The translating-proxy losses do not apply.
- (e) `tool_use`/`tool_result` across compaction: not directly forced; resume
  across a fresh session with context survived (token recall test passed).
  Long-session compaction evidence remains interactive-dev-use only.
- (f) Wire model ids: `glm-5.3` and `glm-5.3-flash` both accepted
  (`glm-4.5-flash` also works; `glm-5-flash` and `glm-5.3-air` rejected).
- (g) Quota/rate-limit error strings: NOT captured — exhaustion was not
  triggered. Still open for the unavailability classifier.
- (h) `total_cost_usd`: reported non-zero (0.158 for ~28k input / 46 output) —
  the CLI prices the run, but the number matches first-party-tier pricing, not
  Z.ai's published rates. Treat as directional only; do not budget against it.

**Credential note:** the working key rides the ambient environment (exported by
whatever launched the GLM sessions), while `beebox/.env`'s `GLM_API_KEY` — the
file `bin/lib/glm-provider.sh` and the dev quota reader use — is a different
string that the endpoint rejects with 401. Either the .env key is stale or the
ambient one comes from elsewhere. Boxholder should reconcile; until then,
dev-side GLM launches that read `.env` are running on a dead credential.

Verdict: the full headless loop survives a real non-Anthropic endpoint. The
ADOPT recommendation in
[provider-endpoint-config](../../features/2026-07-18-provider-endpoint-config.md)
is unblocked; the GLM slice ships via
`beebox/docs/plans/box-glm-provider.md`.

## Decision context (updated 2026-07-18 by the deep pass)

The deep pass
([synthesis](../../../research/backend-alternatives/2026-07-18-synthesis.md)) corrected
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
[provider-endpoint-config](../../features/2026-07-18-provider-endpoint-config.md)
(the ADOPT item, blocked on the spike above),
[chat-backend-port-hygiene](../../code-quality/2026-07-18-chat-backend-port-hygiene.md),
[codex-sdk-second-backend](2026-07-18-codex-sdk-second-backend.md).

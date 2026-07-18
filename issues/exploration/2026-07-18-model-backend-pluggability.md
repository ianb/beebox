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

## Decision context (from the research)

- **Don't** build the backend on the cheap coding *plans* (GLM $18 / Kimi) — they're
  fenced to a **whitelist of client apps**; a custom app pays general per-token API rates
  regardless of task. (Task type is *not* the restriction — verified against z.ai's usage
  policy; the "coding-only" framing was wrong.)
- **Don't** design around riding an end-user's Claude Max (or ChatGPT) subscription from
  our app — Anthropic severed third-party-client subscription auth (Jan 2026); API billing
  only.
- **Data gate for a private-data assistant:** Anthropic/OpenAI don't train on API data by
  default (clean); Kimi trains-by-default + bars commercial use; GLM's training opt-out is
  undocumented and it carries China-jurisdiction exposure. Self-hosting open weights
  (GLM-5.2 / Kimi K2) is the only path that fully clears the data gate.
- **For OpenAI/Gemini**, the honest path is their *native* Responses/Managed-Agents API
  behind a purpose-built loop, not a lossy proxy behind the Anthropic SDK.
- **If the goal becomes "many models, one loop"** rather than cost, evaluate an engine swap
  (OpenCode `serve`+SDK, or Goose) — bigger bet, justified by vendor-resilience/local-models,
  not by price alone.

**Why bother at all:** the strongest argument isn't cost (modest, conditional) — it's
**vendor-resilience**: a pluggable backend means a silent harness/model regression from one
vendor (cf. the April-2026 Opus-nerf episode) can't degrade callback-box with no recourse.

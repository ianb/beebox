# Drop-in providers UNDER Claude Code (Anthropic-compatible endpoints)

*2026-07-18. Deep-pass per-topic note (subagent web research, Sonnet, ~30 sources;
lightly edited for formatting). Question: which model providers can sit under our
existing Claude Code / Agent SDK harness via `ANTHROPIC_BASE_URL`, and what do their
plans actually permit and deliver? Synthesis and recommendations: [2026-07-18-synthesis.md](2026-07-18-synthesis.md).*

Evidence tags: **[vendor]** (marketing/docs), **[report]** (practitioner account),
**[primary]** (fetched policy text). Negative results stated explicitly.

---

## 1. GLM / z.ai

**Endpoint mechanics.** Base URL `https://api.z.ai/api/anthropic` [vendor, Z.ai devpack
docs, Jul 2026]. Standard `ANTHROPIC_BASE_URL` + `ANTHROPIC_AUTH_TOKEN`; z.ai also remaps
`ANTHROPIC_DEFAULT_HAIKU_MODEL` etc. to GLM-4.7/GLM-5.2/GLM-5-Turbo. Widely reported as a
functioning full agentic-loop backend (tool use, streaming) across many independent setup
guides — one of the most mature integrations of the group.

**Plan reality — the critical finding.** Content-based enforcement is primary-source
policy, and it names our workload:

> **[primary]** "The GLM Coding Plan is designed specifically for Coding Scenarios. If
> the system detects that the subscription is being used for requests clearly unrelated
> to coding scenarios, certain subscription benefits may be restricted."
> — docs.z.ai/devpack/usage-policy, fetched Jul 2026.

This is content inspection layered on top of the also-present client whitelist ("GLM
Coding Plan may only be used within officially supported tools and products").
**[report]** awesomeagents.ai (Jul 2026) reports enforcement live since the week of
2026-04-14, with flagged non-coding workloads explicitly including SillyTavern roleplay,
Discord/Telegram bots, **personal assistants** (named verbatim), translation/summarization
batch jobs, custom chatbot operators. Enforcement ladder: throttling (error codes
1302/1303) → suspension → permanent ban at 3 violations.

**[report]** A separate enforcement dimension (github.com/earendil-works/pi#4187, 2026):
generic SDK User-Agent headers with no tool identification get flagged as unauthorized
"SDK-based access" before content is even considered — i.e. a server-embedded Claude Code
binary making programmatic calls matches this pattern regardless of request content.

**Verdict:** the coding plan is disqualified twice over (content enforcement + headless
"SDK-based access" detection). The pay-per-token standalone GLM API has no such
restriction and remains the viable tier.

**Vision.** **[vendor]** GLM-5.2 supports multimodal input; GLM-5V-Turbo is the
vision-specialized variant. **No practitioner confirmation found** that base64 image
blocks work end-to-end through the `/api/anthropic` Messages-format endpoint specifically
— treat as vendor-claimed, unverified on this wire path.

**Data/jurisdiction.** PRC entity (Zhipu); National Intelligence Law Art. 7 exposure
regardless of stated policy or server location. Privacy policy permits aggregated-data
service improvement; no explicit API-training opt-out found. All traffic transits
PRC-jurisdiction infrastructure.

**Pricing.** Plan: Lite from ~$16.20/mo promo (~$18 base) — disqualified above. API:
pay-per-token, low-single-digit $/M range typical of Chinese open-weight vendors; exact
current rate not pinned this pass (z.ai/model-api has the live table).

## 2. Kimi / Moonshot

**Endpoint mechanics.** `https://api.moonshot.ai/anthropic` (global) /
`api.moonshot.cn/anthropic` (China) [vendor]. Model `kimi-k2.7-code`. Multiple
independent guides confirm the full agentic loop works as a drop-in.

**Plan reality.** Kimi Code membership ≈ $19/mo, 5-hour rolling token quota (300–1,200
calls/window), max 30 concurrent requests [report, nxcode.io / kimik2ai.com]. Risk
detection watches "IP address, conversation behavior, and usage metrics" but "normal
patterns... are not typically flagged regardless of volume" [kimi.com/code/docs
community guidelines]. **No explicit coding-only content restriction or
personal-assistant prohibition found** — a meaningfully looser posture than z.ai's.
Negative result: no reports found of Kimi banning non-coding or headless usage.

**Vision.** **[vendor, corroborated]** K2.7 Code is natively multimodal via a 400M-param
MoonViT encoder — PNG/JPEG/WEBP/GIF input, experimental video, marketed specifically for
screenshot-in-prompt use. Strongest vision story of the China-based providers. The
Anthropic-compat wire path for images was not independently verified in practitioner
reports found.

**Data/jurisdiction.** **No product-level training opt-out exists** ("no toggle, no
setting, no checkbox") [gist analysis, Feb 2026]; policy text says user content
(prompts, images, files) is used for training. PRC-based (Singapore subsidiary); same
National Intelligence Law concern.

**Pricing.** Plan ~$19/mo. API: ~$3/$15 per M in/out at K3 launch; `kimi-k2.7-code`
reported around $0.60/$2.50 per M in/out.

## 3. MiniMax

**Endpoint.** `https://api.minimax.io/anthropic` (intl) [vendor]. Loop confirmed working
by multiple write-ups.

**Plan reality.** Coding Plan keys are explicitly scoped to interactive tools: "must not
use the plan's API key for automated scripts, application backends, or other
non-interactive scenarios" — violation → suspension/revocation [report, help.apiyi.com].
Server-embedded non-interactive use is out of scope by policy. Pay-as-you-go keys are
separate and unrestricted.

**Vision — disqualifying.** **[report]** M2.7 (Mar 2026), the coding-plan flagship,
**does not support image input**. MiniMax's vision-capable lines (VL-01, the multimodal
M3) are not what practitioners wire into Claude Code. Coding-model surface is text-only.

**Data/jurisdiction.** PRC-based, mainland data centers. No default-training opt-out
confirmed.

**Pricing.** API: M2.1 cited at $0.30/$1.20 per M in/out (~90% cheaper than Sonnet).

## 4. DeepSeek

**Endpoint.** Yes — `https://api.deepseek.com/anthropic` [vendor], with server-side
Claude model-name aliasing (`claude-opus-*` → `deepseek-v4-pro`, etc.), documented
prompt caching (~10% rate for cached input) and web-search tool. **[report]** Mixed
reliability: at least one issue thread reports failures through Claude Code; community
proxy tools exist specifically to isolate DeepSeek config, suggesting friction.

**Plan reality.** No coding-plan tier at all — pay-per-token only, so no
whitelist/content-enforcement mechanism to violate. Simplest enforcement posture of the
China-based options.

**Vision — disqualifying.** V4-pro/V4-flash are **text-only in the public API** (as of
Jul 14, 2026). DeepSeek-VL exists but is not exposed on the production path the
Anthropic-compat endpoint routes to.

## 5. Qwen (Alibaba)

Two documented paths (DashScope claude-code-proxy; claimed native Anthropic endpoint for
Qwen 3.7). Only setup-guide-tier sources found; vision-through-this-path unconfirmed
either way. Flagged for follow-up if needed; not scored further this pass.

## 6. OpenRouter (aggregator)

**Endpoint.** `ANTHROPIC_BASE_URL="https://openrouter.ai/api"` (note: not `/api/v1`)
plus OpenRouter key [vendor + independent corroboration]. Claims pass-through of
extended thinking and native tool use with model-name mapping. Architecturally distinct:
a US-based router in front of many models (Anthropic's own, GLM, Kimi, DeepSeek, Qwen,
Grok, Llama, …).

**Plan reality.** No flat subscription; pay-per-token pass-through plus a small margin.
Volume-agnostic brokering — no plan ToS to violate, no found enforcement risk.

**Vision.** Model-dependent, and that's the advantage: OpenRouter maintains an explicit
vision-models collection, so you pick a vision-capable backend (including Claude itself)
per route.

**Data/jurisdiction.** OpenRouter is US-based; the selected underlying provider's
jurisdiction and training policy still apply per model.

## 7. claude-code-router (local translation proxy)

musistudio/claude-code-router: ~33.2K stars, 907 open issues (Apr 2026 snapshot). Sits
between the Claude Code binary and arbitrary backends (OpenAI, Gemini, OpenRouter,
DeepSeek, Moonshot, custom), translating request formats. The right tool only when a
vendor has no native Anthropic-compat endpoint; translation lossiness on
thinking/caching documented in its own tracker (see first-pass README). Also: pointing
any proxy at a *coding-plan* endpoint still trips vendor-side headless-access detection
(the pi#4187 pattern) since the vendor sees generic traffic, not a recognized client.

Distinct enforcement regime, opposite direction: Anthropic (from ~Jan 9, 2026) blocks
third-party harnesses spoofing Claude Code *toward Anthropic subscriptions*. Does not
apply to us — we run the genuine Claude Code binary pointed outward.

---

## Ranked summary (vision + jurisdiction + enforcement weighted)

| Rank | Provider | Verdict |
|---|---|---|
| 1 | Kimi API (pay-per-token, not the plan) | Only China-based option with vendor-confirmed native vision AND no found headless/general-use ban at the API tier. Trains on content with no opt-out; PRC jurisdiction. |
| 2 | OpenRouter → vision-capable non-China model | Sidesteps plan-ToS risk entirely; per-model jurisdiction/vision choice. Adds a routing layer + margin. |
| 3 | GLM API (pay-per-token only) | Vision unconfirmed on this wire path; PRC jurisdiction; the coding plan is explicitly disqualified (content-inspected, "personal assistant" named). |
| 4 | MiniMax | Disqualified: coding-model family has no image input; plan bars non-interactive use. |
| 5 | DeepSeek | Disqualified: no vision on the production API surface. |
| 6 | Qwen | Under-researched; unconfirmed either way. |

Bottom line: none of the cheap China-based coding *plans* are usable for our workload
shape — z.ai by explicit content policy naming personal assistants, MiniMax by
non-interactive-use ban (and no vision), Kimi's plan by quota/concurrency shape even
where policy is silent. The structurally sound paths are pay-per-token APIs to a
vision-capable model (Kimi strongest technically, with a hard data-posture problem) or
OpenRouter as a neutral aggregator to a non-China vision model.

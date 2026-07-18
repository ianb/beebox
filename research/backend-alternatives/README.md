# Alternate agent backends for callback-box (beyond the Claude Agent SDK)

*2026-07-18. Research snapshot. Framing: NOT a competitive scorecard — the question is
**which agent engines/models callback-box could run on besides the Claude Agent SDK,
how hard the integration is, and what it would buy us.** callback-box is a general
personal assistant (email/notes/scheduling), a shipped product, handling private user
data — those three facts, not "is it a good coding tool," decide everything below.*

Method: parallel web research (July 2026) across Codex, Google Antigravity, Kimi/Moonshot,
GLM/Zhipu, OpenCode/Crush/Kilo, a breadth sweep (Gemini CLI, Aider, Cline, Amp, Goose,
Cursor CLI, Qwen Code, Continue, Warp, Factory Droid, Copilot CLI, Roo), and multi-backend
wrapper/router prior art. Every non-obvious claim was sourced; per-tool detail lives in the
session transcripts — this README is the synthesis + decision.

> ⚠️ **FIRST PASS — KNOWN-FLAWED; superseded by a deeper Fable-led investigation
> (worktree `backend-research`, started 2026-07-18).** Boxholder flagged three gaps that
> matter enough to redo this:
> 1. **Wrong architecture model.** This doc treats the agent loop as callback-box's own and
>    frames adopting OpenCode as "replacing our loop, a bigger bet." That's wrong — callback-box
>    **delegates the loop to `@anthropic-ai/claude-agent-sdk`'s `query()`** (`src/core/agent/`);
>    the loop is *external*. So OpenCode/Goose are **peer engine swaps at the same layer**, not
>    a bigger disruption — possibly *easier* than implied. The real unexamined question is how
>    coupled `src/core/agent/` is to the SDK's interface.
> 2. **ToS-theoretical, not empirical.** The restriction analysis leans on ToS text; what's
>    needed is real practitioner *accounts* of what subscriptions actually allow vs. what's only
>    announced-but-unenforced (e.g. Anthropic's stated-but-not-yet-applied quota cuts).
> 3. **Missing: self-hosting (vLLM) and image/multimodal capability** — image understanding is
>    core to callback-box (screenshots, image cards, PDFs, capture), so every candidate needs a
>    vision verdict, and vLLM's multimodal serving story must be assessed.
>
> Treat the sections below as a rough map, not conclusions. The corrected framing above still
> holds (task-permission isn't the barrier); the *engine-swap* analysis is what's being redone.
>
> **The deep pass is complete — read [2026-07-18-synthesis.md](2026-07-18-synthesis.md)
> for current conclusions.** This README remains as the dated first-pass record only.
> Deep-pass corpus:
>
> | Doc | Covers |
> |---|---|
> | [2026-07-18-synthesis.md](2026-07-18-synthesis.md) | **Current word**: adopt/adapt/reject recommendations, vision scorecard, watchlist |
> | [2026-07-18-sdk-coupling-audit.md](2026-07-18-sdk-coupling-audit.md) | Code audit: what we actually delegate to the SDK/Claude Code (corrects flaw 1) |
> | [2026-07-18-drop-in-providers.md](2026-07-18-drop-in-providers.md) | Providers under Claude Code via Anthropic-compatible endpoints; plan enforcement reality |
> | [2026-07-18-chatgpt-subscription-path.md](2026-07-18-chatgpt-subscription-path.md) | Codex CLI/SDK, OpenAI's subscription-auth tolerance, data posture |
> | [2026-07-18-anthropic-policy-enforcement.md](2026-07-18-anthropic-policy-enforcement.md) | Anthropic announced-vs-enforced; the paused credit-pool split |
> | [2026-07-18-vllm-self-hosting.md](2026-07-18-vllm-self-hosting.md) | Self-hosting open vision models; vLLM's native Anthropic endpoint |
> | [2026-07-18-alt-harnesses.md](2026-07-18-alt-harnesses.md) | OpenCode/Goose/Codex/Gemini/Cline/Amp/Crush vs our runtime contract |

---

## Correction up front (why the obvious framing is wrong)

The tempting story is "vendor coding subscriptions are fenced to coding, so a general
assistant can't use them." **That's mostly wrong, and it's the wrong thing to worry about.**

- **Task type is almost never the barrier.** Anthropic (Claude Code, and Claude Cowork
  as proof) and OpenAI (ChatGPT/Codex) are *unified quotas* — general/personal-assistant
  use is allowed. z.ai's GLM Coding Plan policy, read verbatim, restricts *"officially
  supported tools and products"* — a **client whitelist, not a task rule**; nothing bars
  non-coding work. (Kimi is the lone partial exception: its coding *endpoint* actively
  rejects non-coding-agent *clients* — still a client-identity check, plus a separate
  commercial-use ban.)
- **The real gates are three, none of them "coding-only":**
  1. **The Agent SDK is Anthropic-model-only by design** (the load-bearing technical wall).
  2. **Cheap plans are client-whitelisted** — you can't ride them from a custom app.
  3. **Subscription auth from a non-blessed client is being actively killed**, and foreign
     APIs carry **data/commercial/jurisdiction** dealbreakers for a private-data product.

## The three real gates

### Gate 1 — `@anthropic-ai/claude-agent-sdk` is Anthropic-only

The SDK reaches Claude via the Anthropic API, Bedrock, Vertex, or Azure Foundry — different
*hosting* for the same *model family*. There is **no documented plug point for a non-Claude
vendor**; teams wanting true cross-vendor portability get pointed at LangChain/LangGraph
instead. So "use another model" is not a config flag — it splits into three technically
distinct integration paths, in increasing cost:

- **(P1) Anthropic-compatible endpoint** — set `ANTHROPIC_BASE_URL` + auth token; the SDK
  speaks the Messages API to a compatible server. **Trivial** — and we *already* set
  `ANTHROPIC_BASE_URL` in the run path (for the prompt-logger, `src/core/agent/run.ts:192`),
  so the wiring exists. **But only Anthropic-shaped vendors qualify: GLM (`api.z.ai/api/anthropic`)
  and Kimi-coding (`api.kimi.com/coding/`).** Caveat: it's *compatible*, not Anthropic's own —
  verify tool-use formatting, streaming, thinking blocks, and prompt-caching against our SDK
  version before trusting it.
- **(P2) Translation proxy** (claude-code-router ~36k★, or LiteLLM) to reach OpenAI/Gemini
  through the Anthropic-shaped SDK. This is the *only* pattern that attempts true cross-vendor
  swap, and its own bug trackers show it is **demonstrably lossy on exactly the fields agentic
  work depends on**: extended-thinking/reasoning content (stored under nonstandard keys, dropped
  from streaming), `cache_control` prompt caching (invalidated crossing the boundary), and
  tool-use turn-shape under context compaction (Anthropic rejects a `tool_use` not immediately
  followed by `tool_result`). These compound over long multi-turn sessions — i.e. our exact
  usage shape. Treated as a workaround even by its maintainers.
- **(P3) Adopt a different engine** — replace our loop with a natively multi-model one
  (OpenCode/Kilo/Cline/Goose). Buys 75+ models and vendor-decoupling; costs us our own loop
  and adds a supervised subprocess/engine.

There's also a **fourth pattern that doesn't apply to us**: CLI shell-out orchestrators
(Claude Squad, Conductor, Vibe Kanban) that spawn each vendor's *own* CLI as a subprocess.
Good as a UX layer over agents you don't control; useless as an in-app backend, and brittle
(couples to each CLI's undocumented stdout/flags; the category has high mortality — Crystal,
Terragon, Vibe Kanban's paid layer all shut down in 2026). The protocol-layer effort worth
watching is **ACP** (Agent Client Protocol, Zed+JetBrains, 25+ agents) — but it standardizes
*host↔agent sessions*, explicitly **not** cross-model API portability or auth, so it doesn't
solve our problem either.

### Gate 2 — cheap plans are client-whitelisted (not task-fenced)

The genuinely cheap options are subscriptions fenced to a whitelist of *client apps*:

- **GLM Coding Plan** — ~$18/$72/$160/mo (promo $12.60/$50.40/$112 through ~Sept 2026); a
  "prompt" fans out to 15–20 model calls, so even Lite is real headroom; **Pro ~$72 ≈ Claude
  Max $100–200 throughput** for a fraction of price — that gap is the whole "generous"
  reputation. **But it only works inside whitelisted clients** (Claude Code, Cline, Kilo,
  OpenCode, Goose, ZCode, …). A custom Agent-SDK app is not on the list → we'd pay the
  **general pay-per-token API**, not the cheap plan.
- **Kimi Code plan** — similar shape ($19–$199 tiers), Anthropic-compatible *coding* endpoint,
  but that endpoint **enforces a coding-agent client whitelist** (returns "only available for
  Coding Agents") — a custom app is rejected. General use → its OpenAI-compatible API + an
  adapter (P2).

The lesson: **for any custom app, budget against general per-token API pricing, not the
headline coding-plan price.** The cheap number isn't available to us.

### Gate 3 — auth-fences and data/ToS dealbreakers

- **Subscription auth from a third-party client is being severed.** Anthropic (Jan 2026)
  blocked non-Claude-Code clients from using Pro/Max OAuth tokens (*"only authorized for use
  with Claude Code"*); Google bans third-party harnesses on Gemini/Antigravity subscription
  creds. So **"ride an end-user's Claude Max in callback-box" is a non-starter** — API billing
  only. (Only GitHub Copilot *sanctions* subscription use in a third party, via OpenCode.)
- **Data/training + jurisdiction** (decisive for a private-data assistant):
  - Anthropic & OpenAI: **do not train on API/business data by default** (individual ChatGPT
    plans default train — opt out). Cleanest posture.
  - **Kimi**: trains on content **by default, email-only opt-out**, plus a **no-commercial-use
    ToS** — two hard blockers for a shipped product on private data.
  - **GLM/z.ai**: training opt-out **undocumented/ambiguous**; Beijing-based (Singapore
    processing) → **China National Intelligence Law** exposure repeatedly flagged for private
    repos/email. Open-weight GLM-5.2 (self-host) is the only clean escape.
  - **Gemini/Antigravity**: trains by default **outside Workspace/GCP**; plus Google's
    breaking-change churn and two RCE-class incidents in 5 months.

## Per-backend verdict (as a backend for us)

| Backend | Integration path | Ease | General tasks OK? | Cost to us | Verdict |
|---|---|---|---|---|---|
| **Anthropic (status quo)** | in-process SDK | baseline | yes | Max sub / API | the reference |
| **GLM-5.2 (z.ai)** | P1 Anthropic-compatible endpoint | **trivial** (base-URL+key) | yes (tool-whitelist, not task) | **general API** (not the $18 plan) | best *easy* option; gated by China-data + training ambiguity → fine for non-sensitive, risky for email |
| **Kimi K2/K3** | P1 (coding, whitelisted) / P2 (general) | trivial-but-fenced / medium | coding-endpoint rejects us; general OK | general per-token | commercial-use ban + default-train = **avoid on private data** |
| **OpenAI GPT-5.x** | P2 proxy, or their **Responses/Agents API** (not Codex) | medium (lossy proxy) or rebuild loop | yes | API per-token | clean data posture; but not P1 — needs proxy or a second loop |
| **Google Gemini** | Gemini API / Managed Agents (not Antigravity IDE) | medium | yes | API | train-by-default outside Workspace; churn; Antigravity-the-IDE is *not* embeddable |
| **OpenCode / Kilo** | **P3 engine** (`opencode serve` + `@opencode-ai/sdk`; `@kilocode/sdk`) | medium (separate process) | yes | free engine + BYO model | cleanest *engine* if we want many-models-one-loop; MIT; gives up our loop |
| **Cline** | P3 (`@cline/sdk`, Apache-2.0) | medium | yes | free + BYO | strong embeddable SDK; pin versions (2026 npm supply-chain incident) |
| **Goose (Block)** | P3 (API + headless, Apache-2.0) | medium | **yes, explicitly general-purpose** | free + BYO | best "general agent framework" fit if adopting an engine |
| **Aider** | P3 (Python SDK) | medium | coding-shaped | free + BYO | Python-only, thin SDK, coding-first — poor fit |
| **Codex** | SDK = local CLI-subprocess / `codex exec` | high friction, wrong layer | yes (unified quota) | — | embed the *Responses API*, not Codex-the-agent |
| **Antigravity (IDE)** | not embeddable | — | — | — | evaluate Gemini API instead; the IDE is not a backend |

## What a backend swap would actually buy callback-box

- **Cost reduction** — real *only* via cheaper models (GLM/Kimi/MiniMax/open-weights) on the
  **general API or self-host** (the cheap plans are off-limits), with a quality step-down and,
  for the Chinese vendors, data-jurisdiction risk. Modest, conditional win.
- **Vendor-resilience / regression-decoupling** — the strongest *strategic* argument, and the
  #1 theme in community reception (the April-2026 "Opus nerf," documented with 6,852-session
  data, is the cautionary tale; OpenCode's model-*pinning* is cited as the structural fix).
  A pluggable backend means one vendor's silent harness/model change can't degrade us with no
  recourse.
- **Local/offline & privacy** — only via an engine + Ollama/self-hosted open weights; the only
  path that fully sidesteps the data/jurisdiction gate.
- **Task-tiered routing** — cheap model for cheap work (intake triage), frontier for hard
  reasoning — requires multi-backend plumbing but is a concrete efficiency lever.

## Recommendation (traced to callback-box specifics)

1. **Cheapest real step: model-API-layer pluggability we already half-have.** Make the
   Agent-SDK backend (base URL + model IDs, `src/core/model-ids.ts`) configurable so we can
   point at an Anthropic-compatible endpoint. That immediately unlocks **GLM's general API**
   (and Kimi-coding where appropriate) with near-zero code, keeps our loop, and gives us a
   fallback if Anthropic regresses. Low effort, high optionality. **First: verify the SDK's
   full agentic loop (tool-use, thinking, caching) survives a non-Anthropic compatible endpoint
   — this is the one thing that could make P1 not actually trivial.**
2. **Don't chase the cheap coding plans** for the backend — they're client-whitelisted (Gate 2)
   and, for the Chinese vendors on private user data, carry unresolved training/jurisdiction
   risk (Gate 3). Use general APIs, and treat foreign default-train APIs as unsuitable for
   email/PII unless self-hosting.
3. **For OpenAI/Gemini, don't proxy for the primary path** — the P2 translation layer is lossy
   exactly where our long agentic sessions live (thinking + caching). If we want GPT/Gemini,
   the honest options are their *native* Responses/Managed-Agents API behind a second, purpose
   -built loop, or accepting the proxy only for cheap/stateless sub-tasks.
4. **If the real goal becomes "many models, one loop, minimal maintenance"** — evaluate the
   **OpenCode engine** (server + SDK) or **Goose** as an engine swap. That's a bigger bet
   (replacing our loop) justified only if vendor-resilience/local-models become first-class
   product goals, not just cost.

## Open questions to resolve before acting

- Does `@anthropic-ai/claude-agent-sdk`'s **full loop** (tools, extended thinking, prompt
  caching, streaming) work against a non-Anthropic Anthropic-*compatible* endpoint, or only
  raw messages? (The trivial-P1 story lives or dies here — test against GLM's `/api/anthropic`.)
- GLM-5.2 **general** (non-coding-plan) per-token prices and the real cost delta vs Anthropic.
- Whether a self-hosted open-weight model (GLM-5.2 / Kimi K2) is worth the infra for the
  privacy/jurisdiction win, given callback-box handles email/PII.

## Sources

Consolidated in the per-tool session research; key primary/verified anchors:
z.ai usage policy & Anthropic-compat docs (`docs.z.ai/devpack/usage-policy`,
`docs.z.ai/scenario-example/develop-tools/claude`); Kimi coding-agent whitelist
(`kimi.com/code/docs`, `github.com/HKUDS/nanobot/issues/354`); Anthropic subscription-auth
block (augmentedmind.substack.com "end of the Claude subscription hack"); OpenCode server/SDK
(`opencode.ai/docs/server`, `/sdk`); Claude Agent SDK provider scope
(`code.claude.com/docs/en/agent-sdk/overview`); router prior-art + leak bugs
(`github.com/musistudio/claude-code-router`, LiteLLM issues #27946/#29518/#22946/#23841);
ACP (`agentclientprotocol.com`); Codex SDK (`learn.chatgpt.com/docs/codex-sdk`); GLM/Kimi
pricing (aipricing.guru, nxcode.io) and reception (HN #45856628, #48712516, #47460525;
composio 100-hour comparison).

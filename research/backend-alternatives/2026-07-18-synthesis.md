# Backend pluggability for beebox: deep-pass synthesis

*2026-07-18. Supersedes the first-pass [README](README.md) analysis (kept as a record
with its flaws flagged). Method: a code-reading
[coupling audit](2026-07-18-sdk-coupling-audit.md) plus five empirical research passes —
[drop-in providers](2026-07-18-drop-in-providers.md),
[the ChatGPT-subscription path](2026-07-18-chatgpt-subscription-path.md),
[Anthropic policy enforcement](2026-07-18-anthropic-policy-enforcement.md),
[vLLM self-hosting](2026-07-18-vllm-self-hosting.md),
[alternative harnesses](2026-07-18-alt-harnesses.md). Boxholder framing this pass
answers: resilience to **policy and pricing changes** (explicitly NOT intermittent
quality issues), giving users **a provider choice made once, up front**, ideally
letting a user **bring a subscription they already pay for** (ChatGPT being the big
one). Two integration shapes: (A) a provider dropped in UNDER Claude Code, and (B) an
entirely different harness with Claude-Code-like functionality.*

## The architecture fact everything else hangs on

beebox delegates a **runtime** to Claude Code — built-in filesystem/shell tools,
CLAUDE.md/rules/skills auto-loading, the `claude_code` system-prompt preset, in-process
PreToolUse/PostToolUse hooks (card validation), session store + transcripts, and
subscription auth — with the Agent SDK as the driving handle
(full inventory: [coupling audit](2026-07-18-sdk-coupling-audit.md)). Two consequences:

- **Shape A is categorically cheaper.** Swapping the model server under Claude Code
  (`ANTHROPIC_BASE_URL` + token + model ids) keeps every layer we depend on. There is
  precedent for base-URL injection (`src/core/agent/run.ts:192`, the prompt-logger
  proxy), though that is debug plumbing; real integration work remains in the
  auth preflight, `buildScriptEnv`'s deliberate `ANTHROPIC_API_KEY` stripping, and
  cost attribution (inventory in the coupling audit's closing section). Cheap
  relative to Shape B; a scoped task, not a config flag.
- **Shape B is a project.** The harness survey found no clean drop-in: in-process
  hooks, caller-minted session ids, and structured-output-under-tools each exist in
  some candidates and are missing or refused in others; our chat history subsystem
  additionally parses Claude Code's on-disk transcripts directly.

## Vision scorecard (a model that can't see images is disqualified)

| Candidate | Understands images? |
|---|---|
| Claude (status quo) | Yes — baseline |
| GPT-5.x via Codex / API | Yes at model level; the ChatGPT-subscription-auth path has an unresolved image-forwarding gap in third-party harnesses; clean via paid API |
| Kimi K2.7 API | Yes — native encoder; best China-based vision story |
| GLM (z.ai) API | Claimed; unconfirmed through the Anthropic-compatible endpoint |
| MiniMax | No (coding-model surface is text-only) — disqualified |
| DeepSeek | No (public API is text-only) — disqualified |
| Qwen3-VL (self-host) | Yes — best open-weight option; ~45GB VRAM class for the good tier |
| Gemini | Yes at model level; harness disqualified on other grounds |

**Transport refinement (boxholder, 2026-07-18):** "accepts image input" decomposes
into model vision (hard gate — MiniMax/DeepSeek stay disqualified) and transport.
Transport can be inline image blocks OR a file reference resolved by a
vision-capable read tool — box media is already on disk and agent-Read today. This
softens Shape B gaps that are inline-push-specific (Codex's subscription-path
image-forwarding bug, Crush's headless image gap) into verify-per-harness details.
It does NOT help Shape A: when Claude Code reads an image file, the bytes still
cross the wire to the provider as image content in the tool result, so an
Anthropic-compatible endpoint must transport images regardless. It also suggests a
port-narrowing move on our side: chat uploads written into the box and sent as
paths would make `ChatBackend.send()` text-only (folded into the port-hygiene
issue).

## What the empirical passes established

**1. Our current posture survived every enforcement wave, and the near-term Anthropic
risk is a pricing change with notice — with one standing ambiguity.** Single-tenant
Agent SDK use on the subscriber's own login is described as "ordinary use"; no
ban/throttle reports exist for personal headless/cron agents; task type is irrelevant
to Anthropic (Cowork proves general use on the same quota pool). Every enforcement
wave hit multi-tenant harnesses proxying other users' traffic. The ambiguity to be
honest about: the same docs point "developers building products/services" at API
keys, and beebox is a shipped product even though each user runs their own
instance on their own login — a tolerated gray zone per the policy note, defensible
as long as we never centralize users' subscriptions, and a second reason (beyond
pricing) to want the provider-config escape hatch. The concrete threat is the announced-then-cancelled credit-pool
split for SDK/`claude -p` usage (was to take effect 2026-06-15; pulled that day;
"when, not if"). That is precisely a policy/pricing event of the kind the boxholder
wants resilience to — and it comes with advance notice, which means pluggability can
be a prepared response rather than a prerequisite.
([policy enforcement note](2026-07-18-anthropic-policy-enforcement.md))

**2. The cheap coding plans are dead for us.** Two evidence grades, kept distinct:
z.ai's usage policy (primary source) states the plan is for coding scenarios and that
the system detects requests "clearly unrelated to coding scenarios" — confirming the
boxholder's recollection that content is inspected; that enforcement specifically
names "personal assistants" among banned patterns comes from a third-party report
(awesomeagents.ai), corroborated in spirit by a separate practitioner-reported
"SDK-based access" flag on headless traffic, and should be treated as
report-grade. MiniMax's plan bars non-interactive/backend use outright. Kimi's plan is
quota-shaped for interactive coding. Every viable third-party path prices at
pay-per-token API rates. ([drop-in providers](2026-07-18-drop-in-providers.md))

**3. Among drop-in providers, vision + data posture leave a short list.** MiniMax and
DeepSeek fall to the vision gate. Kimi's API is the best technical fit (native vision,
no found headless/general-use ban) and fails the data gate for private-by-default use:
training-on-content with no opt-out, PRC jurisdiction. GLM API: vision unconfirmed on
this wire path, same jurisdiction exposure. **OpenRouter is the interesting neutral
option**: US-based aggregator, Anthropic-compatible endpoint, no plan-ToS to violate,
per-model choice of jurisdiction and vision capability — including routing to Claude
itself, which makes it a *billing*-diversity lever as well as a model one.

**4. "Bring your ChatGPT subscription" is real-ish, for the first time — with three
specific blockers for us.** OpenAI publicly tolerates third-party harnesses on
ChatGPT-subscription OAuth (exec-level "use Codex wherever you like", naming OpenCode
and Claude Code; no enforcement cases found). The blockers: (a) the tolerance is
informal and pointedly unanswered for *commercial* bring-your-own-subscription
products; (b) personal-subscription traffic is training-eligible by default behind two
separate opt-out toggles — the opposite of our private-data mandate; (c) the
subscription-auth path has an unresolved image-forwarding gap in third-party
harnesses. The sanctioned OpenAI path is the Responses API on API billing, which
forfeits the reuse-your-$20-plan appeal.
([ChatGPT-subscription path](2026-07-18-chatgpt-subscription-path.md))

**5. If we ever adopt a second harness, it's Codex CLI, and the price is known.**
Strongest embeddable SDK (published npm package, streamed events, per-turn image
input, resume-by-id), genuine system-prompt append, Claude-interoperable skills
standard, the only real subscription story, and model-agnostic provider config
(including Ollama/local). Known costs: caller-minted session ids refused (host-side id
map required — touches our chat-session create-with-id design), hooks are shell-only
(our in-process card validator would regress to subprocess validation),
structured-output-under-tools needs empirical re-verification. OpenCode has the best
hooks/structured-output and disqualifying subscription-auth ToS exposure plus API
churn; Cline has the right capabilities on a 2-month-old SDK; Goose's subscription
economics require wrapping vendor CLIs (so it doesn't remove the Claude Code
dependency); Gemini CLI has a documented suspension for exactly our usage pattern.
([alt harnesses](2026-07-18-alt-harnesses.md))

**6. Self-hosting is a future bet with working plumbing.** vLLM now ships a native
Anthropic Messages endpoint and practitioners confirm Claude Code runs against it —
meaning the self-host path is Shape A, under our unchanged harness. What's missing
today: no open model cleanly clears vision + reliable tool-calling + affordable
hardware simultaneously (best vision option needs ~45GB VRAM; GLM's vision model has
an open vision-XOR-tools version conflict; PDFs need pre-conversion; measured
tool-use gap ~95% vs ~87.5%). Recheck in 6–12 months.
([vLLM self-hosting](2026-07-18-vllm-self-hosting.md))

## Recommendations

**ADOPT (gated on the spike) — provider-endpoint configuration under the existing
harness (Shape A).** A per-box/install-time provider setting (base URL, auth token,
model-id map via `src/shared/model-ids.ts` — the boxholder's "choose your provider up
front" model exactly) wired through `src/core/agent/run.ts` and
`src/services/claude-chat.ts`, defaulting to Anthropic subscription auth. Concretely
unlocks: Anthropic API billing (policy hedge against the credit-pool change),
OpenRouter (model + billing diversity, vision-capable non-China models), Kimi/GLM APIs
for users who accept their data posture, and self-hosted vLLM later. Honest scope: a
scoped task rather than a config flag — provider-aware auth preflight, a token path
through `buildScriptEnv`'s API-key stripping, visible degradation of cost attribution
(details in the feature issue). The gate is empirical: a scratch-box spike proving
the SDK's full loop (tools, images, streaming, caching, session resume) against one
real non-Anthropic endpoint under a real reactor workload, per the pre-existing spike
issue — adoption is contingent on that spike passing. Filed as
`issues/features/2026-07-18-provider-endpoint-config.md`.

**Acknowledged gap — no workload cost model.** This pass established *which* paths
are viable and legal; it did not build the per-provider cost comparison a pricing
decision needs (expected monthly tokens, image volume, cache-hit assumptions,
tool-call counts × per-provider rates). That model is cheap to build from our own
usage data (`src/core/usage.ts` already attributes per-session cost) and should be
part of the spike.

**ADAPT — port hygiene that pays off regardless of any swap.** Move `adaptSdkMessage`
inside `ChatBackend` so the port speaks our stable `ChatMessage` wire type; normalize
the raw stream-delta events; log our own durable transcript instead of parsing
`~/.claude/projects/` JSONL. Each step shrinks coupling Layers 2–3 and is justifiable
as cleanup on its own. Filed as
`issues/code-quality/2026-07-18-chat-backend-port-hygiene.md`.

**LATER — Codex SDK as an optional second backend (Shape B, scoped).** The only route
to "bring your ChatGPT subscription," and the research says treat it as an optional,
clearly-labeled backend rather than a default: OpenAI's tolerance is informal
(tweet-grade, with the commercial-use question pointedly unanswered — shipping this
warrants an actual legal read, and nothing stronger than "experimental" labeling),
plus two-toggle training exposure and the image-path gap. Trigger conditions for picking it up:
OpenAI formalizes third-party subscription policy, or the Anthropic credit-pool change
lands and users need an escape hatch. Filed as
`issues/exploration/2026-07-18-codex-sdk-second-backend.md`.

**REJECT — for now, with reasons on record:**
- Cheap coding plans (GLM/Kimi/MiniMax) as our backend — content-inspected or
  non-interactive-banned; personal assistants named as a banned pattern (z.ai).
- MiniMax and DeepSeek entirely — no vision.
- Gemini CLI as a harness — suspension precedent for headless+custom-prompt use;
  structured output declined; SDK unpublished.
- OpenCode/Goose/Cline as the primary harness today — each fails a load-bearing
  contract point (subscription-auth ToS exposure / wraps vendor CLIs anyway / SDK too
  young). Re-evaluate Cline in particular in 6 months.
- Translation proxies (claude-code-router/LiteLLM) for the primary path — unchanged
  from the first pass: lossy exactly on thinking/caching in long agentic sessions.
- Building multi-model routing/fallback logic — the boxholder explicitly wants static
  provider choice, and nothing in this research argues otherwise.

## Watchlist (what would change these conclusions)

1. Anthropic re-announces the SDK credit-pool split → accelerates ADOPT item and
   possibly LATER item. Monitor support.claude.com Agent SDK article +
   code.claude.com legal-and-compliance.
2. OpenAI writes down a third-party subscription policy (either direction) → resolves
   the LATER item's biggest unknown.
3. vLLM/GLM tool-parser fix + a vision model that fits 24–32GB well → makes self-host
   a real Stack A pilot.
4. The unverified report of SDK-tagged traffic being throttled differently than
   CLI-tagged traffic under the same token — cheap to instrument for in our usage
   tracking; evidence would shift the Anthropic risk picture.
5. ACP's remote transport maturing → could become the standardize-once answer to
   Shape B; today it's editor-embedding-shaped.

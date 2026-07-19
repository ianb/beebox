# The ChatGPT-subscription path (Codex CLI/SDK, OpenAI policy reality)

*2026-07-18. Deep-pass per-topic note (subagent web research, Sonnet; lightly edited).
Question: can a user's existing ChatGPT Plus/Pro subscription power callback-box's
agent, and what would that take? Synthesis: [2026-07-18-synthesis.md](2026-07-18-synthesis.md).*

---

## 1. Codex CLI + ChatGPT subscription auth

**Mechanism.** `codex login` does OAuth against chatgpt.com, caching tokens in
`~/.codex/auth.json`. Any process presenting those tokens routes model calls through
`chatgpt.com/backend-api/codex/responses`, billed against the subscription's included
usage rather than API metering.

**Quotas (Jul 2026).** Two stacked windows: 5-hour rolling cap + weekly cap, varying by
model tier. Plus = "a few focused coding sessions/week"; Pro $100 = 5x Plus; Pro $200 =
20x Plus. Apr 2, 2026: accounting switched from per-message to token-based.

**Policy — OpenAI is the permissive outlier, but informally.** Romain Huet (OpenAI),
tweet 2026-03-30: *"We want people to be able to use Codex, and their ChatGPT
subscription, wherever they like! That means in the app, in the terminal, but also in
JetBrains, Xcode, OpenCode, Pi, and now Claude Code."* When GPT-5.5 launched (Apr 23,
2026) gated to subscription auth, Simon Willison reverse-engineered the token flow
within hours and shipped `llm-openai-via-codex`; OpenAI's response was the
"wherever you like" line, not a takedown. Direct contrast with Anthropic (Feb 2026 ToS
ban on third-party subscription OAuth; Apr 4, 2026 billing enforcement) and Google
(Feb 2026 Gemini CLI restriction).

**The limit of that tolerance.** GitHub Discussion openai/codex#8338: an OpenAI
maintainer confirmed forking is fine under Apache-2.0 but pointed only at the generic
ToS; direct follow-ups asking about **commercial** bring-your-own-subscription products
(Feb and May 2026) went unanswered. The tolerance is a tweet, not a written carve-out,
and specifically untested for commercial redistribution.

**Enforcement in practice.** No credible reports found of bans for riding subscription
auth in third-party harnesses at personal-use scale. One permanent ban of an 18-month
Pro subscriber (May 27, 2026) traces to shared-IP/datacenter fraud heuristics, not
harness use. The `opencode-openai-codex-auth` plugin self-limits to "personal
development use" — community caution, not a reported enforcement action.

## 2. Codex SDK / `codex exec` as an embeddable engine

Real, documented: `@openai/codex-sdk` (TypeScript; Python equivalent) wraps the CLI as a
subprocess exchanging JSONL over stdio — `codex.startThread()`, `thread.run()`,
`runStreamed()` (async event generator). `codex exec --json` is the headless mode.
Caveats:

- Docs scope it explicitly to "coding-focused Codex threads"; broader orchestration is
  pointed at the Agents SDK.
- Positioned for first-party integration (CI/CD, internal tools), not redistributable
  products carrying other users' ChatGPT credentials.
- The subscription-auth routing is an undocumented endpoint that can change without
  notice; practitioners recommend API-key auth for anything production
  (codex.danielvaughan.com, Apr 24, 2026). Building on it means storing
  auth.json-equivalent tokens, silent refresh handling, and accepting breakage risk on
  any OpenAI release.

## 3. Vision

Model-level: yes and improving — GPT-5-Codex/5.4/5.5 accept images; CLI `--image`;
GPT-5.4 added `"detail": "original"` (up to 10.24MP). **But**: an unresolved OpenClaw
issue (#84907) reports the codex kernel does not forward image content as multimodal
input to ChatGPT-Plus-OAuth agents — images need slow shell-wrapper workarounds. A
third-party-harness integration gap on exactly the subscription-auth path, unresolved as
of research date. Matters a lot for an image-centric product.

## 4. Task-type scope

Docs and rate-card language are coding-session-framed; no technical block on non-coding
prompts found. Risks are inferred rather than confirmed: OpenAI could tighten for
detected non-coding traffic without contractual obstacles, and the "wherever you like"
goodwill was voiced about coding tools. Weakest-evidenced point of the six.

## 5. Data posture — the sharpest mismatch

- API / business tiers: no training on inputs/outputs by default; 30-day abuse
  retention; ZDR available.
- **Personal ChatGPT/Codex subscription: training-eligible by default**, and full
  opt-out requires TWO separate toggles — (1) Data Controls → "Improve the model for
  everyone", and (2) a Codex-specific setting for "full environments"; the first does
  not disable the second. For a product routing private email/notes/images through a
  user's subscription, this defaults to training exposure unless the product verifies
  both toggles per user.

## 6. Responses API on API billing (the sanctioned alternative)

Token-priced like Chat Completions (GPT-5.5 ≈ $8/M in, $32/M out); managed-agent layer
adds ~$0.02/tool call. No-training default, ZDR available. Zero ToS ambiguity; costs
per-token money rather than reusing the flat subscription.

---

## Verdict

More viable than the Anthropic equivalent ever was — OpenAI has publicly tolerated,
arguably endorsed, third-party subscription riding — yet not turnkey for a shipped
personal assistant: the tolerance is informal and untested for commercial multi-user
products; the SDK is coding-scoped on an undocumented auth endpoint; the
subscription-path image gap is unresolved; and personal-subscription traffic defaults
to training-eligible behind two toggles, the opposite of our private-data mandate.

Recommendation from this pass: if pursued, Responses API on API billing is the credible
sanctioned path (which forfeits the "reuse your $20/mo Plus" dream); Codex-subscription
OAuth could only be an opt-in, clearly-labeled experimental backend with explicit
warnings (fragile endpoint, two-toggle training opt-out), never the default for private
data.

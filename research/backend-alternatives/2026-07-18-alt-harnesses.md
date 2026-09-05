# Alternative harnesses scored against the Claude Code runtime contract

*2026-07-18. Deep-pass per-topic note (subagent web research, Sonnet; lightly edited).
Question: which alternative agent harnesses could replace Claude Code as beebox's
runtime, scored point-by-point against what we actually use? The contract derives from
the [coupling audit](2026-07-18-sdk-coupling-audit.md) Layer 4.
Synthesis: [2026-07-18-synthesis.md](2026-07-18-synthesis.md).*

## The contract

1. FS/shell tools + sandbox scoping (cwd + extra allowed dirs)
2. Context-file auto-loading (walk-up, globbed rules, skills/slash-commands)
3. System-prompt preset + append (not full replace)
4. Programmatic hooks — genuine in-process callbacks (our card validator)
5. Headless/embeddable SDK — image delivery mid-session, interrupt, session
   create-with-id, resume across process restarts. (Boxholder refinement,
   2026-07-18: image delivery is satisfiable EITHER by inline image blocks in the
   SDK's send path OR by file references + a vision-capable read tool — box media
   already lives on disk and is agent-Read today. The scorecards below graded
   inline push; a harness failing that but whose read tool delivers real
   multimodal content to the model is a softer gap than scored. Needs per-harness
   verification that the read-tool result reaches the model as image content.
   Model-level vision remains a hard gate either way.)
6. Session transcripts as host-readable structured data
7. JSON-schema-constrained structured output
8. Model/subscription-agnostic auth — what actually works vs marketing

## Scorecards (abridged; key evidence inline)

### OpenCode (anomalyco/opencode; MIT; TS; ~187K stars)

1 ✅ (permission.json, external_directory) · 2 ✅ (AGENTS.md, globbed instructions,
commands, skills; auto-`@file` still missing #2225) · 3 ❌ at SDK layer — Claude-SDK-style
systemPrompt option closed not-planned (#7351) · 4 ✅ **genuine in-process TS plugin
hooks** (`tool.execute.before` can mutate/block) · 5 ◐ — image push broken for custom
OpenAI-compatible providers (#20802 open); interrupt cooperative-only with stuck bugs;
**create-with-id declined** (#12916 → year-old unresolved #2159); in-flight resume
across restart closed not-planned (#19023) · 6 ◐ SQLite now, with a real migration
data-loss incident (#34445) · 7 ✅ `format:{type:"json_schema"}` explicitly modeled on
the Claude Agent SDK (PR #8161) · 8 ◐ — GitHub Copilot auth is genuinely first-party
(official partnership 2026-01-16); Claude Max and ChatGPT Plus are
**community-plugin reverse-engineered OAuth whose own READMEs disclaim
commercial/multi-user use** — exactly our shape.

Health: extremely high velocity, real churn (storage rewrite, v2 beta in flight,
Anthropic OAuth removed-then-plugin-restored). Independent commercial entity.

### Goose (Block → Linux Foundation 2026-04; Apache-2.0; Rust; ~51K stars)

1 ◐ — no native read/grep/glob (shells out; #10298), **no directory-sandbox primitive**
(symlink-escape patched ad hoc, PR #10545) · 2 ✅ (.goosehints/AGENTS.md walk-up+down,
reads `.claude/skills/` directly) · 3 ✅ code-verified append vs replace at the core and
ACP wire · 4 ◐ — 11-event hook spec but **all hooks are external subprocesses, fail-open
on error/timeout** · 5 ◐ — real TS SDK over ACP, image push code-verified, resume across
restart works (SQLite replay), but caller-chosen session ids unsupported and interrupt
has invalid-state bugs · 6 ◐ SQLite · 7 ✅ recipe-scoped json_schema (crash-bug fixed
2026-07-17 — very fresh) · 8 ◐, **structurally significant**: no native Anthropic or
OpenAI subscription OAuth — Claude Max / ChatGPT Plus work **only by shelling out to the
vendor's own authenticated CLI** (maintainer-confirmed, #6654); a Gemini-OAuth-reuse
integration was removed as a ToS violation (PR #9309).

Decisive: keeping Claude-subscription economics under Goose means wrapping Claude Code,
not replacing it.

### Gemini CLI (Google; Apache-2.0)

Best OS-level sandbox of any candidate (Seatbelt/Docker/gVisor); GEMINI.md walk-up;
but: system prompt is full-replace only; hooks shell-only (AfterAgent reported never
firing, #27712); the intended public SDK **is not published to npm** (404 verified);
structured output **closed not-planned** (#13388); Gemini-only models (multi-provider
closed unaccepted #23385); headless quota fallback worse than interactive (#26840); and
**a documented account suspension for exactly our pattern** — headless, cron-driven,
custom system prompt (#20813) — with Google's appeal guidance directing automated use to
API keys. Weakest candidate for us despite the sandbox.

### Codex CLI (OpenAI; Apache-2.0)

1 ✅ (sandbox_mode tiers, extra writable roots, domain allowlists) · 2 ✅ (AGENTS.md
walk, overrides, **Skills on the open agent-skills standard — Claude-interoperable**) ·
3 ✅ genuine append (`developer_instructions`) distinct from full replace · 4 ◐ — real
10-event lifecycle hooks that can block/modify, but feature-flagged and **shell-only** ·
5 ✅ **strongest of all**: published `@openai/codex-sdk`, `runStreamed()`, image input
per turn (`local_image`), `resumeThread(threadId)` across restarts; **create-with-id
explicitly refused** (#17782, "unlikely to add") — host-side id mapping required · 6 ✅
rollout JSONL under `~/.codex/sessions/` · 7 ✅ with a caveat: `--output-schema`
reported silently ignored when tools/MCP are active (#15451, closed without clear fix)
— must re-verify empirically · 8 **best subscription story**: ChatGPT
Plus/Pro/Team/Enterprise OAuth works headless (device-code beta), no suspension case
found for this pattern; also the only CLI-native tool with real model-agnosticism
(`[model_providers]` against any Responses-shaped endpoint, Ollama/LM Studio built in).

Health: ~100K stars, weekly+ cadence, published Experimental→Stable maturity tiers,
closed contribution model; one sandbox-bypass CVE (patched).

### Cline (Apache-2.0) — headless since 2026-05-13

The dark horse: **genuine in-process TS hooks** (source-verified `AgentPlugin.hooks`,
15 stages), session resume by id with atomic persistence, `abort(sessionId)`, and
**both Claude Max and ChatGPT Plus OAuth confirmed working** (source-verified
`openai-codex` provider). But the SDK is a ground-up rewrite ~2 months old — real
stability risk — structured output is NDJSON events rather than schema-constrained, no
documented cwd+allowed-dirs sandbox primitive, and Copilot auth is IDE-only.

### Amp (closed-source core)

In-process TS plugins (good), but: no local transcripts (threads live server-side), no
programmatic interrupt, BYOK removed for individuals, explicit "no backcompat" posture
with a history of removed features. Highest breaking-change risk surveyed. Not viable.

### Crush (Charm; FSL-1.1-MIT)

Strong session-id story (SQLite, `--session <id>`, `--continue`) but **no image input
in headless `crush run`**, hooks shell-only single-event, no system-prompt control,
server mode under Go `internal/` (unimportable), no Claude/ChatGPT subscription OAuth.
License restricts competing products (internal use fine). Not viable as primary.

### Scouted, not scored

Qwen Code (Gemini-CLI-descended, multi-language SDKs, ACP daemon — follow up if
front-runners fail); **ACP** (Agent Client Protocol, Zed+Google, 40+ agents including a
Claude Code beta — a possible standardize-on-protocol strategy, but remote transport is
explicitly WIP; editor-embedding-shaped today); Continue.dev CLI (headless real,
hooks/structured-output unconfirmed); Aider (Python `Coder` importable but explicitly
unsupported).

## Ranking and irreducible gaps

Ranked as drop-in Claude Code replacements: **1. Codex CLI** (strongest SDK + safest
subscription story; gaps: no create-with-id, shell-only hooks, output-schema-under-tools
unverified) · **2. OpenCode** (best hooks + structured output; subscription auth is
ToS-exposed community plugins; churny) · **3. Cline** (right capabilities, too young) ·
**4. Goose** (subscription economics require wrapping Claude Code anyway) ·
**5. Gemini CLI** (suspension precedent for our exact pattern) · **6. Amp/Crush**
(disqualifying gaps).

Gaps only vendors can close:
- **In-process hooks** exist only in OpenCode, Cline, Amp. Codex/Gemini/Goose are
  shell-subprocess only (Goose's fail open).
- **First-party ToS-clean subscription auth + stable vendor-owned SDK** exists nowhere
  simultaneously.
- **Caller-specified session ids** are explicitly refused by Codex and OpenCode — any
  port carries a host-side id-mapping layer permanently (this hits our
  create-with-id chat-session design directly; see coupling audit Layer 1/2).
- **Structured output that survives tool use** is unverified (Codex) or declined
  (Gemini) — empirical test required before any commitment.

Bottom line: no clean drop-in exists. Codex CLI is the closest match and carries the
one subscription story ("bring your ChatGPT plan") that no drop-in provider can offer;
adopting it means giving up in-process hooks, mapping session ids ourselves, and
re-verifying structured output under tools.

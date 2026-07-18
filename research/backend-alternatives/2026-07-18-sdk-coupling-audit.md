# How coupled is callback-box to the Claude Agent SDK? (code audit)

*2026-07-18. Part of the deeper backend-alternatives investigation (supersedes the
architecture framing in the first-pass [README](README.md)). This is a code-reading
audit with file:line evidence; the market/empirical research lives in the companion
synthesis doc.*

## Verdict up front

The first pass corrected itself from "we'd be replacing our own loop" to "the loop is
external — swapping it is a peer engine swap." That correction is right but repeats the
same category error one level down: **what callback-box delegates to
`@anthropic-ai/claude-agent-sdk` is not a loop, it's a runtime.** The SDK spawns the
bundled Claude Code binary, and the product leans on Claude Code's *harness* — built-in
tools, context-file loading, hooks, session store, transcripts, auth — not just its
agentic loop.

Consequences, stated as the two integration shapes the boxholder cares about:

- **Shape A — a different model provider UNDER Claude Code** (Anthropic-compatible
  endpoint, `ANTHROPIC_BASE_URL`): touches almost nothing below. All four coupling
  layers stay intact; only the model server changes. This is categorically cheaper
  than anything else and is the realistic near-term "choose your provider" lever.
- **Shape B — a different harness with Claude-Code-like functionality** (OpenCode,
  Goose, Codex CLI, …): must replace or re-provide every layer below. The message-
  protocol layers are in better shape than the first pass assumed (adapter boundaries
  mostly exist); the runtime layers are in worse shape (they were invisible to the
  first pass because they don't live in `src/core/agent/` at all).

Swap-cost ranking, most expensive first:
**(4) harness contract > (3) transcript files > (2) chat backend/streaming > (1) batch
agent surface > (5) auth UX** — details below.

## Layer 1 — batch agent surface: narrow, genuinely swappable

`src/core/agent/` is ~1,250 lines total. The public `Agent` interface
(`src/core/agent/types.ts:100`) is backend-neutral: `invoke`/`invokeStructured`, a
session id, text out, `AgentResult` in. The SDK is touched in exactly three files:

- `run.ts` — builds `query()` options (`buildQueryOptions`, `run.ts:63`), translates
  the terminal result message (`buildAgentResult`, `run.ts:104`).
- `stream.ts` — consumes the `SDKMessage` stream, captures session id + result,
  handles the CLI-won't-exit disposal dance (`stream.ts:86`).
- `render.ts` — pretty-prints `SDKMessage`s for logs (`render.ts`).

All callers go through the interface: reactor batch/chat jobs
(`src/core/reactor/batch-jobs.ts:51`, `chat-jobs.ts:58`), triage
(`src/core/triage/index.ts:147`), retro observer (`src/core/retro/observer.ts:68`),
scenario runner (`src/scenario/runner.ts:115`), knowledge audits
(`src/dev/lib/test-runner.ts:122`), and the procedure engine takes an agent *factory*
(`src/core/procedure/engine-types.ts:84`). Fakes already substitute for the whole
surface in tests.

SDK-specific residue a second implementation must map: create-with-id vs resume
session semantics (`index.ts:75` doc comment), structured output via
`outputFormat: {type: "json_schema"}` (`run.ts:81`), `maxBudgetUsd`, and cost/usage
attribution (`total_cost_usd` feeding `src/core/usage.ts` via the session manifest).

**Cost to add a second engine here: days, not months** — assuming the engine can
provide the Layer-4 runtime at all.

## Layer 2 — chat backend: the port exists but leaks SDK types

There is already a `ChatBackend` port with real + fake implementations
(`src/services/claude-chat-types.ts:68`, `claude-chat.ts:147`,
`claude-chat-fake.ts`), and already a stable wire protocol — the `ChatMessage`
union (`src/core/chat/message-types.ts:79`) with an explicit adapter
(`adaptSdkMessage`, `src/core/chat/session/messages.ts:189`) and an
unknown-message tolerance sentinel.

The leak: the port's stream is typed as the SDK's own message type —
`ChatBackendRun.messages: AsyncIterable<SDKMessage>`
(`claude-chat-types.ts:56`) — so `SDKMessage` flows through the interface into the
session layer (`chat/session/consume.ts:11`, `messages.ts`, `thread.ts`,
`options.ts`) and the adapter runs *above* the port instead of *inside* it. Raw
Anthropic stream deltas (`BetaRawMessageStreamEvent`) travel unparsed to the
frontend, which narrows them itself (`src/frontend/src/machines/chat-actors.ts`);
assistant/user content blocks are forwarded as the SDK's superset shape with a
justified cast (`messages.ts:225`).

Also SDK-specific on this layer:

- **Warm pool** — `startup()`/`WarmQuery` prespawn (`claude-chat.ts:158`): a Claude
  Code-specific latency optimization; another engine has its own or none.
- **Interrupt** (`claude-chat-types.ts:58`), **bidirectional push of user content
  including images mid-session** (`send()`, `claude-chat.ts:195`;
  `toSdkUserContent`, `claude-chat-content.ts`).
- **Task lifecycle messages** (`task_started`/`task_progress`/…) normalized for the
  UI (`messages.ts:138`) — an SDK-0.3.x-specific feature the UI renders.
- The `cb chat screenshot` session-id file plumbing
  (`chat/session/session-id-file.ts`) presumes the subprocess model.

**Portability refactor that would make this a real port:** move `adaptSdkMessage`
inside the backend so `ChatBackend` speaks `ChatMessage` (and a normalized delta
event instead of raw `BetaRawMessageStreamEvent`). Mechanical; the wire types and
tolerance machinery already exist. Until then the pluggability is nominal.

## Layer 3 — transcript files: we read Claude Code's private on-disk store

A subsystem the first pass missed entirely. Chat history, session listing, backfill,
tail computation, and self-note parsing read Claude Code's JSONL transcripts
directly from `~/.claude/projects/<encoded-cwd>/<session-id>.jsonl`:

- Path encoding + listing: `src/core/chat/session/transcript-paths.ts:6`
- History load/backfill/sync: `chat/session/history.ts` (381 lines),
  `backfill.ts`, `transcript-sync.ts`, `load-history.ts`
- CLI/web session parsing: `src/cli/lib/session.ts:5` plus `session-entry.ts`,
  `session-content.ts`, `session-text.ts` (compaction summaries, plumbing-message
  filtering, tool-call summarization)

Session *resume* is likewise Claude-Code-side state — we store only ids
(`.callback-box/chat-sessions.json`, reactor chat jobs) and trust the engine to
reconstruct context.

A different harness has a different transcript store (or an API instead of files),
and possibly different resume semantics. Under Shape B this whole subsystem is
reimplemented against the new engine — or replaced by logging our own `ChatMessage`
stream durably, which would *reduce* coupling for every backend including the
current one. Several hundred lines either way, plus migration of existing history.

## Layer 4 — the harness contract: the deepest coupling, invisible from src/core/agent/

callback-box defines **zero tools**. No MCP servers, no custom tool definitions
anywhere in `src/` (verified by grep: no `mcpServers`/`createSdkMcpServer`/
`allowedTools` outside docs). The product works because Claude Code ships a runtime:

- **Built-in tools** — Read/Write/Edit/Bash/Grep operating on the box directory;
  the agent drives the `cb` CLI through Bash. The box's whole prompt surface
  (agent guide, schema `instructions`, rules) is written against these tools'
  semantics.
- **Context auto-loading** — `settingSources: ["user","project"]` default loads the
  box's CLAUDE.md walk-up, `.claude/rules/`, skills/slash commands
  (`run.ts:88` comment). Box context engineering (the `cb-context` discipline)
  presumes these conventions.
- **System prompt** — `{type: "preset", preset: "claude_code", append}`
  (`run.ts:91`, `claude-chat.ts:97`): our prompts are *appends to Claude Code's
  system prompt*, not standalone.
- **In-process hooks** — PreToolUse git-mv nudge + PostToolUse card validator
  (`src/core/sdk-hooks.ts`, wired at `run.ts:87` and `claude-chat.ts:116`):
  card/markdown/view lint feedback injected into the agent mid-session. Any
  replacement harness needs an equivalent callback-style hook system (not just
  shell hooks) or we lose live validation.
- **Sandboxing** — `cwd` + `additionalDirectories` scoping, `permissionMode:
  "bypassPermissions"`.
- **Structured output**, session create-with-id/resume/fork — engine features, not
  API features.

This is where "the SDK is just one of our services" fails: a bare LLM API (even a
perfectly Anthropic-shaped one) provides *none* of this. Only a full harness
(OpenCode, Goose, Codex CLI, …) is even a candidate for Shape B, and each must be
scored point-by-point against this contract — that rubric is what the engine
research uses.

## Layer 5 — auth and product surface

- `buildScriptEnv` strips `ANTHROPIC_API_KEY` to force subscription auth
  (`run.ts:189` comment); preflight shells to `claude auth status`
  (`src/core/agent/auth-preflight.ts`).
- The login/logout OAuth flow is a first-class service surfaced in our UI
  (`src/services/claude-cli.ts` — spawns `claude auth login`, scrapes the OAuth
  URL).
- Usage attribution: session manifest + `total_cost_usd` (`src/core/usage.ts`).

A backend swap changes onboarding ("sign in with …"), billing identity, quota
behavior, and cost reporting. Under Shape A (provider under Claude Code) this
*mostly* survives — auth becomes an env var/base-URL config instead of or alongside
`claude login`. Under Shape B it's a per-harness rebuild.

## What "pluggable" would concretely mean here

Traced to the layers, cheapest first:

1. **Provider config under the existing SDK (Shape A):** a per-box (or install-time)
   setting mapping to `ANTHROPIC_BASE_URL` + auth token + model ids
   (`src/core/model-ids.ts`). The env plumbing already exists — the prompt logger
   already injects `ANTHROPIC_BASE_URL` (`run.ts:192`). Effort: small; risk lives
   entirely in whether the target endpoint faithfully implements tool use +
   images + thinking + caching (empirical question, researched separately).
2. **Port hygiene (backend-agnostic wins, no swap required):** move
   `adaptSdkMessage` inside `ChatBackend`; define a normalized stream-delta event;
   log our own durable `ChatMessage` transcript instead of parsing
   `~/.claude/projects/` JSONL. Each step reduces Layer 2/3 coupling and is
   justifiable as cleanup even if we never swap.
3. **Second engine implementation (Shape B):** new `Agent` + `ChatBackend`
   implementations against an engine that satisfies the Layer 4 contract, plus
   per-harness context-file/hook/prompt adaptation, history subsystem, and auth UX.
   A project, not a task — only worth it if a harness scores well on the contract
   AND unlocks something Shape A can't (e.g. ChatGPT-subscription users).

## Corrections to the first-pass README's architecture claims

- "OpenCode/Goose are peer engine swaps at the same layer" — **partially right**:
  same *kind* of thing (external engine), but the first pass had no inventory of
  what the engine provides beyond the loop, so it understated Shape B's cost and
  couldn't articulate why Shape A is so much cheaper.
- "The real unexamined question is how coupled `src/core/agent/` is to the SDK's
  interface" — **wrong locus**: `src/core/agent/` is the *most* swappable part.
  The load-bearing couplings are the harness contract (Layer 4), the transcript
  store (Layer 3), and the chat port leak (Layer 2) — none of which live in
  `src/core/agent/`.

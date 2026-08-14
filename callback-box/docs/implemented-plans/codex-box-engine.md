---
title: "Codex as an optional box engine"
status: implemented
workstream: codex-engine-plan
issues:
  - ../../../issues/closed/decisions/2026-08-13-codex-as-an-alternative-engine.md
  - ../../../issues/closed/exploration/2026-07-18-codex-sdk-second-backend.md
---

# Codex as an optional box engine

When the boxholder disagrees with one vendor's harness direction or output quality, he
wants a box to use another complete native harness, so box chat, wakeups, and procedures
do not depend on Claude Code alone.

Callback Box now supports `claude` and `codex` as box engines. Each harness keeps its
own tools, session state, authentication, and transcript. Callback Box adapts their
supported APIs at its product boundaries. It does not use ACP and does not replace either
harness with a callback-owned agent loop.

The implementation uses Codex app-server JSON-RPC directly. New jobs and chats read
`agentEngine` from `config/box.json`. The default is `claude`. Each chat history row also
stores its engine, so an existing chat always resumes through the harness that created it.
There is no automatic fallback and no live engine switch.

## Stated preferences this plan trades against

- Engineering principle 1, **Types are structure**. Engine values and native protocol
  records are validated at their boundaries.
- Principle 3, **Validate at boundaries and during parsing**. Config, app-server events,
  transcripts, and hook payloads use explicit schemas.
- Principle 4, **Resilient AND never silent**. Missing sessions, validation failures,
  subprocess failures, and unavailable usage are visible failures or warnings.
- Principle 8, **One way to do each thing**. Product chat history goes through
  `loadSessionHistory`; provider adapters own native history access.
- Principle 10, **Testability is architectural**. Pure transcript, config, context, hook,
  and usage adapters have doctests. Real capability probes cover the native runtime.
- Principle 12, **The maintainer is usually an agent**. Canonical editable context is
  shared, while generated provider surfaces state their provenance.
- `callback-box/CLAUDE.md` requires the box reactor, chat, and procedures to use the same
  box contract. The selector is therefore box-wide for new work.
- `callback-box/code-style.md` requires errors with recovery paths to remain visible.
  Codex never falls back silently to Claude.

## What already exists

- `src/core/agent/types.ts` already defines the narrow batch `Agent` contract. The Codex
  implementation satisfies it instead of adding another caller API.
- `src/services/claude-chat-types.ts` already defines a chat backend seam. Codex uses the
  same lifecycle boundary and emits provider-tagged normalized messages.
- `.callback-box/chat-session-history.json` already indexes chats. Its rows now include
  `engine`; a missing value means legacy Claude.
- `src/core/chat/session/load-history.ts` is the bounded product history entry point. It
  dispatches to the Claude JSONL parser or Codex `thread/read`.
- `cb validate --hook` already expresses Callback Box's edit validator. Both plugins and
  the app-server adapter reuse it.
- Box docs and skills are generated from canonical `CLAUDE.md`, `.claude/skills`, and
  `.claude/rules` sources. Codex mirrors reuse that generation pass.

## Prior art (external)

- Codex app-server exposes typed thread and turn lifecycle, `thread/read`, `thread/list`,
  `thread/delete`, images, structured output, sandbox policy, interruption, and token
  events. The implementation uses those supported operations directly.
- Codex plugins package skills and hooks. They are not a general provider adapter and do
  not provide a native equivalent of Claude's path-scoped `.claude/rules` directory.
- Claude Agent SDK loads a local plugin package directly. Claude Code still owns its
  hidden prompt, tools, session store, and native rule discovery.
- Shape A from the July research—changing the model provider beneath Claude Code—does not
  meet this work's goal. It leaves the objected-to harness intact.

## Tracks / scope

### Track 1 — Select the native engine

**What:** Add `agentEngine: "claude" | "codex"` to box config. Use it for new batch jobs
and chats. Store the engine on every new chat history row.

**Why this needs to change:** A test-only injected backend does not provide operational
vendor independence. Resuming an old native session through a different harness is
invalid.

**Direction:** Missing config remains Claude. Invalid values fail config loading. Batch
agents bind their delegate on first invocation. New chats use the current box setting.
Resumed chats use their stored engine regardless of later config changes.

### Track 2 — Drive Codex through app-server

**What:** Own one Codex app-server subprocess per batch turn or active chat backend.

**Why this needs to change:** Codex is another harness, not another model endpoint. Its
native process must continue to own tools, approvals, sandboxing, sessions, and auth.

**Direction:** Use JSON-RPC over stdio with Zod-validated responses and notifications.
Map cwd, writable roots, model, chat images, structured output, resume, interrupt, and
final status into existing Callback Box contracts. Count completed tool items to approximate
`maxTurns`. Report that Codex cannot enforce `maxBudgetUsd`.

### Track 3 — Read native transcripts through supported APIs

**What:** Keep each harness's session and transcript native. Dispatch product history by
the chat's pinned engine.

**Why this needs to change:** Callback Box reads Claude Code's private JSONL. Codex has a
different private rollout format, but its supported `thread/read` API supplies the
durable conversation needed by the product.

**Direction:** Claude keeps the existing bounded parser. Codex calls `thread/read` and
adapts durable user messages, agent messages, and compaction markers to `SessionEntry`.
List, availability, update time, and deletion use `thread/list`, `thread/read`, and
`thread/delete`. Husk titles, the History page, capture/upload duplicate checks,
diarization context, and nightly chat review all use the provider-aware history path.

The adapter intentionally does not reproduce raw Codex tool calls, tool results,
encrypted reasoning, injected context snapshots, or world-state records. Those remain
native runtime diagnostics. Chat rendering and review retain the durable human/agent
dialogue.

### Track 4 — Share context and package harness integration

**What:** Ship separate `callback-box-claude` and `callback-box-codex` plugins. Keep
editable box guidance canonical.

**Why this needs to change:** Plugin schemas and hook payloads are provider-specific.
Copying editable `CLAUDE.md`, `AGENTS.md`, and skills would create drift.

**Direction:** Generate relative `AGENTS.md -> CLAUDE.md` and
`.agents/skills/<name> -> .claude/skills/<name>` symlinks. Expand top-level Claude
`@file` includes into Codex developer instructions because app-server did not load them
reliably. Keep `.claude/rules` canonical and generate Codex rule skills from it.

Rules cannot live only in the plugins. Claude plugins do not expose a native `rules/`
component, and path-scoped rules belong to the box package rather than the installed
harness package. The generated rule skills are therefore the one copied surface. Their
headers name the canonical source, and normal agents do not edit them.

The Claude plugin runs Callback Box validation through native PostToolUse hooks. This
replaces the prior in-process SDK validator for Agent SDK turns, adds subprocess startup
per edit, and changes findings from advisory context to a failed validation hook. The
shared validator retains the special `tricks/scripts/<name>/index.ts` layout rule. The
Codex plugin does the same for ordinary CLI sessions. Current Codex app-server sessions
did not execute installed or project-local hooks, even with hook trust bypassed. The
app-server adapter therefore consumes completed `fileChange` items and runs the same
validator itself. A validation finding makes the turn fail visibly. It does not feed the
finding back into the same model turn.

### Track 5 — Preserve usage accounting

**What:** Persist Codex's final per-turn token event in
`store/usage/codex-turns.jsonl` and import it into the existing usage database.

**Why this needs to change:** Codex `thread/read` omits token events. Reading its private
rollout would recreate the private-transcript coupling this design avoids.

**Direction:** Record input, cached input, cache-write input, output, reasoning output,
model, task, native thread, and turn identity after completion. Usage sync aggregates
the callback-owned ledger alongside Claude sessions. Codex does not report a USD cost,
so no fake dollar value is stored.

## Could this be simpler?

A batch-only Codex engine would reuse the narrow `Agent` interface and avoid all chat
history work. It would leave web chat and chat work handled by `cb wakeup` dependent on
Claude Code, which does not satisfy the job.

ACP would provide one protocol but reduce both harnesses to its shared surface. This
implementation instead keeps small provider adapters against the richest supported
native APIs. OpenCode or Pi can later become another engine adapter; neither is the
adapter architecture itself.

## Failure modes

| What can fail | Handling and evidence | Clear-or-silent? |
|---|---|---|
| Unknown `agentEngine` | Config doctest rejects it and names allowed values. | Clear |
| Codex executable, login, or quota unavailable | App-server startup/turn error becomes a failed job or chat turn. No fallback. | Clear |
| App-server response shape changes | Zod rejects required records; unknown server requests receive JSON-RPC method-not-found and are logged. | Clear |
| Native session is missing | Availability maps Codex's current native missing-thread errors to unavailable; other RPC failures remain visible errors. | Clear |
| Sandbox escapes configured roots | Real negative probe denied an outside write. | Clear |
| Interrupt leaves work running | Real probe interrupted a delayed write; the file was not created. | Clear |
| Codex plugin is missing or stale | Runtime installs or repoints the shipped local plugin version before use. | Clear |
| App-server omits hooks | Wrapper validates completed `fileChange` paths and fails the turn on findings. | Clear |
| Context include escapes the package | Resolver rejects absolute and parent-escaping includes. | Clear |
| Transcript contains provider-private details only | Product adapter ignores them deliberately; native diagnostics retain them. | Declared loss |
| Token usage event is missing | Batch output warns; no zero-valued record is fabricated. | Clear |
| USD cost or exact dollar budget is requested | Cost stays unavailable; batch warns that only host-side tool counting applies. | Clear |
| Codex usage ledger has a partial final line | Sync skips the malformed line and retains earlier durable turns. | Clear |

## Agent-flow / user-flow edge cases

- **Wrong tag / wrong field — ADDRESSED.** Both engines run the same Callback Box
  validator. App-server validation occurs after the turn and fails it visibly.
- **Stale ref — ADDRESSED.** Both engines use the same box CLI and validators.
- **Two agents touching one card — UNCHANGED.** Existing git and card coordination owns
  this problem; engine selection adds no new writer.
- **Hand-edit drift — ADDRESSED.** Editable context has one canonical file through
  symlinks. Generated rules name their source.
- **Fabricated free-form value — DEFERRED.** A second harness changes output quality but
  does not add a truthfulness mechanism.
- **Validation error UX — DEGRADED ON APP-SERVER.** The result is visible to the
  boxholder, but Codex cannot self-correct within that completed turn because hooks did
  not run in the probed app-server path.
- **Partial transition — ADDRESSED.** Missing history engine means Claude. Existing
  chats remain pinned while new work follows current config.

## NOT in scope

- Model-provider substitution beneath Claude Code. It leaves the harness intact.
- Automatic routing, load balancing, failover, or mid-chat engine conversion.
- A callback-owned loop, filesystem tools, or normalized replacement transcript.
- Parsing Codex's private rollout files.
- Hosted brokerage of consumer ChatGPT credentials. The first scope is a local,
  single-user installation.
- Bit-for-bit event parity. Provider-only activity and diagnostics stay below the
  product boundary.
- Claude-oriented diagnostic commands such as `cb session --raw` and `cb feedback`.
  Product chat history and review support Codex, but these commands still inspect Claude
  Code JSONL and cannot show a Codex native rollout.

## Open design questions

- Should a future app-server validation failure start a synthetic repair turn? The
  current implementation fails visibly and avoids adding hidden user messages or
  spending an unbounded second turn.
- Should the product display Codex token counts in the live chat result? They are
  retained in usage reporting now, but the current chat result UI only has optional USD
  cost.
- Should generated Codex rule skills eventually come from a provider-neutral rule
  source? The current Claude files are canonical because no rule has needed
  engine-specific tuning.
- Which non-sensitive corpus should compare Claude and Codex quality, latency, and
  consumption? Running private prompts through both vendors still requires explicit
  boxholder approval.

## Knowledge audits

Context behavior received direct runtime probes rather than a token-spending paired
knowledge-audit corpus. A temporary box used a Claude-style briefing-file include that
contained a nonce. Codex returned the nonce without file tools after Callback Box
expanded the include into developer instructions. The generated symlink and rule-skill
surfaces also have filesystem doctests.

A future paired audit should ask both engines to identify the box root, applicable card
rules, validation command, and allowed external roots. It should use a non-sensitive
test box.

## Implementation order

1. Probe app-server session, resume, image, structured output, sandbox, interrupt, hooks,
   token events, and supported transcript fidelity.
2. Add validated box selection and the Codex batch adapter.
3. Add engine-pinned chat and supported native history operations.
4. Add both harness plugins, context symlinks, generated rule skills, direct include
   expansion, and wrapper validation fallback.
5. Route secondary chat consumers and nightly review through provider history.
6. Persist Codex token usage and import it into usage reporting.
7. Run focused tests, the complete suite, cross-model review, and `/finish`.

## Rollout shape

- Existing boxes remain on Claude until `config/box.json` explicitly selects Codex.
- Existing chats remain Claude-owned. Changing the box default affects only new chats
  and new batch work.
- The isolated test box is the runtime rehearsal target. Real capability probes have
  already verified resume after process restart, local images, structured output with
  tools, sandbox denial, interruption, transcript read/list/delete, context expansion,
  and token persistence.
- Rollback changes `agentEngine` back to `claude`. Codex chats remain available through
  their pinned history rows.
- No approved cross-vendor quality corpus has run. Functional probes used synthetic
  prompts and test assets.

## Stuff you should know

- This became a medium adapter project, not a reimplementation of an agent runtime. The
  app-server and Agent SDK preserve the two native harnesses.
- The transcript is lossy by design. Codex history keeps user/assistant dialogue and
  compaction markers, but Callback Box does not display raw Codex tool results,
  reasoning, injected context, or world state after the turn.
- Live Codex chat updates are coarser than Claude's current SDK stream. Final assistant
  messages, result state, interruption, and durability work; provider-specific tool
  progress is not normalized into the existing Claude-oriented UI.
- Validation is safety-equivalent but not interaction-equivalent in app-server. A bad
  edit fails after the turn instead of becoming same-turn hook feedback to Codex.
- `maxTurns` is an approximation based on completed tool items. `maxBudgetUsd` has no
  Codex equivalent. Token usage is recorded; USD cost is unavailable.
- Rules are not wholly plugin-owned. Editable docs and skills use symlinks. Claude rules
  remain canonical and generate Codex rule skills because neither plugin format gives a
  sound shared path-scoped rule store.
- The first supported deployment assumes the machine already has a working local Codex
  login. Callback Box does not copy or broker credentials.
- Codex transcript reads share one serialized app-server per box and close it after an
  idle window. This avoids one subprocess per chat row. A dead chat app-server rejects
  the active turn, and every chat turn has a bounded completion timeout.

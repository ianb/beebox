---
title: "Codex as an optional box engine"
status: draft
workstream: codex-engine-plan
issues:
  - ../../../issues/decisions/2026-08-13-codex-as-an-alternative-engine.md
  - ../../../issues/exploration/2026-07-18-codex-sdk-second-backend.md
---

# Codex as an optional box engine

This plan adds Codex as a complete, optional runtime for agents that operate inside a
box. It removes Claude Code from callback-box's durable chat and usage records, while
keeping Claude Code as the default engine and preserving existing boxes.

The goal is independence from Anthropic's harness decisions and output quality. A
different model provider under Claude Code does not meet that goal. That cheaper option
keeps the Claude Code harness, system prompt, tools, context loading, hooks, session
store, and transcript format.

## Stated preferences this plan trades against

- Engineering principle 1, **Types are structure**. The engine and transcript variants
  must be discriminated unions. A Claude session ID must not be accepted where a Codex
  thread ID is required.
- Principle 2, **Exhaustiveness is enforced**. Adding an engine must make every engine
  dispatch fail to compile until it handles the new variant.
- Principle 3, **Validate at boundaries and during parsing**. Engine config, SDK events,
  hook output, and transcript records are external or on-disk inputs.
- Principle 4, **Resilient AND never silent**. Missing auth, quota exhaustion, transcript
  write failure, and reduced engine capability must be visible.
- Principle 8, **One way to do each thing**. Chat history and usage reporting must read
  callback-box records through one interface, not one private store per vendor.
- Principle 9, **Formal structure for essential complexity**. Session identity,
  transcript ownership, and capability differences need named protocols.
- Principle 10, **Testability is architectural**. Both engines need contract fakes and
  fixtures at the runtime boundary.
- Principle 12, **The maintainer is usually an agent**. Engine-specific behavior must be
  explicit in types and generated context, not remembered by a future session.
- `callback-box/CLAUDE.md:97`: *"The reactor (`src/core/reactor/DESIGN.md`) is the
  engine: find jobs → agent processing (batch or per-thread chat) → `cb finalize`
  flushes outbound."* The plan changes this runtime boundary, not the development
  worktree tooling.
- `callback-box/CLAUDE.md:107`: *"Read before writing. Don't guess file formats, XML
  structures, or API shapes."* Implementation starts with executable contract probes
  against pinned Claude and Codex versions.
- `callback-box/CLAUDE.md:118`: *"Leave the repo clean when committing."* Each track has
  a narrow commit boundary and verification step.
- `callback-box/code-style.md:29-30`: *"If there's an error boundary with recovery,
  ALWAYS log the error somewhere"* and *"Never silently ignore errors."* Engine fallback
  is never automatic or silent.

## What already exists

- The batch port is already narrow. `callback-box/src/core/agent/types.ts:100-118`
  defines `Agent` as `invoke`, `invokeStructured`, and a session ID. The Codex adapter
  reuses this interface. It does not add a second caller API.
- Batch callers already accept factories. `callback-box/src/core/procedure/engine-types.ts:84-97`
  says *"Agent factory type — matches createAgent() signature"* and exposes
  `createAgent?: AgentFactory`. `callback-box/src/core/reactor/engine.ts:59-60` likewise
  exposes an agent factory for the reactor. The plan lifts this existing test seam into
  a production engine registry.
- Chat has a nominal port. `callback-box/src/services/claude-chat-types.ts:77-85`
  defines `ChatBackend`, but line 65 exposes `AsyncIterable<SDKMessage>`. The plan moves
  vendor adaptation below this interface rather than creating another chat stack.
- A stable application wire type exists. The July coupling audit identifies
  `src/core/chat/message-types.ts` and `adaptSdkMessage` as the existing normalization
  point. The plan reuses the adapter location, but not the current type unchanged.
  `ChatMessage` still contains a bare native session ID, required Claude cost, raw
  Anthropic stream events, and Claude task events. Track 1 replaces those fields before
  the type becomes a backend or transcript contract.
- Claude session ownership is private-store coupling. `callback-box/src/core/chat/session/transcript-paths.ts:1-12`
  says the helpers are for *"Claude Code session logs"* at
  `~/.claude/projects/<encoded-cwd>/<session-id>.jsonl`. The plan does not teach this
  module Codex paths. It replaces it with a callback-owned transcript store and retains
  the Claude reader only for migration.
- Session history already has a callback-owned index.
  `callback-box/src/core/chat/session/history.ts:6-20` documents
  `.callback-box/chat-session-history.json` and the most-active pointer. The plan evolves
  each entry with an engine-qualified runtime identity.
- Usage is derived from the same private transcript. `callback-box/src/core/usage.ts:4-9`
  says `syncUsage()` combines a callback manifest with Claude Code JSONL. The new
  transcript envelope records normalized usage at write time and keeps `usage.db`
  rebuildable.
- The Claude runtime contract is explicit in one place.
  `callback-box/src/core/agent/run.ts:69-97` configures cwd, permissions, session
  create/resume, structured output, extra directories, validation hooks, project
  settings, and a Claude Code system-prompt append. The new runtime interface covers
  these capabilities instead of pretending they are generic SDK options.
- Existing related research remains the baseline:
  `research/backend-alternatives/2026-07-18-sdk-coupling-audit.md` inventories five
  layers, and `research/backend-alternatives/2026-07-18-alt-harnesses.md` scores Codex
  against the harness contract. This plan updates that work. It does not repeat the
  market survey.

## Prior art (external)

- The current [Codex SDK documentation](https://learn.chatgpt.com/docs/codex-sdk)
  documents TypeScript and stable Python clients that start, continue, and resume local
  threads. The July research only treated the TypeScript subprocess SDK as the main
  embedding surface.
- The current [Codex app-server documentation](https://learn.chatgpt.com/docs/codex-app-server)
  exposes thread and turn lifecycle over JSON-RPC. It is a better long-term adapter
  boundary than parsing CLI stdout, but callback-box must pin and probe the protocol
  features it uses.
- The current [Codex non-interactive documentation](https://learn.chatgpt.com/docs/non-interactive-mode)
  documents JSONL events, structured output, image input, saved-auth reuse, explicit
  resume by session ID, and token usage on completed turns. These are positive evidence
  for the batch contract, not proof of chat parity.
- The current [Codex hooks documentation](https://learn.chatgpt.com/docs/hooks) lists
  lifecycle hooks including PreToolUse, PostToolUse, compaction, session, prompt, and
  stop events. Command hooks can block and add context. They remain subprocess hooks,
  so callback-box must expose its validator as a quiet command and test the exact
  feedback path.
- The current [Codex AGENTS.md documentation](https://learn.chatgpt.com/docs/agents-md)
  defines walk-up project instruction loading. callback-box cannot assume its existing
  `CLAUDE.md`, `.claude/rules`, and Claude-specific skill layout load unchanged.
- OpenAI documents ChatGPT login for Codex across its official surfaces in
  [Using Codex with your ChatGPT plan](https://help.openai.com/en/articles/11369540-using-codex-with-your-chatgpt-plan).
  It still does not state that a third-party commercial product may redistribute or
  broker a consumer account. The plan therefore supports local, single-user saved
  login only and requires a policy review before any multi-user or hosted use.
- Anthropic's current [Agent SDK subscription article](https://support.claude.com/en/articles/15036540-use-the-claude-agent-sdk-with-your-claude-plan)
  still says the June credit-pool split is paused. That watchlist item has not fired.
  This reduces urgency but does not answer the new harness-quality motivation.
- OpenAI now uses token-based Codex credit accounting and publishes a live
  [Codex rate card](https://help.openai.com/en/articles/20001106-codex-rate-card).
  Static message-count estimates from July are obsolete. The implementation must
  measure representative box workloads against the boxholder's actual plan.

## Tracks / scope

### Track 1 — Lock the runtime and capability contract

**What:** Replace the Claude-named construction points with an `AgentRuntime` registry.
The registry supplies the existing `Agent` and a normalized `ChatBackend`. It also
declares capabilities that callers genuinely branch on.

**Why this needs to change:** The existing `Agent` interface is close to portable, but
its comments and implementation assume Claude session semantics. The chat interface
leaks `SDKMessage`, Claude auth, and warm-query concepts. A second implementation without
an explicit contract would spread engine checks through the product.

**Direction:** Introduce these shapes in a leaf module:

```ts
type AgentEngine = "claude" | "codex";

type RuntimeSessionRef =
  | { engine: "claude"; id: string }
  | { engine: "codex"; id: string };

interface AgentRuntime {
  readonly engine: AgentEngine;
  readonly capabilities: {
    interactiveChat: boolean;
    images: boolean;
    structuredOutput: boolean;
    liveValidation: boolean;
  };
  createAgent(options: AgentCreateOptions): Agent;
  createChatBackend(): ChatBackend;
  authStatus(): Promise<RuntimeAuthStatus>;
}
```

Change `Agent.sessionId` and result session identity to `RuntimeSessionRef`. Refactor
`ChatMessage` into an application-owned union first: qualify session identity, represent
missing cost as an explicit unavailable variant, replace raw Anthropic deltas, and map
Claude task events to the small lifecycle set the UI uses. Move `adaptSdkMessage` into
the Claude backend only after that type change. Make `ChatBackendRun.messages` yield the
new union plus a small normalized delta union. Rename `requiresClaudeAuth` to an
engine-neutral auth preflight result. Keep prewarm optional; it is an optimization, not
a capability requirement.

Engine selection is static per box in `config/box.json`:

```json
{
  "agentEngine": "codex"
}
```

Absent means `claude`. There is no per-turn routing and no automatic fallback. Validate
this field at config load. An unavailable selected engine fails the operation with a
specific auth, quota, capability, or startup error.

**Vocabulary lock-ins:** Use **engine** for the complete harness. Use **provider** only
for the model server beneath a harness. Use **runtime session reference** for the
engine-qualified native resumable identity. Use **chat ID** for callback-box's stable
user-visible identity.

**First implementation chunk:** Add contract tests for Claude behavior, introduce the
discriminated types and registry, move Claude adaptation below the ports, and keep
`claude` as the only registry member. No behavior or default changes in this chunk.

### Track 2 — Own chat identity and transcripts

**What:** Make callback-box the authority for user-visible chat history. Store normalized
events under `.callback-box/chat-transcripts/<chat-id>.jsonl`. Store the runtime session
reference in the chat index, not in the public chat ID.

**Why this needs to change:** Translating Codex rollout JSONL would replace one private
format dependency with two. Reading each harness store also makes history, deletion,
usage, and migration engine-specific. The product already emits the normalized stream
needed for its own record.

**Direction:** Define a versioned, validated envelope:

```ts
type ChatTranscriptRecord = {
  version: 1;
  chatId: string;
  sequence: number;
  recordedAt: string;
  event: ChatMessage | NormalizedChatDelta | RuntimeUsageEvent;
};
```

Append each accepted user event and each normalized backend event before publishing it
to downstream consumers. Use an atomic per-chat append discipline and monotonic sequence
numbers. A transcript append failure stops the turn and reports that persistence failed;
the UI must never show an unrecorded assistant reply as durable history.

Write a `turn-started` record before sending content to the runtime and a `turn-completed`
record only after every normalized event is durable. On startup, an incomplete turn is a
recovery boundary. Never resume that native runtime session, because it may know content
the callback transcript lost. Preserve the visible incomplete-turn marker, create a new
native session, and seed it from a bounded replay or explicit summary of the durable
callback transcript. This is a visible recovery, not silent continuation. It avoids
parsing private runtime logs while preventing hidden context from leaking into later
replies.

Extend the history entry to `{ id: chatId, runtime: RuntimeSessionRef, contextDir?,
features? }`. Existing Claude entries migrate lazily: keep their current chat ID, qualify
their ID as a Claude runtime session, read the old Claude transcript once, normalize it
into the callback store, then mark the entry migrated. Preserve the old JSONL until the
new transcript validates and a backup retention window expires. New turns read only the
callback transcript for display and use the runtime reference only to ask the selected
engine to resume.

Move session listing, history loading, tail calculation, chat deletion, husk parsing,
self-note parsing, and usage aggregation to the callback transcript interface. Retain a
narrow `ClaudeTranscriptImporter` for old records. Do not add a Codex rollout parser.

Chat transcripts do not cover batch agents. Add a separate append-only
`.callback-box/runtime-usage.jsonl` ledger keyed by runtime session reference, task,
turn, engine, model, and timestamp. Every agent and chat adapter writes normalized token
usage or an explicit unavailable record. Rebuild `usage.db` from this ledger plus chat
metadata. Import historical Claude usage through the existing reader once, then mark the
source range imported. An empty Codex ledger after a completed Codex turn is an invariant
failure, not zero usage.

**Vocabulary lock-ins:** A **transcript** is callback-box's normalized durable record. A
Claude project JSONL or Codex rollout is a **runtime log**. Runtime logs are diagnostic
and resume implementation details, never product history.

**First implementation chunk:** Add transcript schemas, a fixture-backed store, and
round-trip contract tests. Dual-write normalized events for new Claude chats behind a
test-only gate. Compare callback-owned replay with current Claude-history replay before
switching readers.

### Track 3 — Re-provide the harness contract for Codex

**What:** Implement the Codex runtime through the pinned official SDK or app-server. It
must satisfy filesystem tools, context loading, prompt composition, validation feedback,
sandbox scope, images, structured output, interrupt, resume, and usage reporting.

**Why this needs to change:** callback-box defines no filesystem or shell tools. It relies
on the harness. A thin model call or a `codex exec` wrapper that returns final text is not
an engine implementation.

**Direction:** Build and check a capability matrix before the adapter:

| Harness dependency | Codex direction | Allowed degradation |
|---|---|---|
| Read, edit, search, shell | Use Codex built-ins in the box workspace. | Tool names may differ; box outcomes may not. |
| Cwd and extra roots | Use workspace-write plus explicit writable roots. | None. A landmark session must still reach the box root. |
| Context files | Generate `AGENTS.md` mirrors and Codex skill/rule surfaces from the same canonical box context that generates Claude files. | Engine-specific prose is allowed; missing box rules are not. |
| System prompt | Put callback-box invariants in developer instructions. Do not copy Claude Code's hidden preset. | Wording differs. Behavioral contract does not. |
| Validation hooks | Invoke a quiet callback validator from Codex PostToolUse and return blocking/additional context in Codex's hook schema. | Subprocess latency is accepted. Silent loss of validation is not. |
| Permissions | Select explicit sandbox and approval policy owned by callback-box. | Prompt wording differs. Scope may not widen. |
| Images | Send supported local-image input or a box-contained path verified to reach a vision-capable model. | No text-only fallback for image-bearing turns. |
| Structured output | Use the SDK schema facility and validate again with the caller's Zod schema. | None for callers of `invokeStructured`. |
| Session lifecycle | Store the Codex-assigned thread ID in `RuntimeSessionRef`; resume it by ID. | Caller-minted native IDs are not required because chat IDs are separate. |
| Interrupt | Map chat stop to turn interrupt and confirm terminal state. | Timing may differ; a claimed stop that keeps running is not allowed. |
| Usage and quota | Record normalized token usage from turn events and a typed quota/auth failure. | USD cost may be absent; absence must be visible. |

Pin the Codex runtime version with the callback-box release. Parse every event through a
Zod boundary. Keep raw events out of core and frontend types. Treat unsupported protocol
events as logged diagnostics, while required terminal and persistence events fail loudly.

**Vocabulary lock-ins:** **Parity** means the user-visible outcome and safety property,
not identical tool names or event order. **Degradation** is a declared capability loss
shown before a run. It is not silent fallback to Claude.

**First implementation chunk:** Add a non-mutating executable probe that starts Codex in
a temporary git box and verifies assigned thread ID, resume, image visibility, structured
output with tool use, sandbox denial outside allowed roots, interrupt, hook feedback, and
usage events. Commit the recorded fixture and adapter only after every required probe has
a positive result or the plan is revised.

### Track 4 — Select, authenticate, and operate the engine

**What:** Add per-box selection, engine status, login guidance, quota diagnostics, and
usage comparison. Wire the runtime registry into web chat, reactor chat and batch jobs,
triage, scheduled procedures, review, and other operational box agents.

**Why this needs to change:** A backend that works only when injected by a test or a CLI
flag does not give a boxholder vendor independence. Authentication and quota exhaustion
are part of the runtime contract.

**Direction:** `agentEngine` selects one engine for all box-operational workloads. Startup
and settings report selected engine, auth state, runtime version, model, and capability
status. Claude keeps its current login flow. Codex initially reuses a local single-user
Codex login owned by that installation. Do not copy, expose, or commit `auth.json`.

Before enabling Codex, show its privacy/billing posture and require an explicit boxholder
choice. Record tokens and runtime identity for every turn. Add a report that compares a
representative, boxholder-approved dry-run corpus on Claude and Codex. Report token use,
wall time, task success, validation retries, and any paid credits. Do not send private box
prompts to both engines without explicit approval.

Wire the selected runtime once at process composition. Do not add `if (engine === ...)`
branches to individual jobs. If a selected engine cannot start, fail visibly and leave
jobs pending. Never fall back to the other vendor automatically because that defeats
privacy, cost, and output expectations.

Engine changes are not retroactive session conversions. Refuse to change `agentEngine`
while web-chat or reactor-chat runtime references belong to the other engine unless the
boxholder chooses an explicit reset/fork operation. For web chat, that operation creates
a visibly new chat ID and seeds its first prompt with a bounded replay or explicit
summary; it does not present an amnesiac native session as continuous history. For
`.callback-box/chat-sessions.json`, replace bare IDs with `RuntimeSessionRef`. The reset
operation archives those refs. An unattended `cb wakeup` that finds a mismatched legacy
or engine-qualified ref fails the affected job pending and names the required reset; it
never rotates context silently.

**Vocabulary lock-ins:** **Selected engine** is the one explicit per-box choice.
**Fallback** always means an explicit boxholder configuration change.

**First implementation chunk:** Add validated config and status rendering with `claude`
as the default and only enabled choice. Then enable `codex` only after Tracks 2 and 3 pass
their contract suites.

## Could this be simpler?

The simplest plausible version is Codex only for procedure and reactor batch agents.
That version can use the existing `Agent` factory and avoid chat ports and transcripts.
It is a useful spike, but it is not the planned product:

- `cb wakeup` processes both batch and per-thread chat work. A batch-only engine still
  leaves ordinary wakeups dependent on Claude Code.
- Web chat is the main place where harness output quality and product direction are
  experienced. Leaving it Claude-only does not meet the motivation.
- A batch-only adapter would encourage native string session IDs and raw event parsing
  to escape into core, making the later chat port harder.

The full approach buys one typed engine boundary and one product-owned history for all
box workloads. This follows principles 1, 8, and 9. The implementation may use the
batch surface as its first probe, but no batch-only selector ships.

Shape A is even simpler: change `ANTHROPIC_BASE_URL` and keep Claude Code. It does not
address the goal because the objected-to harness remains in control. It stays outside
this plan.

## Failure modes

There are no accepted critical gaps. A failed durable transcript append is a hard turn
failure, not a silent gap.

| What can fail | Test exists? | Handling exists? | Clear-or-silent? |
|---|---|---|---|
| Config contains an unknown engine | Planned config doctest | Reject at load; name allowed values | Clear |
| Selected engine is not authenticated | Planned runtime contract test | Typed preflight failure; jobs remain pending | Clear |
| Codex is out of quota or credits | Planned fixture + manual quota probe | Typed terminal failure; no fallback | Clear |
| Runtime returns a changed event shape | Planned schema fixture tests | Boundary parse error with engine/version/event type | Clear |
| Transcript append fails after an event arrives | Planned fault-injection doctest | Stop turn; do not publish as durable history | Clear |
| Lazy Claude transcript migration sees malformed or oversized input | Existing parser fixtures plus planned migration cases | Keep old source, report session-specific failure, do not mark migrated | Clear |
| Codex thread is missing during resume | Planned adapter test | Preserve history; offer explicit new-runtime-session recovery | Clear |
| Validation hook fails or times out | Planned hook probe | Block the write path and surface validator failure | Clear |
| Image is accepted by transport but unseen by model | Planned image recognition probe | Capability check fails; image-bearing turn does not start | Clear |
| Structured schema is ignored during tool use | Planned tool-plus-schema probe | Zod validation fails the invocation | Clear |
| Sandbox permits access outside box and allowed roots | Planned negative probe | Codex engine remains disabled for release | Clear |
| Interrupt reports success while work continues | Planned process-state test | Keep session in stopping/error state and kill owned runtime at deadline | Clear |
| Process dies with an incomplete durable turn | Planned crash-window integration test | Never resume the possibly-advanced runtime; visibly fork and seed from durable history | Clear |
| Usage event omits USD cost | Planned fixture | Store tokens and explicit `cost: unavailable` | Clear |
| A completed Codex batch turn has no usage-ledger record | Planned invariant test | Fail usage sync and name the runtime session; never report zero | Clear |
| Two engines write one chat concurrently | Planned lock test | Per-chat lock and engine-qualified active-turn invariant reject the second writer | Clear |
| Engine config changes while old chat refs remain | Planned config/reset doctest | Refuse change until explicit archive/fork reset | Clear |

## Agent-flow / user-flow edge cases

- **Wrong tag / wrong field — ADDRESSED.** Both engines run the same callback validator
  and `cb validate`; Track 3 makes validation feedback a parity requirement.
- **Stale ref — ADDRESSED.** This plan does not change card reference resolution. Both
  engines use the box CLI and current validation rules.
- **Two agents touching the same card — ADDRESSED.** Existing git/card locking remains.
  The failure table adds a per-chat lock for transcript/runtime concurrency.
- **Hand-edit drift — ADDRESSED.** Engine config is validated at load. Transcript files
  are internal state and parsed through a versioned schema.
- **Fabricated free-form value — DEFERRED.** Engine quality is measured with the same
  tasks, but this plan does not introduce a new truthfulness mechanism.
- **Validation error UX — ADDRESSED.** Track 3 requires Codex hook feedback to reach the
  active agent and engine errors to reach the boxholder.
- **Partial migration / transition state — ADDRESSED.** Track 2 uses per-chat lazy
  migration, validates before marking success, and preserves the Claude source.

## NOT in scope

- Model-provider substitution under Claude Code. It does not remove the harness that
  motivates this work.
- Automatic per-task model routing, load balancing, or failover. Static box selection
  keeps privacy, billing, and output provenance understandable.
- Development worktree sessions. `bin/launch-worktree-session --agent codex` and the
  finish flow already cover that separate surface.
- Hosted multi-user brokerage of ChatGPT subscription credentials. Current official
  documentation does not establish that commercial redistribution right.
- A callback-owned agent loop or callback-defined filesystem tool suite. Codex and
  Claude Code remain the harnesses.
- Importing Codex private rollout files. callback-box records its own normalized events.
- Bit-for-bit transcript parity. Vendor reasoning blocks and internal compaction details
  may remain in runtime logs; user messages, assistant messages, tools needed by the UI,
  usage, and lifecycle are durable product data.
- Automatic deletion of old Claude JSONL. Migration preserves it through a documented
  retention period and deletion is a separate explicit cleanup.
- Self-hosted models, OpenRouter, or other harnesses. The typed registry leaves a clear
  extension point, but this plan implements only Claude and Codex.

## Open design questions

- **Which Codex credential tier should the first supported release require?** Lean:
  support a local single-user ChatGPT login for the boxholder's own installation, with
  an API-key path only when official SDK support and privacy requirements are verified.
  This choice must receive a current policy review before implementation ships.
- **What transcript retention window is sufficient before old Claude JSONL can be
  removed?** Lean: never remove automatically in this plan. Measure storage and make any
  later cleanup an explicit maintenance command.
- **Which representative box tasks may be sent to both vendors for quality and cost
  comparison?** The boxholder must choose a non-sensitive corpus or explicitly approve
  the data. Implementation does not infer consent from engine configuration.
- **What performance regression is acceptable for subprocess validation and a second
  durable append?** Lean: correctness gates first; measure p50/p95 turn-start and
  validation latency before choosing a threshold.

These questions do not change the first implementation chunks. They gate enabling the
Codex choice for real boxes and the final rollout.

## Knowledge audits

This plan changes what a box agent loads and how validation reaches it. Add paired
knowledge-audit cases tagged `engine-parity` that ask Claude and Codex agents to identify
the box root, applicable instructions, card-validation workflow, and allowed external
roots. Run the cases against the isolated test box for both engines before rollout.

Do not add an audit for the `agentEngine` setting. The box agent does not need to know
which implementation selected it unless diagnostics explicitly ask; runtime status owns
that fact.

## Implementation order

1. Add the Codex harness probe before changing production types or persistence. Verify
   assigned thread ID, resume, hooks, sandbox, image visibility, structured output with
   tools, interrupt, and usage. If a required capability fails, revise or stop this plan.
2. Add executable Claude contract tests and the engine-neutral types. Move Claude event
   normalization behind the ports. Commit with no behavior change.
3. Add the callback-owned transcript store, incomplete-turn recovery, general runtime
   usage ledger, migration importer, and history/usage readers. Dual-write and compare
   Claude output before switching readers.
4. Implement the Codex `Agent` adapter, hooks, context generation, auth preflight, and
   usage normalization. Pass batch and structured contract tests.
5. Implement the Codex `ChatBackend`, resume mapping, images, interrupt, and transcript
   integration. Pass the shared chat contract suite.
6. Add validated per-box selection, explicit session reset/fork handling, and status
   UI/CLI. Keep Claude as default. Run paired knowledge audits and the approved
   cost/quality corpus.
7. Run the complete suite, migrate a cloned test-box chat history, rehearse explicit
   Claude→Codex→Claude selection, and document recovery. Enable Codex only after all
   tracks pass; ship the plan as one unit.

## Rollout shape

- **Tests first:** Add a runtime-contract doctest for batch, structured output, session
  identity, auth and failures; a chat-backend contract doctest for send/stream/interrupt/
  resume/images; transcript-store and migration doctests; and a process integration test
  for hooks, sandbox, crash windows, and real SDK events.
- **Fixtures:** Record scrubbed Claude and Codex event fixtures with pinned runtime
  versions. Fixtures contain no real box content or credentials.
- **Manual test:** On the isolated box clone, run a new chat, resume it after process
  restart, interrupt a tool turn, send an image, process a batch wakeup, and run a
  scheduled procedure on each engine. Verify callback-owned history and usage after
  deleting or moving the runtime log fixture copy.
- **Cost/quota test:** Run only a boxholder-approved corpus. Record actual token/credit
  consumption and quiet-machine latency separately from functional tests.
- **Migration:** Lazy, per chat, backup-preserving, and idempotent. Existing boxes default
  to Claude. No migration runs merely because the package upgrades.
- **Rollback:** Select an explicit reset/fork to archive active Codex runtime references,
  then change `agentEngine` to `claude`. Callback-owned transcripts remain readable. A
  web chat gets a visibly new chat ID seeded from bounded durable history. Reactor chat
  refs are archived and their pending jobs remain visible until the reset completes.
- **Documentation:** Update box config reference, chat/session design, usage docs,
  authentication guidance, privacy guidance, and operator recovery steps. State which
  runtime version is pinned and how to run the contract probe.

## Stuff you should know

- This is a real second-runtime project, not an SDK swap. The transcript work is the
  center because callback-box currently reads Claude Code's private store for history,
  deletion, summaries, and usage.
- The plan deliberately chooses a full box engine. A Codex-for-procedures-only feature
  would be much cheaper, but chat and mixed `cb wakeup` runs would remain exposed to the
  harness you want independence from.
- The strongest design choice is to own normalized transcripts. You may prefer a smaller
  Codex-format translator. That is less work initially, but it creates two private-format
  dependencies and makes a third engine more expensive.
- Codex may be slower on validation because current hooks execute commands. The plan
  keeps live validation and measures the cost instead of silently dropping it.
- Claude-only details remain: warm-process behavior, raw Claude task events not used by
  the product, and old private runtime logs. User-visible chat, images, resume, stop,
  validation, and usage provenance are not allowed to be Claude-only.
- The Anthropic credit-pool watch item has not fired as of this refresh. The reason to do
  this now is harness/output independence, not a confirmed loss of Anthropic subscription
  access.
- OpenAI's current docs support ChatGPT login in Codex, but they do not clearly grant a
  commercial product the right to broker consumer subscription credentials. The first
  scope is a local, single-user installation. Revisit policy before broader distribution.
- Do not estimate ongoing cost from worker-session experience. Box chat, wakeups, image
  turns, and schedules are a different workload. The rollout requires measured usage on
  an approved corpus before the setting is enabled on a real box.

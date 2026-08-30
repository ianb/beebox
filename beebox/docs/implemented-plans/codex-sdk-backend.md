---
title: "Use the official Codex SDK at the Codex engine boundary"
status: implemented
workstream: codex-engine-plan
issues:
  - ../../../issues/closed/code-quality/2026-08-15-replace-raw-codex-app-server-with-sdk.md
---

# Use the official Codex SDK at the Codex engine boundary

Bee Box should run Codex through `@openai/codex-sdk`, not through its own generic
JSON-RPC client. The SDK still launches and preserves the Codex harness. It gives us
typed, versioned run and streaming contracts while OpenAI owns the transport details.

This is a contained backend migration, not a new agent architecture. The existing
Bee Box `Agent` and `ChatBackend` contracts remain the product boundary. One Codex
adapter maps SDK types into those contracts. Provider checks must not spread into chat,
procedure, wakeup, or UI code.

The migration is mostly non-lossy for running turns. The current SDK has typed events
for commands, file changes, MCP tools, web search, reasoning, todos, errors, final text,
and usage. It supports resume, images from local files, structured output, sandbox
policy, additional directories, and `AbortSignal` cancellation. The remaining hard gap
is transcript administration, which stays in one quarantined compatibility module until
the SDK gains an equivalent surface. There is one known presentation loss: SDK live
events do not expose the app-server's `dynamicToolCall` or `subAgentActivity` item types,
and app-server `thread/read` omits tool items from SDK `exec` sessions. Tool calls remain
visible live, but an SDK chat reloaded from native history currently contains only user
and assistant text.

## Stated preferences this plan trades against

- Keep Claude Code and Codex intact as native harnesses. Do not build a Bee Box
  agent loop.
- Use each vendor's supported API and type information. Do not reduce both engines to
  ACP or another lowest-common-denominator protocol.
- Keep provider differences behind one adapter. Do not add `engine === "codex"`
  conditionals throughout product code.
- Keep box instructions in their current canonical files and plugins. Do not turn
  developer instructions into an apparent human chat message.
- Prefer a supported typed dependency over Bee Box tracking raw protocol updates.
- Engineering principle 1 says, “Types are structure.” The SDK's exported event union
  should replace Bee Box's hand-written loose event schemas
  (`docs/engineering-principles.md:12`).
- Engineering principle 8 says, “One way to do each thing.” Codex live and batch runs
  should share one SDK event adapter rather than parse the same native items twice
  (`docs/engineering-principles.md:95`).
- Engineering principle 4 requires failures to remain visible. An unsupported SDK
  capability must fail a probe or stay behind one named compatibility boundary; it
  must not degrade silently (`docs/engineering-principles.md:49`).

## What already exists

- `src/core/agent/types.ts:100` defines the provider-neutral batch `Agent` interface.
  Its callers do not need a new API.
- `src/services/claude-chat-types.ts:91` defines the provider-neutral `ChatBackend`
  lifecycle. Codex already implements this seam.
- `src/services/codex-chat.ts:243` constructs `CodexAppServer` directly and
  `src/core/agent/codex-run.ts:227` does the same for batch work.
- `src/services/codex-app-server.ts:101` spawns `codex app-server`, and lines 145-249
  implement request correlation, timeouts, notification dispatch, approval replies,
  and unsupported-method replies. This is the transport ownership to remove.
- `src/services/codex-tool-activity.ts:72` is the product-level tool normalization point
  used by live chat and transcript history. Batch runs separately parse and render
  activity through `src/core/agent/codex-run-activity.ts`; the migration should converge
  both live paths on SDK `ThreadItem` inputs while the history adapter retains its legacy
  app-server input mapper.
- `src/core/codex-usage.ts:30` stores one completed Codex turn in Bee Box's usage
  ledger. The SDK's `turn.completed` event supplies typed usage; the runtime probe found
  that version 0.147.0 reports thread-cumulative counters despite the type declaration's
  per-turn wording, so the adapter writes a checked delta.
- `src/core/chat/session/codex-transcript.ts:98` uses app-server `thread/read`; lines
  219-250 and 262-266 use `thread/list` and `thread/delete`. Those operations are not in
  the SDK's current public TypeScript surface.
- `src/services/codex-chat.ts:237-248` installs the Codex plugin, expands box includes,
  and passes the complete value as app-server `developerInstructions`. Preserving that
  role is a migration gate.
- The implemented engine plan deliberately chose app-server because it supplied a
  supported history API. This plan revises only that integration choice; it preserves
  engine selection, plugins, generated context surfaces, model selection, and UI.

## Prior art (external)

OpenAI's [Codex SDK documentation](https://developers.openai.com/codex/sdk) says the
TypeScript library can “start, continue, and resume local Codex threads.” It documents
`runStreamed()` as an async stream of structured tool, file-change, and completion
events. The published `@openai/codex-sdk` 0.147.0 type declarations add typed usage,
structured output, local images, sandbox mode, approval policy, working directory,
additional directories, cancellation, controlled environment variables, and a CLI
binary override.

The SDK wraps the Codex CLI and exchanges JSONL events with it. That is the desired
ownership boundary: OpenAI still runs the complete Codex harness, but OpenAI owns CLI
invocation and protocol parsing. Bee Box maps only the SDK's domain events into its
product types.

The SDK does not expose thread read, list, or delete. It also does not expose an explicit
developer-instructions option in `ThreadOptions`. The official
[configuration reference](https://developers.openai.com/codex/config-reference)
documents `developer_instructions` as additional developer instructions injected into
the session. The SDK's typed `config` object can set that official CLI key, so the
capability is supported even though it is not a named `ThreadOptions` field.

## Tracks / scope

### Track 1 — Establish the SDK capability contract

**What:** Add a focused real-runtime probe for the pinned SDK version before changing
production paths.

**Why this needs to change:** Type declarations prove that a field exists. They do not
prove context role, persistence, restart resume, auth selection, or filesystem behavior.

**Direction:** Pin `@openai/codex-sdk`. Probe fresh and resumed multi-turn threads,
stream event ordering, final response, failure detail, local images, structured output,
usage, cancellation during a command, danger-full-access Git writes, additional
directories, model selection, plugin availability, and controlled subprocess env.

Measure first-turn and resumed-turn startup latency. Unlike the current long-lived
app-server chat process, the SDK launches `codex exec` for each run, so session reload
latency is a real behavior change. Abort a command and immediately send another turn on
the same resumed thread; confirm the session is consistent and the interrupted command
does not outlive the turn.

Establish whether `turn.completed.usage` is per-turn or thread-cumulative before writing
it to the ledger. The 0.147.0 two-turn probe observed cumulative counters. Probe whether
cancellation still yields usage; missing cancellation usage must be recorded as
unavailable rather than reusing prior values. Counter resets and ledger write failures
must warn without changing an otherwise completed turn into a failure.

Probe developer instructions separately. Pass a nonce only through the documented SDK
`config.developer_instructions` path. Confirm that Codex treats it as developer context,
does not render it as a user message, retains it after resume, and still loads the box's
generated `AGENTS.md` and installed plugin. If the public SDK cannot preserve this role,
stop the execution migration and open an upstream SDK request. Do not prepend the system
prompt to user input.

**First implementation chunk:** Add the pinned SDK dependency and a manual capability
probe that records typed events, usage, timing, interruption, resume, context nonce,
plugin access, sandbox behavior, images, and structured output. This chunk changes no
production runner.

### Track 2 — Build one typed Codex SDK adapter

**What:** Replace raw run parsing with one module that owns `Codex`, `Thread`, SDK option
mapping, streamed event mapping, cancellation, and error translation.

**Why this needs to change:** Batch and chat currently know app-server methods and event
names. That duplicates provider knowledge and makes raw protocol changes our problem.

**Direction:** Give the adapter product-shaped inputs and an async stream of normalized
Codex run events. Use exhaustive switches over the SDK's `ThreadEvent` and `ThreadItem`
unions. Keep unknown future SDK events visible during development and tests. The adapter
owns model, cwd, sandbox, approval, additional-directory, environment, and output-schema
mapping. It also materializes URL or base64 chat images into a per-turn temporary
directory because the SDK accepts local image paths. Cleanup happens after the stream
settles.

Use one adapter instance shape for batch and chat. Batch consumes one turn. Chat retains
the SDK `Thread` object and serializes `runStreamed()` calls, while accepting that the SDK
starts a Codex CLI process per turn. Resumed chat constructs the thread through
`resumeThread()`. `AbortController` replaces raw `turn/interrupt` calls.

**First implementation chunk:** Define the injected SDK runner interface and a fake that
can emit complete, failed, and interrupted streams. Add a pure SDK-event adapter doctest
before wiring either production caller.

### Track 3 — Migrate live chat and batch execution

**What:** Make `codex-chat.ts` and `codex-run.ts` thin consumers of the SDK adapter.

**Why this needs to change:** These files currently parse two variants of app-server
items, completion status, token usage, and errors.

**Direction:** Replace the app-server item schemas in `codex-tool-activity.ts` and
`codex-run-activity.ts` with one exhaustive SDK `ThreadItem` mapper for live execution.
Keep the legacy history mapper separate and named for its app-server input vocabulary.
Map SDK item completion into user/assistant frames, activity callbacks, and changed-path
collection. Map verified per-turn `turn.completed.usage` into the existing ledger.
Preserve visible validation warnings and failures after completed file changes.
Preserve the host-side tool-count limit by
counting completed SDK tool items and aborting when the limit is exceeded.

Record duration with a host monotonic clock because the SDK completion event has no
duration. Preserve the current statement that Codex does not expose a per-turn USD
budget. Do not invent turn IDs: the current SDK exposes a thread ID but not a turn ID,
so usage records need a callback-owned invocation ID or a schema migration that makes
native turn ID optional.

**First implementation chunk:** Migrate batch execution behind the existing `Agent`
contract. Keep app-server execution available through an internal rollout switch until
the capability and knowledge-audit comparisons pass.

### Track 4 — Quarantine unsupported transcript operations

**What:** Reduce raw app-server use to one read/admin-only compatibility module for
`thread/read`, `thread/list`, and `thread/delete`.

**Why this needs to change:** The SDK cannot perform these operations, but that gap does
not justify a new durable transcript format and migration in the execution-SDK project.

**Direction:** Rename and narrow the current client so it cannot start threads, run
turns, interrupt, or subscribe to execution notifications. Expose only typed
`readThread`, `listThreads`, and `deleteThread` operations to
`codex-transcript.ts`. Pin and probe those three shapes. The module owns its subprocess,
errors, schemas, serialization, and cwd security check; no other runtime code may import
it. Keep history normalization at read time so newer rendering logic can improve old
sessions. Do not parse or mutate private rollout files.

Revisit this module when the SDK adds supported history APIs. A callback-owned product
transcript remains a separate future design option only if the SDK gap persists and the
maintenance cost becomes material.

**First implementation chunk:** Replace the generic app-server export with a
history-specific service interface and preserve the existing transcript doctests against
that narrower interface.

### Track 5 — Delete raw execution transport

**What:** Remove raw app-server lifecycle, turn, streaming, interruption, approval, and
usage code after all execution consumers move.

**Why this needs to change:** A dormant general JSON-RPC client would become an easy way
to bypass the SDK again.

**Direction:** Add an import-boundary test that permits `@openai/codex-sdk` only inside
the Codex SDK adapter and permits the raw compatibility client only inside Codex
transcript administration. Product code imports Bee Box contracts, not vendor
types. Delete the general `CodexAppServer` API so new callers cannot send arbitrary
methods.

**First implementation chunk:** Add an import-boundary test, then remove execution
methods and schemas once both production runners use the SDK adapter.

## Could this be simpler?

We could replace only batch execution. That would reduce immediate protocol exposure,
but chat would still own raw lifecycle and streaming, which is where most ongoing
provider drift occurs.

We could add a callback-owned product transcript now. That would eliminate the final
three raw operations, but it adds dual writes, an importer, another durable format, and
normalization frozen at write time. This plan instead quarantines the small unsupported
surface and waits for the SDK. We should revisit transcript ownership only with measured
maintenance cost or a clear product reason.

We should not create a universal Claude/Codex SDK facade. Their rich native types should
remain available inside separate provider adapters. The shared contracts should contain
only concepts Bee Box itself needs: run lifecycle, chat messages, tool activity,
usage, validation paths, session identity, and history.

## Subplans

No separate subplan is required. A future product-transcript design is deliberately not
part of this work.

## Failure modes

The known history presentation loss is explicit above. The cutover dependencies below
have focused automated coverage, runtime evidence, or visible handling; rows marked as
future tests are follow-up hardening, not evidence already obtained.

| What can fail | Verification | Handling exists? | Clear-or-silent? |
|---|---|---|---|
| SDK cannot supply developer instructions with the right role | Real nonce and resume probe | Capability probe blocks migration; keep current backend and file an upstream request. | Clear |
| SDK or bundled CLI version changes event shape | Typecheck and focused event-mapper doctests | Pin the dependency and use exhaustive event mapping. | Clear |
| Stream ends without completion | Adapter handling; fake-stream regression test remains useful | Return a failed run with a specific missing-completion error and preserve partial diagnostic activity. | Clear |
| Cancellation races with completion or loses usage | Real cancellation/resume probe | One adapter state machine settles once and records unavailable usage explicitly. | Clear |
| SDK usage semantics change | Real two-turn cumulative-usage probe and delta doctest | Reject a decreasing counter, warn, and never fail completed work over accounting. | Clear |
| Per-turn CLI startup makes chat materially slower | Fresh/resumed timing probe | The measured process cost is accepted as part of using the supported SDK boundary. | Clear |
| Chat image is a URL or base64 block | Materialization implementation; focused cleanup fixture remains useful | Materialize to a per-turn temporary file, pass a local path, then remove it. | Clear |
| Usage lacks native turn ID | Usage doctest | Store a callback invocation ID after an explicit ledger schema change; never fabricate a native ID. | Declared change |
| SDK-created threads disappear from history lists | Real SDK-exec to app-server read/list probe and request-parameter doctest | Include the `exec` source explicitly and permit metadata repair scanning. | Clear |
| Read/admin app-server shape changes | Existing transcript doctest plus focused real read/list probe | The isolated compatibility module fails visibly; execution remains SDK-owned. | Clear |
| SDK omits a current app-server item type | SDK union and event-adapter fixtures | The live/history presentation loss is declared above rather than silently claimed as parity. | Declared loss |
| Temporary image cleanup fails | Cleanup runs in `finally`; cleanup-failure test remains useful | The turn fails visibly if cleanup itself fails. | Clear |

## Agent-flow / user-flow edge cases

- **Wrong tag / wrong field — UNCHANGED.** SDK file-change events retain changed paths,
  so Bee Box validation runs after the turn as it does now.
- **Stale ref — UNCHANGED.** The harness, CLI, plugin, and validators remain Codex's
  existing box environment.
- **Two agents touching one card — UNCHANGED.** SDK adoption does not change Git or card
  coordination.
- **Hand-edit drift — IMPROVED.** Vendor event mapping lives in one typed adapter. Box
  guidance and generated AGENTS/skill surfaces remain canonical and editable as now.
- **Fabricated free-form value — UNCHANGED.** Transport choice does not improve factual
  grounding.
- **Validation error UX — UNCHANGED.** Validation still occurs after SDK file changes
  and remains visible to the boxholder.
- **Optimistic chat rendering — PRESERVED BY THE UI.** For a fresh SDK thread, the
  backend waits for `thread.started` so the authoritative user frame carries the real
  session ID and is never temporarily classified as another sender.
- **Resume after process restart — GATED.** A real SDK probe must show that the saved
  thread ID resumes with the same context and plugin behavior.

## NOT in scope

- Replacing Claude's Agent SDK or merging vendor-native adapter implementations.
- ACP, OpenCode, Pi, or a new provider-neutral harness protocol.
- Reimplementing Codex tools, permissions, auth, session context, or agent loop.
- Live backend switching inside an existing chat.
- Parsing Codex private rollout files.
- Adding provider conditionals outside the existing engine selection and adapter
  dispatch boundaries.
- Changing box model names, admin controls, plugins, AGENTS generation, or knowledge
  audit substance except where SDK capability verification finds a regression.

## Open design questions

- How long should Bee Box retain the read/admin compatibility module before
  reevaluating SDK support or a product transcript? There is no reason to set a date
  until its maintenance cost is observed.
- Should the usage ledger make `turnId` optional or rename it to an engine-neutral
  invocation ID? The SDK does not publish native turn IDs.
- Does URL-image support matter for Codex chat today, or can the chat ingestion boundary
  always materialize images before it reaches any provider?

## Knowledge audits

Run the existing Codex knowledge audits before and after SDK cutover. They are
the strongest end-to-end check that system context, AGENTS mirrors, rules, skills,
plugins, cwd, and package context still reach the box agent with the same semantics.

Run exact paired probes for `temp-file-location` and `image-exif-date`, plus the broader
non-sensitive context corpus already used for Codex. A failure blocks rollout until the
prompt report shows whether the missing knowledge was absent from context, assigned the
wrong role, or ignored by the model. Do not tune audit prompts merely to hide an SDK
loading regression. The `image-exif-date` prompt and navigation assertion were repaired
as separate audit-harness work during this workstream, so its passing result is evidence
that the final route works, not an unchanged before/after comparison by itself.

## Implementation order

1. Pin the SDK and commit a capability matrix from real probes, with developer
   instruction semantics as the blocking gate.
2. Add the single typed SDK adapter and fixture tests for every exported SDK item/event.
3. Migrate batch execution and compare outputs, tools, validation, usage, cancellation,
   structured output, and knowledge audits against app-server.
4. Migrate interactive chat execution, including optimistic sender attribution and
   local-image handling.
5. Narrow app-server to the three transcript administration operations and add import
   boundary enforcement.
6. Run focused doctests, complete tests, knowledge audits, a real isolated-box chat and
   scheduled procedure, then cross-model review and `/finish`.

## Rollout shape

- Keep `agentEngine: "codex"` behavior unchanged from the boxholder's perspective.
- Land the SDK adapter dark, then migrate batch before chat. Do not make mixed execution
  automatic; each stage has an explicit configuration or internal rollout gate.
- Keep the app-server execution path available only for rollback during the migration
  window. The transcript compatibility module remains independent. Rollback changes the
  internal Codex runner, not the box's selected engine or native session IDs.
- Remove raw execution only after real resume, interruption, validation,
  knowledge-audit, and usage evidence passes.

## Review

Before implementation, review the plan against the exact pinned SDK declarations and a
real capability report. Before cutover, ask Claude to review the adapter boundary,
history quarantine, and claimed parity. Adjudicate findings into tests and migration
gates; do not use the review transcript as the work-unit conclusion.

## Stuff you should know

- This does not replace Codex. The official SDK itself launches the Codex CLI, so tools,
  auth, sessions, and the harness stay intact.
- Most live behavior has a typed SDK equivalent. This should remove a substantial amount
  of protocol code and hand-written Zod parsing.
- Transcript administration remains on three raw app-server calls because the SDK does
  not expose them. They stay behind one narrow, typed, read/admin-only module. This plan
  does not add a second durable transcript.
- Developer instructions are the stop/go gate. If they cannot retain their role through
  the supported SDK, the current backend should stay until OpenAI adds the capability.
- The expected implementation is a small-to-medium refactor, not a rewrite: SDK adapter,
  batch migration, chat migration, and narrowing the remaining history client. The real
  uncertainty is capability parity, not code volume.

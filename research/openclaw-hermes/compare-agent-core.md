# Core Agent Loop & Model Layer — Comparison

Callback Box (CBX) vs. OpenClaw vs. Hermes Agent. Scope: who owns the turn loop, how
models/providers are abstracted, streaming, steering/interruption, retries/failover,
queueing/concurrency, sub-agent delegation, and token/cost accounting.

The single biggest structural fact, stated up front because it conditions every row
below: **CBX does not own an agent loop at all.** It shells out entirely to the Claude
Agent SDK / Claude Code CLI (`@anthropic-ai/claude-agent-sdk`, spawned as a subprocess).
OpenClaw and Hermes each wrote and own ~thousands of lines of loop, provider, retry, and
streaming code (OpenClaw's `agent-core` package + `src/agents/`; Hermes's
`run_agent.py` + `agent/` package). CBX's equivalent code is a thin wrapper around
someone else's loop. That is not a gap to be closed — it's a different bet — but it
means several rows are "not applicable" or "inherited" for CBX rather than "missing."

---

## 1. Side-by-side

| Concern | CBX | OpenClaw | Hermes Agent |
|---|---|---|---|
| **Loop ownership** | None — SDK/CLI subprocess owns the turn loop entirely; CBX drives it via `query()` (one-shot) or a pushed async-iterable (chat) | Owns it: `packages/agent-core`'s `runAgentLoop` (provider-agnostic, ~engine-sized) | Owns it: `agent/conversation_loop.py::run_conversation`, a synchronous thread-based `while` loop over `AIAgent` |
| **Provider abstraction** | None — Anthropic-only, via whatever the SDK does internally; no provider registry in CBX code | Two layers: general API registry (`src/llm`, keyed by wire API shape: anthropic-messages, openai-*, google-*, etc.) + a separate embedded-runner transport-stream layer for OpenClaw-driven sessions | `ProviderProfile` dataclass (declarative hooks: `prepare_messages`, `build_extra_body`, `fetch_models`) + 27 in-tree provider plugins, 3-tier lazy discovery (bundled/user-override/legacy) |
| **Streaming** | Consumes SDK's `AsyncIterator<SDKMessage>` manually to race the terminal `result` against a subprocess-exit grace period (`STREAM_END_GRACE_MS`); rendered via `renderSdkMessage()` for CLI/logging; chat path buffers into a per-turn ring buffer (`TurnBuffer`) for resumable client streaming | `streamAssistantResponse` iterates a provider `AsyncIterable` of typed events (`text_delta`, `thinking_delta`, `toolcall_delta`, terminal `done`/`error`); `EmbeddedBlockChunker` does markdown-fence-aware chunking so chat channels get sane message boundaries | Always prefers streaming even with no display consumer, specifically for fine-grained stall detection (90s stale-stream, 60s read timeout) that non-streaming lacks; two scrubber passes (`<think>` tags, injected-context spans) sit between raw deltas and delivered text |
| **Steering / interruption** | No mid-turn steering concept; a chat session is turn-at-a-time (user message → full agent turn → response) with resumable SDK sessions between turns; `ChatSession.setModel` restart is the closest thing to a live interrupt, and it defers to the turn's `done` event if busy | Two distinct queues: `PendingMessageQueue` drained **between** turns (not mid-stream) for live steering, plus a separate cross-session steering queue for delegated-subagent results re-entering a parent's next turn; true cancellation is a separate `AbortSignal` path checked every loop step | `/steer` queues text that's spliced into the **last tool-role message** before the next API call (never a synthetic user message, to protect role alternation); separate `interrupt()` scopes an abort signal per-thread, fanning out to concurrent tool workers and delegation children |
| **Retries / failover** | None in CBX code — no exponential backoff, no model-fallback chain; any SDK/CLI-internal retry is opaque. CBX's only "retry-shaped" logic is post-hoc: `ensureAgentCommitted()`'s nudge-then-forced-commit, and reactor chat-job's reset-on-failure | Rich, layered: `FailoverError`/`FailoverReason` taxonomy, two-stage failure handling (auth-profile rotation within a provider, then model fallback across a configured chain), API-key rotation, exponential cooldowns (rate-limit vs. billing get different curves), session-pinned auth profiles for cache-friendliness | Equally rich: `classify_api_error()` 8-stage pipeline → `ClassifiedError` action flags (retryable/rotate/fallback/compress); jittered exponential backoff with per-provider overrides; `retry_count` resets after any successful recovery so recoveries don't eat the raw retry budget |
| **Queueing / concurrency** | Two independent caps, not unified: reactor holds a single PID-file lock (one reactor run at a time per box); chat sessions are capped by `ChatSessionRegistry.maxLiveProcesses` (default 2 live subprocesses per box, LRU-stopped, not deleted) | Explicit lane taxonomy (`CommandLane`: main/cron/cron-nested/subagent/nested), each lane single-flight by default; every embedded run double-queues (own session lane, then global/cron lane); session-file writes additionally protected by a process-aware file lock | Fully in-process/synchronous — the loop itself is single-threaded per conversation; concurrency exists only *inside* one turn (concurrent tool execution, `DaemonThreadPoolExecutor` max 8 workers) and across independent `AIAgent` instances (delegation, kanban dispatcher, batch-runner multiprocessing) |
| **Sub-agents / delegation** | None as a first-class concept — the stock Claude Code tool set includes Task/sub-agent spawning (inherited from the SDK), but CBX doesn't orchestrate, budget, or track delegated work itself | `delegate_task`-equivalent via the agent-tool surface plus `agent-steering-queue.ts` for cross-session results; subagent lanes (`nested:<sessionKey>`) serialize nested calls per session | Deepest of the three: `delegate_task` tool with leaf/orchestrator roles, hard-capped batch size and spawn depth, independent per-child `IterationBudget`, background/async delegation that re-enters as a new turn (never spliced mid-turn); plus wholly separate mechanisms for training-data generation (`batch_runner.py`) and process-level multi-agent (kanban dispatcher, OS-level `subprocess.Popen`) |
| **Token / cost accounting** | Read-side aggregation only: `usage.ts` parses Claude Code's own per-session JSONL transcripts (which already carry per-message model + token counts) plus a session-manifest task-attribution log, rolled into a SQLite `usage` table; nothing tracked in real time during invocation | `normalizeUsage()` accepts many provider usage-shape spellings; running + last-call accumulators per attempt/turn; `estimateUsageCost()` does tiered USD-per-million-token math | `normalize_usage()` canonicalizes provider shapes; `estimate_usage_cost()` returns a `CostResult` with explicit status (`actual/estimated/included/unknown` — never silently guesses); separate live account-balance tracking (Nous credits, parsed as exact integer micros to avoid float-precision loss above 2^53) |

### Prose summary

OpenClaw and Hermes are peers in a real sense: both are large, self-built agent engines
with their own provider abstraction, retry/failover taxonomy, streaming pipeline, and
delegation model, built because they need to run against many different LLM providers
and backends reliably at scale (multi-tenant gateways, training-data pipelines, kanban
worker fleets). CBX is a comparatively small orchestration layer sitting on top of a
single vendor's fully-managed agent runtime. Where OpenClaw and Hermes had to build a
provider registry, CBX has none — it doesn't need one, because it made a
single-provider bet. Where they built retry/failover/model-fallback machinery, CBX
inherits whatever the SDK does (opaque) and instead spends its own error-handling
effort at a different layer entirely: making sure agent-produced *filesystem/git state*
is never lost (commit enforcement, transcript durability gates, message dedup) rather
than making sure the *model call* itself succeeds.

---

## 2. Confirmations

Places where CBX's choices land on the same design both (or one) of the comparables
independently converged on — worth flagging because it validates decisions that were
made somewhat incidentally in CBX rather than as a deliberate architectural stance:

- **Turn-boundary steering, not mid-stream interrupt, is the norm.** Both OpenClaw
  (`PendingMessageQueue` drained between turns) and Hermes (`/steer` spliced into the
  last tool message before the next API call) treat "steering" as an at-the-next-turn
  operation, not a true mid-generation interrupt — genuine cancellation is a separate,
  cruder mechanism (`AbortSignal` / per-thread interrupt flag) in both. CBX's chat
  model — a full turn runs to completion, the next user message starts the next turn,
  with model-swap requiring a restart — is the same shape at a coarser grain. CBX never
  built the fancier "inject mid-turn" queue because turn-at-a-time was good enough; both
  comparables show that even systems that built the fancier mechanism still fence it at
  turn boundaries for the same reason CBX does implicitly (protecting message-role
  alternation / conversation coherence).

- **Never let a tool/hook failure hard-fail the loop.** All three independently arrived
  at "swallow and continue, surface diagnostics." CBX's SDK hooks
  (`cardValidatorHook`, `gitMvNudgeHook`) only inject `additionalContext`, never block;
  OpenClaw's `beforeToolCall`/`afterToolCall` wraps every thrown tool exception into a
  structured error result rather than letting it escape the loop; Hermes wraps every
  tool dispatch exception into a sanitized `{"error": ...}` JSON string. Same instinct,
  same reason: a flaky validator or tool shouldn't be able to crash an otherwise-healthy
  turn.

- **The durable record lives outside any in-memory buffer, and streaming buffers are
  explicitly "an optimization, never the only copy."** CBX's `TurnBuffer` ring buffer is
  documented exactly this way relative to the JSONL transcript; Hermes flushes
  assistant/tool messages to SQLite *before* running tool side effects, for the same
  crash-resilience reason CBX's transcript-durability gate exists (a client shouldn't
  see "done" before the record is actually safe). Different implementations, same
  underlying discipline: never let the live stream be the sole source of truth.

- **Single-flight per conversation/session is the right default concurrency bound.**
  CBX's chat backend effectively serializes turns within a session (one active
  subprocess call per `ChatSession`); OpenClaw's per-session lane defaults to
  `maxConcurrent: 1`; Hermes's loop is synchronous per `AIAgent`. None of the three
  allow two turns of the same conversation to race each other — this is a genuine
  cross-system convergence, not an accident.

- **Model selection is a persisted, restart-on-next-turn setting, not a live
  mid-stream swap.** CBX's `ChatSession.setModel` explicitly does not affect an
  in-flight run; Hermes's `/model` switch likewise forfeits provider-side prompt cache
  and takes effect on the next call, not the current one. Both treat "the model in use"
  as a property of the *session*, updated at turn boundaries — CBX's design here isn't
  an oversight, it's the same boundary the more complex systems chose.

- **Graceful degradation over centralized retry policy at the orchestration layer.**
  CBX has no single retry framework — error handling is deliberately distributed
  (§7 of `cbx-agent-core.md` lists ~10 independent degrade-and-continue behaviors). This
  looks unstructured next to OpenClaw/Hermes's formal failover taxonomies, *but* those
  taxonomies live one layer down, inside the model-call boundary CBX has delegated to
  the SDK. At CBX's actual layer (job/reactor/chat orchestration), both comparables also
  favor scattered, local degrade-and-continue logic over a single policy object — e.g.
  Hermes's `finalize_turn` epilogue and OpenClaw's per-module "logged and continues"
  patterns in cron/doc-regeneration paths are exactly this shape.

---

## 3. Divergences

Where the three chose differently, and CBX's choice holds up (with honest trade-offs
noted):

### 3.1 No provider abstraction, no model-fallback chain — a real capability gap, but arguably the correct one given the constraint

OpenClaw and Hermes both support dozens of providers with automatic failover chains
(rate-limit → rotate credential → fall back to next model). CBX has none of this: it is
Anthropic-only, with no fallback if Anthropic has an outage, and no code path to try a
different model automatically. This is a genuine capability gap for an
availability-sensitive deployment. But it's a direct, defensible consequence of the
"outsource the whole loop" bet: building a provider-fallback layer *underneath* the
Claude Agent SDK would mean re-implementing large parts of what OpenClaw/Hermes built —
message format translation, tool-schema normalization across vendors, per-provider auth
— none of which the SDK exposes hooks for, because the SDK assumes it *is* the provider
layer. CBX would have to abandon the SDK (and everything it gets for free: tool
execution, permission modes, transcript persistence, CLAUDE.md auto-loading) to add this,
which is a much bigger bet than "add a retry loop." The trade-off is real and should be
named explicitly to stakeholders: CBX has an availability single point of failure that
the comparables engineered away, in exchange for not owning a loop at all.

### 3.2 No delegation/subagent budgeting — inherited capability, un-owned by CBX

The Claude Agent SDK's stock tool set includes Task/subagent spawning, so CBX agents
*can* delegate, but CBX has zero visibility or control over it: no independent
iteration budget per child (Hermes's model), no depth cap, no role restriction
(leaf/orchestrator), no cost attribution split between parent and child. If a CBX agent
spawns a wildly expensive subagent chain, `maxBudgetUsd` on the *parent* invocation is
the only backstop, and it's coarse (it caps the whole session, not per-child). This is
a real gap: Hermes's `delegation.max_concurrent_children` / `max_spawn_depth` /
independent per-child budget is a mature answer to a problem CBX hasn't had to think
about yet only because box workloads haven't stressed it. Worth tracking as a
future risk rather than dismissing.

### 3.3 Reactor's dual dispatch (batch vs. chat-job) vs. OpenClaw/Hermes's uniform per-session loop

CBX's reactor amortizes one session-startup cost across many independent jobs (batch
path) while giving chat jobs their own resumed-per-thread session — a deliberate
two-tier design neither comparable needs, because neither has an equivalent "many small
independent async jobs plus a few long-lived conversations" workload shape in one
runtime. This is defensible: it's solving a problem (cost-amortizing a many-jobs-per-box
cron-like workload) that OpenClaw/Hermes's design targets (interactive chat-first, or
training-data-pipeline-first) don't really have. Where it's genuinely weaker: OpenClaw's
lane system would let unrelated reactor jobs run *concurrently* (bounded by a lane's
`maxConcurrent`), whereas CBX's batch path is single-session-sequential by
construction — a lock, not a scheduler. For box workloads (single-user, modest job
volume) this is almost certainly fine; it would not scale to OpenClaw/Hermes's
multi-tenant volumes.

### 3.4 No formal token-budget compaction — CBX relies entirely on the SDK's session lifecycle

Hermes has a whole dual system (live `context_compressor.py` compaction vs. offline
`trajectory_compressor.py`); OpenClaw has `compact`/`shouldCompact` wired into
`AgentSession`. CBX has nothing analogous in its own code — no compaction trigger, no
context-window accounting beyond the reactor's crude session-rotation guard (50
messages / 24h, chat-jobs only). This is squarely inherited-and-invisible: whatever
context management the Claude Code CLI does internally (if any) is opaque to CBX. For
long-lived chat sessions this is a plausible latent risk (a very long-running chat
session might degrade or hit context limits with no CBX-side mitigation beyond
`ChatSession`'s idle-eviction, which is about process count, not context size).

### 3.5 CBX's "durable record is someone else's file" is both a strength and a coupling risk

Both OpenClaw and Hermes own their transcript/session persistence format (SQLite for
Hermes, an internal session store for OpenClaw) — this gives them full control over
migration, compaction, and multi-backend portability. CBX's decision to treat Claude
Code's own JSONL transcript as the durable record (and build lightweight pointer files
on top, §6.1 of `cbx-agent-core.md`) is elegant and saves a huge amount of engineering
(no schema to own, no writer to build) but couples CBX's entire history model to an
implementation detail of a third-party CLI that isn't a documented public contract.
The transcript-flush race CBX had to work around (§6.2) is a direct symptom of that
coupling — a self-owned store wouldn't have that race because the writer and the reader
would be the same codebase.

---

## 4. Steal-this

Concrete ideas for CBX, given the real constraints: Claude Agent SDK-based (no loop
ownership), single-user boxes (not a multi-tenant gateway), filesystem+git as the state
substrate. Ordered by rough priority (highest first).

1. **Per-child-agent budget/depth guard for sub-agent delegation.**
   *What*: since the SDK's Task tool lets a CBX agent spawn sub-agents with no CBX-side
   visibility, add a lightweight guard analogous to Hermes's `delegation.max_iterations`
   / `max_spawn_depth` — even a coarse one, e.g. a PreToolUse hook on the Task tool that
   tracks spawn depth via a context field and blocks/warns past a small cap (2-3
   levels), plus folding sub-agent cost into the existing `maxBudgetUsd` accounting
   properly (right now a runaway sub-agent chain is bounded only by the parent's
   overall budget, not per-child).
   *Why for CBX*: box agents already can and do use Task/subagent spawning (it's stock
   SDK tooling); an unbounded recursive spawn is a real cost/runaway risk with zero
   current mitigation, and this is the single largest actual gap identified above (§3.2).
   *Effort*: small-medium — a new SDK hook (CBX already has the `sdk-hooks.ts`
   pattern to extend) plus a small depth-tracking convention in session/prompt state.

2. **A `/model` (or job-level) fallback-on-unavailable, scoped narrowly.**
   *What*: not a full multi-provider abstraction (out of scope given the SDK
   commitment) — just a single, small fallback: if a chat/reactor `invoke()` fails with
   a model-unavailable/overloaded-shaped error, retry once against a configured
   secondary model (e.g. Sonnet → Haiku, or the reverse for cost-sensitive jobs) before
   surfacing the failure. This mirrors Hermes/OpenClaw's model-fallback chain concept at
   a fraction of the engineering cost, since CBX only has one provider's models to pick
   among (no cross-vendor translation needed).
   *Why for CBX*: currently a transient Anthropic-side hiccup (rate limit, overload)
   just fails the run outright (§3.1); this doesn't fix the availability
   single-point-of-failure but meaningfully softens it for the common transient case
   without touching the loop-ownership bet.
   *Effort*: small — wrap the existing `invoke()`/`runAgent()` call site with one
   classify-and-retry-once branch; the error subtype info is already surfaced
   (`agent-run.ts`'s error handling, §7 of `cbx-agent-core.md`).

3. **Explicit token-based compaction/rotation trigger for long-lived chat sessions,
   not just message-count/age.**
   *What*: the reactor's chat-job session rotation already exists (50 messages / 24h) —
   extend the same idea to the interactive `ChatSession` path, and make the trigger
   token-aware (read the SDK's per-turn usage numbers, which CBX already parses for
   `usage.ts`) rather than purely message-count-based, matching Hermes's discipline of
   triggering compaction off real reported `prompt_tokens` rather than a proxy.
   *Why for CBX*: interactive chat sessions can run indefinitely with no CBX-side
   context-size mitigation (§3.4); usage data to drive this already exists in CBX's own
   SQLite usage table, so this is mostly wiring, not new instrumentation.
   *Effort*: medium — needs a decision on *what* rotating a live chat session means for
   UX (does the user notice? does session history stay one logical thread?), which is
   more a product question than an engineering one.

4. **A single "why did this fail" error-classification taxonomy at the CBX orchestration
   layer**, borrowing the shape (not the mechanism) of Hermes's `FailoverReason` /
   OpenClaw's `FailoverReason` enums.
   *What*: CBX's current error handling (§7 of `cbx-agent-core.md`) is a list of ~10
   independent ad-hoc degrade-and-continue behaviors with no shared vocabulary for *why*
   a run failed. A small shared enum (`auth`, `rate_limit`, `budget_exceeded`,
   `max_turns_exceeded`, `no_result`, `subprocess_error`, `unresumable_session`, …)
   attached consistently to `AgentResult.errorText`/reactor logs would make the existing
   scattered handling easier to reason about and alert on (e.g. `cb health` could
   distinguish "box is fine, model had a rate limit" from "box's session state is
   corrupt") without requiring any new retry machinery.
   *Why for CBX*: this is pure legibility/observability work that pays for itself the
   first time someone has to debug a batch of failed reactor cycles; it doesn't require
   touching the loop-ownership bet at all.
   *Effort*: small — a shared type + threading it through the handful of existing
   catch/log sites; no new control flow.

5. **(Lower priority, bigger bet) A thin model-fallback config surface exposed to box
   owners**, e.g. a `config/box.json` field naming a fallback model per job type,
   analogous to Hermes's `fallback_providers` list but scoped to "which Claude model,"
   not "which vendor." This is really item 2 generalized into a configuration surface
   rather than a hardcoded pair — worth doing once item 2 proves useful, not before.
   *Effort*: small once #2 exists.

---

## Summary of key source files (for reference)

CBX: `callback-box/src/core/agent.ts`, `agent-run.ts`, `agent-stream.ts`,
`agent-commit.ts`, `sdk-hooks.ts`, `chat-session.ts`, `chat-session-registry.ts`,
`reactor/engine.ts`, `reactor/chat-jobs.ts`, `chat-reactor-sessions.ts`, `usage.ts`.

OpenClaw: `packages/agent-core/src/agent.ts`, `agent-loop.ts`,
`src/agents/embedded-agent-runner/run.ts`, `run/attempt.ts`,
`src/agents/model-fallback.ts`, `failover-policy.ts`, `src/process/command-queue.ts`,
`src/agents/agent-steering-queue.ts`.

Hermes: `run_agent.py`, `agent/conversation_loop.py`, `agent/tool_executor.py`,
`providers/base.py`, `agent/error_classifier.py`, `agent/iteration_budget.py`,
`tools/delegate_tool.py`, `agent/usage_pricing.py`.

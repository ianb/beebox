# Letta: multi-agent primitives and sleep-time architecture

Deep dive into how Letta (`github.com/letta-ai/letta`, commit `b76da909`) structures multi-agent
groups, background/sleep-time agents, and shared-state IPC. Written for Callback Box builders;
memory content/quality is out of scope — the focus is the *concurrency and orchestration
architecture* underneath.

All citations are `path:line` against the clone at
`/private/tmp/claude-501/.../scratchpad/letta`.

---

## 0. The version churn you'll hit reading this codebase

Letta has rewritten its agent loop three times (`LettaAgent` → `LettaAgentV2` → `LettaAgentV3`) and
carries a parallel set of sleeptime-group implementations (`sleeptime_multi_agent.py`,
`_v2.py`, `_v3.py`, `_v4.py`). **Only V4 is live** in the current dispatch path:

- `letta/agents/agent_loop.py:35` — `AgentLoop.load()` returns `SleeptimeMultiAgentV4` when
  `agent_state.agent_type` is `letta_v1_agent`/`sleeptime_agent` and `enable_sleeptime=True`.
- `letta/agents/agent_loop.py:58` — a second, older path (`SleeptimeMultiAgentV3`) still fires for
  non-v1 agent types with `enable_sleeptime=True`. Practically: new agents get V4, some legacy
  agent types still run V3.
- `letta/groups/helpers.py:65-84` (`load_multi_agent`) is a **third**, seemingly dead code path for
  `ManagerType.sleeptime` that instantiates the oldest `SleeptimeMultiAgent` (v1) — it's not
  reachable from `agent_loop.py`'s dispatch and looks like it survives only for direct/legacy
  callers or tests.

The rest of this doc describes V4 (production) and flags V1-V3 only where they reveal something V4
hides.

---

## 1. Multi-agent primitives

### 1.1 The `Group` abstraction and its manager types

A `Group` (`letta/schemas/group.py:28-82`) is the top-level multi-agent construct: an ordered list
of `agent_ids`, a `manager_type`, and manager-specific config. Six manager types exist
(`ManagerType` enum, `letta/schemas/group.py:11-17`):

| manager_type | Purpose | Implementation status |
|---|---|---|
| `round_robin` | Agents take turns in fixed order | `letta/groups/round_robin_multi_agent.py` — **legacy/sync**, uses the old `Agent`/`LettaAgent` (V1) class, not wired to `AgentLoop` |
| `supervisor` | One manager agent delegates to participants | `letta/groups/supervisor_multi_agent.py:29-110` — **`step()` body is entirely commented out**; the class only has an `__init__`. Dead. |
| `dynamic` | A manager agent picks the next speaker each turn (LLM decides, name-matched against response text) | `letta/groups/dynamic_multi_agent.py` — implemented but legacy/sync (V1-style `Agent`) |
| `sleeptime` | One (or more) background memory-management agents paired with a foreground conversational agent | `letta/groups/sleeptime_multi_agent_v4.py` — **the only actively-developed manager type** |
| `voice_sleeptime` | Sleeptime variant tuned for low-latency voice | `letta/agents/voice_sleeptime_agent.py` + `letta/agents/voice_agent.py` |
| `swarm` | Declared in the enum, `SwarmGroup` schema class is commented out (`letta/schemas/group.py:157-158`) | **Not implemented at all** |

Takeaway: despite the taxonomy suggesting four live conversational-orchestration patterns
(round-robin / supervisor / dynamic / swarm), only `sleeptime` is a maintained, production
execution path. `round_robin` and `dynamic` still run but through the old synchronous `Agent`
class family that the rest of the codebase has moved off of; `supervisor` and `swarm` are stubs.
If you were sizing Letta's "multi-agent conversation" story (several peer agents actually talking
to each other turn-by-turn), the honest answer is: it exists in name, but the maintained code path
is single-foreground-agent-plus-background-workers, not a chat-room of peers.

`round_robin`/`dynamic` do reveal one shared-state trick worth noting even though unmaintained:
`DynamicMultiAgent.load_manager_agent()` (`letta/groups/dynamic_multi_agent.py:183-199`)
dynamically creates one memory **block per participant agent**, labeled by that agent's ID, and
attaches it to the manager agent so the manager's context window contains each participant's
persona. That's a "shared memory block as directory/roster" pattern, distinct from the sleeptime
pattern below.

### 1.2 Cross-agent messaging tools (agent-to-agent, out-of-band)

`letta/functions/function_sets/multi_agent.py` defines three tools (registered in
`MULTI_AGENT_TOOLS`, `letta/constants.py:154`):

- `send_message_to_agent_and_wait_for_reply(message, other_agent_id)` —
  `letta/functions/function_sets/multi_agent.py:60-92`. Synchronous request/response.
- `send_message_to_agents_matching_tags(message, match_all, match_some)` —
  `:95-149`. Fan-out to every agent in the org matching a tag filter, sequentially awaiting each.
- `send_message_to_agent_async(message, other_agent_id)` — `:152-172`. Fire-and-forget
  notification; explicitly blocked in Letta Cloud (`if settings.environment == "prod": raise`,
  `:159`) — local/self-hosted only (also listed in `LOCAL_ONLY_MULTI_AGENT_TOOLS`,
  `letta/constants.py:155`).

**Architecturally important**: these tools are not in-process function calls between Python
objects. Each one calls back into the Letta REST API as an HTTP client
(`letta/functions/function_sets/multi_agent.py:14-25`, `_get_sandbox_client()` builds a
`letta_client.Letta(base_url=..., api_key=...)` from `LETTA_SERVER_URL`/`LETTA_API_KEY` env vars
injected into the tool sandbox, then `client_obj.agents.messages.create(...)`). This means:

- Agent-to-agent calls execute inside whatever sandbox the tool-execution layer uses (local
  subprocess or e2b/Modal remote sandbox — same code path as any other Python tool), and they
  incur the same round-trip cost and process-isolation constraints as an external API caller
  would.
- There's no shared-memory or shared-lock fast path between two ordinary agents talking to each
  other; every hop is a full "create a message, run the target agent's full step loop" call.
- Because it's a real HTTP call to `self`, this also means an agent *can* message an agent in a
  different group/org boundary as long as it has the org-scoped id and API key — the isolation
  boundary is the API key/org, not the group.

The messages arrive as `role: "system"` with a synthesized preamble identifying the sender
(`"[Incoming message from agent with ID '{sender_agent_id}' ...]"`, `:76-80`, `:161-165`) — the
receiving agent has no native concept of "this came from another agent" beyond that string
convention.

### 1.3 Shared memory blocks as IPC — concurrency model

Blocks (`letta/orm/block.py:20-...`) are the core-memory unit and the only real "shared state"
primitive between agents in a group — one `Block` row can be attached to N agents via the
`blocks_agents` join table. Two concurrency mechanisms exist:

**(a) DB-level optimistic locking.** `Block` uses SQLAlchemy's built-in versioned-row locking:

```python
version: Mapped[int] = mapped_column(Integer, nullable=False, default=1, server_default="1", ...)
__mapper_args__: ClassVar[dict] = {"version_id_col": version}
```
(`letta/orm/block.py:56-61`)

Every `UPDATE` includes `WHERE version = <version-read-at-load-time>`, and SQLAlchemy bumps
`version` on write. If two writers load the same block, both mutate, and both try to commit, the
second commit affects 0 rows and SQLAlchemy raises `StaleDataError`. `SqlalchemyBase.update_async`
catches this and re-raises as `ConcurrentUpdateError` (`letta/orm/sqlalchemy_base.py:775-780`,
`letta/errors.py:72`), which the FastAPI app maps to an **HTTP 409**
(`letta/server/rest_api/app.py:584`).

**(b) No automatic retry, and the read-modify-write window is wide.** The memory *tools* the LLM
calls (`core_memory_replace`, `memory_replace`, etc., `letta/services/tool_executor/core_tool_executor.py:319-401`)
do a classic read-modify-write against `agent_state.memory` (an in-process snapshot loaded at the
start of that agent's step, not re-fetched per tool call), string-match/replace, then persist via
`agent_manager.update_memory_if_changed_async` → `block_manager.update_block_async`
(`letta/services/agent_manager.py:1747-1801`, `letta/services/block_manager.py:211-...`).
`update_block_async` opens its own fresh session and re-reads the block
(`letta/services/block_manager.py:214`), so the version-check window is just that one call — but
the *content* being diffed/patched (`old_content in current_value`) is whatever the calling
agent's in-memory snapshot said, which can already be stale relative to a concurrent writer's
edit. Net effect for two agents (e.g. a foreground agent and its sleeptime pair, or two group
participants) editing the **same block concurrently**:
  - If both target *different* substrings, both writes can land (last-committer's full `value`
    wins each field-level write is a whole-string surgical replace, not a merge) —no true merge,
    whoever commits last overwrites the whole `value` column.
  - If they race on true version conflict, the loser's tool call raises `ConcurrentUpdateError`
    → surfaces to that agent as a normal tool-error string (`ToolExecutionResult(status="error",
    ...)`, `core_tool_executor.py:65-72`) with no automatic retry; the LLM has to notice the error
    and decide to retry the edit itself.
  - There is **no distributed lock, no queue, no CRDT** — this is bare optimistic concurrency
    control at the single-row level, with the retry policy left to the calling LLM's judgment.

**(c) Block history / checkpoints as an undo mechanism, not a merge mechanism.**
`BlockManager.checkpoint_block_async` (`letta/services/block_manager.py:842-911`) snapshots a
block's full state into `BlockHistory` on each meaningful change (linear undo/redo stack, future
checkpoints truncated on redo — `:874-883`). This gives point-in-time recovery per block, but
doesn't help with concurrent-writer conflicts; it's a version-history feature, not a locking
feature.

**(d) Attaching a shared block to a sleeptime pair is automatic.** `attach_block_async`
(`letta/services/agent_manager.py:2162-2198`) attaches a block to the requested agent, then — if
that agent is in a `sleeptime` group — also walks the group's `agent_ids` and attaches the same
block to the paired sleeptime agent (`:2173-2187`). So "give the sleeptime agent visibility into
whatever the foreground agent sees" is baked into the attach path, not something callers wire up
per-block.

---

## 2. Sleep-time agents: full mechanics

### 2.1 Creation

Sleeptime agents are created transactionally alongside the foreground ("convo") agent, or lazily on
first `enable_sleeptime` update:

- `create_sleeptime_agent_async` (`letta/server/server.py:756-789`): builds a `CreateAgent` request
  for `agent_type=sleeptime_agent`, copies the foreground agent's memory blocks by ID
  (`block_ids=[block.id for block in main_agent.memory.blocks]`, `:763`) so it starts with the
  *same* blocks (shared, not copied-by-value), adds one new `memory_persona` block seeded from
  `get_persona_text("sleeptime_memory_persona")` (`:764-769`), inherits the foreground agent's
  `llm_config`/`embedding_config`/`project_id` (`:770-772`), then wraps both agents in a `Group`
  with `manager_config=SleeptimeManager(manager_agent_id=main_agent.id,
  sleeptime_agent_frequency=5)` (`:778-786`) — **the default cadence is every 5 foreground
  turns.**
- Triggered from `create_agent_async` (`server.py:661-665`) at agent-creation time, and from
  `update_agent_async` (`server.py:728-734`) if `enable_sleeptime` flips on later and no group
  exists yet.
- Voice variant: `create_voice_sleeptime_agent_async` (`server.py:791-826`) is nearly identical but
  builds `agent_type=voice_sleeptime_agent`, forces model to `gpt-4.1`
  (`llm_config=LLMConfig.default_config("gpt-4.1")`, `:806` — hardcoded, not inherited), and uses
  `VoiceSleeptimeManager(max_message_buffer_length=30, min_message_buffer_length=15)` instead of a
  turn-frequency (constants at `letta/constants.py:89-90`).
- Tool defaults differ by `agent_type` at creation time
  (`letta/services/agent_manager.py:389-405`): a pure `sleeptime_agent` gets `BASE_SLEEPTIME_TOOLS`
  (`memory_replace`, `memory_insert`, `memory_rethink`, `memory_finish_edits` —
  `letta/constants.py:135-143`); a foreground agent with `enable_sleeptime=True` gets the pared-down
  `BASE_SLEEPTIME_CHAT_TOOLS` (`send_message`, `conversation_search`, `archival_memory_search` —
  `:133`), i.e. **the foreground agent is deliberately stripped of direct memory-editing tools once
  it has a sleeptime partner** — memory editing becomes the sleeptime agent's job.
- Tool-rule wiring: `BASE_SLEEPTIME_TOOLS` members get `ContinueToolRule` (loop stays open),
  `memory_finish_edits` gets `TerminalToolRule` (`agent_manager.py:481-486`) — the sleeptime agent
  is expected to chain several precise edits and then explicitly call `memory_finish_edits` to
  stop.
- Deletion/cleanup: deleting the foreground agent cascades to delete its sleeptime partner and the
  `Group` row (`agent_manager.py:1337-1389`); deleting the sleeptime agent directly finds and
  cleans up the `Group` and clears the foreground agent's `enable_sleeptime` flag.

### 2.2 What triggers a run — message-count based, not a clock

There is **no timer/cron for sleeptime** — it's driven purely by the foreground agent's own step
count, checked synchronously at the end of every foreground turn:

`SleeptimeMultiAgentV4.step()` (`letta/groups/sleeptime_multi_agent_v4.py:44-82`) wraps the normal
`LettaAgentV3.step()` (the foreground agent's real turn) and, after it returns, calls
`run_sleeptime_agents()` (`:80`). Same pattern in `stream()`, in a `finally:` block specifically
because "stream is throwing a GeneratorExit even though it appears the client is getting the whole
stream" (`:126-129` — a documented workaround for a streaming-cleanup bug, not a design choice).

`run_sleeptime_agents()` (`:131-168`):
1. Bumps `group.turns_counter` modulo `sleeptime_agent_frequency`
   (`group_manager.bump_turns_counter_async`, `:141`, impl at
   `letta/services/group_manager.py:258-266`: `turns_counter = (turns_counter + 1) %
   sleeptime_agent_frequency`).
2. Only proceeds if `sleeptime_agent_frequency is None` **or** `turns_counter % frequency == 0`
   (`:144-146`) — i.e. `frequency=5` fires on turns 5, 10, 15, ... (every 5th foreground turn), and
   `frequency=None`/`0` (not set at all by the default creation path, which always sets `5`) means
   fire on *every* turn.
3. Bails out with a warning if the foreground step produced no response messages (`:148-150`).
4. Reads and atomically swaps `group.last_processed_message_id`
   (`get_last_processed_message_id_and_update_async`, `:152-154`, impl at
   `group_manager.py:272-284`) — this is the bookmark for "what's new since the sleeptime agent
   last looked."
5. For **every** agent_id in the group (a sleeptime group can have more than one background agent,
   though the default creation path only ever adds one), issues a background task per agent
   (`:155-167`).

Note the counter/bookmark updates (`bump_turns_counter_async`, `get_last_processed_message_id_...`)
have no optimistic-lock version column on `Group` (`letta/orm/group.py:17-44` — no
`version_id_col`), unlike `Block`. Truly concurrent overlapping calls to the same foreground
agent's `step()` (e.g. two simultaneous API requests to one agent) could race on `turns_counter`
with a plain last-write-wins update, silently mis-firing the cadence. In practice this is bounded
by how much Letta serializes per-agent step execution elsewhere, but nothing in this file enforces
it.

### 2.3 Backgrounding mechanics — fire-and-forget within the same process

`_issue_background_task` (`:171-199`) creates a `Run` row (`status=created`,
`metadata={"run_type": "sleeptime_agent_send_message_async", ...}`) via `RunManager`, then calls
`safe_create_task(self._participant_agent_step(...), label=...)` (`:188-198`) — **not** a queue, not
a separate worker process. `safe_create_task` (`letta/utils.py:1166-1213`) wraps the coroutine,
logs failures, and — critically — **adds the task to a module-level `_background_tasks` set**
purely to hold a strong reference so asyncio doesn't garbage-collect an in-flight task. This means:

- Sleeptime runs live and die with the API server process. If the process restarts or the request
  handler's event loop is torn down before the task finishes, an in-flight sleeptime run is lost
  (the `Run` row would presumably remain stuck in `running`/`created` — no reconciliation/reaper is
  visible in this file).
- The caller's HTTP response to the *foreground* message returns immediately with `run_ids`
  attached to `response.usage.run_ids` (`:81`) — the client can poll those run IDs via the Jobs/Runs
  API, but the original request is not held open waiting for sleeptime to finish.
- Because everything (`self.run_manager`, `self.message_manager`, `self.agent_manager`) is Manager
  classes each opening their own new DB session per call, there's no lock held across the whole
  operation — just fine-grained per-call optimistic locking on individual writes.

### 2.4 Prompt construction and race exposure to the LLM

`_participant_agent_step` (`:201-289`) builds the sleeptime agent's input:
- Fetches `prior_messages` from the *foreground* agent's message history between
  `last_processed_message_id` and the first of the just-produced `response_messages` (`:217-227`,
  swallows exceptions and falls back to just the latest messages on failure).
- Stringifies everything via `stringify_message` (`letta/groups/helpers.py:89-166` — role-aware
  formatting: user/assistant/approval/tool-result text extraction, `send_message` tool-call
  content unwrapped to plain text, reasoning wrapped as `<thinking>...</thinking>`).
- Wraps it in a fixed `<system-reminder>` framing (`:233-243`) that explicitly tells the sleeptime
  agent: *"You are NOT the primary agent... Your primary role is memory management... Check your
  memory_persona block for any additional instructions or policies."* — the persona block content
  itself (default: `get_persona_text("sleeptime_memory_persona")`) is where per-agent sleeptime
  behavior/policy customization lives, not the code.
- Instantiates a **fresh** `LettaAgentV3(agent_state=sleeptime_agent_state, actor=self.actor)`
  (`:257-260`) — loaded from DB at call time — and calls `.step(...)` with the constructed
  transcript message and the same `run_id`/`billing_context` as the parent, so cost attribution
  ties back to the triggering conversation.
- On completion or exception, updates the `Run` row's status/`stop_reason`/`metadata` (`:269-289`).

Because each concurrently-firing sleeptime agent (per-agent-id loop at `:155-167`) loads its own
`agent_state` fresh and only writes to its own blocks plus whatever shared blocks it was attached
to, the actual write race described in §1.3 is the exposure surface here: if the *foreground* agent
somehow writes to a shared block again before the sleeptime agent's edit lands (unlikely given the
foreground agent has no memory-editing tools once `enable_sleeptime` is on, §2.1), or if **two
sleeptime agents in the same group** (a group can list >1 agent_id) both edit the same block, you
hit the optimistic-lock/no-retry behavior from §1.3(b).

### 2.5 Frequency and cost controls

- **Frequency**: `sleeptime_agent_frequency` (default `5`, set at group-creation time,
  `server.py:784`) is the only lever — a simple "every N foreground turns" counter, no token-based
  or time-based triggers. `None`/falsy means "every turn."
- **Cost**: no explicit token/dollar budget in this subsystem. Cost control is indirect: (a) the
  foreground agent loses memory-editing tools so it can't also burn tokens editing memory
  (§2.1); (b) frequency=5 amortizes the sleeptime LLM call's cost over 5 conversational turns; (c)
  `billing_context` is threaded through from the triggering request so usage/billing rolls up to
  the same account, but there's no rate limiter or budget cap visible in this code path — it's
  purely architectural throttling via frequency, not a metered guard.
- **Failure isolation**: an exception in one participant's `_issue_background_task` call is
  logged and **re-raised** (`:164-167`, `raise e` after printing) — meaning `run_sleeptime_agents`
  itself will propagate the exception if a *task creation* fails synchronously, but failures *inside*
  the backgrounded coroutine (`_participant_agent_step`) are caught internally and just recorded on
  the `Run` row (`:281-289`) without propagating to the foreground response — asymmetric error
  handling between "couldn't even start the task" and "the task itself failed."

---

## 3. Scheduling / proactivity: there isn't any, inside Letta

This is the most consequential negative finding for Callback Box comparison purposes.

- `letta/jobs/scheduler.py` is Letta's only cron-like infrastructure, and it is **entirely internal
  plumbing**: an `AsyncIOScheduler` (APScheduler) that runs exactly one recurring job —
  `poll_running_llm_batches` (`:60-72`) — to poll the status of in-flight LLM **batch API** jobs
  (OpenAI/Anthropic batch inference), gated behind a Postgres advisory lock for leader election in
  multi-instance deployments (`:16-105`). There is no agent-level scheduled-wake mechanism anywhere
  in this file or its callers.
- The "Jobs" concept in the schema (`JobType` enum: `JOB`/`RUN`/`BATCH`,
  `letta/schemas/enums.py:227-230`) and the `/jobs`, `/runs` REST routers are a **status-tracking
  abstraction for async work already in flight** (sleeptime runs, batch jobs, tool-sandbox
  executions) — not a way to schedule future or recurring agent invocations. There is no
  `POST /agents/{id}/schedule` or cron-expression field anywhere in the schemas explored.
- No idle-detection or wake-up-after-N-minutes mechanism for agents was found; sleeptime is
  entirely reactive to the foreground agent's own step count (§2.2), never to wall-clock time.
- **How you'd actually build "check my email every morning" on Letta**: entirely outside Letta,
  via an external cron/workflow system that calls the ordinary messages API
  (`POST /agents/{id}/messages`) on a schedule — i.e., Letta expects the *caller* to be the clock.
  One concrete building block for that pattern exists: `sleeptime_document_ingest_async` /
  the manual-ingest endpoint at `letta/server/rest_api/routers/v1/agents.py:2530-2568` shows the
  intended shape — an external system creates `Message` rows directly (simulating an imported
  conversation, e.g. an email digest) via `message_manager.create_many_messages_async`, then
  explicitly re-invokes `SleeptimeMultiAgentV4(...).run_sleeptime_agents(...)`
  (`agents.py:2563-2565`) to fold that content into memory — bypassing the foreground agent's
  normal `step()` entirely. This confirms sleeptime triggering is decoupled enough to be invoked
  by an external scheduler feeding synthetic transcripts, but Letta supplies none of the scheduling
  itself.
- There's also a document-ingest sleeptime variant (`create_document_sleeptime_agent_async`,
  `server.py:1173-...`, prompt at `letta/prompts/system_prompts/sleeptime_doc_ingest.py`) — a
  sleeptime agent whose job is folding uploaded documents into memory rather than conversation
  transcripts, reachable via `sleeptime_document_ingest_async` (`server.py:1116`). Same "reactive
  to an explicit call" model, not a poller.

---

## 4. Identities / users

- `Identity` (`letta/schemas/identity.py:43-52`) represents an *external* user/org/other principal,
  independent of Letta's internal `User`/actor model (which is for API auth/org-scoping). One
  `Identity` can be linked to **many agents** and **many blocks**, and (implicitly) one agent can
  serve many identities — it's a proper many-to-many, not identity-per-agent:
  - `Identity.agents` / `Identity.blocks` relationships via join tables `identities_agents`,
    `identities_blocks` (`letta/orm/identity.py:44-48`).
  - The old `agent_ids`/`block_ids` list fields on the pydantic schema are marked
    `deprecated=True` (`identity.py:47-48`) in favor of the relationship tables — this was clearly
    reworked from a simpler "identity owns a fixed list" model to a real many-to-many.
- `IdentityProperty` (`identity.py:35-39`) gives each identity arbitrary typed key/value metadata
  (string/number/boolean/json) — e.g. "this identity's timezone" or "this identity's plan tier" —
  attachable independent of memory blocks.
- **Practical pattern this enables**: one agent shared across multiple end-users, where each user
  is an `Identity` with their *own* per-identity block(s) (e.g. a `human` block scoped to that
  identity) attached alongside the agent's shared blocks — the multi-tenant-single-agent shape.
  Nothing in the explored code enforces block-per-identity isolation automatically the way
  block-per-sleeptime-pair is auto-attached (§1.3(d)); wiring which blocks belong to which identity
  is left to the caller.

---

## 5. Orchestration cleverness: the voice / low-latency path

The voice pipeline (`letta/agents/voice_agent.py` + `letta/agents/voice_sleeptime_agent.py`) is the
one place Letta clearly optimized for latency by pushing memory work fully out of the hot path —
worth studying even though "memory" itself is out of scope, because the *mechanism* is a
shared-state-under-time-pressure pattern:

- `VoiceAgent.step_stream` (`voice_agent.py:118-...`) is a tight OpenAI/Anthropic streaming loop —
  no DB round-trips for memory beyond compiling the system message once per loop iteration
  (`:170-172`) — designed to keep token-by-token latency low.
- Instead of a sleeptime *group* triggered by turn-count, the voice convo agent's context window is
  bounded by a **message-count buffer** (`max_message_buffer_length=30`,
  `min_message_buffer_length=15`, defaults at `letta/constants.py:89-90`, wired via the group's
  `VoiceSleeptimeManager` config, read in `voice_agent.py:109-110`).
- `Summarizer` in `STATIC_MESSAGE_BUFFER` mode (`letta/services/summarizer/summarizer.py:244-...`)
  is called on every turn; if the buffer exceeds the max, it synchronously trims the **in-memory**
  message list down to `min_message_buffer_length` (cheap, no LLM call, `:277-312`) and then —
  only if a `summarizer_agent` was supplied — **fires the actual memory-write step in the
  background** via `self.fire_and_forget(self.summarizer_agent.step(...))`
  (`summarizer.py:338-340`, `fire_and_forget` at `:124-134`, same `safe_create_task` pattern as
  §2.3). The voice loop **does not await this** — it returns the trimmed context immediately so the
  user-facing turn isn't blocked on memory-write latency.
- The backgrounded `VoiceSleeptimeAgent.step()` (`voice_sleeptime_agent.py:70-110`) then runs a
  constrained 3-tool sequence enforced via tool rules (`:86-91`): `store_memories` (init) →
  `rethink_user_memory` (continue) → `finish_rethinking_memory` (terminal) — i.e. the LLM is forced
  through "extract memory chunks from the evicted transcript, then optionally rewrite the target
  block, then explicitly stop," never left free-form. `store_memories` writes to the **foreground**
  agent's archival memory (passed in as `convo_agent_state`, `:137-146`), while
  `rethink_user_memory` writes directly to a specific target block
  (`self.target_block_label`, default `"human"`) via `block_manager.update_block(...)`
  (`:153-161`) — same optimistic-lock/no-retry semantics as §1.3.
- Net shape: **hot path is pure streaming + cheap in-memory trim; memory persistence is entirely
  decoupled and asynchronous, racing against the next few conversational turns rather than being
  serialized with them.** This is the clearest "shared state under concurrency, deliberately
  accepting eventual consistency for latency" design decision in the codebase.

---

## Summary of the concurrency/orchestration model, end to end

1. **Groups** are the multi-agent container; **`sleeptime`** is the only manager type with a
   maintained execution engine (`SleeptimeMultiAgentV4`). Round-robin/dynamic exist but on a
   deprecated synchronous agent class; supervisor/swarm are unimplemented stubs.
2. **Sleeptime triggering is turn-count-based** (mod `sleeptime_agent_frequency`, default 5), never
   time-based — there is no cron/scheduler for agent wake-ups anywhere in Letta; that's entirely
   the caller's responsibility.
3. **Backgrounding = `asyncio.create_task` in the same process**, held alive by a module-level
   strong-reference set, tracked via `Run` rows for status polling. No external queue, no
   durability across process restarts.
4. **Shared blocks are the IPC substrate**, protected only by per-row SQLAlchemy optimistic
   locking (a `version` column) — conflicting concurrent writes 409/error out with no automatic
   retry; the memory-editing tools do read-modify-write against an in-process snapshot, so true
   merge conflicts are possible, not just detected-and-rejected ones.
5. **Cross-agent messaging is a real HTTP self-call** through the same client SDK any external
   caller would use — no in-process shortcut, no shared memory.
6. **Voice/low-latency path** is the one place this is turned into a deliberate design choice: trim
   context synchronously and cheaply, fire memory persistence into the background,
   accept eventual consistency in exchange for not blocking the user-facing stream.

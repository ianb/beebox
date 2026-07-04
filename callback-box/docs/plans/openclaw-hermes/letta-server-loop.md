# Letta: Server & Agent-Loop Architecture — Deep Dive

Source: clone at `/private/tmp/claude-501/-Users-ianbicking-src-callback-mono/b71d2662-11ec-4f27-9a9a-ef9beea687b1/scratchpad/letta`. All `file:line` citations relative to that root.

Framing note: this repo is the **legacy Letta server** — the README says active development moved to the closed(-er) `letta-code` repo, and the V1 API server here is what backs their existing SDKs. That legacy status shows: multiple coexisting agent-loop generations (`letta_agent_v2.py`, `v3`, four sleeptime variants), dead orchestration code, and OSS stubs whose real implementations are cloud-only (LLM router, "Lettuce"). Still, the load-bearing machinery is all here and heavily instructive. Memory mechanics are deliberately out of scope except where inseparable from the loop; the git-backed memory *storage* layer is covered (§9) because it converged on our files+git bet.

---

## 1. Agents as stateful services

### 1.1 Server: FastAPI, manager-object DI

FastAPI app built in `create_application()` at `letta/server/rest_api/app.py:411-420`. A module-level `SyncServer` singleton (`app.py:131-132`) is injected into every route via `Depends(get_letta_server)`; its modern role is mostly a bag of manager objects (`agent_manager`, `run_manager`, `user_manager`, …) rather than an executor.

~30 v1 routers (`letta/server/rest_api/routers/v1/__init__.py:34-68`): `agents`, `messages`, `runs`, `jobs`, `steps`, `tools`, `sources`, `blocks`, `conversations`, `groups`, `providers`, `mcp_servers`, `sandbox_configs`, OpenAI-compatible `chat_completions`, a `git_http` router (see §9), etc. Each v1 router is mounted twice — versioned and under an unversioned `/latest` alias (`app.py:852-864`), a cheap API-versioning hedge.

### 1.2 Agent = DB row; behavior class chosen at request time

ORM is async SQLAlchemy 2.0 (`letta/orm/`, 40+ models). The Agent model (`letta/orm/agent.py:45-53`) carries: string PK `agent-{uuid}`, `agent_type`, `system` (system prompt), **`message_ids` — a JSON list that IS the in-context window ordering** (`agent.py:71`), `llm_config`/`embedding_config` as serialized columns, `tool_rules`, `compaction_settings`, and denormalized run-tracking (`last_run_completion`, `last_run_duration_ms`, `last_stop_reason`, lines 102-110). Relationships: tools/sources/blocks via join tables, `runs` and `conversations` as cascade-delete children (lines 128-203). Notably messages are *not* a relationship on Agent — context membership is the `message_ids` JSON column; message rows are queried directly.

**Backend is effectively Postgres-only.** `letta/server/db.py:20-58` only ever constructs a Postgres async engine (default `postgresql+pg8000://letta:letta@localhost:5432/letta`, `letta/settings.py:472-478`). SQLite survives as vestigial enum members (`settings.py:275, 492-493`) but the engine layer never builds it.

**Alembic: 167 migrations, one linear chain.** The 2024-10 baseline (`alembic/versions/9a505cc7eca9_*.py`) shows the original design: `agents` with plain `memory: sa.JSON()` and `tools: sa.JSON()` blobs, a minimal `jobs` table, `passages` with a pgvector `Vector(dim=4096)` column. The second migration begins the JSON-blob→normalized-ORM shift; the 2026 tail is `CREATE INDEX CONCURRENTLY` via raw autocommit SQL and idempotency-guarded column adds — the classic arc of a prototype hardening into a high-write Postgres service.

**The clever bit:** `AgentLoop.load()` (`letta/agents/agent_loop.py:15-63`) is a factory that inspects persisted `agent_state.agent_type` / `enable_sleeptime` and returns the concrete *execution class* — `LettaAgentV3`, `LettaAgentV2`, or a sleeptime multi-agent variant. The agent's behavioral implementation is data, chosen per request from the DB row.

### 1.3 A turn, server-side

`POST /v1/agents/{agent_id}/messages` (`letta/server/rest_api/routers/v1/agents.py:1648-1668`) → load agent state → `AgentLoop.load(agent_state, actor)` → `agent_loop.step(request.messages, max_steps=…, run_id=…)` (`agents.py:1785-1798`). Streaming requests instead delegate to `StreamingService.create_agent_stream` (`agents.py:1717-1726`).

Inside the agent (`letta/agents/letta_agent_v3.py:222-356`): prepare in-context messages, build an `llm_adapter`, then `for i in range(max_steps):` call the private `_step()` — the documented single funnel "that all public methods (step, stream_steps, stream_tokens) funnel through" (`letta_agent_v3.py:895-909`). Sync and streaming share the same `_step`; chunks are either accumulated or yielded through. There is exactly **one message-persistence point**: `create_many_messages_async`, annotated "ONLY place where messages are persisted" (`letta_agent_v3.py:779-786`). That single-funnel + single-write-point discipline is the most imitable structural decision in the codebase.

### 1.4 Streaming: SSE with mid-stream status and composable keepalive

- `StreamingResponseWithStatusCode` (`letta/server/rest_api/streaming_response.py:232, 244-266`) — subclasses FastAPI's StreamingResponse so the HTTP status can be decided *after* streaming starts; an error before first byte still returns a real 4xx/5xx instead of a 200-then-garbage.
- Keepalive is a **wrapper**, not loop logic: `add_keepalive_to_stream()` (`streaming_response.py:51-56`) wraps any stream, emits a `LettaPing` SSE event every 30s (line 129), and kills a silent stream after `max_stream_silence` (default 1800s).
- Generic encoder: `sse_formatter` / `sse_async_generator` (`letta/server/rest_api/utils.py:60-114`) adapts any async generator of Pydantic models into SSE lines and records time-to-first-token into a tracing span.
- Provider translation lives in `letta/interfaces/` — e.g. `AnthropicStreamingInterface.process()` (`anthropic_streaming_interface.py:63, 232-236`) turns raw Anthropic SDK stream events into typed `LettaMessage` domain objects, which then flow through the generic SSE encoder. Pipeline: provider events → typed domain messages → generic SSE encoder → status-flexible response. Each layer is separately composable.

### 1.5 Jobs/runs, background execution, resumability

Schemas: `JobBase` (`letta/schemas/job.py:19-42`) with `status`, `background`, webhook callback fields, and ns-precision timing (`ttft_ns`, `total_duration_ns`). `JobStatus` (`letta/schemas/enums.py:133-149`): created/running/completed/failed/pending/cancelled/expired with an `is_terminal` predicate. `Run` is a sibling over the same base with its own `RunManager` (`letta/services/run_manager.py:38` — `create_run`, `cancel_run`, `get_run_usage`, …).

**No external queue.** No Celery/RQ. Background mode = in-process asyncio task + Redis as a durable chunk log. When `request.background=True` (`letta/services/streaming_service.py:380-410`): `safe_create_task(create_background_stream_processor(...))` detaches the agent loop inside the same server process, draining its output into a Redis stream; the HTTP response is just a Redis-backed view of that stream.

**Resumability is a seq-numbered chunk log with a cursor:**
- `RedisSSEStreamWriter` (`letta/server/rest_api/redis_stream_manager.py:26-196`) batches chunks via pipelined `xadd` to `sse:run:{run_id}`, monotone `seq_id` per chunk (lines 63-64, 109-110), 3-hour TTL, maxlen 10000, periodic flush task.
- The processor synthesizes terminal `[DONE]`/error events on crash or cancellation and updates Run status in its `finally` (lines 283-461, 428-445) — clients always get a terminal event even when the loop dies.
- Reader (`redis_sse_stream_generator`, lines 463-527) polls `xrange` from a `starting_after` cursor every 0.1s — polling, not pub/sub.
- Reattach endpoint `POST /v1/runs/{run_id}/stream` (`letta/server/rest_api/routers/v1/runs.py:357-393`): only `background=True` runs, only within 3 hours, 503 if Redis is the noop client.

The pattern — durable append-only event log keyed by run, seq-id cursor, terminal-event synthesis, TTL — is substrate-agnostic. It would implement identically over an append-only JSONL file per run in our filesystem world.

There's also a **duplicate-request recovery** trick (§4.2) that reattaches an idempotent retry to the existing run's stream instead of erroring.

---

## 2. Model/provider layer

### 2.1 Providers and per-agent config

`ProviderType` (`letta/schemas/enums.py:53-78`) enumerates ~24 providers: anthropic, openai, azure, bedrock, google_ai/vertex, groq, mistral, together, deepseek, xai, zai, openrouter, cerebras, letta's own proxy, plus local ollama/vllm/sglang/lmstudio. Each has a schema in `letta/schemas/providers/<name>.py` subclassing `Provider` (`base.py:23`), which distinguishes `base` vs `byok` providers and stores **encrypted** credentials (`api_key_enc: Secret`); raw `api_key` access logs a deprecation warning via `__getattribute__` override (`base.py:41-52`).

Per-agent model choice is `AgentState.llm_config: LLMConfig` (`letta/schemas/llm_config.py:19`, fields at 28-137): `model`, `model_endpoint_type` (closed Literal of ~25 kinds), `context_window`, `handle`, temperature, reasoning knobs, `put_inner_thoughts_in_kwargs` (whether "thinking" is simulated as a tool-call kwarg vs native), `parallel_tool_calls`, `response_format`, `strict`. A cluster of validators (lines 139-261) auto-derives per-model-family defaults — e.g. forcing `put_inner_thoughts_in_kwargs=False` for Claude 3.7+/4 because native extended thinking replaces the simulated-thought hack, and silently rewriting discontinued Google model IDs.

**Reasoning-toggle normalization**: `LLMConfig.apply_reasoning_setting_to_config` (`llm_config.py:572-733`) is one big policy function translating a single boolean "reasoning on/off" into OpenAI `reasoning_effort` vs Anthropic thinking budget vs Gemini `thinking_config` vs ZAI — and *warns and refuses* to disable reasoning for o1/o3/gpt-5 models where the API can't (line 667), rather than silently no-op'ing. Good pattern: cross-provider capability differences hidden behind one flag with an honest per-provider table.

### 2.2 Handles and resolution

Handles are `"provider/model"` strings, resolved in `ProviderManager.get_llm_config_from_handle` (`letta/services/provider_manager.py:965-1058`):
- `letta/auto`, `letta/auto-fast`, `letta/auto-chat` are synthetic handles returning a placeholder config, resolved to a concrete model *per step* by the router (§2.5).
- DB lookup by handle; miss falls through to BYOK: split on `/`, find the user's provider row, and call `typed_provider.list_llm_models_async()` **live** to match the model (lines 1030-1044) — BYOK model lists are never persisted, so adding a model to your OpenRouter account needs no Letta-side sync. Base providers, by contrast, have a persisted `ProviderModelORM` table with `last_synced`.
- Provider-specific quirks (ollama/vllm's "append `/v1`" OpenAI-compat URL, default max tokens) live on the provider subtype object (`cast_to_subtype()`, lines 1049-1058), not special-cased in the agent loop.

Concrete clients come from the factory `LLMClient.create()` (`letta/llm_api/llm_client.py:13-146`) — a match statement with lazy per-branch imports (boto3, google-genai etc. stay off the hot path), defaulting to `OpenAIClient`, which is explicitly reused for OpenRouter.

### 2.3 Context-window management: reactive, exception-driven

Two separate systems:

**Advisory accounting** — `ContextWindowCalculator.calculate_context_window` (`letta/services/context_window_calculator/context_window_calculator.py:249`) is a UI/introspection service: it re-parses the compiled system message by scanning XML-ish section tags to attribute tokens to buckets (system prompt vs memory vs tool schemas vs messages), then `asyncio.gather`s 9 independent token counts (lines 320-363). It does not gate anything.

**Enforcement is a caught exception, not a pre-flight check.** In `letta_agent_v3.py` (~line 1218): the provider itself rejects the oversized request; the mapped `ContextWindowExceededError` is caught, compaction runs, and the *same step* retries — bounded by `summarizer_settings.max_summarizer_retries` (retry loop at line 1093), with a compaction-event message yielded to the client first (line 1230). The server owns compaction entirely; the client just sees an event. Trigger is reactive: let the provider be the source of truth on "too big" rather than trusting local tokenization.

### 2.4 Token accounting

Counting strategies (`letta/services/context_window_calculator/token_counter.py`): `AnthropicTokenCounter` (line 41) calls Anthropic's real count-tokens API, Redis-cached by content SHA-256 with 1h TTL; `GeminiTokenCounter` likewise; `TiktokenCounter` (line 178) exists but isn't wired into the live selector; everything else gets `ApproxTokenCounter` (line 87) — `ceil(utf8_bytes/4)`, explicitly modeled on codex-cli's heuristic. So display-grade counting is deliberately cheap; billing-grade numbers come from provider responses.

Billing path: every provider client implements `extract_usage_statistics()` (`llm_api/llm_client_base.py:83`; Anthropic at `anthropic_client.py:1238`) normalizing into `LettaUsageStatistics` (`letta/schemas/usage.py`) — including unifying OpenAI `cached_tokens` vs Anthropic `cache_read/cache_creation` (line 13) and OpenAI vs Gemini reasoning-token fields. Persisted **per step**: `Step.prompt_tokens/completion_tokens/total_tokens` + detail JSON (`letta/orm/step.py:53-68`). Crucially, when routing swaps models mid-step, a `finally` block updates the step row with the **resolved** model (`letta_agent_v3.py:1076-1087`) so billing charges for the model that actually ran. Full request/response payloads are separately traceable via `ProviderTrace` (`llm_client_base.py:87-135`) with pluggable backends (Postgres/ClickHouse/socket).

### 2.5 Router, fallback, and normalization

- **Canonical internal schema is OpenAI-plus-extensions**: every client implements `convert_response_to_chat_completion()` (`llm_client_base.py:342-352`) into `ChatCompletionResponse` (`letta/schemas/openai/chat_completion_response.py`) — Anthropic `tool_use` blocks become OpenAI-style `function.arguments` JSON strings, with extra `reasoning_content`/`redacted_reasoning_content` fields OpenAI doesn't have (`anthropic_client.py:1187-1286`). The loop never branches on provider.
- **Auto-mode + circuit-breaker fallback** (`letta_agent_v3.py:1042-1213`): agents configured with `letta/auto` get a concrete model resolved each step; on rate-limit/server-error/overload the loop calls `record_failure` and swaps `active_llm_config`/`active_llm_client` to a fallback **mid-retry-loop** — the same step silently retries against a different provider. The OSS checkout only ships the stub (`letta/services/llm_router/llm_router_client_base.py:1-97` — every hook raises "requires Redis"); the real Redis-backed router is cloud-only. The stub's `apply_reroute_rules` interface takes the full message list, hinting at content-based rerouting (images → vision-capable model).
- **Local-model tool calling via GBNF grammars**: for llama.cpp-family backends, `letta/local_llm/grammars/gbnf_grammar_generator.py` compiles the agent's tool signatures into a llama.cpp grammar that constrains sampling so the model *cannot* emit invalid tool-call JSON (`chat_completion_proxy.py:30, 94-120`) — structural enforcement instead of parse-and-repair. Non-grammar backends get per-model-family prompt wrappers (`local_llm/llm_chat_completion_wrappers/`) plus best-effort post-hoc repair (`function_correction`). Last-resort truncated-JSON repair exists for all providers (`llm_client_base.py:439-464`, brace/quote-count fixing).

---

## 3. The step loop

Two live generations: `LettaAgentV2` (default) and `LettaAgentV3` (subclasses V2; docstring at `letta_agent_v3.py:100-110` notes "No heartbeats (loops happen on tool calls)" — i.e. V3 moved to Claude-style implicit continuation). V2 is the clearest expression of the classic MemGPT heartbeat mechanism.

### 3.1 Shape

`LettaAgentV2.step()` (`letta_agent_v2.py:191-297`): `for i in range(max_steps)`, call `_step()`, `if not self.should_continue: break`. `stream()` (300-442) is the identical structure yielding SSE chunks. `_step()` (444-726) per iteration: refresh system prompt → build request (forcing a tool call if only one tool is valid, 517-531) → LLM call with retry → `_handle_ai_response()` executes tools, decides continuation, persists → yield messages. A `finally` block (666-726) always records a `StepProgression` telemetry enum (START→STREAM_RECEIVED→RESPONSE_RECEIVED→STEP_LOGGED→LOGGED_TRACE→FINISHED, `letta/schemas/step.py:68-74`) so a crashed step leaves a legible partial-progress record.

### 3.2 Heartbeats: continuation as a tool parameter

The signature MemGPT mechanism, worth understanding precisely because it's the *opposite* of the Claude Agent SDK's design:

- Every non-terminal tool's JSON schema gets a synthetic `request_heartbeat: bool` parameter injected at schema-build time (`letta/services/helpers/tool_parser_helper.py:103-111`), documented to the model at `letta/constants.py:218`: "You MUST set this value to True if you want to send a follow-up message or run a follow-up tool call… If False (default), execution ends immediately."
- After the LLM responds, `_pop_heartbeat` strips the parameter out of the tool args before execution (`letta_agent_v2.py:1126`, `agents/helpers.py:496-498`).
- `_decide_continuation` (`letta_agent_v2.py:1241-1285`) starts from `continue_stepping = request_heartbeat`, then layers **tool-rule overrides**: a terminal tool forces stop even with heartbeat=true; child/continue rules force continuation; a violated rule forces one corrective turn; uncalled required tools force continuation.
- When continuing, a synthetic system message is injected explaining *why* (`heartbeat_reason`), prefixed `NON_USER_MSG_PREFIX = "[This is an automated system message hidden from the user] "` (`constants.py:244`).

So in Letta-classic, **the model explicitly requests its own next turn inside each tool call**, and the server arbitrates against declarative tool rules. V3 dropped this for the now-standard "a tool call implies continuation; a plain assistant message yields." Inner monologue is a separate `reasoning_content` content block (lines 1069, 1222), not embedded in tool args (except for old models via `put_inner_thoughts_in_kwargs`).

The tool-rules engine (`letta/helpers/tool_rule_solver.py`; rule types like `ChildToolRule`, `MaxCountPerStepToolRule`, `ConditionalToolRule` visible in the .af schema) is a declarative constraint layer over tool sequencing — a mini-workflow language enforced by the loop rather than prompt-begged.

### 3.3 Tool execution

`ToolExecutionManager.execute_tool_async` (`letta/services/tool_executor/tool_execution_manager.py:94-160`) routes by `ToolType` (lines 32-65): built-in Letta tools → in-process executor classes, `EXTERNAL_MCP` → MCP executor, user Python tools → `SandboxToolExecutor`. Sandbox backends (`letta/services/tool_sandbox/`): Modal (two generations, with versioned app deployments — tool-code changes trigger a Modal redeploy, `modal_version_manager.py`), E2B, or local subprocess.

Local sandbox details worth noting (`local_sandbox.py:181-268`): real `asyncio.create_subprocess_exec` with a per-tool venv; the tool's return value comes back over stdout via a hand-rolled framed protocol (marker + 4-byte big-endian length prefix + checksum, line 268) so the function's own `print()` noise can't corrupt the result channel. `safe_pickle.py` caps pickle size (10MB) and recursion depth (50, via a context manager that temporarily lowers `sys.setrecursionlimit`) before shipping results to Modal — defense against adversarial tool outputs.

**Tool errors never raise into the loop**: `execute_tool_async` catches and returns `ToolExecutionResult(status="error", func_return=error_message)` (lines 143-155), which persists as a normal `role="tool"` message — the model sees the error text next turn and self-corrects. The loop only dies on *no tool call at all* in V2 (`StopReasonType.no_tool_call`, `letta_agent_v2.py:582-584`).

### 3.4 Errors, retries, limits

- `DEFAULT_MAX_STEPS = 50` (`constants.py:75`); `is_final_step` forces stop with `StopReasonType.max_steps`.
- Run-cancellation checked at the top of every `_step` (506-509); a per-step credit check can also stop the loop.
- Context overflow → compact + same-step retry (§2.3).
- Provider errors map to typed exceptions (`anthropic_client.py:~990-1097`); rate-limits/server errors feed the router fallback (§2.5); the legacy path has exponential backoff capped at 20 retries (`llm_api_tools.py:38-118`).
- Gemini's `MALFORMED_FUNCTION_CALL` gets a dedicated retry loop that injects a warning hint into the reprompt (`google_vertex_client.py:133-198`).
- Malformed tool-call JSON is repaired programmatically, not re-prompted: `_safe_load_tool_call_str` (`agents/helpers.py:378-393`) strips concatenated-object artifacts, retries `json.loads`, falls back to `{}`.

### 3.5 Per-step persistence = implicit resumability

Messages persist inside `_handle_ai_response` on every branch (`letta_agent_v2.py:1234-1236`), before the loop proceeds — never batched to run-end. Approval responses are persisted extra-early "to prevent agent from getting into a bad state" (636-646). The `finally` persists in-flight messages flagged `is_err=True` on crash (690-701). There is no explicit crash-resume API; instead, because every completed step is committed, a fresh `step()` rebuilds context from the DB and a crash loses at most one in-flight step. Same property our git-commit-per-step gives us.

---

## 4. Concurrency & multi-user

### 4.1 Multi-tenancy: mixin column + one central predicate

`Organization` is the tenant root; everything cascades from it (`letta/orm/organization.py:31-81`). Scoping is structural: `OrganizationMixin` guarantees the FK column (`letta/orm/mixins.py:19-24`), and a single `apply_access_predicate` classmethod on the shared base applies `WHERE organization_id = actor.org` (or user-level) for every CRUD entrypoint (`letta/orm/sqlalchemy_base.py:875-902`). Forgetting to pass an actor on an org-scoped model logs a `SECURITY:` warning (lines 256-258) — advisory, not fail-closed. Centralizing the predicate is the good idea; the warn-don't-block fallback is the soft spot.

### 4.2 Per-conversation locking: fail-fast Redis mutex + idempotent-retry dedup

Concurrency control is a **non-blocking Redis lock per conversation** (`letta/data_sources/redis_client.py:~194`): second concurrent request gets an immediate `ConversationBusyError` (`letta/errors.py:81`) — no queueing. Without Redis, the noop client silently degrades to *no locking* (`redis_client.py:593-610`) — a real gap in self-hosted mode.

The clever companion (`letta/services/streaming_service.py:60-92, 264-313`): before touching the lock, the server computes a request token from a hash of the messages' client-supplied `otid`s and checks Redis for an existing run with that token — an **identical retried request re-attaches to the in-flight run's stream** instead of getting a busy error. The dedup check deliberately runs before lock acquisition "so duplicate requests never touch the lock." Idempotency via client-generated operation IDs + reattach-instead-of-reject is directly stealable.

Below that: SQLAlchemy optimistic versioning surfaced as `ConcurrentUpdateError` (`sqlalchemy_base.py:779-780`), and narrow `SELECT … FOR UPDATE` for tool-name uniqueness with **explicit lock-ordering by sorted name** to avoid deadlocks (`tool_manager.py:1218-1222`, with an unusually good comment explaining the A(a,b,c)/B(b,c,a) deadlock).

### 4.3 Multi-agent groups: sequential, not parallel

`letta/groups/` dispatches on `manager_type` (`helpers.py:16-79`): `round_robin` (fixed rotation, each participant replays shared `chat_history` from its own `message_index` bookmark, `round_robin_multi_agent.py:14-80`), `dynamic` (a manager agent picks the next speaker — by **substring-matching agent names in the manager's free-text reply**, `dynamic_multi_agent.py:18-120`, notably brittle), `supervisor` (entire `step()` is commented out — dead code), and four coexisting sleeptime generations. Everything is single-process sequential turn-taking; "shared context" is transcript-string splicing (`helpers.py:84-166`), not shared state or a message bus. This part of Letta is the least finished.

---

## 5. Agent files (.af): portable agent bundles

`AgentFileSchema` (`letta/schemas/agent_file.py:431-448`) — one JSON file containing `agents[]`, `groups[]`, `blocks[]`, `files[]`, `sources[]`, `tools[]` (with full `source_code` + `json_schema`), `mcp_servers[]`, `skills[]`, metadata. A whole **multi-agent system with its orchestration config is one exportable artifact**.

Details worth stealing:
- `SkillSchema` (~365-398): a skill is either inlined as `files: Dict[path, content]` (must include `SKILL.md`) or referenced by `source_url` (`"letta:slack"`, `"anthropic:pdf"`, `"owner/repo/path"`) — portable skill bundles, directly analogous to Claude Code skills.
- `MCPServerSchema.from_mcp_server()` (~401-421) **strips auth on export** (env vars, tokens, custom headers) — shareable-by-construction.
- `AgentSchema` records `in_context_message_indices` — the export captures which messages were in-context vs archived, so imports resume with the same working set.
- The engine, `AgentSerializationManager` (`letta/services/agent_serialization_manager.py`, 1072 lines), is mostly an **ID-remapping layer**: DB UUIDs → stable file-local IDs on export, re-resolved against the target DB on import, with referential-integrity validation. Portable identity as an explicit translation layer, not an assumption.

---

## 6. Background execution seams (Lettuce, Temporal, webhooks)

- **Lettuce** (`letta/services/lettuce/lettuce_client_base.py`): an all-noop OSS stub whose interface is "run the entire agent step loop elsewhere" (`step(agent_state, actor, input_messages, max_steps)`, plus `get_status`/`cancel`). The cloud implementation is closed. Architecturally it's a seam: in-process loop execution and remote/scaled execution behind one interface, call sites untouched.
- **Webhooks** (`WEBHOOK_SETUP.md`, `letta/services/webhook_service.py`): fire after every step, via two paths — as a Temporal activity when Temporal orchestrates (getting retry/replay free) or direct from StepManager otherwise. Documented invariants: step is marked complete in DB *first*; webhook failure never blocks step completion.
- **Plugins** (`letta/plugins/plugins.py`, 72 lines): DI-by-dotted-string — `{"summarizer": {"target": "letta.services.summarizer.summarizer:Summarizer"}}`, resolved via importlib + runtime `Protocol` conformance check, operator-overridable from settings. Swappable internals without a DI framework.
- **Observability** (`letta/otel/`): a pervasive `@trace_method` decorator + `MetricRegistry` singleton instead of manual span plumbing.

---

## 7. Git-backed state storage (MemFS) — as a storage system

`letta/services/memory_repo/` is a git-repo-per-agent storage layer, and its design choices are the most directly comparable to our files+git bet.

**Layout**: each agent's repo is stored as **raw `.git` object files in a blob store** (`{org_id}/{agent_id}/repo.git`, `git_operations.py:93`) behind a `StorageBackend` ABC (`storage/base.py`; OSS = local filesystem at `~/.letta/memfs`, cloud = GCS/S3). There is no persistent checkout: every operation materializes the repo into a `tempfile.mkdtemp()`, operates, re-serializes, deletes.

**They shell out to real `git`.** `_run_git` (`git_operations.py:26-45`) subprocesses the CLI; the module docstring says they migrated *away from dulwich* "for better compatibility and maintenance." Blocking git calls run in `asyncio.to_thread`. CLI availability is checked once and cached (`_check_git`, lines 73-89). Validation of our own shell-out-to-git approach over embedded libraries.

**Write path** (`commit()` → `_commit_with_lock()`, lines 351-536):
1. Redis lock per agent — **conflicts are prevented by serialization, not resolved by merge**. There is zero branch/merge/conflict code; history is strictly linear, one writer at a time, second writer gets "busy."
2. Parallel-download all objects into a fresh `.git`.
3. Snapshot mtimes of everything under `.git/` before mutating, then upload only changed files afterward (`_upload_delta`, lines 212-248). Because git objects are content-addressed and immutable, most files are unchanged between commits — **mtime-diffing the `.git` dir gives cheap delta-sync of the whole repo** without diffing your data model. The standout efficiency idea.
4. `git reset --hard`, apply `FileChange`s, commit; return a `MemoryCommit` (sha, parent_sha, message, `author_type` agent-vs-user inferred from author email, additions/deletions as raw char-count deltas).

**Read path**: `get_files(ref)` accepts any git ref; `get_history` parses `git log`. Weakness: even `get_head_sha()` reconstitutes the entire repo from object storage first (lines 606-628) — no lightweight ref pointer.

**Content format**: one markdown file per memory block at repo root, YAML frontmatter (label, description, timestamps, metadata) + body (`block_markdown.py:27, 153`); the old fixed char-`limit` field is deliberately excluded — "deprecated for git-based memory" — i.e. moving to git-backed files relaxed the fixed-size-block constraint. Plus a `.letta/config.json` bootstrap file (`git_operations.py:138-145`). Markdown+frontmatter in a git repo: they converged on exactly our substrate.

There is also a `git_http` router in the v1 route list (`routers/v1/__init__.py`) — serving the repo over git's HTTP protocol, so standard git clients can presumably clone an agent's state.

---

## 8. Ideas worth stealing (ranked)

1. **Single `_step` funnel with one persistence point** — sync, streaming, and background all through one code path; exactly one place writes messages (`letta_agent_v3.py:779-786, 895-909`).
2. **Resumable streams as a durable seq-id'd chunk log + cursor reattach + terminal-event synthesis on crash** (`redis_stream_manager.py`) — maps directly onto an append-only JSONL per run in a filesystem world.
3. **Idempotent-retry dedup before locking** — client-supplied operation IDs hashed into a request token; a duplicate reattaches to the live run instead of erroring (`streaming_service.py:60-92`).
4. **Mtime-delta sync of the `.git` directory** for cheap repo replication to blob storage (`git_operations.py:203-248`); plus their conclusion that linear history + a lock beats merge machinery, and that shelling to git beats embedded libraries.
5. **Tool errors as data, never exceptions** — error text flows back as a tool message; the model self-corrects; the loop only halts on structural failures.
6. **Billing records the resolved model** — when fallback routing swaps providers mid-step, a `finally` updates the step row with what actually ran (`letta_agent_v3.py:1076-1087`).
7. **Reactive context enforcement** — let the provider's context-length rejection trigger compaction+retry rather than trusting local token math; local counting is display-grade only (bytes/4 heuristic).
8. **Declarative tool rules** arbitrating continuation (terminal/child/required/max-count) — workflow constraints enforced by the loop, not prompted.
9. **`.af` export**: stable file-local IDs via an explicit remapping layer, secrets stripped structurally, in-context indices preserved, whole multi-agent systems as one artifact.
10. **Behavior class selected from persisted state** (`AgentLoop.load`), and **keepalive/status-code handling as composable stream wrappers** rather than loop logic.
11. **Execution seams as noop stubs** (Lettuce, llm_router) — the OSS/self-hosted build runs in-process; cloud swaps in remote execution/routing behind identical interfaces.

Cautionary tales: silent degradation to no-locking without Redis; advisory-only tenancy warnings; free-text name matching for agent routing; four coexisting sleeptime implementations and a commented-out supervisor — generational strata accumulating in-tree instead of being cut.

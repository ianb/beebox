# Letta Tool System — Technical Reference

Source: Letta repo (formerly MemGPT), Python monorepo, cloned locally for this research.
All citations are `path/from/repo/root.py:LINE`, relative to the Letta repo root (not this monorepo).
Scope: tool definition/persistence, tool rules, sandboxed execution, MCP, argument/return handling, and
other structurally interesting bits of the tool-calling loop. Memory/context-window mechanics are
intentionally excluded.

---

## 1. Tool model

### 1.1 Tool schema (`letta/schemas/tool.py`)

The base pydantic model `Tool` (`letta/schemas/tool.py:35-107`) extends `BaseTool(LettaBase)`
(`:31-32`, id prefix from `PrimitiveType.TOOL`). Key fields:

- `id: str` (`:38`)
- `tool_type: ToolType` — default `ToolType.CUSTOM` (`:39`)
- `description: Optional[str]` (`:40`)
- `source_type: Optional[str]` (`:41`) — `"python"` / `"typescript"` / `"json"`
- `name: Optional[str]` (`:42`), `tags: List[str]` (`:43`)
- `source_code: Optional[str]` (`:46`), `json_schema: Optional[Dict]` (`:47`) — the OpenAI-style function
  schema actually sent to the LLM
- `args_json_schema: Optional[Dict]` (`:48`) — schema of the args when a tool is defined via a Pydantic
  "args schema" rather than a function signature
- `return_char_limit: int` — default `FUNCTION_RETURN_CHAR_LIMIT` (`:51-56`, see §5.3)
- `pip_requirements` / `npm_requirements: list[...] | None` (`:57-58`)
- `default_requires_approval: Optional[bool]` (`:59-61`) — a *tool-level* default that seeds the
  `RequiresApprovalToolRule` when an agent is created (distinct from the tool-rule itself, which is
  per-agent)
- `enable_parallel_execution: Optional[bool]` — default `False` (`:62-64`, see §6.1)
- `created_by_id` / `last_updated_by_id: Optional[str]` (`:67-68`)
- `metadata_: Optional[Dict[str, Any]]` (`:69`), `project_id: Optional[str]` (`:72`)

A `model_validator(mode="after")` named `refresh_source_code_and_json_schema` (`:74-107`) regenerates
`json_schema` on the fly for all **built-in** tool types (loading the tool's implementing module and
introspecting the named function via `get_json_schema_from_module`) but explicitly skips `CUSTOM` tools —
comment at `:76-84` states custom-tool schema generation happens once, at creation/update time inside
`ToolManager`.

Sibling schemas in the same file:
- `ToolCreate` (`:110-182`) — requires `source_code`; `json_schema` is auto-generated if omitted for
  Python, but TypeScript **requires** an explicit schema (enforced by
  `validate_typescript_requires_schema`, `:132-143`, since docstring-based generation only works for
  Python). `ToolCreate.from_mcp(mcp_server_name, mcp_tool)` classmethod (`:145-169`) builds a `ToolCreate`
  from an MCP tool definition (see §4.3).
- `ToolUpdate` (`:185-209`) — same optional fields, `extra="ignore"`.
- `ToolRunFromSource` (`:213-224`) — ad hoc "run this source directly" execution, bypassing persistence.
- `ToolSearchRequest` / `ToolSearchResult` (`:227-245`) — semantic/FTS/hybrid tool search returning
  `fts_rank`, `vector_rank`, `combined_score` (reciprocal-rank fusion) — i.e. tools can be looked up by
  natural-language query, not just by id/name (relevant if an agent has a very large tool library and
  needs retrieval rather than a fixed list).

### 1.2 JSON-schema derivation from Python source (`letta/functions/schema_generator.py`)

`generate_schema(function, name=None, description=None, tool_id=None)` (`schema_generator.py:409`
onward) is the docstring→schema compiler:

- Requires a **Google-style docstring**; validated (soft-warn, not hard-fail) via
  `validate_google_style_docstring` (`:15`, invoked at `:412`).
- Parses the docstring using the third-party `docstring_parser` library (`from docstring_parser import
  parse`, `:4`; `docstring = parse(function.__doc__)`, `:426`).
- Builds `description` from `docstring.short_description` + `long_description`
  (falls back to `"No description available"`), and appends an `Examples:` section extracted via
  `extract_examples_section` (`:428-442`, helper defined at `:526`) — i.e. worked examples in the
  docstring get folded straight into the schema description shown to the LLM.
- Enumerates parameters via `inspect.signature(function)` (`:423`), skipping reserved kwargs
  (`TOOL_RESERVED_KWARGS`, `:453-454`).
- Each parameter **must** carry a type annotation (`TypeError` if missing, `:457-458`) and a matching
  `Args:` docstring entry (`ValueError` if missing, `:464-465`) — schema generation is fail-fast/strict at
  definition time, not best-effort.
- Pydantic `BaseModel` parameter annotations expand via `pydantic_model_to_json_schema` (`:227`, called
  at `:476`); plain types go through `type_to_json_schema_type` (`:78`, called at `:499`), which
  recursively handles `Optional`, `List`, `Dict`, tuples, and nested Pydantic models.
- Related helpers in the same file: `pydantic_model_to_open_ai` (`:197`),
  `generate_schema_from_args_schema_v2` (`:558`, for the "args schema" tool-definition style),
  `normalize_mcp_schema` (`:586`) and `generate_tool_schema_for_mcp` (`:694`, used by `ToolCreate.from_mcp`
  — see §4.3), the latter also running health-check validation via `letta/functions/schema_validator.py`'s
  `validate_complete_json_schema` (called at `:880`).
- For built-in tools, the same `generate_schema` logic is invoked per-module via
  `get_json_schema_from_module(module_name, function_name)` in `letta/functions/functions.py` (imported
  at `letta/schemas/tool.py:19`) — it imports the real module (e.g.
  `letta.functions.function_sets.base`) and runs schema generation against the live function object. This
  is what backs `refresh_source_code_and_json_schema` (§1.1).

### 1.3 ORM persistence

`Tool` ORM class (`letta/orm/tool.py:17-61`), extends `SqlalchemyBase, OrganizationMixin, ProjectMixin`:
- `__tablename__ = "tools"` (`:25`), `__pydantic_model__ = PydanticTool` (`:26`).
- Constraints (`:30-36`): unique `(name, organization_id)`; unique `(organization_id, project_id, name)`
  with Postgres NULLS-NOT-DISTINCT; indexes on `created_at+name`, `organization_id`,
  `organization_id+name`.
- Columns: `name` (`:38`), `tool_type` (`:39-43`, `String`, default `ToolType.CUSTOM`),
  `return_char_limit` (`:44`), `description` (`:45`), `tags` as `JSON` (`:46`), `source_type` (`String`,
  default `ToolSourceType.json`, `:47`), `source_code` (`:48`), `json_schema` as `JSON` default `{}`
  (`:49`), `args_json_schema` as `JSON` default `{}` (`:50`), `pip_requirements`/`npm_requirements` as
  `JSON` (`:51-54`), `default_requires_approval` (`:55`), `enable_parallel_execution` (`:56-58`),
  `metadata_` as `JSON` (`:59`).
- Relationship: `organization` back-populated, `lazy="selectin"` (`:61`). Class docstring flags a TODO for
  polymorphic inheritance to separate "always available" vs. org-scoped tool subsets (`:18-23`).

**Agent↔Tool many-to-many join table** — `ToolsAgents` (`letta/orm/tools_agents.py:7-18`):
- `__tablename__ = "tools_agents"` (`:10`).
- `UniqueConstraint("agent_id","tool_id", name="unique_agent_tool")` + `Index("ix_tools_agents_tool_id",
  "tool_id")` (`:11-14`).
- Columns: `agent_id: str` FK → `agents.id` (`ON DELETE CASCADE`, primary key, `:17`); `tool_id: str` FK →
  `tools.id` (`ON DELETE CASCADE`, primary key, `:18`). Pure association row, no payload columns beyond the
  two keys.
- Wired from the `Agent` ORM side: `tools: Mapped[List["Tool"]] = relationship("Tool",
  secondary="tools_agents", lazy="selectin", passive_deletes=True)` (`letta/orm/agent.py:136`) — the
  standard SQLAlchemy `secondary=` pattern, reused for `sources`, `blocks`, `identities`, `groups` via
  their own association tables (`orm/agent.py:137,140,162,169`).

### 1.4 Tool manager service (`letta/services/tool_manager.py`)

`ToolManager` (starts at `:206`). Representative surface:
- Create/upsert: `create_or_update_tool_async` (`:211`), `create_tool_async` (`:405`),
  `bulk_upsert_tools_async` (`:469`), `_atomic_upsert_tool_postgresql` (`:285`, a Postgres-specific
  race-safe upsert path vs. a generic one for other backends).
- MCP-specific: `create_mcp_server` (`:373`), `create_mcp_tool_async` (`:379`),
  `create_or_update_mcp_tool_async` (`:392`).
- Reads: `get_tool_by_id_async` (`:531`), `get_tool_by_name_async` (`:541`),
  `get_tool_id_by_name_async` (`:552`), `tool_exists_async`/`tool_name_exists_async` (`:564,574`),
  `_check_tool_name_conflict_with_lock_async` (`:583`), `list_tools_async` (`:615`),
  `_list_tools_async` (`:679`), `count_tools_async` (`:803`), `size_async` (`:863`).
- Update/Delete: `update_tool_by_id_async` (`:881`, with an inner `update_tool_embedding` at `:1069` for
  the semantic-search embedding index), `delete_tool_by_id_async` (`:1091`).
- Base-tool seeding: `upsert_base_tools_async` (`:1137-1208`), `_bulk_upsert_postgresql` (`:1211`),
  `_upsert_tools_individually` (`:1272`).
- Modal sandbox app management: `create_or_update_modal_app` (`:1296`), `delete_modal_app` (`:1341`) —
  see §3.
- Search: `search_tools_async` (`:1388`), backed by `_embed_tool_background` (`:1362`).

**Built-in vs. custom tool distinction** — `list_tools_async` lazily seeds any missing base tools: if
listing from the start (`not after`) with `upsert_base_tools=True`, it diffs `LETTA_TOOL_SET -
LOCAL_ONLY_MULTI_AGENT_TOOLS` (prod) or the full `LETTA_TOOL_SET` against what's already persisted, and
calls `upsert_base_tools_async` for anything missing (`:650-658`).

`upsert_base_tools_async` (`:1137-1208`) walks the built-in function-set modules named in
`LETTA_TOOL_MODULE_NAMES`, loads each with `importlib.import_module` + `load_function_set(module)`
(`:1148-1155`), and for every function name in `LETTA_TOOL_SET` classifies its `ToolType` by set
membership from `letta/constants.py` (`:1163-1176`):

| Name set | `ToolType` |
|---|---|
| `BASE_TOOLS` | `LETTA_CORE` |
| `BASE_MEMORY_TOOLS` | `LETTA_MEMORY_CORE` |
| `BASE_SLEEPTIME_TOOLS` | `LETTA_SLEEPTIME_CORE` |
| `calculate_multi_agent_tools()` | `LETTA_MULTI_AGENT_CORE` |
| `BASE_VOICE_SLEEPTIME_TOOLS`/`_CHAT_TOOLS` | `LETTA_VOICE_SLEEPTIME_CORE` |
| `BUILTIN_TOOLS` | `LETTA_BUILTIN` |
| `FILES_TOOLS` | `LETTA_FILES_CORE` |

(unmatched names log a warning and are skipped, `:1177-1179`). It constructs a `PydanticTool(name=...,
tags=[tool_type.value], source_type="python", tool_type=tool_type, ...,
enable_parallel_execution=name in LETTA_PARALLEL_SAFE_TOOLS)` (`:1186-1193`) — notably **without**
explicit `source_code`/`json_schema`; the `refresh_source_code_and_json_schema` validator (§1.1) fills
`json_schema` on the fly per `tool_type` by importing the module. Batch-persisted via
`_bulk_upsert_postgresql` or `_upsert_tools_individually` depending on backend (`:1204-1208`).

**Custom/user tools** go through `create_tool_async`/`create_or_update_tool_async` with `tool_type`
defaulting to `CUSTOM` (`schemas/tool.py:39`); their `json_schema` is generated once at creation/update
time and stored verbatim thereafter (not regenerated on every load) — the load-bearing structural
difference vs. built-in types being: custom tools carry their own truth in the DB row, built-in tools
derive their truth from a fixed Python module every time they're materialized.

Built-in function implementations live under `letta/functions/function_sets/`.

### 1.5 `ToolType` enum (`letta/schemas/enums.py:212-224`)

```
CUSTOM                    = "custom"
LETTA_CORE                = "letta_core"
LETTA_MEMORY_CORE         = "letta_memory_core"
LETTA_MULTI_AGENT_CORE    = "letta_multi_agent_core"
LETTA_SLEEPTIME_CORE      = "letta_sleeptime_core"
LETTA_VOICE_SLEEPTIME_CORE= "letta_voice_sleeptime_core"
LETTA_BUILTIN             = "letta_builtin"
LETTA_FILES_CORE          = "letta_files_core"
EXTERNAL_LANGCHAIN        = "external_langchain"  # DEPRECATED
EXTERNAL_COMPOSIO         = "external_composio"   # DEPRECATED
EXTERNAL_MCP              = "external_mcp"
```

Structural roles:
- `CUSTOM` — user-authored; `source_code`+`json_schema` persisted verbatim, set once.
- `LETTA_CORE` / `LETTA_MEMORY_CORE` / `LETTA_MULTI_AGENT_CORE` / `LETTA_SLEEPTIME_CORE` /
  `LETTA_VOICE_SLEEPTIME_CORE` / `LETTA_BUILTIN` / `LETTA_FILES_CORE` — each maps to exactly one Python
  module constant; `json_schema` is regenerated at every pydantic-model-construction time by importing
  that module (`schemas/tool.py:91-105`); the implementation always lives in the fixed module, never in
  the DB row's `source_code`.
- `EXTERNAL_MCP` — proxies a remote/local MCP-server tool; built via `ToolCreate.from_mcp`; schema comes
  from normalizing the MCP tool's own `inputSchema`; `source_code` is a generated Python wrapper stub that
  proxies the call over MCP at execution time (see §4.3, §4.6); tagged
  `f"{MCP_TOOL_TAG_NAME_PREFIX}:{mcp_server_name}"` rather than classified by static name-set membership.
- `EXTERNAL_LANGCHAIN` / `EXTERNAL_COMPOSIO` — marked `# DEPRECATED` in the enum itself; legacy
  integrations, structurally similar to `CUSTOM` (source stored) but tagged for provenance/filtering.

### 1.6 Attaching tools to an agent

`AgentState` (`letta/schemas/agent.py:67-196`) carries `tools: List[Tool]` (`:112`, full hydrated Tool
objects, not just ids), `tool_rules: Optional[List[ToolRule]]` (`:76`), and
`tool_exec_environment_variables`/`secrets` (`:117-124`, see §5.2).

`CreateAgent` (`:206`) has a legacy `tools` field (list of names, flagged for removal at `:215-216`) and
the canonical `tool_ids: Optional[List[ToolId]]` (`:217`). `UpdateAgent` (`:444`) likewise has
`tool_ids: Optional[List[ToolId]]` (`:446`).

**Creation wiring** (`letta/services/agent_manager.py`, create-agent method from ~`:380`):
1. Builds a `tool_names` set (`:390`) from `agent_create.tools`, unioned with default tool-name sets
   depending on `include_base_tools` and `agent_type` (voice/sleeptime/memgpt_v2/react/letta_v1/workflow
   branches, `:391-425`), plus multi-agent tools if `include_multi_agent_tools` (`:426-427`).
2. `supplied_ids = set(agent_create.tool_ids or [])` (`:429`).
3. `_resolve_tools_async(session, tool_names, supplied_ids, org_id, ignore_invalid_tools=...)`
   (`:454-460`) resolves both name- and id-based references against the `tools` table, returning
   `name_to_id`, `id_to_name`, `requires_approval`.
4. `tool_ids = set(name_to_id.values()) | set(id_to_name.keys())` (`:462`).
5. After the `Agent` row exists, join rows are bulk-inserted directly into `ToolsAgents.__table__`
   (`:560-561`, guarded at `:606`).

**Update path** (`:765,883-886`): if `agent_update.tool_ids is not None`, diffs against current join rows
and inserts/deletes only the delta rather than rebuilding the agent.

**Explicit attach/detach helpers**: `bulk_attach_tools_async` (`:2827-2893`, validates org ownership then
either a Postgres `ON CONFLICT DO NOTHING` upsert or manual existing-check-then-insert for other DBs) and
`bulk_detach_tools_async` (`:3026-3054`); single-tool variants around `:2792-2805`/`:3012`. File-tool
attach/detach (`:2915-2987`) specifically targets `tool.tool_type == ToolType.LETTA_FILES_CORE` when
folders/sources are attached to an agent. A read helper lists an agent's tools by joining
`ToolModel` to `ToolsAgents` (`:3123-3124`).

---

## 2. Tool rules — schema, types, and the ToolRulesSolver

### 2.0 Overview

Letta lets you attach a list of `ToolRule` objects to an agent (`AgentState.tool_rules`) that constrain
which tools the agent may call on each step, in what order, whether the LLM must be forced into a tool
call, and when the agent's step loop must terminate. The type hierarchy lives in
`letta/schemas/tool_rule.py`; the enforcement/state-tracking engine is the `ToolRulesSolver` class in
`letta/helpers/tool_rule_solver.py`. The solver is instantiated once per agent step-loop invocation and
threaded through the step loop (see `letta/agents/letta_agent_v3.py`), accumulating a
`tool_call_history: list[str]` (`letta/helpers/tool_rule_solver.py:51`) across the whole multi-step turn.

### 2.1 Rule type enum

`letta/schemas/enums.py:182-197` defines `ToolRuleType`:

```
run_first              # letta/schemas/enums.py:189
exit_loop              # letta/schemas/enums.py:190 — "reasoning loop should exit"
continue_loop           # letta/schemas/enums.py:191
conditional             # letta/schemas/enums.py:192
constrain_child_tools   # letta/schemas/enums.py:193
max_count_per_step      # letta/schemas/enums.py:194
parent_last_tool        # letta/schemas/enums.py:195
required_before_exit    # letta/schemas/enums.py:196 — "tool must be called before loop can exit"
requires_approval       # letta/schemas/enums.py:197
```

### 2.2 Every rule class (`letta/schemas/tool_rule.py`)

All rules extend `BaseToolRule` (`letta/schemas/tool_rule.py:13-44`), which is a pydantic `LettaBase`
with:
- `tool_name: str` (`:15`) — the tool this rule is anchored to.
- `type: ToolRuleType` (`:16`) — discriminator.
- `prompt_template: Optional[str]` (`:17-20`) — legacy/vestigial field; docstring notes it's now ignored
  in favor of "fast built-in formatting" (each subclass hardcodes its own `render_prompt()` string rather
  than templating).
- Abstract `get_valid_tools(tool_call_history, available_tools, last_function_response) -> set[str]`
  (`:32-33`) — the core per-rule filter contract every concrete rule implements.
- `render_prompt() -> str | None` (`:35-37`) — default `None`; subclasses emit an `<tool_rule>...</tool_rule>`
  snippet describing the constraint in natural language, injected into the system prompt (see §2.4).
- `requires_force_tool_call: bool` property (`:39-44`) — default `False`; rules that constrain the *next*
  tool override this to `True` so the solver knows to force `tool_choice` in the LLM request.

**`InitToolRule`** (`:254-272`, type `run_first`) — the tool(s) that are the *only* legal first tool call
of a fresh loop (no history yet). Optional `args: Dict[str, Any]` (`:260-267`) lets you prefill/override
LLM-supplied arguments for this tool by key — "supports partial prefill; non-overlapping parameters are
left to the model." `requires_force_tool_call` is `True` (`:269-272`) — if any init rules exist and no
tool has been called yet, a tool call must be forced.

**`TerminalToolRule`** (`:275-284`, type `exit_loop`) — calling this tool ends the agent's step loop for
this turn. No `get_valid_tools` override (doesn't restrict availability — only the loop-exit behavior
matters, applied via `ToolRulesSolver.is_terminal_tool`).

**`ContinueToolRule`** (`:287-296`, type `continue_loop`) — calling this tool forces the loop to keep
going (opposite of terminal), regardless of what the model would otherwise decide.

**`RequiredBeforeExitToolRule`** (`:299-312`, type `required_before_exit`) — this tool must appear at
least once in `tool_call_history` before the loop is allowed to end for any reason. `get_valid_tools`
(`:307-309`) is a no-op passthrough (`return available_tools`) — the docstring explicitly says "the logic
for preventing exit is handled elsewhere" (in `ToolRulesSolver.get_uncalled_required_tools` /
`has_required_tools_been_called`, consumed by the agent loop's continuation decision, §2.5).

**`MaxCountPerStepToolRule`** (`:315-345`, type `max_count_per_step`) — caps how many times `tool_name`
may be invoked within a single step-loop invocation (a "step" here spans the whole multi-turn tool-calling
sequence, not a single LLM call — see `tool_call_history` scope). `max_count_limit: int` (`:321`) is
required. `get_valid_tools` (`:334-342`) counts occurrences of `tool_name` in history; once
`count >= max_count_limit` it removes the tool from `available_tools`, otherwise passes through
unrestricted.

**`ChildToolRule`** (`:64-128`, type `constrain_child_tools`) — after `tool_name` is called, only tools
listed in `children: List[str]` (`:71`) may be called next; `get_valid_tools` (`:111-113`) checks whether
the *last* item in `tool_call_history` equals `tool_name` and, if so, returns exactly `set(children)`,
otherwise passes through `available_tools` unchanged (i.e. it's inert unless its parent was *just*
called — not "ever called"). Also supports **typed argument prefill per child**: `child_arg_nodes:
Optional[List[ToolCallNode]]` (`:72-75`), where `ToolCallNode` (`:47-61`) pairs a child tool `name` with
optional prefilled `args: Dict[str, Any]` that override overlapping LLM-provided values for that specific
child — validated at model-build time by `validate_child_arg_nodes` (`:119-128`) to ensure every
`child_arg_nodes` entry references a real `children` member. `requires_force_tool_call` is `True`
(`:81-84`).

**`ParentToolRule`** (`:131-161`, type `parent_last_tool`) — the inverse-flavored sibling of
`ChildToolRule`: `children` may **only** be called if `tool_name` was the last tool called; otherwise
they're excluded. `get_valid_tools` (`:155-157`): if last tool == `tool_name`, return `set(children)`;
else return `available_tools - set(children)` (note the asymmetry vs. `ChildToolRule`, which passes
through *all* tools when inactive rather than subtracting — `ParentToolRule` actively blocks its children
outside the required context even when no other rule applies). `requires_force_tool_call` is `True`
(`:140-143`).

**`ConditionalToolRule`** (`:164-251`, type `conditional`) — routes to different next-tools based on the
*string content* of the tool's own return value. Fields: `default_child: Optional[str]` (`:170`, fallback
target when nothing else matches — `None` means "any tool allowed" as fallback), `child_output_mapping:
Dict[Any, str]` (`:171`, maps a matched output value → next tool name; validated non-empty at `:228-233`),
`require_output_mapping: bool` (`:172`, strict mode — if `True` and the case doesn't match, *no* tools are
valid rather than falling back to `default_child`/all). `get_valid_tools` (`:198-223`): only activates if
`tool_call_history[-1] == self.tool_name`; parses `last_function_response` as JSON and reads its
`"message"` key (`:207-208`) as the function output string; iterates `child_output_mapping` matching via
`_matches_key` (`:235-251`, which type-coerces the mapping key — bool/int/float/str — against the string
output for comparison); on match returns `{tool}` (singleton set — always forces exactly one next tool);
on no match, strict mode returns `set()` (blocks everything) or falls back to `{default_child}` or all
tools. If `last_function_response` is missing entirely, raises `ValueError` (`:203-204`) — this rule
*requires* the previous tool's output to route. `requires_force_tool_call` is `True` (`:175-178`).

**`RequiresApprovalToolRule`** (`:348-357`, type `requires_approval`) — does **not** filter tool
availability at all (`get_valid_tools` returns `available_tools` unchanged, `:355-357`); purely a marker
consumed elsewhere in the agent loop to gate execution behind human-in-the-loop approval (see §5.5).

**Discriminated union**: `ToolRule = Annotated[Union[ChildToolRule, InitToolRule, TerminalToolRule,
ConditionalToolRule, ContinueToolRule, RequiredBeforeExitToolRule, MaxCountPerStepToolRule,
ParentToolRule, RequiresApprovalToolRule], Field(discriminator="type")]` (`:360-373`) — pydantic
discriminated union keyed on the `type` literal field, so a JSON blob with `"type": "conditional"` etc.
deserializes to the right subclass automatically (used when hydrating an `AgentState.tool_rules` list
from the DB/API).

### 2.3 `ToolRulesSolver` — internal bucketing (`letta/helpers/tool_rule_solver.py:24-86`)

`ToolRulesSolver` is itself a pydantic `BaseModel` (not an ORM row — purely an in-memory/step-scoped
helper reconstructed from the agent's persisted `tool_rules` at the top of a step-loop invocation). At
init it takes the flat `tool_rules: list[ToolRule]` and, in `model_post_init` (`:66-86`), buckets each
rule by `isinstance` into typed lists:

- `init_tool_rules: list[InitToolRule]` (`:28-30`)
- `continue_tool_rules: list[ContinueToolRule]` (`:31-33`)
- `child_based_tool_rules: list[ChildToolRule | ConditionalToolRule | MaxCountPerStepToolRule]` (`:36-38`)
  — note these three distinct rule types are lumped into one bucket because they share the "constrain the
  allowed set for the *next* call" semantics; comment at `:34-35` flags this bucket name as a TODO rename
  candidate.
- `parent_tool_rules: list[ParentToolRule]` (`:39-41`) — kept as a separate bucket from
  `child_based_tool_rules` even though `ParentToolRule` also has "child" semantics, likely because its
  `get_valid_tools` has different exclusion semantics (see §2.2 asymmetry note).
- `terminal_tool_rules: list[TerminalToolRule]` (`:42-44`)
- `required_before_exit_tool_rules: list[RequiredBeforeExitToolRule]` (`:45-47`)
- `requires_approval_tool_rules: list[RequiresApprovalToolRule]` (`:48-50`)
- `tool_call_history: list[str]` (`:51`) — the running, cross-step ledger of tool names called this loop
  invocation. Mutated only via `register_tool_call` (`:88-90`) and reset via `clear_tool_history`
  (`:92-94`).
- `last_prefilled_args_by_tool: dict[str, dict]` / `last_prefilled_args_provenance: dict[str, str]`
  (`:53-61`) — a *cache*, recomputed on every call to `get_allowed_tool_names`, of which tool(s) in the
  currently-allowed set have prefilled arguments waiting (from `InitToolRule.args` or
  `ChildToolRule.child_arg_nodes`), plus a human-readable string of which rule supplied them (used for
  debugging/observability — e.g. `"ChildToolRule(search->fetch)"`).

### 2.4 Core algorithm: `get_allowed_tool_names` (`:96-172`)

This is the single method that decides, at the top of every LLM-request-construction step, which tool
names are legal for the next call. Documented precedence in its own docstring (`:104-108`):

1. **No history yet + init rules exist** → the allowed set is *exactly* `{r.tool_name for r in
   init_tool_rules}` (`:110-111`) — no intersection with anything else, init rules fully own the first
   call.
2. **Otherwise** → compute the set-intersection across every rule in `child_based_tool_rules +
   parent_tool_rules` (`:113-119`), each contributing its own `get_valid_tools(...)` result; then AND that
   intersection with `available_tools` (the tools actually attached to the agent) (`:120`). If the result
   is empty and `error_on_empty=True` (default), raises `ValueError("No valid tools found based on tool
   rules.")` (`:122-123`) — callers that want a softer fallback (see `letta_agent_v3.py:2039-2045`,
   `_get_valid_tools`) pass `error_on_empty=False` and fall back to the full tool set.
3. `continue_tool_rules`, `terminal_tool_rules`, and `required_before_exit_tool_rules` are **not**
   consulted here at all (comment at `:107`: "applied in the agent loop flow, not to restrict tools") —
   they don't shrink the *available* set, they only affect the loop-continuation decision made
   afterward (§2.5).

The same call also has a documented **side effect**: it rebuilds `last_prefilled_args_by_tool` /
`last_prefilled_args_provenance` from scratch each time (`:127-170`), via a local `_store_args` closure
(`:131-137`, last-write-wins per key). Three sources populate it: `InitToolRule.args` when at the start of
history (`:144-148`), `ChildToolRule.get_child_args_map()` per-child overrides when the parent was just
called (`:150-156`), and (future-proofing comment at `:158`) any other rule type that happens to expose an
`args` attribute matching an allowed tool (`:158-167`). Downstream, `letta_agent_v3.py:1784-1787` reads
this cache to actually merge prefilled args into the LLM-provided call arguments before execution.

Other solver methods used by the agent loop:
- `is_terminal_tool(name)` (`:174-176`) — simple membership check against `terminal_tool_rules`.
- `has_children_tools(name)` (`:178-180`) — whether `name` is the anchor (`tool_name`) of any
  `child_based_tool_rules` entry (used to decide "continue because this tool triggers a required
  follow-up," `letta_agent_v3.py:2014-2016`).
- `is_continue_tool(name)` (`:182-184`).
- `is_requires_approval_tool(name)` (`:186-188`) — consumed by the agent loop to route calls into the
  approval-request path instead of direct execution (§5.5).
- `has_required_tools_been_called` / `get_uncalled_required_tools` (`:190-207`) — set-difference of
  `required_before_exit_tool_rules` tool names against `tool_call_history`, additionally intersected with
  `available_tools` so a required tool that's no longer attached to the agent doesn't permanently block
  exit (`:206-207`).
- `compile_tool_rule_prompts` (`:209-237`) — concatenates every rule's `render_prompt()` output (skipping
  `required_before_exit` and `requires_approval`, which have no `render_prompt` override and thus render
  nothing) into one ephemeral `Block` (`label="tool_usage_rules"`) that gets spliced into the system
  prompt — this is how the LLM is told about the constraints in natural language, in parallel with the
  solver enforcing them mechanically.
- `guess_rule_violation(tool_name)` (`:239-271`) — best-effort diagnostic: when a tool call gets rejected
  (name not in the allowed set), this scans every rule whose `tool_name` matches either the *attempted*
  tool or the *previous* tool in history, and returns their rendered `<tool_rule>` strings as hints. Used
  by `_build_rule_violation_result` (`letta/agents/helpers.py:501-505`) to build a
  `[ToolConstraintError] Cannot call {tool}, valid tools include: {valid}.` message with a "Possible rules
  that were violated" hint block — this string is fed straight back to the model as the tool's (error)
  return value, i.e. rule violations are corrected by conversational feedback rather than hard-crashing
  the loop.
- `should_force_tool_call()` (`:273-298`) — returns `True` if (a) no history yet and init rules exist, or
  (b) the last-called tool anchors an active `child_based_tool_rules` or `parent_tool_rules` entry whose
  `requires_force_tool_call` is `True`. This return value is read every step in
  `letta_agent_v3.py:956-963` and directly flips the LLM request's `tool_choice` between forced and `auto`
  mode (logged as "switching to constrained/unconstrained mode"); additionally, if exactly one tool is in
  the currently-valid set, `letta_agent_v3.py:1092` pins `tool_choice` to that literal tool name rather
  than merely "required" (`force_tool_call = valid_tools[0]["name"] if len(valid_tools) == 1 and
  self._require_tool_call else None`).

### 2.5 Where the solver plugs into the step loop (`letta/agents/letta_agent_v3.py`)

Per-step sequence (v3 agent loop; there are older `letta_agent.py` / `letta_agent_v2.py` generations with
similar but not identical wiring):

1. `valid_tools = await self._get_valid_tools()` (`:955`, method at `:2038-2074`) — calls
   `tool_rules_solver.get_allowed_tool_names(available_tools=..., last_function_response=...,
   error_on_empty=False)` (`:2041-2045`), falls back to the full tool set if empty, converts the survivors
   to strict-mode JSON schemas, merges in any client-side tools, and — notably — applies
   `runtime_override_tool_json_schema(..., terminal_tools=terminal_tool_names)` (`:2067-2073`) so terminal
   tools can get schema-level annotation/handling distinct from regular tools at request-construction
   time.
2. `require_tool_call = self.tool_rules_solver.should_force_tool_call()` (`:956`) sets `tool_choice` mode
   for the upcoming LLM call, as above.
3. After the LLM responds with tool call(s), for calls that aren't in `valid_tool_names`,
   `_build_rule_violation_result` (`letta/agents/helpers.py:501-505`, invoked at
   `letta_agent_v3.py:1826`) synthesizes an error `ToolExecutionResult` instead of executing — the rule
   is enforced by refusing execution, not by preventing the call syntactically.
4. On successful (non-violating) execution, `tool_rules_solver.register_tool_call(spec["name"])`
   (`:1896`, and again at `:2008` in `_decide_continuation`) appends to history.
5. **Approval-gating** happens *before* execution and *before* rule-violation checking is even relevant:
   `letta_agent_v3.py:1682-1709` partitions the model's requested tool calls into `requires_approval`
   (via `tool_rules_solver.is_requires_approval_tool`) — routed to an approval-request message that stops
   the loop with `StopReasonType.requires_approval` — versus tool calls that proceed directly.
6. **Continuation decision**: `_decide_continuation` (`:1966-2036`) is the terminal state machine per
   tool call: no tool call and required-before-exit tools still uncalled → force another step with a
   synthetic `ToolRuleViolated` system nudge message (`:1991-1997`, `:1626-1641`); no tool call and
   nothing outstanding → `end_turn`; tool call + is a terminal tool → stop with `StopReasonType.tool_rule`
   (`:2010-2012`); tool call + has children constraint or is a continue-tool → force continuation
   (`:2014-2020`); `is_final_step` (i.e. `remaining_turns == 0`, driven by the outer `max_steps` budget,
   `DEFAULT_MAX_STEPS = 50` at `letta/constants.py:75`, loop bound at `letta_agent_v3.py:328`/`:569`) is a
   hard override that always stops with `StopReasonType.max_steps` regardless of any rule saying
   "continue" (`:2023-2025`) — max-steps always wins over tool-rule-driven continuation. Finally, if
   required-before-exit tools remain uncalled, the loop is force-continued with an explicit reminder
   message even if a terminal tool was otherwise about to end it (`:2027-2034`) — i.e.
   `RequiredBeforeExitToolRule` can *override* a `TerminalToolRule`'s stop decision.
7. For multi-tool-call turns, `letta_agent_v3.py:1960-1963` additionally forces continuation
   ("Force continuation for parallel tool execution") if none of the parallel calls was terminal and
   max-steps wasn't hit — i.e. terminal-ness is evaluated per aggregate step, not per individual call.

### 2.6 Design observations worth stealing

- **Rules operate on a *rolling last-N-of-history* pattern, not global state**: almost every
  `get_valid_tools` only checks `tool_call_history[-1]` (the immediately preceding call), so rules compose
  as local "if X was just called, then Y" transitions rather than global invariants — except
  `MaxCountPerStepToolRule` (a full-history `.count()`) and `RequiredBeforeExitToolRule` (full-history
  membership), which are the two rule types that need to see the whole history rather than just the tip.
- **Two independent enforcement channels**: (a) mechanical — solver computes an allowed-set intersection
  and the loop refuses non-conforming calls with a synthetic error result fed back to the model; (b)
  advisory — `render_prompt()`/`compile_tool_rule_prompts()` puts the same constraints in English in the
  system prompt so a well-behaved model self-conforms and rarely needs (a) to kick in. `guess_rule_violation`
  exists purely to make channel-(a) failures self-correcting by restating channel-(b)'s text back at the
  model as an error hint.
- **`requires_force_tool_call` decouples "this rule narrows the option set" from "this rule requires
  `tool_choice=required`"** — most constrained rules set both, but it's a distinct axis: a rule could in
  principle narrow the set without forcing (not currently exercised, but the property is independent of
  `get_valid_tools`).
- **Argument prefilling is a first-class rule feature**, not bolted onto tool definitions: `InitToolRule`
  and `ChildToolRule` can inject/override specific argument keys for the *next* call based purely on tool
  rule structure, with the model only supplying the non-overlapping parameters. This is orthogonal to
  "tool variables" (§5.2).

---

## 3. Tool execution & sandboxing

### 3.1 Two abstraction layers

There are two parallel executor abstractions, at different altitudes:

- **`ToolExecutor`** (`letta/services/tool_executor/tool_executor_base.py:16`, `ABC`) — the high-level
  per-`ToolType` dispatcher interface, abstract `execute()` at `:35-47`. Concrete implementations are
  selected by `ToolType` in `ToolExecutorFactory._executor_map`
  (`letta/services/tool_executor/tool_execution_manager.py:35-43`): `LettaCoreToolExecutor`
  (`core_tool_executor.py`), `LettaBuiltinToolExecutor` (`builtin_tool_executor.py`),
  `LettaFileToolExecutor` (`files_tool_executor.py`), `ExternalMCPToolExecutor`
  (`mcp_tool_executor.py`, §4.6), and `SandboxToolExecutor` (default fallback,
  `sandbox_tool_executor.py:24`) for anything that requires actually executing arbitrary tool code.
- **`AsyncToolSandboxBase`** (`letta/services/tool_sandbox/base.py:24`, `ABC`) — the low-level sandbox
  abstraction that `SandboxToolExecutor` delegates to. Abstract `run()` at `:107-117`. Shared logic:
  script generation (`generate_execution_script`, `:126-175`; `_render_sandbox_code`, `:177-388`),
  TypeScript-vs-Python routing (`is_typescript_tool`, `:119-123`), and env-var layering
  (`_gather_env_vars`, `:476-518`, see §3.3).

### 3.2 Concrete sandbox backends (`letta/services/tool_sandbox/`)

- **Local subprocess** — `local_sandbox.py:31` `AsyncToolSandboxLocal`: writes the generated script to a
  temp file (`:97-106`), runs via `asyncio.create_subprocess_exec` (`:192-193`), optionally inside a
  per-sandbox venv (`_prepare_venv`, `:158-179`, using `create_venv_for_local_sandbox`/
  `install_pip_requirements_for_sandbox` from `letta/services/helpers/tool_execution_helper.py`).
- **E2B** — `e2b_sandbox.py:27` `AsyncToolSandboxE2B`: uses `e2b_code_interpreter.AsyncSandbox`
  (`:5-6`), creates/recreates a sandbox per call (`create_e2b_sandbox_with_metadata_hash`, `:183-351`),
  executes via `e2b_sandbox.run_code(...)` (`:102`), supports both Python and TypeScript
  (`language = "ts" if is_typescript...`, `:86`), installs pip/npm requirements dynamically
  (`:210-350`).
- **Modal (legacy per-tool app)** — `modal_sandbox.py:24` `AsyncToolSandboxModal`: looks up a
  pre-deployed Modal function named per tool/org/project (`_wait_for_modal_function_deployment`,
  `:58-88`, via `generate_modal_function_name`), invokes `func.remote.aio(...)` (`:148`).
- **Modal V2 (dynamic deploy + version tracking)** — `modal_sandbox_v2.py:32`
  `AsyncToolSandboxModalV2`: dynamically builds a Modal `App`/image (`_get_modal_image`, `:412-450`),
  mounts the top-level `sandbox/modal_executor.py` file into the image (`:115-135`), deploys via
  `ModalDeploymentManager`/`ModalVersionManager`, executes with retries (`:274-317`).
- **Legacy synchronous sandbox** — `letta/services/tool_executor/tool_execution_sandbox.py`
  `ToolExecutionSandbox` (631 lines), the pre-async predecessor still referenced from
  `letta/agent.py:69,1681` (an older non-async code path); hardcoded 60s local-subprocess timeout
  (`:211`) and its own E2B timeout-extension code (`:346-347`).

**Selection**: `SandboxToolExecutor.execute()` (`sandbox_tool_executor.py:69-130`) tries Modal first if
the tool's metadata opts in (`tool.metadata_.get("sandbox") == "modal"`) and Modal is enabled
(`tool_settings.modal_sandbox_enabled`, `:71-72,77-99`), otherwise falls back to E2B or Local per
`tool_settings.sandbox_type` (`:102-130`, `letta/settings.py:61-71`) — i.e. sandbox backend selection is
a per-tool opt-in over an org/deployment-wide default, not a per-agent setting.

### 3.3 `SandboxConfig` — schema, ORM, and selection

- `SandboxConfig` (`letta/schemas/sandbox_config.py:97-131`): `id`, `type: SandboxType`,
  `organization_id`, `config: Dict` (opaque JSON blob), plus `fingerprint()` (`:114-131`, hash of
  type/org/config) used as a cache/dedup key for E2B/Modal sandbox reuse.
- Type-specific configs extracted from the generic `config` dict via `get_local_config()`/
  `get_e2b_config()`/`get_modal_config()` (`:103-112`):
  - `LocalSandboxConfig` (`:26-55`) — `sandbox_dir`, `use_venv`, `venv_name`, `pip_requirements`.
  - `E2BSandboxConfig` (`:58-79`) — `timeout` (default 300s), `template` (E2B docker template id,
    defaults from `tool_settings.e2b_sandbox_template_id`), `pip_requirements`.
  - `ModalSandboxConfig` (`:82-90`) — `timeout` (default `MODAL_DEFAULT_TIMEOUT`), `pip_requirements`,
    `npm_requirements`, `language` (python/typescript).
- `SandboxType` enum (`letta/schemas/enums.py:262-265`) — `E2B`, `MODAL`, `LOCAL`.
- ORM: `letta/orm/sandbox_config.py:18-35` `SandboxConfig(SqlalchemyBase, OrganizationMixin)`, table
  `sandbox_configs`, **one row per `(type, organization_id)`** (unique constraint) — there is no
  per-agent or per-tool `SandboxConfig` row.
- Selection: `SandboxConfigManager.get_or_create_default_sandbox_config_async`
  (`letta/services/sandbox_config_manager.py:56-73`) fetches (or lazily creates) the org's single config
  for a given `SandboxType`. Per-tool overrides instead come from `tool.metadata_["sandbox"]` (the Modal
  opt-in flag, §3.2) and from an optional `sandbox_config` param threaded through
  `ToolExecutionManager`/`ToolExecutor.execute()` (`tool_executor_base.py:43`,
  `tool_execution_manager.py:80-92`) letting a caller bypass the DB lookup entirely
  (`AsyncToolSandboxBase.provided_sandbox_config`, `base.py:50,71-76`).

### 3.4 Environment variables / secrets injection

Five-layer merge, all converging in `AsyncToolSandboxBase._gather_env_vars`
(`letta/services/tool_sandbox/base.py:476-518`), documented in-code at `:479-486`, in ascending priority:

1. OS environment (local sandboxes only, `:487`).
2. Global sandbox-config env vars from DB (`:489-493`, via
   `SandboxConfigManager.get_sandbox_env_vars_as_dict_async`) — org-level defaults.
3. `self.provided_sandbox_env_vars` (`:496-497`) — the agent-scoped vars threaded through from the
   caller (see below).
4. `agent_state.get_agent_env_vars_as_dict()` (`:499-502`) — agent secrets again; the code's own
   comment flags this as `# TODO: may be duplicative` with layer 3.
5. `additional_env_vars` (`:505-506`) — highest priority, runtime overrides.

Then `LETTA_AGENT_ID`, `LETTA_PROJECT_ID`, `LETTA_TOOL_ID` are injected (`:508-513`) regardless — every
sandboxed tool call can introspect which agent/project/tool it's running as. Modal's older
`AsyncToolSandboxModal.run` reimplements similar layering inline (`modal_sandbox.py:110-141`).

`SandboxToolExecutor.execute` additionally fetches per-tool **webhook credentials** via
`SandboxCredentialsService.fetch_credentials` and merges them in *before* the above layering
(`sandbox_tool_executor.py:44-61`), and injects `PROJECT_ID` from agent state (`:58-59`); the
caller-provided (agent-scoped) vars win over fetched credentials on key collision (`:61`,
`{**fetched_credentials, **sandbox_env_vars}`).

**Storage**: `SandboxEnvironmentVariable` ORM (`letta/orm/sandbox_config.py:38-57`), table
`sandbox_environment_variables`, unique on `(key, sandbox_config_id)` — legacy plaintext `value` column
(blanked to `""` once encrypted) plus `value_enc: Text` for the encrypted value. A parallel
`AgentEnvironmentVariable` ORM (`:60-81`) holds agent-scoped vars (this is what backs
`AgentState.secrets` — see §5.2 for the "tool variables" concept this feeds).

**Encryption**: same `Secret`/`CryptoUtils` machinery as MCP credentials (§4.4) — AES-256-GCM,
PBKDF2-derived key from `LETTA_ENCRYPTION_KEY`, plaintext fallback if unconfigured, plus a
`PLAINTEXT_PREFIXES` allowlist (`crypto_utils.py:23-41`) to avoid double-encrypting values that already
look like a recognizable plaintext API-key format. Encrypt/decrypt on write in
`SandboxConfigManager.create_sandbox_env_var_async` (`:210-220`) / `update_sandbox_env_var_async`
(`:232-251`); decrypt on read via `get_sandbox_env_vars_as_dict[_async]` (`:322-340`).

### 3.5 Timeout handling and resource limits

- **Local**: `AsyncToolSandboxLocal._execute_tool_subprocess` wraps `process.communicate()` in
  `asyncio.wait_for(..., timeout=tool_settings.tool_sandbox_timeout)` (`local_sandbox.py:197`, default
  180s, `letta/settings.py:36`); on timeout, terminates then force-kills the subprocess
  (`local_sandbox.py:198-207`). Legacy sync path uses a hardcoded `subprocess.run(..., timeout=60)`
  (`tool_execution_sandbox.py:211`).
- **E2B**: no explicit client-side timeout wrapper — relies on E2B's own sandbox timeout
  (`E2BSandboxConfig.timeout`, `sandbox_config.py:59`); commented-out `set_timeout` extension code
  exists but is inactive (sandboxes are recreated per call instead, `e2b_sandbox.py:69-71,77-78`).
- **Modal V1**: `_wait_for_modal_function_deployment(timeout=60)` (`modal_sandbox.py:58-88`) only guards
  deployment-polling; the actual execution call has no explicit timeout wrapper (relies on the Modal
  function's own `timeout` set at deploy time).
- **Modal V2**: function decorator sets `timeout=modal_config.timeout` (`modal_sandbox_v2.py:140`); the
  remote call itself is wrapped in `asyncio.wait_for(..., timeout=modal_config.timeout + 10)`
  (`:283-294`) with a 3-attempt exponential-backoff retry loop on timeout/transient errors
  (`:274-317`); `ModalVersionManager.wait_for_deployment(..., timeout=120)` guards concurrent
  deployments.
- **Resource limits** exist only inside the Modal container runtime itself, `sandbox/modal_executor.py`:
  `resource.setrlimit(RLIMIT_AS, 1GB)` and `RLIMIT_STACK, 8MB` (`:231-238`), SIGSEGV/SIGABRT handlers for
  crash diagnostics (`:180-203`), and a 10MB pickle-size cap on args/agent_state (`:68-69,78-79`) — i.e.
  memory/stack limits and crash-safety are only enforced for the Modal backend, not local or E2B.
- Adjacent but unrelated timeouts (not the sandbox exec path): MCP connect/list/execute timeouts
  (`tool_settings.mcp_connect_to_server_timeout`/`mcp_list_tools_timeout`/`mcp_execute_tool_timeout`,
  `settings.py:41-43`), files-tool grep timeout (`files_tool_executor.py:388,456-457`), builtin
  web-fetch `requests.get(timeout=30)` (`builtin_tool_executor.py:387`).

### 3.6 Top-level `sandbox/` directory

- `sandbox/__init__.py` — empty; makes `sandbox` importable (located via
  `importlib.util.find_spec("sandbox")` in `modal_sandbox_v2.py:116-119`) and mounted into the Modal
  container image as a single file (`image.add_local_file(str(executor_path),
  remote_path="/modal_executor.py")`, `modal_sandbox_v2.py:135`).
- `sandbox/modal_executor.py` (273 lines) — `ModalFunctionExecutor.execute_tool_dynamic` (`:28-177`)
  runs *inside* the Modal container: unpickles args/agent_state (10MB size caps, guarded try/except),
  builds an `exec_globals` namespace restricted to a `SAFE_IMPORT_MODULES` allowlist (`:14-25,92-113`),
  `exec()`s the tool source, coerces kwargs via `coerce_dict_args_by_annotations`, invokes sync or
  async, wraps the result in a Pydantic `_TempResultWrapper` for serialization, captures stdout/stderr
  via `StringIO` redirection (`:55-62,163-177`), returns
  `{"result","agent_state","stdout","stderr","error"}`. The module-level `execute_tool_wrapper`
  (`@modal.method()`, `:205-273`) is the actual Modal RPC entrypoint: installs signal handlers, sets
  resource limits, injects env vars into `os.environ`, calls `execute_tool_dynamic`. Read and `exec()`'d
  dynamically inside the deployed function (`modal_sandbox_v2.py:145-178`) rather than imported
  normally.
- `sandbox/node_server.py` — `NodeShimServer` Modal class (`:4-79`) for TypeScript execution inside
  Modal: on `@modal.enter()` builds/runs the Node/TS server under `sandbox/resources/server`
  (`:11-24`), listens on Unix socket `/tmp/my_unix_socket.sock`; `remote_executor` (`@modal.method()`,
  `:29-79`) forwards JSON args over that socket via a custom `http.client.HTTPConnection` subclass. This
  appears to be a WIP/alternate TypeScript-in-Modal path, distinct from the E2B TypeScript path.
- `sandbox/resources/server/` — the Node/TypeScript runtime shim used by the above: `package.json`/
  `tsconfig.json` (Node project config, built via `npm run build`), `entrypoint.ts` (dynamically finds
  the first exported function in `user-function.ts` and invokes it with JSON-decoded args),
  `server.ts` (HTTP server bound to the Unix socket), `user-function.ts` (2-line placeholder,
  presumably overwritten per-tool at deploy time).
- No Dockerfile lives under `sandbox/` — Modal images are built programmatically via the `modal.Image`
  API (`AsyncToolSandboxModalV2._get_modal_image`, `modal_sandbox_v2.py:412-450`:
  `modal.Image.debian_slim(...)`, `.apt_install(...)`, `.pip_install(...)`), not from a static
  Dockerfile.

### 3.7 Result handling

- Result schema: `letta/schemas/tool_execution_result.py:8-18` `ToolExecutionResult` — `status:
  Literal["success","error"]`, `func_return: Optional[Any]`, `agent_state: Optional[AgentState]`
  (deprecated), `stdout: Optional[List[str]]`, `stderr: Optional[List[str]]`,
  `sandbox_config_fingerprint: Optional[str]`, plus a derived `success_flag` property (`:16-18`). A
  near-duplicate legacy schema `SandboxRunResult` exists at `letta/schemas/sandbox_config.py:17-23` for
  the older sync path.
- **Local**: the generated script wraps the function's return in a `_TempResultWrapper` Pydantic model
  (`base.py:296-311,333-348`), writes a length-prefixed, MD5-checksummed binary blob to stdout wrapped
  in a UUID marker (`base.py:371-386`, `LOCAL_SANDBOX_RESULT_START_MARKER` at `:26`); the caller parses
  it back out via `parse_out_function_results_markers` (`local_sandbox.py:253-275`, validates checksum)
  and `parse_stdout_best_effort`; a non-zero exit with no parsed return produces a friendly error
  (`local_sandbox.py:216-222`, see §5.4).
- **E2B**: reads the `Execution` object's `.results`/`.error` (name/value/traceback)/`.logs.stdout`/
  `.logs.stderr` (`e2b_sandbox.py:115-170`); Python parsed via `parse_stdout_best_effort`, TS via
  `parse_typescript_result` (`:117-120`); `status="error" if execution.error else "success"`
  (`:163-170`).
- **Modal V2**: the in-container executor's plain dict (`sandbox/modal_executor.py:155-174`, error
  branch `{"name","value","traceback"}` at `:163-177`) is translated into a `ToolExecutionResult` by
  `AsyncToolSandboxModalV2.run` (`modal_sandbox_v2.py:319-373`), including special-casing to detect
  segfaults in the error string (`:324-328`).
- **Top-level manager**: `ToolExecutionManager.execute_tool_async`
  (`letta/services/tool_executor/tool_execution_manager.py:95-160`) wraps every executor call in an
  `AsyncTimer` for metrics (`:113-121`), truncates `func_return` against `tool.return_char_limit`
  (`:124-128`, see §5.3), and converts any uncaught exception (including `asyncio.CancelledError`) into
  an error `ToolExecutionResult` with the full traceback captured only in `stderr` (`:131-155`).
  `SandboxToolExecutor.execute` additionally asserts agent memory wasn't mutated during sandboxed
  execution (`sandbox_tool_executor.py:135-138`) — a safety check that a tool running in an isolated
  process/container couldn't have silently mutated the in-memory agent state object it was passed.

---

## 4. MCP support

Letta acts purely as an **MCP client** — pulling tools in from external MCP servers. There is no evidence
it exposes itself as an MCP server (see §4.5).

### 4.1 Client transports (`letta/services/mcp/`)

- `letta/services/mcp/base_client.py:41` — `AsyncBaseMCPClient`, abstract base wrapping the official `mcp`
  Python SDK's `ClientSession`. Methods: `connect_to_server()` (`:55`), `list_tools()` (`:83`),
  `execute_tool()` (`:104`, calls `self.session.call_tool(tool_name, tool_args)` at `:107`),
  `cleanup()` (`:136`). Accepts an optional `oauth_provider: Optional[OAuthClientProvider]` (`:45-49`).
- Three concrete transports, each overriding `_initialize_connection`:
  - `letta/services/mcp/stdio_client.py:14` `AsyncStdioMCPClient` — spawns a local process via
    `mcp.client.stdio.stdio_client` with `StdioServerParameters(command=..., args=..., env=...)`
    (`:18-25`).
  - `letta/services/mcp/sse_client.py:19` `AsyncSSEMCPClient` — uses
    `mcp.client.sse.sse_client(url=..., headers=..., timeout=...)` (`:25-51`); supports custom headers,
    bearer token, and OAuth provider.
  - `letta/services/mcp/streamable_http_client.py:16` `AsyncStreamableHTTPMCPClient` — uses
    `mcp.client.streamable_http.streamablehttp_client` (`:25-60`), same header/OAuth handling, plus
    friendlier error wrapping for 404/connection/JSON errors (`:61-81`).
- `letta/services/mcp/fastmcp_client.py` additionally provides `AsyncFastMCPSSEClient` /
  `AsyncFastMCPStreamableHTTPClient` variants (built on the third-party `fastmcp` library rather than the
  raw `mcp` SDK), referenced from `mcp_manager.py:838,847`.
- Dispatch: `letta/services/mcp_manager.py:798` `MCPManager.get_mcp_client()` picks stdio vs. SSE vs.
  streamable-HTTP based on `server_config.type` (`:834` SSE, `:838` STDIO, `:847` STREAMABLE_HTTP), and
  disables stdio in multi-tenant deployments if `tool_settings.mcp_disable_stdio` is set (`:840-841`) —
  a deliberate security gate against arbitrary local process execution in shared/hosted deployments.

### 4.2 Connection config storage

Two schema layers plus one ORM model:

- **Internal schema**: `letta/schemas/mcp.py:29` `MCPServer(BaseMCPServer)` — `server_type` (`:31`, enum
  `MCPServerType`, default `STREAMABLE_HTTP`), `server_name` (`:32`), `server_url` (`:35`),
  `token`/`token_enc` (`:36,39`), `custom_headers`/`custom_headers_enc` (`:37,40`),
  `stdio_config: StdioServerConfig` (`:43-45`), `organization_id` (`:47`). `to_config()`/
  `to_config_async()` (`:102-199`) build the transport-specific config object
  (`SSEServerConfig`/`StdioServerConfig`/`StreamableHTTPServerConfig`, defined in
  `letta/functions/mcp_client/types.py`) from the stored encrypted fields.
- **API-facing discriminated union**: `letta/schemas/mcp_server.py` — `CreateStdioMCPServer` (`:22`,
  `command`/`args`/`env`), `CreateSSEMCPServer` (`:31`, `server_url`/`auth_header`/`auth_token`/
  `custom_headers`), `CreateStreamableHTTPMCPServer` (`:47`, same shape as SSE); combined as
  `CreateMCPServerUnion` (`:63`), wrapped by `CreateMCPServerRequest` (`:265`) with a
  `mcp_server_type` discriminator; matching `Update*` variants (`:92-137`); converters
  `convert_generic_to_union()` (`:285`) / `convert_update_to_internal()` (`:343`) bridge API↔internal
  layers.
- **ORM**: `letta/orm/mcp_server.py:20` `MCPServer(SqlalchemyBase, OrganizationMixin)`, table
  `mcp_server` — `server_name`, `server_type` (`:30-33`), `server_url` (`:36-38`), `token`/`token_enc`
  (`:41,44`), `custom_headers`/`custom_headers_enc` (`:47,50`), `stdio_config` (custom
  `MCPStdioServerConfigColumn`, `:53-55`), `metadata_` (`:57-59`); unique `(server_name, organization_id)`
  (`:28`). `letta/orm/mcp_server.py:82` `MCPTools` is a join table `mcp_server_id ↔ tool_id`.
- **OAuth session storage**: schema `MCPOAuthSession` (`letta/schemas/mcp.py:254`, mirrored in
  `mcp_server.py:145`), ORM `letta/orm/mcp_oauth.py:21` `MCPOAuth` (table `mcp_oauth`) — encrypted
  `access_token_enc`, `refresh_token_enc`, `client_secret_enc`, `authorization_code_enc`
  (`:38,42,44,53`), plus plaintext columns retained for migration/back-compat.

### 4.3 Tool normalization: MCP tool → Letta `Tool`

`ToolType.EXTERNAL_MCP = "external_mcp"` (`letta/schemas/enums.py:224`; a TODO comment questions the
"external" naming since MCP also covers local stdio servers).

`ToolCreate.from_mcp(cls, mcp_server_name, mcp_tool: MCPTool)` (`letta/schemas/tool.py:145`):
- Calls `generate_tool_schema_for_mcp(mcp_tool=mcp_tool)` (`:150`, defined at
  `letta/functions/schema_generator.py:694`), which takes the MCP `tools/list` entry's `inputSchema`
  (`:705`) and normalizes it via `normalize_mcp_schema` (`:712`) — forcing `type: object`,
  `additionalProperties: false`, and defaulting `required: []` for zero-arg tools (`:707-716`).
- Stashes MCP-side health-check metadata into the schema itself
  (`schemas/tool.py:153-155`, keys `MCP_TOOL_METADATA_SCHEMA_STATUS`/`_WARNINGS`).
- Tags the tool `f"{MCP_TOOL_TAG_NAME_PREFIX}:{mcp_server_name}"` (`:160`) — this tag is how the
  executor later recovers which MCP server a given tool belongs to (§4.6).
- Generates a Python wrapper source stub via `generate_mcp_tool_wrapper(mcp_tool.name)`
  (`letta/functions/helpers.py:19`), with `source_type` set to `"python"` (`:159`) — the persisted `Tool`
  row still *looks* like an ordinary Python-source tool at the schema level, even though it is never
  executed through the sandbox.
- Called from `letta/services/mcp_manager.py:181,265,288,507` inside `add_tool_from_mcp_server`,
  `resync_mcp_server_tools`, and `create_mcp_server_with_tools`.

### 4.4 Auth/secrets handling

- Credential fields live on `MCPServer`: `token`/`token_enc` (API key/bearer token) and
  `custom_headers`/`custom_headers_enc` (arbitrary auth headers) — `letta/schemas/mcp.py:36-40`, ORM
  columns `letta/orm/mcp_server.py:40-50`.
- Encryption: `letta/schemas/secret.py:13` `Secret` — `from_plaintext()` (`:35`) calls
  `CryptoUtils.encrypt()` (`letta/helpers/crypto_utils.py:104`), **AES-256-GCM** (docstring at `:44-45`),
  key derived via PBKDF2 from `LETTA_ENCRYPTION_KEY` (`:65-86`). If no encryption key is configured,
  `Secret.from_plaintext` falls back to storing plaintext in the `_enc` column with a warning
  (`schemas/secret.py:59-66`) — a soft-fail rather than a hard requirement.
- At connection time, `MCPServer.to_config()`/`to_config_async()` (`mcp.py:102,154`) decrypt
  `token_enc`/`custom_headers_enc` and build the transport config with `auth_header`/`auth_token` set to
  `Authorization: Bearer <token>` when only a bare token is present (`:120-127,141-147`).
- Per-transport header injection at connect time: `letta/services/mcp/sse_client.py:26-34` and
  `streamable_http_client.py:30-40` merge `custom_headers`, set `headers[auth_header] = auth_token`, and
  add an `X-Agent-Id` header (`AGENT_ID_HEADER`, `base_client.py:43`) when an agent id is present — i.e.
  the remote MCP server can identify which Letta agent is calling it.
- **Full OAuth2 flow** (not just static tokens): sessions in `MCPOAuthSession`/`MCPOAuth` ORM
  (`orm/mcp_oauth.py:21`) with encrypted token columns; orchestration in `MCPManager` —
  `create_oauth_session` (`services/mcp_manager.py:903`), `handle_oauth_flow` (`:1090`), lookup by
  state/server (`:934,967`); `letta/services/mcp/oauth_utils.py` and
  `letta/services/mcp/server_side_oauth.py` implement `ServerSideOAuth`, passed into `get_mcp_client()`
  (`mcp_manager.py:798`) as the `OAuthClientProvider` consumed by the SSE/streamable-HTTP clients
  (`base_client.py:5,45-49`; `sse_client.py:40-42`; `streamable_http_client.py:46-48`).

### 4.5 Does Letta act as an MCP server?

No. A search of `letta/server/` turns up only client-management REST endpoints for registering *external*
MCP servers — e.g. `letta/server/rest_api/routers/v1/mcp_servers.py:41` `create_mcp_server`, `:60`
`list_mcp_servers`, `:98` `delete_mcp_server`, all delegating to a `server.mcp_server_manager`
(`MCPManager`). No `mcp.server.fastmcp`/`FastMCP(`/`from mcp.server` imports exist anywhere in `letta/` —
Letta does not embed an MCP server endpoint of its own; it is client-only.

### 4.6 Execution path for MCP-backed tools

MCP tools bypass the sandboxed Python executor entirely, via a dedicated executor:

- `letta/services/tool_executor/mcp_tool_executor.py:22` `ExternalMCPToolExecutor(ToolExecutor)`:
  - `execute()` (`:26`) reads the MCP server name off the tool's tags (the
    `MCP_TOOL_TAG_NAME_PREFIX:` tag set during `from_mcp` conversion, §4.3) at `:36-39`.
  - Delegates to `MCPManager().execute_mcp_server_tool(mcp_server_name, tool_name, tool_args,
    environment_variables, actor, agent_id)` (`:51-58`), which (via `mcp_manager.py:100`) opens/reuses an
    MCP client and calls `client.execute_tool()` → `session.call_tool()` (`base_client.py:104-107`) — a
    live network/subprocess round-trip to the external server, not sandboxed source execution.
  - MCP-side errors (`McpError`, `ToolError`) are special-cased into friendly
    `ToolExecutionResult(status="error", ...)` responses rather than raised (`:64-88`), via
    `get_friendly_error_msg`.
- Routing: `letta/services/tool_executor/tool_execution_manager.py:35-43`
  `ToolExecutorFactory._executor_map` maps `ToolType.EXTERNAL_MCP → ExternalMCPToolExecutor` (`:42`),
  alongside `LETTA_CORE`/etc. → `LettaCoreToolExecutor`, with everything unmatched falling back to
  `SandboxToolExecutor` (`get_executor`, `:57`). So `tool.tool_type == ToolType.EXTERNAL_MCP` (set at
  creation time by `ToolCreate.from_mcp`) is the single flag that routes a call away from the sandbox and
  into the MCP-specific path.

---

## 5. Tool variables, argument validation, return handling, approval gating

### 5.1 Tool argument parsing and validation

Argument parsing from the model's raw JSON string is deliberately **lenient**, not a strict schema
validator:

- `letta/agents/helpers.py:378-393` `_safe_load_tool_call_str(tool_call_args_str)` strips a
  `"}{"`-joined double-object artifact (`:381-382`), `json.loads()`s it (`:385`), and if the result
  isn't a dict, re-parses (an Anthropic-specific quirk workaround, `:387-388`). On
  `json.JSONDecodeError`, it logs an error and **silently falls back to `{}`** (`:389-391`) — a
  malformed tool call becomes a zero-argument call rather than an explicit error surfaced to the model.
  Called from `letta_agent_v2.py:1125`, `letta_agent.py:1768`, `letta_agent_v3.py:1775`; `voice_agent.py`
  and `letta_agent_batch.py` do their own inline `json.loads`/`except`.

There is **no `jsonschema`-library validation anywhere** in the repo (confirmed by grep — no non-test
import of `jsonschema`). Two lighter-weight, purpose-specific checks exist instead:

- **Prefilled-arg validation** (for tool-rule-injected args from `InitToolRule`/`ChildToolRule`, not raw
  LLM args — see §2.2): `letta/agents/helpers.py:396-493`. `_json_type_matches` (`:396-426`) hand-rolls
  JSON-Schema `type` checks (string/integer/number/boolean/object/array/null);
  `_schema_accepts_value` (`:429-462`) extends this to `const`/`enum`/`anyOf`/`oneOf`;
  `merge_and_validate_prefilled_args` (`:465-493`) walks the tool's
  `json_schema["parameters"]["properties"]` and raises `ValueError` listing every violation if a
  prefilled key is unknown or fails type/enum/const (`:482,486,489`).
- **Python-annotation coercion** (the actual validation applied to raw LLM args before local/sandbox
  execution): `letta/services/tool_executor/sandbox_tool_executor.py:150-169`
  `_prepare_function_args` — parses the tool's own Python source to recover parameter annotations
  (`get_function_annotations_from_source`, `:163`) and coerces JSON values to match via
  `coerce_dict_args_by_annotations` (`letta/functions/ast_parsers.py:117-165`, which re-`json.loads`s
  string args or falls back to `ast.literal_eval`, raising `ValueError` on failure at `:155`). Coercion
  failures are caught and swallowed (`sandbox_tool_executor.py:166-169`) — falling back to the
  uncoerced original args, so a real type mismatch typically only surfaces as a runtime exception
  *inside* the sandboxed call, not as a pre-execution validation error.

**Surfacing to the model**: no "your JSON was malformed, please retry" feedback loop exists. Malformed
JSON → empty args → execution proceeds (or fails downstream as a generic tool-execution error, §5.4). A
tool name that isn't in the currently-valid set (per tool rules) produces a rule-violation message
instead (`_build_rule_violation_result`, §2.5) — that's the one place the loop actively generates
corrective feedback rather than best-effort recovering silently.

### 5.2 Tool variables (agent-level secrets) vs. sandbox environment variables

Letta's "tool variables" are the **agent-level `secrets`/`tool_exec_environment_variables` list** — a
distinct mechanism from LLM-supplied call arguments, and distinct from org-level sandbox env vars,
though all three get merged at execution time.

- Schema: `letta/schemas/agent.py:117-122` — `AgentState.tool_exec_environment_variables` (deprecated
  alias) and `AgentState.secrets: List[AgentEnvironmentVariable]` (current field). Model itself:
  `letta/schemas/environment_variables.py:81-115`.
- ORM: `letta/orm/agent.py:129-130` relationship still named `tool_exec_environment_variables`;
  decrypted in `from_orm_async` (`letta/orm/agent.py:452-516`).
- Convenience accessor: `AgentState.get_agent_env_vars_as_dict()` (`letta/schemas/agent.py:176-182`)
  returns `{key: value}`.
- Merge chain into the sandbox process:
  1. `letta_agent_v2.py:1316-1317` builds `sandbox_env_vars = {var.key: var.value or "" for var in
     agent_state.secrets}`, passed into `ToolExecutionManager(..., sandbox_env_vars=..., ...)`
     (`:1318-1327`), forwarded through `execute_tool_async` and into `executor.execute(...)`.
  2. `sandbox_tool_executor.py:44-61` merges in fetched webhook credentials
     (`SandboxCredentialsService.fetch_credentials`) and `PROJECT_ID` *before* the agent secrets, with
     agent secrets winning on key collision (`{**fetched_credentials, **sandbox_env_vars}`, `:61`).
  3. Final resolution — `AsyncToolSandboxBase._gather_env_vars` (`tool_sandbox/base.py:476-518`, full
     five-layer priority order detailed in §3.4): OS env (local only) < org sandbox-config vars <
     agent-scoped vars (from step 1/2) < `agent_state.get_agent_env_vars_as_dict()` again (flagged
     `# TODO: may be duplicative` at `:499`) < `additional_env_vars` (highest-priority runtime
     override).

So the precedence, informally: **runtime override > agent secrets > org defaults > raw OS env**, with
LLM-supplied call arguments living in an entirely separate channel (the tool's actual function
parameters) that never touches this env-var merge at all.

### 5.3 Return-value truncation

- Per-tool limit field: `letta/schemas/tool.py:51-52,119-120,194` `return_char_limit: int =
  Field(FUNCTION_RETURN_CHAR_LIMIT, ...)`; default `FUNCTION_RETURN_CHAR_LIMIT = 50000`
  (`letta/constants.py:438-439`, aliased as `BASE_FUNCTION_RETURN_CHAR_LIMIT`) — i.e. the limit is a
  per-`Tool`-row field, overridable per tool, not a single global constant.
- Truncation message template: `FUNCTION_RETURN_VALUE_TRUNCATED(return_str, return_char,
  return_char_limit)` (`letta/constants.py:200-202`).
- **First pass** (inside the executor, before the result even leaves the execution layer):
  `tool_execution_manager.py:124-128` computes `return_str` (JSON-dumped dict or `str()`), and if
  `len(return_str) > tool.return_char_limit`, replaces `result.func_return` with the truncation
  message.
- **Second pass** (in the agent step handler, with per-tool opt-outs): `letta_agent_v2.py:1184-1193` —
  `truncate = tool_call_name not in {"conversation_search", "conversation_search_date",
  "archival_memory_search"}` (search tools are exempted from truncation, presumably because their
  results are already curated/paginated), per-tool `return_char_limit` looked up (`:1185-1188`), then
  `validate_function_response(...)` (`letta/utils.py:898-937`): coerces non-str/non-dict returns to
  string (raising `ValueError` in strict mode for a genuinely wrong type, `:915-916`), and — if
  truncation applies and the limit is exceeded — slices to `return_char_limit` chars and appends a
  `"... [NOTE: function output was truncated since it exceeded the character limit (...)]"` note
  (`:925-926` for dicts, `:936-937` for strings). Two independent truncation passes exist because the
  executor-level pass runs generically for *every* caller of `ToolExecutionManager`, while the
  agent-loop pass is where the search-tool exemption and the more detailed truncation-note formatting
  live.
- **Wrapping format sent to the model**: `letta/system.py:150-168`
  `package_function_response(was_success, response_string, timezone)` builds `{"status": "OK"/"Failed",
  "message": response_string, "time": formatted_time}` and JSON-serializes it — this JSON string is what
  actually becomes the tool/function-role message content the LLM sees (called at
  `letta_agent_v2.py:1194-1198`). Note this is also the shape `ConditionalToolRule.get_valid_tools`
  parses back out of `last_function_response` when reading the `"message"` key (§2.2) — the tool-rules
  system and the return-value-wrapping system share this envelope format.

### 5.4 Error wrapping

- Central formatter: `letta/utils.py:1091-1097` `get_friendly_error_msg(function_name, exception_name,
  exception_message)` — builds `f"{ERROR_MESSAGE_PREFIX} executing function {function_name}:
  {exception_name}: {exception_message}"`, truncated to `MAX_ERROR_MESSAGE_CHAR_LIMIT`. No stack trace in
  this string.
- Applied at the top-level executor: `tool_execution_manager.py:131-155` — catches
  `asyncio.CancelledError` and generic `Exception` separately; both produce
  `ToolExecutionResult(status="error", func_return=error_message, stderr=[traceback.format_exc()])` —
  the full traceback is captured, but **only in the `stderr` list field**, never in `func_return`/the
  message content the model sees. Same pattern repeated in every executor
  (`core_tool_executor.py:75`, `files_tool_executor.py:106`, `mcp_tool_executor.py:78`,
  `builtin_tool_executor.py:131`) and every sandbox backend
  (`tool_execution_sandbox.py:234,294,381`, `local_sandbox.py:218,239`, `e2b_sandbox.py:134`,
  `modal_sandbox_v2.py:330,395`).
- No literal `is_error` boolean — instead `ToolExecutionResult.status: Literal["success","error"]` plus a
  derived `success_flag` property (`letta/schemas/tool_execution_result.py:16-18`), threaded into
  `package_function_response(was_success=tool_execution_result.success_flag, ...)`
  (`letta_agent_v2.py:1195`) so the model sees `"status": "Failed"` in the wrapped JSON envelope (§5.3)
  on error.
- No dedicated `ToolExecutionError` exception class exists for this — the pattern throughout is
  "catch broad `Exception`, format via `get_friendly_error_msg`, return an error-status
  `ToolExecutionResult`" rather than raising a typed error up the call stack.

### 5.5 Human-in-the-loop approval gating

Approval gating composes the `RequiresApprovalToolRule` marker (§2.2) with a distinct pause/resume
protocol in the step loop — the tool-rules solver only tells the loop *which* tools need approval; the
actual gating machinery lives in the agent's response handler.

**Where the loop pauses** (`letta_agent_v2.py:1138-1153`, and the closely mirrored
`letta_agent_v3.py:1682-1709`, §2.5 step 5): if the tool call is not itself an approval *response* and
`tool_rules_solver.is_requires_approval_tool(tool_call_name)` is true, the loop:
1. Builds an `ApprovalRequestMessage` via `create_approval_request_message_from_llm_response(...)`
   (`letta_agent_v2.py:1140-1150`) carrying the pending, not-yet-executed `ToolCall`.
2. Persists it, sets `continue_stepping = False` and
   `stop_reason = LettaStopReason(stop_reason=StopReasonType.requires_approval.value)`
   (`:1152-1153`, enum value at `letta/schemas/enums.py:197`) — **the tool is never executed**; the step
   loop exits entirely, handing control back to whatever is driving the outer conversation (e.g. a UI
   waiting on a human).

**Schema**:
- `ApprovalRequestMessage` (`letta/schemas/letta_message.py:306-326`, message_type
  `approval_request_message`, carries `tool_call`/`tool_calls`).
- `ApprovalResponseMessage` (`:328-347`, message_type `approval_response_message`, carries an
  `approvals` list plus a deprecated scalar `approve`/`approval_request_id`/`reason`).
- Persisted representation: `letta/schemas/message.py:252` `Message` uses `role ==
  MessageRole.approval` (enum at `letta/schemas/enums.py:116`) for **both** the request (has
  `tool_calls` set) and the response (has `tool_calls=None`, plus `approve: Optional[bool]` and
  `denial_reason: Optional[str]`); disambiguated by role+shape (`message.py:2451,2454`). Client-facing
  creation type `ApprovalCreate` (`message.py:178-204`) is part of `MessageCreateUnion`.

**Resuming** — at the start of each `step()` call (`letta_agent_v2.py:495-503`):
- `_maybe_get_approval_messages(messages)` (`letta/agents/helpers.py:522-527`) inspects the last two
  messages; if both have `role == "approval"`, the second-to-last is the request and the last is the
  response.
- If both are present, the step **skips the LLM call entirely** — it reuses the original
  `tool_call`/`reasoning_content`/`step_id` from the request (`:500-502`) and jumps straight to
  `_handle_ai_response` with `is_approval=approval_response.approve` and
  `is_denial=(approval_response.approve == False)` (`:611-613`).
- On denial, a synthetic function-response is synthesized —
  `f"Error: request to call tool denied. User reason: {denial_reason}"` — with a heartbeat to keep
  stepping, and the tool is never executed (`letta_agent_v2.py:1097-1120`, early return).
- On approval, the `is_requires_approval_tool` guard evaluates false this time (since
  `is_approval_response` is now true), so execution falls straight through to the normal execute-tool
  path, with `is_approval_response=is_approval or is_denial` stamped on the resulting messages
  (`:1226`) so downstream formatting/observability can tell this step originated from an approval
  resolution rather than a fresh model decision.

This same request/pause/resume shape is duplicated (not shared) across `letta_agent.py`,
`letta_agent_v2.py`, and `letta_agent_v3.py` — each agent-loop generation reimplements it rather than
delegating to one shared helper, beyond the small shared utilities in `letta/agents/helpers.py`.

---

## 6. Other clever bits

Three tool-calling-loop generations coexist in the repo: `letta/agents/letta_agent.py` (v1),
`letta_agent_v2.py` (v2), and `letta_agent_v3.py` (v3, subclasses v2). They differ meaningfully on
parallelism and heartbeats (below); the tool-rules solver and env-var layering described in §2/§3 apply
across all three.

### 6.1 Tool call parallelism

- **v1 and v2 only ever act on the *first* tool call** in a response — e.g.
  `letta/agents/letta_agent.py:363` `tool_call = response.choices[0].message.tool_calls[0]`, and
  `letta/agents/letta_agent_v2.py:500` `tool_call = approval_request.tool_calls[0]`. No gather/loop
  over multiple calls exists in either file's execution path.
- **v3 supports true multi-tool-call turns**, with a per-tool opt-in for concurrency:
  - Tool calls are gathered from the LLM response (`letta_agent_v3.py:1328-1333`, `tool_calls =
    llm_adapter.tool_calls` with single-call fallback).
  - If the agent's config disables parallel tool calls but the provider ignores that setting (e.g.
    Gemini), Letta enforces it client-side by truncating to the first call (`:1335-1342`).
  - Execution (`:1821-1862`): builds `exec_specs` for every call, splits them by each tool's
    `enable_parallel_execution` flag (`letta/schemas/tool.py:62-64`, default `False`, docstring: "this
    tool will potentially be executed concurrently with other tools") into `parallel_items` and
    `serial_items`. `asyncio.gather(*[_run_one(spec) for _, spec in parallel_items])` runs only the
    allow-listed-safe tools concurrently (`:1857`); everything else runs strictly sequentially
    afterward (`:1861-1862`) — parallelism is opt-in per tool, not automatic just because the model
    issued N calls in one turn.
  - Whether the LLM is even *allowed* to emit >1 call per turn is itself gated at request-build time
    (`:1111-1146`): Anthropic/Bedrock/MiniMax via `tool_choice.disable_parallel_tool_use`, OpenAI via
    `parallel_tool_calls`, Gemini natively — and in every case it's disabled whenever the agent has any
    tool rules attached (`no_tool_rules` check, `:1113-1116`). So parallel tool *requesting* is only
    permitted for tool-rule-free agents — tool rules and multi-call parallelism are mutually exclusive
    by design, presumably because the solver's sequencing model assumes one call resolves before the
    next is chosen.
  - This gating is recomputed on every step from current agent state (`:1112-1146`), so an agent that
    starts rule-free (parallel allowed) and later has a rule attached mid-conversation loses parallel
    tool-issuing on its very next LLM request without any restart.
  - After executing a batch, the loop is forced to continue unless a terminal tool fired or max-steps
    was hit, regardless of individual heartbeat/rule signals for the other calls in the batch
    (`:1954-1964`).

### 6.2 Heartbeats vs. tool rules (and their removal in v3)

- v1/v2: every generated tool schema gets an injected `request_heartbeat: boolean` parameter (the model
  sets it to request another loop iteration without waiting for the user) —
  `letta/functions/schema_generator.py:558-583` (`REQUEST_HEARTBEAT_PARAM`, appended to
  `properties`/`required`); constant `letta/constants.py:217`. Popped from the LLM's args and coerced to
  bool via `_pop_heartbeat` (`letta/agents/helpers.py:496-498`); used at `letta_agent.py:1769` and
  `letta_agent_v2.py:1126`.
- **Interaction with tool rules** — `_decide_continuation` (v1: `letta_agent.py:1875-1919`; v2:
  `letta_agent_v2.py:1244-1285`) starts from `continue_stepping = request_heartbeat`
  (`letta_agent.py:1884`) and lets tool-rule outcomes *override* the model's own heartbeat signal in
  both directions: a `TerminalToolRule` forces `continue_stepping = False` even if heartbeat was
  requested (`:1894-1897`); `ChildToolRule`/`ContinueToolRule` force `continue_stepping = True` even if
  the model did *not* request a heartbeat (`:1899-1905`); uncalled `required_before_exit` tools force
  continuation regardless of heartbeat (`:1911-1917`). So the heartbeat field is only a
  fallback/default signal — tool rules are authoritative in both the forcing and suppressing direction.
- **v3 removes the heartbeat concept entirely** — stated explicitly in the class docstring
  (`letta_agent_v3.py:100-105`, "No heartbeats (loops happen on tool calls)"). Its
  `_decide_continuation` (`:1967-2036`) defaults `continue_stepping = True` whenever any tool was
  called (success or failure) and lets only tool rules or `is_final_step` change that — no
  `request_heartbeat` input exists. `REQUEST_HEARTBEAT_PARAM` is still popped defensively from tool args
  (`:1776`) but is otherwise inert, and request construction explicitly passes
  `request_heartbeat=False` with the comment `# NOTE: difference for v3 (don't add request heartbeat)`
  (`:2071`). Net effect: v3 makes "did a tool get called" the sole continuation signal, with tool rules
  layered on top, rather than the earlier two-signal (heartbeat + tool rule) design.

### 6.3 Tool call ID handling

- Generated uniformly from the LLM's own id, or a random fallback, in all three loops:
  `letta_agent.py:1737`, `letta_agent_v2.py:1085`, `letta_agent_v3.py:1773` — pattern `tool_call_id =
  tool_call.id or f"call_{uuid.uuid4().hex[:8]}"`.
- Dedicated generation/sanitization for cross-provider correctness: `get_tool_call_id()`
  (`letta/utils.py:486-490`) truncates a UUID to `TOOL_CALL_ID_MAX_LEN = 29` chars
  (`letta/constants.py:67`, noting OpenAI's 29-char id limit); `sanitize_tool_call_id()`
  (`letta/utils.py:497-509`) enforces Anthropic's `^[a-zA-Z0-9_-]+$` pattern plus the 29-char cap,
  rewriting ids from models that emit invalid characters (e.g. Kimi via OpenRouter emitting something
  like `"Read:93"`).
- Single-call turns: the assistant message and its function-response message share one `tool_call_id`
  (`create_letta_messages_from_llm_response`, `letta/server/rest_api/utils.py:382-489`, threaded through
  at `:413,437,483,489`).
- Multi-call turns: `create_parallel_tool_messages_from_llm_response`
  (`letta/server/rest_api/utils.py:518-627`) builds exactly two messages per step — one assistant
  message with an OpenAI-style `tool_calls` list (each entry with its own id, built/reused at
  `:553-563`), and one aggregate "tool" message whose `tool_returns: List[ToolReturn]` has one
  `ToolReturn` per call, each stamped with its matching `tool_call_id` (`:600-608`). The top-level
  `Message.tool_call_id` field is only set to the *first* call's id "for legacy reasons" (`:616`);
  consumers are directed to the per-item `tool_returns` array instead (docstring `:536-543`).

### 6.4 Retries

- **No retry for malformed tool-call JSON** — `_safe_load_tool_call_str`
  (`letta/agents/helpers.py:378-393`) is a best-effort parse that silently returns `{}` on
  `JSONDecodeError` (`:389-391`); execution then proceeds with empty args (likely failing inside the
  tool itself, whose error becomes an ordinary function-response on the next step) rather than asking
  the model to re-emit valid JSON.
- Real retry logic exists at the **LLM request layer**, for transient provider failures:
  - `retry_with_exponential_backoff` decorator for rate limits (`letta/llm_api/llm_api_tools.py:38-122`,
    applied at `:122`).
  - A bounded per-step retry loop around request construction/sending, used e.g. when context overflow
    requires summarization first: `letta_agent.py:1414-1476` (non-streaming) /`:1478-1547` (streaming) —
    `for attempt in range(self.max_summarization_retries + 1): ... except Exception as e: ...
    current_in_context_messages = await self._handle_llm_error(...)`.
  - v3 adds a **model-fallback/circuit-breaker retry**: on `LLMRateLimitError | LLMServerError |
    LLMProviderOverloaded` it swaps to a configured fallback model handle and retries the same step
    (`letta_agent_v3.py:1093,1183-1209`, `routing_client.get_fallback_handle(...)`,
    `record_failure`/`record_success`) — a single logical "step" can silently span two different model
    providers.
  - Invalid prefilled args from tool rules are validated and, on failure, turned into an error result
    fed back to the model as a normal tool response rather than retried
    (`letta_agent_v3.py:1788-1809`, `merge_and_validate_prefilled_args` raising `ValueError` →
    `exec_specs.append({..., "error": err_msg})`).

### 6.5 Step budget / max steps

- `DEFAULT_MAX_STEPS = 50` (`letta/constants.py:75`).
- Enforced as a bounded `for i in range(max_steps):` loop in all three generations
  (`letta_agent.py:247,597,949`; `letta_agent_v2.py:233,375`; `letta_agent_v3.py:328,569`).
- The last iteration is flagged `is_final_step=(i == max_steps - 1)` (e.g. `letta_agent.py:260`), which
  `_decide_continuation` treats as a hard override — forcing `continue_stepping = False` and
  `stop_reason = StopReasonType.max_steps` even if a `ContinueToolRule`/heartbeat said to keep going
  (`letta_agent.py:1907-1910`; v3 equivalent `letta_agent_v3.py:394-395,2023-2025`) — see also §2.5.
- v3 additionally reconciles this per-parallel-call: each call's `is_final_step` is only true on the
  *last* item in a batch (`letta_agent_v3.py:1909`, `is_final_step=(is_final_step and idx ==
  len(exec_specs) - 1)`).

### 6.6 Composio integration

Present but legacy/largely deprecated:
- `ToolType.EXTERNAL_COMPOSIO = "external_composio"  # DEPRECATED` (`letta/schemas/enums.py:222`).
- Legacy monolithic-agent dispatch: `letta/agent.py:1628-1637` routes these tools to
  `execute_composio_action`, resolving a Composio API key
  (`letta/helpers/composio_helpers.py`) and an "entity_id" pulled from an agent secret keyed by
  `COMPOSIO_ENTITY_ENV_VAR_KEY` — i.e. Composio's own per-user identity is threaded through the same
  agent-secrets mechanism as tool variables (§5.2), not a separate credential store.
- A newer async executor class, `ExternalComposioToolExecutor`
  (`letta/services/tool_executor/composio_tool_executor.py:15-53`), does the equivalent lookup and calls
  `execute_composio_action_async`, but is never referenced/registered in the `ToolExecutorFactory`
  dispatch map anywhere else in the codebase — apparently dead code from an in-progress migration to the
  newer executor-registry architecture, consistent with the enum's `# DEPRECATED` tag.
- `letta/functions/composio_helpers.py`: a Composio action name maps 1:1 to a Letta tool function name
  via `generate_composio_action_from_func_name`/`_generate_func_name_from_composio_action`
  (`:19-42`). The persisted "source code" for a Composio tool is a deliberate stub that raises at
  runtime — `generate_composio_tool_wrapper` (`:45-56`) emits `raise RuntimeError("Something went wrong
  - we should never be using the persisted source code for Composio...")` — i.e. the DB row exists
  purely for name/schema bookkeeping (with a JSON schema derived from Composio's own action schema),
  while actual invocation always goes through the live Composio SDK call, never the stored source. This
  is the same "schema lives in the row, execution lives elsewhere" pattern as `EXTERNAL_MCP` (§4.3), just
  aimed at a different backend.
- No REST router wires up Composio (`grep -rln composio letta/server/` returns nothing) — as of this
  snapshot Composio tools can only be created/executed through the older `letta/agent.py` path and
  direct `ToolManager` calls, not a first-class API surface.

### 6.7 Other structurally interesting patterns

- **`tool_choice` forcing is tied to tool-rule state, not merely "how many tools exist."**
  `ToolRulesSolver.should_force_tool_call()` (§2.4) feeds `force_tool_call = valid_tools[0]["name"] if
  len(valid_tools) == 1 and self._require_tool_call else None` (`letta_agent_v3.py:1092`), passed into
  `llm_client.build_request_data(..., force_tool_call=..., requires_subsequent_tool_call=self.
  _require_tool_call, ...)` (`:1099-1108`) — the request only literally pins a *specific* tool via the
  provider's `tool_choice` API when the tool-rule-narrowed allowed set has collapsed to exactly one
  option; otherwise `should_force_tool_call()`'s `True` just flips `tool_choice` to `"required"` (any
  tool, still constrained to the allowed set via the schema list sent).
- **Prompt and enforcement are generated from the same rule objects.**
  `ToolRulesSolver.compile_tool_rule_prompts()` (§2.4) renders each active rule's `render_prompt()` into
  a system-prompt `Block`, used at `letta_agent_v2.py:824`
  (`tool_constraint_block = self.tool_rules_solver.compile_tool_rule_prompts()`) — the natural-language
  description shown to the model and the mechanical `tool_choice`/allowed-set enforcement are two views
  over the identical rule instances, so they can't silently drift out of sync with each other (contrast
  with systems where prompt text and enforcement logic are authored/maintained separately).
- **Dynamic tool-return truncation sized as a fraction of context window**, not a fixed constant:
  `_compute_tool_return_truncation_chars` (`letta_agent_v3.py:143-153`) caps each tool return to
  `max(5000, 0.2 * context_window * 4)` chars, preventing one verbose tool call from crowding out the
  rest of context, fed into `build_request_data(..., tool_return_truncation_chars=...)`
  (`:1106`) — this is a second, independent truncation knob from the per-tool `return_char_limit` in
  §5.3 (fixed per-tool byte budget vs. dynamic per-request context-relative budget); both are applied,
  whichever bites first.

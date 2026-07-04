# Highlight Scout: Goose (Block)

Clone: `/private/tmp/claude-501/-Users-ianbicking-src-callback-mono/b71d2662-11ec-4f27-9a9a-ef9beea687b1/scratchpad/goose`
(all paths below are relative to that clone root)

## 1. Identity / focus

Goose is Block's (Square/Cash App's parent) general-purpose local coding/ops
agent: a Rust core (`crates/goose`) plus CLI (`goose-cli`), a desktop app
(`ui/`), an HTTP/WebSocket server (`goose-server`), and an ACP (Agent Client
Protocol) surface for editor integration (`crates/goose/src/acp`). It is not
narrowly a coding agent — it targets "any task," with extensions (MCP servers),
recipes, scheduled recipes, subagent delegation, skills, and hooks all as
first-class, separately-versioned subsystems.

Maturity signal: this is clearly a funded engineering org's product, not a
side project. Evidence: a dedicated `security/` crate (adversary/egress/
repetition inspectors — explicitly out of scope for this doc per the brief),
`otel/` and `posthog` telemetry counters wired through scheduler/recipe/session
code (`crates/goose/src/scheduler.rs:923-950`), `oidc-proxy` and `services/`
directories, a `CONTRIBUTING_RECIPES.md` for a recipe-sharing ecosystem, an
`evals/` harness, and extensive `#[test_case]`-driven unit tests colocated with
nearly every subsystem discussed below (permission inspector, scheduler
crash-recovery, context compaction, summon/delegate). It reads as
production-shaped: real crash-recovery paths, real cancellation plumbing, and
defensive tests for edge cases (path traversal in delegate `working_dir`,
stale cron state after a crash, legacy 5-field cron migration).

## 2. Architecture in brief

- **Core** (`crates/goose/src`): providers, agents (the turn loop + tool
  execution), recipes, sessions, scheduler, permission/security inspectors,
  skills, hints (`.goosehints`/`AGENTS.md`), hooks, context management.
- **Extension model is MCP-native.** External tools are MCP servers
  (`crates/goose-mcp`); the agent also exposes a set of built-in
  "platform extensions" implemented as in-process fake MCP clients
  (`crates/goose/src/agents/platform_extensions/`) — e.g. `summon` (delegate/
  load), `schedule_tool`, `orchestrator`, `analyze`, `summarize`. This lets
  Goose give the model MCP-shaped tools without needing a real subprocess for
  built-in capabilities.
- **Session model**: sessions are typed (`SessionType::User`, `::SubAgent`,
  `::Scheduled`, …), persisted via `SessionManager`, and messages carry
  per-message visibility metadata (`agent_visible` vs `user_visible`) used
  heavily by the compaction system (see §3).
- **Surfaces**: `goose-cli` (interactive/headless), `goose-server` (HTTP +
  WebSocket, drives the desktop `ui/`), `goose/src/acp` (Agent Client
  Protocol server for editors, with its own recipe/schedule sub-modules).
  All surfaces sit on top of the same `crates/goose` core.

## 3. Highlights

### Recipes — parameterized, shareable, sub-recipe-composable, retryable

`crates/goose/src/recipe/mod.rs:42-87` — the `Recipe` struct: `version`,
`title`, `description`, `instructions`/`prompt` (at least one required),
`extensions`, `settings` (provider/model/temperature/max_turns override),
`activities` (suggested-prompt pills), `author`, `parameters`
(`RecipeParameter`, with `requirement: Required|Optional`, `default`,
`options`, typed input), `response.json_schema` (structured output contract),
`sub_recipes` (composition — a recipe can invoke other recipe files with
templated `values`), and `retry` (see below). Recipes are YAML/JSON files
(`RECIPE_FILE_EXTENSIONS`, `recipe/mod.rs:26`), Jinja-templated
(`recipe/template_recipe.rs`, `recipe/build_recipe/`), and validated
(`recipe/validate_recipe.rs`). `CONTRIBUTING_RECIPES.md` documents a
community recipe-sharing convention at the repo root.

**Retry-until-success is a recipe-level primitive**, not something the caller
has to build: `crates/goose/src/agents/types.rs:23-37` (`RetryConfig`:
`max_retries`, `checks: Vec<SuccessCheck>`, optional `on_failure` shell
cleanup command, separate timeouts for the task and for `on_failure`) and
`types.rs:67-74` (`SuccessCheck::Shell { command }` — a shell command whose
exit status gates whether the recipe run is considered successful, driving
another retry attempt). This turns a recipe into something closer to a CI job
than a one-shot prompt: run, check, clean up, retry.

**Discovery paths mirror agent-file discovery** and are dedupe-ordered
project-first then global:
`crates/goose/src/agents/platform_extensions/summon.rs:249-286` — project
`.goose/recipes/`, `.agents/recipes/`; global `~/.goose/recipes/`, XDG config
`recipes/`, `~/.agents/recipes/`, plus a `GOOSE_RECIPE_PATH` env var (colon/
semicolon-separated directory list). Local recipes win over global on name
collision (tested: `summon.rs:2246-2271`).

### Recipes as agents ("delegate") — one unified verb for subagents, recipes, and named personas

The `summon` platform extension (`crates/goose/src/agents/platform_extensions/
summon.rs`, ~3000 lines) is the single most fully-realized piece of this scout.
It exposes exactly two tools to the model: `load` and `delegate`
(`summon.rs:508-619`), both operating over one discovered "source" list that
mixes **recipes**, **sub-recipes**, and **agents** (`.claude/agents/*.md`-style
frontmatter files, `summon.rs:96-140, 204-240` — Goose explicitly scans
`.claude/agents/` alongside its own `.goose/agents/`, i.e. it's read-compatible
with Claude Code's subagent convention). `load(source)` reads
instructions/content into the *caller's own context* without spawning
anything; `delegate(source, instructions, parameters, extensions, provider,
model, temperature, max_turns, context, working_dir, async)` spawns an
isolated subagent session and returns its result. The tool description itself
(`summon.rs:602-619`) teaches the model when to parallelize ("Research
(read-only): parallelize freely… Work (writes): partition files strictly — no
two delegates touch the same file") and the exact async-then-`load`-to-collect
protocol — this is prompt engineering worth reading verbatim.

Concrete mechanics worth noting:
- **Background tasks are capped** (`GOOSE_MAX_BACKGROUND_TASKS`, default 5,
  `summon.rs:433-437`) and **completed results have a TTL**
  (`GOOSE_COMPLETED_TASK_TTL_SECS`, default 600s, `summon.rs:439-444`) so
  fire-and-forget delegates can't leak memory forever if never collected.
- **`load(source: task_id, peek: true)`** returns non-destructive progress
  (turns taken, idle time, buffered tool-call count) without consuming the
  result (`summon.rs:940-971`); `cancel: true` cancels via
  `CancellationToken` with a 5s grace period before hard `abort()`
  (`summon.rs:974-996`); plain `load(task_id)` blocks up to 5 minutes then
  returns a "still running, call again" message rather than hanging forever
  (`summon.rs:1069-1078`).
- **Tool-call notifications stream from subagent to parent** live via an
  mpsc bridge with a buffer for the pre-subscription window
  (`summon.rs:486-506`), so a UI watching the parent session can show
  subagent tool activity as it happens, not just on completion.
- **Model-override safety on delegation**: switching a delegate to a
  different model family deliberately drops provider-specific
  `request_params` (e.g. `anthropic_beta`) while still inheriting
  model-agnostic reasoning controls (`thinking_effort`, `budget_tokens`) —
  explicitly commented and tested to avoid a cross-provider 400
  (`summon.rs:1610-1636`, tests at `summon.rs:2623-2701`). A subtlety indie
  multi-model delegate implementations often get wrong.
- **Subagents cannot re-delegate** (`summon.rs:1220-1222`) and **must run in
  `GooseMode::Auto`** regardless of parent mode, with an explicit comment
  explaining why (approval-required modes would hang on the subagent's own
  confirmation channel until the message-forwarding gap is closed,
  `summon.rs:1244-1246`) — an honest, code-visible limitation rather than a
  silent footgun.
- **`working_dir` override is sandboxed to the parent's tree**
  (`resolve_working_dir`, `summon.rs:2029-2055`, canonicalizes and rejects
  anything outside the parent session directory — tested against `../`
  traversal, non-dirs, and non-existent paths).

### Scheduled recipes — cron-based, crash-safe by reset-not-resume

`crates/goose/src/scheduler.rs` (1423 lines) wraps `tokio_cron_scheduler`.
Jobs (`ScheduledJob`, `scheduler.rs:105-126`) are JSON-persisted
(`persist_jobs`, `scheduler.rs:128-140`) and carry `currently_running`,
`current_session_id`, `process_start_time` for observability. On snapshot,
the *original recipe file is copied* into an internal `scheduled_recipes/`
directory (`add_scheduled_job`, `scheduler.rs:310-342`) while
`recipe_base_dir` remembers the *original* directory so relative sub-recipe/
template paths still resolve — schedule creation freezes the recipe content,
but path-relative composition still works against the source tree
(`execute_job`, `scheduler.rs:856-865`).

**Crash-safety model is "reset stale state on boot," not "resume or
guarantee delivery."** `clear_running_state` (`scheduler.rs:142-150`) is
invoked both on `load_jobs_from_storage` at startup (`scheduler.rs:459-465`,
tested at `scheduler.rs:1331+`) and on manual cancel — if the process died
mid-run, the next boot just clears the stale `currently_running`/
`current_session_id`/`process_start_time` flags rather than replaying or
alerting on a missed run. There is **no missed-run catch-up**: a cron tick
that fires while the process is down is simply never executed (this is
`tokio_cron_scheduler`'s in-process scheduling, no external durable queue).
Cron strings accept both legacy 5-field and Goose's native 6-field
(seconds-included) format, auto-upgrading 5→6 with a warning
(`scheduler.rs:196-214`) — a small but real backward-compat nicety.

Execution (`execute_job`, `scheduler.rs:845+`) builds a fresh `Agent`,
resolves the recipe's own `extensions` (or falls back to enabled plugin MCP
servers), creates a `SessionType::Scheduled` session, and requires the recipe
to have at least one of `instructions`/`prompt` non-empty
(`scheduler.rs:952-964`) — a normal recipe file works verbatim as a scheduled
job, no separate "schedulable recipe" dialect.

### Permission modes — a real LLM-judged middle ground, not just allow/deny/ask

Four modes (`crates/goose-provider-types/src/goose_mode.rs:24`): `Auto`
(no gating), `Approve` (everything gated), `Chat` (no tools at all), and
**`SmartApprove`** — the interesting one. `PermissionInspector::inspect`
(`crates/goose/src/permission/permission_inspector.rs:130-270`) layers
decisions: (1) explicit user-set per-tool permission
(`AlwaysAllow`/`NeverAllow`/`AskBefore`) always wins; (2) tools the MCP server
itself annotated `read_only_hint: true` are auto-allowed; (3) extension
management is hard-coded to always require approval "for security"
(`permission_inspector.rs:166-169`); (4) otherwise, in `SmartApprove`, an
**LLM classification pass** (`detect_read_only_tools`,
`permission/permission_judge.rs:144-184`) is run once per unseen tool name —
it sends the pending tool_calls to the model with a dedicated
`platform__tool_by_tool_permission` structured-output tool and a system
prompt defining read-only vs write operations
(`permission_judge.rs:44-86`), and **caches the verdict per tool name**
(`permission_manager.update_smart_approve_permission`,
`permission_inspector.rs:241-248`) so the judge call only happens once per
tool, not per invocation. Default (5), unknown tools fall through to
"requires approval." This is a genuinely clever, code-visible resolution of
the allow-vs-ask tension: instead of a static allowlist or blanket
LLM-in-the-loop-every-time cost, it self-trains a per-tool cache the first
time each new tool shows up.

### Context management — background rolling tool-pair summarization *and* full compaction

Two distinct, composable mechanisms in `crates/goose/src/context_mgmt/mod.rs`:

1. **Full compaction** (`compact_messages`, `mod.rs:67-185`) at an 80%
   context-limit threshold (`DEFAULT_COMPACTION_THRESHOLD = 0.8`,
   configurable via `GOOSE_AUTO_COMPACT_THRESHOLD`,
   `check_if_compaction_needed`, `mod.rs:188-240`; skipped entirely for
   providers that self-manage context, e.g. context-caching APIs). It
   summarizes the whole visible conversation into one message, then
   **rewrites message visibility metadata** rather than deleting anything:
   original messages become `user_visible` but not `agent_visible` (so the UI
   transcript is untouched) while the summary becomes `agent_visible` but not
   `user_visible` (so the user never sees a "here's your summary" message
   injected into their chat) — `mod.rs:135-155`. A trailing "don't mention
   you read a summary, just continue" instruction is injected
   (`CONVERSATION_CONTINUATION_TEXT` / `TOOL_LOOP_CONTINUATION_TEXT` /
   `MANUAL_COMPACT_CONTINUATION_TEXT`, `mod.rs:31-44`, chosen based on
   whether compaction happened mid-tool-loop vs at a natural turn boundary vs
   user-requested). The most recent user text-only message is deliberately
   preserved outside the compacted region so continuation doesn't lose the
   live ask (`mod.rs:112-128`).

2. **Background rolling tool-pair summarization**, independent of full
   compaction: `maybe_summarize_tool_pairs` (`mod.rs:559-596`) is spawned as a
   detached `tokio::spawn` task (non-blocking — doesn't stall the turn loop)
   that finds old tool-call/response pairs beyond a computed cutoff
   (`compute_tool_call_cutoff`, `mod.rs:450-458`: scales with context limit
   and threshold, clamped 10-500) while explicitly protecting the last N
   calls of the *current* turn (`tool_ids_to_summarize`, `mod.rs:460-491`,
   batch size 10 at a time), and replaces each pair with a one-line LLM
   summary (`summarize_tool_call`, `mod.rs:493-557` — "A call to github was
   made to get the project status"). This is a continuous, incremental bleed
   of stale tool noise rather than one big compaction event — a genuinely
   different discipline than "compact when you hit the threshold." Feature
   flagged (`GOOSE_TOOL_PAIR_SUMMARIZATION`, default on, `mod.rs:25-29`).

### Skills — agentskills.io-spec-compliant, with real supporting-file resolution

`crates/goose/src/skills/mod.rs` implements the actual `agentskills.io`
`SKILL.md` spec (referenced directly, `mod.rs:30-33`): frontmatter `name`
(kebab-case, validated, `validate_skill_name`, `mod.rs:74-100`),
`description`, and a free-form `metadata` bag reserved per-spec so caller
fields don't collide with reserved ones. Discovery walks project
(`.agents/skills`, `.goose/skills`, `.claude/skills`) and global
(`~/.agents/skills`, XDG config, `~/.claude/skills`, installed-plugin skill
dirs) directories recursively (`all_skill_dirs`, `mod.rs:296-322`;
`scan_skills_from_dir`, `mod.rs:405-455`), plus built-in skills compiled into
the binary (`skills/builtins/goose_doc_guide.md`). Supporting files
(scripts, assets next to `SKILL.md`) are collected and, when a skill is
loaded into context, each one is surfaced with **both** its
skill-directory-relative path and its absolute resolved path, plus an
explicit call-out that the shell tool runs in the session's working
directory (not the skill directory), so the model knows to `cd` or use the
absolute path (`loaded_skill_context`, `mod.rs:102-132`, tested at
`mod.rs:541-555`) — a small but real papercut CBX and others often miss.
Skills also support `$ARGUMENTS`-style templated invocation
(`skills/arguments.rs`, `apply_skill_arguments`) and an `argument-hint`
metadata field (`skill_argument_hint`, `mod.rs:144-151`).

### Hooks — Open Plugins hook spec, command-type only, matcher-gated

`crates/goose/src/hooks/mod.rs` (871 lines) implements a plugin-scoped
lifecycle-hook system modeled on the Open Plugins hooks spec (cited in the
module doc, `mod.rs:1-24`) with 11 events (`PreToolUse`, `PostToolUse`,
`PostToolUseFailure`, `SessionStart`, `SessionEnd`, `UserPromptSubmit`,
`BeforeReadFile`, `AfterFileEdit`, `BeforeShellExecution`,
`AfterShellExecution`, `Stop` — `mod.rs:50-62`), regex `matcher` per rule
(tested against tool name / file path / shell command depending on event),
and `command`-type actions only today (other action types deserialize but are
ignored, per spec, so a plugin using them doesn't fail to load —
`mod.rs:121-132`). Hook scripts receive a JSON `HookContext` on stdin
(`mod.rs:156-221`) and a 30s default per-hook timeout
(`DEFAULT_HOOK_TIMEOUT_SECS`, `mod.rs:43`). This is close in spirit to Claude
Code's own hooks feature, but scoped per-*plugin* (discovered via
`discover_enabled_plugins`) rather than per-project-config, and command-only
rather than allowing in-process hook types.

### Static memory — `.goosehints` / `AGENTS.md`, subdirectory-aware, not "learning"

`crates/goose/src/hints/load_hints.rs` — Goose reads both `.goosehints` and
`AGENTS.md` (`GOOSE_HINTS_FILENAME`, `AGENTS_MD_FILENAME`, `mod.rs:10-11`) and
tracks which subdirectories have already had their own hint files loaded as
the agent navigates the tree (`SubdirectoryHintTracker`,
`load_hints.rs:27-97`), similar to nested `CLAUDE.md`. This is pure static
context assembly (glob/gitignore-aware file loading), not a memory or
learning system — no equivalent here to a durable "what did I learn" store.

## 4. CBX comparison

**Recipes.** Goose's recipe format (parameters + typed defaults/options +
JSON-schema response contract + sub-recipe composition + retry-with-shell-
checks) is considerably more built-out as a *shareable artifact* than
anything CBX currently has for "repeatable tasks" — CBX's closest analog is
schedule cards driving a wakeup→reactor cycle, which is procedural/box-local
rather than a portable, parameterized, community-shareable file. The
retry-with-success-checks pattern (`RetryConfig`/`SuccessCheck::Shell`) is
steal-worthy on its own: a recipe that says "keep retrying until this shell
command exits 0, and run this cleanup command if it fails" is a clean,
generic primitive CBX doesn't have an equivalent to, and would compose well
with CBX's schedule cards (schedule → recipe → retry-until-verified, then
report).

**Scheduling/crash-safety.** Goose's "reset stale flags on boot, don't
resume, don't guarantee delivery" model is actually *less* robust than CBX's
schedules→wakeup→reactor loop as I understand it (CBX treats missed wakeups
as recoverable state to reconcile, not silently-dropped cron ticks) — this is
a case where CBX's design is arguably already ahead, not a gap to close. Worth
confirming this is a deliberate contrast to call out rather than an
assumption.

**Subagents.** Goose's `delegate`/`load` unification (one tool surface for
ad-hoc subagents, named recipes, and named "agents," with async + peek +
cancel + notification-streaming + a hard concurrency cap + TTL'd result
retention) is meaningfully richer than a typical bare `Task`-tool subagent
call and is the single highest-value thing to mine from this repo. CBX's
current subagent story (via the Agent tool here) has async/background
patterns but not this level of built-in lifecycle management (peek without
consuming, TTL-bounded result retention, a global concurrency cap configurable
via env var). The cross-model-override hygiene (dropping
provider-specific request params on model switch while keeping
reasoning-family-agnostic ones) is a subtle correctness detail worth
replicating if CBX subagents ever gain per-delegate model overrides.

**Permission / tool gating.** `SmartApprove`'s self-caching LLM read-only
judge is a genuinely clever middle ground between "trust everything" and
"ask about everything," and CBX doesn't have anything like it (CBX doesn't
currently expose a graduated approval mode at all, as far as this scan
covered) — worth considering, though CBX's context (a personal assistant with
box-scoped trust already established) may reduce the need relative to a
general local dev-tool agent used across arbitrary MCP servers.

**Context management.** The two-tier design (continuous background
tool-pair summarization *plus* threshold-triggered full compaction, with
agent/user message-visibility split so the human transcript is never
polluted by summarization) is more disciplined than a single-compaction
approach. The agent-visible/user-visible metadata split in particular is a
clean pattern: it means the summarization mechanism never has to lie to the
user about what happened, because the user's view was never touched in the
first place. Callback Box builders relying on the Claude Agent SDK's own
context/compaction handling get this "for free" at the SDK layer, but the
*policy knobs* here (protect-last-N, batch-of-10 rolling summarization,
manual-vs-automatic continuation wording) are a good checklist for anywhere
CBX does its own context assembly (e.g., reactor prompt assembly) rather than
delegating to the SDK entirely.

**Skills.** Goose's skills system is a straight, careful implementation of
the same agentskills.io `SKILL.md` spec that Claude Code's own skills use
(including reading `.claude/skills/` directly) — this is confirmation of a
converging standard rather than a novel mechanism, but the supporting-file
path-resolution UX (showing both relative and resolved absolute paths,
flagging the shell-cwd mismatch) is a nice small detail worth checking CBX's
own skill-loading path handles equally well.

**Hooks.** Goose's plugin-scoped, command-only hook system is a lighter-
weight cousin of Claude Code's own hooks (which CBX's harness already builds
on, per this monorepo's `WorktreeCreate`/`WorktreeRemove` hooks) — nothing new
to steal here, mostly confirms the pattern is industry-standard now (matcher
regex + JSON-on-stdin + timeout + allow/deny).

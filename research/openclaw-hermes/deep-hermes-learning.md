# Hermes Agent — Deep Dive: Background Review, Curator, Memory Consolidation, Nudges, Robustness

Source investigated: clone of Hermes Agent at
`/private/tmp/claude-501/-Users-ianbicking-src-callback-mono/b71d2662-11ec-4f27-9a9a-ef9beea687b1/scratchpad/hermes-agent`
(all `file:line` citations below are relative to that root). Findings are drawn from direct reads of
`agent/background_review.py` (907 lines), `agent/curator.py`, `tools/memory_tool.py`,
`tools/skill_manager_tool.py`, `tools/skill_usage.py`, `tools/threat_patterns.py`,
`agent/turn_context.py`, `agent/turn_finalizer.py`, `agent/conversation_loop.py`,
`agent/agent_init.py`, `agent/curator_backup.py`, `hermes_cli/plugins.py`, `toolsets.py`, and
the docs under `website/docs/`. Where something was *not* found in source after searching, that is
stated explicitly.

One structural correction to the received framing up front: `hermes_constants.py` contains **none**
of the learning-loop thresholds. It was grepped for `review`, `background`, `nudge`, `turn`
(case-insensitive) and is exclusively concerned with `HERMES_HOME` path resolution, Node/npm shim
detection, and platform/container detection. The real thresholds live as plain literals in
`agent/agent_init.py`, `agent/curator.py`, and `tools/memory_tool.py`, plus config-schema defaults in
`hermes_cli/config.py`.

---

## 1. `agent/background_review.py` — the background review/learning loop

### 1.1 Trigger conditions — two independent counters, both defaulting to 10

There is **no time-based trigger and no cooldown timer**. Two independent counters exist, and either
(or both) firing at end of turn spawns one review pass:

**Memory review — every 10 *user turns*.** Counted in `agent/turn_context.py:293-301`:

```python
should_review_memory = False
if (agent._memory_nudge_interval > 0
        and "memory" in agent.valid_tool_names
        and agent._memory_store):
    agent._turns_since_memory += 1
    if agent._turns_since_memory >= agent._memory_nudge_interval:
        should_review_memory = True
        agent._turns_since_memory = 0
```

Preconditions to even count: interval > 0, the `memory` tool enabled for the session, and a live
`_memory_store`. Default interval is **10**, set at `agent/agent_init.py:1236-1244`
(`agent._memory_nudge_interval = int(mem_config.get("nudge_interval", 10))`, config key
`memory.nudge_interval`). Resumed sessions hydrate the counter from persisted history so resuming
doesn't reset it to zero (`agent/turn_context.py:268-276`).

**Skill review — every 10 *tool-calling iterations* (not user turns).** Incremented per API
iteration of the tool loop in `agent/conversation_loop.py:688-692`, checked and reset at end of turn
in `agent/turn_finalizer.py:455-460`:

```python
_should_review_skills = False
if (agent._skill_nudge_interval > 0
        and agent._iters_since_skill >= agent._skill_nudge_interval
        and "skill_manage" in agent.valid_tool_names):
    _should_review_skills = True
    agent._iters_since_skill = 0
```

Default **10**, `agent/agent_init.py:1329-1332`, config key `skills.creation_nudge_interval`. The
counter also resets early when `skill_manage` is genuinely used in the foreground
(`agent/tool_executor.py:340,1063`). (Minor code smell: the comment at
`agent/conversation_loop.py:689` claims the counter "resets whenever skill_manage is actually used,"
but the reset in `turn_finalizer.py:460` happens unconditionally whenever the review fires.)

**The firing gate** — review only spawns after a *completed, non-interrupted* turn
(`agent/turn_finalizer.py:472-478`):

```python
if final_response and not interrupted and (_should_review_memory or _should_review_skills):
    try:
        agent._spawn_background_review(
            messages_snapshot=list(messages),
            review_memory=_should_review_memory,
            review_skills=_should_review_skills,
        )
    except Exception:
        pass  # Background review is best-effort
```

An interrupted/aborted turn is the only implicit skip condition. **No "skip if session too short"
check and no "already reviewed recently" cooldown were found** — the counters themselves are the
whole gate. An identical trigger check is duplicated for the Codex app-server code path at
`agent/codex_runtime.py:429-436`.

### 1.2 The "fork": in-process cache-warm replay, not a subprocess

Mechanics live in `_run_review_in_thread` (`agent/background_review.py:572-869`), spawned via
`spawn_background_review_thread` (`background_review.py:872-897`) →
`run_agent.py:_spawn_background_review` (`run_agent.py:1570-1597`), which starts a **daemon thread**
(`threading.Thread(..., daemon=True, name="bg-review")`, `run_agent.py:1594-1597`). The "fork" is a
second in-process `AIAgent` instance, constructed at `agent/background_review.py:648-662`:

```python
review_agent = AIAgent(
    model=_rt.get("model") or agent.model,
    max_iterations=16,
    quiet_mode=True,
    platform=agent.platform,
    provider=_rt.get("provider") or agent.provider,
    api_mode=_rt.get("api_mode"),
    base_url=_rt.get("base_url") or None,
    api_key=_rt.get("api_key") or None,
    credential_pool=getattr(agent, "_credential_pool", None),
    parent_session_id=agent.session_id,
    enabled_toolsets=getattr(agent, "enabled_toolsets", None),
    disabled_toolsets=getattr(agent, "disabled_toolsets", None),
    skip_memory=True,
)
```

The cache-warmth trick is a set of attribute pins applied after construction, each with an
explanatory comment:

- **Verbatim system-prompt inheritance** — `review_agent._cached_system_prompt =
  agent._cached_system_prompt` and `review_agent.session_start = agent.session_start`
  (`background_review.py:713-722`, only when *not* routed to a different model) so "the review
  fork's outbound HTTP request hits the same Anthropic/OpenRouter prefix cache the parent warmed."
  The comment (lines 699-708) cites a **measured ~26% end-to-end cost reduction on Sonnet 4.5**
  (issue #25322 / PR #17276).
- `review_agent._skip_mcp_refresh = True` (line 671) — keeps the `tools[]` array byte-identical for
  cache-key parity.
- `review_agent.session_id = agent.session_id` (line 723) — shares the parent's session id for
  cache-prefix parity, but persistence is fully disconnected: `_persist_disabled = True` (688),
  `_session_db = None` (689), `_session_json_enabled = False` (690). The comment (677-687) calls
  this the fix for a "curator-takeover" bug: without persistence isolation the injected harness
  prompt would leak into the user's real session history and the agent would later "become the
  curator, refusing the actual task."
- `_end_session_on_close = False` (730) and `compression_enabled = False` (741) — the fork must not
  finalize or compress the shared, still-live parent session.
- Worker-thread-scoped stdout/stderr silencing via `with thread_scoped_silence():` (line 614) —
  deliberately not a process-global redirect, which had blanked an unrelated gateway thread's
  console output (comment 606-613, issues #55769/#55925).
- A non-interactive **auto-deny approval callback** is installed on the worker thread before the
  fork is built (`_bg_review_auto_deny`, lines 592-601) so any dangerous-command approval prompt
  resolves to `"deny"` instead of deadlocking against the parent's TUI `input()` (issue #15216).

**Replay content depends on model routing** (`_resolve_review_runtime`, lines 46-100; selection at
777-784):

```python
_review_history = (
    _digest_history(messages_snapshot) if _routed
    else messages_snapshot
)
```

- Same-model (default): the **full conversation snapshot is replayed verbatim** — those tokens are
  already warm in the provider prompt cache, so replay is cheap cache reads.
- Routed to a cheaper model (config `auxiliary.background_review.{provider,model}`): a different
  model cannot reuse the parent's cache, so `_digest_history` (lines 112-153) keeps the **last 24
  messages verbatim** (extended if the tail would start mid-tool-block) and collapses everything
  older into a single synthetic `user`-role digest message, minimizing cold-written tokens.

The review prompt itself is appended as a *user message to the fork only* — the live conversation
never sees it.

### 1.3 Tool whitelist — enforced at runtime, not just prompted

Built at `agent/background_review.py:750-762`:

```python
review_toolsets = ["skills"]
if review_agent._memory_enabled or review_agent._user_profile_enabled:
    review_toolsets.insert(0, "memory")
review_whitelist = {
    t["function"]["name"]
    for t in get_tool_definitions(
        enabled_toolsets=review_toolsets,
        quiet_mode=True,
    )
}
set_thread_tool_whitelist(
    review_whitelist,
    deny_msg_fmt=(
        "Background review denied non-whitelisted tool: "
        "{tool_name}. Only memory/skill tools are allowed."
    ),
)
```

Per `toolsets.py:166-171` (and the `memory` toolset entry ~line 205), the whitelist resolves to at
most **`{skills_list, skill_view, skill_manage, memory}`** — and `memory` is only included when the
profile actually has memory/user-profile enabled (comment 750-752 documents an earlier bug where
hardcoding `["memory","skills"]` leaked the memory tool into memory-disabled profiles, issue
#54937). Enforcement is thread-local and pre-dispatch:
`hermes_cli/plugins.py:2034-2073` (`set_thread_tool_whitelist` / `get_pre_tool_call_block_message`)
checks `tool_name not in allowed` before any `pre_tool_call` plugin hook, so a hallucinated
`terminal` or `write_file` call is denied at execution time. `clear_thread_tool_whitelist()` runs in
a `finally` (line 795). Module docstring (lines 12-13): "It runs with a tool whitelist limited to
memory and skill management tools; everything else is denied at runtime."

### 1.4 The prompts, verbatim

Three module-level constants; selection in `spawn_background_review_thread`
(`background_review.py:884-892`): `_MEMORY_REVIEW_PROMPT` if only the memory counter fired,
`_SKILL_REVIEW_PROMPT` if only the skill counter fired, `_COMBINED_REVIEW_PROMPT` if both fired the
same turn. All three get this suffix appended at call time (`background_review.py:786-791`):

> You can only call memory and skill management tools. Other tools will be denied at runtime — do not attempt them.

**`_MEMORY_REVIEW_PROMPT`** (`agent/background_review.py:160-169`), verbatim:

> Review the conversation above and consider saving to memory if appropriate.
>
> Focus on:
> 1. Has the user revealed things about themselves — their persona, desires, preferences, or personal details worth remembering?
> 2. Has the user expressed expectations about how you should behave, their work style, or ways they want you to operate?
>
> If something stands out, save it using the memory tool. If nothing is worth saving, just say 'Nothing to save.' and stop.

**`_SKILL_REVIEW_PROMPT`** (`agent/background_review.py:171-274`), verbatim:

> Review the conversation above and update the skill library. Be ACTIVE — most sessions produce at least one skill update, even if small. A pass that does nothing is a missed learning opportunity, not a neutral outcome.
>
> Target shape of the library: CLASS-LEVEL skills, each with a rich SKILL.md and a `references/` directory for session-specific detail. Not a long flat list of narrow one-session-one-skill entries. This shapes HOW you update, not WHETHER you update.
>
> Signals to look for (any one of these warrants action):
>   • User corrected your style, tone, format, legibility, or verbosity. Frustration signals like 'stop doing X', 'this is too verbose', 'don't format like this', 'why are you explaining', 'just give me the answer', 'you always do Y and I hate it', or an explicit 'remember this' are FIRST-CLASS skill signals, not just memory signals. Update the relevant skill(s) to embed the preference so the next session starts already knowing.
>   • User corrected your workflow, approach, or sequence of steps. Encode the correction as a pitfall or explicit step in the skill that governs that class of task.
>   • Non-trivial technique, fix, workaround, debugging path, or tool-usage pattern emerged that a future session would benefit from. Capture it.
>   • A skill that got loaded or consulted this session turned out to be wrong, missing a step, or outdated. Patch it NOW.
>
> Preference order — prefer the earliest action that fits, but do pick one when a signal above fired:
>   1. UPDATE A CURRENTLY-LOADED SKILL. Look back through the conversation for skills the user loaded via /skill-name or you read via skill_view. If any of them covers the territory of the new learning, PATCH that one first. It is the skill that was in play, so it's the right one to extend.
>   2. UPDATE AN EXISTING UMBRELLA (via skills_list + skill_view). If no loaded skill fits but an existing class-level skill does, patch it. Add a subsection, a pitfall, or broaden a trigger.
>   3. ADD A SUPPORT FILE under an existing umbrella. Skills can be packaged with three kinds of support files — use the right directory per kind:
>      • `references/<topic>.md` — session-specific detail (error transcripts, reproduction recipes, provider quirks) AND condensed knowledge banks: quoted research, API docs, external authoritative excerpts, or domain notes you found while working on the problem. Write it concise and for the value of the task, not as a full mirror of upstream docs.
>      • `templates/<name>.<ext>` — starter files meant to be copied and modified (boilerplate configs, scaffolding, a known-good example the agent can `reproduce with modifications`).
>      • `scripts/<name>.<ext>` — statically re-runnable actions the skill can invoke directly (verification scripts, fixture generators, deterministic probes, anything the agent should run rather than hand-type each time).
>      Add support files via skill_manage action=write_file with file_path starting 'references/', 'templates/', or 'scripts/'. The umbrella's SKILL.md should gain a one-line pointer to any new support file so future agents know it exists.
>   4. CREATE A NEW CLASS-LEVEL UMBRELLA SKILL when no existing skill covers the class. The name MUST be at the class level. The name MUST NOT be a specific PR number, error string, feature codename, library-alone name, or 'fix-X / debug-Y / audit-Z-today' session artifact. If the proposed name only makes sense for today's task, it's wrong — fall back to (1), (2), or (3).
>
> User-preference embedding (important): when the user expressed a style/format/workflow preference, the update belongs in the SKILL.md body, not just in memory. Memory captures 'who the user is and what the current situation and state of your operations are'; skills capture 'how to do this class of task for this user'. When they complain about how you handled a task, the skill that governs that task needs to carry the lesson.
>
> If you notice two existing skills that overlap, note it in your reply — the background curator handles consolidation at scale.
>
> Protected skills (DO NOT edit these):
>   • Bundled skills (shipped with Hermes, e.g. 'hermes-agent').
>   • Hub-installed skills (installed via 'hermes skills install').
> Pinned skills (marked via 'hermes curator pin') CAN be improved — pin only blocks deletion/archive/consolidation by the curator, not content updates. Patch them when a pitfall or missing step turns up, same as any other agent-created skill.
> If the only skills that need updating are protected, say
> 'Nothing to save.' and stop.
>
> Do NOT capture (these become persistent self-imposed constraints that bite you later when the environment changes):
>   • Environment-dependent failures: missing binaries, fresh-install errors, post-migration path mismatches, 'command not found', unconfigured credentials, uninstalled packages. The user can fix these — they are not durable rules.
>   • Negative claims about tools or features ('browser tools do not work', 'X tool is broken', 'cannot use Y from execute_code'). These harden into refusals the agent cites against itself for months after the actual problem was fixed.
>   • Session-specific transient errors that resolved before the conversation ended. If retrying worked, the lesson is the retry pattern, not the original failure.
>   • One-off task narratives. A user asking 'summarize today's market' or 'analyze this PR' is not a class of work that warrants a skill.
>
> If a tool failed because of setup state, capture the FIX (install command, config step, env var to set) under an existing setup or troubleshooting skill — never 'this tool does not work' as a standalone constraint.
>
> 'Nothing to save.' is a real option but should NOT be the default. If the session ran smoothly with no corrections and produced no new technique, just say 'Nothing to save.' and stop. Otherwise, act.

**`_COMBINED_REVIEW_PROMPT`** (`agent/background_review.py:276-359`), used when both counters fire
in the same turn, verbatim:

> Review the conversation above and update two things:
>
> **Memory**: who the user is. Did the user reveal persona, desires, preferences, personal details, or expectations about how you should behave? Save facts about the user and durable preferences with the memory tool.
>
> **Skills**: how to do this class of task. Be ACTIVE — most sessions produce at least one skill update. A pass that does nothing is a missed learning opportunity, not a neutral outcome.
>
> Target shape of the skill library: CLASS-LEVEL skills with a rich SKILL.md and a `references/` directory for session-specific detail. Not a long flat list of narrow one-session-one-skill entries.
>
> Signals that warrant a skill update (any one is enough):
>   • User corrected your style, tone, format, legibility, verbosity, or approach. Frustration is a FIRST-CLASS skill signal, not just a memory signal. 'stop doing X', 'don't format like this', 'I hate when you Y' — embed the lesson in the skill that governs that task so the next session starts fixed.
>   • Non-trivial technique, fix, workaround, or debugging path emerged.
>   • A skill that was loaded or consulted turned out wrong, missing, or outdated — patch it now.
>
> Preference order for skills — pick the earliest that fits:
>   1. UPDATE A CURRENTLY-LOADED SKILL. Check what skills were loaded via /skill-name or skill_view in the conversation. If one of them covers the learning, PATCH it first. It was in play; it's the right place.
>   2. UPDATE AN EXISTING UMBRELLA (skills_list + skill_view to find the right one). Patch it.
>   3. ADD A SUPPORT FILE under an existing umbrella via skill_manage action=write_file. Three kinds: `references/<topic>.md` for session-specific detail OR condensed knowledge banks (quoted research, API docs excerpts, domain notes) written concise and task-focused; `templates/<name>.<ext>` for starter files meant to be copied and modified; `scripts/<name>.<ext>` for statically re-runnable actions (verification, fixture generators, probes). Add a one-line pointer in SKILL.md so future agents find them.
>   4. CREATE A NEW CLASS-LEVEL UMBRELLA when nothing exists. Name at the class level — NOT a PR number, error string, codename, library-alone name, or 'fix-X / debug-Y' session artifact. If the name only fits today's task, fall back to (1), (2), or (3).
>
> User-preference embedding: when the user complains about how you handled a task, update the skill that governs that task — memory alone isn't enough. Memory says 'who the user is and what the current situation and state of your operations are'; skills say 'how to do this class of task for this user'. Both should carry user-preference lessons when relevant.
>
> If you notice overlapping existing skills, mention it — the background curator handles consolidation.
>
> Protected skills (DO NOT edit these):
>   • Bundled skills (shipped with Hermes, e.g. 'hermes-agent').
>   • Hub-installed skills (installed via 'hermes skills install').
> Pinned skills (marked via 'hermes curator pin') CAN be improved — pin only blocks deletion/archive/consolidation by the curator, not content updates. Patch them when a pitfall or missing step turns up, same as any other agent-created skill.
> If the only skills that need updating are protected, say
> 'Nothing to save.' and stop.
>
> Do NOT capture as skills (these become persistent self-imposed constraints that bite you later when the environment changes):
>   • Environment-dependent failures: missing binaries, fresh-install errors, post-migration path mismatches, 'command not found', unconfigured credentials, uninstalled packages. The user can fix these — they are not durable rules.
>   • Negative claims about tools or features ('browser tools do not work', 'X tool is broken', 'cannot use Y from execute_code'). These harden into refusals the agent cites against itself for months after the actual problem was fixed.
>   • Session-specific transient errors that resolved before the conversation ended. If retrying worked, the lesson is the retry pattern, not the original failure.
>   • One-off task narratives. A user asking 'summarize today's market' or 'analyze this PR' is not a class of work that warrants a skill.
>
> If a tool failed because of setup state, capture the FIX (install command, config step, env var to set) under an existing setup or troubleshooting skill — never 'this tool does not work' as a standalone constraint.
>
> Act on whichever of the two dimensions has real signal. If genuinely nothing stands out on either, say 'Nothing to save.' and stop — but don't reach for that conclusion as a default.

**Patch-over-create bias, called out:** both skill prompts impose a numbered *preference order*
where patching a currently-loaded skill is step 1, patching an existing umbrella is step 2, adding a
support file is step 3, and creating a new skill is only step 4 with an explicit naming guard
("MUST NOT be a specific PR number, error string, feature codename, library-alone name, or
'fix-X / debug-Y / audit-Z-today' session artifact. If the proposed name only makes sense for
today's task, it's wrong — fall back to (1), (2), or (3)"). And the signals section directly targets
failed skills: "A skill that got loaded or consulted this session turned out to be wrong, missing a
step, or outdated. Patch it NOW." (`background_review.py:194-195, 196-231`).

**Anti-overfitting deny-list, called out:** the "Do NOT capture" section
(`background_review.py:250-269` and `276-359` combined variant) bans four categories of
overfit learnings — environment-dependent failures, negative claims about tools ("These harden into
refusals the agent cites against itself for months after the actual problem was fixed"),
resolved transient errors ("If retrying worked, the lesson is the retry pattern, not the original
failure"), and one-off task narratives. Note this deny-list is **prompt-level only**; no code
enforces content categories (code-level deny/allow-lists exist only for *which skills* may be
touched — §1.6).

### 1.5 What it may write

- **Memory**: `MEMORY.md` / `USER.md` via the single `memory` tool
  (`tools/memory_tool.py`, dir from `get_memory_dir()` at `tools/memory_tool.py:55`). The fork
  writes through the *parent's same in-process* `MemoryStore` instance
  (`review_agent._memory_store = agent._memory_store`, `background_review.py:672`) with provenance
  tagging `_memory_write_origin = "background_review"` (663-664). `skip_memory=True` at construction
  (661) prevents the fork from standing up external memory providers (Honcho/mem0/supermemory) so
  the harness prompt/response never leaks into the user's real external-memory namespace (comment
  630-644). `build_memory_write_metadata` (`background_review.py:545-569`) attaches
  `write_origin`/`execution_context`/session ids to any external-provider mirror writes.
- **Skills**: via `skill_manage` (`tools/skill_manager_tool.py`), actions `create`, `edit`, `patch`,
  `delete`, `write_file`, `remove_file` (docstring `skill_manager_tool.py:14-20`), writing under
  `~/.hermes/skills/<name>/` (`SKILLS_DIR`, line 152) including `references/`, `templates/`,
  `scripts/`, `assets/` (`ALLOWED_SUBDIRS`, line 462).

### 1.6 How writes are applied/validated

No LLM-judge or default human review; validation is code-level, with an optional staging layer:

- **Hand-written structural validation** (no JSON-schema library):
  `_validate_name` (`skill_manager_tool.py:469-480`, filesystem-safe regex, ≤64 chars),
  `_validate_category` (483-505), `_validate_frontmatter` (508-544 — YAML block required, `name` +
  `description` keys, description ≤1024 chars, non-empty body), `_validate_content_size` (547-559 —
  SKILL.md ≤ `MAX_SKILL_CONTENT_CHARS = 100_000` chars, support files ≤ 1 MiB),
  path-traversal prevention via `tools.path_security.validate_within_dir`
  (`_resolve_skill_target`, 692-737), and symlink/junction-aware delete-target validation
  (`_validate_delete_target`, 193-251, modeled on a real Kilo Code bug, issue ref #11227).
- **Atomic writes with rollback**: `_atomic_write_text` (740-769) uses `tempfile.mkstemp` +
  `os.replace`; `_create_skill`/`_edit_skill`/`_patch_skill` back up prior content and restore it if
  the (optional) security scan blocks the write (812-816, 872-877, 992-996).
- **Optional security scanner**: `_security_scan_skill` (121-145) →
  `tools.skills_guard.scan_skill(..., source="agent-created")`; **off by default**
  (`skills.guard_agent_created`, default `False` — rationale in code: "the agent can already execute
  the same code paths via terminal() with no gate", 102-118).
- **Background-review-only code guards**, gated on `is_background_review()`
  (`tools/skill_provenance.py`):
  - `_background_review_write_guard` (`skill_manager_tool.py:281-363`) — refuses *any* write to
    pinned, externally-owned, protected-built-in, hub-installed, or bundled skills (stricter than
    the foreground `_pinned_guard` at 254-278, which only blocks deletes).
  - `_background_review_read_before_write_guard` (366-393) + ContextVar bookkeeping (51-91) — the
    fork **must have `skill_view`ed the exact target file in the same turn** before patching or
    overwriting it. Code-enforced, preventing hallucinated edits to unread content.
- **Optional human diff review**: config `memory.write_approval` / `skills.write_approval` (both
  default `false`). When on, writes are staged (`wa.stage_write`) instead of applied, surfaced via
  `/memory pending` / `/skills pending` with `/skills diff <id>` showing a unified diff; the user
  must approve before the write lands (`apply_skill_pending`, `skill_manager_tool.py:1281-1300`;
  memory analogue `tools/memory_tool.py:823-880, 1036`; docs
  `website/docs/user-guide/features/memory.md:230-320`).

### 1.7 Cost controls

- **Model: same as the parent by default** (`_resolve_review_runtime`,
  `background_review.py:59-66`, `routed=False`) — deliberately, because the full-transcript replay
  is warm cache reads on the same model (module comment 31-43: "runs on the MAIN model by default
  ('auto'), replaying the full conversation — already warm in the prompt cache, so cheap cache
  reads"). Users can route to a cheaper model via `auxiliary.background_review.{provider,model}`
  (docs `website/docs/user-guide/features/memory.md:277-289`, claiming "~3–5×" savings in
  benchmarks), at which point the digest replay (§1.2) kicks in.
- **Hard iteration cap**: `max_iterations=16` on the fork (`background_review.py:650`). No explicit
  `max_tokens` budget was found for the review call.
- **No nested reviews**: the fork's own nudge intervals are zeroed
  (`review_agent._memory_nudge_interval = 0`, `_skill_nudge_interval = 0`, lines 675-676).
- Compression disabled in the fork (741); `skip_memory=True` avoids external-provider API calls
  (661); the tool whitelist bounds the action surface; the `final_response and not interrupted`
  gate avoids wasted passes on incomplete turns; and the entire spawn is
  `try/except: pass` best-effort (`turn_finalizer.py:474-478`).

---

## 2. `agent/curator.py` — the Curator subsystem

### 2.1 Cadence — weekly by default, inactivity-triggered, not cron

The Curator is **not** a cron job — `cron/` (scheduler.py, jobs.py, blueprint_catalog.py, …) has
zero references to "curator." Scheduling is a config-driven interval gate checked opportunistically:

- `DEFAULT_INTERVAL_HOURS = 24 * 7` (**7 days**) — `agent/curator.py:56`, overridable via
  `curator.interval_hours`.
- `DEFAULT_MIN_IDLE_HOURS = 2` — `agent/curator.py:57`.
- Gate: `should_run_now()` (`agent/curator.py:219-269`) checks enabled/paused state and
  `(now - last_run_at) >= interval_hours`, with `last_run_at` persisted in
  `~/.hermes/skills/.curator_state` (`curator.py:71-72`).
- Entrypoint `maybe_run_curator()` (`agent/curator.py:1958-1976`), invoked from two places: the
  gateway housekeeping tick loop polled hourly (`gateway/run.py:19519-19531`) and once at
  interactive CLI startup, backgrounded (`cli.py:13078-13090`).
- `hermes_cli/curator.py` is a manual CLI shell (`status/run/pause/resume/pin/unpin/rollback`); it
  schedules nothing.
- The only cron coupling is reversed: the curator reads `cron.jobs.referenced_skill_names` so it
  never ages out a skill a cron job depends on, and calls `cron.jobs.rewrite_skill_refs`
  (`cron/jobs.py:1745-1880`) to migrate cron-job skill references after consolidations.

Scope note: despite "memory/skills" framing, `agent/curator.py` curates **skills only** — no
memory-entry pipeline exists in this file (memory mentions are just config flags for the forked
sub-agent, e.g. `skip_memory=True`).

### 2.2 Staleness state machine

Three states plus an orthogonal pin flag, defined in `tools/skill_usage.py:53-56`: `STATE_ACTIVE`,
`STATE_STALE`, `STATE_ARCHIVED`, plus `pinned`. Thresholds are in `agent/curator.py:56-64` (again,
*not* `hermes_constants.py`):

- `DEFAULT_STALE_AFTER_DAYS = 30`
- `DEFAULT_ARCHIVE_AFTER_DAYS = 90`

The pure function `apply_automatic_transitions()` (`agent/curator.py:291-369`) implements:

- **Skip** pinned skills and cron-referenced skills entirely.
- Anchor on `last_activity_at` (falling back to `created_at`).
- **active → stale** at 30 days idle.
- **stale (or active) → archived** at 90 days idle — via `skill_usage.archive_skill`
  (`tools/skill_usage.py:696-753`), which **moves the skill directory into
  `~/.hermes/skills/.archive/`, never deletes**.
- **stale → active** reactivation when the skill is used again.

### 2.3 Umbrella-consolidation — LLM-driven, opt-in, prompt verbatim

The LLM consolidation pass is **off by default** (`DEFAULT_CONSOLIDATE = False`; config comment at
`hermes_cli/config.py:2264`: "# Run the LLM consolidation (umbrella-building) pass. OFF by
default.", `config.py:2271` `"consolidate": False`). When enabled, `run_curator_review()` assembles
the prompt (`agent/curator.py:1656-1662`) around `CURATOR_REVIEW_PROMPT`
(`agent/curator.py:403-554`), verbatim:

> You are running as Hermes' background skill CURATOR. This is an UMBRELLA-BUILDING consolidation pass, not a passive audit and not a duplicate-finder.
>
> The goal of the skill collection is a LIBRARY OF CLASS-LEVEL INSTRUCTIONS AND EXPERIENTIAL KNOWLEDGE. A collection of hundreds of narrow skills where each one captures one session's specific bug is a FAILURE of the library — not a feature. An agent searching skills matches on descriptions, not on exact names; one broad umbrella skill with labeled subsections beats five narrow siblings for discoverability, not the other way around.
>
> The right target shape is CLASS-LEVEL skills with rich SKILL.md bodies + `references/`, `templates/`, and `scripts/` subfiles for session-specific detail — not one-session-one-skill micro-entries.
>
> Hard rules — do not violate:
> 1. DO NOT touch bundled, hub-installed, or external-dir skills (`skills.external_dirs`). The candidate list below is already filtered to local curator-managed skills only; external skills are externally owned and read-only to this background curator.
> 2. DO NOT delete any skill. Archiving (moving the skill's directory into ~/.hermes/skills/.archive/) is the maximum destructive action. Archives are recoverable; deletion is not.
> 3. DO NOT touch skills shown as pinned=yes. Skip them entirely.
> 3b. DO NOT archive, delete, consolidate, move, or otherwise modify any skill named in the protected built-ins list (currently: plan). These back load-bearing UX (slash-command entry points referenced in docs and tips) and are filtered out of the candidate list below — never resurrect one as an archive or absorb target.
> 3c. DO NOT archive or prune any skill marked `cron=yes` in the candidate list. A cron job depends on it and will fail to load it on its next run. You MAY still consolidate it into an umbrella — but only because the curator rewrites cron job skill references to follow consolidations; never simply prune it.
> 4. DO NOT use usage counters as a reason to skip consolidation. The counters are new and often mostly zero. Judge overlap on CONTENT, not on use_count. 'use=0' is not evidence a skill is valuable; it's absence of evidence either way. Corollary: 'use=0' is ALSO not a reason to PRUNE a skill. Never archive a never-used skill (use=0) unless it is at least 30 days old (check last_activity / created date) AND its content is genuinely obsolete or fully absorbed elsewhere — a recently-created skill simply may not have had its trigger come up yet.
> 5. DO NOT reject consolidation on the grounds that 'each skill has a distinct trigger'. Pairwise distinctness is the wrong bar. The right bar is: 'would a human maintainer write this as N separate skills, or as one skill with N labeled subsections?' When the answer is the latter, merge.
>
> How to work — not optional:
> 1. Scan the full candidate list. Identify PREFIX CLUSTERS (skills sharing a first word or domain keyword). Examples you are likely to find: hermes-config-*, hermes-dashboard-*, gateway-*, codex-*, ollama-*, anthropic-*, gemini-*, mcp-*, salvage-*, pr-*, competitor-*, python-*, security-*, etc. Expect 10-25 clusters.
> 2. For each cluster with 2+ members, do NOT ask 'are these pairs overlapping?' — ask 'what is the UMBRELLA CLASS these skills all serve? Would a maintainer name that class and write one skill for it?' If yes, pick (or create) the umbrella and absorb the siblings into it.
> 3. Three ways to consolidate — use the right one per cluster:
>    a. MERGE INTO EXISTING UMBRELLA — one skill in the cluster is already broad enough to be the umbrella (example: `pr-triage-salvage` for the PR review cluster). Patch it to add a labeled section for each sibling's unique insight, then archive the siblings.
>    b. CREATE A NEW UMBRELLA SKILL.md — no existing member is broad enough. Use skill_manage action=create to write a new class-level skill whose SKILL.md covers the shared workflow and has short labeled subsections. Archive the now-absorbed narrow siblings.
>    c. DEMOTE TO REFERENCES/TEMPLATES/SCRIPTS — a sibling has narrow-but-valuable session-specific content. Move it into the umbrella's appropriate support directory:
>       • `references/<topic>.md` for session-specific detail OR condensed knowledge banks (quoted research, API docs excerpts, domain notes, provider quirks, reproduction recipes)
>       • `templates/<name>.<ext>` for starter files meant to be copied and modified
>       • `scripts/<name>.<ext>` for statically re-runnable actions (verification scripts, fixture generators, probes)
>       Then archive the old sibling. Use `terminal` with `mkdir -p ~/.hermes/skills/<umbrella>/references/ && mv ... <umbrella>/references/<topic>.md` (or templates/ / scripts/).
>
> Package integrity — not optional:
> Before demoting or archiving a skill, inspect it as a COMPLETE directory package, not just SKILL.md. A skill root may include `references/`, `templates/`, `scripts/`, and `assets/`; `skill_view` discovers those relative to the skill root. A reference markdown file inside another skill is NOT a new skill root and does not get its own linked-file discovery.
> If the source skill has support files OR SKILL.md contains relative links such as `references/...`, `templates/...`, `scripts/...`, or `assets/...`, DO NOT flatten only SKILL.md into `<umbrella>/references/<old>.md`. Choose one safe path instead:
>    • keep it as a standalone skill, OR
>    • fully merge it by re-homing every needed support file into the umbrella's canonical `references/`, `templates/`, `scripts/`, or `assets/` directories AND rewrite the destination instructions to the new paths, OR
>    • archive the entire original skill package unchanged.
> Never leave archived/demoted instructions pointing at files that were left behind under the old skill directory.
> 4. Also flag skills whose NAME is too narrow (contains a PR number, a feature codename, a specific error string, an 'audit' / 'diagnosis' / 'salvage' session artifact). These almost always belong as a subsection or support file under a class-level umbrella.
> 5. Iterate. After one consolidation round, scan the remaining set and look for the NEXT umbrella opportunity. Don't stop after 3 merges.
>
> Your toolset:
>   - skills_list, skill_view        — read the current landscape
>   - skill_manage action=patch      — add sections to the umbrella
>   - skill_manage action=create     — create a new umbrella SKILL.md
>   - skill_manage action=write_file — add a references/, templates/, or scripts/ file under an existing skill (the skill must already exist)
>   - skill_manage action=delete     — archive a skill. MUST pass `absorbed_into=<umbrella>` when you've merged its content into another skill, or `absorbed_into=""` when you're truly pruning with no forwarding target. This drives cron-job skill-reference migration — guessing from your YAML summary after the fact is fragile.
>   - terminal                       — move LOCAL candidate content into a support subfile when package integrity requires it; never mv, cp, rm, patch, or rewrite bundled, hub-installed, or external-dir skills
>
> 'keep' is a legitimate decision ONLY when the skill is already a class-level umbrella and none of the proposed merges would improve discoverability. 'This is narrow but distinct from its siblings' is NOT a reason to keep — it's a reason to move it under an umbrella as a subsection or support file.
>
> Expected output: real umbrella-ification. Process every obvious cluster. If you end the pass with fewer than 10 archives, you stopped too early — go back and look at the clusters you left alone.
>
> When done, write a human summary AND a structured machine-readable block so downstream tooling can distinguish consolidation from pruning. Format EXACTLY:
>
> ## Structured summary (required)
> ```yaml
> consolidations:
>   - from: <old-skill-name>
>     into: <umbrella-skill-name>
>     reason: <one short sentence — why merged, not just 'similar'>
> prunings:
>   - name: <skill-name>
>     reason: <one short sentence — why archived with no merge target>
> ```
>
> Every skill you moved to .archive/ MUST appear in exactly one of the two lists. If you consolidated X into umbrella Y (patched Y, wrote a references file to Y, or created Y with X's content absorbed), X goes under `consolidations` with `into: Y`. If you archived X with no absorption — truly stale, irrelevant, or obsolete — X goes under `prunings`. Leave a list empty (`consolidations: []`) if none. Do not omit the block. The block comes AFTER your human-readable summary of clusters processed, patches made, and decisions left alone.

There is also a dry-run prompt prefix (`agent/curator.py:~380-400`) instructing the model that "Your
output IS the deliverable… describe the actions you WOULD take, not actions you took," so a human
reviewer can approve a live run with `hermes curator run`.

### 2.4 Self-report vs tool-call-audit cross-check — yes, three signals reconciled

The curator does not trust the model's YAML self-report alone. Three independent signals are
reconciled:

1. **Live tool-call capture**: `_run_llm_review()` (`agent/curator.py:1923-1941`) records the forked
   reviewer agent's actual tool calls from its in-memory `_session_messages` (not a persisted audit
   log).
2. **Model self-report**: the required `consolidations:`/`prunings:` YAML block is parsed by
   `_parse_structured_summary()` (`curator.py:723-801`).
3. **Authoritative delete-time declaration**: `_extract_absorbed_into_declarations()`
   (`curator.py:804-855`) reads the `absorbed_into=` argument the model was required to pass on each
   `skill_manage action=delete`. A substring/path heuristic, `_classify_removed_skills()`
   (`curator.py:601-720`), additionally infers absorption from tool-call arguments.

`_reconcile_classification()` (`curator.py:858-986`) merges all three by priority and **explicitly
flags model hallucinations** when a claimed umbrella doesn't exist on disk post-run
(`curator.py:927-965`; warning text at `curator.py:1342-1347`). Relatedly, a code-level gate —
`_curator_consolidation_delete_guard` (`tools/skill_manager_tool.py:405-452`) — refuses a curator
delete unless `absorbed_into` names an umbrella that actually exists on disk (added after issue
#29912, a fail-open bug where whole clusters got archived with zero verified consolidations).

### 2.5 Usage telemetry

Stored at `~/.hermes/skills/.usage.json` (`tools/skill_usage.py:81-86`), keyed by skill name. Record
schema (`_empty_record()`, `tools/skill_usage.py:484-497`): `created_by, use_count, view_count,
last_used_at, last_viewed_at, patch_count, last_patched_at, created_at, state, pinned, archived_at`.
**No success/failure-rate field exists.** Bumped via `bump_view()`, `bump_use()`, `bump_patch()`.
Curator consumption: `agent_created_report()` (`tools/skill_usage.py:870+`) feeds
`apply_automatic_transitions()` (`curator.py:314`) and the LLM prompt's candidate list via
`_render_candidate_list()` (`curator.py:1458-1477`). Note the prompt's Hard Rule 4 explicitly
instructs the LLM to *discount* these counters ("The counters are new and often mostly zero").

---

## 3. The memory tool's consolidation path (`tools/memory_tool.py`)

### 3.1 Bounded file sizes — 2,200 and 1,375 chars, confirmed

Two parallel stores (`tools/memory_tool.py:5-9`):

- `MEMORY.md` — agent's own notes/observations — capped at `memory_char_limit`, default **2,200**
  chars.
- `USER.md` — what the agent knows about the user — capped at `user_char_limit`, default **1,375**
  chars.

Defaults appear at `MemoryStore.__init__` (`tools/memory_tool.py:130`), `load_on_disk_store()`
(`memory_tool.py:804-805`), and the config schema (`hermes_cli/config.py:2077-2078`, with comments
"~800 tokens at 2.75 chars/token" and "~500 tokens at 2.75 chars/token"; user-overridable via
`memory.memory_char_limit` / `memory.user_char_limit`).

The limit applies to the **whole file's joined entry text**: `_char_count()`
(`memory_tool.py:325-329`) computes `len(ENTRY_DELIMITER.join(entries))` with
`ENTRY_DELIMITER = "\n§\n"` (`memory_tool.py:59`).

**On overflow the write is rejected — never truncated, never auto-consolidated.** `add()`
(`memory_tool.py:336-386`) checks the would-be total at line 367 and returns an error via
`_consolidation_failure(...)` (line 369); `replace()` (`memory_tool.py:388-455`) does the same at
line 437. Nothing is written in either case.

### 3.2 "Forced consolidation" — delegated to the calling model, no LLM rewrite call exists

There is **no dedicated consolidation function and no LLM call that rewrites/summarizes memory**. A
repo-wide grep for `consolidat` shows every hit outside `memory_tool.py` belongs to other subsystems
(the curator's skill consolidation, and batch-completion summaries in `tools/process_registry.py` /
`tools/delegate_tool.py`).

Instead, the overflow error *instructs the model to consolidate in-band* — verbatim
(`memory_tool.py:371-377`):

> Memory at {current}/{limit} chars. Adding this entry ({len} chars) would exceed the limit. Consolidate now: use 'replace' to merge overlapping entries into shorter ones or 'remove' stale or less important entries (see current_entries below), then retry this add — all in this turn.

The model is expected to shrink entries itself with `replace`/`remove` (plain string operations —
no summarization prompt anywhere) and retry. A per-turn loop-breaker caps retries:
`_MAX_CONSOLIDATION_FAILURES_PER_TURN = 3` (`memory_tool.py:128`), enforced by
`_consolidation_failure()` (`memory_tool.py:145-166`); after 3 at-capacity failures in one turn the
tool returns a terminal error:

> Memory consolidation failed {n} times this turn. Stop retrying memory calls — leave memory unchanged for now and continue with your reply to the user. The fact can be saved in a later turn.

### 3.3 Batch atomicity — `apply_batch()`, all-or-nothing

`MemoryStore.apply_batch(self, target, operations)` at `tools/memory_tool.py:497-613`. Docstring
(lines 498-508): "All operations are validated and applied against the FINAL budget — intermediate
overflow is irrelevant... Semantics: all-or-nothing. If any op is malformed, doesn't match, or the
net result would exceed the char limit, NOTHING is written."

Mechanics:

- Operates on an in-memory copy (`working = list(self._entries_for(target))`, line 529); live state
  and disk are untouched until the whole batch validates.
- Any per-op failure returns via `_batch_error(...)` (604-613), which appends "No operations were
  applied (batch is all-or-nothing)."
- Final char budget checked only after all ops apply cleanly (583-596); then
  `self._set_entries(target, working); self.save_to_disk(target)` (599-600).
- The whole batch holds a single file lock (`with self._file_lock(...)`, 523) with one
  `_reload_target` drift check (524) — atomic w.r.t. concurrent sessions too.
- Persistence itself is crash-safe: temp file + `os.replace()` rename (`_write_file`,
  `memory_tool.py:759-788`).
- The tool schema documents the semantics to the model (`MEMORY_SCHEMA`,
  `memory_tool.py:1058-1123`): "The batch applies atomically and the char limit is checked only on
  the FINAL result."
- A separate write-approval-gate path stages the entire batch as one unit when approval mode is on
  (`_apply_batch_write_gate()`, `memory_tool.py:880-924`).

### 3.4 Drift detection and threat-pattern scanning — both present, independent mechanisms

**(a) Threat-pattern scanning of memory content.** `_scan_memory_content()`
(`memory_tool.py:63-80`) calls `first_threat_message(content, scope="strict")` from
`tools/threat_patterns.py` (284 lines). Called on every `add` (line 343), `replace` (398), and every
op of `apply_batch` (515-521 — scanned before touching disk; "a single poisoned op rejects the whole
batch"). The pattern library covers classic prompt injection ("ignore…previous…instructions",
system-prompt override), role/identity hijack, C2/"Brainworm"-style promptware ("register as a
node", heartbeat/beacon/check-in, named C2 frameworks like cobalt strike / sliver / metasploit),
secret exfiltration via curl/wget/cat, SSH persistence (`authorized_keys`, `~/.ssh`), hardcoded
secrets, and invisible-unicode injection. Memory uses the `"strict"` (broadest) scope because — per
the comment at `memory_tool.py:68` — "memory enters the system prompt as a FROZEN snapshot, so a
poisoned entry persists for the entire session and across sessions." Block message
(`threat_patterns.py:258-276`):

> Blocked: content matches threat pattern '{pid}'. Content is injected into the system prompt and must not contain injection or exfiltration payloads.

(or for invisible unicode: "Blocked: content contains invisible unicode character {codepoint}
(possible injection).")

Additionally, `load_from_disk()` (`memory_tool.py:168-241`) re-scans every on-disk entry at load
time (catching writes made outside the tool) and replaces flagged entries **in the system-prompt
snapshot only** with a placeholder (233-237):

> [BLOCKED: {filename} entry contained threat pattern(s): {findings}. Removed from system prompt; use memory(action=remove) to delete the original.]

— on-disk content is left intact for the user to inspect/remove.

**(b) External-edit drift detection (file-shape integrity).** `_detect_external_drift()`
(`memory_tool.py:704-757`) runs before any `replace`/`remove`/`apply_batch` (but deliberately not
`add`, which is append-only — `skip_drift=True` at `memory_tool.py:354`). Two signals: (1) the file
doesn't round-trip byte-identically through the tool's parser/serializer, or (2) any single parsed
entry exceeds the store limit — both indicating an external writer (shell append, manual edit,
sister session, patch tool). On drift, the file is snapshotted to `.bak.<timestamp>` and the
mutation is refused (`_drift_error()`, `memory_tool.py:83-110`):

> Refusing to write {path.name}: file on disk has content that wouldn't round-trip through the memory tool (likely added by the patch tool, a shell append, a manual edit, or a concurrent session). A snapshot was saved to {bak_path}. Resolve the drift first — either rewrite the file as a clean §-delimited list of entries, or move the extra content out — then retry. This guard exists to prevent silent data loss (issue #26045).

---

## 4. Live "nudge" mechanism

**Key finding: the "nudge" is not a mid-conversation message injection into the live model
context.** No text like "remember to save this to memory" is ever inserted into the primary
conversation. The internal names — `_memory_nudge_interval`, `_skill_nudge_interval`, config keys
`memory.nudge_interval` / `skills.creation_nudge_interval` — describe the *cadence of the background
review fork* documented in §1. What actually happens on the nudge cadence:

1. Turn-count / iteration-count triggers accumulate (`agent/turn_context.py:293-301`,
   `agent/conversation_loop.py:688-692`) — defaults **every 10 user turns** (memory) and **every 10
   tool iterations** (skills), `agent/agent_init.py:1236-1244, 1329-1332`.
2. At end of a completed turn, `agent/turn_finalizer.py:470-480` spawns the background fork
   (`agent._spawn_background_review(messages_snapshot=list(messages), ...)`, best-effort
   `except Exception: pass`).
3. The fork replays the conversation snapshot and receives the review prompt **as a user message in
   the fork only** (`agent/background_review.py:777-791`). The verbatim texts are the three prompts
   quoted in §1.4 — e.g. the memory nudge text is `_MEMORY_REVIEW_PROMPT`
   (`background_review.py:160-169`): "Review the conversation above and consider saving to memory
   if appropriate. …"
4. The only trace visible in the live session is a **status line, not a model-visible message**:
   `"💾 Self-improvement review: {summary}"` (`agent/background_review.py:828-840`).

Forked review/curator agents set both nudge intervals to 0 so a review can never trigger a nested
review (`background_review.py:675-676`).

For completeness: genuine mid-conversation injections *do* exist elsewhere in Hermes, but neither
concerns memory persistence — a verify-on-stop nudge (`agent/verification_stop.py`,
`build_verify_on_stop_nudge`) and an empty-response recovery nudge
(`agent/conversation_loop.py:4697-4752`).

---

## 5. Robustness properties overall

### 5.1 Failure handling — log-and-continue everywhere, no retries

- **Background review**: the whole worker thread is wrapped
  (`agent/background_review.py:842-844`): `except Exception as e: logger.warning("Background
  memory/skill review failed: %s", e); agent._emit_auxiliary_failure(...)`. The `finally` block
  (845-869) does cleanup with each step in its own `try/except: pass`. No retry; **partial tool
  writes made before a mid-review failure are not rolled back.** The spawn site itself is
  best-effort (`turn_finalizer.py:474-478`).
- **Curator**: `_run_llm_review` never raises (`curator.py:1942-1944` — records
  `result_meta["error"]`); the caller `_llm_pass` catches again and records the error in the run
  summary (1667-1677); `maybe_run_curator` has a final catch-all returning `None` (1958-1977).
- **Memory manager (external providers)**: every provider entry point is per-provider
  try/except-log-continue (`agent/memory_manager.py:463-473, 505-515, 592-612, 749-756, 1079-1086`);
  sync runs on a background thread because a misconfigured provider was once observed blocking
  ~298 s (comment at 568-577).

### 5.2 Idempotency — curator yes, memory tool yes, background review no

- **Curator**: `should_run_now()` gates on `last_run_at` vs `interval_hours`
  (`curator.py:219-269`), persisted in `~/.hermes/skills/.curator_state` (71-72).
  **`last_run_at` is written *before* the LLM pass** (`curator.py:1561-1567`), so a mid-review crash
  cannot re-trigger a run. `apply_automatic_transitions` (291-369) is idempotent by construction
  (timestamp-derived, pure function).
- **Memory tool**: `add()` refuses exact duplicates — "Entry already exists (no duplicate added)."
  (`tools/memory_tool.py:359-361`); batch adds skip duplicates (539-544); re-running a
  `replace`/`remove` fails closed with "No entry matched" (410-415, 471-476).
- **Background review: no run-level idempotency guard was found.** Nothing marks a turn range as
  reviewed; the same snapshot could in principle be reviewed twice.
  `summarize_background_review_actions` (`background_review.py:363-397`) dedupes *reporting* only,
  not work.

### 5.3 Audit trail — curator yes, background review and memory no

- **Curator**: per-run reports under `~/.hermes/logs/curator/{YYYYMMDD-HHMMSS}/`
  (`_reports_root()`, `curator.py:561-580`), written by `_write_run_report()`
  (`curator.py:1079-1268`): `run.json` (1241-1248 — consolidated/pruned/state_transitions/
  tool_calls/llm_final), human-readable `REPORT.md` (1250-1255), and `cron_rewrites.json`
  (1257-1266). Path saved to `.curator_state` as `last_report_path` (1719).
- **Background review**: no persistent audit file — transient console status output only
  (`background_review.py:828-840`).
- **Memory tool/manager**: no dedicated audit log; standard logger calls only.
  (`tools/skill_provenance.py` is a ContextVar origin flag, not a history log.)

### 5.4 Reversibility — archive-not-delete for skills; hard deletes for memory

- **Skills**: `curator.py:16-19` docstring: "Never auto-deletes — only archives. Archive is
  recoverable." Archival = moving the skill directory into `~/.hermes/skills/.archive/`
  (`tools/skill_usage.py:696-753`; prompt hard rule 2 at `curator.py:422-424`); restore via
  `hermes curator restore <name>` (`curator.py:1321-1327`). On top of that,
  `agent/curator_backup.py` tarballs the **entire skills directory** to
  `.curator_backups/<utc-iso>/skills.tar.gz` before each curator run (`snapshot_skills()`,
  `curator_backup.py:211-285`, invoked at `curator.py:1535-1544`); `rollback()`
  (`curator_backup.py:539-683`) snapshots current state first so rollback itself is undoable; keeps
  the last 5 backups.
- **Memory: entries are hard-deleted** — `MemoryStore.remove()` pops and saves
  (`memory_tool.py:491-493`), and `_delete_memory` (`agent/learning_mutations.py:144-151`) does
  `del chunks[local]` with no backup. The only memory-side backup is the drift-detection
  `.bak.<timestamp>` snapshot, and that is written when a write is *refused*, not before a delete
  (`memory_tool.py:704-757`).

### 5.5 Contradiction handling — not found

**No code detects that a new learning contradicts existing memory.** `add()` checks only for exact
duplicates; `replace()` locates its target by substring entirely at the model's discretion
(`memory_tool.py:408`). Near-misses that are *not* contradiction handling:
`_reconcile_classification` (`curator.py:858+`, reconciles reporting signals),
`_is_tracked_user_modification` (`skills_sync.py:871-880`, hash-conflict guard), and prompt-level
guidance telling the review/curator LLM to patch skills that "turned out to be wrong … or outdated"
(`curator.py:195, 296-297`; `background_review.py:194-195`). Contradiction resolution is thus
implicitly delegated to the LLM at write time, with no code backstop.

### 5.6 Deduplication — exact-string only

- Pre-write exact-match check: `if content in entries: return … "Entry already exists"`
  (`memory_tool.py:359-361`); batch variant at 539-544; load-time dedup via
  `list(dict.fromkeys(...))` (192-193, 305).
- Skill-level dedup is deliberately **delegated to the LLM curator**, not code — the background
  review prompt says to just *note* overlap ("the background curator handles consolidation at
  scale," `background_review.py:239-240`); the curator prompt is the consolidation engine
  (`curator.py:406, 436-448`).
- **No embeddings, cosine similarity, or fuzzy matching anywhere.** (The token-overlap scoring in
  `agent/learning_graph.py:227-245` only draws graph edges; it does not gate writes.)

### 5.7 Overall robustness shape

The three layers get sharply different safety budgets:

- **Skills — full treatment**: pre-run tarball snapshot, archive-not-delete, per-run audit reports
  (`run.json` + `REPORT.md`), run-interval high-water-mark idempotency, code-enforced
  read-before-write and absorbed-into-must-exist guards, optional human diff approval.
- **Memory — medium**: hard char budgets with model-in-the-loop consolidation, all-or-nothing
  batches, threat-pattern scanning on every write plus load-time rescans, drift refusal with
  `.bak` snapshots — but hard deletes, no audit trail, no contradiction detection, exact-dup-only
  dedup.
- **Background review — least guarded**: log-and-abandon on failure, no idempotency marker, no
  persisted audit trail; its safety comes almost entirely from the runtime tool whitelist, the
  isolation pins on the fork, and the strict provenance-gated write guards inside
  `skill_manager_tool.py`.

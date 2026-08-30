# letta-code — Deep Technical Dive

*Repo: [letta-ai/letta-code](https://github.com/letta-ai/letta-code), read at shallow-clone HEAD `d90d3bf` (2026-07). TypeScript/Bun, Ink TUI. All file:line citations are into the clone at `scratchpad/letta-code`.*

**What it is:** a Claude-Code-shaped CLI where the agent is not a process you start but a **persistent server-side entity** — "agents that are more like people than tools... memory, identity, and a sense of experience over time" (README.md:5). Built by the MemGPT / sleep-time-compute people. The interesting question for us (building on Claude Code / Agent SDK): what actually changes about a coding CLI when the agent persists?

---

## 1. Architecture

### CLI ↔ server relationship

The CLI is a thin(ish) client over a `Backend` interface (`src/backend/backend.ts:140-267`) whose method shapes are literally derived from the official Letta SDK client (`Awaited<ReturnType<APIClient[...]>>`, importing `@letta-ai/letta-client` at backend.ts:2). Two implementations:

- **`APIBackend`** (backend.ts:274-483) — the default. Every call goes to a remote Letta server over the SDK: Letta Cloud (`api.letta.com`, "Constellation") or a self-hosted server via `LETTA_BASE_URL` (client construction in `src/backend/api/client.ts:150-298`, server-URL resolution at :112-119). **The agent loop, LLM calls, memory blocks, and message history all live on the server.** The CLI streams conversation messages via SSE (`Stream<LettaStreamingResponse>` from the SDK, `src/agent/message.ts:1,437`; `Accept: text/event-stream` in `src/backend/api/http-headers.ts:19-24`).
- **`LocalBackend`** (`src/backend/local/local-backend.ts:287`) — experimental, gated by `LETTA_LOCAL_BACKEND_EXPERIMENTAL=1` (CLAUDE.md:190). Fully in-process, no server, no sqlite — plain JSON/files under `~/.letta/lc-local-backend` (`src/utils/local-backend-paths.ts:19-25`). The CLI itself runs the agent loop via a `ProviderTurnExecutor` calling providers directly through `@earendil-works/pi-ai` (`src/backend/dev/provider-turn-executor.ts:2,392-399`).

Mode selection is centralized in `src/backend/backend-mode.ts:24-28` → `createBackendForMode()` (backend.ts:499-501) → process-wide singleton `getBackend()` (:509-512). Agent IDs are mode-tagged (`agent-local-*` prefix; `isAgentIdCompatibleWithBackend`, `src/agent/agent-id.ts:11-18`) so you can't resume a cloud agent against the local store.

A consequence of server-side execution: `src/providers/` in the default mode is **key management, not inference** — BYOK keys / OAuth (e.g. ChatGPT OAuth) get registered *on the server* (`src/backend/api/providers.ts`) so the server can call the model. Only in local-backend mode does the CLI process do LLM calls itself.

There's also a WebSocket layer, but pointed the other way: `src/websocket/app-server.ts` makes *letta-code the WS server* so the desktop app / relay / chat.letta.com can drive the same in-process runtime (comment at app-server.ts:31-38). CLI→Letta-server is SSE; desktop→CLI is WS.

### Agent & session lifecycle

Agents are durable named entities; the project↔agent binding is a **resumable LRU pointer, not an enforced 1:1**. Startup resolution is a pure decision tree, `resolveStartupTarget()` (`src/agent/resolve-startup-agent.ts:75-142`):

1. `--new-agent` → create
2. exactly one pinned agent → resume it
3. multiple pins → selector UI
4. **per-project LRU** (`.letta/settings.json` in the project dir; `settingsManager.getLocalLastAgentId`, `src/settings-manager.ts:1331`)
5. **global LRU** (`~/.letta/settings.json`, :1198)
6. backend-store fallback → selector → create fresh

Pointers are stored in a `sessionsByServer` map keyed by normalized server URL (settings-manager.ts:101) — separate "last agent" per backend. Pinning is implemented as a **server-side tag** `favorite:user:<ownerId>` on the agent (`src/agent/favorites.ts:29-31,123-172`) so pins follow you across machines. `~/.letta/sessions.jsonl` is a local append-only audit log (`src/agent/session-history.ts:48-58`), not the resume mechanism.

On every resume, `reconcile-existing-agent-state.ts:118-186` patches drift (missing base tools, compaction-model settings) between what the server-side agent has and what this CLI version expects — a maintenance chore that simply doesn't exist in a stateless harness, and a real cost of statefulness: your agent's config can be *older than your CLI*.

### Conversations vs. agents

Conversations are a first-class server resource distinct from agents (`client.conversations.*` alongside `client.agents.*`, backend.ts:73-104). Every agent has an implicit `"default"` conversation plus any number of named ones (`getConversationResumeTail` branches on `conversationId !== "default"`, backend.ts:402-429); conversations can be **forked** (`forkConversation`, backend.ts:261-264). Mapping to Claude Code: agent ≈ persistent identity + memory; conversation ≈ session/transcript — except many conversations can run against one agent, concurrently, from different surfaces (TUI, Slack, cron). Global-LRU resume deliberately drops the conversation ID so conversations stay project-scoped (resolve-startup-agent.ts:112 comment). Auto-titling exists (`src/agent/conversation-description.ts:20-28`), same as Claude Code's session titles.

---

## 2. What persistence changes

### Memory blocks

A memory block is `{label, value, description?, read_only?}` (built from frontmattered `.mdx` prompt files, `src/agent/memory.ts:26-52`). The standard blocks are just **`persona`** and **`human`** (memory.ts:16) — earlier per-project blocks (`skills`, `loaded_skills`) were removed in favor of system-reminder injection. Seeds are telling: `persona.mdx` opens "I'm a coding assistant, ready to be shaped by how we work together"; `human.mdx` opens blank ("I haven't gotten to know this person yet"). The identity story is *designed to be earned over time*, not configured.

On the cloud backend these are true Letta core-memory blocks the server compiles into the system message (`getDefaultMemoryBlocks()`, memory.ts:98-106). On the local backend, `renderMemfsProjection()` (`src/backend/local/system-prompt-compilation.ts:224-266`) compiles memory files into the system prompt: `system/persona.md` wrapped in `<self>…</self>`, other `system/*.md` and root files in `<memory>…</memory>`, each annotated with its file path via `<projection>` — the agent sees *where in the filesystem each piece of its own mind lives*.

### MemFS: memory is a git repo

The headline design decision. Each agent's memory is a real git repository at `~/.letta/agents/<agentId>/memory/` (`getMemoryFilesystemRoot`, `src/agent/memory-filesystem.ts:43-54`; `git init` + `main` branch setup in `src/agent/memory-git.ts:1624-1685`). Contents: `system/` (persona/human/project files), arbitrary reference files, and `skills/<name>/SKILL.md` (flat skill files are rejected by an installed pre-commit hook, memory-git.ts:793-830).

Commit discipline is strict and per-edit:

- The agent's self-editing `memory` tool (`src/tools/impl/memory.ts:98-151`, commands `str_replace|insert|delete|rename|create|update_description`) and `memory_apply_patch` sibling call `commitMemoryWrite()` synchronously after **every operation** (memory.ts:121-131 → memory-git.ts:1541-1580), `git add -A -- <paths>` + commit with the agent as author.
- `assertMemoryRepoCleanForWrite()` (memory-git.ts:1464-1478) refuses edits on a dirty repo — one commit per tool call, always.
- Push to the Letta-hosted remote is **per-turn**: `runPostTurnMemorySync()` (`src/reminders/memory-git-sync.ts:62-96`) runs after each turn from all frontends, pushing pending commits (rebase on non-FF). A dirty/conflicted repo produces a `<system-reminder>` telling *the agent* to resolve it (memory-git-sync.ts:16-60).
- `/memory-repository set git@github.com:...` wires a **second, user-owned remote**: URL stored in git config `letta.memoryRepository.url`, and a bash `post-commit` hook pushes there asynchronously on every commit (memory-git.ts:960-994, 1181-1247). Your agent's mind, mirrored to your own GitHub repo, with full history.

So the memory model is: **agent identity = a git repo the agent commits to, with a durable audit trail of every self-edit.** You can `git log` your agent's personality.

### Learning: reflection / "dreaming"

The sleep-time-compute research shows up as the built-in `reflection` subagent (`src/agent/subagents/builtin/reflection.md`), branded "dreaming" in the UI (`src/cli/display/product-status/default.ts:33-42`; success message: *"Built a memory palace of you. Visit it with /palace."*, `src/cli/helpers/memory-subagent-completion.ts:103`). Triggers (`src/cli/helpers/memory-reminder.ts:6,33-36`): `off` | `step-count` (default 25) | `compaction-event` (the default — memory consolidation rides on context compaction, which is a nice pairing: the moment you'd lose detail is the moment you distill it). The reflection subagent gets only `Bash` and `Edit`, follows a 5-phase Investigate→Extract→Update→Review→Commit procedure over recent transcript deltas (`src/cli/helpers/reflection-transcript.ts` builds JSONL transcript diffs and memory snapshots), edits memory files and **creates/updates/extends/deprecates/splits skills** (reflection.md:41-44,105-151), and commits with attribution trailers `Generated-By: Letta Code / Agent-ID: / Parent-Agent-ID:` (reflection.md:173-196).

### Across restarts, and the CLAUDE.md question

Restart in the same project → same agent ID → same server-side memory blocks and same MemFS repo. Durable: persona, human, project memory, skills. Ephemeral: the conversation (unless the local-project LRU also resumes the conversation ID) and process-local state.

**There is no CLAUDE.md auto-load.** Genuinely different philosophy: `AGENTS.md`/`CLAUDE.md` are treated as *source material to digest once*, not context to re-inject every session. The `init` subagent (`src/agent/subagents/builtin/init.md:33`) and the `initializing-memory` skill (`src/skills/builtin/initializing-memory/SKILL.md:510,617`) read them during an explicit memory-initialization pass and distill them into MemFS `system/project.md`-style files; after that, only the agent's own summary is in context. (The seed `project.mdx` prompt even instructs: "If there's an AGENTS.md, CLAUDE.md, or README, I should read it early.") Upside: the agent's project knowledge can *exceed* the doc, and stays sized to what mattered. Downside: your carefully-authored instructions survive only as the agent's paraphrase, and drift between repo doc and agent memory is invisible unless reflection re-reads it.

(Ironically, letta-code's own repo carries a byte-identical CLAUDE.md/AGENTS.md pair (201 lines each) — written for Claude Code and Codex agents working *on* letta-code. It's an excellent example of the "rules + why each exists" genre, aggressively optimized for grep-navigability: `@/` imports only, kebab-case filenames, named exports only, `export function` only, zero cycles enforced by madge, layer boundaries enforced by script — each justified by "agents navigate by searching" (CLAUDE.md:26,45,53,61).)

---

## 3. Tooling

### Tool surface — one registry, three dialects

`src/tools/tool-definitions.ts:170-490` maps tool name → `{schema, description, impl}`. Implementations in `src/tools/impl/` cover the familiar set: `read/write/edit/multi-edit`, `bash/shell/exec-command`, ripgrep-backed `grep/glob/ls`, `apply-patch`, `view-image`, `todo-write/update-plan`, `task` (subagents), `skill`, plus the novel ones: `memory`/`memory-apply-patch` (self-editing memory, §2) and `message-channel` (send to Slack/Discord/Telegram).

The clever bit: **parallel toolsets per model family**. Anthropic-style PascalCase (`Read`, `Edit`, `Bash`, `Task`), Gemini snake_case (`run_shell_command`, `read_file_gemini`), and OpenAI/Codex (`apply_patch`, `shell`, `exec_command`) — often the same `impl` registered under multiple names/schemas. `deriveToolsetFromModel` (`src/tools/toolset.ts:81-90`) picks the dialect the model was RLHF'd on, and `switchToolsetForModel` (toolset.ts:734-817) hot-swaps the loaded set — including swapping in the right memory-tool variant (`ensureCorrectMemoryTool`, :564-639) — when you `/model` to a different provider *mid-agent-lifetime*. A stateless harness picks a toolset at launch; a persistent agent must survive its tools being renamed under it.

Server-side statefulness also shows in bootstrap: `bootstrapBaseToolsIfNeeded()` (`src/agent/bootstrap-tools.ts:23-41`) POSTs `/v1/tools/add-base-tools` once per machine because the **server** owns tool definitions; there's a whole recovery path (`createAgentWithBaseToolsRecovery`, `src/agent/create.ts:91-121`) for agent creation failing when base tools are missing. Client-defined-per-request tools (Claude Code's model) make this entire failure class impossible.

### Sandbox

Real OS-level FS sandboxing, not just cwd discipline: macOS Seatbelt (`sandbox-exec`) and Linux bubblewrap, with a live `bwrap --unshare-user /bin/true` probe (`src/sandbox/availability.ts:117-166`), a pure policy layer (`policy.ts:39-112`) rendered to OS argv (`wrap.ts:21-45`). Notably split by trust level: **memory subagents (reflection/init/etc.) are sandboxed by default** — confined so they can't touch other agents' `~/.letta/agents/<id>` dirs — while the interactive agent's own Bash is sandboxed only with `LETTA_FS_SANDBOX=1` "because it broke legitimate workflows." Fail-open with a warning if no backend available (availability.ts:102-115).

### Permissions — and approvals that survive crashes

`src/permissions/checker.ts` (~990 lines) is an ordered rule pipeline (documented ~:146-159): deny rules → CLI disallow → alwaysAsk/mod policy → an **unbypassable cross-agent memory guard** (:300-320, no agent may edit another agent's memory) → CLI allow → Skill always-allow → read-only-shell auto-allow (:485-494) → memory-dir/cwd auto-allow → session allows → settings allow/ask → mode default. Modes mirror Claude Code: `standard` / `acceptEdits` / `unrestricted` with legacy-name migration (`src/permissions/mode.ts:1-149`); glob allow/deny/ask rules in settings mirror `permissions.allow/deny`.

The stateful twist is the best single idea in the repo: **approval requests are durable server-side messages** (`approval_request_message` / `approval_response_message` / `tool_return_message`). On resume, `src/agent/check-approval.ts:45-158` scans recent conversation messages and reconstructs pending approvals as those whose `tool_call_id` has no later response. So a permission prompt survives a CLI crash, a laptop reboot, or being answered from a *different surface*. `src/agent/turn-recovery-policy.ts` handles the flip side — a new turn starting while the server still holds a stale pending approval gets it auto-denied with `STALE_APPROVAL_RECOVERY_DENIAL_REASON` before proceeding. In Claude Code a pending prompt is pure client-process state; here it's a row in the conversation.

### Hooks and mods

Hooks (`src/hooks/types.ts:7-24`) are explicitly Claude-Code-modeled — `PreToolUse`, `PostToolUse`, `UserPromptSubmit`, `Stop`, `SubagentStop`, `PreCompact`, `SessionStart/End` — plus two additions: **`PostToolUseFailure`** (feeds stderr back to the agent; types.ts:10) and **`PermissionRequest`** (can allow/deny at dialog time; :11). Hook types: `command` (shell, "Claude Code-compatible" per comment, types.ts:33-63) and a novel **`prompt` hook** — the payload goes to an LLM for evaluation (`$ARGUMENTS` templating, supported-event subset at :75-83). LLM-as-hook-judge, natively.

**Mods** are a different animal from hooks: per `src/mods/README.md:1-11`, "trusted local code that the agent can inspect, edit, reload, and repair" — installable JS/TS packages (`package-installer.ts`, manifests) that register tools, permission policies, statusline renderers, and turn-lifecycle handlers (`mod-engine.ts`, `tool-registry.ts`, `permission-registry.ts`). The design doc explicitly keeps the host API thin and lets mods "just be code" (README:15-38), with a `--no-mods` / `LETTA_DISABLE_MODS=1` safe-mode kill switch. This is the "agents rewrite the harness itself" claim made concrete — the agent can author a mod that changes its own harness, and compatibility is explicitly not guaranteed (README:59-76).

### Subagents — other agents, not sub-contexts

Built-ins are markdown+frontmatter files bundled at build (`src/agent/subagents/index.ts:20-46`): `fork`, `general-purpose`, `history-analyzer`, `init`, `memory`, `recall`, `reflection`. Frontmatter includes `tools`, `model`, `skills`, `fork`, `background`, and `launchProfile` (`memory-subagent` gates the default-on sandbox). User/project overrides load from `~/.letta/agents/*.md` and `.letta/agents/*.md` (index.ts:93-101,343-369).

Execution model is the striking part: `spawnSubagent` (`src/agent/subagents/manager.ts`) **spawns the `letta` CLI binary itself in headless mode as a child process** (manager.ts:1039 "Execute a subagent... by spawning letta in headless mode") pointed at a target agent/conversation. And the `Task` tool (`src/tools/impl/task.ts`; description `src/tools/descriptions/Task.md:32-71,101-123`) accepts:

- `subagent_type` → fresh templated subagent (a new Letta agent+conversation);
- **`agent_id`** → deploy an *existing* stateful agent into a new conversation, with its own persona/memory intact (task.ts:630-661) — any agent, including the caller itself;
- **`conversation_id`** → *resume* a previous subagent conversation with full history;
- `subagent_type: "fork"` → run against a **forked copy of the parent's own conversation**, inheriting full context (and sharing prompt cache across parallel forks).

Claude Code's Task tool creates throwaway contexts; here subagents are durable peers you can re-engage, and "delegate to a colleague who remembers the last time you asked" is a native primitive. The `recall` and `history-analyzer` built-ins exist *because* there's history worth mining — agents can search their own and other agents' past conversations (also user-facing as `/search`, backed by `src/backend/message-search.ts`).

### Skills

Directly SKILL.md-compatible — `src/skills/builtin/creating-skills/SKILL.md:1-8` points at agentskills.io/specification; same anatomy (frontmatter + body + `scripts/`/`references/`/`assets/`). The README even documents installing skills from ClawHub and Hermes Skills Hub verbatim (README.md:80-84). Four sources (`src/agent/skill-sources.ts:4-19`): `bundled`, `global` (`~/.letta`), `project` (`.agents/skills`), and the novel **`agent`** scope — skills living in the agent's MemFS git repo, written by the agent (usually via reflection). Skill learning is thus the same mechanism as memory learning: files in the identity repo, committed with attribution. Dispatch is an explicit always-allowed `Skill` tool (`src/tools/impl/skill.ts`; checker.ts:470-474) rather than automatic description-matching.

---

## 4. UX

### TUI

Familiar Ink architecture: `AppCoordinator.tsx` (5,077 lines of orchestration hooks) + `AppView.tsx` (1,724 lines composing ~30 overlays on an `activeOverlay` state machine, AppView.tsx:1553-1710) + `StaticTranscript.tsx` rendering committed history in `<Static>` with a carefully-chosen key (`${renderEpoch}-${hiddenToolCallId}`, StaticTranscript.tsx:45, with a comment accepting staleness to avoid reprinting history every tool call). Transcript item kinds include `subagent_group`, `trajectory_summary`, and `approval_preview` alongside the usual ones.

### Slash commands

~60 commands in `src/cli/commands/registry.ts`. Beyond the Claude-Code-familiar (`/model /init /clear /compact /mcp /hooks /statusline /usage /context /export /feedback /help`), the stateful-agent surface:

- **`/palace`** (`src/cli/app/use-submit-handler.ts:1302-1347`) — renders the agent's memory blocks/files as an HTML "memory palace" and opens it in the system browser (requires memfs; `generateAndOpenMemoryViewer` in `src/web/`). Memory inspection as a first-class, human-readable artifact.
- **`/doctor`** (use-submit-handler.ts:3273-3311) — *not* a static audit: it prompts the agent to invoke the `context-doctor` skill and interactively refine its own memory structure, asking the user questions. The system proactively suggests it when the compiled system prompt grows too large (`system-prompt-warning.ts:92`).
- **`/remember`, `/reflect`, `/sleeptime`, `/memfs`, `/memory-repository`, `/recompile`** — direct levers over the memory machinery.
- **`/agents` `/pin` `/fork` `/new` `/resume` `/rename` `/personality`** — agent/conversation management: tabbed agent picker (pinned/local/constellation/new, `AgentSelector.tsx:46,64-72`), separate conversation picker, personality presets that rewrite persona/human files (`src/agent/personality.ts:39-99`).
- **`/search`** — full-text search across all messages and all agents.
- **`/mods` `/toolset` `/experiments` `/bg` `/btw`** — harness meta.

### Learning visibility

The "is my agent learning?" question gets real UI: background reflection shows in a product-status line as **"dreaming"** with a spinner, elapsed time, and an OSC-8 clickable link to the agent's ADE page (`src/cli/display/product-status/default.ts:31-68`); completion posts "Built a memory palace of you. Visit it with /palace." The rotating thinking-verb spinner includes `learning`, `remembering`, `metathinking` (`thinking-messages.ts:2-42`) — cosmetic, but on-brand. Subagent/background completions are injected back into the conversation as structured `<task-notification>` blocks with task-id/status/summary/result (`src/utils/task-notifications.ts`, test :17-33) — the same pattern Claude Code uses for background tasks.

### Beyond the terminal: channels and cron

Because the agent lives server-side, the TUI is just one surface. `src/channels/` (README at src/channels/README.md:1-6) is a plugin architecture — Telegram/Slack/Discord/Signal/WhatsApp first-party, user plugins from `~/.letta/channels/<id>/` (`channel.json` + `plugin.mjs`) — with pairing (chat↔agent), inbound debouncing, and a `MessageChannel` tool so the agent can *initiate* messages. `src/cron/` implements self-managed schedules (`letta cron add --prompt ... --every 5m|--at 3pm|--cron ...`, `src/cli/subcommands/cron.ts:1-13`; scheduler + persisted cron-file + run-log) firing prompts at an agent/conversation with no TUI open. Same agent, same memory, from your terminal, your phone, and a timer.

The default statusline, notably, is minimal — `AgentName · ModelName` (`src/cli/display/statusline/renderers/Default.tsx:57-70`) — but fully mod-programmable via `/statusline`.

---

## 5. Honest read

### What statefulness genuinely buys

1. **Durable approvals.** Pending permission prompts as conversation messages (check-approval.ts:45-158) means crash-safe, surface-portable approvals plus a principled stale-approval recovery policy. This is strictly better than client-process prompt state.
2. **Memory-as-git.** Auditability (every self-edit is an attributed commit), user ownership (`/memory-repository` mirrors to your GitHub), conflict handling via familiar machinery, and clean layering (skills and persona are just files in the repo). The one-commit-per-tool-call + clean-repo-precondition discipline (memory-git.ts:1464-1478) is tight engineering.
3. **Subagents as durable peers.** `agent_id`/`conversation_id`/fork on the Task tool makes "resume the specialist that did this last time" and "parallel forks sharing my full context + prompt cache" native. The recall/history-analyzer built-ins and cross-agent `/search` only make sense with persistent history — and they're genuinely useful.
4. **One agent, many surfaces.** Channels + cron + desktop against the same identity is the "always-on colleague" pitch delivered for real, and it falls out of the architecture rather than being bolted on.
5. **Reflection tied to compaction** is an elegant default: distill to durable memory exactly when the context is about to lose detail.

### What's awkward

1. **The server is a hard dependency.** Default mode requires Letta Cloud or self-hosting; the no-server local backend is experimental and env-gated. Claude Code's "npm install and go" has no counterpart yet.
2. **State drift maintenance.** `reconcile-existing-agent-state.ts`, base-tools bootstrap + recovery paths, mode-tagged agent IDs, per-server session maps — a whole category of code exists to keep a durable agent consistent with an evolving client. Stateless harnesses get this for free.
3. **Paraphrase risk on project instructions.** No CLAUDE.md auto-load: your instructions live on as the agent's distillation in MemFS. Fine when reflection is diligent; opaque when it isn't. There's no drift detector between repo doc and agent memory.
4. **Trust surface.** Mods are unsandboxed "trusted local code" the agent can edit; hooks can be LLM-judged; the interactive agent's shell is unsandboxed by default (fail-open when no backend exists). The unbypassable cross-agent memory guard shows they're thinking about it, but the harness-self-modification story is bold.
5. **Sheer complexity.** Three tool dialects, hot toolset swapping, 5,000-line coordinator, approval reconstruction, git sync with rebase + system-reminder conflict escalation — the persistent-agent premise taxes every layer.

### Worth stealing for a Claude-Code-based system (Bee Box)

- **Memory/state as a git repo with per-edit agent-attributed commits.** Bee Box already has card files on disk; committing agent edits with `Generated-By`/`Agent-ID` trailers and a one-clean-commit-per-operation discipline would give us the audit trail and the `/palace`-style "show me what the agent believes" view almost for free.
- **Reflection-on-compaction.** For long-running box sessions: trigger a distill-to-cards pass exactly when context compacts, rather than on a timer.
- **`/doctor` as agent-led interactive audit.** "Prompt the agent to run a memory-hygiene skill and interview the user" is a pattern, not a Letta feature — directly portable to auditing a box's CLAUDE.md/rules/cards, and it pairs with proactive size warnings (system-prompt-warning.ts:92).
- **`PostToolUseFailure` and `prompt` hooks.** Feed-stderr-back-on-failure and LLM-judged hooks are both implementable in Claude Code hooks today with modest glue.
- **Durable approval semantics** for anything we run headless/scheduled: persist pending approvals as data so a restart can re-present or deliberately expire them, instead of losing them.
- **The AGENTS.md genre note:** their repo's rules-with-why, grep-optimized agent guide (CLAUDE.md:20-108) is one of the better examples of the form and worth cribbing stylistically.
- **Skill portability is confirmed ecosystem-wide** — SKILL.md per agentskills.io, with cross-hub installs (ClawHub, Hermes) documented in their README. Skills we author are letta-installable as-is.

The meta-lesson: letta-code demonstrates that "the agent persists" is less a feature than a *regime* — it reorganizes approvals, tooling, instructions, subagents, and UX around durable identity. Most of the individually clever pieces (git-backed memory, reflection triggers, doctor-style audits, failure-feedback hooks) are separable and portable to a stateless harness; the parts that aren't (cross-surface identity, durable peer subagents) are exactly the parts that require owning a server.

# Letta (MemGPT) vs Callback Box — non-memory architecture

*Added 2026-07-04 at boxholder request: "I know it has a lot of memory stuff, but that's not really my focus — what does the rest look like, and do they have clever ideas?" Sources: dives against clones of `letta-ai/letta` (Python server) and `letta-ai/letta-code` (TS/Bun CLI): [server/loop](letta-server-loop.md), [tools/rules](letta-tools-rules.md), [multi-agent/sleeptime](letta-multiagent-sleeptime.md), [letta-code](letta-code.md).*

## The shape

Letta agents are **stateful services**: FastAPI over async SQLAlchemy/Postgres, an agent is a DB row whose `message_ids` JSON column *is* the context window, behavioral class chosen per-request from persisted `agent_type`. Everything funnels through a single `_step()` shared by sync/streaming/background paths with exactly one message-persistence point — per-step DB commits make resumability implicit (a crash loses at most one in-flight step). Streaming is SSE; background runs are detached asyncio tasks draining into a Redis stream of seq-numbered chunks with cursor-based reattach and terminal-event synthesis on crash. Concurrency: fail-fast per-conversation Redis mutex, with idempotent-retry dedup that reattaches duplicate requests to the live run before touching the lock. 167 alembic migrations trace a JSON-blob→normalized-ORM arc; three generations of the step loop coexist (`letta_agent.py`, `_v2`, `_v3`).

`letta-code` is Claude Code re-imagined against that server: thin SSE client, projects don't own agents (pinned agents + LRU pointers; one agent hosts many forkable conversations across TUI/desktop/channel surfaces), subagents are spawned `letta` processes that can be any existing stateful agent, approvals are durable server-side messages that survive crashes. No CLAUDE.md auto-load — AGENTS.md is digested once into memory and only the paraphrase persists.

## The genuinely clever ideas (non-memory)

1. **Tool rules** — the crown jewel. Nine declarative rule types (`letta/schemas/tool_rule.py`): init, terminal, child/sequencing, conditional-branching, max-count-per-step, required-before-exit, parent-child, exclusive-group, requires-approval. A `ToolRulesSolver` enforces them every step: filters the available-tool set, forces calls, decides termination. **The same rule objects generate both the system-prompt description and the mechanical enforcement** — documentation and constraint cannot drift. (Contrast: our retro's validate guard was documented prose that never became code.) Honest edge: parallel tool execution is mutually exclusive with tool rules by design.
2. **Memory-as-git-repo** (MemFS / context repositories). Agent state as markdown+frontmatter in a git repo per agent; every self-edit is one *attributed commit*; per-turn push to a remote, mirrorable to the user's GitHub. Implementation notes worth having: they shell out to real git (abandoned dulwich), keep linear history under a lock instead of merging, and do mtime-delta sync of `.git` for cheap replication. **The memory-first company converged on the CBX substrate — files+git+markdown+commits-as-audit — after years on the DB-first approach.** Strongest external validation of our storage bet in the landscape.
3. **Durable approvals**: approval requests are first-class persisted messages with a pause/resume protocol in the loop — a crash or restart doesn't lose a pending decision. Same shape as our question cards (a pending decision with an id, resolution as data); confirmation, plus a reminder that the *loop pausing on* the pending decision is a coherent alternative to our fire-and-continue triage.
4. **Reflection-on-compaction as the default trigger** for the skills-writing "reflection" subagent in letta-code — independently the same moment we picked for the session-rotation memory-flush idea (triage row 8). Third system to converge there (OpenClaw memoryFlush, Hermes on_pre_compress).
5. **`.af` agent files** — portable agent-bundle export with structural ID remapping and secrets stripped by schema, not by regex. The "box as a portable artifact" idea done carefully.
6. **Resumable background streams**: Redis stream + cursor reattach + synthesized terminal event on crash. Maps directly onto our resumable per-turn chat stream (we do the equivalent over ring buffer + JSONL); their crash-synthesis detail (never leave a stream unterminated) is the part worth copying.
7. **Voice/latency split**: the hot streaming loop trims context synchronously and cheaply, then fires the real memory write into the background unawaited — accept eventual consistency to protect latency.
8. **Hooks judged by LLM** (letta-code): `PostToolUseFailure` hooks plus LLM-evaluated hook conditions.

## What's thin or absent (and what that tells us)

- **No scheduler, cron, timer, or idle wake anywhere.** Sleeptime triggers on a turn-count modulo (default: every 5 foreground turns); "check my email every morning" requires an external timer hitting the API. For a "stateful agents" platform, proactivity simply isn't built. CBX's schedules/wakeup/reactor stack has no Letta counterpart at all.
- **Multi-agent is mostly aspirational**: of six manager types, only sleeptime has a maintained path; supervisor's `step()` is commented out; swarm unimplemented. Matches the OpenClaw/Hermes/CBX consensus: flat beats hierarchy in practice.
- **Concurrency on shared state is soft**: shared blocks guarded by per-row optimistic version columns; concurrent read-modify-write can stomp; conflicts surface as uncaught tool errors. In-flight background work is lost on restart (no durable queue).
- **Context enforcement is reactive** (provider rejection → compact-and-retry) with display-grade bytes/4 counting. The V2 `request_heartbeat` continuation mechanism (continuation as an injected tool param arbitrated by tool rules) was abandoned in V3 for Claude-style implicit continuation — the industry converging on the Claude loop shape even when they own the loop.
- **Digest-don't-load instruction files**: AGENTS.md paraphrased once into memory rather than loaded verbatim each session. Deliberate, but the human loses direct edit control over what the agent actually sees — we prefer legible, human-ownable instruction files.

## Triage additions

See rows 8 (strengthened), 17–18 in the main doc.

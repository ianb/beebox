# Architecture Review: OpenClaw vs Callback

_February 2026_

## The Big Picture

OpenClaw is a **multi-channel AI gateway** — it routes messages from WhatsApp/Telegram/Discord/etc. to AI agents. Callback is a **file-based personal automation system** — it uses git-backed cards, a CLI, and Claude Code agents to manage information flows.

They solve different problems but share core concerns: agent orchestration, memory, extensibility, automation, and security. This review identifies ideas from OpenClaw's architecture that could benefit Callback.

---

## 1. Memory System — High Priority

**What OpenClaw has:** A sophisticated hybrid search memory with vector embeddings (sqlite-vec), BM25 full-text search, temporal decay, and MMR diversity re-ranking. Agents get `memory_search` and `memory_get` tools. Memory lives as markdown files (`MEMORY.md` + daily logs + topic files), indexed into SQLite with chunking.

**What Callback has:** Nothing persistent. Agents lose all context between sessions. The only "memory" is what's in git history and card files.

### Ideas

| Idea | Effort | Value |
|------|--------|-------|
| **Daily memory logs** — auto-create `memory/YYYY-MM-DD.md` files that agents append to during sessions | Low | High |
| **Memory flush before compaction** — silent agentic turn that says "write anything important to memory before context is lost" | Low | High |
| **Memory search tool** — `cb memory search <query>` that searches across memory files, card archives, and git history | Medium | High |
| **Bootstrap context injection** — load `MEMORY.md` + recent daily logs into agent context at session start | Low | Medium |
| **Topic-based memory files** — agents create `memory/projects.md`, `memory/contacts.md` etc. for durable knowledge | Low | Medium |

**Key insight:** OpenClaw's memory is just markdown files + an index. We already have a filesystem. The missing piece is (a) teaching agents to write memories, and (b) giving them a search tool to retrieve them.

---

## 2. Plugin/Skill Architecture — Medium Priority

**What OpenClaw has:** A formal plugin SDK (`registerTool`, `registerHook`, `registerChannel`, etc.) with manifest-based discovery, config validation without code execution, and exclusive "slots" (only one memory plugin at a time). Skills are separate — they're just markdown files that teach the agent how to use tools, discovered from `skills/` directories with OS/binary/env filtering.

**What Callback has:** Connectors (hardcoded sync interfaces), schemas (card type definitions), and `.claude/rules/` (conditional context injection). No formal plugin or skill system.

### Ideas

| Idea | Effort | Value |
|------|--------|-------|
| **Skills as markdown** — `config/skills/*.md` files that get injected into agent context based on what's relevant (filtered by available tools, installed binaries, etc.) | Low | High |
| **Skill discovery filtering** — `requires: { bins: ["gh"] }` in frontmatter so GitHub skills only load when `gh` is installed | Low | Medium |
| **User-invocable skills** — skills that can be triggered by name (like `/github`), not just passively included | Medium | Medium |
| **Hook system for agent lifecycle** — `before_agent_start`, `after_tool_call`, `agent_end` hooks that run custom logic | High | Medium |

**Key insight:** The `.claude/rules/` system already does conditional context injection. Skills are essentially the same thing but with better filtering (binary detection, env vars) and explicit invocability. We could extend rules to support this.

---

## 3. Session Management & Continuity — High Priority

**What OpenClaw has:** Per-agent session stores with JSONL transcripts, automatic daily reset, idle timeout reset, compaction (summarize old turns to free context), and session maintenance (prune stale sessions, cap disk usage, archive old transcripts).

**What Callback has:** Each agent invocation is a fresh Claude Code session. No continuity between reactor cycles. Session IDs exist for resume-on-uncommitted-work, but there's no conversation history.

### Ideas

| Idea | Effort | Value |
|------|--------|-------|
| **Session transcripts** — save agent conversation logs to `.callback-box/sessions/<id>.jsonl` for debugging and memory | Medium | High |
| **Session summaries** — when a reactor cycle completes, generate a 1-paragraph summary of what happened, saved to `memory/` | Low | High |
| **Compaction-aware context** — inject summaries of recent sessions into agent context so agents know what happened recently | Low | High |
| **Session reset policies** — daily reset, idle timeout, max entries — to manage disk usage | Low | Low |

**Key insight:** The reactor already runs agents, but each run is amnesic. Even just saving "here's what the agent did last time" as a text file injected into next run's context would be a big improvement.

---

## 4. Automation: Webhooks & Push Triggers — Medium Priority

**What OpenClaw has:** HTTP webhook endpoints (`/hooks/wake`, `/hooks/agent`) that trigger agent runs from external services. Gmail Pub/Sub integration for push-based email. Cron jobs can deliver results to channels or external webhooks.

**What Callback has:** Pull-based connectors (RSS, Gmail IMAP) that only run during `cb wakeup`. Scheduled scripts with cron/at/rrule. No push triggers.

### Ideas

| Idea | Effort | Value |
|------|--------|-------|
| **Webhook endpoint** — `POST /api/webhook` that creates a job card from an HTTP request, triggering the reactor | Medium | High |
| **Gmail push notifications** — switch from IMAP poll to Pub/Sub push for near-instant email processing | High | Medium |
| **Webhook delivery** — when a job completes, optionally POST results to an external URL | Medium | Medium |
| **Webhook payload transforms** — configurable templates that convert incoming payloads into job cards | Medium | Low |

**Key insight:** The webapp already has Fastify routes. Adding a webhook endpoint that creates a job card is straightforward and fits the existing architecture perfectly.

---

## 5. Sub-Agents & Parallel Work — Medium Priority

**What OpenClaw has:** `sessions_spawn` tool lets the main agent spin up background sub-agents with their own sessions. Configurable depth limits (max 2 levels), concurrency caps, model overrides, and announce-back chains. Sub-agents can be orchestrators that spawn their own sub-agents.

**What Callback has:** One agent per reactor cycle processes all jobs sequentially. Procedures can invoke agents per-step, but no parallel execution.

### Ideas

| Idea | Effort | Value |
|------|--------|-------|
| **Parallel job processing** — reactor processes independent jobs concurrently (not one agent for all jobs) | High | High |
| **Job-level model selection** — job cards specify which model to use (haiku for simple, opus for complex) | Low | Medium |
| **Agent timeout** — configurable timeout per job type to prevent runaway agents | Low | Medium |
| **Announce-back pattern** — sub-agent results summarized and posted back to a parent context | Medium | Low |

**Key insight:** The reactor currently batches all jobs into one agent prompt. For independent jobs, running them in parallel would be a significant speed improvement. The procedure engine already supports per-step model selection — extending this to jobs is natural.

---

## 6. Security Model — Low Priority (but notable)

**What OpenClaw has:** Five-layer trust boundaries, formal threat model (MITRE ATLAS), exec tool with graduated security (sandbox -> allowlist -> full), tool elevation with per-channel approval, SSRF protection for browser automation.

**What Callback has:** Agents run as the user with full filesystem access. No sandboxing, no tool restrictions, no approval workflows.

### Ideas

| Idea | Effort | Value |
|------|--------|-------|
| **Threat model document** — even informal, document what agents can/can't do and what the trust boundaries are | Low | Medium |
| **External content wrapping** — mark content from external sources (RSS, email) so agents know it's untrusted | Low | Medium |
| **Agent capability restrictions** — per-job limits on what an agent can do (e.g., "read-only" jobs) | High | Low |

**Key insight:** Callback's security model is "trust the agent, audit via git." This is fine for a single-user system, but external content (RSS feeds, emails) could contain prompt injection. Wrapping external content with safety markers is cheap insurance.

---

## 7. Browser & Canvas — Low Priority

**What OpenClaw has:** Playwright-based browser automation with CDP, multi-profile support, SSRF protection. Canvas system for rendering live HTML workspaces.

**What Callback has:** Nothing browser-related. The web frontend is display-only.

Not worth stealing right now — these are solutions for a different problem (multi-channel chat assistant). But worth noting:

| Idea | Effort | Value |
|------|--------|-------|
| **Canvas-style card preview** — render card XML as rich HTML in the web UI | Medium | Medium |
| **Browser automation connector** — agent can interact with web services via Playwright | High | Low |

---

## 8. Gateway Architecture — Not Applicable

OpenClaw's gateway is a WebSocket multiplexer for multi-device, multi-channel coordination. Callback doesn't need this — it has a single Fastify server with SSE. The gateway pattern is overengineered for our use case.

---

## Top 10 Actionable Ideas (Prioritized)

1. **Daily memory logs** + bootstrap injection — agents write `memory/YYYY-MM-DD.md`, loaded into next session
2. **Session summaries** — auto-generate "what happened" after each reactor cycle
3. **Memory search tool** — `cb memory search <query>` for agents to retrieve past context
4. **Webhook endpoint** — `POST /api/webhook` creates job cards for push-based triggers
5. **Skills as markdown** — extend `.claude/rules/` with binary/env filtering and invocability
6. **Parallel job processing** — reactor runs independent jobs concurrently
7. **External content safety wrapping** — mark RSS/email content as untrusted in agent prompts
8. **Job-level model selection** — job cards specify model (haiku/sonnet/opus)
9. **Session transcripts** — save agent logs for debugging
10. **Memory flush** — silent turn before context loss to persist important information

---

## OpenClaw Reference

- Repository: `~/src/openclaw/`
- Key docs: `docs/concepts/`, `docs/tools/plugin.md`, `docs/automation/`, `docs/security/THREAT-MODEL-ATLAS.md`
- Memory system: `src/memory/`, `extensions/memory-core/`
- Plugin SDK: `src/plugins/`, `src/plugin-sdk/`
- Agent runtime: `src/agents/pi-embedded-runner/`
- Gateway: `src/gateway/`

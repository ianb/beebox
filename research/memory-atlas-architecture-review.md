# Architecture Review: Memory Atlas vs Bee Box

_February 2026_

## The Big Picture

Memory Atlas is a **conversational AI assistant** with persistent memory — a Next.js web app where users chat with an AI that remembers them across sessions, organizes knowledge, and manages structured activities (todos, journals, recipes, catalogs). Bee Box is a **file-based personal automation system** — git-backed cards, CLI-driven agents, and a reactor loop.

Memory Atlas is the spiritual predecessor — many ideas in Bee Box originated there. This review focuses on what Memory Atlas does well that Bee Box hasn't yet absorbed, and patterns worth revisiting now that Bee Box's architecture has matured.

---

## 1. Knowledge Extraction & Compression — High Priority

**What Memory Atlas has:** A two-phase knowledge pipeline:

1. **Extraction**: After conversations age 2+ hours, an LLM analyzes them and extracts structured "knowledge units" — facts, preferences, habits, biographical info, relationship details. Each unit has a type (`/user/family`, `/person`, `/memory`), a title, content, a `whenUseful` field (natural language description of relevance), and links back to source messages.

2. **Compression**: A separate pipeline runs iteratively over extracted knowledge, using an LLM to categorize new units against existing ones. It identifies duplicates, merges related units, supersedes outdated facts, and marks common-sense items for disposal. The merge preserves all specific information from both units.

**Storage**: PostgreSQL with pgvector. Three embedding variants per unit (title+content, title+content+details, title+whenUseful). Hybrid retrieval: 70% vector similarity + 30% BM25 keyword search, with optional temporal decay and MMR diversity re-ranking.

**What Bee Box has:** No knowledge extraction. Agents process cards and commit results, but don't learn from what they process. No persistent memory between agent sessions.

### Ideas

| Idea | Effort | Value |
|------|--------|-------|
| **Knowledge extraction from agent sessions** — after a reactor cycle, extract key facts/decisions into `memory/` files | Medium | High |
| **`whenUseful` metadata** — each memory entry annotated with when it's relevant, enabling smarter context injection | Low | High |
| **Compression/deduplication pipeline** — periodic procedure that consolidates memory files, merges duplicates | Medium | Medium |
| **Category-balanced retrieval** — when injecting memory into context, balance across categories (don't let one topic dominate) | Medium | Medium |
| **Knowledge unit types** — structured categories for memories: people, preferences, project context, facts | Low | Medium |

**Key insight:** Memory Atlas extracts knowledge *from* conversations. Bee Box could extract knowledge *from* agent sessions — what did the agent learn while processing news? What patterns emerged from email triage? What decisions were made about card organization? This is different from OpenClaw's memory (which is agent-maintained markdown) — it's automated extraction.

---

## 2. Activity/Plugin Architecture — Medium Priority

**What Memory Atlas has:** A well-structured plugin pattern where each "activity" (todo, journal, catalog, retrospect, etc.) is a self-contained module with:
- **Types** — data structures
- **Tools** — LLM-callable functions specific to this activity
- **Prompt slots** — context injected into the system prompt
- **Knowledge criteria** — what knowledge is relevant for this activity
- **Server logic** — data access and mutations
- **Renderer** — React component for display

Activities register in a global registry and are instantiated dynamically. The LLM can switch between activities mid-conversation, moving messages to the new activity's context.

**What Bee Box has:** Card schemas (similar to activity types) with embedded instructions, but no formal tool registration, no prompt slot system, and no dynamic activity switching.

### Ideas

| Idea | Effort | Value |
|------|--------|-------|
| **Schema-specific tools** — card types register CLI commands/tools that agents can use when working with that type | Medium | High |
| **Knowledge criteria per card type** — each schema defines what memory/context is relevant when processing it | Low | Medium |
| **Dynamic context injection** — instead of loading all docs, load docs relevant to the card types currently being processed | Medium | Medium |
| **Prompt slot system** — structured way for schemas to contribute sections to the agent's system prompt | Medium | Medium |

**Key insight:** Memory Atlas's activity system is essentially "card types that know how to present themselves to the LLM." Bee Box's schemas already have `instructions` embedded in them, but they don't have tools, knowledge criteria, or prompt slots. The schema could be the natural place to register all of these.

---

## 3. Daily Processing & Journaling — Medium Priority

**What Memory Atlas has:** A timezone-aware daily processing pipeline:
- Hourly cron checks which users are in their 3am-4am window
- For each user, processes yesterday's conversations through two parallel pipelines:
  - **Journal**: LLM extracts meaningful quotes, writes first-person journal entry, generates title and summary
  - **Questions**: Identifies follow-up topics, generates prompts and provocations for future conversations
- Journal entries become searchable knowledge units

**What Bee Box has:** Scheduled scripts (cron/at/rrule) and the reactor loop. No automated journaling or daily summary generation. The news pipeline processes RSS items into briefs, but there's no equivalent for summarizing the system's own activity.

### Ideas

| Idea | Effort | Value |
|------|--------|-------|
| **Daily activity digest** — scheduled procedure that summarizes what happened yesterday (jobs processed, cards created, questions answered) | Medium | High |
| **Auto-generated questions** — after processing a batch of items, generate follow-up questions as question cards | Medium | Medium |
| **Conversation-to-journal** — when chat sessions end, optionally create a memo card summarizing the discussion | Low | Medium |
| **Timezone-aware scheduling** — scheduled scripts should respect the user's timezone, not just UTC cron | Low | Low |

**Key insight:** Memory Atlas turns raw conversations into curated artifacts (journals, questions). Bee Box could do the same with its reactor cycles — turn a day's worth of agent work into a readable summary card.

---

## 4. Tool-Calling Chat System — High Priority

**What Memory Atlas has:** A sophisticated tool-calling architecture:
- **Tool class** with Zod schemas, context binding, and dynamic parameter rewriting based on conversation state
- **ToolSet** aggregation — collects tools from the active activity, personality, and related activities
- **Activity switching via tools** — tools can return `activateActivityIds` to switch context mid-conversation, moving messages to the new activity
- **Structured tool results** — tools return typed `structured` data alongside text content, enabling rich UI rendering

**What Bee Box has:** The chat page has a basic LLM chat, but it doesn't have tool calling. Agents (Claude Code) have full tool access, but the web chat assistant doesn't.

### Ideas

| Idea | Effort | Value |
|------|--------|-------|
| **Chat assistant with tools** — give the web chat LLM access to `bbx` commands as tools (status, create, answer, move, trash) | High | High |
| **Job dispatch from chat** — chat assistant creates job cards instead of doing work synchronously (already noted as planned feature) | Medium | High |
| **Dynamic tool sets** — tools available to the chat assistant vary based on what's being discussed (questions page → answer tools, browse → move/trash tools) | Medium | Medium |
| **Structured responses** — tool results rendered as rich UI (card previews, status summaries) instead of plain text | Medium | Medium |

**Key insight:** This connects to the planned "chat assistant as job dispatcher" feature in MEMORY.md. Memory Atlas's tool architecture shows how to structure this — tools as typed objects with Zod schemas, registered per-context, with results that drive both LLM continuation and UI rendering.

---

## 5. Streaming & Real-Time Communication — Low Priority (already good)

**What Memory Atlas has:** Async generator-based streaming for both LLM responses and server functions. SSE proxy pattern where client calls server functions as if local, with the proxy transparently routing via HTTP/SSE.

**What Bee Box has:** SSE for file change notifications, Fastify API routes, and the chat page has basic streaming.

### Ideas

| Idea | Effort | Value |
|------|--------|-------|
| **Typed RPC proxy** — memory-atlas's `createFuncsProxy` pattern is cleaner than manual fetch calls for API routes | Medium | Low |
| **Async generator streaming** — for long-running operations (reactor progress, procedure execution), stream status updates as async generators | Medium | Medium |

**Key insight:** The proxy pattern is elegant but may be over-engineering for Bee Box's simpler API surface. Worth noting but not urgent.

---

## 6. Retrospect & Self-Reflection — Medium Priority

**What Memory Atlas has:** A "retrospect" activity that analyzes conversations against user-defined criteria:
- Defines observation criteria (e.g., "user expressed frustration", "user changed their mind")
- LLM evaluates messages against criteria with confidence scores
- Creates structured observations linking back to source messages
- Enables meta-analysis: "what patterns appear in my conversations?"

**What Bee Box has:** Nothing equivalent. Agents process work but don't reflect on patterns or quality.

### Ideas

| Idea | Effort | Value |
|------|--------|-------|
| **Agent performance retrospect** — periodic analysis of agent sessions: what went well, what failed, what took too long | Medium | High |
| **Pattern detection across reactor cycles** — identify recurring issues (same card types failing, same connectors erroring) | Medium | Medium |
| **Quality criteria for card processing** — define what "good" news brief generation looks like, evaluate against it | Medium | Medium |

**Key insight:** Retrospect is essentially automated quality review. Bee Box could use this to improve agent performance over time — "the last 5 news briefs were too long" or "the agent keeps creating duplicate cards."

---

## 7. Background Job Architecture — Low Priority (different approach)

**What Memory Atlas has:** Inngest for reliable distributed background jobs with:
- Idempotency keys preventing duplicate processing
- Fan-out pattern (parent → child tasks)
- Iterative processing with self-rescheduling
- Failure tracking and retry logic

**What Bee Box has:** The reactor loop (glob jobs → process → loop), scheduled scripts, and the scheduler daemon.

### Ideas

| Idea | Effort | Value |
|------|--------|-------|
| **Idempotency for jobs** — prevent duplicate job processing if reactor crashes and restarts | Low | Medium |
| **Fan-out job pattern** — one job creates multiple child jobs (already somewhat supported via reactor looping) | Low | Low |

**Key insight:** Bee Box's reactor loop is actually a simpler and more appropriate architecture for its use case. Inngest solves distributed reliability problems that don't apply to a single-machine, git-backed system. The reactor's "glob + process + loop" is elegant.

---

## 8. Voice & Audio Pipeline — Low Priority (already shared)

**What Memory Atlas has:** Deepgram live transcription, OpenAI TTS, iOS audio unlock pattern, earcon system, wake lock during recording.

**What Bee Box has:** Whisper transcription (via Electron), TTS speech output, iOS audio unlock (adopted from memory-atlas), earcon system.

### Ideas

| Idea | Effort | Value |
|------|--------|-------|
| **Keyword/phrase detection in speech** — memory-atlas detects "hold microphone", "send message", "cancel" in speech stream | Low | Medium |
| **Memo recording** — record audio memos and transcribe them as card content | Medium | Medium |

**Key insight:** Most of the audio patterns have already been ported. The keyword detection could be useful for hands-free control of the Thinking Machine interface.

---

## 9. Signals-Based State Management — Low Priority

**What Memory Atlas has:** Preact Signals for fine-grained reactive state. Persistent signals backed by localStorage. SignalView for nested property access.

**What Bee Box has:** Standard React state (useState, useEffect).

### Ideas

| Idea | Effort | Value |
|------|--------|-------|
| **Signals for SSE-driven state** — SSE events updating signals instead of triggering full re-renders | Medium | Low |

**Key insight:** Not a priority. React's state management is fine for Bee Box's current UI complexity.

---

## 10. `whenUseful` and Contextual Relevance — High Priority

This deserves its own section because it's a simple but powerful pattern.

**What Memory Atlas has:** Every knowledge unit has a `whenUseful` field — a natural language description of when this knowledge should be surfaced. Examples:
- "When the user mentions their partner by name"
- "When planning weekend activities"
- "When the user seems stressed about work"

This field is embedded separately (title+whenUseful embedding) and searched against, meaning the system can match "the user seems frustrated with their inbox" to a memory about "when the user feels overwhelmed by email."

**What Bee Box has:** Cards have types and locations, but no "when is this relevant?" metadata.

### Ideas

| Idea | Effort | Value |
|------|--------|-------|
| **Relevance annotations on guides** — guide cards get a `whenUseful` field so agents know when to apply them | Low | High |
| **Contextual card surfacing** — when processing a job, surface related archived cards based on relevance, not just type | Medium | High |
| **Memory with relevance context** — memory entries include when they should be injected into agent context | Low | High |

---

## Top 10 Actionable Ideas (Prioritized)

1. **Knowledge extraction from agent sessions** — extract facts/decisions into memory files after reactor cycles
2. **Chat assistant with `bbx` tools** — give the web chat access to CLI commands as callable tools
3. **`whenUseful` relevance annotations** — natural language descriptions of when knowledge/guides should be surfaced
4. **Daily activity digest** — scheduled summary of what the system did yesterday
5. **Agent performance retrospect** — periodic quality analysis of agent sessions
6. **Schema-specific tools** — card types register tools agents can use when processing them
7. **Knowledge compression pipeline** — periodic deduplication and consolidation of memory entries
8. **Job dispatch from chat** — chat creates jobs instead of working synchronously
9. **Auto-generated follow-up questions** — after processing, create question cards for user review
10. **Conversation-to-memo** — save chat sessions as memo cards for the archive

---

## Comparison with OpenClaw Review

The two reviews complement each other:

| Concern | OpenClaw Insight | Memory Atlas Insight |
|---------|-----------------|---------------------|
| **Memory** | Markdown files + vector index, agent-maintained | Automated extraction from conversations, LLM-driven compression |
| **Extensibility** | Formal plugin SDK with hooks | Activity plugin pattern with tools, prompts, knowledge criteria |
| **Automation** | Webhooks, push triggers | Daily processing pipeline, timezone-aware scheduling |
| **Chat** | Multi-channel routing | Tool-calling with activity switching, structured responses |
| **Quality** | Security/threat model | Retrospect system, observation criteria |
| **Sessions** | JSONL transcripts, compaction | Conversation ownership, message movement between activities |

**OpenClaw** is better for: infrastructure patterns (webhooks, gateway, security, multi-agent routing)
**Memory Atlas** is better for: intelligence patterns (knowledge extraction, contextual relevance, quality reflection, tool-calling chat)

---

## Memory Atlas Reference

- Repository: `~/src/memory-atlas/`
- Key docs: `docs/CODE_LAYOUT.md`, `docs/refactor-plan.md`, `docs/ideal-mem-categories.md`
- Knowledge system: `lib/knowledge/` (extract.ts, compress.ts, retrieval.ts, types.ts)
- Activity system: `lib/activities/` (serveractivityclass.ts, allactivitytypes.ts)
- Chat system: `lib/chat/runllm.ts`, `lib/llm/toolclass.ts`
- Daily processing: `lib/daily/` (task.ts, journalprompt.ts, questionprompt.ts)
- Background jobs: `lib/inngest/`

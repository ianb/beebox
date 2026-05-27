# Testing Gaps — Working Document

Current status as of 2026-03-03: **931 tests across 53 files**. Route coverage: 46/52 endpoints (88%).

## Current Coverage Summary

### Doctests (53 files)

**Core modules:** box.ts, schemas, calendar-utils, intake-utils, chat-response-extraction, scheduled-script.ts, schedule-state.ts, chat-session.ts (state/persistence only), session.ts (log parsing), procedure engine (shell + agent DI), reactor (unit + integration with fake agents), scheduler utilities

**CLI utilities:** format.ts, git.ts, time.ts

**Frontend pure functions:** parseTags, patmatch, speech-parsing, speech-keywords

**Routes (46/52 endpoints):** scheduler (5/5), api (12/12), briefs (7/7), admin (8/8), commands (5/5), history (3/3), actions (2/4), calendar (3/3)

**Connectors:** Telegram (polling, webhook, outbound), RSS (pull, dedup, Atom, errors)

**Wakeup helpers:** createIntakeJobsForUnjobbed, createGuideRevisionJobIfNeeded

**Service fakes:** Telegram, Claude CLI, Google Calendar, OpenAI Audio, IMAP, Feed Fetcher, Article Fetcher, call-log — all with domain-specific fakes + `withCallLog()` wrapper

**Agent testing:** `Agent` interface with `createAgent`/`createFakeAgent`, used by the reactor and the procedure engine

### Traditional tests (2 files)

- `check.test.ts` / `doctest.test.ts` — Meta-tests for test infrastructure (circular dependency prevents doctests)

## Remaining Gaps

### Route endpoints not yet tested (6 endpoints)

| Route | Endpoints | Blocker |
|---|---|---|
| `chat.ts` | 0/8 | SSE streaming (send), WebSocket (transcribe-ws). Session state and log parsing are tested separately. |
| `sse.ts` | 0/1 | SSE stream testing approach needed |
| `auth.ts` | 0/4 | Route uses `new OAuth2Client()` + `process.env` directly. Service fake exists but route not wired for injection. |
| `actions.ts` | 2 remaining | Wakeup route (thin wiring to connector-sync), voice-memo (multipart upload, deprioritized) |

### Chat subprocess pipeline

`ChatSession.send()`, `interrupt()`, event streaming — all depend on spawning a real Claude subprocess. State management, session ID persistence, and history retrieval are tested. To test the pipeline: either mock the subprocess or build a testable abstraction layer.

`chat-session-pool.ts` (pool rotation) and `chat-thread-session.ts` (thread file operations) are untested.

### Frontend components

~15 page components coupling data fetching with rendering. Needs architecture shift to unidirectional data flow (store → props → render) before component testing is practical. Pure utility functions are already covered.

### Wakeup orchestration

`runPreprocessors()` needs OpenAI service injection for transcription. The orchestration itself is linear — low value as a unit test. Individual phases (intake-jobs, housekeeping, on-wakeup scripts) are tested.

### Not worth testing

- **CLI commands** (~35 files) — Thin glue. Test the pieces they call.
- **Agent invocation internals** — `runAgent()` is private; all consumers use injected `Agent` interface.
- **OAuth** — Standard flow.
- **Scheduler daemon loop** — Infinite loop with signal handlers. Utility functions tested; the pieces it calls (schedule evaluation, state) are well tested.

## Design Approach

### Dependency injection

Inject at the service/function level, not HTTP-level. Service objects passed to route registration, replaced with fakes in tests. No mock libraries — injectability built into the code.

### Doctest infrastructure

- `makeTestServer()` — Fastify `inject()`, no network
- `makeTmpBox()` — Temp directory with optional git init
- `createFakeAgent()` — Records invocations, configurable responses
- `print()` — Accumulates lines for multi-line assertions
- TypeScript support via esbuild transform in loader
- Wildcards: `«string»`, `«number»`, `«codeblock»`, `«blankline»`, extractions

## Future Ideas

These are design directions discussed but not yet implemented:

- **CGI-style route testing** — Routes as pure functions: state-in → render → check. Requires separating logic from Fastify wiring.
- **Self-describing services** — Services export metadata (description, examples, properties) for test/doc generation.
- **Property testing** — Semantically meaningful invariants via fast-check (e.g., `parse(serialize(x)) === x`).
- **Time as a service** — Replace `getBoxTimeISO()` free function (called from 40+ files) with injectable `TimeService`. Current env-var stub works for scenarios.
- **Assertive logging** — Soft assertions in production surfaced through logging; test harness catches unexpected errors.
- **Source document tracing** — `data-source` attributes in rendered output for data provenance.

## Decisions Log

- **2026-03-02:** Route test pattern established: Fastify `inject()` + `createTestServer()` helper.
- **2026-03-03:** Doctest system built and adopted as primary test format. Converted all existing tests except meta-tests (circular dependency). Added `cleanup` blocks, `print()`, TypeScript support, guillemet wildcards.
- **2026-03-03:** Service layer created (`src/services/`) with typed interfaces, real implementations, and domain-specific fakes. `withCallLog()` wrapper for test assertions. Services threaded through server → route registration → test helpers.
- **2026-03-03:** Agent interface (`createAgent`/`createFakeAgent`) adopted across all agent consumers. `runAgent()` made private. Procedure engine and reactor both accept `createAgent` factory overrides.
- **2026-03-03:** Reactor restructured from single 680-line file into `src/core/reactor/` directory (9 source files + DESIGN.md + CLAUDE.md).
- **2026-03-03:** Coverage milestone: 931 tests across 53 files. 46/52 route endpoints (88%). All connectors (Telegram, RSS) tested with service fakes.

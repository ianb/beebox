# Testing Gaps — Working Document

Tracking areas where test coverage is missing or thin, and plans for addressing each. Also captures the broader testing vision from design discussions.

## Module Assessment

Assessment of where each area of the codebase stands for testing, and what approach fits.

### Already covered by doctests

These modules have been converted from traditional tests or newly written as doctests:

- `src/core/box.ts` — `initBox()`, directory structure, `isValidBox()`, `findBoxRoot()`, metadata
- `src/schemas/*.ts` — Schema registry, all card template generators (memo, question, news-job, intake-job, calendar-review-job)
- `src/connectors/calendar-utils.ts` — ICS parsing, event formatting, timespan parsing, date filtering
- `src/connectors/intake-utils.ts` — `createOrAppendIntakeJob()` create, append, multi-source
- `src/core/chat-response-extraction` logic — Streaming `<chat-response>` tag extraction
- `src/core/scheduled-script.ts` — `isDue()`, `isDueForWakeup()`, `isWithinBudget()`, templates
- `src/core/schedule-state.ts` — `pruneRecentRuns()`, `recordRun()`
- `src/cli/lib/format.ts` — `stripAnsi()`
- `src/frontend/src/lib/parseTags.ts` — XML-like tag parsing
- `src/frontend/src/lib/patmatch.ts` — Keyword pattern matching
- `src/frontend/src/lib/speech-parsing.ts` — Speech tag extraction for TTS
- `src/frontend/src/lib/speech-keywords.ts` — Voice command keyword detection
- `src/cli/lib/git.ts` — Git command helpers (init, commit, log, diff, status, branches, tags, etc.)
- `src/cli/lib/time.ts` — Stubbable time utilities (CB_TIME env, stubs.yaml, caching)
- **Route tests** — scheduler, admin, core API, briefs, commands, history, actions, calendar
- `src/core/procedure/engine.ts` — Full execution lifecycle: shell steps, precheck skip/fail, validation severity, dry run, step filtering, agent mock (via DI), fallback commits, error cases
- **Service fakes** — Telegram, Claude CLI, Google Calendar, Raindrop, OpenAI Audio, Dropbox Relay, IMAP, Feed Fetcher, call-log
- **Connector tests** — Telegram (polling, webhook processing, outbound send), Raindrop (pull, push, two-way sync), RSS (pull, dedup, Atom, error handling)
- **Wakeup helpers** — `createIntakeJobsForUnjobbed()` (unjobbed detection, dedup, priority separation, excluded subdirs), `createGuideRevisionJobIfNeeded()` (feedback detection, dedup, guide path inclusion)

### Covered by traditional tests

- `test/check.test.ts` / `test/doctest.test.ts` — Meta-tests for the test infrastructure. These must stay as traditional tests (circular dependency — doctests use `check()` and the doctest parser).

### Ready for doctests now (pure logic, no dependencies)

*(None remaining)*

### Ready for doctests with existing helpers

These can use `makeTestServer()` or `makeTmpBox()` from the existing doctest helpers:

- **Route: `actions.ts`** remaining — Wakeup route (delegates to `connector-sync` command), voice-memo (multipart upload). The wakeup route itself is thin wiring; the heavy logic is in `cb wakeup` CLI phases, of which intake-jobs and guide-revision are now tested.
- **Wakeup orchestration** — `runPreprocessors()` needs loader/preaction system (which calls OpenAI for transcription). `runTriageFeedback()` needs agent injection. Neither is testable without service work. The orchestration itself is linear (run phases A through H in order) — not high-value to test as a unit.
- **Route: `auth.ts`** — Needs `GoogleAuthService` injection into the route (currently uses `new OAuth2Client()` and `process.env` directly). Service fake exists but route not yet wired.

### Need new helpers or design work

- **Procedure engine** (`src/core/procedure/engine.ts`) — DONE. Shell steps, precheck, validation, and agent mocking all covered. Agent runner injected via `options.runAgent` parameter. See `test/procedure-engine.doctest.md`.
- **Scheduler** (`src/core/scheduler.ts`) — Orchestrates connectors, wakeup, and tick. Important to test but needs design discussion about what to inject and at what level. The individual pieces it calls are already tested; the scheduler's value is in the orchestration logic.
- **WebSocket/SSE routes** — Would benefit from abstractions that let us test the underlying logic without actual WebSocket connections. Don't jump into this yet; needs design discussion about what the testable abstraction looks like.
- **Admin routes** — DONE. All 8/8 endpoints tested via service fakes (Telegram + Claude Code).
- **Connectors** — Service fakes exist for Telegram, Raindrop, and RSS (FeedFetcher). All three have connector-level sync tests using `makeTmpBox({ git: true })` with injected fakes. Dropbox/capture connectors are being removed (see below).

### Being removed / deprioritized

- **Dropbox relay** (`src/connectors/dropbox.ts`, `src/connectors/capture.ts`, `src/webapp/routes/pairing.ts`) — Dropbox relay is being removed in favor of XState-based architecture. No point writing tests for code that's going away.
- **Voice memo** (`actions.ts` voice-memo endpoint) — Low priority, deprioritized alongside Dropbox removal.

### Needs exploration — not ready yet

- **Chat sessions** (`chat-session.ts`, `chat-session-pool.ts`, `chat-thread-session.ts`) — Long-lived subprocess management. The testable parts (pool rotation, session persistence, thread file operations) should be separated from the Claude-dependent parts. Worth exploring what abstractions make this testable.
- **Frontend component testing** — A whole separate discussion. Needs architecture changes (unidirectional data flow) before component testing is practical. See §2 below.

### Fine without tests

- **CLI commands** (`src/cli/commands/*.ts`, ~35 files) — Thin glue code. Keep commands small so we're testing the pieces they call, not the commands themselves.
- **Agent invocation** (`src/core/agent.ts`) — `Agent` interface, `createAgent()`, `createFakeAgent()` now exist. `triage-feedback` wired as first consumer. Remaining commands (`process-news`, `process-feedback`, `reactor`) still use raw `runAgent()` and can be migrated to the Agent interface for testability.
- **OAuth** (`src/connectors/google-auth.ts`) — Standard OAuth flow, simpler without tests.

### Dependency injection approach

Prefer injecting at the service/function level over HTTP-level interception:

- Pass API clients or fetch functions as parameters
- Route handlers receive service objects that can be replaced in tests
- HTTP-level stubs are appropriate when the HTTP interface *is* the thing being tested (e.g., RSS feed parsing)
- No mock libraries — injectability should be built into the code

## 1. API Route Tests

**Status:** In progress — 46 of 52 endpoints tested (88%)
**Priority:** High — deterministic, fast, covers fragile code

Route tests are now doctests (`test/routes-*.doctest.md`) using `makeTestServer()` from `test/helpers/doctest-server.ts`. Under the hood this uses Fastify's `inject()` — no socket server, no network. The helper provides `.inject()` (returns `"status\njson"` for `check()`) and `.request()` (returns `{ statusCode, body }` for programmatic access).

**Direction:** Long-term goal is CGI-style testing — state-in → render → check output — without even Fastify. This would mean refactoring route handlers to separate pure logic from Fastify wiring. Current approach works well enough for now.

**Current coverage:**

| Route file | Tested | Total | Notes |
|---|---|---|---|
| `scheduler.ts` | 5/5 | 100% | Complete |
| `api.ts` | 12/12 | 100% | Complete |
| `briefs.ts` | 7/7 | 100% | Complete (legacy `/api/edition` endpoints removed) |
| `admin.ts` | 8/8 | 100% | Complete (Telegram + Claude Code via service fakes) |
| `commands.ts` | 5/5 | 100% | Complete (streaming execute tested via `executeCommandStreaming()` abstraction) |
| `history.ts` | 3/3 | 100% | Complete |
| `actions.ts` | 2/4 | 50% | Answer, create; wakeup/voice-memo need integration work |
| `chat.ts` | 0/8 | 0% | Needs Claude session injection |
| `sse.ts` | 0/1 | 0% | Needs SSE stream testing approach |
| `calendar.ts` | 3/3 | 100% | Complete (Google Calendar via service fake) |
| `pairing.ts` | — | — | Being removed (Dropbox relay → XState migration) |
| `auth.ts` | 0/4 | 0% | Route not yet wired for service injection |

**Approach for external dependencies:** Built-in dependency injection (not mock libraries). Service objects passed to route registration, replaced with test implementations in tests. Prefer injecting at the service level; HTTP-level stubs only when the HTTP interface is the thing being tested.

## 2. Frontend Tests

**Status:** Pure utility functions covered; component testing needs architecture changes
**Priority:** Medium

The React frontend has ~15 page components and ~10 utility modules. Pure utility functions (`parseTags`, `patmatch`, `speech-parsing`, `speech-keywords`) are now tested as doctests — they import directly from `src/frontend/src/lib/` via tsx since they have no browser dependencies. Component testing is a separate challenge.

### Architecture direction: unidirectional data flow

Components currently couple data fetching with rendering (`useEffect → fetch → setState → render`). The goal is to separate these so the UI is a pure function of a state object:

- A store holds the full app state as a plain object
- Components receive data as props, emit actions
- An effect layer handles API calls and updates the store
- Testing = passing a state slice to a component, no mocking needed

This enables state snapshots, a state catalog for development, and agent-friendly debugging.

## 3. Chat Session Behavioral Tests

**Status:** Partially covered — extraction logic is doctest'd, pipeline is not
**Priority:** Medium

The `<chat-response>` extraction logic is well tested in doctests. What's not tested: the full pipeline from incoming message through session management to response delivery.

Testable without Claude: session pool rotation, session persistence, thread file operations, stream parsing, typing indicators. These could be doctests with appropriate helpers.

What requires Claude (or a substitute): whether the agent actually uses `<chat-response>` tags, acknowledges first, etc. Options: mock Claude subprocess for pipeline testing, periodic live validation for behavioral testing.

## 4. Broader Vision

Ideas from design discussions that haven't been implemented yet:

### Self-describing services

Services export metadata alongside their functions — description, examples, and semantic properties. Tests and documentation get generated from these:

```typescript
export const cardParser = {
  parse: (xml: string) => Card,
  description: "Parses XML card files into typed Card objects",
  examples: [
    { input: '<task status="open">Do thing</task>',
      output: { type: "task", status: "open", text: "Do thing" } },
  ],
  properties: [
    "parse(serialize(card)) deep-equals card",
    "parse always returns a Card with a non-empty type field",
  ],
};
```

### Property testing

Semantically meaningful invariants, not random fuzzing. Properties come from self-describing services:
- `parse(serialize(card))` deep-equals `card`
- Every card has a non-empty type field
- `isDue()` returns false for disabled scripts regardless of other parameters

Use fast-check for random input generation, but the properties themselves should be meaningful statements about the code's behavior.

### CGI-style route testing

Test routes as pure functions: state-in → render → extract available actions → state + action → new state. No server, no browser, no DOM. Walk through as a sequence of states and actions.

This requires refactoring route handlers to separate the pure logic from the Fastify wiring, but it's the right long-term direction.

### Time as a service

Currently `getBoxTime(boxRoot?)` / `getBoxTimeISO(boxRoot?)` are free functions stubbed via `CB_TIME` env var or `stubs.yaml`. This works for scenario testing but is implicit global state. A `TimeService` would make time injection explicit:

```typescript
interface TimeService {
  now(): Date;
  isoNow(): string;
}

// Fake with settable/advanceable clock
function createFakeTime(initial?: string): FakeTimeService {
  let current = new Date(initial ?? "2024-01-01T00:00:00Z");
  return {
    now: () => current,
    isoNow: () => current.toISOString(),
    set: (iso: string) => { current = new Date(iso); },
    advance: (ms: number) => { current = new Date(current.getTime() + ms); },
  };
}
```

The challenge is threading it through — `getBoxTimeISO()` is called from 40+ files as a free function. Options: (1) pass as parameter everywhere (invasive), (2) add to existing context objects (`CommandContext`, connector constructors), (3) keep env-var approach for production, add service as alternative injection for doctests. The env-var stub already works for scenarios; the service would mainly benefit doctests needing fine-grained time control (e.g., scheduling tests that advance time between steps). There are also ~70 direct `new Date()` calls — most legitimate (auth, perf timing, logging) but some card/job creation should arguably go through the stubbable clock.

### TypeScript in doctest code blocks — DONE

The doctest loader now pipes generated source through esbuild's `transformSync` (loader: "ts") before returning it to Node. This means `import type`, type annotations, and all TypeScript syntax work in both setup blocks and test code blocks.

### Assertive logging

Soft assertions in production code that surface through the logging system. In tests, an error harness catches unexpected logged errors and fails the test. This turns the logging system into a passive testing layer.

### Source document tracing

Rendered output includes markup (`data-source` attributes) indicating where each piece of data came from. Makes debugging easier and enables assertions about data provenance.

---

## Decisions Log

*(Record decisions about approaches as they're made)*

- **2026-03-02:** API route tests implemented using Fastify `inject()` + shared test helper. Pattern established: `createTestServer()` → `server.inject()` → assertions → `cleanup()`.
- **2026-03-03:** Doctest system built. Converted box, schemas, calendar-utils, chat-response-extraction, scheduled-script, schedule-state, format tests to doctests. Traditional tests kept for meta-testing (check, doctest), route integration, and filesystem-heavy reactor tests.
- **2026-03-03:** `___` wildcard syntax removed in favor of guillemet `«»` wildcards with typed matchers and extractions.
- **2026-03-03:** Added `cleanup` block type to doctests (uses `t.teardown()`). Converted all route tests, reactor/intake-utils tests, and schema registry tests from `.test.ts` to `.doctest.md`. Created shared helpers: `doctest-helpers.ts` (filesystem) and `doctest-server.ts` (Fastify inject). Only `check.test.ts` and `doctest.test.ts` remain as traditional tests (circular dependency).
- **2026-03-03:** Module assessment completed. Identified frontend pure functions, remaining route endpoints, and CLI time/git utils as next targets. Dependency injection preferred over HTTP stubs — inject at the service level, not the network level. Agent invocation isn't testable by automated means (success criteria require agent judgment). Chat sessions worth exploring but need abstraction work first. CLI commands should stay thin so we test their pieces, not the commands themselves.
- **2026-03-03:** Added 7 new doctest files: 4 frontend pure functions (parseTags, patmatch, speech-parsing, speech-keywords) and 3 route files (commands, history, actions). Frontend files import directly from `src/frontend/src/lib/` via tsx — works fine since they're pure TypeScript with no browser dependencies. Route coverage up to 55% (31/56 endpoints). Total: 471 tests across 25 files.
- **2026-03-03:** Added `print()` to doctests — scope-local function per test, accumulates lines that drain into the next `=>` assertion. Enables narrative/storytelling style tests. Also added `print.doctest.md` as a meta-test.
- **2026-03-03:** Procedure engine tested via doctests with agent DI. Added `options.runAgent` to `ProcedureOptions` for injecting a mock agent runner. 12 tests cover: shell execution, precheck skip/fail, validation warn/abort, dry run, step filtering, agent context verification (precheck pass-output, directive, model mapping), fallback commits. Total: 496 tests across 28 files.
- **2026-03-03:** Added git.ts doctests (14 tests covering all exported functions) and completed api.ts route coverage (added `/api/questions`, `/api/context`). api.ts now 12/12 (100%). Total: 530 tests across 30 files.
- **2026-03-03:** Removed 4 legacy `/api/edition/*` endpoints from briefs.ts (no frontend references). Added time.ts doctests (8 tests covering env var override, stubs.yaml, caching, cache clearing). briefs.ts now 7/7 (100%). Total: 540 tests across 31 files.
- **2026-03-03:** Service layer for external dependencies. Created `src/services/` with typed interfaces, real implementations, and domain-specific fakes for Telegram and Claude CLI. Generic `withCallLog()` wrapper records method calls on fakes for test assertions. `Services` container threaded through `server.ts` → route registration → test helpers. Admin routes now 8/8 (100%) — Telegram status/setup/disconnect and Claude Code status/login/logout all testable via fakes. Added `rootRequest()` to test server for root-level (non-box-prefixed) routes. Total: 580 tests across 33 files.
- **2026-03-03:** Remaining service definitions: Google Calendar, Raindrop, OpenAI Audio, Dropbox Relay, IMAP, Google Auth, Capture Relay. All with domain-specific fakes and doctests. Services threaded through calendar, pairing, and chat routes. Telegram and Raindrop connectors wired to accept injected services. Total: 627 tests across 36 files.
- **2026-03-03:** Calendar route tests (3/3 endpoints) and connector-level tests for Telegram and Raindrop. Connectors tested using `makeTmpBox({ git: true })` + service fakes, exercising full sync cycles (polling, webhook processing, outbound send, two-way bookmark sync). Dropbox relay deprioritized — being removed in favor of XState architecture.
- **2026-03-03:** RSS connector service injection + tests. Created `FeedFetcherService` with fake that returns canned XML. RSS connector wired to accept injected fetcher. 4 test sections: pull (RSS 2.0), deduplication, Atom feed support, fetch error handling. Extracted `executeCommandStreaming()` from the streaming execute route — testable abstraction that emits `OutputLine` messages via callback. commands.ts now 5/5 (100%). Total: 699 tests across 41 files.
- **2026-03-03:** Renamed `core/commands/wakeup.ts` → `connector-sync.ts` (command name `connector-sync`) to distinguish from the full `cb wakeup` CLI orchestrator. Exported and tested wakeup helper functions: `createIntakeJobsForUnjobbed()` (unjobbed detection, dedup via job refs, priority separation, excluded subdirs) and `createGuideRevisionJobIfNeeded()` (feedback detection, dedup, guide path). `runPreprocessors` and `runTriageFeedback` left untested — need service injection for loader/preactions and agent runner respectively. Total: 718 tests across 42 files.
- **2026-03-03:** Agent testing infrastructure. Created `Agent` interface (`src/core/agent.ts`) with `createAgent()` (real, spawns Claude Code) and `createFakeAgent()` (`test/helpers/fake-agent.ts`). Agent has name, sessionId, and `invoke()` — first call starts session with system prompt, subsequent calls resume. FakeAgent records all invocations and has `printLog()` for structured output. `ensureAgentCommitted()` updated to accept `Agent` (backward-compatible with legacy `agentOptions`/`agentResult`). Wired into `triage-feedback.ts` as first consumer via `args.agent`. Tests cover: prompt builder verification, happy path (agent commits), no-op (no cards), agent failure, retry-then-fallback (agent doesn't commit), retry-succeeds. Total: 755 tests across 43 files.

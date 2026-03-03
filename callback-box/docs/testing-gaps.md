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
- **Route tests** — scheduler, admin, core API, briefs, commands, history, actions

### Covered by traditional tests

- `test/check.test.ts` / `test/doctest.test.ts` — Meta-tests for the test infrastructure. These must stay as traditional tests (circular dependency — doctests use `check()` and the doctest parser).

### Ready for doctests now (pure logic, no dependencies)

These are pure functions that can be tested immediately with no helpers or mocking:

- **`src/cli/lib/time.ts`** — Time parsing/formatting utilities

### Ready for doctests with existing helpers

These can use `makeTestServer()` or `makeTmpBox()` from the existing doctest helpers:

- **Route: `api.ts`** remaining — `/api/questions`, `/api/context` endpoints
- **Route: `briefs.ts`** remaining — Legacy endpoints, `query-response`
- **Route: `commands.ts`** remaining — Streaming execute endpoint
- **Route: `actions.ts`** remaining — Wakeup (runs full cycle), voice-memo (multipart upload)
- **`src/cli/lib/git.ts`** — Git command helpers, testable with temp repos via `makeTmpBox({ git: true })`

### Need new helpers or design work

- **Connectors** (`src/connectors/rss.ts`, `raindrop.ts`, `google-calendar.ts`, `gmail.ts`, `capture.ts`) — Need dependency injection for HTTP calls. Preferred approach: inject at the service level (pass a fetch function or API client), not intercept at the HTTP level. Some cases (like RSS where you're testing "fetch this URL and parse the result") make sense to test at the HTTP level. Build helpers as needed.
- **Procedure engine** (`src/core/procedure/engine.ts`) — Step-parsing logic is doctest-able. The storytelling format — showing a procedure running step by step with prose explaining what's happening — is a natural fit. Statefulness between steps is the main challenge; `continue` blocks help.
- **Scheduler** (`src/core/scheduler.ts`) — Orchestrates connectors, wakeup, and tick. Important to test but needs design discussion about what to inject and at what level. The individual pieces it calls are already tested; the scheduler's value is in the orchestration logic.
- **WebSocket/SSE routes** — Would benefit from abstractions that let us test the underlying logic without actual WebSocket connections. Don't jump into this yet; needs design discussion about what the testable abstraction looks like.
- **Admin routes** remaining (`admin.ts`) — Telegram/Claude Code endpoints need service injection.

### Needs exploration — not ready yet

- **Chat sessions** (`chat-session.ts`, `chat-session-pool.ts`, `chat-thread-session.ts`) — Long-lived subprocess management. The testable parts (pool rotation, session persistence, thread file operations) should be separated from the Claude-dependent parts. Worth exploring what abstractions make this testable.
- **Frontend component testing** — A whole separate discussion. Needs architecture changes (unidirectional data flow) before component testing is practical. See §2 below.

### Fine without tests

- **CLI commands** (`src/cli/commands/*.ts`, ~35 files) — Thin glue code. Keep commands small so we're testing the pieces they call, not the commands themselves.
- **Agent invocation** (`src/core/agent.ts`) — The success criteria aren't objective — you'd need the agent itself to judge whether it worked. Not amenable to automated testing.
- **OAuth** (`src/connectors/google-auth.ts`) — Standard OAuth flow, simpler without tests.

### Dependency injection approach

Prefer injecting at the service/function level over HTTP-level interception:

- Pass API clients or fetch functions as parameters
- Route handlers receive service objects that can be replaced in tests
- HTTP-level stubs are appropriate when the HTTP interface *is* the thing being tested (e.g., RSS feed parsing)
- No mock libraries — injectability should be built into the code

## 1. API Route Tests

**Status:** In progress — 31 of 56 endpoints tested (55%)
**Priority:** High — deterministic, fast, covers fragile code

Route tests are now doctests (`test/routes-*.doctest.md`) using `makeTestServer()` from `test/helpers/doctest-server.ts`. Under the hood this uses Fastify's `inject()` — no socket server, no network. The helper provides `.inject()` (returns `"status\njson"` for `check()`) and `.request()` (returns `{ statusCode, body }` for programmatic access).

**Direction:** Long-term goal is CGI-style testing — state-in → render → check output — without even Fastify. This would mean refactoring route handlers to separate pure logic from Fastify wiring. Current approach works well enough for now.

**Current coverage:**

| Route file | Tested | Total | Notes |
|---|---|---|---|
| `scheduler.ts` | 5/5 | 100% | Complete |
| `api.ts` | 10/12 | 83% | Missing `/api/questions`, `/api/context` |
| `briefs.ts` | 7/11 | 64% | Missing legacy endpoints, `query-response` |
| `admin.ts` | 2/8 | 25% | Box-config only; Telegram/Claude Code endpoints need mocking |
| `commands.ts` | 3/5 | 60% | List, details, error cases; streaming execute not tested |
| `history.ts` | 3/3 | 100% | Complete |
| `actions.ts` | 2/4 | 50% | Answer, create; wakeup/voice-memo need integration work |
| `chat.ts` | 0/8 | 0% | Needs Claude session injection |
| `sse.ts` | 0/1 | 0% | Needs SSE stream testing approach |
| `pairing.ts` | 0/2 | 0% | External API (Dropbox relay) — needs service injection |
| `calendar.ts` | 0/3 | 0% | External API (Google Calendar) — needs service injection |
| `auth.ts` | 0/4 | 0% | External API (Google OAuth) — needs service injection |

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

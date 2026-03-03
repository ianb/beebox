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
- **Route tests** — scheduler, admin, core API, briefs (all converted from `.test.ts` to `.doctest.md`)

### Covered by traditional tests

- `test/check.test.ts` / `test/doctest.test.ts` — Meta-tests for the test infrastructure. These must stay as traditional tests (circular dependency — doctests use `check()` and the doctest parser).

### Good candidates for doctest expansion

- **Connectors** (`src/connectors/*.ts`) — With the right helpers and mocking, connector logic should work well as doctests. Needs helpers for stubbing HTTP responses.
- **Procedure engine** (`src/core/procedure/engine.ts`) — Step-parsing logic is doctest-able. The storytelling format — showing a procedure running step by step with prose explaining what's happening — is a natural fit. Statefulness between steps is the main challenge; `continue` blocks help.
- **WebSocket/SSE routes** — Would benefit from abstractions that let us test the underlying logic without actual WebSocket connections. Don't jump into this yet; needs design discussion about what the testable abstraction looks like.

### Fine without tests

- **CLI commands** (`src/cli/commands/*.ts`, ~35 files) — Thin glue code. Documentation-first, maybe smoke tests, but thorough testing isn't valuable here.
- **Agent invocation** (`src/core/agent.ts`) — Spawns Claude Code subprocesses. No meaningful output to check in isolation.
- **OAuth** (`src/connectors/google-auth.ts`) — Standard OAuth flow, simpler without tests.
- **Chat sessions** (`chat-session.ts`, `chat-session-pool.ts`, `chat-thread-session.ts`) — Long-lived subprocess management. Uncertain what's testable without running Claude. Maybe integration tests, needs more thought.

## 1. API Route Tests

**Status:** In progress — 19 of 56 endpoints tested (34%)
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
| `chat.ts` | 0/8 | 0% | All endpoints need Claude API mocking |
| `commands.ts` | 0/5 | 0% | Listing endpoints are locally testable |
| `history.ts` | 0/3 | 0% | All locally testable (git log/diff) |
| `actions.ts` | 0/4 | 0% | answer/create are locally testable |
| `sse.ts` | 0/1 | 0% | Needs SSE stream testing approach |
| `pairing.ts` | 0/2 | 0% | External API (Dropbox relay) |
| `calendar.ts` | 0/3 | 0% | External API (Google Calendar) |
| `auth.ts` | 0/4 | 0% | External API (Google OAuth) |

**Open question:** How to handle routes with external dependencies? Preferred approach is built-in dependency injection (not mock libraries). Service objects passed to route registration, replaced with test implementations in tests.

## 2. Frontend Tests

**Status:** Not started — needs architecture changes first
**Priority:** Medium

No test infrastructure exists. The React frontend has ~15 page components and ~10 utility modules.

### What's testable today

Pure utility functions in `src/frontend/lib/` — `parseTags.ts`, `speech-parsing.ts`, `patmatch.ts` — could be doctests right now.

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

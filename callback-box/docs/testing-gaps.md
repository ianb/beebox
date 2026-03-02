# Testing Gaps — Working Document

Tracking areas where test coverage is missing or thin, and plans for addressing each.

## 1. API Route Tests

**Status:** In progress — 19 of 56 endpoints tested (34%)
**Priority:** High — deterministic, fast, covers fragile code

Uses Fastify's `inject()` method with a shared test helper (`test/helpers/test-server.ts`) that creates a temp box, initializes git, and boots a server. Tests live in `test/routes-*.test.ts`.

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

**Remaining locally testable endpoints** (no external APIs):
- `GET /api/questions`, `GET /api/context` (api.ts)
- `GET /api/history`, `GET /api/history/diff/:hash`, `GET /api/history/session/:sessionId` (history.ts)
- `GET /api/commands/list`, `GET /api/commands/:name` (commands.ts)
- `POST /api/actions/answer`, `POST /api/actions/create` (actions.ts)

**Open question:** How to handle routes with external dependencies (Telegram, Claude, Google OAuth)? Options: mock at the fetch level, inject mock service implementations, or dependency-inject service objects into route registration.

## 2. Frontend Tests

**Status:** Not started — needs infrastructure + architecture changes first
**Priority:** Medium — important but requires upfront decisions

### Current state

No test infrastructure exists: no test runner (vitest/jest), no testing library, no mock setup. The React frontend has ~15 page components and ~10 utility modules.

### What's testable today (no refactoring needed)

Pure utility functions in `src/frontend/lib/`:
- **`parseTags.ts`** (~130 lines) — XML-like tag parser, returns structured `TagType` objects. Pure function, no I/O.
- **`speech-parsing.ts`** (~80 lines) — Extracts speech segments from text, validates voice names. Pure function.
- **`patmatch.ts`** — Pattern matching utility. Pure function.
- **`earcons.ts`** — Sound effect helper (partially pure).

These could be tested with plain TAP unit tests today, same as the existing `chat-response-extraction.test.ts`.

### What needs refactoring to test

Components tightly couple data fetching with rendering. Every page does `useEffect → fetch → setState → render` inline. This means you can't render a component without either mocking fetch or running a real server.

**Example pattern (current):**
```tsx
function QuestionsPage() {
  const [questions, setQuestions] = useState([]);
  useEffect(() => { fetchQuestions().then(setQuestions); }, []);
  return <div>{questions.map(q => <QuestionCard q={q} />)}</div>;
}
```

To test `QuestionCard` in isolation, you'd need to extract it and pass data as props. To test the page, you'd need MSW or a fetch mock.

### Architecture direction: unidirectional data flow

The goal isn't just testability — it's a development pattern where the entire UI is a pure function of a state object. For any given state, you hand the app a JSON blob and it renders exactly that. This makes testing, development, and debugging the same activity.

**What this looks like:**
- A store (context + reducer, or similar) holds the full app state as a plain object
- Components are pure functions of state — they receive data as props, emit actions
- An effect/action layer handles API calls, SSE subscriptions, etc. and updates the store
- No `useEffect → fetch → setState` inside components

**What this enables:**
- **Testing without mocking** — render any component by passing it a state slice. No fetch mocks, no MSW, no server needed.
- **State snapshots** — capture real app state, replay it locally for debugging or visual review.
- **State catalog** — build a collection of interesting states (empty inbox, 50 unread briefs, error states) for development and visual regression.
- **Agent-friendly development** — an agent can construct a state blob to see what the UI looks like without running the server.

**What needs to change:**
- Lift state out of components into a shared store
- Replace inline `useEffect → fetch` patterns with store actions/effects
- Components become presentational — data in, callbacks out
- SSE events and API responses update the store, not individual component state

This is a significant refactoring but the current code isn't that far off — most pages already fetch into local state and pass down as props. The main change is lifting that state up one level.

### Suggested progression

1. Add vitest + utility tests for `parseTags`, `speech-parsing` (quick win, no refactoring)
2. Design the state shape and store pattern for one page (e.g., DashboardPage)
3. Refactor that page to unidirectional data flow
4. Add component tests that just pass state slices — no mocking needed
5. Expand to other pages

## 3. Chat Session Behavioral Tests

**Status:** Needs design — partially covered by existing unit tests
**Priority:** Medium — the acknowledge-first pattern is critical to UX

### What exists

- **`chat-response-extraction.test.ts`** — 9 tests covering the regex extraction logic, multi-chunk assembly, partial tags, acknowledge-then-report pattern. This is solid.
- The system has two distinct session types:
  - **ChatSession** (web UI) — streams everything back via SSE, no structured extraction
  - **ChatThreadSession** (Telegram) — extracts `<chat-response>` tags for immediate delivery, uses acknowledge-first pattern

### What's testable without Claude

Pure logic that doesn't need agent output:

| Component | What to test | Approach |
|---|---|---|
| Session pool rotation | Age/message-count thresholds trigger new session | Unit test with mock clock |
| Session persistence | JSON store read/write, resume vs. fresh decision | Unit test with temp files |
| Thread file operations | Message append, XML stamping, participant management | Unit test with temp files |
| Stream parsing | JSONL parsing, message type dispatch, session ID capture | Unit test with mock stream |
| Typing indicator | Start/stop timing, cleanup on error | Unit test with mock timers |

### What requires Claude (or a substitute)

The interesting behavioral questions — does the agent actually acknowledge first? does it use `<chat-response>` tags? — require running a real agent or a convincing mock.

**Approach options:**

1. **`cb chat-test` CLI command** — A new command that sends a message through ChatThreadSession, waits for responses, validates structure, then exits. Could be used as a scenario step (`run: cb chat-test "summarize the inbox"`). Pros: integrates with existing scenario system. Cons: still costs money per run (agent call), still non-deterministic.

2. **Scenario `chat:` step type** — Extend the scenario runner to support `chat: "message text"` steps with special validations like `response-count: 2` or `first-response-within: 5s`. More structured than a shell command. Cons: significant runner changes.

3. **Mock Claude subprocess** — Replace `cb-claude` with a script that emits predetermined stream-json output. Tests the full pipeline (message → session → extraction → delivery) with deterministic output. Pros: fast, free, deterministic. Cons: doesn't test whether the real agent follows the system prompt.

4. **Periodic live validation** — Run a real chat interaction (via Telegram or API) as part of a scheduled health check, not a test suite. Validate that `<chat-response>` tags appear in the thread file. Pros: tests real behavior. Cons: not a test you run in CI.

**Recommendation:** Option 3 (mock subprocess) for the pipeline mechanics, option 1 or 4 for periodic real-agent validation.

## 4. Scenario System Extensions

**Status:** Working well for CLI pipelines, limited for interactive features
**Priority:** Low-medium — worth thinking about but not urgent

### Current capabilities

The scenario system tests full CLI pipelines: connector sync → wakeup → reactor → output. It handles time progression, HTTP stubs, git state, and three validation types (committed, script, prompt). Six scenarios exist covering intake, news processing, scheduled scripts, and time-gated behavior.

### Limitations

- **Shell-only execution** — only `run: <command>` steps. Can't directly test chat interactions, API calls, or frontend behavior.
- **No per-step setup/teardown** — each scenario is a clean-slate run from `main`.
- **Prompt validations are expensive** — $0.50 each, 5 turns max. Used sparingly.
- **Static HTTP stubs** — file-based responses can't simulate streaming, latency, or connection failures.

### Possible extensions

| Extension | Value | Effort | Notes |
|---|---|---|---|
| `chat:` step type | Test chat sessions in pipeline context | Medium | Needs ChatThreadSession integration in runner |
| `api:` step type | Test API endpoints in scenario context | Low | Could use Fastify inject or curl |
| `inject:` step type | Seed files/data between steps | Low | Currently done via shell `run:` steps |
| Mock subprocess support | Deterministic agent output | Medium | Replace `cb-claude` with scripted responses |
| Parallel step groups | Test concurrent operations | High | Significant runner redesign |

These are ideas, not commitments. The current system covers the most important pipelines well.

## 5. Connector Webhook Integration

**Status:** Not started — overlaps with API route tests and chat session tests
**Priority:** Low-medium

Testing that incoming webhooks (Telegram update JSON) get properly routed to chat sessions and produce responses. The Telegram route does: validate secret → parse update → append to thread → route to session pool → deliver responses.

Most of this chain could be tested by injecting a webhook payload via Fastify `inject()` if we had a way to mock the ChatSessionPool (so it doesn't spawn a real Claude process). This is really a dependency injection question for the route tests.

## 6. Post-Deploy Smoke Test

**Status:** Not started
**Priority:** Low — nice to have, currently manual

After `deploy.sh` runs, verify the server came up healthy. Could be as simple as adding to the deploy script:

```bash
sleep 2
curl -sf https://server/$SLUG/api/status || echo "WARNING: health check failed"
```

The `/api/status` endpoint already returns box state and counts — a successful response confirms the server is running and can read the box.

---

## Decisions Log

*(Record decisions about approaches as they're made)*

- **2026-03-02:** API route tests implemented using Fastify `inject()` + shared test helper. Pattern established: `createTestServer()` → `server.inject()` → assertions → `cleanup()`. Test files: `routes-api.test.ts`, `routes-admin.test.ts`, `routes-scheduler.test.ts`, `routes-briefs.test.ts`.

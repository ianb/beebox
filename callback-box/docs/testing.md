# Testing

## Testing Philosophy

Tests serve three purposes in this project, in order of importance:

1. **Forcing decomposition** — Making something testable creates clean boundaries. Writing a test first helps identify a function's purpose and isolate it from its surroundings.
2. **Documentation** — Tests as literate documents that tell a story about how things work. Doctests are the primary format: readable markdown that happens to be executable.
3. **Regression anchors** — Specific bug prevention at the moment of a fix.

What tests are NOT for: validating types (the type system does that), achieving coverage percentages, or comprehensive verification for its own sake. Types with strict settings already act as smoke tests for structural correctness.

**Key principles:**
- **No mock libraries.** Injectability should be built into code. Prefer dependency injection over mocking frameworks.
- **No server spin-up for testing.** Route tests use Fastify's `inject()`, not a running server. State-in → render → check output.
- **TAP over fancy test runners.** TAP's text protocol is agent-readable and zero-dependency.
- **Doctests are the default.** If it can be explained with examples in markdown, it should be a doctest. Traditional `.test.ts` files are for things that genuinely need complex setup or meta-testing.

## 1. Doctests

**Location:** `test/*.doctest.md`
**Runner:** TAP with a custom Node.js loader (the monorepo's `agent-doctest` package — loader hook at `agent-doctest/src/doctest-hooks.mjs`, exposed via the `agent-doctest/hooks` export)
**Run:** `pnpm test` (runs alongside traditional tests)

Doctest files are executable markdown documents. The prose explains behavior; fenced code blocks contain examples that are run as tests. A Node.js loader hook transforms them into TAP tests at runtime.

**When to use:** The default for most testing. Pure functions, template generators, stateful sequences with setup helpers, anything where showing examples is more readable than `t.equal()` assertions.

**Syntax:** See `.claude/rules/doctest.md` for the full reference.

````markdown
```ts setup
import { initBox, isValidBox } from "../src/core/box/index.js";
```

## Creating a box

`initBox` creates the directory structure:

```
const tmp = await makeTmpDir();
await initBox(tmp, { skipGit: true });
await isValidBox(tmp)
=> true
```
````

**Features:**
- `t.check()` wildcards in expected values: `«*»` (anything), `«date»`, `«int»`, `«name»`, `«name=type»`
- ```` ``` continue ```` blocks share scope with the previous block (for prose between related code)
- ```` ``` cleanup ```` blocks register teardown code via `t.teardown()` — runs after the test even on failure
- Lines ending with `;` are statements; the last non-`;` line is the checked expression
- Setup blocks run at module scope for imports and helpers
- `print()` — scope-local function for building narrative output (see below)

**`print()` for storytelling:**

Each test gets its own `print` function. Lines accumulate and drain into the next `=>` assertion, combined with the expression result. Useful for building up narrative output across multiple steps:

````markdown
```
const result = await runProcedure(params);
print(`status: ${result.success}`);
for (const step of steps) {
  print(`${step.id}: ${step.status}`);
};
"done"
=>
status: true
fetch: completed
analyze: skipped
done
```
````

When `print()` isn't called, behavior is unchanged — the expression result is checked directly. `print()` returns void, so `print("last line")` as the expression adds the line without appending an extra value.

**Shared helpers:**
- `test/helpers/doctest-helpers.ts` — `makeTmpBox()` for filesystem tests. Returns `.root`, `.list()`, `.read()`, `.write()`, `.cleanup()`. All output is relative paths (no temp dir names in expected output).
- `test/helpers/doctest-server.ts` — `makeTestServer()` for route tests. Returns `.inject()` (string for check), `.request()` (parsed object), `.seed()`, `.read()`, `.commitAll()`, `.cleanup()`. Uses Fastify `inject()` internally — no socket server. `.request()`/`.inject()` prefix URLs with the test box slug (`/test`); use `.rootRequest()` to hit a root-level route without that prefix.

**Current doctest files:**

| File | Tests |
|------|-------|
| `test/core/box.doctest.md` | `initBox()`, directory structure, `isValidBox()`, `findBoxRoot()`, metadata |
| `test/schemas/schemas.doctest.md` | Schema registry, card templates (memo, question, intake-job, calendar-review-job) |
| `test/connectors/intake-utils.doctest.md` | `createOrAppendIntakeJob()` — create, append, multi-source |
| `test/connectors/calendar-utils.doctest.md` | ICS parsing, event formatting, timespan parsing, date filtering |
| `test/core/chat-response-extraction.doctest.md` | `<chat-response>` streaming extraction, chunking, multiline |
| `test/connectors/chat-utils.doctest.md` | Chat utilities |
| `test/schemas/scheduled-script.doctest.md` | `isDue()`, `isDueForWakeup()`, `isWithinBudget()`, template generation |
| `test/core/schedule-state.doctest.md` | `pruneRecentRuns()`, `recordRun()` |
| `test/cli/lib/format.doctest.md` | `stripAnsi()` |
| `test/core/procedure/dedent.doctest.md` | `dedent()` |
| `test/serialize.doctest.md` | Value serialization |
| `test/cli/lib/paths.doctest.md` | Card name parsing |
| `test/webapp/routes/routes-scheduler.doctest.md` | Scheduler log and schedules listing API |
| `test/webapp/routes/routes-admin.doctest.md` | Box config admin API |
| `test/webapp/routes/routes-api.doctest.md` | Core data API (status, inbox, cards, browse, debug-log, activity) |
| `test/webapp/routes/routes-commands.doctest.md` | Command listing, details, sync execution, error cases |
| `test/webapp/routes/routes-history.doctest.md` | Git commit log, diffs, session log |
| `test/webapp/routes/routes-actions.doctest.md` | Answer question, create card, validation |
| `test/webapp/routes/routes-clerk.doctest.md` | Clerk extension API (memo, save-to-brief, save-page, tabs, actions) |
| `test/frontend/lib/parse-tags.doctest.md` | XML-like tag parsing (frontend) |
| `test/frontend/lib/patmatch.doctest.md` | Keyword pattern matching (frontend) |
| `test/frontend/lib/speech-parsing.doctest.md` | Speech tag extraction for TTS (frontend) |
| `test/frontend/lib/speech-keywords.doctest.md` | Voice command keyword detection (frontend) |
| `test/print.doctest.md` | `print()` function in doctests (meta-test) |
| `test/core/procedure/procedure-engine.doctest.md` | Procedure engine: shell steps, precheck skip/fail, validation, agent mock, fallback commits |
| `test/cli/lib/git.doctest.md` | Git command helpers (init, commit, log, diff, status, branches, tags) |
| `test/cli/lib/time.doctest.md` | Stubbable time utilities (CB_TIME env, stubs.yaml, caching) |
| `test/webapp/routes/routes-calendar.doctest.md` | Calendar config routes (list available, get/save config) |
| `test/services/service-call-log.doctest.md` | Generic `withCallLog()` wrapper for recording method calls |
| `test/services/service-telegram.doctest.md` | Telegram service fake (outbox, webhook, polling) |
| `test/services/service-google-calendar.doctest.md` | Google Calendar service fake (calendars, events) |
| `test/services/service-openai-audio.doctest.md` | OpenAI audio service fake (transcription, TTS) |
| `test/service-imap.doctest.md` | IMAP service fake (connect, search, fetch) |
| `test/connectors/connector-telegram.doctest.md` | Telegram connector: extractMessage, webhook processing, full sync, outbound send |

## Testing with Service Fakes

External dependencies (APIs, CLIs) are wrapped in typed service interfaces with fake implementations for testing. Full service layer docs: `src/services/CLAUDE.md`.

### Pattern

Every external service has three parts:

1. **Interface** — the subset of the API we actually use
2. **Real factory** — thin wrapper around the library, created from config
3. **Fake factory** — domain-specific in-memory implementation for tests

```typescript
// Create a fake with domain-specific constructor params
const tg = createFakeTelegram({ username: "test_bot" });

// Fakes have observable state
await tg.sendMessage(123, "hello");
tg.sent.length  // => 1
tg.sent[0].text // => "hello"
```

### Injecting into routes

Pass fakes via `makeTestServer({ services: { ... } })`:

```typescript
const tg = createFakeTelegram({ username: "my_bot" });
const ctx = await makeTestServer({ services: { telegram: tg } });
// Routes that use telegram will get the fake
const res = await ctx.request({ method: "GET", url: "/api/admin/telegram-status" });
// Inspect what the route did via the fake's state
tg.sent  // messages the route sent
```

### Call logging

Wrap any fake with `withCallLog()` to record method calls:

```typescript
const tg = withCallLog(createFakeTelegram({ username: "bot" }));
await tg.sendMessage(123, "hello");
printCalls(tg.callLog);
// => sendMessage(123, "hello")
```

### Available fakes

| Service | Factory | Key constructor params | Observable state |
|---------|---------|----------------------|-----------------|
| Telegram | `createFakeTelegram()` | `{ username }` | `.sent[]`, `.webhookUrl` |
| Claude CLI | `createFakeClaudeCli()` | `{ loggedIn? }` | `.loggedIn` |
| Google Calendar | `createFakeGoogleCalendar()` | `{ calendars?, events? }` | `.calendars[]`, `.events[]` |
| OpenAI Audio | `createFakeOpenAIAudio()` | `{ transcriptionText? }` | `.calls[]` |
| IMAP | `createFakeImap()` | `{ messages? }` | `.connected`, `.lockedMailbox` |
| Google Auth | `createFakeGoogleAuth()` | `{ accessToken? }` | — |

### Connector testing pattern

Connector tests use `makeTmpBox({ git: true })` to create a temp box with git, seed config files, inject a service fake, and run `sync()`:

```typescript
const box = await makeTmpBox({ git: true });
await initBox(box.root);
box.commitAll("init box");
await box.seed("config/connectors/telegram.secret.json", JSON.stringify({...}));
box.commitAll("add config");

const tg = createFakeTelegram({ username: "bot", updates: [...] });
const connector = createTelegramConnector(box.root, tg);
const result = await connector.sync();
// Check result.created, result.updated, result.pushed
// Check tg.sent for outbound messages
await box.cleanup();
```

### Doctest limitations

Doctest blocks are full TypeScript (compiled via esbuild's `ts` loader) — `import type`, non-null assertions, and type annotations all work, in setup and test blocks alike. The real limitations are structural: assertions compare serialized output (see the string-comparison rules in `.claude/rules/doctest.md`), and code blocks can't express trailing newlines.

## 2. Traditional TAP Tests

**Location:** `test/*.test.ts`
**Runner:** [tap](https://node-tap.org/) v21 with tsx
**Run:** `pnpm test`

Reserved for things that would be circular as doctests: testing the test infrastructure itself.

**Current files:**

| File | Tests |
|------|-------|
| `test/check.test.ts` | Wildcard matching, extractions, diff output, serializers, inspect() |
| `test/doctest.test.ts` | Doctest parser and generator (meta-testing) |

## 2. Scenario Tests

**Location:** Definitions in `~/src/boxes/scenarios/<name>/`, runner in `src/scenario/`
**Run:** `cb scenario list` / `cb scenario run <name>`

Scenario tests are end-to-end integration tests that run the full system (CLI commands, connectors, agents) against a real box, with stubbed time and HTTP. They verify that the whole pipeline works — from connector sync through agent processing to output generation.

**When to use:** Testing system behavior that spans multiple components — connector pulls items, wakeup creates jobs, reactor processes them, output appears in the right place. Also useful for testing agent behavior (via `prompt:` validations) in realistic contexts.

### Scenario Definition (`scenario.yaml`)

```yaml
name: intake-basic
description: Basic intake-job creation and processing

steps:
  - name: sync
    run: cb wakeup
    time: "2026-01-20T15:00:00Z"     # sets CB_TIME for this step onward
    checkpoint: after-sync            # git tag on the step's commit, for manual inspection
    validate:
      - committed: true               # working tree must be clean
      - script: "ls box/jobs/*.intake.job.card | wc -l | grep -q 2"
      - prompt: "Check that intake jobs were created for the seeded inbox items"

  - name: process
    run: cb reactor
    validate:
      - committed: true
      - script: "ls box/jobs/*.intake.job.card 2>/dev/null | wc -l | grep -q '^0$'"
```

### Stubs (`stubs.yaml`)

```yaml
time: "2026-01-15T12:00:00Z"         # freeze CB_TIME globally

http:
  - pattern: "https://techblog.test/feed.xml"
    response_file: stubs/feed.xml      # relative to scenario dir

  - pattern: "https://techblog.test/feed.xml"
    response_file: stubs/feed-with-articles.xml
    after: "4h"                        # only active after 4h of scenario time

  - pattern: "https://techblog.test/2026/01/ai-consumer-products*"
    response_file: stubs/article-1.html
```

HTTP stubs intercept `fetch()` calls. Patterns can use `*` suffix wildcards. When multiple stubs match, the last one whose `after:` constraint is met wins. Strict fetch mode (`CB_STRICT_FETCH=1`) rejects any un-stubbed non-localhost fetch.

### Validation Types

1. **`committed: true`** — Working tree must be clean (no staged/modified/untracked files).
2. **`script: "shell command"`** — Runs in the box root; passes if exit code is 0. Prefix with `!` for negation.
3. **`prompt: "natural language check"`** — Sends the prompt to a Claude agent acting as test validator. Response must start with `PASS` or `FAIL`.

### Runner Mechanics

1. Verifies box is on `main` with clean working tree
2. Creates test branch `test/<name>/<timestamp>`
3. Installs fetch stubs and strict fetch mode
4. Runs steps sequentially; failed step skips remaining steps
5. On completion, checks out `main` (test branch preserved for inspection)

Dry run: `cb scenario run <name> --dry-run`

Scenarios always run every step from the beginning — there is no flag to
resume from a checkpoint. `checkpoint:` on a step still tags the commit
(`scenario/<name>/<checkpoint>`) for manual inspection with `git checkout`,
but nothing restores state from it; a prior `--from <checkpoint>` flag that
only skipped steps without restoring their state was removed.

### Available Scenarios

| Scenario | What it tests |
|----------|--------------|
| `intake-basic` | Wakeup creates intake jobs for unjobbed inbox items; reactor processes them |
| `tick-basic` | Scheduled script listing, dry-run, execution, skip-if-recently-run |
| `tick-chain` | `create-after-success` chaining between scheduled scripts across ticks |

### Creating a New Scenario

Each scenario is a self-contained directory under `~/src/boxes/scenarios/<name>/` with its own git repo as the test box.

**Directory structure:** `cb init` now scaffolds the v2 package layout by default (package.json/tsconfig/src/ plus an operational `content/` subdirectory — see `docs/implemented-plans/boxes-as-packages-v2.md`), so a freshly-created scenario's `box/` looks like:
```
~/src/boxes/scenarios/my-scenario/
  scenario.yaml      # step definitions (required)
  stubs.yaml         # time/HTTP stubs (optional)
  stubs/             # stub response files (optional)
    feed.xml
    article.html
  setup.md           # human-readable description of what this tests
  box/               # the git repo (package root) — a real box initialized with cb init
    content/
      box/inbox/     # pre-seeded test data
      config/        # connector configs, schedules, etc.
    ...
```
The existing scenarios in the table above (`intake-basic`, `tick-basic`, `tick-chain`) predate this and are still flat on disk (`box/inbox/`, `config/` directly under `box/`, no `content/` nesting) with a pre-v2 `.cb-box` marker. The v1/legacy box shape has since been removed (`docs/implemented-plans/remove-box-shape-v1.md`), so `getBoxShape` is strict and rejects any marker without `shapeVersion: 2` — these scenarios need converting to the v2 package layout above rather than being a supported second shape.

**Steps to create:**

1. **Create the directory and initialize a box:**
   ```bash
   mkdir -p ~/src/boxes/scenarios/my-scenario/box
   cd ~/src/boxes/scenarios/my-scenario/box
   git init
   cb init .
   ```

2. **Seed the box with test data.** Put cards in `content/box/inbox/`, configure connectors in `content/config/connectors/`, add scheduled scripts, etc. Commit everything — the scenario runner requires a clean `main` branch as starting state.

3. **Write `scenario.yaml`** with steps. Each step runs a shell command (usually a `cb` command) and validates the result. See the format description above.

4. **Write `stubs.yaml`** if your scenario involves HTTP (connector syncs, article fetches). Freeze time with `time:` to make timestamps deterministic. Put response files in `stubs/`.

5. **Write `setup.md`** describing what the scenario tests, what stubs are used, and what the expected outcome is. This is for humans, not the runner.

6. **Test it:**
   ```bash
   cb scenario run my-scenario --dry-run   # verify steps parse correctly
   cb scenario run my-scenario             # run for real
   ```

**Design principles for scenarios:**

- **Each scenario tests one pipeline or behavior.** Don't combine unrelated features. `intake-basic` tests intake jobs only; `tick-basic` tests scheduled-script behavior only.
- **Seed the minimal data needed.** The `intake-basic` box has just 2 memos in inbox — enough to verify the behavior, not so much that agent processing is slow or unpredictable.
- **Use `--skip-*` flags** on `cb wakeup` to isolate phases when you don't need the full wakeup cycle.
- **Use checkpoints** on steps that are expensive (agent runs) to tag the resulting commit for manual inspection later. Scenarios always run from the beginning, so a checkpoint doesn't let you skip re-running earlier steps.
- **Prefer `script:` validations** for structural checks (files exist, XML contains expected content). Use `prompt:` validations only for things that require judgment (quality of generated text, correct interpretation of ambiguous input).
- **`prompt:` validations cost money.** Each one invokes a Claude agent with up to 5 turns / $0.50. Use them sparingly.

### Managing Scenarios

**Inspecting a failed run:** The test branch `test/<name>/<timestamp>` is preserved after the run. Check it out to see the state at failure:
```bash
cd ~/src/boxes/scenarios/my-scenario/box
git branch                        # list test branches
git checkout test/my-scenario/... # inspect the failed state
git checkout main                 # return to clean state
```

**Cleaning up old test branches:**
```bash
git branch | grep 'test/' | xargs git branch -D
```

**Updating a scenario's test data:** Edit files in the box on `main`, commit, then re-run. The runner always starts from a clean `main`.

**Scenarios are git repos** — you can use standard git operations. The box inside each scenario is a real box; `cb` commands work normally when you `cd` into it.

## 3. Knowledge Audits

**Location:** Tests in `src/dev/knowledge-audits.yaml`, runner in `src/dev/knowledge-audit.ts`, reports in `src/dev/reports/`
**Run:** `pnpm knowledge-audit run [--filter <id-or-tag>]`

Knowledge audits test what the agent _knows_ rather than what the system _does_. They run prompts against a Claude agent in a box and check whether the agent answered from loaded context (knows directly), followed a doc reference (knows about), or had to search (discoverable).

**When to use:** Verifying that documentation, agent guides, and conditional rules are working — that the agent has the right information at the right time. Not for testing system behavior.

See [knowledge-taxonomy.md](knowledge-taxonomy.md) for the full knowledge taxonomy and test prompt guide.

### Test Definition

```yaml
tests:
  - id: box-structure-inbox
    prompt: "Where would you look for unprocessed incoming items?"
    expected_level: knows_directly
    watch_for: "Names box/inbox/ directly without searching"
    correct_contains: ["box/inbox"]
    should_read: ["docs/generated/card-memo.md"]   # optional
    should_not_read: ["some/file.md"]              # optional
    tags: [navigation]
```

### How It Works

1. Runs the prompt via `cb prompt` in the test box
2. Parses the session transcript to extract: files read, searches, bash commands, response text
3. Automated checks: `correct_contains` (substring match), `should_read`/`should_not_read` (file access)
4. Generates a Markdown report with results + blank assessment field for human review

Reports go to `src/dev/reports/audit-report-<timestamp>.md`.

## 4. Session Critiques

**Location:** Report generator in `src/dev/lib/session-report.ts`, subagent in `.claude/agents.json`
**Run:** `@session-critique <session-id>` (or `@session-critique latest`)

Session critiques evaluate whether CLI tools helped or hindered the agent during real agentic sessions. Unlike knowledge audits (which test what the agent knows), session critiques test whether the tools the agent used gave it good output.

**When to use:** After observing a session with unusual behavior — the agent took too many turns, used raw git/grep instead of `cb` commands, or seemed confused by command output. Also useful as a periodic check on CLI usability.

### How it works

1. **Report extraction:** `cb session <id> --tool-report` parses the session JSONL and produces a markdown report containing:
   - User and assistant text messages
   - Bash commands with their **full output** (the key differentiator from `cb session` which skips output)
   - Read/Write/Edit as one-liner summaries for context
   - Grep/Glob with abbreviated results

2. **Critique subagent:** The `@session-critique` agent reads the report and evaluates it against five criteria:
   - **Unhelpful output** — Did a `cb` command produce output the agent ignored or misinterpreted?
   - **Missing commands** — Did the agent cobble together raw commands when a `cb` command should have existed?
   - **Wrong tool** — Did the agent use the wrong tool (e.g., `Read` for scanning many files)?
   - **Bad error messages** — Did errors lead the agent to the fix or cause flailing?
   - **Wasted effort** — Retry loops, redundant reads, unnecessarily complex approaches?

3. **Output:** Structured findings with evidence, impact, and concrete suggestions (CLI format changes, new commands, `.claude/rules/` hints).

### Running a critique

```bash
# From within a box directory:
cb session --list                   # find session IDs
cb session <id> --tool-report       # generate report for a specific session
cb session --latest --tool-report   # most recent session

# Or use the subagent (from Claude Code in this project):
# @session-critique <session-id>
# @session-critique latest
```

The subagent runs `cb session` itself, so it needs a box directory context.

### Acting on findings

Session critiques produce actionable suggestions. The typical workflow:

1. **Run a critique** on a session that seemed inefficient or problematic.
2. **Review findings.** Each has a category and suggestion.
3. **For unhelpful-output:** Modify the `cb` command's output format — trim noise, surface key info earlier, add structured markers the agent can parse.
4. **For missing-command:** Consider whether a new `cb` subcommand or flag would help. Only add one if the pattern recurs across sessions.
5. **For wrong-tool:** Add a `.claude/rules/` hint that triggers when the agent is in the relevant context, pointing it to the right tool.
6. **For bad-error:** Improve the error message in the CLI command. Good errors name what went wrong, what file/card caused it, and what to do next.
7. **For wasted-effort:** Usually a prompting issue. Check if the system prompt or agent guide is missing guidance for this task type.

Not every session has problems. If the critique comes back clean, that's a positive signal that the tools are working.

### Comparison with other test types

| Aspect | Knowledge audit | Session critique |
|--------|----------------|-----------------|
| Tests | What the agent knows | How well tools serve the agent |
| Input | Controlled prompts | Real session logs |
| Automated? | Yes (run suite) | Semi-manual (pick sessions to review) |
| Frequency | Periodic suite runs | After observing issues |
| Fixes | Documentation, agent guide, rules | CLI output, error messages, rules |

## 5. Card Validator Hook

**Location:** `src/core/sdk-hooks.ts` (`cardValidatorHook`)
**Trigger:** Runs automatically during agent sessions on `PostToolUse` of `Write`/`Edit`

Not a test you run manually, but a live validation hook. When an agent writes or edits a `.card` file, the hook calls the card linter (`src/core/card-lint.ts`, built on the card primitives absorbed from the former `cardworks` package into `src/cards/`) in-process and feeds any issues back as `additionalContext`. This catches frontmatter/schema issues during agent work rather than after.

Also enforces directory structure rules (e.g., trick scripts must be in subdirectories of `tricks/scripts/`).

## 6. Frontend Dev Stubs

Some frontend bugs only manifest against real layout and measurement — scroll
behavior, virtualization, streaming-driven reflow — and can't be reproduced in a
doctest. For these, drive the running app with `bin/browse` (see
`.claude/skills/browse/SKILL.md`, monorepo root) and use a dev stub to make the
input deterministic instead of depending on a live agent response.

### `/fakestream` — deterministic chat streaming

**Location:** `src/frontend/src/machines/chat-actors.ts` (`runFakeStream`)
**Trigger:** Send a chat message beginning with `/fakestream`.

Instead of calling the backend, the chat machine plays a timed script of
`STREAM_TEXT` events, growing the assistant bubble at a controlled rate with no
API calls. This reproduces streaming-UI bugs (scroll-follow, layout jitter)
frame-for-frame.

```
/fakestream [chunks] [intervalMs] [chunkLen]
```

- `chunks` — total text events to emit (default 200)
- `intervalMs` — delay between events (default 40)
- `chunkLen` — approx chars per event (default 25)

Example: `/fakestream 2000 30 25` streams ~50k chars over ~60s. The message
list is a single scroll container with `data-testid="chat-scroller"` driven by
the `useStickToBottom` controller (`InteractiveChat-scroll.ts`). Measure scroll
state from the browser to assert behavior deterministically:

```js
// fromBottom should stay ~0 while scrollHeight grows (auto-follow working)
const s = document.querySelector('[data-testid="chat-scroller"]');
({ fromBottom: s.scrollHeight - s.scrollTop - s.clientHeight, scrollHeight: s.scrollHeight });
```

**Driving the scroll regressions via `bin/browse`.** The full step-by-step
procedure (setup, all six scenarios with expected outputs, and the real-device
checklist) lives in [chat-scroll-testing.md](chat-scroll-testing.md). The
defects this redesign fixed are reproducible as `bin/browse eval` recipes
against `/fakestream`:

- **Follow while pinned:** send `/fakestream`, sample `fromBottom` repeatedly —
  it must stay `<= ~2` while `scrollHeight` grows.
- **Scroll-up during streaming must NOT yank back:** mid-stream, dispatch a
  *real* wheel event then scroll up (a bare `scrollTop` write is intentionally
  ignored — the controller only disengages on genuine wheel/touch/key intent,
  so a write-only test is a false green):
  ```js
  const s = document.querySelector('[data-testid="chat-scroller"]');
  s.dispatchEvent(new WheelEvent('wheel', { deltaY: -150, bubbles: true }));
  s.scrollTop -= 700;            // then assert fromBottom keeps GROWING, never 0
  ```
  `agent-browser`'s `mouse wheel` does not translate to a scroll in headless
  Chromium, so use the synthetic `WheelEvent` + `scrollTop` pair above.
- **Scroll-to-bottom button:** while detached,
  `document.querySelector('button[aria-label="Scroll to latest messages"]')`
  is present, and its child `span` (the accent dot) is present when content
  arrived since the user scrolled away. Clicking it returns `fromBottom` to 0.

The stub is gated purely on the message prefix, so it ships harmlessly — a real
message never starts with `/fakestream`.

## Tours (rendering + a11y review — not a gate)

Scripted browser walks (`bin/tour <name>`, scripts in `test/tours/`)
that produce review artifacts: desktop+mobile screenshots, AX-tree
snapshots, axe-core reports, and soft-assertion findings per
checkpoint. Deliberately ungated — findings never fail an exit code and
artifacts are gitignored; they're judgment material for a human or
agent reviewing UI work, not pass/fail facts. Full reference —
running, reviewing artifacts, writing conventions, and when NOT to use
them: [tours.md](tours.md).

## Choosing the Right Approach

| Question | Approach |
|----------|----------|
| Does this function return the right value? | Unit test |
| Does the full pipeline produce the right output? | Scenario test |
| Does the agent know where to find X? | Knowledge audit |
| Did the CLI tools help or hinder the agent? | Session critique |
| Does a card validate after agent edits? | Card validator (automatic) |
| Does the streaming UI scroll/reflow correctly? | Frontend dev stub (`/fakestream` + `bin/browse`) |
| Does this page render sane at both viewports / pass axe? | Tour (`bin/tour <name>` — see [tours.md](tours.md); review instrument, not a gate) |
| Is every state of this component reachable and right? | Dev harness route (`/dev/…`, real components over injected fakes) |

**Overlap:** Some things could be tested at multiple levels. Prefer the lowest level that catches the bug:
- A template generating bad XML → unit test (fast, deterministic)
- An agent not using `<chat-response>` tags → scenario test (needs agent behavior)
- An agent not knowing about a command → knowledge audit (tests documentation)

## Adding New Tests

### New doctest (preferred)
Create `test/<name>.doctest.md`. Write prose explaining the behavior, with fenced code blocks containing examples. See `.claude/rules/doctest.md` for syntax. Runs automatically with `npm test`.

### New traditional test
Create `test/<name>.test.ts`, import from `tap`. Use for route integration tests, meta-tests, or anything needing complex setup that doesn't read well as documentation.

### New scenario
Create `~/src/boxes/scenarios/<name>/` with `scenario.yaml` and optionally `stubs.yaml` + `stubs/` directory. Test with `cb scenario run <name> --dry-run` first.

### New knowledge audit
Add entries to `src/dev/knowledge-audits.yaml`. Run with `--filter <id>` to test individually.

### New session critique

Pick a session to review (use `cb session --list` from a box), then run `@session-critique <id>` from Claude Code in the callback-box project. Review the findings and apply fixes per the "Acting on findings" guide above.

## Periodic Checks

Not automated — run these occasionally and fix what they find.

### Session critiques

Review recent agentic sessions (intake triage, capture processing, chat handling) for tool quality issues. Pick sessions that seemed slow or where the agent used workarounds. Run `@session-critique <id>` and act on findings. See § Session Critiques above.

### Documentation graph

`npx tsx src/dev/doc-graph.ts > docs/doc-graph.md` — scans all `.md` files, extracts cross-references, reports orphans and broken links. Review description quality at each reference site. Fix issues, regenerate, commit.

### Supplemental linters

These catch issues the pre-commit hook doesn't:

```bash
pnpm lint:oxlint    # Ambiguous constructors, useless spreads, identical branches
pnpm lint:knip      # Unused files, exports, dependencies
pnpm lint:circular  # Value-import circular dependencies (type-only cycles are OK)
```

## Future Directions

Key ideas not yet implemented:

- **Self-describing services** — Services export `description`, `examples`, and `properties` alongside their functions. Tests get generated from these.
- **Property testing** — Semantically meaningful invariants (like `parse(serialize(card)) === card`), not random fuzzing.
- **CGI-style route testing** — Test routes as pure state→output functions rather than spinning up servers.
- **Assertive logging** — Soft assertions in production code that surface through the logging system, caught by an error harness in tests.

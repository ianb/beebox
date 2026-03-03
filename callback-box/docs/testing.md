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
**Runner:** TAP with a custom Node.js loader (`src/test-lib/doctest-hooks.mjs`)
**Run:** `npm test` (runs alongside traditional tests)

Doctest files are executable markdown documents. The prose explains behavior; fenced code blocks contain examples that are run as tests. A Node.js loader hook transforms them into TAP tests at runtime.

**When to use:** The default for most testing. Pure functions, template generators, stateful sequences with setup helpers, anything where showing examples is more readable than `t.equal()` assertions.

**Syntax:** See `.claude/rules/doctest.md` for the full reference.

````markdown
```ts setup
import { initBox, isValidBox } from "../src/core/box.js";
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

**Shared helpers:**
- `test/helpers/doctest-helpers.ts` — `makeTmpBox()` for filesystem tests. Returns `.root`, `.list()`, `.read()`, `.write()`, `.cleanup()`. All output is relative paths (no temp dir names in expected output).
- `test/helpers/doctest-server.ts` — `makeTestServer()` for route tests. Returns `.inject()` (string for check), `.request()` (parsed object), `.seed()`, `.read()`, `.commitAll()`, `.cleanup()`. Uses Fastify `inject()` internally — no socket server.

**Current doctest files:**

| File | Tests |
|------|-------|
| `test/box.doctest.md` | `initBox()`, directory structure, `isValidBox()`, `findBoxRoot()`, metadata |
| `test/schemas.doctest.md` | Schema registry, card templates (memo, question, news-job, intake-job, calendar-review-job) |
| `test/intake-utils.doctest.md` | `createOrAppendIntakeJob()` — create, append, multi-source |
| `test/calendar-utils.doctest.md` | ICS parsing, event formatting, timespan parsing, date filtering |
| `test/chat-response-extraction.doctest.md` | `<chat-response>` streaming extraction, chunking, multiline |
| `test/chat-utils.doctest.md` | Chat utilities |
| `test/scheduled-script.doctest.md` | `isDue()`, `isDueForWakeup()`, `isWithinBudget()`, template generation |
| `test/schedule-state.doctest.md` | `pruneRecentRuns()`, `recordRun()` |
| `test/format.doctest.md` | `stripAnsi()` |
| `test/dedent.doctest.md` | `dedent()` |
| `test/serialize.doctest.md` | Value serialization |
| `test/paths.doctest.md` | Card name parsing |
| `test/routes-scheduler.doctest.md` | Scheduler log and schedules listing API |
| `test/routes-admin.doctest.md` | Box config admin API |
| `test/routes-api.doctest.md` | Core data API (status, inbox, cards, browse, news, debug-log, activity) |
| `test/routes-briefs.doctest.md` | News brief reading workflow API |
| `test/routes-commands.doctest.md` | Command listing, details, sync execution, error cases |
| `test/routes-history.doctest.md` | Git commit log, diffs, session log |
| `test/routes-actions.doctest.md` | Answer question, create card, validation |
| `test/parse-tags.doctest.md` | XML-like tag parsing (frontend) |
| `test/patmatch.doctest.md` | Keyword pattern matching (frontend) |
| `test/speech-parsing.doctest.md` | Speech tag extraction for TTS (frontend) |
| `test/speech-keywords.doctest.md` | Voice command keyword detection (frontend) |

## 2. Traditional TAP Tests

**Location:** `test/*.test.ts`
**Runner:** [tap](https://node-tap.org/) v21 with tsx
**Run:** `npm test`

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
name: news-basic
description: Basic RSS sync and news processing

steps:
  - name: sync
    run: cb wakeup
    time: "2026-01-20T15:00:00Z"     # sets CB_TIME for this step onward
    checkpoint: after-sync            # git tag for --from resumption
    validate:
      - committed: true               # working tree must be clean
      - script: "ls box/inbox/news/*.news-item.card | wc -l | grep -q 2"
      - prompt: "Check that news items were created in the inbox"

  - name: process
    run: cb reactor
    validate:
      - committed: true
      - script: "ls box/output/briefs/*.news-brief.card 2>/dev/null | wc -l | grep -qv '^0$'"
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

Resume from a checkpoint: `cb scenario run <name> --from <checkpoint>`
Dry run: `cb scenario run <name> --dry-run`

### Available Scenarios

| Scenario | What it tests |
|----------|--------------|
| `intake-basic` | Wakeup creates intake jobs for unjobbed inbox items; reactor processes them |
| `news-basic` | RSS sync → news items + news-job → reactor produces news-brief |
| `news-guide-revision` | Feedback triage → guide-revision job → reactor updates news guide |
| `news-timed` | Time-gated stubs: empty feed initially, articles appear after simulated time passes |
| `tick-basic` | Scheduled script listing, dry-run, execution, skip-if-recently-run |
| `tick-chain` | `create-after-success` chaining between scheduled scripts across ticks |

### Creating a New Scenario

Each scenario is a self-contained directory under `~/src/boxes/scenarios/<name>/` with its own git repo as the test box.

**Directory structure:**
```
~/src/boxes/scenarios/my-scenario/
  scenario.yaml      # step definitions (required)
  stubs.yaml         # time/HTTP stubs (optional)
  stubs/             # stub response files (optional)
    feed.xml
    article.html
  setup.md           # human-readable description of what this tests
  box/               # the git repo — a real box initialized with cb init
    box/inbox/       # pre-seeded test data
    config/          # connector configs, schedules, etc.
    ...
```

**Steps to create:**

1. **Create the directory and initialize a box:**
   ```bash
   mkdir -p ~/src/boxes/scenarios/my-scenario/box
   cd ~/src/boxes/scenarios/my-scenario/box
   git init
   cb init .
   ```

2. **Seed the box with test data.** Put cards in `box/inbox/`, configure connectors in `config/connectors/`, add scheduled scripts, etc. Commit everything — the scenario runner requires a clean `main` branch as starting state.

3. **Write `scenario.yaml`** with steps. Each step runs a shell command (usually a `cb` command) and validates the result. See the format description above.

4. **Write `stubs.yaml`** if your scenario involves HTTP (connector syncs, article fetches). Freeze time with `time:` to make timestamps deterministic. Put response files in `stubs/`.

5. **Write `setup.md`** describing what the scenario tests, what stubs are used, and what the expected outcome is. This is for humans, not the runner.

6. **Test it:**
   ```bash
   cb scenario run my-scenario --dry-run   # verify steps parse correctly
   cb scenario run my-scenario             # run for real
   ```

**Design principles for scenarios:**

- **Each scenario tests one pipeline or behavior.** Don't combine unrelated features. `intake-basic` tests intake jobs only; `news-basic` tests news processing only.
- **Seed the minimal data needed.** The `intake-basic` box has just 2 memos in inbox — enough to verify the behavior, not so much that agent processing is slow or unpredictable.
- **Use `--skip-*` flags** on `cb wakeup` to isolate phases when you don't need the full wakeup cycle.
- **Use checkpoints** on steps that are expensive (agent runs). This lets you re-run later steps without re-running expensive earlier ones: `cb scenario run my-scenario --from after-wakeup`.
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
**Run:** `npm run knowledge-audit -- run [--filter <id-or-tag>]`

Knowledge audits test what the agent _knows_ rather than what the system _does_. They run prompts against a Claude agent in a box and check whether the agent answered from loaded context (knows directly), followed a doc reference (knows about), or had to search (discoverable).

**When to use:** Verifying that documentation, agent guides, and conditional rules are working — that the agent has the right information at the right time. Not for testing system behavior.

See [agent-knowledge.md](agent-knowledge.md) for the full knowledge taxonomy and test prompt guide.

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

## 4. Card Validator Plugin

**Location:** `plugins/card-validator/`
**Trigger:** Runs automatically during Claude Code sessions on Write/Edit of `.card` files

Not a test you run manually, but a live validation hook. When an agent writes or edits a `.card` file, the plugin runs `cb validate` and feeds errors back as inline context. This catches XML/schema issues during agent work rather than after.

Also enforces directory structure rules (e.g., trick scripts must be in subdirectories of `tricks/scripts/`).

## Choosing the Right Approach

| Question | Approach |
|----------|----------|
| Does this function return the right value? | Unit test |
| Does the full pipeline produce the right output? | Scenario test |
| Does the agent know where to find X? | Knowledge audit |
| Does a card validate after agent edits? | Card validator (automatic) |

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

## Future Directions

See [testing-gaps.md](testing-gaps.md) for detailed plans. Key ideas:

- **Self-describing services** — Services export `description`, `examples`, and `properties` alongside their functions. Tests get generated from these.
- **Property testing** — Semantically meaningful invariants (like `parse(serialize(card)) === card`), not random fuzzing.
- **CGI-style route testing** — Test routes as pure state→output functions rather than spinning up servers.
- **Assertive logging** — Soft assertions in production code that surface through the logging system, caught by an error harness in tests.

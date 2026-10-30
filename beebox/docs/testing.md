# Testing

How the engine is verified. One page per verification instrument, each
answering one question about the system; this page holds what is true of
testing as a whole.

## Philosophy

Tests serve three purposes in this project, in order of importance:

1. **Forcing decomposition** — Making something testable creates clean boundaries. Writing a test first helps identify a function's purpose and isolate it from its surroundings.
2. **Documentation** — Tests that tell a story about how things work: a comment says what each test shows, and each check states the whole value.
3. **Regression anchors** — Specific bug prevention at the moment of a fix.

What tests are NOT for: validating types (the type system does that), achieving coverage percentages, or comprehensive verification for its own sake. Types with strict settings already act as smoke tests for structural correctness.

**Key principles:**
- **No mock libraries.** Injectability should be built into code. Prefer dependency injection over mocking frameworks.
- **No server spin-up for testing.** Route tests use Fastify's `inject()`, not a running server. State-in → render → check output.
- **TAP over fancy test runners.** TAP's text protocol is agent-readable and zero-dependency.
- **`.test.ts` with `t.check` is the test form** ([reference](testing/check.md)). Each check compares a whole value, and the type checker checks the expected value.

**Iteration runs the selected tests, not the suite.** `pnpm test:changed`
selects and runs the tests the diff implicates; `pnpm typecheck` and
`pnpm lint:changed` are separate commands. There is no full run at merge:
full runs were mostly red for reasons the branch did not cause. The full
suite runs on its own schedule instead
([recurring work](development/workflow.md#recurring-work)), bisected to the
landing that broke it.

**A broad selection runs in the background.** An edit to a module that
hundreds of tests import selects about half the suite, which takes about
10 minutes. `test:changed` prints the file count and an estimated time
first, from the ledger's per-file times. At 5 minutes or more it says to run
the command in the background, because load can make the run pass an agent
shell's 10-minute foreground limit. `node --import tsx ../bin/test-select.ts`
prints the same line and the selection without running it, plus the largest
reason groups (`547 imports beebox/src/x.ts; …`). Add `--why` to list every
reason with its tests.

## Instruments

| Instrument | Question it answers | Gate? | Cost |
|---|---|---|---|
| [Tests with `t.check`](testing/check.md) | Does this function, route, or box operation behave? Includes service fakes for every external dependency. | merge (selected) | seconds |
| [The tap runner](testing/tap-tests.md) | How is the test runner set up, and why does it fail the way it does? | merge (selected) | seconds |
| [Real model calls](testing/real-models.md) | How does the real model or API behave, beyond what a fake shows? Experiments and calibration, not committed tests. | no | usually cents |
| [Knowledge audits](testing/knowledge-audits.md) | Does the box agent know X, from what it is given? | no | model turns |
| [Session critiques](testing/session-critiques.md) | Did the CLI tools help or hinder the agent in a real session? | no | model turns |
| [Dev stubs](testing/dev-stubs.md) | Does the streaming UI behave, and is every state of a component reachable? Checked by hand in a browser. | no | minutes |
| [Smoke](testing/smoke.md) | Does the app boot and walk at all? | merge, for deployed paths | about 30 s |
| [Tours](testing/tours.md) | Does each page render and pass axe at both viewports? | no; walked weekly | tens of seconds |
| [Field tests](testing/field-testing.md) | Is it discoverable and usable end to end, through the real UI? | no | expensive; on demand |
| [Card validator hook](cards/validation.md) | Does a card still validate after an agent edit? Runs on its own during agent sessions. | blocks bad commits | automatic |
| [User-stories catalog](user-stories/README.md) | What can the software actually do? Claims read from the source by agents, each verified by a different agent than the one that wrote it. | no | many model turns |

## Choosing an instrument

Prefer the lowest instrument that catches the bug: a template generating bad
XML is a test; an agent not knowing about a command is a knowledge audit;
an agent not using a tag it was told to use is a field test. Within tests,
the change picks the form: pure logic is a plain test, an HTTP surface a
route test (`makeTestServer()`), anything that touches box files a
filesystem test (`makeTmpBox()`), and a React effect, event handler, or
re-render a [DOM test](testing/check.md#dom-tests) (`mount()`). A change that fits no instrument cleanly
usually needs splitting, not a new harness.

Coverage follows the change's risk, not a percentage. Cover the substantial
code paths and the failures that can really happen; a test is enough for
logic, routes, and box operations. No test is mandated by the kind of change:
a bug fix gets a regression test only when the bug is a logic class that
can recur (a branch, a parser, a boundary), not for a wrong path, string, or
one-line typo. Each test proves one claim the code could get wrong; an
test that would still pass if the code it covers were deleted is itself a
defect, and so is a second test proving the same claim with a different
literal. Exploring varied inputs during work is useful; keep only the cases
that failed, each with the reason its expected value is right. A changed page or shared primitive also gets its tour walked before
the work is called done. A new agent-facing concept gets at least one knowledge
audit. A change that could break startup or the app bar gets a smoke run by
hand before landing. A field test is for a capability whose value depends on
the agent or the user finding it through the real UI.

## Reproducing a bug

Build a loop that goes red on this bug before changing code. Pick the fastest
loop that reaches the bug:

- **A test**: logic, routes, box-file operations, and React effects and
  re-renders (a DOM test). Write it first; keep it as the regression
  test only when the bug is a logic class that can recur (see above), and
  delete it once the fix is green otherwise.
- **The dev router**: `curl http://localhost:3210/<worktree>/<box>/api/...`
  hits a backend route in the running app.
- **`bin/browse`**: a headless browser on the running app for frontend bugs
  (the browse skill). For layout or streaming bugs, a [dev stub](testing/dev-stubs.md)
  makes the input deterministic.
- **The [client debug log](client-debug-log.md)**: browser console errors and
  `[ios]` native entries, forwarded to the box's `.beebox/client-debug.log`.
  It is often the evidence for a frontend bug.
- **A [knowledge audit](testing/knowledge-audits.md)**: the box agent does the
  wrong thing. A wrong answer is a red loop. Pass `--box` an absolute path.
- **A [field test](testing/field-testing.md)**: a multi-step failure across
  wakeup, connectors, and agent runs. Each run starts from the beginning;
  there is no checkpoint-resume, so it is the slowest loop.
- **A box**: the test box, its worktree clone, or a throwaway box. Where
  each lives and what not to touch: [box work](box-work.md).
- **Git history**: `git log -S '<symbol>'`, `git log -- <path>`, and
  `git blame` find what changed. Recent commits are the first suspects.

After three failed fixes, stop. When each fix exposes a new problem elsewhere,
the design is the likely cause; raise it with the boxholder before a fourth
attempt.

A bug that appears only on the boxholder's device or in production has no
local loop; the field-probe skill deploys gated instrumentation, hands the
boxholder a script, and reads the trace back.

Before working around third-party behavior, search recent issues and the
installed version's changelog. Known cases that cost time here: `canvas.toBlob`
produces only lossy WebP and AVIF; Node 20.3 and later advance timers during
macOS sleep (use `startAwakeTimeout`); named value imports from a CommonJS
module fail under Node's ESM loader.

# Manual tests

Executable doctests in this directory are **excluded from `pnpm test`**. They
run real processes, make network calls, or deliberately wait on wall-clock
deadlines that are too slow or expensive for every normal run.

The explicit `test:manual` allowlist runs automatically once a week through the
`manual-tests` schedule (`schedules/manual-tests/`). Adding a test to this
directory does not spend API credit unattended until its path is deliberately
added to that command. Files ending in `.manual.md` are human checklists rather
than executable tests.

## Running

```bash
pnpm test:manual                                  # run all
pnpm exec tap -j1 test/manual/chat-queue-real.doctest.md     # one file
```

The weekly run is one of the repo's schedules — `bin/schedules install` (once
per machine, from the main checkout) registers the one launchd tick that drives
every schedule, and `bin/schedules run manual-tests --force` runs this one by
hand. Cadence lives in `schedules/manual-tests/schedule.yaml`; logs live in the
schedule store outside the checkout (`bin/schedules logs manual-tests`).

A green run starts nothing. A failing one hands the output to a constrained
Sonnet agent, in the schedule's own worktree, which diagnoses the cause and
creates or appends to the best matching open issue. It can edit only open issue
Markdown files and cannot edit code, commit, push, close issues, or read private
issues. The schedule's `check` verifies every claimed edit is an append to a
real open issue and commits exactly those paths on the worktree's branch — it
never pushes. Each run makes one Sonnet triage call capped at $2, beyond any API
use in the tests, and reports through `bin/schedules alert`.

Each executable manual test should:

- Document at the top *what it's diagnosing* and *why it can't be automated*
- Be deterministic in its assertions (booleans, counts) — `print()` raw
  agent output for the human reader, but assert on shape, not content
- Bound runtime with timeouts so a wedged test fails instead of hanging
- Clean up its own tmp boxes / processes
- Be added explicitly to `test:manual` in `package.json`, with its unattended
  runtime and external-service cost documented at the top of the test

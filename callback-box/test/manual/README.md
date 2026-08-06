# Manual tests

Executable doctests in this directory are **excluded from `pnpm test`**. They
run real processes, make network calls, or deliberately wait on wall-clock
deadlines that are too slow or expensive for every normal run.

The explicit `test:manual` allowlist runs automatically once a week through
`bin/manual-tests-scheduled.sh`. Adding a test to this directory does not spend
API credit unattended until its path is deliberately added to that command.
Files ending in `.manual.md` are human checklists rather than executable tests.
The weekly runner first exercises its own fake-command integration test, which
is excluded from every default suite too.

## Running

```bash
pnpm test:manual                                  # run all
pnpm exec tap -j1 test/manual/chat-queue-real.doctest.md     # one file
```

Install the weekly macOS job from the main checkout:

```bash
bin/manual-tests-scheduled.sh --install
```

It runs Sunday at 11:17 local time. Each run gets a gitignored log under the
main checkout's `logs/manual-tests/`, and `latest.log` points to the newest one.
A constrained Sonnet agent reads every result and relevant source. On failure,
it diagnoses the cause and creates or appends to the best matching open issue;
on success, it normally makes no change. It can edit only open issue Markdown
files and cannot run commands, edit code, commit, push, close issues, or access
private issues; private-issue tool paths are denied too. Its issue changes
remain uncommitted for human review. A per-run snapshot verifies that existing
issues were append-only and provides a recovery copy if validation fails. Each
scheduled run makes one Sonnet triage call capped at $2, beyond any API use in
the tests. Failures and issue changes raise a notification that points to the
issue and exact run log.

Each executable manual test should:

- Document at the top *what it's diagnosing* and *why it can't be automated*
- Be deterministic in its assertions (booleans, counts) — `print()` raw
  agent output for the human reader, but assert on shape, not content
- Bound runtime with timeouts so a wedged test fails instead of hanging
- Clean up its own tmp boxes / processes
- Be added explicitly to `test:manual` in `package.json`, with its unattended
  runtime and external-service cost documented at the top of the test

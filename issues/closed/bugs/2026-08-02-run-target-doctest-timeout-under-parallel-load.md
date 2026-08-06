---
title: "run-target doctest times out under parallel suite runs"
area: scan-uploader
filed-by: agent
discovered-in: worktree-scanner-ingest — /finish full-suite run
resolution: implemented
---

Resolved by `f4aaba04`. The test now completes its simulated file mutation
before the fake server answers the check request.

`test/run-target.doctest.md` failed with `not ok 9 - timeout!` (`expired:
test/run-target.doctest.md`) in a full `pnpm test` run of `scan-uploader/`
(`{ total: 172, pass: 169, fail: 3 }`), but passed cleanly (16/16, ~440ms) run
in isolation (`npx tap test/run-target.doctest.md`). Shape matches the
tracked-flake pattern documented for callback-box's suite: a real-clock
doctest (this one spins up a real HTTP fake-scan-server and runs several
`runTarget` subtests with `setTimeout`/`sleep`-based polling) that's fine
alone but starves for CPU time under the full suite's parallel job count.

Not investigated further — the worktree that hit this (`worktree-scanner-ingest`)
touched neither `run-target.doctest.md` nor `src/run-target.ts`; it touched
`test/fake-scan-server.ts` (added an optional `checkFailure` handler + a new
`PutOutcome` status variant), but only additively, and `run-target.doctest.md`
doesn't exercise either addition. The initial triage treated this as
suite-contention noise per the tracked-flake protocol in
`.claude/agents/finish.md`.

## Investigation (2026-08-06)

The timeout was secondary to a fixture race, not only CPU contention. The
"file changes between hash and disposition" scenario called asynchronous
`writeFile()` from the synchronous `checkState` callback and discarded its
promise. The fake server answered the check while the write could still be
truncating and replacing the upload source. Under load, the following PUT
failed with `UND_ERR_SOCKET`. The rejected test skipped `serverE.close()`, so
the open fake server then kept the doctest alive until TAP's 30-second
watchdog expired.

The unmodified test failed in 3 of 3 repeated full-suite runs during parallel
machine load. Each run first failed in the file-change scenario and then
reported the leaked-handle timeout. An isolated run passed 16 of 16 assertions.

The fix uses `writeFileSync()` in that callback. This preserves the intended
ordering: hash the original file, replace it while processing the check, then
upload and detect the changed identity before disposition. After the fix:

- The doctest passed 16 of 16 assertions in isolation.
- Twenty full `scan-uploader` suites passed in five waves of four concurrent
  suites. The failure rate was 0 of 20 under deliberate parallel load.

A larger timeout would not fix the failed PUT or the leaked cleanup path, so
the TAP timeout remains unchanged.

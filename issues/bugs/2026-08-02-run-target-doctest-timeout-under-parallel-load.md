---
title: "run-target doctest times out under parallel suite runs"
area: scan-uploader
filed-by: agent
discovered-in: worktree-scanner-ingest — /finish full-suite run
---

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
doesn't exercise either addition. Treating this as suite-contention noise for
now per the tracked-flake protocol in `.claude/agents/finish.md`.

---
title: Field-test run setup failure between server start and the try/finally leaks resources and writes no report
filed-by: agent
discovered-in: worktree integration-tests — implementing Track 5 (reporting) of docs/plans/agent-field-tests.md, cross-model review
labels: [field-test-findings, harness]
---

`runFieldScenario` (`callback-box/src/field-test/run.ts`) starts the dedicated
server, writes the operator's system prompt, and calls `startOperatorSession()`
— all *before* the `try { ... } finally { ... }` block that owns teardown and
now (as of Track 5) writes `results.json` + `report.md`. If `startOperatorSession`
(or anything else in that stretch) throws, the run exits without stopping the
server, without closing the browse session, and without any `results.json` or
`report.md` — even though a real box, a real server process, and a run
directory already exist on disk.

The module docstring documents this as deliberate: *"Throws only for a failure
that prevents a run existing at all (an invalid scenario, no browse key, a
server that will not start)."* That framing is arguably wrong for the operator
session specifically — the server and box already exist by that point, so an
operator-session failure is a real teardown gap, not a "run never existed"
case.

Flagged by a Codex cross-model review of the Track 5 report-writer change;
out of scope there since Track 5's brief was "don't modify the loop's
behavior beyond adding the report call."

Possible direction: move `result` construction earlier (right after
`prepareRun`), and wrap the operator-session startup + system-prompt write in
the same `try/finally` so a failure there still stops the server, closes the
browse session, and writes a `results.json`/`report.md` recording the abort.

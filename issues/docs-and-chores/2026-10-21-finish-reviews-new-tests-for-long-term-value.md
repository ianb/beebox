---
title: "Finish has no step that decides which of a branch's new tests to keep"
workstream: unattached
needs: [design]
area: testing
labels: [tests, finish]
filed-by: agent
discovered-by: Ian
discovered-in: main — boxholder request to add test analysis to finish (2026-10-21)
---

Agents write tests while they implement. Many of these tests help during the
work: they pin a bug before the fix, check an edge case, or give fast feedback
on a refactor. Not all of them have value after the branch lands. At present
every test a branch adds lands on `main`. No step looks at the new tests as a
set and asks which to keep.

The periodic sweep in
[2026-10-08-remove-tests-that-never-earn-their-keep](../code-quality/2026-10-08-remove-tests-that-never-earn-their-keep.md)
and [2026-10-08-test-volume-sweep](../code-quality/2026-10-08-test-volume-sweep.md)
removes low-value tests after they land, across the whole suite. This issue is
the per-branch gate: review the tests that the branch adds or changes, at
`/finish`, before merge. The sweep's agreed criteria (restates the code, second
proof of one claim, tests the framework) and its keep list (trust and privacy
boundaries, migrations, external input, cross-system contracts) are a starting
point. They were written for old tests with failure history. New tests have no
failure history, so the criteria need adjustment.

## Boxholder decisions (2026-10-21)

- The analysis runs headless and decides. It never returns BLOCKED.
- It needs discernment, so it runs on a most-capable model, not a small one.
- It has two steps: an enumeration of every in-scope test, then an analysis
  of each.
- The evidence goes in git history, not the repository head. The removals land
  as one dedicated commit; its message records each test considered and its
  disposition with the reason.

## What the design must specify

- **Analysis procedure.** Which tests are in scope (added files, added
  examples in existing files, edited expected values). What the analyzer
  reads: the diff, the code under test, the plan, sibling tests.
- **Criteria.** What makes a new test worth keeping on `main`. Candidates:
  it guards a branch or rule that a later change can plausibly break; it pins a
  bug that occurred; it states a contract another system depends on. What makes
  it scaffolding: it only re-proves straight-line code, it duplicates another
  example, it checks an intermediate step that the final behavior already
  covers, it would pass with the code deleted.
- **Disposition.** Remove, merge into an existing example, or keep. The
  commit message format for the dedicated commit, including kept tests, so
  `git log` can answer "why is this test gone" and "was this test reviewed".
- **Where it runs.** The finish agent
  ([.claude/agents/finish.md](../../.claude/agents/finish.md)) runs on its own
  model. The design must say whether the analysis is a step in that agent or a
  separate worker it spawns on a most-capable model, and how it fits with the
  cross-model diff review (Track O).
- **Enumeration.** A script can list the in-scope tests from the diff, so the
  model step starts from a complete list and cannot skip one.
- **Verification after removal.** Removing a test changes the branch after
  `bin/finish-verify` ran. The design must say whether removal invalidates the
  pass, and which checks rerun.

## Tension

A test that looks like scaffolding can be the only guard on a rule. The
[expected-value rule](../closed/docs-and-chores/2026-10-11-tests-state-why-each-expected-value-is-right.md)
asks each example to state why its value is right; that prose is input for the
analysis, but it is not a keep signal by itself. A strict analyzer removes real
guards; a lax one is a rubber stamp. Because the step decides without a
human, the criteria carry all the weight. A sample of real branches, with the
boxholder's keep/remove call on each test, would calibrate them before the step
goes live. The dedicated commit makes a wrong removal easy to find and revert.

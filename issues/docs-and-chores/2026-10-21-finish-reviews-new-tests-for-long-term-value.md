---
title: "Finish has no step that decides which of a branch's new tests to keep"
workstream: test-value-research
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
- The developing session runs the analysis, as a first step of the `/finish`
  skill before it dispatches the finish agent. That session knows the intent of
  each test, and that knowledge is a legitimate input. The dedicated commit then
  exists before `bin/finish-verify` runs, so verification covers it and nothing
  reruns.
- The finish agent's pinned model (`model: sonnet` in
  [.claude/agents/finish.md](../../.claude/agents/finish.md), and "Do not run
  it on the session's own model" in the skill) is probably unnecessary. The
  skill can instruct the session to use a subagent for the merge churn without
  forcing a model.

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
- **Track O.** How the analysis relates to the cross-model diff review, which
  later sees the branch with the removals applied.
- **Enumeration.** A script can list the in-scope tests from the diff, so the
  model step starts from a complete list and cannot skip one.
- **Prior verification.** The developing session may have run checks before
  the removal commit. The finish agent must treat that commit as a change
  since the tested revision.

## Tension

A test that looks like scaffolding can be the only guard on a rule. The
[expected-value rule](../closed/docs-and-chores/2026-10-11-tests-state-why-each-expected-value-is-right.md)
asks each example to state why its value is right; that prose is input for the
analysis, but it is not a keep signal by itself. A strict analyzer removes real
guards; a lax one is a rubber stamp. Because the step decides without a
human, the criteria carry all the weight. A sample of real branches, with the
boxholder's keep/remove call on each test, would calibrate them before the step
goes live. The dedicated commit makes a wrong removal easy to find and revert.

## Research (2026-10-23)

[research/test-value/README.md](../../research/test-value/README.md) grounds
the criteria in the suite's own history: 959 full runs and 1,401 selected
runs from the ledger, every red-main and flake issue classified by cause, git
history for all 1,332 test files, and 54 files read. Main findings: the
hourly suite caught three product regressions in 54 days against nine stale
snapshots of generated sets; most failures and most catches happen in
selected runs during development; bug replays and boundary tables have the
best comments and the clearest value; the weak and restating examples are
about 6% and 4 to 11% of checks. The note proposes keep (K1 to K4), rewrite
or merge (M1 to M4) and remove (X1 to X3) criteria, says which signals a
script can produce and which need the author's knowledge, and applies them
by hand to three recent landings. The snapshot-of-a-generated-set criterion
(M1) is new; the earlier C3 and C5 are refuted.

## Application (2026-10-23)

The criteria were applied to 60 existing files with a per-disposition
ledger, the shape the one-commit disposition record in this issue asks
for: [research/test-value/application/](../../research/test-value/application/README.md).
Each ledger row is file, lines, checks, flags, code, whether the flag was
right, action, confidence, and a one-sentence reason. The revised criteria
and the measured accuracy of each mechanical flag are in README sections 4
and 5 of the research note.

## Design (2026-10-23): a light review, drawn from the research

What the research supports, and so what the step does and does not do:

- The in-scope set per branch is small (one test on two of the three
  branches sampled; 24 files on the largest), and reading cost measured at
  about one minute per file. The step is a short read in the developing
  session, not a second review track.
- The value of a new test is paid during development; what it costs on
  `main` is almost entirely the stale snapshot of a generated set (M1) and
  the flaky timer. Those two are what the step must catch. Removal yield is
  about 4% of checks and is mostly catalogs restated as expected values
  (X1); the rest is rewriting lossy projections to whole values (M4).
- The mechanical flags are right about files and wrong about checks, so
  the script lists and the session judges; the script never decides.
- X2 and X3 did not occur in 1,338 checks; the step does not look for them.

### Procedure

Step 0 of `/finish`, in the developing session, before the finish agent is
dispatched. Skipped, and said so, when the diff against `main` adds or
changes no test file.

1. Run `bin/test-review` (task 1). It prints every in-scope unit from
   `git diff main...HEAD`: added test files, added `test()` blocks in
   existing files, and `t.check` calls whose expected value changed. Each
   line carries its flags and the file's ledger time if it has one.
2. Give each unit one code, using what the session knows about why the
   test was written: K1 bug replay, K2 boundary, K3 contract, K4 branch
   guard, OK plain guard; M1 generated set, M2 pinned wording that is a
   choice, M3 second proof, M4 lossy projection; X1 restates code or a
   catalog. The codes and their one-line definitions are in
   `research/test-value/README.md` section 4 and its revisions.
3. Edit M and X units: narrow the snapshot to the rows the claim needs,
   pin wording only where it is the feature, delete the copy outside the
   claim's home, rewrite a projection to the whole value, delete the
   restated row. Leave a unit alone when unsure and code it OK with a
   note. A K1 unit the session did not watch fail is coded K1? and the
   note says so.
4. Commit the edits as one commit, `Tests: review before finish`, whose
   body lists every unit, kept ones included, one line each:
   `<path>#<test title or line> — <code> <action>: <reason>`. A branch with
   no edits still gets the commit if it added tests, so `git log` answers
   "was this test reviewed".
5. Dispatch the finish agent as now. The commit is a test change since any
   earlier tested revision, so step 3 of the agent reruns the named files;
   Track O sees the branch with the edits applied.

### Tasks

1. `bin/test-review.ts` (with a tap test): enumerate in-scope units from
   the diff and flag them. Port the parts of
   `research/test-value/scripts/enumerate.py` the application pass found
   useful and drop the rest: flag a lossy left-hand projection
   (`.success`, `.ok`, `.pass`, `.length`, `.code`, `.status`,
   `.includes(`, `.matches(`, `some(`, a `join` or template of fields);
   an expected literal that also appears in `src/` as a constant or an
   exported list (restated catalog); an expected literal identical to one
   in another test file, with the file named; a real timer, `Date.now()`
   without a fixed clock, or a `Promise.race` against a delay; the file's
   median ledger seconds. Do not flag length or zod vocabulary; both were
   wrong four times in five.
2. `.claude/skills/finish/SKILL.md`: add step 0 as written above, before
   the dispatch, and drop the pinned-model sentence per the 2026-10-21
   decision. Keep it to the five numbered lines plus the skip rule.
3. `.claude/agents/finish.md`: step 3 names the review commit as a test
   change since the tested revision; step 8 adds one report line, `tests
   reviewed: n kept, n rewritten, n removed`, or `no tests added`.
4. Calibration: for the first five finishes that run the step, the
   boxholder reads the review commit and marks any disposition they would
   reverse in a dated note here. Adjust the codes or the flags from that,
   then close this issue.

Not in this design: running new tests against `main`'s source to prove a
K1 claim fails first (strongest signal, but a second test run per finish;
revisit if K1? notes pile up), and the recurring suite-wide sweep, which
stays with
[2026-10-08-remove-tests-that-never-earn-their-keep](../code-quality/2026-10-08-remove-tests-that-never-earn-their-keep.md)
and should rank whole files by flag density rather than list checks.

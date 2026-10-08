---
title: "Tests grow faster than code; a sweep for examples that prove nothing distinct"
workstream: test-cleanup
area: beebox
labels: [tests, code-quality]
filed-by: agent
discovered-by: Ian
discovered-in: skills-review — "we write too many tests" (2026-10-08)
---

Numbers on 2026-10-08: 307,625 src lines, 144,891 test lines (0.47); over
the last 90 days 0.53 test lines added per src line; 795 doctest files,
10,302 examples. The chat router has 9 doctest files, markdoc-config 8;
the largest files are connector tests at 1,800 and 800 lines.

Failure data from 855 hourly full-suite runs (2026-08-25 to 2026-10-08):
240 runs failed, 135 of them on one file; 353 files ever failed, 304 only
in mass red-main episodes; 49 files have failed on their own, led by known
flakes (`file-watcher` 89 isolated runs, `annotations` 33,
`release-manifest` 28, `hub-e2e` 17). About 440 files have never failed.

Policy changed the same day (`docs/testing.md`, cross-model skill): no test
mandated by kind of change; an example that would pass with its code
deleted is a defect; reviewers name the claim, not "add tests".

Duplicates emerge on their own, so this is a sweep, not a rule: a schedule
in the knip-sweep shape that reports, per doctest file, examples whose
assertion restates the code's literal return, examples proving one claim
twice with different literals, and files past 500 lines, with a proposed
deletion branch judged on what it removes. Never-failed status is context
for the sweep, not a deletion criterion: a never-failed test on code that
changed is doing its job; one on code that never changed is cheap to keep.
The isolated-failure list is the opposite signal: those are the tests that
earn their keep or the flakes to fix.

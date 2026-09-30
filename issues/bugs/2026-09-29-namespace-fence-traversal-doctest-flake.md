---
title: "routers.namespace-fence-traversal doctest fails intermittently: its setup overwrites package.json under a background scan"
workstream: unattached
area: beebox
labels: [flake, doctest]
filed-by: agent
discovered-by: agent
discovered-in: worktree-doctest-usability — full-suite run against the doctest prototype
---

`beebox/test/webapp/trpc/routers.namespace-fence-traversal.doctest.md` fails in
about 1 of 3 solo runs, on the current runner and on a modified one alike
(2026-09-28: 2 of 6 and 3 of 7). It reports 3 failures: the first test, `test
assertion after Promise resolution`, and `error thrown while awaiting Promise`.

The setup block writes `{"name":"secret-marker"}` over the test box's
`package.json` (line 59) as the traversal target. A startup scan-promote pass
runs in the background and reads that file. It then fails with
`MissingBeeBoxDependencyError: … package.json doesn't declare a "beebox"
dependency`, and an error is thrown in teardown. After that, assertions from
the next examples run after the test has ended (line 98).

The test is the cause, not the fence code: the traversal target could be a
different file outside the namespace, or the background pass could be stopped
or awaited before the file is replaced.

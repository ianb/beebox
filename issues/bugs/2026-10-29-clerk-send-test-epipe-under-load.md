---
title: "clerk.send test fails with write EPIPE under the change-selected run"
workstream: unattached
area: beebox
labels: [flaky-test]
filed-by: agent
discovered-by: agent
discovered-in: worktree-jev-triage-trial — change-selected test run for triage work
---

`beebox/test/webapp/trpc/routers/clerk.send.test.ts` failed once during a full
`pnpm test:changed` run (2,320 tests) with `write EPIPE`. The failing subtest
is at line 129: "The card is written to content/incoming/ with its frozen
snapshot…". tap reported the subtest twice as `not ok` and `test count(1) !=
plan(null)`. The same file then passed twice when run alone (`pnpm exec tap
test/webapp/trpc/routers/clerk.send.test.ts`, 12/12 each time). The branch that
ran it changes no Clerk code.

The probable cause is a child process or pipe closing early when the machine is
loaded. That is unverified; the run's output had no stack for the EPIPE.

To reproduce, run the file in a loop under parallel load, for example beside
`pnpm test:changed` in another worktree, and capture the stack.

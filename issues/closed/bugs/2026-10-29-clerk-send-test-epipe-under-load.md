---
title: "clerk.send test fails with write EPIPE under the change-selected run"
workstream: unattached
area: beebox
labels: [flaky-test]
resolution: implemented
filed-by: agent
discovered-by: agent
discovered-in: worktree-jev-triage-trial — change-selected test run for triage work
---

Fixed in the commit that adds `beebox/test/lib/git.with-input.test.ts`. The cause was in shared git code, not Clerk code.

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

## Cause

`gitWithInput` (`beebox/src/lib/git/internal.ts`) wrote the work list to git's
stdin with no `error` listener on that stream. When git exited before it read
all of its input, the write failed with EPIPE. The error was uncaught. In a
test, tap reported it against whichever test was running; in the box server,
it would crash the process. The send path reaches `gitWithInput` through
`stageablePaths` (`git check-ignore --stdin`, `git ls-files`).

A 4 MB input to `git --version` reproduces the uncaught `write EPIPE` every
time. Now an EPIPE on stdin is ignored and git's exit code and stderr decide
the result. The same missing listener was fixed in `batchCheck`
(`beebox/src/core/annex/staged-unlisted.ts`), the Codex history server and
the Claude sign-in code submit.

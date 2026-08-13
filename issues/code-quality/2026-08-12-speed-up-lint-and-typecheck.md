---
title: Speed up lint and typecheck in the finish workflow
workstream: unattached
area: tooling
filed-by: agent
discovered-by: Ian
discovered-in: worktree-workstreams — reviewing finish latency
---

The finish workflow spends too much time on lint and typecheck. A measured finish run on 2026-08-12 took about 3 minutes 26 seconds. Lint and typecheck used about 81 seconds, or 39% of the total.

| Step | Time |
|---|---:|
| Root typecheck, workspace lint, and shell check | about 31.6 seconds |
| Callback-box typecheck and lint | about 49.1 seconds |

The measurement did not separate every command. The first task is to record each command independently. Check whether the finish workflow repeats callback-box lint or typecheck after the recursive root commands already ran them. Also check whether commit hooks repeat the same work before finish starts.

Do not remove a verification gate based only on similar command names. Confirm whether the commands use the same configuration, inputs, and environment. Preserve equivalent coverage when removing duplication or adding incremental execution.

Useful outcomes include:

- one timing record per lint and typecheck command;
- a map of duplicated checks across pre-commit and finish;
- removal of proven duplicate work;
- safe caching or changed-package scoping where it preserves the current gate;
- a before-and-after finish benchmark on a quiet machine.

The issue is complete when the workflow keeps the same verification contract and materially reduces the lint/typecheck wall time.

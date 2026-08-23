---
title: "Concurrent workstream launches race in git worktree add"
workstream: streams-and-issues
area: router
needs: [design]
labels: [workstreams, lifecycle, concurrency]
filed-by: agent
discovered-by: agent
discovered-in: main clerical session — launching several routed workstreams
---

Launching several `bin/launch-worktree-session` commands concurrently can make
their `git worktree add` operations collide. Some launches then fail after a
Terminal tab has opened, leaving that session in an invalid working directory.

`bin/lib/worktree-create.sh` checks whether the worktree or branch already
exists and then runs `git worktree add`, but the check and mutation are not a
serialized critical section. The user-facing skill currently needs to say
“launch one at a time” even though the independent work appears parallelizable.

A likely fix is a repository-scoped lock around only the check plus `git
worktree add`, with state re-checked after lock acquisition. Installs and agent
launches should remain outside it. This needs a concurrent creation test before
the workflow guidance permits parallel launching.

Related but distinct: [the pre-agent liveness gap](2026-08-20-workstream-launch-liveness-gap.md).

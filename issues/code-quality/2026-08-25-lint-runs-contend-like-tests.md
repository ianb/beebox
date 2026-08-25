---
title: "Concurrent lint/typecheck runs thrash the machine the same way tests did"
workstream: unattached
area: monorepo
labels: [developer-experience, tooling]
---

Observed 2026-08-25 while two agents worked one worktree: six concurrent
`callback-box` eslint runs (agents re-running `pnpm lint` after each edit)
plus two in a sibling worktree, each at 29–51 min elapsed against a solo
time of about a minute. Same pathology the test-run semaphore
(`bin/test-locks.ts`, plan `change-based-test-selection.md` mechanism A)
was built for; lint and typecheck have no such lock.

Options: put `pnpm lint` / `pnpm typecheck` behind the same machine-wide
semaphore (the lock is generic — tier "ordinary"); or teach agents to lint
only changed files (`eslint <paths>`) during iteration, which is the same
"run what the change implicates" move as `test:changed`. Both may be right.

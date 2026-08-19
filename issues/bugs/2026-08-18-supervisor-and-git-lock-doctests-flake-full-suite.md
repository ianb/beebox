---
title: "supervisor.doctest.md and git-lock.doctest.md flake under the full parallel suite"
workstream: low-priority-jobs
area: callback-box
filed-by: agent
discovered-in: worktree-low-priority-jobs — /finish full-suite run
labels: [flake]
---

`pnpm test` reported `# { total: 7346, pass: 7343, fail: 3 }` with two failing
files:

- `test/hub/supervisor.doctest.md` (`supervisor.doctest.md:48` — `check
  failed` inside the block starting `const sourceEnv = {`)
- `test/lib/git-lock.doctest.md` (`git-lock.doctest.md:117` — `check failed`
  inside the block starting `const box = await makeTmpBox({ git: true })`)

Both passed cleanly when re-run in isolation immediately after
(`pnpm exec tap 'test/hub/supervisor.doctest.md' 'test/lib/git-lock.doctest.md'`
→ `# { total: 58, pass: 58 }`), and neither file nor the code it exercises
(`src/hub/`, git-lock helpers) was touched by the branch that surfaced this —
so it reads as contention under the full parallel run, not a real regression.

Not yet reproduced a second time to characterize the failure mode further;
filing on the strength of the one full-suite occurrence plus the clean
isolated re-run, per the tracked-flake protocol.

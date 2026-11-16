---
title: "A frontend test run from src/frontend fails without saying to run from beebox/"
workstream: unattached
area: beebox
filed-by: agent
discovered-in: worktree-retrospective — retrospective 20261116-005159
---

Running one frontend test with `tap` from `beebox/src/frontend` fails with a
tsconfig `rootDir` or tap-check module-resolution error. It works from
`beebox/` with the `src/frontend/test/...` path, as `beebox/AGENTS.md` and
`docs/testing/check.md` already say. Sessions still try the frontend
directory first and spend a round on it. More docs have not stopped this.

The fix is in the failure path: when the test loader runs with a cwd under
`src/frontend`, fail at once with "run from beebox/: pnpm exec tap
src/frontend/test/<file>".

Evidence: `composition-editor/20261116T002405Z-implemented.md`,
`direct-chat-load/20261113T154607Z-plan-reviewed.md`, and four earlier
entries (retrospective watch item `frontend-tests-run-from-beebox`).

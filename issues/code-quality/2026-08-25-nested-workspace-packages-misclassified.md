---
title: "finish-preflight assigns a nested workspace package's changes to its parent"
workstream: test-economics
area: monorepo
labels: [tooling, developer-experience]
discovered-in: worktree-test-economics
---

`groupOf` (`bin/finish-preflight-lib.ts`) classifies a path by its FIRST path
segment, so `callback-box/pub-worker/src/x.ts` is attributed to package
`callback-box` — but `pnpm-workspace.yaml` makes `callback-box/pub-worker` its
own package with its own `test`, `typecheck` and `lint`. A pub-worker-only
change therefore gets callback-box's verification and none of pub-worker's:
`pnpm --dir callback-box test:changed` and `typecheck` never look at it, and
`pnpm lint:changed` drops it too (it is outside callback-box's lint roots).

Predates the changed-file lint work — the old `pnpm --dir callback-box lint`
missed it identically — and `browse/packages/agent-browser-typed` is the same
shape (though it has no scripts of its own today). The fix is longest-prefix
workspace ownership in `groupOf`, matching what `packageOf`
(`bin/lint-changed.ts`) already does; `workspacePackages` would have to become
the full directory list rather than top-level names.

Found by a cross-model review of
[the lint economics work](../closed/code-quality/2026-08-25-lint-runs-contend-like-tests.md).

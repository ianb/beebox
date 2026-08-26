---
title: "finish-preflight assigns a nested workspace package's changes to its parent"
workstream: test-economics
area: monorepo
labels: [tooling, developer-experience]
discovered-in: worktree-test-economics
resolution: implemented
---

**Closed 2026-08-25 — fixed.** `bin/workspace-packages.ts` is now the one
source of the package list for both tools: it expands the `pnpm-workspace.yaml`
globs, keeps a match only when it holds a `package.json` with a
`test`/`typecheck`/`lint` script of its own, and drops `callback-box/src/frontend`
(callback-box runs its checks). `groupOf` matches the nearest enclosing package
in that list, so `callback-box/pub-worker/src/x.ts` yields pub-worker's own three
commands while `callback-box/src/x.ts` still yields callback-box's.

`browse/packages/agent-browser-typed` moved the other way, deliberately: it has
no scripts, so it is not in the list, and a change under it is attributed to
`browse`, whose whole-tree `tsc --noEmit` and `eslint .` actually check it.
Nearest-package attribution alone would have run nothing for it — in
`lint-changed` that hole already existed.

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
[the lint economics work](2026-08-25-lint-runs-contend-like-tests.md).

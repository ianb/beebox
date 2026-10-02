---
title: "Drop the typescript-eslint patch once the no-misused-promises top-level return fix ships"
workstream: unattached
area: vibe-check
labels: [file-layout]
filed-by: agent
discovered-by: agent
discovered-in: worktree-file-layout — folding beebox/user-stories into src/ for the layout moves
---

`patches/@typescript-eslint+eslint-plugin+8.59.4.patch` carries an upstream
fix to `no-misused-promises`. Without it the rule crashes ESLint
("Non-null Assertion Failed: Expected node to have a parent") on a
`ReturnStatement` with no enclosing function. The workflow scripts in
`beebox/src/scripts/user-stories/*.workflow.ts` end in such a top-level
`return`, which their runtime requires. They reached type-aware linting for
the first time when the layout moves folded `user-stories/` into `src/`.

Upstream: typescript-eslint issue #12911, fixed by pull request #12912, merged
2026-09-22. On 2026-09-27 the fix was only in a canary release, which the
repo's `minimumReleaseAge` gate refuses.

When a stable `@typescript-eslint/eslint-plugin` release contains the fix and
passes the release-age gate, bump the dependency and delete the patch. Then
run the following from `beebox/` and confirm the command exits 0:

```bash
npx eslint src/scripts/user-stories/*.workflow.ts
```

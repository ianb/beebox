---
title: "Running tap from the monorepo root creates an untracked .tap/ that trips path-leak-check"
workstream: deploy-separation
area: repo
filed-by: agent
discovered-in: worktree-deploy-separation — ran a beebox doctest from the wrong cwd
---

`beebox/.gitignore` ignores `.tap/`, but the monorepo root's does not. So
running a doctest from the repo root rather than from `beebox/` —

```bash
pnpm exec tap -j1 beebox/test/<something>.doctest.md    # from the root
```

— leaves a `.tap/` directory at the root that git sees. The next `git add -A`
stages it, and `path-leak-check` then fails the commit, because tap's
`processinfo` JSON records absolute paths under the developer's home:

```
path-leak-check failed:
  home path leak: .tap/processinfo/<uuid>.json:4 -> /Users/<name>/
  … (dozens of lines)
```

Two things make this worse than a stray directory:

- **The wrong cwd also makes the test itself fail**, so the first signal is a
  red doctest, which sends you looking for a bug in the test rather than at
  where you ran it.
- **The guard that catches it fires at commit time**, well after the mistake,
  and its output is a wall of leak lines that says nothing about `.tap` being
  the cause.

Fix direction, smallest first: add `.tap/` to the root `.gitignore` (it is
build litter wherever it appears, and the root is not a tap project). Optionally
also have the root `package.json` refuse or redirect a bare `tap` invocation,
since running the beebox suite from the root is never the intended path —
`pnpm --dir beebox exec tap …` is.

Filed while landing an unrelated change; not blocking anything.

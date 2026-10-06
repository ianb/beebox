---
title: "bin/lint-script-coverage.test.ts fails: beebox lint:backend dropped scripts/ and user-stories/"
workstream: unattached
discovered-by: agent
filed-by: agent
discovered-in: worktree-file-layout — while wiring up test running for browse's doctests
area: beebox
resolution: implemented
---

Fixed on `worktree-file-layout` in the same commit that closes this item: the
fold of `beebox/scripts/` and `beebox/user-stories/` into `src/` caused it, so
it was the layout work's own regression, not a pre-existing failure.
`BACKEND_ROOTS` is now `src`, `test`; the frontend roots gained `test/` for the
frontend package's new test root; both guard tests were updated.

Root `pnpm test` fails on a clean checkout at the tip of `worktree-file-layout`
(commit `d5f271f0e`, after the "Layout moves" series). `bin/lint-script-coverage.test.ts`
asserts that `bin/lint-changed.ts`'s `BACKEND_ROOTS`-derived eslint invocation
matches `beebox/package.json`'s `lint:backend` script exactly, including
`scripts/` and `user-stories/`:

```
+ 'eslint --cache --cache-strategy content --cache-location node_modules/.cache/eslint/backend src/ test/'
- 'eslint --cache --cache-strategy content --cache-location node_modules/.cache/eslint/backend src/ scripts/ test/ user-stories/'
```

`beebox/package.json`'s actual `lint:backend` is now
`eslint --cache --cache-strategy content --cache-location node_modules/.cache/eslint/backend src/ test/`
— `scripts/` and `user-stories/` are gone from the script, but
`bin/lint-changed.ts`'s `BACKEND_ROOTS` constant still lists them.

Not touched by the current work (adding a `test` script to `browse/`); found
while running root `pnpm test` to verify nothing else broke. Whoever moved
`beebox/scripts` and `beebox/user-stories` (or removed them from the lint
script) during the layout work should reconcile `BACKEND_ROOTS` with wherever
those directories live now, or restore them to `lint:backend` if they still
exist under `beebox/`.

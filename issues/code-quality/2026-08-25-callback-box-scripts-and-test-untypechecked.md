---
title: "callback-box lints `scripts/` and `test/` but never type-checks them"
workstream: unattached
area: callback-box
labels: [typescript, tooling]
filed-by: agent
discovered-by: agent
discovered-in: mjs-to-typescript worktree — adding `scripts/build-cli.ts` to a tsconfig
---

`callback-box/package.json` lints four trees:

```
"lint:backend": "eslint src/ scripts/ test/ user-stories/"
```

but `tsconfig.json` includes only `src/**/*`. `user-stories/` got its own program
in August 2026 (`tsconfig.user-stories.json`, filed after a `tsc` run over that
directory turned out to be the first one ever — ~1,400 unchecked lines). The same
hole is still open for the other two:

- `scripts/` — 14 `.ts` files plus shell scripts. Only `scripts/build-cli.ts` is
  type-checked, via `tsconfig.tooling.json`, because the `.mjs` sweep added it.
- `test/` — the tap suites and `.doctest.md` fixtures' companion `.ts`.

The blocker is the same one `tsconfig.user-stories.json` works around: the main
backend tsconfig sets `rootDir: "src"` and `outDir: "dist"` because `pnpm build`
emits from it, so anything at the package root trips TS6059. The fix is to widen
`tsconfig.tooling.json`'s `include` to `scripts/**/*.ts` and `test/**/*.ts` — and
then fix whatever a first-ever type-check turns up, which is the actual work and
the reason this is filed rather than done inline.

agent-doctest had the identical shape and was fixed instead of worked around
during the `.mjs` sweep: it turned out never to emit either (no `build` script,
and its `exports` map ships `.ts` sources), so its tsconfig became `noEmit` and
the whole package now type-checks under one program. callback-box genuinely does
emit from `pnpm build`, so the same shortcut is not available here.

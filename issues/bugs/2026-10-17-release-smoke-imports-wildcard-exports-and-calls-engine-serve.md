---
title: "`pnpm smoke` fails: it imports wildcard export keys literally and calls `bbx engine serve`"
workstream: unattached
area: beebox
labels: [tests, release]
filed-by: agent
discovered-by: agent
discovered-in: worktree-ts7 — running the release smoke to verify the TypeScript 7 move
---

`pnpm smoke` (`beebox/src/scripts/smoke-external-box.ts`, the release gate
that installs the `pnpm release` tarball into a fresh external box) fails on
a clean tree for two reasons unrelated to the change under test:

1. **Wildcard exports.** `publicExportSpecifiers` turns every key of the
   package `exports` map into an import. The `./plugins/*` and
   `./plugins/*/view` keys (added with plugins in `06f886eba`) become
   `import "beebox/plugins/*"`, which fails with `ERR_MODULE_NOT_FOUND` for
   `dist/plugins/*/plugin.js`. The step "import every public export" fails,
   and no later step runs.
2. **`bbx engine serve`.** The serve step runs `bbx engine serve`. `serve` is
   not under `engine` (`beebox/src/cli/entry/surface-data.ts:166` lists it as
   a top-level command with audience `engine`), so the CLI prints
   `unknown command 'serve'` and the step fails.

With item 1 skipped by a local edit (not committed), every other step
passed on 2026-10-17: scaffold, real install, box `tsc`, `bbx view typecheck`,
`bbx validate --all`, and the widget render.

Expanding `./plugins/*` to the plugins in `dist/plugins/` would test what a
box imports, rather than skipping the keys.

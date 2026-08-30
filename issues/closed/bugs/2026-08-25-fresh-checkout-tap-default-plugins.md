---
title: "A fresh checkout runs tap with its default plugins, so the frontend doctests fail as a block"
workstream: test-economics
area: beebox
labels: [testing, flake]
resolution: implemented
---

**Closed 2026-08-25 — fixed.** The monorepo root's `postinstall` runs `tap
build` after `patch-package`, so every workspace install builds the `.taprc`
plugin set: a fresh worktree, a detached full-suite checkout, and a deploy all
get it from one mechanism. It is at the root, not in `beebox`'s own
`postinstall`, because `beebox` is packed and installed as a tarball
dependency by v2 boxes — a `postinstall` there would run in a consumer install
that has no `tap` (a devDependency) and fail it. A `link:` dependency's
lifecycle scripts do not run, so the dev/deploy box installs were never
affected either way.

The first `schedules/full-suite` run (2026-08-25, detached worktree of `main`
at `77d8d07d`) failed 22 files — all of `test/frontend/*` — with
`ERR_UNSUPPORTED_DIR_IMPORT …/src/frontend/src/lib/trpc`. The tap subprocess
args in the run log include `--import=…/@tapjs/typescript/dist/esm/import.mjs`,
which `.taprc` disables (`plugin: - "!@tapjs/typescript"`). With the typescript
plugin's loader ahead of tsx, directory imports fail.

## Mechanism (2026-08-25)

Reproduced deterministically in a detached worktree of `main` after
`pnpm install --frozen-lockfile`: `pnpm exec tap
test/frontend/audio-playback-errors.doctest.md` failed with that error, and the
same command immediately after passed.

1. The configured plugin set only exists once it is **built**. `tap build`
   generates a Test class into `node_modules/@tapjs/test/test-built/`
   (`@tapjs/test/dist/esm/build.mjs`, `defaultTarget = scripts/../test-built`).
   The `@tapjs/test` main entry is `export * from '@tapjs/test/test-built'`, so
   the built directory *is* what the runner imports.
2. The published `@tapjs/test` tarball ships a `test-built` for the **default**
   plugin set, typescript included. So the built set after any install is the
   default one, whatever `.taprc` says. Every `pnpm install` re-links the
   package from the store, which is why this is not a one-time fresh-checkout
   state: a reinstall puts it back.
3. tap's auto-rebuild is **one run late**. `@tapjs/run/dist/esm/run.js` computes
   the child argv first (`const argv = testArgv(config)`), and `test-argv.js`
   takes `importLoaders`/`loaders` from the already-imported `@tapjs/test` at
   module load. Only afterwards, inside the suite callback, does it compare
   `t.pluginSignature !== config.pluginSignature` and `await build(...)`. The
   rebuild lands for the *next* run; this run's children already carry
   `--import=@tapjs/typescript/…`.
4. So every child of that run gets the typescript loader, and each file fails
   if and only if it reaches an extensionless directory import. Nothing about
   the failure is load-dependent.

`.tap/plugins/` is a side effect of the build (it holds only a `package.json`
pinning `@tapjs/core` by absolute `file://` path, so the directory is
per-checkout), not the built set. Its absence is a symptom of "never built
here", not the cause.

`tap plugin list` cannot detect any of this: `@tapjs/run/dist/esm/plugin.js`
implements it as `console.log(config.pluginList.join('\n'))` — the CONFIGURED
set. In the broken fresh checkout it printed the correct set while the run used
the wrong one. The BUILT set is what `tap versions` lists under `plugins:`
(it reads the `signature` export of the built class).
`schedules/full-suite/checkout.ts` now asserts on both and no longer builds.

---
title: "A fresh checkout runs tap with its default plugins, so the frontend doctests fail as a block"
workstream: test-economics
area: callback-box
labels: [testing, flake]
---

The first `schedules/full-suite` run (2026-08-25, detached worktree of `main`
at `77d8d07d`) failed 22 files — all of `test/frontend/*` — with
`ERR_UNSUPPORTED_DIR_IMPORT …/src/frontend/src/lib/trpc`. The tap subprocess
args in the run log include `--import=…/@tapjs/typescript/dist/esm/import.mjs`,
which `.taprc` disables (`plugin: - "!@tapjs/typescript"`). In an established
worktree `tap plugin list` shows no typescript plugin and `.tap/plugins/`
exists; `.tap/` is gitignored, so a fresh checkout has none, and tap's
"rebuild automatically when the plugin set differs" did not produce the
configured set. With the typescript plugin's loader ahead of tsx, directory
imports fail.

This is deterministic in a fresh checkout, and is very likely the mechanism
behind `issues/closed/bugs/2026-08-05-doctest-loader-tsx-resolution-flake-recurred.md`
(closed wontfix as load-induced): a freshly created worktree, before its first
`tap` run has built `.tap/`, is the same state.

Mitigation in place: `schedules/full-suite/checkout.ts` runs `tap build` after
install and refuses if `tap plugin list` still names `@tapjs/typescript`.
Open: why tap's auto-rebuild misses this (the `.tap/plugins/package.json`
records an absolute `file://` path to `@tapjs/core`, so it is per-checkout),
and whether `bin/lib/worktree-create.sh` should run `tap build` too.

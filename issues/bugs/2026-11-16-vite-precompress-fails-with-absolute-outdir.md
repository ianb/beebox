---
title: "Vite build with an absolute --outDir fails in the precompress plugin"
workstream: unattached
area: beebox
labels: [frontend, build]
filed-by: agent
discovered-by: agent
discovered-in: worktree-reload-after-deploy — verifying build determinism, 2026-11-16
---

The precompress plugin (`beebox/src/frontend/src/dev/precompress-plugin/plugin.ts`)
computes its output directory with `join(config.root, config.build.outDir)`.
When `vite build --outDir <absolute path>` is used, `join` appends the absolute
path to the root, so the directory does not exist and `writeBundle` fails with
ENOENT.

Fix: use `resolve(config.root, config.build.outDir)`, which returns an absolute
`outDir` unchanged. Add a test that builds into an absolute directory.

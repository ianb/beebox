---
title: "The dev router runs the hoisted Vite 8, not the Vite 5 that the frontend declares"
workstream: unattached
area: router
labels: [dev-router, vite]
filed-by: agent
discovered-by: agent
discovered-in: worktree-admin-structure — while debugging the stale-module Vite watcher bug
---

`beebox/src/frontend/package.json` declares `vite: ^5.4.0`, and
`beebox/src/frontend/node_modules/vite` is 5.4.21. The dev router starts
`<worktree>/node_modules/.bin/vite`
(`workstreams-app/src/router/router-generation.ts`, the `viteBin` line). With
the hoisted linker, that binary is Vite 8.0.16. Another workspace package
(vitest 4 / `@cloudflare/vitest-pool-workers`) pulls Vite 8 in. The worktree
log confirms it: `VITE v8.0.16 ready`.

Effects:

- `vite.config.ts` imports `defineConfig` and plugin types from Vite 5, but the
  config runs under Vite 8 (Rolldown, `oxc`).
- `@vitejs/plugin-react` 4.7 targets Vite 5. Each worktree start logs three
  deprecation warnings (`esbuild` option, `optimizeDeps.esbuildOptions`). This
  is unsolicited tool output.
- Dev (Vite 8) and `pnpm build` (whichever `vite` the frontend script resolves)
  can use different bundlers.

It is not clear which way to resolve it: start the frontend's own Vite from
the router, or move the frontend to Vite 8 and a matching plugin-react on
purpose.

---
title: "The release tarball fails an external box's typecheck: card-activity.ts imports a file the package does not ship"
workstream: bug-burndown-5
resolution: implemented
area: beebox
labels: [release]
filed-by: agent
discovered-in: worktree-perf-easy-wins — `pnpm release && pnpm smoke` while checking the code-split CLI
---

> **Closed 2026-10-27 (bug-burndown-5):** `ChatSendContextWithView`, the one
> use of `AttentionSnapshot` in `card-activity.ts`, moved to its consumer
> `src/webapp/chat-runtime.ts`, so the shipped file no longer imports the
> binding module. `pnpm release && pnpm smoke` passes every step, the box
> typecheck included. `test/scripts/release.manifest.test.ts` now checks that
> every relative import in a shipped `.ts` source is itself shipped.

`pnpm release && pnpm smoke` (2026-10-23, `main` at 07bb777e0 plus the
lazy-CLI branch) fails at the step "pnpm exec tsc (box tsconfig extends
beebox/tsconfig.base.json)":

```
node_modules/beebox/src/core/chat/card-activity.ts(33,40): error TS2307: Cannot find module '../../shared/chat-composer-binding.js' or its corresponding type declarations.
```

`beebox/package.json` `files` ships `src/core/chat/card-activity.ts`, and the
"Front door" commits (898a82147) added
`import type { AttentionSnapshot } from "../../shared/chat-composer-binding.js"`
to it. `src/shared/chat-composer-binding.ts` is not in `files`, and it imports
`./ref-path/core.js` in turn, so adding one file does not close the gap.

The smoke steps before the typecheck pass, including `bbx engine init` from
the tarball; the steps after it (validate, serve) did not run.

Options: move `AttentionSnapshot` (a type) into a file the package already
ships, or ship the import chain. Either way, the smoke's typecheck step is
the check.

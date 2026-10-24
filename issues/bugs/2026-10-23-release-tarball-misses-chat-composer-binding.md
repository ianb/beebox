---
title: "The release tarball fails an external box's typecheck: card-activity.ts imports a file the package does not ship"
workstream: unattached
area: beebox
labels: [release]
filed-by: agent
discovered-in: worktree-perf-easy-wins — `pnpm release && pnpm smoke` while checking the code-split CLI
---

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

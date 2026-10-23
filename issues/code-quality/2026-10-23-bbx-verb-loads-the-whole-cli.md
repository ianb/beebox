---
title: "Every bbx verb loads the whole CLI: about 490 ms before the verb runs"
workstream: unattached
needs: [design]
area: beebox
labels: [performance]
filed-by: agent
discovered-in: worktree-perf-easy-wins — measuring process start costs
---

`bbx --version` does no work, but it takes about 490 ms (median of 7,
`pnpm perf:cli-start`, load average about 26). Box agents run `bbx` verbs
many times per turn, and every box server start pays the same load before it
listens.

The cost is the load of `dist/cli.mjs`. `src/cli/entry/program.ts` builds every
command at startup, so each command module and each npm package it imports at
its top load for every verb. CPU profile of one `bbx --version` (2026-10-23,
after the node-apn and google-auth-library imports were made lazy), time
charged to each owner:

| Owner | ms |
| --- | --- |
| Node internals (module compile, file reads, source-map indexing) | 162 |
| native | 58 |
| zod (schema construction at import) | 47 |
| yaml | 31 |
| @anthropic-ai/claude-agent-sdk | 30 |
| fastify | 15 |

`--enable-source-maps` costs about 80–130 ms of the Node-internal time
(`lineLengths` over the bundle). Keeping source maps on is a recorded decision
(`issues/bugs/2026-10-07-box-first-load-is-slow.md`).

## Options

- **Lazy commands.** Register each command's name, options, and help
  statically, and import its action module when the verb runs. This removes
  most of the module load for every verb but `serve`. It changes how every
  command is declared, so it needs a design.
- **Lazy Agent SDK.** Only `src/services/claude-chat/core.ts` imports the SDK
  at run time. Its `start()` is synchronous and builds the run from the SDK's
  `Query` in the same call, so a dynamic import needs `start()` to become async
  or the run to accept a pending query. About 30–58 ms.
- **zod schemas at import.** About 47 ms of schema construction runs before
  any verb. Which schemas, and whether they can be built on first use, is
  unmeasured.

Measure with `pnpm perf:cli-start --cpu-prof` and `pnpm perf:serve-start`.

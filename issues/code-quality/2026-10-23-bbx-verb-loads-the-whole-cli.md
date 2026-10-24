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

## Update (2026-10-23, later)

Done in worktree-perf-easy-wins: server-only packages, the Agent SDK, react-dom,
esbuild, file-type, chokidar and the orama persistence plugin load on first use,
and two strings built at load no longer parse `ledger.yaml`. `bbx --version`
went from about 454 to about 360 ms (interleaved runs, load 5–8).

What remains per start, from a profile: Node module loading and compiling, zod
schema construction spread across many modules (about 50 ms), the `yaml`
package's own evaluation (about 9 ms), source maps (about 50 ms, kept on by
decision), and execa (about 29 ms). execa stays static because
`defaultSpawnChild` in `src/hub/supervisor/child-spawn.ts` is synchronous and
its tests use the returned promise directly; `require()` of execa works from
the bundle but not under tsx. The TypeScript native API (about 17 ms) is
called synchronously.

Lazy commands remain the main lever. A bundle that registers only `ls` runs
`bbx ls` in 288 ms against 464 ms for the full CLI (same load). `ls` alone
still pulls 22 packages through the card and schema graph.

Source maps: about 50 ms per start (398 vs 349 ms). An alternative that keeps
mapped stacks: start without `--enable-source-maps` and map a stack on demand
with `node:module`'s `SourceMap` when the CLI reports an error. Needs a
decision, since keeping source maps on is a recorded choice.

## Update (2026-10-23, lazy commands)

Done by `beebox/docs/plans/lazy-cli-commands.md` (worktree-perf-easy-wins): the
verb registry is a record of loaders, a run loads only the command its argv
names, and the bundle is code-split. Against a bundle built from `main`
(interleaved, 11 runs, load 10–18): `bbx --version` 350 → 92 ms, `bbx status`
436 → 245, `bbx validate --pre-commit` 493 → 288, `bbx todos` 489 → 282,
`bbx search` 503 → 402, `bbx ls` 359 → 290.

Still open from the list above: zod schema construction and `yaml` in the
shared card graph that most verbs load, source maps (a decision), and execa.

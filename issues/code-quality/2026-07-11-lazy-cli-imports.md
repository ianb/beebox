---
title: "Lazy-import heavy deps in the CLI bundle (~100MB heap allocated per process at import time)"
area: callback-box
filed-by: agent
discovered-in: worktree-memory-use — investigating prod memory usage
---

Every `cb` process pays the full import cost of every command's dependencies:
a bare `cb --help` peaks at ~245MB RSS (~218MB without `--enable-source-maps`),
with ~103MB of JS heap allocated purely at import time. The bundle
(`scripts/build-cli.mjs`) externalizes `node_modules`, so this is the eager
top-level import graph of `src/cli/index.ts`, not the bundle itself (2MB).

Measured import-time heap of the worst offenders (Node baseline ~40MB RSS):

| dep | heapUsed | used by |
|---|---|---|
| `typescript` | +31MB | only `cb view typecheck` (`src/cli/commands/view-typecheck.ts:14`) |
| `@anthropic-ai/claude-agent-sdk` | +15MB | chat/agent paths |
| `cheerio` | +11MB | only `cb view` (`src/cli/commands/view.ts`) |
| `markdownlint` | +11MB | validate paths |
| `@google/genai` | +10MB | audio-question, scan-import, dev image gen |
| grammy / fastify / execa / react-dom / zod | +7–8MB each | various |

This multiplies across every resident process (hub, scheduler, 5× `cb serve`
on prod) and every transient spawn (`cb wakeup` etc.).

The clean first cut: move `typescript`, `cheerio`, `markdownlint`, and
`@google/genai` behind dynamic `import()` at point of use — one or two import
sites each, ~60MB heap combined, none needed by serve/scheduler/hub. Because
deps are external in the esbuild bundle, dynamic imports of bare specifiers
need no code-splitting changes. Going further (per-command lazy loading in the
commander wiring) is possible but has diminishing returns.

Note this mostly does NOT reduce standing prod memory (the resident processes
genuinely use fastify/sdk/etc.) — the win is transient spawns, cold-start
speed, and the long tail of point-of-use-only deps.

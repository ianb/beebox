---
title: "A third of beebox/src is imported by no test — 430 of 1,288 files, 327 of them frontend"
workstream: test-selection
area: beebox
labels: [testing]
filed-by: agent
discovered-in: worktree-test-selection — measured while running the test-selection Track 0 spike
priority: backlog
---

Measured 2026-08-09 by building the full test→source import graph with esbuild
over all 484 test entrypoints (method and numbers in
[run less of the full suite](../closed/exploration/2026-08-08-run-less-of-the-test-suite.md),
`## Track 0 measurement`).

**430 of 1,288 `.ts`/`.tsx` files under `beebox/src/` are imported by no
test file, directly or transitively.** By area:

| Files | Area |
| ---: | --- |
| 327 | `src/frontend/src/**` |
| 52 | `src/cli/commands/**` |
| 5 | `src/dev/lib/**` |
| ~46 | scattered (`src/core/chat/`, `src/cli/lib/`, `src/connectors/`, others) |

## What this does and does not mean

**It is not a coverage percentage.** "No test imports this file" is a weaker
statement than "no test exercises this file": a module can be reached through a
booted Fastify server, a spawned CLI, or a React render without the test naming
it. Route doctests, for instance, import `src/webapp/server.ts` and reach a large
graph through it — that graph *is* counted here.

What it does mean is that for these 430 files there is no import path from any
test entrypoint at all. For frontend components in particular that is usually the
literal truth: there is no component-render test tier, so `src/frontend/src/`
components, pages, and hooks are exercised only by hand in a browser.

## Why it is worth knowing

- **It is the reason change-based test selection failed its measurement gate.**
  194 of the 250 branches that would have run the full suite anyway did so
  because they touched an untested-by-import frontend file. Raising this number
  is the single change that would most improve the case for selection — 71% of
  branches would become selectable rather than 25%. That is a side effect, not a
  reason to do it.
- **The real reason is the obvious one**: a third of the source has no automated
  check that it still compiles into something that works. `pnpm typecheck` covers
  it, and nothing else does.

## Not a mandate

Per `issues/CLAUDE.md`, this is a tension, not a task. Blanket coverage of 327
frontend files is not proposed and would be a bad use of effort —
`beebox/docs/testing.md` is explicit that tests are not for coverage
percentages. The useful version of this is probably: pick the frontend logic that
already has hand-testable seams (hooks, reducers, machines, `lib/` helpers — many
already have doctests) and note that the components themselves may be the wrong
shape to test rather than merely untested.

The list is reproducible in about two seconds with the graph builder described in
the origin issue.

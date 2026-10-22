---
title: "The test graph can miss import edges when the checkout path is a symlink"
workstream: unattached
area: tooling
priority: backlog
labels: [tooling, test-selection]
filed-by: agent
discovered-by: agent
discovered-in: doctest-typecheck — retire-doctest track 6, removing the doctest esbuild plugin from bin/test-graph.ts
resolution: implemented
---

Fixed by the commit that carries this issue's `Issue:` trailer: `buildGraphFrom` resolves its config (roots, aliases, entrypoints) to real paths before the build. `bin/test-graph-fixture.ts` no longer takes the temp root's real path, so the fixture tests cover a symlinked root on macOS.

`bin/test-graph.ts` builds the import graph with esbuild and turns each
importer into a repo-relative path with `toRepoRel`, against the configured
`repoRoot`. esbuild reports importers by their real path. When `repoRoot`
is reached through a symlink, the two prefixes differ, and the broken-import
and ambiguity edges for those importers are dropped.

The doctest esbuild plugin hid this until track 6 removed it. It showed up
in `bin/test-graph.test.ts`: the dangling-import and ambiguity tests failed
on macOS, where the temp root `/var/folders/...` is a symlink to
`/private/var/folders/...`. The fix there was in the fixture
(`bin/test-graph-fixture.ts` now takes the temp root's real path), not in
the graph code.

A real checkout under `~/src/` is not normally a symlink, so selection is
not affected today. A checkout opened through a symlinked path would lose
those edges without an error.

Fix direction: resolve `repoRoot` with `realpathSync` once in the graph
builder, so both prefixes agree.

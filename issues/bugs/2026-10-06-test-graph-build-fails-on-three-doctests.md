---
title: "The test graph build fails whole on three doctests, so selection fails open to every test"
workstream: unattached
area: monorepo
labels: [tests, test-selection]
filed-by: agent
discovered-by: agent
discovered-in: worktree-test-suite-health — running the selection CLI on a bin/ change
priority: important
---

`node --import tsx bin/test-graph.ts --no-cache` on the current tree prints
`entrypoints: 0 graphed, 978 unresolved`. esbuild fails the whole build because
`generateTestSource` (`agent-doctest/src/doctest-hooks/hooks.ts`), called from
`doctestPlugin` in `bin/test-graph.ts`, emits source esbuild cannot parse for
three doctests. `buildGraphFrom` treats any build failure as `hardFailure`, so
every entrypoint becomes unresolved and `pnpm test:changed` selects all 973
test files for any change (observed 2026-10-06 for a one-line `bin/lib` edit).
Full-suite attribution fails open the same way.

The three files, with the esbuild error for each:

- `beebox/test/core/migrations/one-root-mapping.doctest.md` — `"await" can
  only be used inside an "async" function` at the `every((v2) => { … })`
  expression at line 250.
- `beebox/test/core/tts/mp3-encoder.doctest.md` — `Unexpected "}"` near line 110.
- `beebox/test/webapp/routes/chat/tts-mock.doctest.md` — `Unexpected "}"`.

Each passes under tap (`pnpm exec tap test/core/tts/mp3-encoder.doctest.md`
reports `ok`), so tap's loader and the graph's direct `generateTestSource` call
produce different source for these blocks. Excluding the three entrypoints
yields a working graph of 975 tests with 0 unresolved.

Two things to settle: why the loader and the graph diverge, and whether one
unparseable doctest should fail the whole build rather than only its own
entrypoint (the module comment promises "per-test fail-open").

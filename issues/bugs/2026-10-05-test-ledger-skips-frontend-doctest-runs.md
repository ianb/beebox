---
title: "Test ledger skips passing frontend doctest runs"
workstream: unattached
area: monorepo
labels: [tests]
filed-by: agent
discovered-by: agent
discovered-in: worktree-chat-scroll-fixes — checking the router static-prefix fix
priority: important
---

`pnpm test:changed` selected the frontend public-assets doctest and passed
all five assertions, but the ledger printed
`test-ledger: not recorded (NoTestFilesError: TAP output named no test files)`.
The test result is valid. Its durable ledger evidence is missing.

`bin/test-ledger-lib.ts:98-104` accepts top-level TAP file results only when
the reported path starts with `test/`. Frontend doctests live beneath
`src/frontend/test/`, so their otherwise valid results are discarded.
`bin/test-ledger-store.ts:105-106` then throws `NoTestFilesError` for an
empty result list. The wrapper reports that bookkeeping failure without
changing the successful test command's exit status.

## Research (2026-10-05)

The pure parser reproduces the mismatch without running a suite:

```ts
parseTapFiles("ok 1 - src/frontend/test/dev/vite-proxy.public-assets.doctest.md # time=10ms")
// []

parseTapFiles("ok 1 - test/lib/example.doctest.md # time=10ms")
// [{ file: "test/lib/example.doctest.md", ok: true, ms: 10 }]
```

The parser is unchanged by the router work. No matching open or closed
issue was found. Correct accepted test-file roots and record both passing
and failing frontend runs in a separate change. Keep the warning visible
until the ledger can retain that evidence.

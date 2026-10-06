---
title: "`pnpm test:changed` refuses to run when the selection includes `bin/test/` doctests"
workstream: gemini-tts-38
area: beebox
labels: [tests]
filed-by: agent
discovered-by: agent
discovered-in: worktree-gemini-tts-38 — running change-selected tests for TTS streaming
resolution: implemented
---

**Closed:** Resolved by b4f7cfad9: selected `bin/` doctests run from the package as `../bin/test/...`.

`pnpm test:changed` in `beebox/` stops before running anything:

```
test-ledger: no such test file in this package: bin/test/agent-quotas.doctest.md, …
Refusing to run the whole suite instead.
```

The selector (`bin/test-select.ts`) chose 971 files for a diff that touched
`beebox/src/services/tts.ts`, the TTS route, and frontend audio code. 29 of them
are monorepo-root doctests under `bin/test/`. `bin/test-select.ts:47` strips a
`beebox/` prefix and passes every other path through unchanged, so those
`bin/test/` paths reach the beebox runner, which refuses paths outside its
package (`bin/test-tiers.ts:199`).

It is not every diff: the finish flow's `pnpm --dir beebox test:changed` passed
on an earlier diff from the same worktree. A diff whose import graph reaches a
module that `bin/` tests also import seems to be the trigger (unverified which
edge).

Workaround used: run the selector, drop the `bin/` lines, and pass the rest to
`pnpm exec tap` (942 files, all passing).

Likely fix: in `--run` mode, split the selection by package and run `bin/`
doctests with the root runner, or report them as a separate command, rather
than handing them to the beebox runner.

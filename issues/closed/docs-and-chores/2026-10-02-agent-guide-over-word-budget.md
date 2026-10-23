---
title: "The rendered agent guide is over its word budget on main"
workstream: unattached
area: beebox
filed-by: agent
discovered-by: agent
discovered-in: markdown-expressiveness
resolution: implemented
---

> **Closed 2026-10-22 (issue audit):** The ceilings were raised with recorded reasons in `beebox/src/core/agent-guide/ledger.yaml` (ba48b2b0e and later raises; now `guide_words: 5743`, `always_loaded_words: 10928`). `pnpm lint:guide --report` passes today.

`pnpm lint:guide --box <test1 clone> --report` fails on main (worktree base
d0c8487c9): the rendered guide is 5705 words against `budget.guide_words`
5595, and always-loaded context is 10667 words against
`budget.always_loaded_words` 10213. The overrun predates the
markdown-expressiveness change, which adds 11 words (a pointer to
`docs/box/markdown.md`).

Either trim the guide back under the ceilings or raise them with a recorded
reason in `src/core/agent-guide/ledger.yaml`, as earlier raises did.

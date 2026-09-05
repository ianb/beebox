---
title: "check out slopo"
workstream: unknown
area: monorepo
priority: backlog
next-action: fixed
---

[github.com/rafal-qa/slopo](https://github.com/rafal-qa/slopo) — finds *non-exact* code duplication: similar implementations scattered across files/modules that exact-match and lint tools miss (the "same thing written twice under different names" drift). Python CLI (`uv tool install slopo`, `slopo init/index/embed/analyze`): embeds every code unit via an external embedding model, clusters close pairs, boosts by distance (directory hops, line separation), filters through two thresholds, and emits a ranked HTML/markdown report. Supports TypeScript/JS among others; incremental re-index; a shared `slopo.ignore.txt` to persist reviewed clusters; explicitly agent-friendly (an agent can validate the flagged duplicates).

The beebox angle: it's the *detection* complement to ["Before you build this" — embedding-indexed reuse search](2026-05-28-before-you-build-this.md) (which tries to *prevent* new duplicates at author time) — slopo finds the ones that already crept in. Sits alongside the existing periodic health tools (knip = dead code, madge = cycles, oxlint) as a "run occasionally, review the clusters" pass — a natural fit for the `bbx-codehealth` skill's deliberate de-cruft sweeps rather than pre-commit (embedding a whole tree isn't cheap enough to run every commit). Caveats to weigh before adopting: it needs an external embedding model (cost/API + which model, and sending source to it — check that's acceptable), the repo is a multi-package monorepo (scope per-package or whole-tree?), and near-duplicate ranking has false positives — the value is triaging clusters, not auto-acting on them.

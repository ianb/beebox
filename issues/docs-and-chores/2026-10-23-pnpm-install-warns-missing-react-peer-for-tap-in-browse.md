---
title: "A pnpm install that changes the lockfile warns 17 missing react peers for tap in browse/"
workstream: unattached
area: docs
labels: [dependencies]
filed-by: agent
discovered-in: worktree-perf-easy-wins — tsx upgrade
---

A `pnpm install` that re-resolves the lockfile prints 17 `missing peer` warnings:
tap 21.7.4 in `browse/` reaches `tcompare` and `react-element-to-jsx-string`,
which declare `react` and `react-dom` (^18 or older) as peers, and `browse/`
has neither. A frozen install on an unchanged lockfile prints nothing, so the
warnings appear only in the commit that changes a dependency, and they are not
about that change. Seen 2026-10-23 when bumping tsx in every package.

The tap entry for `browse/` in the lockfile already resolves without react.
Options: add `react` and `react-dom` as dev dependencies of `browse/`, or
record the missing peer as accepted in `pnpm-workspace.yaml`. The second hides
the warning, so it needs the developer's agreement.

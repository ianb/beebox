---
title: "A subcommand missing from the CLI surface table fails only at run time"
workstream: unattached
area: beebox
labels: [cli, testing]
filed-by: agent
discovered-by: agent
resolution: implemented
discovered-in: worktree-retrospective — retrospective 20261025-233625
---

**Resolved 2026-10-29** — commit a8a800ed5 adds the test in `beebox/test/cli/entry.surface.test.ts`. No family was missing a subcommand at the time.

A family that splits into subcommands lists them in `subcommands` in
`beebox/src/cli/entry/surface-data.ts`. A new `.command(...)` registered
under that family but absent from the list is dropped silently; nothing fails
at build or test time, and the gap showed only on a deployed server. A test
that pinned the list by hand then went stale on main.

Coding feedback: box-isolation/20261025T002829Z-implemented.md,
box-isolation/20261025T015814Z-landed.md.

Direction named in the entries: a test that compares every subcommand
registered under a split family with the surface table's list.

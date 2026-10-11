---
title: "Append-only and generated files cause merge conflicts that block headless finishes"
workstream: unattached
area: beebox
labels: [finish, merge]
filed-by: agent
discovered-by: agent
discovered-in: worktree-retrospective — retrospective 20261010-224248
---

`finish-preflight` exits 3 (BLOCKED) on any merge conflict. Three of the
window's conflicts were in files where the resolution is mechanical: an
append-only `context-history.yaml` (keep both sides,
plugins-planning/20261010T135742Z-landed.md), the append-only `MIGRATIONS`
list in `beebox/src/core/migrations.ts` (keep main's shape, re-append the
branch entry, journey-walks-oct/20261009T040617Z-landed.md), and the generated
`beebox/docs/doc-graph.md` (take main's, regenerate,
imbue-studio-research/20261009T113613Z-landed.md).

Options named in the entries: a `union` merge driver in `.gitattributes` for
the YAML ledger, one manifest file per migration, and regenerating
`doc-graph.md` at merge rather than committing it on branches.

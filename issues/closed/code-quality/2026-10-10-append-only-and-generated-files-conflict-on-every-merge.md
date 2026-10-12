---
title: "Append-only and generated files cause merge conflicts that block headless finishes"
workstream: finish-tooling
area: beebox
labels: [finish, merge]
filed-by: agent
discovered-by: agent
discovered-in: worktree-retrospective — retrospective 20261010-224248
resolution: implemented
---

**Closed 2026-10-12 (finish-tooling).** `finish-preflight` resolves these
three conflicts itself (`bin/finish-preflight-merge.ts`) when every conflicted
path has a rule. Any other conflict still exits 3. The ledger merges parsed
rows, deduplicated and oldest first. `MIGRATIONS` takes main's list and
re-appends the branch's new entries, only when the branch did nothing but
append. `doc-graph.md` is regenerated from the merged tree. The `union`
driver this issue proposed was tried and rejected: when both sides' additions
end in identical lines (`added: 0`, `turns: 1`), it keeps those lines once,
so a ledger row loses fields. That is the 2026-08-23 incident shape. One file
per migration was not needed. These rules run only in preflight; a manual
`git merge main` still conflicts.

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

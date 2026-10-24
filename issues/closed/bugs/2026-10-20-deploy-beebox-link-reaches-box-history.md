---
title: "Deploy's server-local `beebox` link dependency reaches box Git history"
workstream: bug-burndown-4
area: beebox
labels: [box-shape, git, deploy]
filed-by: agent
discovered-by: agent
discovered-in: worktree-bug-burndown-4 — cross-model review of the box-marker plan
resolution: implemented
---

**Closed:** Implemented per `beebox/docs/implemented-plans/portable-engine-dependency.md` (f9de5b6cc through bbdb1f575): box `package.json` commits `link:.beebox/engine`, and a per-machine gitignored symlink points at the engine.

Every deploy rewrites each production box's `package.json` so that the
`beebox` dependency is `link:/opt/beebox/beebox`
(`beebox/deploy/deploy.sh:734-741`). The rewrite is a working-tree edit to a
tracked file. Nothing marks it skip-worktree or restores it. The next agent
turn commits it, because agent commits stage everything
(`beebox/src/lib/git/core/operations.ts:278-281`, `git add -A`, called from
`beebox/src/core/agent/invoke/commit.ts:88`). A migration that edits
`package.json` commits it too (`beebox/src/core/migration-sweep.ts:259`).

So box history carries a path that is only meaningful on the server. A clone
of a production box has a dependency that does not resolve on another
machine. Local boxes do the same with their own paths: `defaultBeeBoxSpec`
(`beebox/src/core/box/package.ts:56-58`) scaffolds `link:<engine checkout>`,
and worktree setup commits a link to the worktree's engine.

## Tension

The box needs a resolvable `beebox` dependency at install time, and today the
only resolvable forms are machine-local links (there is no registry for the
engine package). A portable committed value would need the install step to
supply the local path some other way: a pnpm override outside the tracked
file, `skip-worktree` on `package.json` (which also hides real dependency
edits by agents), or a restore after install. Each has a cost. It is not clear
the committed path causes harm beyond clones failing `pnpm install` until the
link is rewritten, which deploy and worktree setup already do.

Related: `issues/bugs/2026-10-20-box-marker-in-gitignored-state-dir.md`
(its migration writes `package.json` and so commits whatever dependency value
is in the working tree).

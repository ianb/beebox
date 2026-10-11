---
title: "Knowledge audits refuse a fresh worktree box clone because of its own linking changes"
workstream: unattached
area: beebox
labels: [knowledge-audit, worktrees]
filed-by: agent
discovered-by: agent
discovered-in: worktree-agents-md — auditing the box AGENTS.md migration
---

`pnpm knowledge-audit run --box ~/src/box-worktrees/<name>/test1` refuses the
worktree's own clone:

```
Refusing to audit …/test1: its Git working tree has pre-existing changes.
 M .claude/settings.json
 M package.json
?? pnpm-lock.yaml
```

These changes are made by worktree creation, which points the clone's
`beebox` dependency at the worktree engine. So every fresh clone is dirty, and
the guard added for
[the reset-discards-edits bug](../closed/bugs/2026-09-28-knowledge-audit-resets-preexisting-box-edits.md)
blocks the case `beebox/docs/box-work.md` names first ("the worktree's
clone"). Its advice, "commit the box's changes or use a clean disposable box",
means committing linking state into the clone or copying it by hand.

The disposable copy has its own trap: a symlinked `node_modules` breaks `@`
imports through it (the `quick-chat-rubric-maintenance` status comment records
the same failure). A copy needs a real `node_modules` directory.

Options: have worktree creation commit its linking changes in the clone, or
let the guard ignore the known linking paths. Either keeps the guard for real
edits.

**2026-10-10 (retrospective 20261010-224248):** three more sessions hit the
guard on their own clone and committed its setup files by hand or built a
disposable copy: hq-always/20261009T235132Z-implemented.md,
plugins-planning/20261010T062402Z-review-adjudicated.md,
user-facing-language/20261009T120548Z-implemented.md. The last adds a second
trap for disposable copies: `.beebox/box.json` is gitignored, so `git clone`
omits it, and the failed run had already rewritten the seed briefing through
template sync before it crashed.

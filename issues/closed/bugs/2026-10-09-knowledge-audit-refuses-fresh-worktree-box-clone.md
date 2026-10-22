---
title: "Knowledge audits refuse a fresh worktree box clone because of its own linking changes"
workstream: bug-burndown-4
resolution: implemented
area: beebox
labels: [knowledge-audit, worktrees]
filed-by: agent
discovered-by: agent
discovered-in: worktree-agents-md — auditing the box AGENTS.md migration
---

> **Closed 2026-10-20 (bug-burndown-4):** the boxholder chose the first option.
> `bin/lib/worktree-create.sh` now commits a fresh clone's setup changes in the
> clone (step 6: the engine link, its lockfile, and what `engine init`
> refreshed), so the clone starts clean and the audit's reset after each test
> returns to that commit with the link intact. A reused clone is never
> committed, since it may hold the developer's own edits. A clone made before
> this change needs it once by hand:
> `git -C ~/src/box-worktrees/<name>/test1 add -A && git -C ~/src/box-worktrees/<name>/test1 commit -m "Worktree setup"`
> (check `git status` first for edits of your own). The `.beebox/box.json` trap
> for hand-made copies stays with the
> [marker issue](2026-10-20-box-marker-in-gitignored-state-dir.md).
>
> Teardown's `keep` preservation replays the branch without the setup commit,
> so the clone's engine link never reaches `test1`; a replay that conflicts
> refuses the cull. Residuals from cross-model review (codex gpt-6-sol),
> accepted: a creation interrupted before step 6 and then retried reuses the
> clone and does not commit, and a setup commit the box's own pre-commit hook
> rejects is only a warning. Either way the clone stays dirty and the audit
> refuses it, as before this change; the one-time command above fixes it.

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
[the reset-discards-edits bug](2026-09-28-knowledge-audit-resets-preexisting-box-edits.md)
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

**2026-10-20 (bug-burndown-4, fix stopped for a decision):** worktree creation
(`bin/lib/worktree-create.sh`) changes more than the three linking paths. Step 2
repoints `package.json` and runs `pnpm install`, which writes `pnpm-lock.yaml`.
Step 5 runs `bbx engine init` against the clone. That rewrites
`.claude/settings.json` (validation hook path), and it also applies any
template or directory drift between the source box and the worktree engine. The
bug-burndown-4 clone, made today from `~/src/boxes/test1` at the same HEAD, also
has ` M _config/template-versions.json` (a new `stock` entry for
`_content/plate.todo-view.card`) and `?? _content/incoming/.gitkeep` (from
`ensureDirectories`). File mtimes put both inside the creation run. So if the
guard ignores only the three linking paths, it still refuses this clone.

Decision needed: either worktree creation commits everything it changes in the
clone (the first option above; this also covers init drift), or the guard
ignores the linking paths and init drift is committed or accepted some other way.
If the guard ignores paths, the runner must also preserve them. Its post-test
`git reset --hard` reverts `package.json` and `.claude/settings.json`, and
`git clean -fd` deletes the untracked `pnpm-lock.yaml`.

The second trap is still present: `.beebox/` is gitignored in boxes, so a plain
`git clone` copy has no `.beebox/box.json`. Worktree creation copies the marker
explicitly, but a hand-made disposable copy does not. The marker work tracks this.

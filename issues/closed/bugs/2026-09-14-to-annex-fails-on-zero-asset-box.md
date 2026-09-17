---
title: "bbx attachments to-annex fails on a box with no assets: the conversion commit is empty"
workstream: full-embrace-annex
area: beebox
labels: [annex]
filed-by: agent
discovered-by: agent
discovered-in: worktree-full-embrace-annex — converting the last manifest-scheme box
resolution: implemented
---

> **Closed by the full-embrace-annex workstream, 2026-09-14.** Moot: `bbx attachments to-annex` is deleted. The zero-asset case it could not complete is exactly what `annexNewBox` handles at box creation, and the finding is recorded in that module's comment as the reason it is not the migration.
`bbx attachments to-annex` on a box with zero assets runs `git annex init`,
then fails:

```
Error: Command failed: git commit -m Move assets onto git-annex --no-verify
```

There is nothing to commit, so `git commit` exits 1 and the conversion reports
failure. The box is left annex-initialized and correct — `bbx doctor annex`
returns all eleven checks green, and a real asset written afterwards annexes
properly (verified: the index blob is an `/annex/objects/SHA256E-...` pointer).
So the command's report and the box's actual state disagree, in the direction
that makes an operator retry or hand-repair a box that is already converted.

Observed on `~/src/boxes/about` on 2026-09-14 with git-annex 10.20260717.

This matters to `beebox/docs/implemented-plans/annex-at-init.md` beyond the box it was
found on. The plan already decides not to call `convertBoxToAnnex` from
`bbx init`, reasoning that a fresh box has no assets and no commit so the
migration's verification steps are all trivial. This is the concrete failure
behind that reasoning: the conversion does not merely do unnecessary work on a
zero-asset box, it **cannot complete** on one. A fresh box is the zero-asset
case by definition.

Fix direction: an empty conversion is a success, not a failure. Either skip
the commit when nothing is staged, or use `--allow-empty`. The first is
honest about the fact that nothing changed.

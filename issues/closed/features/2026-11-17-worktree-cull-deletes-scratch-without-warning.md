---
title: "A worktree cull deletes its ignored scratch/ with no warning or copy"
workstream: canvas-brushes
area: dev-tooling
filed-by: agent
discovered-in: canvas-brushes — recovery after the 2026-11-17 cull
resolution: implemented
---

**Closed (implemented, 2026-11-17):** Fixed by a5ac7ac02, 59cd4f1a2, a5c714327.

`bin/lib/worktree-teardown.sh` moves a culled worktree to a trash directory,
and a reaper deletes it. The ignored `scratch/` goes with it. On 2026-11-17 the
canvas-brushes cull deleted a GPU lock wrapper, a page builder, compare
scripts and four showcase sketches that later work used. They were rebuilt by
replaying the session's JSONL transcripts (Write/Edit calls plus python and
sed heredocs, run in a fake root) and checked against a built page that
survived in the exhibit store.

`scratch/README.md` says files there "can vanish at any time", but agents keep
working tools there across days. The tension: `scratch/` is meant to be
throwaway, and a teardown that keeps it would grow without bound; a teardown
that drops it silently loses work that nothing else holds.

Options seen: list non-empty `scratch/` subdirectories (size, newest file) in
the cull's decision record; move `scratch/` into the workstream's exhibit
store, which survives culls; or refuse the cull while `scratch/` holds files
newer than the last commit.

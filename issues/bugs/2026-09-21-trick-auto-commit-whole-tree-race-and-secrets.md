---
title: "bbx trick's auto-commit stages the whole tree and races across concurrent trick runs, instead of using the existing scoped/race-tolerant commit helper"
workstream: unattached
area: beebox
filed-by: agent
discovered-by: agent
discovered-in: main — production box feedback triage (bbx feedback)
priority: normal
---

`bbx trick <name>` runs the trick as a child process and, only if it exits 0,
calls `commitIfDirty(boxRoot, name)` (`beebox/src/cli/commands/trick.ts:36-44`,
called at line 232). That function does `getStatus()` → if clean return → else
`stageAll(boxRoot)` (stages the **entire working tree**, `beebox/src/lib/git.ts:288`)
→ `commit()`. This is check-then-act across processes, and it stages
everything dirty, not just the trick's own output.

Two distinct problems from the same code path, both observed on one box
running an image-generation trick that fires several times concurrently
(once per chat turn):

1. **Race → hard crash on the loser.** Two overlapping trick runs can both
   pass `getStatus()`'s "not clean" check before either commits. The second
   run's `git commit` then exits nonzero ("nothing to commit, working tree
   clean"), which the commit-wrapping retry logic surfaces as an unhandled
   `GitCommandError` with a stack trace. No work is lost — the first run's
   commit already contains the second run's files — but the run reports a
   hard failure even though its output succeeded, which in an unattended job
   reads as "the generation failed" when it did not.

2. **Broad staging captures unrelated and secret files.** Because
   `stageAll` stages everything dirty, a trick's auto-commit has captured, in
   separate incidents: another chat session's in-progress markdown edits (a
   session file was committed under the image trick's `Run-By` trailer,
   misattributing the change), and separately a batch of live runtime/secret
   files — a server pid file, active chat lock files, a session-id file,
   debug logs, SQLite WAL/SHM files, and a secrets JSON file — all swept into
   one auto-commit alongside the trick's actual image output.

## The fix already exists in the codebase, unused here

`beebox/src/lib/git.ts:334-392` already defines `commitPaths` (commit only
given paths) and `stageAndCommitPaths` (stage + commit a path set,
**tolerating a concurrent committer** — a "nothing to commit" result from a
sibling process is treated as success, not an error; see the docstring at
`git.ts:355-373`). This is the exact idiom `commitIfDirty` needs and does not
use; `commitIfDirty` instead uses the older `stageAll` + `commit` pair.

## Why resolution is not obvious

`stageAndCommitPaths` needs a path set to scope to, and `bbx trick` does not
currently track which paths a trick touched — it only knows whether the tree
is dirty afterward. Getting the path set requires either the trick declaring
its own output paths, or the engine diffing the working tree state before and
after the child process ran. Either is a real design change, not a one-line
swap of function names.

Related: `issues/features/2026-09-16-sandboxed-trick-helpers.md` proposes a
`commit(paths, message)` helper as part of a broader trick-authoring library;
this bug is a concrete argument for building that piece specifically, and for
retrofitting `commitIfDirty` itself even before the fuller helper library
exists.

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
`stageAll(boxRoot)` (stages the **entire working tree**, `beebox/src/lib/git/core/operations.ts:288`)
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

`beebox/src/lib/git/core/operations.ts:334-392` already defines `commitPaths` (commit only
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

## From the generate-image report (2026-09-24)

A box's `generate-image` trick twice wrote an image card to the wrong place
(a doubled directory tree; a new top-level folder, repeated by a subagent
batch). `bbx trick` then auto-committed it, so each mistake cost a revert and
a manual cleanup. Two engine-side points:

- Auto-commit turns a wrong output into history before anyone looks. A way to
  skip or confirm the commit would make the mistake cheap.
- Tricks have no convention for what a relative path argument means. The
  runner starts a trick with cwd `src/tricks/` (`beebox/src/cli/commands/trick.ts:138`),
  agent shells reset their cwd between calls, and each trick picks its own
  base. The trick itself was fixed box-side; see
  [the closed generate-image issue](../closed/bugs/2026-09-21-trick-generate-image-relative-path-mislabeled.md).


## Re-encounter 2026-10-09 (journey walks)

Seen in [A](../../beebox/test/user-stories/journeys/A-lending/reports/2026-10-09.md) (R1). The agent tested its own read-only trick while its schema, trick, five cards and edits were uncommitted. `bbx trick` commits the whole dirty tree after any successful run (`beebox/src/cli/commands/trick.ts:37-47`), so most of the evening's work landed under "Auto-commit changes from trick: loans" (`bdf9c7b`: schema, trick, five loans, the root chat's card and a usage-manifest line; then `776f849`, `92eb558`, `c42403d`). The agent's own commit `b56b498` ("…first five loans recorded") holds only the landmarks and a doc line, so its message describes files it does not contain. Testing a trick mid-build is an ordinary trigger, and the person saw the trick's subject in Properties (row 31). The priority may be stale given the repeat.

## Re-encounter 2026-10-15 (box agent report)

A box agent, the same box that filed the 2026-08-01 instance, reported a third
shape. One successful test run of a trick it had just edited committed three
unrelated edited files under "Auto-commit changes from trick: …", and none of
the trick's output. Its points, checked against the code:

- **No concurrency needed.** The trigger is "edit anything, then run any trick",
  which is what testing a trick looks like. Three instances across three
  months, found by three routes.
- **Success path only.** `commitIfDirty` runs only after exit 0
  (`beebox/src/cli/commands/trick.ts:229-233`). Confirmed.
- **Misattribution.** The commit carries `Run-By: trick/<name>` and the trick's
  name while holding someone else's work. Repair needs `git commit --amend`,
  a history rewrite, which is not fine on a box that pushes.
- **Gitignored output makes it pure.** When a trick writes only to an ignored
  path (a `temp/` scratch directory; the root repo now ignores
  `tmp/`, `temp/`, `tmp-*/`, `_tmp-*/` at any depth, and boxes do similar),
  its own scoped `git add` of that path is refused, the trick still exits 0,
  and the whole-tree commit can contain only unrelated files.
- **Proposed fix: before/after path diff in the runner.** Record dirty paths
  before spawning the child and after it exits 0, and commit the difference
  with `stageAndCommitPaths`. It needs nothing from trick authors and fixes
  every trick at once. An empty difference commits nothing, which is right for
  ignored output. Declared output paths
  ([sandboxed trick helpers](../features/2026-09-16-sandboxed-trick-helpers.md))
  stay the better long-term shape, but only fix tricks written later.
  Caveats for whoever implements it: a path that was already dirty before the
  run and that the trick then changes again is in both sets, so the diff needs
  content hashes, not only path names; and `git status` collapses untracked
  directories unless run with `-uall`.
- **Lock lifetime.** The commit runs in the parent after the child exits, so a
  lock the trick releases on exit does not cover it. The box's workaround holds
  its lock through the whole `bbx trick` process. Moving scoping into the
  runner makes that unnecessary.
- **Secondary ask, repeated:** `bbx trick --no-commit` (or an env var), so a
  trick can be tested mid-edit and a wrong output is not history before anyone
  looks.

The report also argues that `priority: normal` understates the bug (the
2026-10-09 note says the same). The fix does not need a decision in
[rethink box autocommit](../decisions/2026-08-30-rethink-box-autocommit.md).

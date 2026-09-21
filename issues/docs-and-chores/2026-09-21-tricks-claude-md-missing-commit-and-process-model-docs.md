---
title: "tricks/CLAUDE.md doesn't explain that the engine auto-commits after the trick exits, stages the whole tree, and that the trick's direct parent is a tsx wrapper, not bbx"
workstream: unattached
area: beebox
filed-by: agent
discovered-by: agent
discovered-in: main — production box feedback triage (bbx feedback)
---

While fixing a trick's interaction with the auto-commit step (see the
companion "trick auto-commit" bug filed in this same triage), an agent hit
three facts about trick execution that are not documented anywhere a trick
author would find them:

1. **The trick is a child process; the engine commits after it exits.**
   `runTrick` (`beebox/src/cli/commands/trick.ts:123-149`) spawns the trick
   via `tsx`; `commitIfDirty` runs in the parent only after the child closes
   (`trick.ts:232`). A trick's own `finally` blocks and `process.on('exit')`
   handlers all run before the commit that may later fail — a trick cannot
   protect or observe the engine's commit from inside its own process
   lifetime.

2. **`process.ppid` inside a trick is not `bbx`.** `runTrick` spawns
   `process.execPath` running `resolveTsx()` (`trick.ts:126-135`), so a
   trick's direct parent is a short-lived `tsx` CLI wrapper, not the `bbx`
   process. Any trick that does parent-liveness checks (locking,
   cleanup-on-parent-exit, "am I being run by bbx") needs the grandparent pid,
   or it silently gets the wrong process.

3. **The commit, when it happens, stages the whole tree, not the trick's own
   paths** (see the companion bug — `stageAll` in
   `commitIfDirty`, `trick.ts:36-44`). A trick that writes files while another
   trick is also running can have its own output committed under the other
   trick's `Run-By` trailer.

None of this is discoverable from the trick-authoring docs today, so each
trick author who writes files and can run concurrently is expected to
reverse-engineer and hand-roll the same ~40-line lock/commit workaround.

## Suggested documentation, or better, a supported affordance

- State plainly in the tricks docs: a trick is a child process; the engine
  auto-commits whatever it leaves dirty, after it exits, staging the entire
  tree; concurrent trick runs are therefore not isolated.
- Document the recommended pattern for a trick that writes files: commit your
  own paths yourself so the engine's auto-commit finds nothing left to do.
- Better: expose the trick's true parent (`bbx`) pid via an environment
  variable analogous to the existing `BBX_BOX_ROOT`/`BBX_TRICK_NAME`
  (`trick.ts:124-126`), so tricks don't need to walk the process tree.
- Alternatively, an opt-out a trick can export (e.g. `autoCommit = false`) so
  a trick that manages its own commits isn't followed by a whole-tree
  `stageAll` at all.

## Why resolution is not obvious

This is a documentation gap layered on top of a real behavior the engine may
change (see the companion auto-commit bug). Writing docs for the current
behavior risks needing a rewrite once that behavior changes; whoever picks
this up should coordinate with or follow that fix rather than document around
it.

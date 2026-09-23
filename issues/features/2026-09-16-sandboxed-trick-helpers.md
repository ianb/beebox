---
title: "Trick helpers for the stage → run in sandbox → place output → commit pattern"
workstream: unattached
area: beebox
filed-by: agent
discovered-by: Ian
discovered-in: main — production box feedback triage (bbx feedback)
---

Box tricks often follow one pattern: gather inputs from the box, run a tool,
put the output in an attach scope, commit. On one production box it appeared three
times in one week: label PDFs, Drive-file downloads, and figure preview
renders. Each trick wrote the scaffolding by hand and ran with the box's full
permissions.

The boxholder: "Little sandboxes would be cool too, since you are good at
preparing files. Maybe encouragement and infrastructure for a trick wrapper.
The trick would handle assembling the input, calling inside some light chroot
or something, moving the output, and possibly handling git. Seems like a
common pattern."

## Shape: composable functions, not a declarative spec

The box agent first proposed a declarative `run({inputs, command, outputs,
commit})`. The boxholder rejected that: "I see no reason to make it 100%
declarative. The git commit especially, and moving files. A little code is more
general, easier to add validation and good errors, and barely larger for the
simple case."

Revised shape, a small library that a trick calls in order:

- `stage(paths)` → scratch directory
- `sandbox(cmd, {scratch, net})` → result
- `place(scratchFile, boxDest)` with validation and clear errors
- `commit(paths, message)` that adds the `Run-By` trailer
  (`beebox/src/shared/commit-trailers.ts`)

## Sandbox mechanism

On the production host `unshare` is available; `bwrap` and `firejail` are
not installed. Target: the scratch directory writable, the box read-only or
absent, no network unless the trick asks for it.

Related: [distro packages](../closed/features/2026-09-16-box-installs-distro-packages.md),
[Python libraries](2026-09-16-box-python-library-path-and-policy.md).

---
title: "A workstream name is never checked against the commit blocklist, so a blocked term can become a branch, a registry record, and a Workstream: trailer"
workstream: unattached
area: beebox
labels: [workstreams, privacy]
filed-by: agent
discovered-by: Ian
discovered-in: main session — boxholder noticed a worktree named after a term that should have been blocked
---

`commit-blocklist-check` (`bin/commit-blocklist-check.ts`) guards staged
additions only. A workstream name passes through `bin/workstreams create`
untouched and lands in: the branch name `worktree-<name>`, the registry record,
the worktree path, every commit's `Workstream: <name>` trailer on that branch,
and the workstreams app. None of those go through the check. The boxholder
found a worktree named after a term that belongs on their blocklist; the term
had not been added yet, and by then it was also in five tracked docs and closed
issues, where the check could have caught it had the entry existed.

Two gaps, distinct:

- **The name itself.** `bin/workstreams create` (and `launch-worktree-session`,
  which calls it) could run the name through the same matcher before creating
  anything, and refuse with the check's own message. The matcher lives in
  `commit-blocklist-check.ts`; the create path is shell, so it needs a small
  invocation or the matcher exposed as a script. No blocklist means no-op, as
  today.
- **Text that mentions the workstream by name.** Once the name exists, docs and
  issues that refer to the workstream carry it. That is already covered by the
  commit check, but only from the moment the entry is added; adding an entry
  does not audit what is already tracked. `git grep -il <term>` is the audit;
  a `commit-blocklist-check --audit` that runs every entry against the tracked
  tree would make it one command.

The name check is the smaller and more valuable piece: it stops the term at the
source rather than at each of the places it fans out to.

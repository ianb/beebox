---
title: "full-suite schedule cannot commit its own red report: path-leak-check rejects the tap output it embeds"
workstream: small-bugs-batch
area: schedules
priority: important
resolution: implemented
filed-by: agent
discovered-by: agent
discovered-in: worktree-chat-session-identity — bin/land refused a dirty main checkout
---

Closed 2026-08-29 by this commit (`fix(schedules): unstage reports after commit failure`): failed report commits now path-scope a `git restore --staged`, while preserving the written report and surfacing cleanup failure.

`schedules/full-suite/run.ts` files an issue when `main` goes red, then
`git add` + `git commit -- <paths>` in the main checkout (`run.ts:246-258`).
The report body pastes tap's failure block verbatim, which carries absolute
paths (`/Users/<name>/.nvm/...`, the temp checkout under `/private/var/...`).
The root `path-leak-check` pre-commit hook rejects real home-dir paths in any
tracked file, so the schedule's commit fails and the file is left **staged**
in the main checkout.

Consequences, observed 2026-08-26 with
`issues/bugs/2026-08-26-full-suite-red-model-engine-policy-a6d93a90.md`:

- The red-suite report never lands in git, so the workstream it names never
  sees it.
- `bin/land` refuses to merge into a dirty main checkout, so every later
  landing from any worktree is blocked until a human clears the file. The
  file was moved to the main checkout's gitignored `scratch/` to unblock; its
  content (main red on `test/field-test/run.doctest.md` after `a6d93a90b`,
  workstream model-engine-policy) still needs to reach that workstream.

Fix direction: scrub or elide absolute paths in the embedded tap block before
writing (the `cwd`/`args` lines carry no diagnostic value; the failing file
and the assertion diff do), and treat a failed commit as an alert in the run
report rather than leaving staged state behind.

---
title: "bin/theme-check runs fail on first open, on a parallel run, and on a source edit"
workstream: theme-check-gate
area: beebox
labels: [themes, theme-check]
filed-by: agent
discovered-by: agent
discovered-in: worktree-retrospective — retrospective 20261113-003305
resolution: implemented
---

**Closed (implemented, 2026-11-15):** Implemented in 5631c13ae: bounded studio readiness, process-scoped sessions and captures, clear source/reload errors, and last-completed-run failure retries. A cold first open and two concurrent one-job runs passed; an edit after the first capture exited 2 and preserved the previous retry record. Claude reviewed the opening and failure diagnostics.

A full `bin/theme-check --all` run takes 15 to 20 minutes. One workstream lost
a run to each of these:

- The first run after a worktree wakes fails with "the studio has no
  #bbx-theme-studio-scroll"; the runner does not wait for the element.
- Two runs at once share the session names `theme-check-1..N` and crash each
  other.
- Editing a shared frontend component during a run reloads the studio and
  crashes the run.

Wanted: wait for the studio scroll element on open, namespace session names
per process, and detect a reload (fail with a clear message, or refuse to start
with uncommitted frontend edits). A mode that reruns only last run's failures
was also asked for.

Evidence: `card-ink-dark-themes/20261112T151500Z-implemented.md`,
`card-ink-dark-themes/20261112T155821Z-review-adjudicated.md`.

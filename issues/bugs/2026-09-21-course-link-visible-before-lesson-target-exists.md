---
title: "A new course exposes a Lesson Plan link before its target exists"
workstream: unattached
area: beebox
filed-by: agent
discovered-by: agent
discovered-in: worktree-journey-walk — journey D authoring timeline
priority: backlog
---

While the assistant built a course, its visible Lesson Plan link opened a
“Card not found” page. The same link worked later. The user had followed a
visible link, not guessed a path or supplied an invalid reference.

The disposable journey's root-chat transcript establishes the write order:

- 12:00:51.706Z: the command writing the course manifest completed. It already
  contained the Lesson Plan reference.
- 12:01:50.942Z: screenshot 09 recorded the missing target at that exact path.
- 12:02:04.939Z: the command first writing the Lesson Plan completed.
- 12:04:05Z: screenshot 13 showed the same target opening successfully.

These are tool-result and screenshot times, not inferred file-creation times
from a Git commit. The target appears in the first course commit `b93bf20`.
The final reference is correct; the authoring sequence exposed an incomplete
set of linked files to a person who was already navigating it.

Evidence: [journey D report](../../beebox/user-stories/journeys/D-chemistry/reports/2026-09-21.md),
notes 8 and 10. The retained run is `D-chemistry-2026-09-21`; transcript tool
IDs `toolu_01YERQrSM3fdKZi4TcWPgi6g` and `toolu_018zfcL6WQ5m7ETD7s1KyqYK`
identify the writes. No product change was made.

A safer authoring order or a visible in-progress state could address this.
This evidence does not establish a need for transactional filesystem machinery.
Related: [no visible in-progress document edit state](2026-08-25-companion-doc-shows-no-sign-it-is-being-edited.md).

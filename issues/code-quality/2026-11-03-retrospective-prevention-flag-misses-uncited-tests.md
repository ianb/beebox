---
title: "Retrospective packet marks an escaped bug 'prevention: no' when the fix commit added a test but did not cite the issue"
workstream: unattached
area: monorepo
labels: [retrospective]
filed-by: agent
discovered-by: agent
discovered-in: worktree-retrospective — retrospective 20261103-231838
---

`schedules/retrospective/lib.ts` decides prevention from main commits that
cite or move the escaped bug's issue file. A fix commit that adds a test but
names only the symptom is missed.

Seen twice:

- Packet 20261007-221339: 3 of 4 escaped bugs had tests added by fix commits
  that cited only the bug text or a commit hash.
- Packet 20261103-231838: `issues/features/2026-11-01-large-box-mode.md` was
  flagged "prevention: no". Commit 4ab757329 (same day, same symptom) added
  `beebox/test/core/nav-counts.test.ts` and did not cite the issue.

Options: also count commits in the window that touch a path the issue body
names and add a prevention path (`isPreventionPath`); or ask fix commits to
cite the issue they fix (the finish agent already closes cited issues). The
retrospective's prompt does not let the session edit schedule code, so this is
filed rather than fixed.

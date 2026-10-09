---
title: "A course session cannot open with the tutor speaking first"
workstream: unattached
area: beebox
filed-by: agent
discovered-by: agent
discovered-in: worktree-journey-walks-oct — D-chemistry journey walk, 2026-10-08
---

Job: a learner opens a study session on a course and the tutor starts it,
for example with the cold check the course plan calls for. In the D-chemistry
walk "New chat" opened an empty conversation. The tutor did not start, and the
learner had to know what to type.

## Mechanism

No agent-first turn exists. A chat's openers come only from the briefing card
in that directory (`beebox/src/webapp/trpc/routers/chat/router.ts:104-131`).
The attach scope of a course has no briefing, so no openers appear. The
[fresh-chat reservation bug](../closed/bugs/2026-09-21-fresh-chat-reservation-suppresses-openers.md)
would hide openers there anyway.

## Open question

Options: let the course's `CLAUDE.md` or landmark name a first message the
chat sends on open, or let the course build a briefing in its attach scope.
Either needs a rule for who may start a turn without the person typing.
Related: [course study home](2026-09-21-course-study-home-last-next-uncertain.md).

Report: [D](../../beebox/test/user-stories/journeys/D-chemistry/reports/2026-10-08.md) (row 67, shot 22).

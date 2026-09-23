---
title: "Chemistry progress summary still says the completed fluoride exercise is outstanding"
workstream: unattached
area: beebox
labels: [courseware, progress]
filed-by: agent
discovered-by: agent
discovered-in: worktree-journey-walk — D chemistry journey saved-state review
---

The Chemistry Foundations progress card has contradictory saved state after the
second session. Its structured entries record that the learner completed the
fluoride and oxygen-18 exercise, including the both-at-once case, and the
lesson plan marks that segment `Done 2026-09-21`:

- `_content/courses/Chemistry_Foundations.attach/Chemistry_Foundations_Progress.progress.card:14`
- `_content/courses/Chemistry_Foundations.attach/Chemistry_Foundations_Progress.progress.card:22`
- `_content/courses/Chemistry_Foundations.attach/Chemistry_Foundations_Lesson_Plan.lesson-plan.card:17-20`

The same progress card still ends its `Where they are` summary with:

> Outstanding: the fluoride and oxygen-18 exercise, set unworked at their request
> and unreviewed as of the end of the first session.

That summary is stale after commit `5933b49` (`First chemistry session: recap
card, corrected isotope rule, progress`), which adds the all-correct exercise
evidence. The course card's adaptation log retains its original ungraded setup entry
(`_content/courses/Chemistry_Foundations.course.card:68-73`); that historical
entry is context, not independently a stale-current-state defect.

The result is misleading self-study guidance: a later reader may repeat an
exercise that the detailed record says is complete. The summary should agree
with the structured entries while preserving the separate warning that all
ratings are same-session evidence and that delayed recall remains untested.

Evidence: [journey D report](../../beebox/user-stories/journeys/D-chemistry/reports/2026-09-21.md).

## Candidate authoring guidance

`beebox/src/schemas/progress.ts:87–89` calls the body a short running summary;
`beebox/src/core/box/skills-content.ts:111–113` asks the course runner to update
progress with evidence. A focused remedy to evaluate is making the body/entry
synchronization requirement explicit when an assessment changes. These are
locatable guidance surfaces, not proof that their wording caused this failure
or that one extra instruction will reliably prevent it. This run only files
the reproduced saved-state contradiction; it does not change the agent contract.

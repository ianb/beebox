---
title: "A course needs a learner-facing study home"
workstream: unattached
area: beebox
labels: [journey-findings, courseware, ui]
filed-by: agent
discovered-by: agent
discovered-in: worktree-journey-walk — D chemistry journey, 2026-09-21
priority: backlog
---

When a learner returns to a course, they need one readable place that answers
three questions: what happened last time, what should I try next, and what is
still uncertain. The chemistry course made those facts available across chat,
recap, progress, lesson-plan, landmark, and Plate cards, but the learner had
to navigate among cards whose fields and instructions were written for the
tutor. They said they wanted a simple study home with “last time / try next /
still unsure.”

This is a courseware surface and continuity feature. It is separate from
deciding which technical metadata belongs under Properties: hiding metadata
would not create a place to resume study or explain uncertainty. It is also
separate from the existing issue about stale completed exercises in the
progress summary; this request concerns the learner-facing entry point and
its synthesis of current state.

## Research (2026-09-21)

The journey returned successfully to the chat and found the next task through
The Plate, and the recap contained useful corrected explanations. However, the
learner still had to interpret tutor-facing courseware cards and reconcile
the current next task with older progress text. The closing chat did provide a
clear next step, but no single course view in the walk collected all three
questions. The person did not ask the assistant to build a custom study-home
page, so this is a discoverability and default-surface request, not proof that
such a page cannot be authored.

Evidence: [D chemistry report](../../beebox/test/user-stories/journeys/D-chemistry/reports/2026-09-21.md),
especially entries 8-14 and 18-20; screenshots 08, 11-13, 16-19, 22, and 24.

## Re-encounter 2026-10-08 (journey walks)

Partly met in the [D-chemistry walk](../../beebox/test/user-stories/journeys/D-chemistry/reports/2026-10-08.md) (closing summary). Met, unasked: the progress body now opens "Where you left off … Next time … Not yet in the box", and the landmark links it first as "where I left off". The walker called it "the right size". Still missing: (1) the per-idea table and probes sit in Properties, not on the page front (row 30, `S/schemas/progress.ts:47`, `F/lib/card-field-faces.ts:56`); (2) the tutor-facing session plan is on the learner's landmark and speaks of the learner as "they" (row 41, `beebox/src/core/box/guidance-sync/skills-content.ts:33`, step 7 at `:97`); (3) the page has three names: "where I left off", "what I've shown", "your progress card" (row 74); (4) the counting advice and magnesium check stayed in the transcript, in no card (row 52); (5) a new session does not open with the tutor (row 67; own issue). The priority may be stale given the recurrence.

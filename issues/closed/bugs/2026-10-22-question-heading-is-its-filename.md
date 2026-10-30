---
title: "A question on the Questions page is headed by its filename (\"what-to-keep-track-of\")"
workstream: unattached
area: beebox
filed-by: agent
discovered-by: agent
discovered-in: worktree-journey-walks-late-oct — H-handover and I-deciding walks, 2026-10-22
resolution: implemented
---

Resolved 2026-10-22 by the journey-walks-late-oct fix commit. The question's prompt is the heading; the repeated line is gone.

The root question of a new box is headed "what-to-keep-track-of" on the Questions page and on its card. The real prompt, "What do you want to keep track of here?", is the next line. The I-deciding walker called the heading "a code-ish name".

Reports: [H-handover](../../../beebox/test/user-stories/journeys/H-handover/reports/2026-10-22.md) (row 24), [I-deciding](../../../beebox/test/user-stories/journeys/I-deciding/reports/2026-10-22.md) (row 32).

## Mechanism

`QuestionForm` shows `question.name` as the `h2` (`beebox/src/frontend/src/components/questions/QuestionForm.tsx:53-55`). The name is the card's filename stem. The [place page heading fix](2026-10-09-place-page-heading-uses-filename-not-label.md) covers landmark cards only.

## Why the fix is not obvious

The prompt is already on the page, so a heading from the prompt repeats it. Options: use the prompt as the heading and drop the line below it; or use a short title field when a question has one. The `h2` keeps the page's heading order (see the closed axe heading-order fix for `/questions`).

Related: [seeded briefing titled by its filename](2026-10-22-seeded-briefing-titled-by-its-filename.md).

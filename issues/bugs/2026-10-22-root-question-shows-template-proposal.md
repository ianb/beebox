---
title: "The root question shows its template sentence \"This box is for <what the person said>.\""
workstream: unattached
area: beebox
labels: [onboarding]
filed-by: agent
discovered-by: agent
discovered-in: worktree-journey-walks-late-oct — H-handover and I-deciding walks, 2026-10-22
---

Every new box asks "What do you want to keep track of here?". On the Questions page and on the question card, under "What the box is trying to learn", the person sees the literal text "This box is for <what the person said>." The H-handover walker called it a "raw placeholder". The I-deciding walker: "a blank template with the angle brackets showing, looks unfinished."

Reports: [H-handover](../../beebox/test/user-stories/journeys/H-handover/reports/2026-10-22.md) (row 22; shot 09), [I-deciding](../../beebox/test/user-stories/journeys/I-deciding/reports/2026-10-22.md) (row 30).

## Mechanism

- `installRootQuestion` writes a template sentence as `learning.proposal` (`beebox/src/core/box/structure/root-question.ts:43`).
- `QuestionForm` prints `learning.proposal` as it is (`beebox/src/frontend/src/components/questions/QuestionForm.tsx:66-71`). `QuestionCardView` does the same (`beebox/src/frontend/src/components/QuestionCardView.tsx:60-65`).

The question schema describes `proposal` as the belief being tested. A template with a slot is not a belief.

## Why the fix is not obvious

The follow-up job copies `proposal` into its `learning:` block. Check `beebox/src/schemas/question-followup-job.ts` before changing the text. Options: a sentence that reads as a belief ("The box does not know yet what it is for."); or no `proposal`, with the purpose carried by the directive alone. Boxes that already hold the question keep the old text unless a migration or template sync changes it.

The same line holds the broken `learning.ref` of [fresh box root question ref is broken](2026-10-22-fresh-box-root-question-ref-is-broken.md). That is a different field and a different defect; fix them together.

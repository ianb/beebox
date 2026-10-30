---
title: "A fresh box fails bbx validate: the root question's learning.ref is not root-relative"
workstream: unattached
area: beebox
filed-by: agent
discovered-by: agent
discovered-in: worktree-journey-walks-late-oct — testing a journey setup on a throwaway box, 2026-10-22
resolution: implemented
---

Resolved 2026-10-22 by the journey-walks-late-oct fix commit. The seed writes `/_content/briefing.briefing.card`; migration `root-question-2026-10` corrects existing cards.

`bbx validate` on a box made by `bbx engine init`, with nothing else changed, reports one warning:

```
_bookkeeping/questions/what-to-keep-track-of.question.card
  warning: Broken reference at learning.ref: _content/briefing.briefing.card does not exist
```

The card does exist. `installRootQuestion` (`beebox/src/core/box/structure/root-question.ts:43`) writes `ref: "_content/briefing.briefing.card"` with no leading `/`. The validator resolves a ref without the leading `/` against the card's own directory, so it looks for `_bookkeeping/questions/_content/briefing.briefing.card`. The `/`-leading form (`/_content/briefing.briefing.card`) is the root-relative authoring form (`beebox/src/shared/box-path.ts`).

Every new box therefore starts with a validation warning. An agent that runs `bbx validate` on a new box sees a fault it did not cause. The fix is probably a one-character change, plus a migration or a tolerant reader for boxes that already hold the question. Check how the question follow-up job reads `learning.ref` (`beebox/src/schemas/question-followup-job.ts`) before changing the form.

Related: [retro sinkRef shape](../../bugs/2026-08-12-retro-sinkref-invalid-path-and-shape.md).

## Re-encounter 2026-10-22 (journey walks)

Present in every walk box made from `bbx engine init`. [A-lending](../../../beebox/test/user-stories/journeys/A-lending/reports/2026-10-22.md) (R3): after the walk, `bbx validate _bookkeeping/questions/what-to-keep-track-of.question.card` reports the broken reference. The box agent answered the question with `bbx answer --via chat` and validated only its own files, so it did not meet the warning. [I-deciding](../../../beebox/test/user-stories/journeys/I-deciding/reports/2026-10-22.md) (row 31): the card carried the same ref; nothing resolved it, because the chat never answered the question and the web answer's follow-up job never ran (journey boxes are not ticked). The same line's `learning.proposal` is a separate defect: [root question shows template proposal](2026-10-22-root-question-shows-template-proposal.md).

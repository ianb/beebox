---
title: "A fresh box fails bbx validate: the root question's learning.ref is not root-relative"
workstream: unattached
area: beebox
filed-by: agent
discovered-by: agent
discovered-in: worktree-journey-walks-late-oct — testing a journey setup on a throwaway box, 2026-10-22
---

`bbx validate` on a box made by `bbx engine init`, with nothing else changed, reports one warning:

```
_bookkeeping/questions/what-to-keep-track-of.question.card
  warning: Broken reference at learning.ref: _content/briefing.briefing.card does not exist
```

The card does exist. `installRootQuestion` (`beebox/src/core/box/structure/root-question.ts:43`) writes `ref: "_content/briefing.briefing.card"` with no leading `/`. The validator resolves a ref without the leading `/` against the card's own directory, so it looks for `_bookkeeping/questions/_content/briefing.briefing.card`. The `/`-leading form (`/_content/briefing.briefing.card`) is the root-relative authoring form (`beebox/src/shared/box-path.ts`).

Every new box therefore starts with a validation warning. An agent that runs `bbx validate` on a new box sees a fault it did not cause. The fix is probably a one-character change, plus a migration or a tolerant reader for boxes that already hold the question. Check how the question follow-up job reads `learning.ref` (`beebox/src/schemas/question-followup-job.ts`) before changing the form.

Related: [retro sinkRef shape](2026-08-12-retro-sinkref-invalid-path-and-shape.md).

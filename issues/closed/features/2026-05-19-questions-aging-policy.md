---
title: "questions aging policy"
area: callback-box
resolution: implemented
---

**Closed 2026-07-10:** Implemented in `src/core/question-aging.ts` (the
aging sweep, Track D of `docs/implemented-plans/questions-end-to-end.md`) — nudge once
at 7 days pending (default), expire at 30 days pending (default), both
overridable per-question via `expires-after:`. Expiry sets `status:
expired` + `expired-at` and demotes the question from the active
list/header count/notifications; it never auto-answers, and an expired
question stays answerable (demote, don't close — matches the sketch below).
See `docs/questions.md` § Aging.

We already have a notion of questions/answers the agent surfaces to the boxholder; the piece probably missing is an operational aging policy so the queue actually drains rather than accumulating dead items. Sketch (numbers tunable):

- **7 days unanswered** — proactive nudge. The agent surfaces the item again, possibly in a different channel.
- **30 days unanswered** — auto-close with a note. Mark as abandoned, not answered. Future-agent can see it was asked and dropped, which is itself a signal (this kind of question tends to go unanswered → maybe stop asking it).
- **Per-item override.** Some questions are time-sensitive (decisions before a date) and should escalate faster; some are evergreen and shouldn't auto-close at all. The default policy is for the middle case.

Auto-close behavior is the non-obvious part: silent decay loses information; flagged abandonment preserves the signal that the question was asked and got no traction.

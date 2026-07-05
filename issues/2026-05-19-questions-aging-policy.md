---
area: callback-box
---

# Aging policy for the questions/waiting queue

We already have a notion of questions/answers the agent surfaces to the boxholder; the piece probably missing is an operational aging policy so the queue actually drains rather than accumulating dead items. Sketch (numbers tunable):

- **7 days unanswered** — proactive nudge. The agent surfaces the item again, possibly in a different channel.
- **30 days unanswered** — auto-close with a note. Mark as abandoned, not answered. Future-agent can see it was asked and dropped, which is itself a signal (this kind of question tends to go unanswered → maybe stop asking it).
- **Per-item override.** Some questions are time-sensitive (decisions before a date) and should escalate faster; some are evergreen and shouldn't auto-close at all. The default policy is for the middle case.

Auto-close behavior is the non-obvious part: silent decay loses information; flagged abandonment preserves the signal that the question was asked and got no traction.

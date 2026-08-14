---
title: "Capture feedback / comment on a chat conversation, not just on cards"
workstream: unknown
area: callback-box
filed-by: agent
discovered-in: main session — split out of the closed chat-page-improvements item
priority: normal
---

> **Job to be done:** *When something in a chat goes wrong or well — the agent
> misread me, produced a great summary, took a weird action — I want to leave
> feedback on that conversation right there, the same way I can flag feedback on a
> card, so it's captured for review instead of lost or re-explained later.*

Today feedback is captured on **cards** (the existing feedback flow). Extend it so a
**chat** is a first-class feedback target too — comment on / capture feedback from a
chat conversation (a turn, a message, or the session as a whole), routed into the
same feedback pipeline the card path uses.

Split out of the now-closed **chat-page-improvements** item, whose concrete pieces
all shipped or were dropped — this is the one real remaining idea from it.

## Open questions (to design when picked up)

- **Granularity:** feedback on a whole session, a single turn/message, or both? (A
  per-turn affordance is more precise but more UI; session-level is simpler.)
- **What gets captured:** a reference to the chat + the specific turn(s), plus the
  user's comment — NOT necessarily the full transcript inline (privacy/size, same
  posture as capture chips reference rather than embed).
- **Reuse the card feedback pipeline** rather than a parallel one — pin exactly how
  card feedback is captured/stored today and route chat feedback through the same
  sink (feedback items, `feedback-review/`).
- Where the affordance lives (a per-message action, the chat header, the `+`/overflow
  menu) and how it reads on mobile/iOS.

## Related

- The card feedback flow (the existing mechanism this mirrors) — pin its entry point
  and storage when designing.
- `issues/features/2026-07-20-inline-bug-submission.md` and the
  `questions-as-inline-annotations` exploration — adjacent "annotate/flag in place"
  ideas; check for overlap before building.

---
title: "The agent keeps an ideas page for its box, thinking ahead about what it could do next"
workstream: unattached
area: beebox
labels: [proactive, retro]
filed-by: agent
discovered-by: Ian
discovered-in: main — boxholder reviewing Muse's "ideas" page, 2026-09-25
---

The boxholder was impressed by the ideas page in Muse (a consumer assistant).
It is a browsable, curated page of things the assistant could do for you,
grouped by area of life (Relationships, Shopping, Health & Fitness,
Productivity, …) and written as first-person pitches. The boxholder's idea
for beebox: **the agent maintains an ideas page for its own box**, for
example during retro. It thinks ahead about what it could do for this person,
given what is in the box.

## What Muse does well

Each pitch has the same three parts:

1. **The outcome as the headline**: "I can get you money back when a price
   drops on an item you bought."
2. **How it works**, in two or three sentences, concrete about inputs
   ("Send me the after-visit summary and I read what's due and by when").
3. **The guardrail**, where one applies: "Anything that costs money, I clear
   with you first." "Checking with you before I commit."

The page is a place a person goes on their own, not an answer that exists
only when they think to ask.

## What we have

`beebox/docs/box/what-you-could-do.md` (shipped as a package doc) holds
generic ideas, written for the agent to draw on when someone asks what the
box can do. People never see it, and it is the same for every box.

Retro (`beebox/src/core/retro/`) already walks sessions after they go quiet
and extracts observations. It is the natural place for a thinking-ahead step:
it sees what the person keeps doing, asking about, and struggling with.

## The shape

- An ideas card (or a small set of cards) in the box, visible to the person,
  that the agent adds to and prunes. Each idea is specific to this box: it
  names the person's actual cards, connectors, and habits, not a generic
  capability.
- Written in the Muse template: outcome, how, guardrail.
- Retro, or a similar quiet-time pass, proposes new ideas from what it
  observed, and retires ideas the person ignored or that became done.
- Clicking an idea starts a conversation about it. It never starts the work
  unprompted, matching `what-you-could-do.md`'s rule that interest leads to a
  conversation first.

## Scope notes from the discussion (2026-09-25)

- **No completing transactions.** The boxholder is not interested in the
  agent booking, buying, cancelling, or paying on their behalf; it is too hard.
  Ideas stop at preparing, drafting, watching, and alerting.
- **No bank or card data.** Many of Muse's finance ideas depend on
  transaction data, and connecting banks is too hard. Leave that category out.
- Many of Muse's ideas already fit beebox: pet schedules, ID renewals,
  doctor follow-ups from a scanned summary, returns tracked from email, trip
  itineraries from confirmations, a family trivia night as a view on the TV,
  a daily quiz with an archive. Several depend on
  [proactive notifications](2026-08-09-agent-outcomes-need-a-voice.md), which
  do not work yet.

## Related

- [Draft-ahead surface pattern](2026-07-08-draft-ahead-surface-native-pattern.md):
  the reactor stages a ready artifact on a card's surface. That is the same
  thinking-ahead instinct, applied to a single artifact.
- [Retrospective session scan](2026-05-28-retrospective-session-scan.md).

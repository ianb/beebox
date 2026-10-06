---
title: "Target a few specific, underserved use cases, each with a clean implementation and an easy way to start"
workstream: unattached
area: beebox
needs: [design, decision]
next-action: discuss
filed-by: agent
discovered-by: Ian
discovered-in: main — boxholder request for a design discussion
priority: important
---

Bee Box is general: cards, chat, connectors, schedules, views. A new user meets
an empty box and must invent their own use for it
([first-run experience](../features/2026-07-20-first-run-experience.md),
[front door](../features/2026-08-23-first-screen-says-nothing-about-what-this-is.md)).
The boxholder wants to pick a few specific use cases and serve them well.

Criteria from the boxholder:

- **Real and underserved.** A use case does not need to be wide. It must be a
  real need that current products serve badly.
- **Fits Bee Box.** It uses what the box does well: local files and cards, an
  agent that works on a schedule, connectors, and private household data.
- **Clean implementation.** The use case works end to end without the user
  assembling parts.
- **Easy to start.** A specific way to begin with that use case, such as a
  starter that sets up the cards, views, schedules, and connector prompts it
  needs.

## Questions for the discussion

- Which use cases? Candidates already in the repo:
  - The user-story journeys in `beebox/test/user-stories/journeys/`: A lending
    ("remember who has my stuff"), B inventory, C reconnecting, D chemistry,
    F newcomer. Each journey is already one person with one goal.
  - Meal planning and grocery ordering
    ([meal-prep thread review](../exploration/2026-10-04-reddit-meal-prep-automation-ideas.md)):
    a weekly plan, thaw reminders, freezer stock, and order reconciliation.
  - Scanned-paper filing (the scan uploader and Docling pipeline).
- What "get started" is. Options: a starter pack (cards, views, schedules, and
  an agent briefing) applied to an existing box; a first-run choice; or a
  chat opener that sets the use case up by conversation. Box content
  templates exist (`beebox/src/core/box/templates.ts`); whether a starter
  extends them or is a separate thing is open.
- How to judge "clean": a journey walk per use case is the existing evidence
  method, so each chosen use case could get a journey that must pass.
- How many to pick first. One done well proves the starter mechanism before a
  second one.

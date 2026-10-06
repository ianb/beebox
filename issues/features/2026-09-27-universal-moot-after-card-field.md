---
title: "A universal card field that says when a card stops mattering (\"moot after\")"
workstream: unattached
needs: [design]
area: beebox
labels: [cards, schema]
filed-by: agent
discovered-by: Ian
discovered-in: main — boxholder discussion, 2026-09-27
priority: important
---

Many cards stop mattering at a known time: an event notice after the event,
a travel plan after the trip, a "call about X by Friday" note, a sale or
deadline. After that time the card is still true as history, but it should
stop competing for attention. Today nothing on a card can say this, so a
moot card stays in listings, search results, and agent context the same as a
live one.

The developer proposed a universal field, available on every card type, that
states the time after which the card is moot.

## What exists

- Global card fields live in `GLOBAL_CARD_FIELDS`
  (`beebox/src/cards/schema.ts:100`): `title`, `contains`,
  `contains-evidence`, `todos`, `symbol`, `prominence`, `theme`. A new
  universal field goes there. The comment above it lists the docs to update.
- `prominence` (`src/shared/prominence.ts`) already says how much the box
  surfaces a card: `entry-point`, `primary`, or `background`. A moot card
  is close to "background from this time on". The design must decide
  whether the new field is separate or a time-based change of prominence.
- Three card types already have their own version of this:
  - `question` has `expires-after`, an ISO-8601 duration
    (`src/schemas/question.ts:168`).
  - `procedure-run` has `expires`, a date or `never`, which marks when
    `bbx procedure gc` may delete the run directory
    (`src/schemas/procedure-run.ts:65`). This one means deletion, not
    irrelevance.
  - `scheduled-script` has `until`, when the schedule stops firing.

## Open design questions

- **Name.** The developer prefers `expires` over "moot" (2026-09-27).
  `procedure-run` already has `expires` with a narrower meaning: after that
  date `bbx procedure gc` may delete the run directory. Either rename that
  field (for example to `delete-after`), or define the universal `expires`
  as "stops mattering" and let `procedure-run` treat deletion as what
  expiry means for its type. Do not leave one name with two meanings.
- **Value.** An absolute date-time, a duration from creation (like
  `expires-after`), or both.
- **Effect.** What each surface does with a moot card: listings, search
  ranking, the plate and todo views, landmark pages, and the agent guide or
  context. Moot must not mean deleted or hidden from direct access.
- **Relation to the per-type fields.** Whether `question.expires-after`
  becomes this field or stays separate, and whether `todos` on a moot card
  still count.
- **Who sets it.** The boxholder, the agent when it files the card, or both.
  Agent-set values need guidance in the agent guide so the field is used
  where a card has a real end time and not added to every card.

## Related

- The general-ontology idea from the same discussion: "moot" is a
  shared concept that several card types express differently, which is the
  kind of drift a shared domain model would catch.

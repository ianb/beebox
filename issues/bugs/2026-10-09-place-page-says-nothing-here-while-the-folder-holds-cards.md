---
title: "A place page says \"Nothing here yet\" while its folder holds the person's cards"
workstream: unattached
needs: [decision]
area: beebox
filed-by: agent
discovered-by: agent
discovered-in: worktree-journey-walks-oct — D-chemistry, A-lending, B-inventory, C-reconnecting, F-newcomer journey walks, 2026-10-09
---

Arrival now opens the root place page. After the agent saves a card, that page
can still say "Nothing here yet. This place is the folder /. Ask in the chat to
add the first card." This was the walkers' largest complaint of the round.

- C-reconnecting: the page said it on four visits and a doc card with two open
  todos sat in the box. Stop reason: "Nothing here yet" three visits in a row.
- D-chemistry: the page stayed empty after the agent said "Created". The walker:
  "If I came back and only saw this I'd think everything was lost."
- F-newcomer: three content cards in the box. The walker: "If I came back
  tomorrow and landed on this, I'd think it had lost everything."
- D-chemistry (second walk): the page stayed empty for 5.3 minutes while the
  course card existed. It filled when the agent added a Chemistry landmark.
- B-inventory: a capture card sat in `_content/tmp-capture/`, and the page
  still said nothing. That folder is a holding area, so listing it is arguably
  wrong; the walker still read "nothing" as "lost".

## Mechanism

A place page lists only cards marked `entry-point` or `primary`, the places
inside it, pinned links, and `expand` groups
(`beebox/src/schemas/landmark.ts:250`;
`beebox/src/frontend/src/components/PlaceView/sections.ts:31-39`). When all of
those are empty, `placeSections` returns `empty`, and `EmptyPlace` prints the
copy (`beebox/src/frontend/src/components/PlaceView/view.tsx:55-66`). An
unmarked `doc` card in a folder with no landmark appears in no tier. The agent
has no reason to mark it: the marking rule lives in the landmark schema
guidance, which the agent does not read when it saves an ordinary card.

## Decision needed

What should a place page list for a card nobody marked?

1. List every card in the folder that is not in a tier, as a last tier
   (for example "Also here"). Then "Nothing here yet" is true. A busy folder
   needs a cap or a fold. The capture holding folder needs an exclusion.
2. Keep the tiers. Make the agent mark what it saves, by a rule in the schema
   or briefing guidance. This depends on agent behavior in every walk.
3. Keep the tiers. Change the empty copy so it does not claim the folder is
   empty when it holds unmarked cards.

Option 1 matches what the person expects of a "place". The tiers were designed
so a place stays short ([landmark arrival](../../beebox/docs/implemented-plans/landmark-arrival.md),
Track C), so the choice is a design call.

Related: [first-screen-says-nothing-about-what-this-is](../features/2026-08-23-first-screen-says-nothing-about-what-this-is.md)
(partly met by arrival; this is what the arrival page then shows).

Reports: [D-chemistry](../../beebox/test/user-stories/journeys/D-chemistry/reports/2026-10-09.md) row 26,
[D-chemistry second walk](../../beebox/test/user-stories/journeys/D-chemistry/reports/2026-10-09-2.md) row 15,
[C-reconnecting](../../beebox/test/user-stories/journeys/C-reconnecting/reports/2026-10-09.md) rows 14 and 69,
[F-newcomer](../../beebox/test/user-stories/journeys/F-newcomer/reports/2026-10-09.md) row 65,
[B-inventory](../../beebox/test/user-stories/journeys/B-inventory/reports/2026-10-09.md) row 23.

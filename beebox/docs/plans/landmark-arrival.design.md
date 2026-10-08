---
title: "Landmark arrival: design"
status: draft
workstream: journey-walks-oct
issues:
  - ../../../issues/bugs/2026-10-08-landmark-switch-opens-empty-chat-not-the-place.md
  - ../../../issues/bugs/2026-10-08-landmark-card-shows-its-config-not-its-places.md
---
# Landmark arrival: design

**Parent plan:** none yet. Evidence: the 2026-10-08 journey walks
([A-lending](../../test/user-stories/journeys/A-lending/reports/2026-10-08.md),
[B-inventory](../../test/user-stories/journeys/B-inventory/reports/2026-10-08-2.md),
[D-chemistry](../../test/user-stories/journeys/D-chemistry/reports/2026-10-08.md)).

People treat a landmark as a place. Every way they tried to go to one ended in
an empty chat or in the landmark's configuration. This design says what a
person meets when they arrive at a place, by either route: the place menu, or
a link to the landmark card.

## Situations

- When Tomas is in the hardware store wondering whether Bram still has the
  good tape measure, I want to pick "Lending" and see who has what, so I can
  answer in a glance without typing a question.
- When Priya opens the "Swim" place on Monday morning, I want the schedule
  card she set up as the front door in front of her, so she sees the week
  before she decides whether to say anything.
- When Wren taps "Chemistry" in a chat reply, I want to see what that place
  holds (where she left off, the lessons), so she can pick up where she was.
- When Tomas opens Lending to record that he just lent Saoirse the drill, I
  want "Log a new loan" right there, so the first message is one tap and he
  does not have to remember how he phrased it last time.
- When Priya goes back to the Swim chat where she had three cards open an
  hour ago, I want those cards as she left them. She does not want a page
  pushed in front of her work. (The quiet case.)
- When Juni has just made a "Garden" place with nothing in it yet, I want the
  place to say it is empty in plain words and leave the chat ready, so she
  starts talking instead of hunting.

## Right place, right time

| Situation | Act, show, or quiet | Surface and card | Attention |
|---|---|---|---|
| Tomas, hardware store | Show | Place menu → fresh chat with the entry-point card ("Lending list") open beside it | Waits to be found: it is what he asked to see |
| Priya, Monday | Show | Same: the entry-point card | Waits to be found |
| Wren, chat link | Show | The landmark card, rendered as the place page: its links, grouped | Waits to be found |
| Priya, back to her chat | Quiet | The chat's own saved cards, unchanged | Nothing new |
| Tomas, new loan | Show | Place page "Start something" group, and the empty chat's openers | Waits to be found |
| Juni, empty place | Show | Place page: "Nothing here yet" and the folder; chat composer ready | Waits to be found |

Two rules follow. **Arriving at a place with no cards open opens the place.**
That is the entry-point card when the place has exactly one, otherwise the
place page. **A landmark card, wherever it is opened, renders as the place
page**: the place's symbol and label, then its links in the existing tiers
(entry points, primary cards, curated links, expanded items, each group
labeled). Its fields stay under Properties.

**A place carries its own openers.** Openers move from the folder's briefing
card to the landmark (`openers:`), one concept in one place. They show in two
spots: a "Start something" group at the top of the place page, and on an empty
chat in that place, where today's fresh-chat bug hides them. Clicking one sends
it as the person's message. The root landmark holds the box's onboarding
openers. The agent maintains them as now: onboarding ones fade as the box is
used; a place's standing ones ("Who has what right now?", "Log a new loan")
stay as long as they are useful.

This changes one line of the current definition. [`landmarks.md`](../landmarks.md)
calls the landmark card "a place marker, not a visitable file". People visit it
anyway, from chat links and menu rows, so it must show the place when they do.
Browse still folds it into the directory's identity.

This does not change what the place menu means. It still resumes the place's
chat or starts one. It only stops that chat from opening onto nothing.

## Spirit

- **Serves:** "It should feel like a place." You arrive somewhere, and the
  things you put there are where you put them.
- **Risks:** "You should be able to see the gears." Hiding `query:` and
  `navigation:` behind Properties hides how the place decides what to list.
  Guard: each expanded group says in words what it lists ("Every loan card
  here"), and Properties still shows the fields.
- **Risks:** "It should feel possible." A page of links can feel finished, as
  if the place is a static list. Guard: the chat stays beside it, and an
  empty or thin place says the person can ask for more.

## Trust

Shows only, takes no action. No rung applies. The agent's existing choices
(which card is the entry point, what an `expand` lists) decide what appears;
the person changes them by asking, as today.

## When it goes wrong or does nothing

- **No links resolve** (new or empty place): "Nothing here yet." plus the
  folder's own name as a link. No stock cheer.
- **A link's target is gone:** the row stays, struck through, with the
  missing name. The place does not silently shrink.
- **More than one entry point:** arrival opens the place page, not a guess.
  `bbx validate` already warns on this.
- **An `expand` matches nothing:** its group shows "None yet" under its plain
  label, so the person can see the place expects such cards.
- **The person wanted the chat, not the page:** they close the panel; nothing
  else changed. The next arrival in that chat restores what they left.

## Walkthrough

Tomas, the A-lending box, one evening a month later.

1. He opens the box. The top bar's place menu lists "🤝 Lending".
2. He picks it. The box resumes Lending's last chat if it has one. That chat
   has no saved cards, so the place opens: "Lending list" is the entry-point
   card, and it opens as a panel beside the chat.
3. He sees "Mine, with other people (5)" with the stove, "needed by
   2026-10-17", at the top, and "good tape measure — Bram, not sure they have
   it" below.
4. He types "Bram says he never had it." The agent updates the loan card; the
   open list changes in place.
5. Nothing new is recorded by arriving. The record is the edit in step 4.

## Decided (2026-10-08)

The boxholder accepted the recommendations: a resumed chat with no saved cards
opens the place; a place with one entry point opens that card; the
fresh-chat opener bug is fixed with this work; "entry point, else place page"
is the default until a pinned baseline exists. The boxholder added openers on
landmarks. Moving `openers:` from briefings to landmarks needs a migration
(bbx-migration) and new agent guidance.

## Open questions (answered above)

1. Arrival into a resumed chat that has no saved cards: open the place (as
   above), or leave it empty?
2. A place with exactly one entry point: open that card (as above), or always
   the place page, with the entry point first in it?
3. Fresh chats in a place show no openers today
   ([issue](../../../issues/bugs/2026-09-21-fresh-chat-reservation-suppresses-openers.md)).
   Fix that with this work, so arrival shows the page and a first prompt?
4. The pinned-baseline idea
   ([issue](../../../issues/features/2026-09-08-landmark-scoped-pinned-card-baseline.md))
   would let a place name its own arrival cards. Is "entry point, else place
   page" the default until then?

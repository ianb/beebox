---
description: "Tell the box who the people in your life are and which places it should recognize, so it knows who and where you mean."
---
# People and places

An assistant that does not know who "Dad" is, or that "the office" is a specific
address, either asks you every time or guesses. The same name arrives differently
in an email, a calendar invitation, and a photo caption, and nothing connects
them. A **box** is one directory of your data, a **card** is one markdown file in
it, and **the agent** is the coding agent that reads those cards before it
interprets a name.

**What you do.** Name people as they come up: full name, the names you actually
call them, the relationship, contact details. Say which of them the box is
working for. Name places: Home, Office, the gym. Stand at a place and have the
box stamp your device's current location into that place's card.

**What the box does.** A person card holds the name, aliases, role, contact
fields, and freeform notes, with a flag marking the people the box serves. A
place card holds the name, aliases, a human-readable address, and optionally a
center coordinate and match radius, which the box writes from a device fix rather
than letting anyone type them. Once a place has coordinates, the box can say
which named place your location falls inside, so an agent turn can know you are
at Home. Briefings reference person cards as an area's key people, and records
name the people and location involved, so one person in twenty places is one
card.

**What it needs.** Nothing beyond the box; a device whose location the box can
read, for the coordinate stamp. [Cards](../concepts/cards.md),
[what it requires](../08-what-it-requires.md).

**Where it is still rough.** The location paths are verified in the code and have
not been exercised end to end in a checked box, so treat them as built rather
than proven. Coordinates must be stamped while you are at the place. Location is a radius
match against places you named, not tracking. Person cards are the box's own
contacts: the documentation describes no sync from a phone's address book or
Google Contacts.

**Read next.** [The glossary](../concepts/glossary.md),
[person](../reference/cards/person.md), [place](../reference/cards/place.md),
[briefing](../reference/cards/briefing.md),
[record](../reference/cards/record.md).

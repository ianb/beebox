---
description: "Put facts in as plain records now; give them proper fields later, without losing what did not fit."
---
# Dump it in now, shape it later

A box is a directory of your data, kept under version control with a full
history of changes (using git); a card is a markdown file with a structured
header; the agent is the coding agent (Claude Code or Codex) that operates
the box. You do not have to decide how to organize something before putting
it in: give the agent the facts in plain words, and it holds them as a
generic card until a shape is worth building.

**What it does for you**

- Puts things in as generic records or memos, one card per thing, holding
  the facts you gave in plain words.
- When the same kind of thing keeps showing up with the same detail, the
  agent proposes a card type with its own fields for it.
- Whatever does not fit a field stays on the card as your own words, not
  dropped.
- When a type's fields change, a migration reshapes the existing cards; they
  keep their data through the change.
- The checks that exist are on fields, so free text is never rejected for
  not fitting a shape.

**How it works, briefly**

A card's fields are checked against its type; a wrong or missing required
field is an error. The body of a card is free text, not checked at all. A
fact with nowhere else to go lives in the body until its type grows a field
for it. Changing a type's fields does not touch existing cards by itself; a
migration reshapes them, running under version control so the change is a
reviewable set of edits, not a silent rewrite.

**Limits**

A card's structured header can hold keys its type does not declare, but such
a key is dropped when the card is read and flagged for removal, so the
durable place for an unplaced fact is the body's free text, never a stray
field (for the curious: the loader is lenient rather than strict by design). Migrations are written by the agent
or a developer in response to a real change; the box does not reshape cards
on its own. The documentation does not say whether a proposed new type is
applied automatically or only after you agree to it.

**Go deeper**

[../reference/cards/record.md](../reference/cards/record.md),
[../reference/cards/memo.md](../reference/cards/memo.md),
[../concepts/cards.md](../concepts/cards.md),
[../dev/adding-a-card-type.md](../dev/adding-a-card-type.md),
[../dev/migrations.md](../dev/migrations.md),
[views.md](views.md)

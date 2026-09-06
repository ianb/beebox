---
title: "A box keeps its own symbol strategy — and agents read it before marking a card"
workstream: unattached
area: beebox
labels: [cards, agents]
filed-by: agent
discovered-by: Ian
discovered-in: "worktree-sidecar-shell — after cards gained a symbol field"
priority: normal
---

Cards can now carry a `symbol`
([cards-carry-a-symbol](../closed/features/2026-09-05-cards-carry-a-symbol.md)),
and the guidance an agent gets is per-card: use one rarely, keep it short. What
is missing is anything *per-box*. A mark is only useful in relation to the other
marks in the same box, so the interesting rules are ones no single card can
state:

- a symbol per card **type** (every recipe 🍳), so the mark says what kind of
  thing this is;
- a symbol per **group** (everything in one course, one project, one person's
  file), so a strip of tabs reads as a family;
- **uniqueness** — deliberately never reusing a mark, so a glyph identifies one
  card;
- something playful and box-specific — marks that **rhyme** with the card's
  subject, or a palette that means something to the boxholder.

The proposal: a short document the box owns — say `_bookkeeping/notes/symbol.md`
— that starts from stock instructions and is edited over time, by the boxholder
or by an agent that notices the box has drifted into a convention. An agent
about to mark a card reads it first.

## The tension, which is the reason this is exploration and not a feature

**We have been moving away from free-floating notes that an agent has to
remember to read.** Durable instruction lives where it loads itself: a box's
`CLAUDE.md`, a `.claude/rules/` glob that fires on the files it governs, or a
schema's `instructions` string injected into context when a card of that type is
processed (see the `bbx-context` skill for the placement rules). A note under
`_bookkeeping/notes/` has none of that: it is discoverable only if something
points at it, and "the agent should read X first" is the instruction most likely
to be skipped.

Evidence from this workstream, both directions:

- The `card-symbol-restraint` knowledge audit passed — the agent gave a good
  answer about when to mark a card — but it got there by **grepping the
  generated docs**, not from always-on context. So agents do look things up when
  the question is in front of them, which is mildly encouraging for a note.
- The same audit is why the per-card guidance was written into the agent guide
  rather than a doc: the guide loads, a doc waits.

So the real question this issue exists to answer is **where a per-box symbol
strategy should live**, not whether one is worth having. Candidates:

1. `_bookkeeping/notes/symbol.md` as proposed — most editable, least likely to
   be read.
2. A `.claude/rules/` entry globbed to `*.card`, so it loads whenever an agent
   is writing a card. Loads reliably; competes for context on every card write.
3. A section of the box's `CLAUDE.md`. Always loaded; the file is already
   contested space.
4. Nothing box-level: let the box's existing marks BE the strategy, and have the
   agent read the marks already in play (a `bbx` query for symbols in use)
   before choosing one. No document to drift, but no way to state an intent that
   the current marks do not yet express.

Option 4 is the one that fits the direction of travel; option 1 is the one the
boxholder reached for. Worth deciding deliberately rather than by default.

If a document does win, it should ship as stock content with starter
instructions (the way other box scaffolding does), so a fresh box has a
strategy to edit rather than a blank file to invent.

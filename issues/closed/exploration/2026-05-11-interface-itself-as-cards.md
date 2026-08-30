---
title: "interface itself as cards"
workstream: unknown
area: beebox
resolution: superseded
---

**Closed:** Superseded by [interface-as-cards.md](../../../beebox/docs/plans/interface-as-cards.md) (2026-07 design exploration): subject/view/binding factoring, query vs. instrument cards, the can't-break resolver invariant, beside-claims/inside-annotations, `?create`, chat husks + the companion slot + frame bus/callouts, and a per-surface conversion map. The original sketch is kept below for the record.

**Superseded by `docs/plans/interface-as-cards.md`** (2026-07 design
exploration): subject/view/binding factoring, query vs. instrument cards, the
can't-break resolver invariant, beside-claims/inside-annotations, `?create`,
chat husks + the companion slot + frame bus/callouts, and a per-surface
conversion map. The original sketch is kept below for the record.

A wild, probably-bad idea worth keeping on the table: what if interface surfaces —
the dashboard, history, maybe the questions queue or a landmark view — were *cards*
rather than bespoke React pages? The system already treats the filesystem as state
and cards as the universal addressable unit; today the UI is a separate layer that
*reads* cards but isn't made of them. If a dashboard were a card (a layout/query
spec in frontmatter, rendered by a generic renderer), then the whole interface
inherits the card substrate for free:

- **Referenceable.** Every surface gets a stable path, so you can link to "the
  dashboard," embed it inside another card, or point an agent at it the same way
  you point at any other card.
- **Configurable by editing, not coding.** Tweaking what the dashboard shows
  becomes editing a card's frontmatter (which queries, which order, which filters)
  instead of changing a `.tsx`. The boxholder agent could reconfigure a view by
  writing a card — no deploy.
- **Embedding + commenting + history come along.** Anything that already works on
  cards — transclusion, attaching a comment, git history of changes, validation —
  would work on interface surfaces too. A commented-on dashboard, a diffable
  history view, an embeddable mini-dashboard inside a daily note.

Honest skepticism: this is probably wrong as a wholesale move. Most real UI
(chat, the source editor, anything with rich interaction or live streams) is
genuinely code and would be tortured into a card-shaped renderer for no gain —
you'd reinvent a UI framework inside frontmatter. The interesting question is
*which pieces* are actually declarative-list-shaped (dashboard, history, a saved
filter, a "show me these cards in this layout" view) and would benefit from being
cards, versus which are inherently imperative and shouldn't. A "view card" schema
that renders a query + layout, sitting alongside the hand-built pages rather than
replacing them, is the version of this that might pay off. Related: the existing
`Agent-editable UI text` and `### Agent-editable UI text` entries gesture at the
same "let the agent shape the interface" impulse from the opposite (content, not
structure) direction.

Open questions: what a "view card" schema would actually contain (query DSL?
reference to a saved filter? a layout primitive vocabulary?); whether the generic
renderer is a new file-type renderer under `src/frontend/src/renderers/` or
something closer to the landmark system; where the line falls between "configurable
view card" and "just build the page." Start by finding the one surface that's most
purely a styled list (probably history or a saved-query view) and seeing whether
expressing it as a card feels like a simplification or a straitjacket.

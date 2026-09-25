---
description: "Cards are markdown enriched in specific ways: a header that each kind of card extends, and a body with a small baseline of cross-cutting marks (quote, source, todo) that any card can use."
---
# Cards are enriched markdown

A **box** is your data directory, a **card** is one file in it, and **the
agent** is the coding agent that reads and writes those files. A card is
ordinary markdown, enriched in two specific places. Everything else about
it is plain text you can open anywhere.

**The header is extended per kind of card.** Every card starts with a
structured header that the system checks against the card's type. A recipe
has a yield and ingredients; a person has aliases and a role; a question has
its options and where the answer goes. A box can define new kinds with their
own fields, so the header vocabulary grows with what you keep (see
[dump it in now, shape it later](../capabilities/shape-it-later.md)).

**The body is markdown with a small baseline of marks.** The text below the
header is markdown, rendered with a shared vocabulary of marks that any card
can use. Three are the baseline because they are cross-cutting: they apply
to any kind of card, and the box collects and shows them wherever they
appear.

- **Quote**: exact words, with who said them. This is how your own words
  survive the agent's rewriting, and how a remark from an email or a chat is
  kept as it was said.
- **Source**: where a passage came from, in the box or outside it, and how
  it was used (verbatim, summarized, inferred). This is how a fact carries
  its origin.
- **Todo**: a task noted in place, in whatever card the thought occurred,
  with a status and optional dates. Every todo view in the box is a live
  query over these marks, so a task written inside a project note shows up
  on the plate without being copied anywhere.

Other marks exist for particular kinds of card (a recipe's ingredients and
steps, a briefing's purpose and corrections, a capture session's timeline),
and a box can add its own. The baseline three are the ones the whole system
agrees on.

Why it is built this way: [the representation mirrors the idea](../design/representation.md)
and [durability and provenance](../design/durability-and-provenance.md). Where
the marks matter most: [provenance](../capabilities/provenance.md),
[an inbox for your thoughts](../uses/an-inbox-for-your-thoughts.md), and
[a project's working memory](../uses/a-projects-working-memory.md). The
format details are in [cards](cards.md).

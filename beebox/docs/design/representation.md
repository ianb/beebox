# Representation should mirror the shape of the idea

A cross-cutting principle behind the card format, the schemas, and the
landmark/directory structure: **the representation should be isomorphic to the
structure of the idea it holds — not to the convenience of storage, and not to
the convenience of display.**

This is Douglas Engelbart's argument in [*Augmenting Human Intellect*
(1962)](https://www.dougengelbart.org/content/view/138/). Engelbart modeled a
person as an **H-LAM/T system** — a Human using Language, Artifacts,
Methodology, and Training — where "Language" means the way concepts get
*symbolized and externally represented*, not speech. His claim, which he framed
as a Neo-Whorfian hypothesis, is that the means by which we manipulate external
symbols directly shapes what we are able to think: change the representation and
you change which thoughts are reachable. Concepts live in the mind as *concept
structures*; we externalize them as *symbol structures*; and — the load-bearing
part — some ideas become tractable only once the symbol structure is chosen to
match the concept structure. The representation is not a passive record of
thought; it is part of the thinking.

For a Bee Box, the "symbol structure" is the file tree: cards, their
frontmatter, their bodies, and the directories and landmarks they live in. So
the design goal is that this structure track the *shape of the domain*, such
that operating on the files is operating on the ideas:

- **A card is one idea.** The unit of the record is a discrete thing — a bank
  account, a person, a memo, a decision — because that's the unit of thought.
  Splitting one idea across many files, or cramming many ideas into one, breaks
  the isomorphism and makes the representation harder to reason about than the
  idea it holds. (This is why the inbox batches *unprocessed* threads, but
  processing resolves them into per-idea cards.)
- **Types mirror kinds.** Strict, typed schemas (below) exist because the
  *kinds* of things in the domain are real distinctions; the schema makes those
  distinctions explicit and machine-checkable rather than leaving them implicit
  in prose. Structural strictness is fidelity of shape, the way quoting is
  fidelity of voice.
- **The directory structure is the conceptual map.** Landmarks and the folder
  layout are meant to mirror how the domain is actually organized, so navigating
  the tree is navigating the user's world — not fighting an arbitrary filing
  scheme laid on top of it.
- **Provenance and quoting keep the mirror honest.** Provenance (see
  `durability-and-provenance.md`) preserves *where an idea came from* as it
  moves; the Law of Quoting preserves the user's *exact words*. Both are the
  same discipline from different angles: don't let the representation drift
  from the thing it represents.

This is distinct from the Laws in the agent guide, which govern *fidelity to the
user's voice and memory*. This principle governs *fidelity of the
representation's structure to the structure of the idea* — a different axis,
aimed at a different payoff: a record shaped this way doesn't merely store the
user's thinking, it augments it, because the structure carries some of the
reasoning for you.

One caution, learned the hard way: this is a value for the *humans shaping the
system*, not a slogan to hand the agent. "Cognitive fidelity" is the tempting
name for it, but that phrase is already claimed by an HCI/simulation sense that
points the other way (fidelity of a *tool to the user's cognition*), so a reader
— including the agent — will take it to mean something else. When the idea needs
to appear in a prompt, name it in plain language rather than leaning on the term.

## Strict schemas, with deliberate escape valves

Validation is **strict and fail-closed** — cards validate against their schema
on load and at commit, never "best effort" loose parsing. Schema evolution is
controlled migration ([`../migrations.md`](../migrations.md)), not silent
drift; the agent can migrate schemas itself, which is what makes strictness
affordable.

Looseness is a *schema design* choice, never a parsing choice. Escape valves —
fields that hold ad hoc information — are legitimate but must be **clear,
scarce, purpose-stated, and discussed with the boxholder** (ruling 15); the
codebase has deliberately avoided accumulating them. The **markdown body of a
card is the canonical escape valve**: very freeform by design, which is why
most schemas can keep their frontmatter tight.

## Cards that aren't domain ideas

Cards serve other purposes than recording domain objects: chat husks,
landmark cards, briefing cards, instrument/view cards. This is real tension
with "a card is one idea," and it's also kind of correct (ruling 16): a chat
husk is still an idea — *the idea of that chat session*; a landmark is the
idea "this spot matters." The one-idea test still applies to infrastructure
cards — every card should answer a real question, and a card whose body stays
empty should probably have stayed virtual
([interface-as-cards](../plans/interface-as-cards.md) owns that guardrail).

## Landmarks

The shipped definition is the intended design (ruling 17): a landmark is a
role-bearing marker card, one per directory — a curated navigation bookmark
and/or a triage filing destination ([`../landmarks.md`](../landmarks.md),
[`../triage.md`](../triage.md)). Best effort for the moment; more will be
done, but describe the implementation as the design. The older
"activity centers in the filesystem" phrasing is superseded.

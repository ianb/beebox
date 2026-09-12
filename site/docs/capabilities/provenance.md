---
description: "How the box marks where a fact came from and keeps a person's own words instead of the agent's paraphrase."
---
# Where a fact came from, in whose words

A box is a directory of your data, kept under version control with a full
history of changes (using git); a card is a markdown file with a structured
header; the agent is the coding agent (Claude Code or Codex) that operates
the box. Information in the box is meant to carry where it came from, and
to keep your own words rather than the agent's summary of them, so you can
tell what you said from what the agent inferred.

**What it does for you**

- A thing you said is kept as an exact quote, not a rewrite, and can carry
  who said it.
- A fact pulled from an email, a page, or another card points back to where
  the agent read it.
- A remark you leave on a document anchors to the exact passage it is
  about, even if the document later changes.
- A rule you teach the agent is recorded in your own wording, not its
  restatement.
- Every change to the box is committed to its history, traceable to who or
  what made it.

**How it works, briefly**

Two markings do most of this in a card's body. One marks a block of text as
someone's exact words and, when known, whose; the agent must use it
whenever it records something you said, rather than paraphrasing. The
other marks where content came from (another card, an external file, or a
web address) and can note the exact passage and how it was used
("verbatim", "a summary of the third paragraph"). A remark on a saved page
or external file uses this same marking to point at the span it is about.
Separately, every commit to the box records which connector or agent made
the change. For the curious, the markup is `{% quote %}` and `{% source %}`.

**Limits**

The box's design documentation calls full provenance an aspiration, not a
finished feature: the system does not yet trace every fact back to the
message or document that produced it, especially something said in chat.
These two markings are real but partial, not a guarantee applied
everywhere. Naming the speaker on a quote is an agent convention rather
than something the system enforces; in practice the agent does it
routinely.

**Go deeper**

[../design/durability-and-provenance.md](../design/durability-and-provenance.md),
[../concepts/cards.md](../concepts/cards.md),
[../reference/cards/commentary.md](../reference/cards/commentary.md),
[../reference/cards/memo.md](../reference/cards/memo.md),
[web-clipping.md](web-clipping.md),
[voice.md](voice.md)

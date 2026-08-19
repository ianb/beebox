---
title: "A skill for how the agent writes to the developer — countering default LLM expression"
workstream: unattached
area: docs
needs: [design]
labels: [skills, writing, agent-behavior]
filed-by: agent
discovered-by: Ian
discovered-in: main session — boxholder asking for a writing skill
---

A short, frequently-consulted skill governing **how the assistant writes its own
user-facing text** — the prose it puts in front of the developer in
conversation, in reports, in summaries.

Scope, stated precisely because it was got wrong once: this is about **the
agent's own output**, not about callback-box's UI strings, not about the box
agent's chat replies, and not about docs or commit messages. The "user" is the
developer reading the assistant's messages.

## Why it exists

The boxholder's reason, and it defines the content:

> a large part of the skill is fighting your default form of expression (which
> sucks!)

So this is not a general style guide. It is a **counter-defaults document**: a
list of the specific habits the model reaches for unprompted, and what to do
instead. A style guide that doesn't name the defaults it is fighting will be
read, agreed with, and then ignored, because the defaults operate below the
level the model notices.

## The agent should not draft this alone

Filed rather than written. The first attempt was authored by the assistant and
was wrong in both scope and form — which is the argument for the process, not
just an accident. Two reasons this needs the developer:

- **The tells are invisible from the inside.** The model cannot reliably
  enumerate its own defaults; the developer is the one who notices them, and has
  been correcting them one at a time for months.
- **A document about not writing like an LLM, written by the LLM, in its
  defaults, is self-refuting.** The existing writing-practice issue already
  settled the right shape for this class of work — the user's words are the
  substance, agent prose is connective tissue at most. That applies here more
  than anywhere.

See [writing practice: assembling the user's own words](../features/2026-07-05-writing-skill.md),
whose governing rule — *opinionated in conversation, conservative in the
artifact* — should probably govern the making of this skill too.

## Raw material that already exists

The corrections have been accumulating; the skill is mostly a matter of
collecting them rather than inventing anything. Known items, each from a real
correction:

- **No "not X, but Y" antithesis.** The construction is an AI tell; state things
  plainly.
- **Volume is the problem, not vocabulary.** Cut restating the question, cut
  offering three options where one recommendation belongs, cut the closing
  offer on every turn.
- **Don't narrate the value of a step** — no "this earned its keep", no "this
  proved valuable". Report the finding.
- **Plain words over fancy ones** where the plain word does the job.
- **Don't over-correct.** Corrections should be plain and brief, without
  apology, self-criticism, or a tally of past errors.

That list is partial and second-hand. The developer will have more, and his
phrasing of them is worth more than a paraphrase.

## Shape

Short — it is meant to be consulted constantly, and length defeats that. The
trigger should be broad (any substantial prose written to the developer), so
the description matters more than the name.

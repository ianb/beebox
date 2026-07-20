---
title: "writing practice: assembling the user's own words into a finished form"
needs: [design]
area: callback-box
filed-by: agent
discovered-in: main session — after being told my README prose was "all AI"
---

**Reframed 2026-07-20.** This was originally scoped as "prose that doesn't read
as LLM-generated" — an anti-AI-tells style guide for agent-composed text. That's
the wrong shape. Boxholder:

> The shape I want for writing puts the user's words first. […] it's not about
> the AI composing big chunks of text, but rather working with the user to
> assemble the user's own words into some final form(s).

So the deliverable is a **collaborative assembly practice**, not a style guide.
The agent's job is to elicit, select, arrange, and — at the user's direction —
edit *the user's* words into a finished thing. Agent-authored prose is connective
tissue at most, not the substance.

That framing also dissolves most of the original problem: text made of the
user's actual words doesn't read as AI, because it isn't. The tells research
(kept below) stops being the point and becomes the standard for the small
amount of connective prose the agent does write.

## The primitive already exists

This is not a from-scratch idea — it's the natural extension of machinery
already in the agent guide:

- **`THE_LAW_OF_QUOTING`** (`src/core/agent-guide/laws.ts:25`) — *"The user's own
  words are the most important thing in this box… Never smooth, summarize, 'clean
  up,' or restate their speech as your own prose. Paraphrasing the user is a
  betrayal."*
- **`{% quote %}`** (`src/core/agent-guide/quotes.ts`) — the mechanic that carries
  it, keeping the user's exact words visibly distinct from agent paraphrase.

And crucially, the existing guidance **already licenses the operations an
assembly practice needs**:

> You choose *which* spans to quote, and may trim to the core, split across tags,
> or move a quote between cards — but the text inside the tag is the user's exact
> words.

> When the **user directs an edit** to their own quoted words, the result is
> still authentic — the quote stays a quote. It's your *unbidden* rewriting the
> law forbids, not the user's own revision.

Select, trim, split, relocate, and revise-on-instruction are exactly the verbs
of assembling a document. The law already permits them. What's missing is the
**practice** built on the primitive, not the primitive.

## What's actually missing

- **Eliciting words that don't exist yet.** Assembly presupposes material. When
  the user hasn't said the thing yet, the agent's move is to *ask*, not to draft
  a paragraph for approval — a draft anchors the user to the agent's phrasing and
  they end up editing AI prose instead of speaking. What does good elicitation
  look like: interview? one question at a time? reading back what's been
  gathered?
- **Showing an assembly for revision.** The user needs to see the arrangement and
  react — "move that up," "cut that," "I'd rather say it this way." That's a
  conversational loop with a document in the middle, and it's the core UX.
- **What the agent's own prose may be.** Headings? Transitions? A sentence
  linking two quotes? Draw the line explicitly, because it will creep. A rule
  like "the agent writes scaffolding, never claims" would be testable.
- **Not enough material.** When the user's words don't cover something the form
  needs, the honest options are ask, or leave a visible gap — not quietly write
  it. Fail-closed applies to prose too.
- **One source, several forms.** The same gathered material should assemble into
  different outputs (a doc, a summary, a page). Does the assembly persist as an
  artifact, or is it re-derived each time from the quoted source cards?
- **Where this lives.** Per the original open question: an invoked skill won't
  fire, because an agent doesn't think to call a skill before writing a sentence.
  This probably wants to be a rule or part of the always-loaded guide, with a
  skill only for the deliberate "let's write X together" session. Note the law it
  extends is already always-loaded.

## Scope

Mostly **in-box writing** — the box working with its boxholder on their own
material. The boxholder notes this would incidentally serve making a homepage for
this project (which doesn't exist yet), but that's a downstream application and
explicitly not the driver. Don't design for it.

Related: [chat-output-vocabulary-ia-pass](../docs-and-chores/2026-06-02-chat-output-vocabulary-ia-pass.md),
and [memory-writing-guidance](../exploration/2026-05-19-memory-writing-guidance.md)
(same shape — writing rules for one surface).

---

## Supporting research: tells in agent-authored prose (2026-07-05)

Kept because the agent still writes *some* prose — connective tissue, docs, this
repo's own text — and because these tells are how you notice agent prose has
crept into what should be the user's voice.

**Tells (most-attested first):**

- "It's not X, it's Y" / "not just X, but Y" negated antithesis.
- Overused lexicon: delve, tapestry, underscore, boast, realm, testament to,
  showcase, intricate, meticulous, pivotal, commendable, resonate, navigate,
  harness, bolster, illuminate, landscape/ecosystem, unlock/unleash. (Corpus
  spike post-2022 — Juzek & Ward COLING 2025; Yakura et al., Max Planck.)
- Relentless rule-of-three / tricolon used everywhere until it's noise.
- Compulsive parallelism across successive clauses.
- Rigid intro→point→point→point→conclusion scaffolding, especially empty
  wrap-ups ("In conclusion," "Overall," "To sum up").
- Hedge/booster filler: "It's worth noting," "It's important to note."
- Excessive transitions: Moreover, Furthermore, Additionally.
- Vague sweeping uplift that's verbose but empty ("not a tool, a revolution").
- Uniformly formal register: no contractions, no stance, "utilize"/"in order
  to" (corpus-backed — Rudnicka).
- Sycophancy; generality over specificity ("a recent study," "many users").
- Weaker/anecdotal (humans trigger these too, don't over-index): em-dash
  overuse, uniform paragraph rhythm, bold-lead-in listicle structure.

**Counter-principles:**

- Specificity is the strongest anti-AI signal — name the actual study, real
  number, real example, not "a recent study."
- Own the structure: reorder until it matches how you'd explain it aloud, not
  definition→list→recap.
- Vary sentence length on purpose; short next to long.
- Cut hedges, boosters, empty conclusions. State positions plainly.
- Antithesis/tricolon/parallelism aren't banned — the LLM failure is *taste*
  (overuse). Reserve them for genuine emphasis.
- Write like you talk: simple words, contractions, read it aloud.
- Orwell's six rules are a good spine.

Note: the antithesis construction, the lexicon spike, and the formal-register
findings are corpus-backed. Em-dash / rhythm / listicle tells are plausible
but anecdotal — false-positive prone.

**Sources:**

- https://www.deadlanguagesociety.com/p/rhetorical-analysis-ai — why LLM prose lacks taste
- https://reutersinstitute.politics.ox.ac.uk/news/how-ai-generated-prose-diverges-human-writing-and-why-it-matters — corpus-backed divergences
- https://www.paulgraham.com/writing44.html — write simply, revise ruthlessly
- https://www.orwellfoundation.com/the-orwell-foundation/orwell/essays-and-other-works/politics-and-the-english-language/ — Orwell's six rules
- https://every.to/p/how-to-make-ai-write-less-like-ai — practical de-AI edits
- https://github.com/conorbronsdon/avoid-ai-writing — an existing agent skill auditing these patterns

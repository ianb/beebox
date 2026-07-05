---
needs: [design]
area: docs
filed-by: agent
discovered-in: main session — after being told my README prose was "all AI"
---

# A writing skill: expository prose that doesn't sound like an AI

Scope: prose, usually exposition — READMEs, docs, `CLAUDE.md`s, issue bodies,
box docs, agent-authored chat and cards. The goal is narrow and concrete:
writing that doesn't read as LLM-generated. Not a general style guide, not
code style (that's `code-style.md`).

Two audiences, likely one shared core plus thin wrappers:

- **This repo** — docs and prose written by agents working here. Voice is
  already terse; the skill enforces it.
- **Boxes** — chat, cards, box docs. A box's voice is the boxholder's, not a
  generic assistant's. Overlaps with
  [chat-output-vocabulary-ia-pass](2026-06-02-chat-output-vocabulary-ia-pass.md).

## Open questions

- Skill vs. rule vs. always-loaded doc. Guidance that must fire on *every*
  write wants a rule or a `code-style.md`-style doc, not an invoked skill —
  an agent won't think to call a skill before writing a sentence. Maybe the
  skill authors/maintains the rule, and the rule is what's loaded.
- Where the box variant lives — engine (`callback-box/`) or per-box context
  (the `cb-context` skill's territory).
- How to check adherence. A checklist an agent self-applies, or a lint-style
  pass over authored prose? The tells below are partly detectable
  mechanically (banned-word list, "not X, but Y" regex).

## Research (2026-07-05)

The single most-cited tell is the **"not X, but Y" / "it's not just X, it's
Y" antithesis with explicit negation** — the exact thing that got this issue
filed. Rest of the corpus-backed findings:

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

**Counter-principles (what to do instead):**

- Specificity is the strongest anti-AI signal — name the actual study, real
  number, real example, not "a recent study."
- Own the structure: reorder until it matches how you'd explain it aloud, not
  definition→list→recap.
- Vary sentence length on purpose; short next to long.
- Cut hedges, boosters, empty conclusions. State positions plainly.
- Antithesis/tricolon/parallelism aren't banned — the LLM failure is *taste*
  (overuse). Reserve them for genuine emphasis.
- Write like you talk: simple words, contractions, read it aloud.
- Orwell's six rules are a good spine (cut every word you can; short word over
  long; active voice; no stock metaphors; no jargon; break any rule before
  writing something barbarous).

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

Related: [memory-writing-guidance](2026-05-19-memory-writing-guidance.md) —
same shape (writing rules for one surface). The antithesis rule is currently
only in personal memory; a real fix moves it in-repo.

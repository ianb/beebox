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

## The core frame: oral → written, fidelity as a dial

Boxholder, on what this actually is:

> We're helping turn a person's oral presentation of an idea into something else
> (blog post, email, etc... not always clear).

That names the discipline. **Oral history is the closest existing field** — it has
worked exactly this problem (one person's speech becoming that person's prose)
for decades, with codified norms, and it should be treated as the primary source
of practice here rather than one input among several. **There is more to mine
there than the pass below captured** — a deeper read of the field is worth doing
before designing.

The single most valuable import is the **fidelity spectrum**, which should be a
core concept of the skill, not an implementation detail:

**full verbatim** (every um and false start — used when verbal behavior is itself
the data) → **intelligent verbatim** (filler stripped; voice and meaningful
pauses kept) → **edited / clean read** (smoothed for publication).

Three things make this the right spine:

- **It's a dial, not a rule.** Different destinations want different points on
  it, and the user can be asked where to sit — AudioPen already ships this idea
  as an "edit intensity" slider.
- **The field disagrees about where to draw the line**, openly and in print. That
  means we're picking a default in a live debate, not implementing a settled
  standard — so the dial should be visible, and our default defensible rather
  than assumed.
- **Its rule of thumb encodes real judgment**: meaningful false starts are
  preserved (broken with an em-dash) even when pure filler is dropped, because
  false starts reflect thought patterns and filler doesn't. That's the kind of
  distinction that separates a transcript that sounds like the person from one
  that sounds sanitized.

**The destination is often unknown while collecting.** "Not always clear" is a
design constraint, not vagueness: material is gathered before anyone knows if
it's a blog post, an email, or a note. That argues for keeping the collected
material in a form that isn't yet committed to an output — quoted source cards
that several assemblies can draw on — and for treating "what is this for?" as a
question the process asks *later*, possibly repeatedly.

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

## Worked example of the guidance this should contain

Boxholder, giving a sample of what belongs in the skill:

> if the agent is structuring the user's words into a document, it is better for
> that structure to be in the form of lists, paragraphs, punctuation; avoiding
> adding _words_, but using visual structure. Visual structure does not imply
> authenticity one way or the other.

The distinction is **structure vs. words**. Breaking a run of speech into
paragraphs, turning three parallel remarks into a list, adding punctuation — none
of that puts words in the user's mouth, and none of it makes a claim about voice.
A reader doesn't attribute a bullet point to anyone. But an added *word* is
attributable, and a sentence of agent prose sitting among the user's sentences
reads as theirs. So the first tool for structuring is always typography, not
vocabulary.

Then the graduated rule for when structure alone won't carry it:

> When restructuring requires new connective tissue […] it is best to solicit
> that from the user. OTOH, if you maintain accurate `{% quote %}` then
> agent-compose connective words can be okay as a placeholder, or if it is based
> on well-represented authentic samples.

So, in order of preference:

1. **Ask the user for it.** The connective sentence is still a sentence with a
   voice; the user is the one who should supply it.
2. **Agent-composed as an explicit placeholder** — written to be replaced, and
   legible as such, not quietly permanent.
3. **Agent-composed from well-represented authentic samples** — acceptable when
   there's enough of the user's own material on the point that the connective
   words are a faithful extrapolation rather than an invention.

What makes 2 and 3 tolerable at all is the **accurate `{% quote %}` boundary**.
If the user's words are correctly marked, then the unmarked text is visibly *not*
theirs — the agent's prose isn't passing itself off, it's declaring itself. The
quote tag is what converts "agent wrote some of this" from a betrayal into a
disclosed edit. Which means quote accuracy is load-bearing for the whole
practice: get it wrong and the connective tissue silently becomes attributed
speech.

## The shape of the skill: a constructive process, stage by stage

Boxholder, on what the skill should actually contain — note this is a **positive
process description**, not a rule set. The prohibitions are the easy part; the
value is in how the agent *works with* someone:

> I'm imagining something like a process of how to collect the text, how to
> present what was collected, how to assemble that raw material into drafts and
> how to act on feedback on that draft, how to solicit and use rewriting of
> merged items, how to insert research or references into that text, how to keep
> track of references. And then some more about editorial reviews (where there's
> lots of good existing material to take from). And perhaps how to provide ideas
> in a way that doesn't over-steer the user... ideas on structure, missing items,
> explicit brainstorms. Also the agent as research assistant is very useful, and
> where that fits in.

And on the evidence bar — this can't wait for studies that don't exist:

> Of course it'll require a lot of testing (and very much human-based), so we
> can't go that far. But even one person's description of how they personally do
> a process (that fits my own goals here) is useful.

So: practitioner accounts count. Below, each stage with the most applicable
existing craft. Full research with citations in
`scratch/authentic-ai-writing-research.md` (gitignored).

### 1. Collecting the text

The professions that do this treat **the interview as the creative act, not a
preliminary** — memoir ghostwriting locates the book in the recorded interview
series; the writing is shaping that material. Moehringer lived a mile from Agassi
for two years, watching old matches while Agassi narrated his in-match thoughts
shot by shot.

Transferable craft:

- **Start easy and concrete, save the hardest for last** — after trust. (StoryCorps; CJR)
- **Open questions, never leading.** "How was…?" not "Wasn't it…?" Follow with
  "tell me more," "describe what that was like."
- **The question list is scaffold, not script** — "when you hear something that
  moves you, ask more questions."
- **Prepare 20, ask 10.** "If you need to ask all 20, you're not having a
  conversation."
- **Silence is a tool** — letting a question float a beat too long yields more
  genuine answers. (Non-obvious for a chat agent, which is built to fill turns.)
- **Concrete/sensory/memory questions beat abstract reflective ones** — the one
  empirical result found on question type.
- **Notice the quotable moment when it happens**, and stay alert for it.
- **OARS** (open questions, affirmations, reflective listening, summarizing) from
  motivational interviewing is the most rigorously developed elicitation
  framework found — built precisely to get a person to voice their own reasoning
  in their own words rather than be led.

### 2. Presenting what was collected

OARS's **reflective listening + summarizing** map directly here: play the user's
own words back for confirmation. Oral history makes this a formal pipeline stage
rather than a courtesy — **narrator review**, with its own chapter in Baum's
foundational text and near-universal institutional practice. Columbia's actual
pipeline adds an **audit-edit**: a verification pass against the source.

### 3. Assembling raw material into drafts

The **fidelity spectrum** is the spine of this stage — see the core frame at the
top of this issue. Where the dial sits should be a decision the process surfaces,
not a constant baked into a prompt, and it may differ per destination.

Ghostwriting's bright line for this stage: **shape, don't invent.** A ghost may
select, sequence, and dramatize material the subject actually said or
experienced — but must not invent experiences, expertise, or opinions they never
had.

Convention worth adopting: **brackets `[ ]` are reserved exclusively for
editorial insertions** — words not in the source. Near-universal in oral history
transcription, and a ready-made complement to `{% quote %}`.

### 3b. Nothing is deleted during drafting — the dumping ground

Boxholder, describing his own practice:

> Sometimes in writing (and I think this is common) I'll have a ton of stuff at
> the bottom of the document as a kind of dumping ground instead of deleting
> anything, and then assembling things at the top.

This deserves to be a first-class part of the process, not an incidental habit,
and it fits the rest of the design unusually well:

- **It lowers the cost of cutting.** If removing a paragraph doesn't destroy it,
  the user can be much bolder about restructuring — which is exactly what stage 4
  needs, and the same logic as StoryCorps' heavy-cut-plus-approval pattern.
- **It's the natural home for material collected before its destination is
  known** (see the core frame — "not always clear"). Gathered-but-unplaced and
  cut-but-kept are the same state.
- **It preserves the user's words by default**, which is the whole posture here.
  An agent that deletes the user's speech to tidy a draft is doing a small
  version of the thing the Law of Quoting forbids.

Boxholder also notes the form needn't be a literal bottom-of-document pile:

> Obviously we can structure things differently than a linear document (e.g.,
> keeping things inline but presenting them in a collapsed form or something).

Inline-but-collapsed keeps a cut fragment *where it was*, preserving the context
that explains why it existed — a bottom pile loses that. Worth weighing against
the simplicity of one dumping ground.

The obvious failure mode to design against: **a graveyard nobody reads is just
delayed deletion.** If material goes down there and is never retrievable in
practice, the affordance is comfort rather than function — so retrieval, not
storage, is the hard part.

**Research pending** — this is a common enough practice that it likely has an
established name and much more developed forms than the boxholder's own; a
focused pass is running (results will land in
`scratch/writing-dumping-ground-research.md`). Scrivener's binder/corkboard model
is an obvious tool precedent to examine.

### 4. Acting on feedback

StoryCorps' model is the useful precedent: aggressive curatorial cutting (40 min
→ 2–8 min) is **licensed by storyteller approval of the edited segment**. Heavy
editing plus subject sign-off is an accepted, principled pattern — which means
the review stage isn't friction to minimize, it's what buys the freedom to edit
boldly.

### 5. Soliciting and using rewrites of merged items

When the user directs a rewrite, **the instruction is the provenance.** The
thesis-editing analogy: normally the student makes the change themselves after
the editor flags it; here the agent executes, so what keeps authorship with the
human is that the instruction came from them and is recorded.

### 6–7. Research, references, and tracking them

Boxholder on the bar here:

> Research isn't _hard_ really, just worth structuring. Like, you know how to do
> research. I just don't want it unspecified, so it gets figured out anew each
> time.

So this stage is a **specification** problem, not a capability one. The agent can
already research; what's missing is a named procedure, so the same session
doesn't reinvent when to look something up, how a found source enters the draft,
and where the citation lands. Unspecified means inconsistent — and inconsistency
is what makes a reference list rot.

Concretely, the skill should fix: when research is offered vs. waited for
(unbidden research is a mild form of over-steering — it introduces material the
user didn't ask for), how a found fact is marked as *not the user's words*
(this is the same boundary problem `{% quote %}` solves, from the other
direction), and whether references accumulate as they're found or get gathered at
the end (the process-capture finding below argues for as-found).

Thinnest area in the external research — little exists on incorporating outside
material into someone's own voice, so this stage is mostly ours to specify. Two
transferable ideas:

- **Archive the raw.** The Library of Congress Veterans History Project sidesteps
  transcript-fidelity disputes by requiring deposit of the **unedited original
  recording** as the primary record. Keeping sources retrievable is itself a
  provenance strategy — and the box already has `{% source %}` for anchoring to a
  document span.
- **Provenance falls out of process capture, not output analysis.** No span-level
  attribution format has been adopted anywhere; the systems that get closest (iA
  Writer's Authorship, Grammarly Authorship) log as you work. So reference
  tracking should be a byproduct of the gathering loop, not a later reconstruction.

### 8. Editorial review

This is the "lots of good existing material" — the standard four-tier taxonomy
gives the agent a vocabulary for *what kind of review it's doing*, which is
useful precisely because these are different jobs and conflating them is how an
edit turns into a rewrite:

**developmental / structural** → **line editing** → **copyediting** →
**proofreading**.

### 9. Offering ideas without over-steering

The strongest find, and it reads as a *technique* rather than a restriction.
Australia's IPEd thesis-editing guidelines — the one place this line is
ethics-board-enforced, because a thesis must remain provably the student's:

> In relation to matters of substance and structure, the professional editor may
> draw attention to problems, but should not provide solutions. **Examples may be
> offered in order to guide the student in resolving problems.**

That's a constructive move: *name the problem, offer an example, let them
resolve it.* It's how you help someone with structure without writing their
structure. Directly applicable to the boxholder's "ideas on structure, missing
items, explicit brainstorms" — the brainstorm is legitimate; handing over
finished prose is what isn't.

Why it matters is empirically supported: a covertly opinionated assistant made
writers **twice as likely** to adopt its position, unnoticed (Jakesch et al.,
CHI 2023, N=1,506); draft exposure flips writers from "what do I think?" into
evaluating-the-suggestion, with a quarter to a third of AI words surviving into
final text while writers report feeling fully in control.

### 10. The agent as research assistant

The connection worth designing around: **homework makes elicitation better.**
Working journalists report that *specificity born of homework unlocks better
answers than generic prompts* — so the research-assistant role isn't a separate
mode bolted on, it's the preparation that makes stage 1 work. An agent that has
read the user's existing cards can ask the specific question instead of the
generic one.

## Other open questions

- **What the agent's own prose may be.** Headings? Transitions? A sentence
  linking two quotes? Draw the line explicitly, because it will creep. A rule
  like "the agent writes scaffolding, never claims" would be testable.
- **Not enough material.** When the user's words don't cover something the form
  needs, the honest options are ask, or leave a visible gap — not quietly write
  it. Fail-closed applies to prose too.
- **One source, several forms.** The same gathered material should assemble into
  different outputs (a doc, a summary, a page). Does the assembly persist as an
  artifact, or is it re-derived each time from the quoted source cards?
- **Selection is authorial too.** Tony Schwartz invented no facts for *The Art of
  the Deal* and still considers the result a falsified persona — "I put lipstick
  on a pig" — created purely through curation. So accurate `{% quote %}` is
  necessary but **not sufficient**: the user has to own the *arrangement*, which
  is what stage 4's approval step is actually for.
- **Don't trust felt ownership as the success metric.** Research shows felt
  ownership dissociates from disclosure behavior, and that token effort
  manufactures the feeling. Better process measures: what fraction of final words
  trace to user utterances, and whether the user can quote their own document.
- **Where this lives.** An invoked skill won't fire, because an agent doesn't
  think to call a skill before writing a sentence. This probably wants to be a
  rule or part of the always-loaded guide, with a skill only for the deliberate
  "let's write X together" session. Note the law it extends is already
  always-loaded.
- **The niche is unnamed.** No term of art exists for "AI assembles the human's
  words" — nearest anchors are "as told to," centaur, and Sarkar's "provocateur,
  not assistant." Open ground if we want a name for it.

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

- [Dead Language Society — rhetorical analysis of AI prose](https://www.deadlanguagesociety.com/p/rhetorical-analysis-ai) — why LLM prose lacks taste
- [Reuters Institute — how AI-generated prose diverges from human writing](https://reutersinstitute.politics.ox.ac.uk/news/how-ai-generated-prose-diverges-human-writing-and-why-it-matters) — corpus-backed divergences
- [Paul Graham — Write Simply](https://www.paulgraham.com/writing44.html) — write simply, revise ruthlessly
- [Orwell — Politics and the English Language](https://www.orwellfoundation.com/the-orwell-foundation/orwell/essays-and-other-works/politics-and-the-english-language/) — the six rules
- [Every — How to make AI write less like AI](https://every.to/p/how-to-make-ai-write-less-like-ai) — practical de-AI edits
- [conorbronsdon/avoid-ai-writing](https://github.com/conorbronsdon/avoid-ai-writing) — an existing agent skill auditing these patterns

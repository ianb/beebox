# Themes

Supporting material, not published. This is the frame the public pages are
written against: the themes that actually distinguish Bee Box, what each one
means, how the product expresses it, and where it is thinner than the theme
claims. The front page and `llms.txt` present a shorter version of this; when
they disagree with this file, this file is the intent and they are the
performance.

Use it when writing or revising anything in `site/docs/`: a page earns its
place by carrying a theme, a claim earns its place by being expressed in a
mechanism, and a theme that has gone thin gets said honestly rather than
dropped. Conventions: `docs-authoring.md`. Design: `../beebox/docs/plans/agent-docs.md`.

Ordered roughly by how much each distinguishes Bee Box from an assistant
someone already has.

---

## 1. A coding agent is the engine

**What it is.** The assistant is Claude Code or Codex. Bee Box is the
container those agents work in, not a model product and not an agent loop of
its own. You bring the subscription you already pay for. The project does not
try to compete with the progress in those tools, and the engine is kept
separate from the agent so a different one can be swapped in later.

**How it is expressed.** The two supported engines and the login they need.
The engine/box separation: the box is your data and survives an engine
upgrade. A box agent gets a generated guide and a reference set rather than a
bespoke framework. `bbx` is the agent's own tool, not a user surface.

**Where it is thin.** Two engines is not many; the swap is a design intent
with one exercised alternative, not a plugin interface. Claude requires a
subscription login, not an API key.

**Pages.** `03-why-not-just-a-chatbot.md`, `07-how-it-works.md`,
`08-what-it-requires.md`, `12-compared-to-alternatives.md`.

## 2. A knowledge base you own, wiki-like

**What it is.** What you feed it accumulates into a body of knowledge the
agent maintains, rather than a transcript it searches. Document-oriented and
hypertextual: pages that link to each other and are meant to be browsed, by
you and by the agent. The nearest published idea is Karpathy's LLM Wiki, an
agent-maintained markdown wiki over immutable sources; Bee Box differs in
three places (typed records instead of freeform pages, connectors instead of
drop-a-file ingest, git history instead of a log the agent keeps by hand).
"A monorepo for your knowledge" is the same idea said provocatively.

**How it is expressed.** Cards as documents. Links parsed and checked, and
rewritten when a file moves. Landmarks as a curated map over the tree.
Directory-local briefings. Synthesis at ingest (triage, capture sessions,
chat review) rather than retrieval at question time.

**Where it is thin.** Contradiction and supersession are not a recorded
state: when a new source disagrees with a claim already on a card, nothing
makes the card say so (`issues/exploration/2026-09-16-karpathy-llm-wiki-pattern.md`).
A superseded claim survives only in git, where nothing reads it.

**Pages.** `02-what-you-can-use-it-for.md`, `concepts/enriched-markdown.md`,
`capabilities/integrity.md`, `concepts/landmarks.md`, `uses/`.

## 3. The filesystem is all the state

**What it is.** Not "the data is in files" but the stronger claim: there is
no hidden database beside them. The box is a directory; what is in it is what
the system knows. That makes it transparent without a tool, and workable with
every tool that already works on files.

**How it is expressed.** One directory per box, with named areas. A card is a
file; its attachments live beside it in a matching folder and travel with it.
Configuration, state, and bookkeeping are files too. The web app is a view of
the directory, not a separate store.

**Where it is thin.** There is per-machine state outside a box (the
credential store, caches, the scheduler's records). Say so where it matters
rather than claiming everything lives in the box.

**Pages.** `07-how-it-works.md`, `contracts/box-layout.md`,
`capabilities/shape-it-later.md`.

## 4. Everything in git, and the history answers "why"

**What it is.** Version control is not only recoverability. The history is
part of the record: you can look back at how a card, a decision, or the box
itself came to be. This is the theme behind "you should be able to see not
just what it knows but how that came to be."

**How it is expressed.** Every change the agent makes is a commit. Commits
carry structured trailers naming what produced them. The History screen reads
that record. Committing is what makes a thing durable.

**Where it is thin.** Reading the history as an explanation is mostly a human
act today: nothing synthesizes "why is this card like this" from the log.

**Pages.** `07-how-it-works.md`, `capabilities/web-interface.md`,
`design/durability-and-provenance.md`.

## 5. Your words, kept distinct from the agent's

**What it is.** What you said is kept as you said it, and what the agent
inferred is marked as the agent's. The two never blur. This matters more as
the box gets older: a paraphrase that hardens into a fact is the failure mode
of every accumulating assistant.

**How it is expressed.** A quote mark carrying the speaker. A source mark
carrying the origin (in the box or outside it) and how the material was used:
verbatim, summarized, inferred. Spoken words kept as a quote when a memo
becomes a record. Personality beliefs carrying `source: user-stated` or
`inferred`.

**Where it is thin.** The design docs call full provenance an aspiration and
these the partial attempts. Naming the speaker is an agent convention that
the system does not enforce.

**Pages.** `capabilities/provenance.md`, `concepts/enriched-markdown.md`,
`design/durability-and-provenance.md`.

## 6. Typed, with room for language

**What it is.** The shape of the data matches the shape of the idea: a recipe
is stored as a recipe, a person as a person, so the assistant reasons over
structure rather than over prose. And there is always an overflow, so the
fullness of what you know is kept even when it does not fit a type yet. You
start by putting things in; the organization that fits emerges from use.

**How it is expressed.** A schema per card type, checked on load and again
before a commit. A markdown body as the canonical escape valve. Generic
record and memo types for things without a shape yet. A repeated shape
becomes a type; existing cards are reshaped by a migration rather than
rewritten by hand.

**Where it is thin.** An unknown field in a card's header is dropped on load
and flagged, so the overflow is the body, not a stray field. Promoting a
shape is agent work, not automatic.

**Pages.** `capabilities/shape-it-later.md`, `concepts/cards.md`,
`design/representation.md`, `07-how-it-works.md`.

## 7. It extends itself

**What it is.** Everything about how the box presents and processes its own
contents is extensible from inside, by the agent, on request: how a kind of
card is displayed, what kinds exist, what runs on a schedule, what a
multi-step job does. And the agent can read those things to understand how
the box works, because they are files in the box like everything else.

**How it is expressed.** Views the agent writes for a card type. Dashboards.
Box-local card types with their own fields and instructions. Procedures and
scheduled scripts as cards. Small programs for a task that repeats. Rules,
guides, and a personality the agent reads before acting.

**Where it is thin.** Building these is agent work with real capability, so
the quality is the agent's. Nothing gates a badly-built view.

**Pages.** `13-making-it-yours.md`, `capabilities/views.md`,
`capabilities/procedures.md`, `uses/teaching-it-your-preferences.md`.

## 8. Expressive capture

**What it is.** Putting things in should be easy and expressive, with a way
suited to each kind of thing: not one text box, and not a form. The
distinctive parts are long-form voice and mixed voice-and-camera, which is
what a chat app's mic button is not.

**How it is expressed.** Talking at length into the phone app or capture page
with the box staying quiet and filing rather than chatting back. A capture
session that groups a burst of photos and spoken remarks into one timeline.
Scanned paper. A browser extension for the page you are reading. Connectors
that sync email, calendar, and documents, and act as triggers as well as
sources.

**Where it is thin.** Telling speakers apart in a recording is not solved.
The Telegram path is rough. Several capture paths are code-verified rather
than exercised end to end.

**Pages.** `capabilities/voice.md`, `capabilities/phone-capture.md`,
`capabilities/web-clipping.md`, `uses/an-inbox-for-your-thoughts.md`,
`uses/paper-into-records.md`.

## 9. It asks instead of guessing

**What it is.** When the agent lacks confidence or authority it writes a
question and waits, rather than acting on a guess. The answer is worth more
than the placement: a question answered becomes a rule it reads next time.

**How it is expressed.** Question cards with structured answers routed back
to an agent. A confidence vocabulary in triage that decides what a level
permits. Corrections that become rules, guides, and beliefs.

**Where it is thin.** Rewriting a rule from a single low-confidence answer is
future work. The question queue has no badge in the interface.

**Pages.** `capabilities/questions.md`, `capabilities/triage.md`,
`design/trust.md`, `design/teaching.md`.

## 10. Open, so it can be understood

**What it is.** Source-available for the same reason the history is readable:
you should be able to see how it works, and so should the agent operating it.
The development process is part of that openness, since the instructions the
agents work from are in the repository.

**How it is expressed.** GPLv3, one maintainer, a public repository. The
agent instruction files, code style, and skills checked in. Plans, issues,
and the process documented. The public documentation itself generated from
the repository.

**Where it is thin.** Pull requests are not solicited yet. One maintainer is
a bus factor, and the project says so.

**Pages.** `11-status-and-maturity.md`, `dev/development-process.md`,
`dev/agent-coding.md`.

---

## What the front page does with these

The front page and `llms.txt` carry a shorter version: the maintainer's own
introduction, then a themes section naming each theme in a sentence with the
pages that carry it, so a reading agent can explore by theme rather than by
directory. Keep the two in step. A new theme here means a line there; a theme
that turns out to be aspiration gets its honesty on both.

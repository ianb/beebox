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
someone already has. Candidates not yet admitted, for the boxholder to
decide: idle by default and also a chatbot; a theory of you, written down;
trust earned in steps; even the interface is documents.

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
with one exercised alternative, not a plugin interface. The engine process is also
not silent by itself: Claude Code sends its own usage metrics unless the owner
turns that off per box, and the page on data says so. Claude requires a
subscription login, not an API key; a machine with no browser uses a
year-long token from `claude setup-token` held in the secret store. The Claude engine can also be pointed at
other vendors' models (GLM through Z.ai, and OpenRouter models the owner adds
one by one), which loosens the tie to one model vendor. It is pay-per-use, only
three OpenRouter models are recorded as tested through a full agent turn, and
tool-using turns can fail on others.

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
makes the card say so (`issues/closed/exploration/2026-09-16-karpathy-llm-wiki-pattern.md`).
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
rather than claiming everything lives in the box. The encrypted-backup feature
(October 2026) is the plainest evidence: it has to collect that outside state
(secrets, agent logins, conversation files, a Google grant on some installs)
beside the box and its git history, and a git push alone does not carry the
annex object bytes. A restore is only proven by trying one.

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
`inferred`. A document card can mark one region as a composition, the piece the
person is writing: text inside it is the person's by default, and the agent's
contributions carry a mark.

**Where it is thin.** The design docs call full provenance an aspiration and
these the partial attempts. Naming the speaker is an agent convention that
the system does not enforce. The composition editor's Save commits the whole
card, so the agent's uncommitted edits outside the region go into the person's
commit under a trailer that names the button press, not the content (the
plan records this as the boxholder's open decision).

**Pages.** `capabilities/provenance.md`, `concepts/enriched-markdown.md`,
`design/durability-and-provenance.md`.

## 6. Cards: typed records that are also containers

**What it is.** The card system is the center of the design, and where most
of the thought has gone. The shape of the data matches the shape of the
idea: a recipe is stored as a recipe, a person as a person, so the assistant
reasons over structure rather than prose. There is always an overflow, so
the fullness of what you know is kept when it does not fit a type yet; you
start by putting things in, and the organization that fits emerges from use.
And a card is not only a record: it is a container. What belongs to it
travels with it. This sits beside the git theme (a card's history is part of
the card) but is not the git part; it is the object model.

**How it is expressed.** A card is a file named for what it is, and the
filename carries the type. Its header is checked against the type's schema
on load, again right after the agent edits it, and again before a change can
be committed. Its markdown body is the canonical escape valve, with the
baseline marks any card can use. Its attachments (photos, recordings, PDFs,
source files, generated images) live in a sibling folder and move with it;
references into that folder have their own link form. References between
cards take three forms, are found by convention in any field and in the
body, are checked, and are rewritten when a card moves. Schemas carry
instructions the agent reads when it works with that kind of card;
templates create well-formed cards; a box can define its own kinds; a
repeated shape becomes a type and existing cards are reshaped by a
migration rather than by hand. Generic record and memo types hold things
without a shape yet.

**Where it is thin.** An unknown field in a card's header is dropped on load
and flagged, so the overflow is the body, not a stray field. Promoting a
repeated shape to a type is agent work, not automatic. Contradiction between
a new source and an existing card is not a recorded state (theme 2).

**Pages.** `concepts/cards.md`, `capabilities/shape-it-later.md`,
`capabilities/integrity.md`, `concepts/enriched-markdown.md`,
`contracts/box-layout.md`, `reference/cards/index.md`, `07-how-it-works.md`.

## 7. It extends itself

**What it is.** Everything about how the box presents and processes its own
contents is extensible from inside, by the agent, on request: how a kind of
card is displayed, what kinds exist, what runs on a schedule, what a
multi-step job does. And the agent can read those things to understand how
the box works, because they are files in the box like everything else.

**How it is expressed.** Views the agent writes for a card type. Dashboards.
Box-local card types with their own fields and instructions. Procedures and
scheduled scripts as cards. Small programs for a task that repeats. Rules,
guides, and a personality the agent reads before acting. Plugins, added
October 2026: bundled typed libraries (recipes, courses) that a box turns on by
naming them in its configuration and writing small stub files, the same files
a box-local type or view would be. A card type can declare its own body tags,
valid only in that type.

**Where it is thin.** Building these is agent work with real capability, so
the quality is the agent's. Nothing gates a badly-built view. There are two
plugins, both written by the project; the stated position is no registry and
no marketplace. Recipes and courses stopped being on by default when they
became plugins, and activation is a manual, agent-run step that no one has
checked for smoothness.

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
sources. On the iPhone, Siri, the Action Button, a Lock Screen control, and the
share sheet (with optional instructions) save a thought, a voice note, or
shared material to a chosen capture-default box, kept on the phone until it
uploads. Every dictated message also gets the higher-quality transcription
pass, with the live text as the marked fallback. Shared items with no words are
filed by the box's agent a couple of minutes after a burst ends, placing and
titling without acting on them. The browser extension's Send to box routes the
page you are on through quick chat. Quick chat is the other newer
path: the box screen, which the iPhone app opens on,
has one text box, a routing model sends the thought to the fitting
conversation, and an unclear thought waits for the person to choose.

**Where it is thin.** Telling speakers apart in a recording is not solved.
Several capture paths are code-verified rather
than exercised end to end; the Siri, voice-note control, and share paths have
passed simulator and automated tests, and the project's plan lists the
physical-phone checks as open. A box that requires device unlock refuses Siri
entirely. Quick chat posts a clearly routed thought without confirmation and the post
cannot be moved; it sends the message and recent conversation text to a
routing model through OpenRouter, and it needs that key.

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
A new box starts with one pending question ("What do you want to keep track of
here?"), which opens beside the first new chat as a card; the empty chat says to
answer it there or start something else.
How loudly the box reaches you is itself a rule it reads: a question is a
badge unless it is time-bound, and the "Reaching me" section of the root
briefing says when to push (`capabilities/notifications.md`).

**Where it is thin.** The theme is no longer absolute. "Decide for me" hands a
question to an agent, and a daily review (on by default, running an agent only
when a question qualifies) settles questions put away three days or pending
fourteen. It chooses the reversible option that changes least, records it as a
provisional decision with its reasoning and an undo, and learns from it only as
inferred; it never writes the person's answer. Pages should say that the box can
decide, not only ask. Rewriting a rule from a single low-confidence answer is
future work. The nav bar badges the question count and the count of todos due now; the
badge is a bare number beside an icon and can read as a wrong total, though
the Todos page's headline now states what it counts.

**Pages.** `capabilities/questions.md`, `capabilities/triage.md`,
`capabilities/notifications.md`, `design/trust.md`, `design/teaching.md`.

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

**Pages.** `11-status-and-maturity.md` and the development-process section,
`dev/`.

## 11. Groups get a box each

**What it is.** A box can be shared, and the sharing has one granularity:
everyone in a box shares everything in it, and a different group gets a
different box. This is primitive, and it works.

**How it is expressed.** Member invites and passwords, an allowed-users
list, one hub running many boxes on one machine, the web chat
as the shared surface, a calendar and lists everyone sees. The identity
design ruling: shared boxes, one sharing granularity each.

**Where it is thin.** In the maintainer's own server pipeline (not a supported
install path) each box now runs as its own OS user behind a service sandbox, but
the security overview still says boxes share a user; the sharing granularity
inside a box is unchanged. No per-person areas or permissions inside a box;
per-member identity beyond the login list is not designed yet; the household narrative describes an aspiration in places.

**Pages.** `04-who-it-is-for.md`, `design/identity.md`, `architecture/01-what-is-this.md`.

---

## What the front page does with these

The front page and `llms.txt` carry a shorter version: the maintainer's own
introduction, then a themes section naming each theme in a sentence with the
pages that carry it, so a reading agent can explore by theme rather than by
directory. Keep the two in step. A new theme here means a line there; a theme
that turns out to be aspiration gets its honesty on both.

---
description: "What Bee Box does today that a chat assistant does not, what a coding agent alone already gives you, and what the chat apps still do better."
---
# Why not just use a chatbot?

Bee Box rents its agent loop from Claude Code or Codex, so it runs on the same
models the chat apps sell. It is a wrapper, and anything below could be added
to a chat app. The question is what Bee Box does today that
they do not, as they are generally offered.

A **box** is one directory of your data, kept under version control with
git. A **card** is a file in it with a structured header and, usually, some
text. **The agent** is the coding agent that operates the box
([glossary](concepts/glossary.md)).

## Against a chat app

- **Memory is files you own.** What it remembers is cards on your disk, and
  every change is a git commit you can read and trace
  ([design/durability-and-provenance.md](design/durability-and-provenance.md)).
- **It acts between conversations.** It is idle by default and wakes
  when a schedule fires or a connector pulls new data. You can leave a voice
  memo and walk away ([capabilities/schedules.md](capabilities/schedules.md)).
- **Connectors make records.** Email threads, calendar events, and documents
  sync in as typed cards it can re-read and act on months later, rather than
  text in one conversation.
- **Corrections become rules.** Fix a filing decision or answer a question,
  and the correction is written where the agent reads it next time
  ([design/teaching.md](design/teaching.md)).
- **It keeps your words and their origin.** What you said is stored as a
  quote, and a fact drawn from an email or a page points back at it, so the
  agent's summary and your own words never blur together. See
  [provenance](capabilities/provenance.md).
- **It stays coherent as it grows.** Links between cards are parsed and
  checked, references are rewritten when a card moves, and every card is
  validated at several points before a change is kept, so years of
  accumulation stay a navigable hypertext rather than a pile of files
  ([integrity](capabilities/integrity.md)).
- **It asks instead of guessing.** Lacking confidence or authority, the agent
  writes a question card and waits for your answer
  ([capabilities/questions.md](capabilities/questions.md)).
- **It builds inside the box.** It has shell and filesystem access on your
  machine, so views, small programs, and new card types it makes stay there.
- **Capture lands in the same store.** Photos, voice, and clipped web pages
  from a phone or browser become cards in the one box
  ([capabilities/phone-capture.md](capabilities/phone-capture.md),
  [capabilities/web-clipping.md](capabilities/web-clipping.md)).
- **Nothing is hosted.** The data stays on your machine, and so does the risk
  ([10-your-data-and-safety.md](10-your-data-and-safety.md)).

## Against Claude Code or Codex on their own

If you already keep instructions and scripts for a coding agent, some of this
you could assemble yourself. What Bee Box supplies is mechanism rather
than instruction: each kind of card has fields that get checked when it's
created, and checked again automatically before every change is saved, so a
malformed record can't slip through; the intake and
triage pipeline; the question loop; connectors; the scheduler and procedures;
a web interface with chat; phone capture; and a reference corpus generated
from the engine source and handed to every box agent
([reference/index.md](reference/index.md)). Instructions still carry a lot, so this is a
difference of degree.

## What the chat apps do better

They are polished, have native mobile apps, and take no setup. Their
memory works the moment you sign in. They have voice modes, a wide range of
integrations, no machine to keep running, and no failure that is yours to
debug. Bee Box asks for a computer that stays on, an
agent subscription, and a tolerance for files and git. If what you
want is a chat assistant that remembers you, the app is the right answer.

What people use it for is in
[02-what-you-can-use-it-for.md](02-what-you-can-use-it-for.md); other agent
systems are compared in
[12-compared-to-alternatives.md](12-compared-to-alternatives.md).

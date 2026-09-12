---
description: "How Bee Box differs from chat-first assistant frameworks and memory frameworks, and where the per-system pages are."
---
# Compared to alternatives

If you are comparing Bee Box against an ordinary chat assistant rather than
against another agent system, read
[03-why-not-just-a-chatbot.md](03-why-not-just-a-chatbot.md) first.

The systems Bee Box is usually weighed against are agent assistant
frameworks such as OpenClaw, Hermes, Letta, Khoj, Goose, agent-zero,
nanobot, PAI, and gstack. One dated page per system is in
[compared/index.md](compared/index.md). This page states the stance.

**Cards-first rather than chat-first.** The chat-first frameworks treat every
external system as another chat channel feeding one uniform turn pipeline.
Integrations are cheap to add, and thirty of them is normal, but an email is
a message. Bee Box treats an integration as a data sync that materializes
durable typed records: a **card**, a file with a structured header that gets checked, per email
thread, per calendar event, per document. Chat is one
connector among several. Integrations therefore cost more to build and carry
more of each source's structure. That is a bet on fidelity over breadth, and
it would strain if Bee Box needed a second full chat platform quickly.

**Rules enforced in code rather than doctrine in prompts.** Much of what the
competing systems ask of an agent is written as instructions and hoped for.
Bee Box moves what it can into mechanism: each kind of card has fields that
are checked when it's created and checked again automatically before every
save, so a malformed record can't slip through; the filename determines the
type; every change is a commit; a question card carries required fields the
agent must fill before the card is valid.
Instructions still matter, and the agent still runs with real capability, so
this is a difference of degree.

**Other differences worth naming.** Bee Box rents its agent loop from the
Claude Code or Codex SDK rather than writing its own, which means no
multi-provider fallback and no local models. It keeps state in files and git
rather than a database. It has one web interface rather than a fan of
surfaces. It assumes one box for one person or one household.

The per-system pages are dated snapshots, each opening with what was and was
not examined. Read the date before trusting a comparison.

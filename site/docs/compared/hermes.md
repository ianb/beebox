---
description: "Hermes Agent teaches itself by patching its own skill files and searching its full chat history; Bee Box routes durable change through typed cards and git."
compared:
  date: 2026-07-04
  subject: "Hermes Agent, Nous Research (source clone studied 2026-07-03/04; version not recorded)"
  beebox: "2026-07-04"
  looked-for: [agent loop and model providers, memory and learning, channels and routing, scheduling, security and sandboxing, extensibility, install]
  not-looked-for: [pricing, hosted offerings, community size]
---
# Bee Box compared with Hermes Agent

Hermes Agent, from Nous Research, is a self-hosted personal assistant built
around self-improvement: it can rewrite its own instruction files
mid-conversation, and a background pass reviews each session to save memory
and patch its skills. Bee Box is built around a **box**: one directory, also
a git repository, holding **cards** (files with YAML frontmatter and a
markdown body) that an agent reads and writes as git commits.

**Where they are similar.** Both run for a single operator. Both keep a
small always-loaded identity file plus detail fetched on demand, and both run
a periodic background pass that turns a session into durable memory (Hermes's
`background_review`; Bee Box's `retro`) rather than trusting the live
conversation to decide what's worth keeping.

**Where they differ.** Hermes gives the live agent a dedicated tool to write
memory mid-conversation and to search full text across every past session
(SQLite, no embeddings); Bee Box has no episodic transcript search and routes
durable writes through cards and its post-hoc `retro` pass, so a correction
stated in chat can take a week to land. Hermes's memory writes can be staged
behind an approval queue; Bee Box's `retro` writes directly, using git
history as the undo path. Hermes reaches about thirty chat platforms and
restricts a webhook conversation to four safe tools because its payload is
untrusted; Bee Box has four connectors, treats only Telegram as a real
conversation, and keeps untrusted email text out of a card's loaded fields
instead of narrowing the agent's tools. Hermes publishes a written threat
model ("the only security boundary against an adversarial LLM is the
operating system") and keeps one unconditional block on destructive commands
even in its most permissive mode; Bee Box has no sandboxing, no approval
step, and no such hard floor. Hermes lets the agent create, edit, and retire
its own skill files, with a lifecycle that archives unused ones; Bee Box's
equivalent extension points are not something the agent is prompted to
author on its own.

**What this comparison did not look at:** pricing, hosted offerings, or
community size.

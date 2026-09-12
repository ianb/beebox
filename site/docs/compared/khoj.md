---
description: "Khoj is a commercial chat-over-your-notes product with genuine two-way Obsidian editing; Bee Box is a self-hosted personal assistant built on typed records."
compared:
  date: 2026-07-04
  subject: "Khoj (source clone studied 2026-07-04; version not recorded)"
  beebox: "2026-07-04"
  looked-for: [data model and sync, memory, automations, extensibility]
  not-looked-for: [pricing, hosted offerings, community size, security posture]
---
# Bee Box compared with Khoj

Khoj bills itself as "your AI second brain": a chat assistant that answers
questions over your own notes and documents, retrieved by embedding search,
with both a hosted cloud product and a self-hostable core. Bee Box is a
personal assistant built around a **box**: one directory, also a git
repository, holding **cards** (files with YAML frontmatter and a markdown
body), where the record itself, not a chat about it, is the primary object.

**Where they are similar.** Both connect to a personal store of documents and
both run scheduled automations that reuse the same processing path a live
turn would use: Khoj's cron jobs call back into its own chat endpoint, much
as a Bee Box schedule feeds the same reactor a live wakeup does.

**Where they differ.** Khoj's center of gravity is chat over a corpus of
notes, PDFs, and email retrieved by vector embeddings; Bee Box centers on
typed cards with their own fields, validated against a schema, that a person
or agent can open directly. Khoj's Obsidian plugin can write back into your
notes under an explicit permission toggle, with a confirm-or-cancel step
before applying an edit; Bee Box has no comparable mechanism for editing a
person's existing external documents. Khoj's memory is a per-turn
extract-and-save pass over free-text facts, aged by recency and similarity;
Bee Box routes durable memory through schema-validated cards, updated only
through a slower, evidence-checked review pass. Khoj is a multi-tenant
product with subscription billing across many users; a Bee Box box is built
for one person and one agent.

**What Bee Box borrowed or decided not to.** As of this comparison, Khoj's
practice of having an LLM judge whether an automation's result is worth
notifying someone about, before sending it, was flagged as worth adopting for
Bee Box's own scheduled deliveries; its per-turn free-text memory-write loop
was judged weaker than Bee Box's card-based approach and not adopted.

**What this comparison did not look at:** pricing, hosted offerings,
community size, or security posture.

---
description: "gstack is a library of Claude Code slash-command skills for software engineering, not a personal assistant; Bee Box borrowed a few of its process ideas."
compared:
  date: 2026-05-26
  subject: "gstack, Garry Tan (source clone studied 2026-05-26 onward; version not recorded)"
  beebox: "2026-05-26"
  looked-for: [extensibility mechanism, engineering-process techniques, guardrail enforcement]
  not-looked-for: [pricing, hosted offerings, community size, personal-assistant features]
---
# Bee Box compared with gstack

gstack, published by Garry Tan, is not a personal assistant. It is a collection
of about fifty `SKILL.md` files (reusable prompts invoked as slash commands
inside Claude Code) for software engineering tasks: planning review, code
review, shipping, QA, and security audits. Bee Box is a personal assistant
built around a **box**: one directory, kept under version control with a full
history of changes (using git), holding **cards** (files with a structured
header and a markdown body), for managing a person's ongoing life, not a set of
commands a developer invokes per task. The two are different categories of
thing; this page compares gstack's process ideas against how Bee Box does the
equivalent work, not a competing assistant.

**Where they are similar.** Both run on Claude Code, and both rely on loading
task-specific instructions on demand rather than keeping everything in one
prompt at all times.

**Where they differ.** gstack's skills are invoked deliberately, one at a
time, by a developer working on a specific piece of code; Bee Box's
equivalent, the instructions attached to each kind of card plus procedures,
load automatically based on what the agent is touching, with no developer
choosing a command. gstack
has no data model, memory, connectors, or scheduling of its own; those
questions don't apply to it.

**What Bee Box borrowed or decided not to.** As of this comparison, the
maintainers had adopted gstack's practice of enforcing a destructive-command
guardrail through a small piece of Claude Code's own automation rather than a
prompt instruction, since it cannot be talked out of running the way a
prompt can, and had begun
porting a minimal version of its cross-model review skill. Most of gstack's
individual skills were read and explicitly set aside as not fitting Bee Box's
process, or kept only as a reference point for comparison rather than
adopted directly.

**What this comparison did not look at:** pricing, hosted offerings,
community size, or personal-assistant features, since gstack has none.

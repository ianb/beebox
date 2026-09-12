---
description: "nanobot is a minimal personal agent whose own retrieval-research authors chose plain markdown over embeddings, matching a bet Bee Box already made."
compared:
  date: 2026-07-04
  subject: "nanobot, HKUDS (source clone studied 2026-07-04; version not recorded)"
  beebox: "2026-07-04"
  looked-for: [memory architecture, core size, scheduling, extensibility]
  not-looked-for: [pricing, hosted offerings, community size, security posture]
---
# Bee Box compared with nanobot

nanobot, from the academic group HKUDS (known for retrieval-augmented
generation research), is a small personal AI agent: a web interface, about
fifteen chat-platform integrations, memory, and scheduled jobs, built around
roughly eleven thousand lines of core runtime. Bee Box is a personal
assistant built around a **box**: one directory, also a git repository,
holding **cards** (files with YAML frontmatter and a markdown body), a
larger and more structured system aimed at one boxholder's ongoing life
rather than at staying minimal.

**Where they are similar.** Both keep long-term memory as plain, readable
files rather than an opaque store, and both run a periodic background pass
that makes small, targeted edits to those files instead of rewriting them
wholesale. Both also separate a raw, append-only event record from the
curated, meaningful files a person or agent actually reads.

**Where they differ.** nanobot's memory has no vector search or embeddings
anywhere in it, a deliberate choice its own authors call out explicitly,
despite coming from a lab whose specialty is retrieval; as of this
comparison, the researchers read this as independent confirmation that plain
files plus full-context reading can beat embeddings for a personal agent at
this scale, the same bet Bee Box makes with its cards. nanobot checks in a
script that measures how many lines of its own code are "core" versus
"everything else," as a recurring discipline; Bee Box has no equivalent
measurement. nanobot's scheduler is a hand-rolled poll loop with no external
dependency; Bee Box's schedule cards and `bbx tick` serve the same role at
larger scope, including procedures and connector-driven jobs nanobot has no
counterpart for.

**What this comparison did not look at:** pricing, hosted offerings,
community size, or security posture.

---
description: "Letta is a stateful-agent server framework whose newest memory design converged on files and git; Bee Box was built that way from the start."
compared:
  date: 2026-07-04
  subject: "Letta / letta-code (MemGPT), Letta AI (source clone studied; version not recorded)"
  beebox: "2026-07-04"
  looked-for: [agent loop and tool enforcement, memory storage, scheduling, multi-agent structure, approvals]
  not-looked-for: [pricing, hosted offerings, community size, Letta's memory-retrieval design specifically]
---
# Bee Box compared with Letta

Letta (the company behind the earlier MemGPT research) is a server framework
for building stateful AI agents: each agent is a row in a database, and a
separate CLI, `letta-code`, offers a Claude-Code-like way to drive one. Bee
Box is a complete personal assistant built around a **box**: one directory,
also a git repository, holding **cards** (files with YAML frontmatter and a
markdown body), rather than a framework for building other assistants.

**Where they are similar.** Letta's newer feature, agent memory stored as
markdown files with frontmatter in a per-agent git repository where every
self-edit is an attributed commit, arrived independently at the same
substrate Bee Box uses for all of its data, after Letta had spent years on a
database-first design. Both systems also settled on a flat, non-hierarchical
agent structure: Letta's multi-agent manager types are mostly unmaintained
except one, matching Bee Box's own choice of one agent per box. Letta's
durable, resumable approval requests are the same idea as Bee Box's question
cards: a pending decision with an identity, waiting for an answer.

**Where they differ.** Letta enforces behavior in code: nine kinds of "tool
rules" (forcing a call, sequencing calls, capping repeats, requiring
approval) are declarative objects that generate both the rule's description
in the prompt and its mechanical enforcement in the loop, so the two cannot
drift apart. Bee Box's equivalent, prose instructions embedded in a card
schema, is doctrine the agent is expected to follow, not something the code
checks. Letta has no scheduler, cron, or timer of any kind, so anything like
"check my email every morning" needs an external caller; Bee Box's schedule
cards and `bbx tick` are built in. Letta is infrastructure for building an
agent product; it has no connectors, channels, or install path aimed at an
end user the way Bee Box does.

**What this comparison did not look at:** pricing, hosted offerings,
community size, or Letta's memory-retrieval design (out of scope by request).

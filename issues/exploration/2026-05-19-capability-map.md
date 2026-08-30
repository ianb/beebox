---
title: "capability map"
workstream: unknown
needs: [design]
area: beebox
---

The agent sees its tool list each turn, so it knows individual tools exist, but it doesn't necessarily know the *compositions* — "I can set up a recurring check-in," "I can pull a photo from Drive and attach it to a card," "I can ask you a question later via Telegram." Those are capabilities that span multiple tools, and an agent reasoning from the tool list alone tends to miss them. Symptoms: agent says "I can't do that" when it actually can; agent proposes a clunky path when a clean one exists; agent doesn't think to offer something because no single tool maps to it.

Shape: written at the boxholder's level of abstraction (what the boxholder can *ask for*), grouped by domain (scheduling, capture, retrieval, notification, narration). Each entry: what it does, what triggers it, what it can't do — the negative space matters as much as the positive ("can attach photos by Drive link, can't currently search Drive for them").

Open questions:
- **Global vs. conditional load.** One always-loaded document is simple but costs tokens every turn for unused capabilities. Per-domain files loaded via `paths:` rules scales better but the agent has to know to look.
- **Generated vs. hand-written.** Generated from schema/tool annotations stays fresh but misses the *composed* capabilities, which are the whole point. Hand-written captures composition but drifts. Probably hand-written with an audit hook that complains when tools are added without capability-map updates.

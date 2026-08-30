---
title: "Cmd-K: document-scoped fast chat"
workstream: unknown
area: beebox
---

The web UI gets a Cmd-K palette that's not really a "command palette" in the Obsidian sense — it's a **lightweight chat session scoped to the current document**, backed by a fast/cheap model (Haiku). Distinct from the main chat assistant (which is cross-context, agentic, can dispatch jobs).

Use cases:

- "find me the section about X" — jumps within the current card or across a small surrounding set
- "open the recipe Jane sent me last week" — quick navigation
- "summarize this" — local summary, no work dispatched
- "what does `<fragment>` mean here?" — schema-aware explanation of a card element
- "what links to this?" — backlinks query, surfaced inline

The cheap-model choice keeps latency in the keyboard-shortcut tier and cost negligible enough to leave it always-on. It resolves the "is this a command palette or a chat?" tension by collapsing it: a Cmd-K palette where the input is natural language and the affordances are navigation + Q&A about what you're looking at.

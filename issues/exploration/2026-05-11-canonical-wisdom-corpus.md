---
title: "Canonical wisdom corpus (in lieu of plugins)"
workstream: unknown
area: beebox
---

Obsidian's plugin ecosystem solves "how do I extend the tool to do X?" by letting any developer publish installable code. In an agentic system the question is different: the agent can already compose primitives, so the missing piece isn't *code* but *knowledge* — what's a good way to track books? How do recipe collections usually get organized? What's the right schema shape for a CRM-lite?

The proposed analog is a **Wikipedia-shaped corpus of canonical knowledge** the agent consults when the boxholder expresses intent. Not installable, not executable — just documents (probably cards themselves) describing patterns, conventions, and design considerations for common goals. The agent reads, then assembles primitives within the box accordingly.

Properties this would want:

- **Browsable by humans** as well as agents — the boxholder can read "how people structure book tracking" and decide they want a variant.
- **Versioned and stable** — older boxes referencing older guidance shouldn't see it silently rewritten.
- **Collaborative / curated** — a shared remote (or set of remotes) rather than per-box, so wisdom accumulates across the user base.
- **Discoverable on intent** — when a user asks for X, the agent searches the corpus and surfaces relevant entries; the user can override or extend before the agent commits to a build.

Long horizon. The minimum viable version is just a `docs/patterns/` directory inside beebox itself with a handful of curated examples, surfaced to the agent via the existing rule system. The maximum is something like a federated wiki of agentic-design patterns across many systems. Worth flagging now so the architecture doesn't accidentally foreclose it (e.g., by hardcoding patterns into core rather than treating them as content).

---
name: feedback-files-over-external-trackers
description: "For project state, notes, work-queues, and knowledge — prefer files in the repo over external services (Linear, Notion, Jira, etc.)"
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 6f088193-eb30-436c-80bbx-1b6a986f9034
---

For project state, work-tracking, notes, design docs, and durable knowledge — default to files in the repo (markdown, structured text, etc.) rather than external services (Linear, Jira, Notion, Confluence, etc.).

**Why:** Ian explicitly said *"I don't use external things, and I do like keeping everything on file like this."* Files in the repo are:
- Versioned alongside the code they describe
- Inspectable by any contributor without auth or accounts
- Searchable and editable with normal dev tools
- Portable — they go with the repo
- Not at the mercy of a vendor's UI changes or shutdowns
- Aligned with the open-source ethos ([[feedback-transparency]] applies to project state too)

Also relevant: the existing "Memory System Concerns" note at the top of MEMORY.md captures the same preference for memory specifically — durable knowledge belongs in repo files rather than the path-hash auto-memory store.

**How to apply:**
- When suggesting a tool for tracking work, notes, or knowledge: propose a markdown file in the repo first. Reach for external services only if the user asks or there's a specific reason a file won't work (real-time collaboration, external stakeholder access, etc.).
- Specific applicable cases: TODO/work-queue → `TODOS.md` or similar; design notes → `docs/`; architectural decisions → ADRs in `docs/`; engineering principles → `engineering-principles.md` or a CLAUDE.md section.
- This applies to **project state and knowledge**, not to all external services categorically — Ian still uses GitHub for code hosting, npm for packages, etc. The preference is about *where the project's own state lives*.

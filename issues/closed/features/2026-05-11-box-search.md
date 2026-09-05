---
title: "Full-text + semantic search over a box"
workstream: unknown
area: beebox
resolution: implemented
---

**Closed (2026-07-15): implemented** — shipped as `bbx search` + the global
`contains:` field (`src/core/search/`, Orama-based; design in
`docs/implemented-plans/box-search.md`), as the body already records.
Embeddings/hybrid (phase 3) remain a separate future plan, tracked on their own —
not a blocker for closing the core search work.

Shipped June 2026 as `bbx search` + the global `contains:` field — see
`docs/implemented-plans/box-search.md`. Embeddings/hybrid remain future
(phase 3, own plan); the notes below are the original thinking.

Today discovery in a box is path-based and rule-injected (great for agents, weak for humans). There's no Quick-Switcher / Cmd-Shift-F equivalent — a boxholder who wants to find a specific card has to `grep` or ask the agent. Worth borrowing the Obsidian-style read surface even though writing remains agent-driven.

Prior art: `~/src/ske/ske/src/index/search-index.ts` uses **[Orama](https://github.com/oramasearch/orama)** (`@orama/orama` + `@orama/plugin-data-persistence`) — pure-TS in-process search with both full-text and vector modes. Single binary index file on disk (`search.msp`), restore-from-file on startup, no external service. The ske schema indexes `{ path, kind, name, content, contentHash, embedding: vector[512] }` and exposes `textSearch` + `vectorSearch` with `pathPrefix` / `kind` filters.

What ske did that transfers well:

- **Per-tag indexing for XML** — `extractSearchableTags` walks the XML tree and emits one document per tag-path (`/recipe/ingredient`, `/recipe/step`). Lets search hit specific structural locations, not just whole files. Same pattern works for cards.
- **Markdown section indexing** — `extractMarkdownSections` splits docs by header hierarchy. Useful for guides and generated docs.
- **`contentHash` field** — lets reindex skip unchanged documents.
- **Excerpt generation** around the matched term for result display.

Why this is a good fit for callback specifically:

- Typed cards mean the index schema can include `kind` for first-class filtering by card type.
- Refs already give us a graph; pairing it with text/vector search would close most of the human-discovery gap identified vs. Obsidian (Quick Switcher, Cmd-Shift-F, Omnisearch-style ranking).
- Vector search on uplifted card text would catch "I'm looking for that thing about X" queries where the user doesn't remember the exact wording.
- Index lives in `.beebox/` (already gitignored), rebuilt by `bbx init` or incrementally on commit.

Shape of the work:

1. `bbx search "query"` CLI — text + path/kind filters, excerpt output.
2. Web UI Cmd-K palette over the same index.
3. Optional: an MCP tool or `bbx search` invocation surface for the agent itself, useful when "what cards mention X?" beats `grep` (synonyms, partial matches, ranking).
4. Embedding generation can be lazy / opt-in (cost) — start with text-only.

Not urgent. The agent doesn't currently need it (path conventions + rules cover its discovery), and humans get by with the chat assistant. But it's a high-value, low-risk addition when human direct-browsing becomes a friction point.

Another option worth looking at: **mempalace** — <https://github.com/mempalace/mempalace> — framed as a memory-palace tool but effectively a search/recall surface over arbitrary notes. Different ergonomics from Orama-style index search; worth a side-by-side if/when this work lands.

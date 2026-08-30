---
title: "Backlinks surface (\"what links here?\")"
workstream: unknown
needs: [design]
area: beebox
---

Cardworks already exposes the ref graph — `findIncomingRefs(targetPath)` and `findOutgoingRefs(sourcePath)` in `cardworks/src/loader/loader.ts`. The data exists; no read surface does. Obsidian's Backlinks pane is widely considered its most-used navigation surface, and we have a richer (typed, versioned, fragment-addressable) reference model — closing the UI gap is mostly plumbing.

Sources to merge into one "incoming" list:

1. **Formal refs** — `ref=""` and `refs=""` attributes on any element. Already indexed. Includes version + fragment, so a backlink can say "Recipe.card references this @1.0.0 at `//step[@id='saute']`".
2. **Markdown links in card text** — `[label](path/to/Other.card)` written in prose-typed elements (memos, notes, guides). Not currently part of the ref graph. Need a markdown-aware extractor that resolves relative paths against the source card's location and emits virtual references. Worth detecting both `.card` targets and links to non-card files (images, attachments) so attachments can also answer "where is this used?".
3. *(Optional, later)* **Unlinked mentions** — Obsidian-style: scan card text for plain occurrences of other cards' names/aliases that aren't yet linked. On uplift, the agent can be prompted "this memo mentions 'Jane' — should I `ref` her person card?" — same affordance as Obsidian's one-click promotion, but agent-mediated rather than UI-button.

Surfaces:

- **Card detail view** — a "Referenced by" panel listing incoming refs with source card name, kind, and the structural location (XPath fragment or element type). Group by source kind.
- **`bbx refs <card>`** CLI — `--incoming` / `--outgoing`, JSON or table output. Useful for agents during cleanup ("is this card still referenced anywhere?") and humans during direct inspection.
- **Pre-delete check** — before `bbx rm`, surface incoming refs so the user/agent knows what will dangle. Cardworks already updates refs on `bbx mv`; delete should at least warn.

Combine well with the search feature above: search results that include a backlink count give a quick "popularity" signal for which cards are central to the box.

**Show the version each backlink pins.** Refs carry a version (`@1.0.0`), and the design stance is that those versions should be preserved — a ref captures what the linker meant *at link time*, not whatever the target looks like now. So the backlinks panel should visually distinguish refs to the current version from refs to older versions, and clicking through to an old-version ref should display the historical card content (from git) rather than silently substituting current. See the addressability section below — same principle.

Not urgent for the same reason as search — the agent navigates by path conventions and the user navigates via chat. Becomes important once humans start browsing cards directly, or once we want the agent to do graph-aware reasoning ("clean up cards with no incoming refs older than 90 days").

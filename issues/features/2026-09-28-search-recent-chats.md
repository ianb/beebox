---
title: "Search recent chats by what was said in them, with the same kind of semantic search cards get"
workstream: chat-search
needs: [design]
design: ../../beebox/docs/plans/chat-search.md
area: beebox
labels: [chat, search]
filed-by: agent
discovered-by: Ian
discovered-in: main — boxholder discussion, 2026-09-28
---

**Job to be done.** The boxholder remembers talking about something in a
recent chat and wants to find that chat. Today the only way is to scroll the
chat list and open chats one by one. The boxholder wants to search recent
chats, ideally with something close to the box's embedding search, but over
the chat logs themselves.

## What exists (checked 2026-09-28; verify before building)

- **Box search** is an Orama index with embeddings
  (`beebox/src/core/search/`: `store.ts`, `walk.ts`, `extract/`, `query/`,
  `refresh/` with an embedding pass; the embeddings key is resolved in
  `embeddings-key.ts`). It indexes cards: fields such as `contains` and body
  sections.
- **Chats are cards only as husks.** Each web chat has a `.chat.card` husk
  (`beebox/src/schemas/chat.ts`). The search walk does not appear to skip
  them, so a husk's `title`, `contains`, and `contains-evidence` are
  probably searchable. Check this.
- **The conversation text is not indexed.** Transcripts live in the engine's
  own store (Claude Code JSONL, or Codex threads), outside the box tree. See
  `beebox/src/core/chat/husk-transcript.ts` and
  `beebox/src/core/chat/transcript-render.ts`.
- **Summaries arrive late and only for some chats.** The nightly chat review
  writes `title`, `contains`, and `contains-evidence` only on sessions that
  have grown enough to re-read. A chat from this morning, or a short one, has
  nothing to match.

## What to design

- **What gets indexed.** User and assistant message text, split into
  chunks (per turn, or per few turns), each chunk pointing back to its chat
  and its position in the transcript so a result can open the chat at the
  matching message. Tool calls and tool output are probably noise.
- **One index or two.** Add transcript chunks to the existing box index as a
  separate document kind, or keep a separate chat index with the same Orama
  machinery. The store's header notes that restore cost grows with vectors,
  and transcripts are large.
- **When it updates.** Incrementally, as turns land or on a short delay,
  so that a recent chat is findable the same day.
- **"Recent".** Whether to index only recent chats (and how recent), or all
  of them with recency as a ranking signal.
- **Engines.** Both Claude and Codex transcripts, through the existing
  transcript readers.
- **Cost and privacy.** Embedding sends text to the embeddings provider,
  under the same key and consent rules as card search (`embeddings-key.ts`).
- **The UI.** A search field on the chat list, or chats as a result type in
  the existing search. Results show a snippet and open the chat at the
  matching message.

Related: [chat backend port hygiene](../code-quality/2026-07-18-chat-backend-port-hygiene.md)
(owning our transcripts would make them easier to index),
[chats in global search](2026-09-28-chats-in-global-search.md) and
[private-session search gating](2026-09-28-private-chat-sessions-search-gating.md)
(follow-ups deferred from the 2026-09-28 design: text-only ranking chosen, so
no embeddings consent question remains).

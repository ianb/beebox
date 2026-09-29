---
title: "Chats as a result type in global search (Cmd+K and the search page)"
workstream: unattached
needs: [design]
area: beebox
labels: [chat, search]
filed-by: agent
discovered-by: Ian
discovered-in: worktree-chat-search — chat-search design discussion, 2026-09-28
---

Once chat transcript search exists (see
[2026-09-28-search-recent-chats.md](../closed/features/2026-09-28-search-recent-chats.md)), the
boxholder wants chat results in the global search surfaces too — Cmd+K quick
search and the search page — not only the search field on the chat list.

**The tension.** Global search surfaces every card to every box user, so
adding chats there publishes each person's conversations to everyone with box
access. The boxholder accepts this direction but wants privacy gating first:
see
[2026-09-28-private-chat-sessions-search-gating.md](2026-09-28-private-chat-sessions-search-gating.md).
That issue is a prerequisite, not a companion.

## What exists

- Cmd+K quick search: `QuickSearchOverlay.tsx` queries `trpc.search.query`
  and opens results as workspace card paths (`workspace.open({ path })`) or
  bare paths typed by hand. A chat hit has no card path to open — it routes
  to `/chat?session=<id>&m=<entryUuid>` instead, which the overlay's open
  path does not model.
- The search page (`renderers/search.tsx`) filters by kinds and path
  prefixes; chats live in a separate index with a separate query procedure by
  design (restore-cost isolation, see `beebox/docs/plans/chat-search.md`).

## What to design

- How chat rows render alongside card rows: one merged ranking or a separate
  "Chats" group; which surface (Cmd+K, search page, or both) goes first.
- The open path: extend the overlay's `openResult` to route chat hits to the
  chat deep link instead of `workspace.open`.
- Per-user gating wired into whatever query merges the two indexes, per the
  prerequisite issue.

Related: [2026-05-11-cmd-k-document-scoped-chat.md](2026-05-11-cmd-k-document-scoped-chat.md)
(Cmd+K scoping precedent).

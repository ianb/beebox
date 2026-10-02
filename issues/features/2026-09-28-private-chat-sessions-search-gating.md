---
title: "Mark some chat sessions private, and restrict their search to the user who initiated them"
workstream: unattached
needs: [design]
area: beebox
labels: [chat, search, multi-user, identity]
filed-by: agent
discovered-by: Ian
discovered-in: worktree-chat-search — chat-search design discussion, 2026-09-28
---

Boxholder direction (2026-09-28): once chat transcripts are searchable from
shared surfaces (see
[2026-09-28-chats-in-global-search.md](2026-09-28-chats-in-global-search.md)),
a conversation one person considers private becomes visible to every box
user. The wanted shape: a classifier marks some sessions private, and search
over those private sessions is allowed only for the user who initiated them.

**Why this is live.** Pairing lets anyone with box access act as themselves
(`docs/mobile-contract.md` §2.3), so shared boxes with distinct identities
are the normal case — the same single-user assumption being undone in
[2026-09-12-most-recent-conversation-should-be-per-person.md](2026-09-12-most-recent-conversation-should-be-per-person.md).

## What exists to build on

- Transcript entries already carry authorship: user messages in multi-user
  chat carry `user` and `user-email` identity attributes
  (`beebox/src/cli/lib/session-entry.ts`, `userIdentity`), so "who initiated
  this session" is derivable from the first user message rather than new
  bookkeeping.
- Chat husks (`beebox/src/schemas/chat.ts`) are machine-written cards with
  machine-owned fields already maintained by the nightly chat review
  (`review-span`, `contains-evidence`) — a `private` determination has an
  established owner pattern and write path.
- Chat search results flow through one query procedure, so a per-viewer
  filter has one place to land once the viewer's identity is known to the
  backend.

## What to design

- **The classifier.** What marks a session private: an agent judgment in the
  nightly review (reading the transcript it already reads), a rule, or a
  boxholder toggle. Where the flag lives (husk field vs. runtime state) and
  what hand-editing it means.
- **Default posture.** Private by default with public opt-in, or the
  reverse; what a brand-new session is while unclassified.
- **Identity matching.** Pairing identity vs. transcript `user-email`; what
  happens when the initiating user has no paired identity.
- **Enforcement surface.** Search is the gating requirement; whether the chat
  list, transcripts, and card search over the husk get the same filter is a
  scoping decision with its own blast radius.

Note the v1 chat search field (chat list panel) intentionally ships without
this: that panel already lists every chat box-wide, so it adds no new
exposure. Any broader surface must come after this issue.

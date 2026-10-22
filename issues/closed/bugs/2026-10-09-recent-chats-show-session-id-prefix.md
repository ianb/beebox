---
title: "Recent chats shows an eight-character session id beside each chat name"
workstream: chat-chrome-fixes
area: beebox
resolution: implemented
filed-by: agent
discovered-by: agent
discovered-in: worktree-journey-walks-oct — A-lending, B-inventory journey walks, 2026-10-09
---

> **Closed 2026-10-16:** Fixed by `f596057a2`, `1e591920f`. The short id shows only when two visible rows (or search results) share a label, and not when the label already is the id; every row carries the full id in its tooltip. Rule in `sessionIdHint` (`session-list-grouping.ts`), doctested.

Each row in Recent chats shows a hex code after the chat's title, for example
"d145a152". The A-lending walker asked what it was. The B-inventory walker did
not comment, but the same code showed in all three rows. The person gets
nothing from it: chats now have generated titles, so the id no longer
tells chats apart.

## Mechanism

The first eight characters of the session id render in monospace
(`beebox/src/frontend/src/components/chat/everywhere/InteractiveChat/SessionListPanel.tsx:224,272`)
and in the search results
(`beebox/src/frontend/src/components/chat/everywhere/InteractiveChat/session-search.tsx:161`).
The id also serves as the fallback label for an untitled chat
(`session-search.tsx:141`). Unverified: whether the id was added to tell
untitled chats apart or to help debugging; the code has no comment on it.

## Why the fix is not obvious

The id helps when two chats have the same title or none, and for someone
matching a chat to a transcript on disk. Hiding it for titled rows only, or
moving it to a tooltip, keeps that use.

Related: [conversation-keeps-placeholder-title](../bugs/2026-10-08-conversation-keeps-placeholder-title.md)
(closed; titles are why the id is now noise).

Reports: [A-lending](../../../beebox/test/user-stories/journeys/A-lending/reports/2026-10-09.md) row 50,
[B-inventory](../../../beebox/test/user-stories/journeys/B-inventory/reports/2026-10-09.md) row 65.

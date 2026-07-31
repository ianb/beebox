---
title: "Chat history dropdown lists all chats, not just the current landmark's"
area: callback-box
filed-by: agent
discovered-in: main session — boxholder in a landmark-scoped chat
resolution: implemented
---

Closed 2026-07-31 (worktree-chat-history-landmark-prominence). The UX
question below was settled as **prominence, not scoping**: the dropdown
still lists every chat in the box, but the current landmark's chats lead
under that landmark's name and the rest follow under "Other chats",
tagged with where they live. Root is a landmark like any other. When
grouping would say nothing — no chats in this landmark, or every chat in
it — the list stays flat, as before.

The two enumerations were unified in the same change: `chat.sessions`
read the history JSON while `chat.byLandmark` read husk cards, so a
deleted husk vanished from the picker but lingered in the dropdown. Both
now use `core/chat/session/list.ts`. That made a missing husk hide a chat
from *every* list, so the one-shot marker-gated husk backfill became a
per-boot `reconcileChatHusks` (see `docs/plans/chat-husks.md` § Phase 2b).

Verified in a real browser (`bin/browse`, three chats across two landmarks
and root): each landmark's chats lead under its own heading, the rest stay
reachable under "Other chats" tagged with where they live, the current
session keeps its highlight, and clicking a row from another landmark
navigates into it. Covered by `test/frontend/session-list-grouping.doctest.md`
and `test/webapp/chat-sessions-label.doctest.md`.

The chat history dropdown (the clock-icon `SessionListButton`) shows every web
chat session in the box, ignoring the current landmark/directory scope. When
you're chatting inside a landmark, its history should be that landmark's chats,
not all of them.

## Cause

Chat sessions **are** landmark-scoped — a session binds to a `contextDir`
(`src/core/chat/session/registry.ts:245`, the SDK is spawned with `cwd` at that
directory). And a scoped listing already exists: `chat.byLandmark`
(`src/webapp/trpc/routers/chat.ts`) returns "sessions … same landmark" for the
chat-landing picker.

But the **history dropdown** uses a different, unscoped endpoint. `SessionListButton`
→ `getChatSessions()` (`api-chat.ts:157`) → `trpcClient.chat.sessions.query()`
with **no arguments**. The procedure (`chat-session-procedures.ts:67`,
`publicProcedure.query(async ({ ctx }) => …)`) takes no input and lists **all**
sessions. And `SessionListButton` isn't even passed the current `contextDir`, so
it has nothing to filter by.

So two things line up wrong: the endpoint doesn't accept a scope, and the
component doesn't hold one.

## Fix direction

Scope the dropdown to the current landmark, matching the picker:

- Thread `contextDir` into `SessionListButton` (it already receives `boxSlug` and
  `currentSessionId`; add the active scope the chat is running in).
- Give `chat.sessions` an optional `contextDir` filter, or point the dropdown at
  the existing `chat.byLandmark` scoping so there's one source of truth for
  "sessions in this landmark" rather than two divergent listings.
- Sessions already carry `contextDir`, so the filter is a straight match.

## UX question

Strictly-scoped means you can't reach a chat from another landmark via this
dropdown. Decide whether that's wanted (clean, matches the picker) or whether it
should be "this landmark's chats, with a 'show all' / 'other landmarks'
affordance." The boxholder's report says show the current landmark's — default to
that; a fallback to all can be a follow-up. Also decide what the **root/no-landmark**
chat shows (all, or only root-scoped sessions).

## Verify

Open chats in two different landmarks; from within one, confirm the dropdown
lists only that landmark's sessions (and the current one is marked). Confirm the
unscoped/root chat still behaves sanely.

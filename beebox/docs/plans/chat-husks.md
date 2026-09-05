---
title: "Chat husks — web chat sessions as cards (phase 1)"
status: partial
workstream: unknown
issues: []
---
# Chat husks — web chat sessions as cards (phase 1)

Web chat sessions are currently invisible to the box: bookkeeping JSON
under `.beebox/`, transcripts under `~/.claude/projects/`. Telegram
threads meanwhile ARE cards. A **husk** fixes the asymmetry: a small card
per web session — the *noun* for the session — making chats addressable,
searchable, ref-able ("as we discussed in [chat]"), and pinnable, while
the live session stays the *verb*.

## Design

**Husk = identity + editorial, never activity state.** Fields: `session`
(the SDK session id — the pointer), `context-dir`, plus global
`title`/`contains` and a notes body. Freshness/activity stays in runtime
bookkeeping (`lastActivity` is the transcript mtime, merged at read time)
— a card that changed on every message would spam git history.

- **Type**: `chat` (no collision; `chat-thread` stays the connector-thread
  type). `category: "synced"` (system-created), searchable — that's the
  point.
- **Path**: `store/chat/web/<YYYY-MM-DD>_<shortid>.chat.card` (date =
  session start, shortid = first 8 of session id). Rename-safe: the
  association is the `session` field, not the filename, so `bbx mv` to a
  meaningful name is always fine. Idempotency key = the
  `_<shortid>.chat.card` suffix.
- **Creation**: eagerly, at session-id assignment
  (`chat-session-registry.makeOnAssigned`, beside `appendHistory`) —
  every web chat gets a header card. Failure is logged, never blocks the
  chat.
- **Reconcile**: `reconcileChatHusks` gives every history entry a husk
  (skipping ghosts whose JSONL is gone), fired fire-and-forget *after*
  the existing session backfill (`webapp/routes/chat.ts`) — it reads the
  history that backfill writes, so the two can't run concurrently.
  Dates from transcript mtime. It runs on **every boot**, not once
  behind a marker: husks are the enumeration for both the picker and
  the history dropdown, so a session that missed its eager husk (the
  assignment-time write is best-effort) would otherwise be invisible
  forever. Repeating is cheap — one directory listing plus one history
  read, with per-session work only for husks that are actually missing.
- **Title**: best-effort first-user-message snippet at creation/backfill
  (often unavailable at assignment time for new sessions — fine; later
  enrichment by the agent/retro is the intended path, it's an editable
  card).
- **Renderer**: `chat` card renderer showing title/context/session with
  an "Open chat →" link to `/chat?session=<id>`. The full inversion —
  chat *at* the husk's path, husk as the chat view's subject — is future
  (frame/companion-slot work), as is converting `chat.byLandmark` to
  enumerate husks (a query-card design question).

## Phase 2 (implemented 2026-07): the picker reads husks

`chat.byLandmark` enumerates husk cards, not the history JSON — the cards
are the source of truth for which web chats exist and what they're called
(`title` beats the transcript snippet; deleting a husk is editorial
removal from the picker; the husk's own `context-dir` locates the
transcript, no history lookup). Freshness stays runtime-derived from
transcript mtime, and husks whose transcript is gone are skipped (nothing
to resume) while remaining browsable as cards. Each picker row links to
its husk ("card").

**Phase 2b (2026-07-31): so does the history dropdown.** `chat.sessions`
read the history JSON, so a deleted husk vanished from the picker but
lingered in the dropdown. Both now share one enumeration —
`core/chat/session/list.ts` `loadAllSessions` — and the dropdown groups
its rows by the landmark each session binds to (the current landmark
first, everything else under "Other chats"). Making husks the only
enumeration is what promoted the boot backfill to a per-boot reconcile:
a missing husk now hides a chat from every list, so it has to be
repairable.

## Deferred

- Path-addressed live chat (`<husk>?view=chat`), the companion slot, and
  URL untangling.
- Automatic title/contains enrichment; refs from husks to discussed cards
  (agent behavior, not plumbing).
- Claiming a directory (`<slug>.chat.card` + `<slug>/`) if transcripts or
  artifacts ever move into the box.

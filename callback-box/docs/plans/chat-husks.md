# Chat husks — web chat sessions as cards (phase 1)

Status: **phase 1 implemented 2026-07** (schema `src/schemas/chat.ts`,
core `src/core/chat-husk.ts`, assignment hook in
`chat-session-registry.makeOnAssigned`, boot backfill in
`webapp/routes/chat.ts`, renderer `components/chat-husk/ChatHuskView`).
The Deferred section below is still future. Part of
`docs/plans/interface-as-cards.md` ("Chat / Husks").

Web chat sessions are currently invisible to the box: bookkeeping JSON
under `.callback-box/`, transcripts under `~/.claude/projects/`. Telegram
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
  association is the `session` field, not the filename, so `cb mv` to a
  meaningful name is always fine. Idempotency key = the
  `_<shortid>.chat.card` suffix.
- **Creation**: eagerly, at session-id assignment
  (`chat-session-registry.makeOnAssigned`, beside `appendHistory`) —
  every web chat gets a header card. Failure is logged, never blocks the
  chat.
- **Backfill**: one-shot for existing history entries (skipping ghosts
  whose JSONL is gone), gated by a `.callback-box/` marker, fired
  fire-and-forget at the same spot as the existing session backfill
  (`webapp/routes/chat.ts`). Dates from transcript mtime.
- **Title**: best-effort first-user-message snippet at creation/backfill
  (often unavailable at assignment time for new sessions — fine; later
  enrichment by the agent/retro is the intended path, it's an editable
  card).
- **Renderer**: `chat` card renderer showing title/context/session with
  an "Open chat →" link to `/chat?session=<id>`. The full inversion —
  chat *at* the husk's path, husk as the chat view's subject — is future
  (frame/companion-slot work), as is converting `chat.byLandmark` to
  enumerate husks (a query-card design question).

## Deferred

- Path-addressed live chat (`<husk>?view=chat`), the companion slot, and
  URL untangling.
- byLandmark / Chats picker over husks.
- Automatic title/contains enrichment; refs from husks to discussed cards
  (agent behavior, not plumbing).
- Claiming a directory (`<slug>.chat.card` + `<slug>/`) if transcripts or
  artifacts ever move into the box.

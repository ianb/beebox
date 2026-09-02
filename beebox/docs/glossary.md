# Glossary

The Proper Nouns of beebox. Two kinds of entries belong here:

1. **Names we coined** — terms that only mean something inside this project (Card, Box, Wakeup Cycle, Procedure, Connector).
2. **General words we've narrowed** — common words we've given a specific meaning that differs from or is sharper than the everyday sense (Attachment, Asset, Service, Inbox).

If a term is just normal English used in its normal sense, it doesn't belong here. If a term is specific to one corner of the codebase and doesn't need shared vocabulary, it belongs in that area's docs instead.

When a term here conflicts with how code or other docs use it, the glossary is the source of truth — update the code/docs to match, or update this file if the term has genuinely shifted.

Keep entries short. One paragraph max. Link to deeper docs rather than restating them.

## User-facing register

Most of these terms are for operating the system, not for showing to users.
Each entry below carries a **User-facing:** line saying what a user-visible
surface (UI label, agent reply) says instead: the same word, a different word,
or *internal — never shown*. UI copy and the agent guide's "Speak the User's
Language" section (`src/core/agent-guide/behavior.ts`) defer to these lines;
to change a user-facing word, change it here first. Decisions recorded
2026-09-02 (`docs/plans/vocab-glossary-sweep.md`).

**Open question — capitalization.** Proper nouns in English are normally capitalized. We may want to write "Asset" and "Card" with initial caps in prose to signal "this is the project term, not the everyday word." Not yet decided; entries below use lowercase pending that call. See [issues/decisions/2026-05-21-glossary-proper-nouns.md](../../issues/decisions/2026-05-21-glossary-proper-nouns.md).

## Storage and files

**box** — A single user's working directory under `~/src/boxes/` (or `/home/beebox/boxes/` on the server). Contains the user's cards, config, and state. Each box is an independent git repo. For a v2 (package-layout) box, "box" specifically means the `content/` directory (`boxRoot`) nested inside the coding-session package (`packageRoot`) — see `docs/box-layout.md`.
*User-facing:* same — "your box" is the user's box, the totality of their stuff. Never the app's name for itself (no "box assistant"), and never a bare place label (the root place is "Home").

**boxholder** — The human a box belongs to. Used in shared prose where "the user" is ambiguous (since agents are also "users" of the system). See CLAUDE.md note on avoiding personal names.
*User-facing:* internal — never shown. The agent addresses the boxholder as "you".

**card** — A typed file validated by a schema from `beebox/cards`. The atomic unit of data in a box. Named `Title.type.card` (e.g. `Voice_Memo.memo.card`). Every card is YAML frontmatter + markdown body — the legacy XML card *file format* and its loader are gone (see the `cardworks` entry below). That doesn't mean XML-shaped markup is gone from card content: pseudo-XML elements like `<schedule>` (see `docs/chat-schedules.md`) still show up as a live pattern embedded *within* markdown bodies and chat text — a different thing from the on-disk file format. See `docs/adding-schemas.md` and `docs/cards-as-markdown.md`.
*User-facing:* prefer the thing's own name — "your recipe", "the memo" — over "the card"; "card" is acceptable when nothing more specific exists. Filenames and paths go inside links, never as the noun of a sentence.

**quantity / measurements** — The record schema's two number-carrying fields (`src/schemas/record.tsx`). `quantity` is a single `{value, note?}` answering "how much/many of it do I have" ("3 items", "10 ounces", "roughly 15–20"); `measurements` is a `{value, note?}` list of facts about the thing itself ("7 feet", "45 pounds", "1200 USD"). Values are natural language carrying number and unit together. (Renamed from `measures`, 2026-09; migration `record-measurements`.)
*User-facing:* these are field names users may see on card views; the words were chosen to read as plain English.

**attach scope** — A directory named `<basename>.attach/` sitting next to a card with the same basename. Holds the card's attached files. Cards reference into it via `<filename ref="attach/...">`. Nested cards have nested attach scopes.

**attachment** — Any file inside a `.attach/` scope, regardless of how it's stored in git. A markdown sidecar, a notes file, a photo — all attachments. Commits to git normally unless it's also an asset.
*User-facing:* same — "attachments" is fine (email trained everyone); introduce it in context ("the photos and files saved with this recipe"). A machine-derived companion file (a transcript next to a voice memo, timing data next to a clip — informally a "sidecar") gets no umbrella noun with users: name the kind ("the transcript").

**asset** — a photo, scan, audio, or video file inside a `.attach/` directory, tracked by git-annex: git records a small pointer, git-annex holds the bytes keyed by SHA-256. See `docs/assets.md`.
*User-facing:* internal — say what the file is ("the photo", "the recording"). The dashboard's storage accounting is labeled "Storage", not "Inventory" (that word belongs to the user's own inventorying jobs).

**asset manifest** — the *superseded* mechanism: a `manifest.json` in each `.attach/` directory recording every asset's size, mtime, and sha256, with the assets themselves gitignored. Still on disk in any box not yet migrated with `bbx attachments to-annex`. See `docs/implemented-plans/asset-manifests.md`.

## System concepts

**wakeup cycle** — One full sync-and-process pass. `bbx wakeup` preprocesses inbox items → housekeeping + on-wakeup scripts → runs connectors (creating job cards) → one reactor cycle over pending jobs → pushes to the box's git remote. Recurring wakeups are fired by `bbx tick` (`docs/scheduler.md`); outbound cards are flushed by `bbx finalize`, not by an "execute commands" step. See `docs/design/processing.md`.

**reactor** — The main processing loop (`src/core/reactor/DESIGN.md`): find job cards in `box/jobs/` → agent processing (batch jobs in one session; chat jobs with per-thread resumable sessions) → `bbx finalize`. The wakeup cycle's engine.

**connector** — Code that syncs an external service (Gmail, RSS, Telegram, ...) with the box filesystem. Implements `Connector.sync()`. See `src/connectors/CLAUDE.md`.

**procedure** — A multi-step workflow defined as a `*.procedure.card` (YAML frontmatter, no body). Config in `config/procedures/`, runs in `procedure/runs/`. See `docs/procedure-implementation.md`.

**service** — A typed interface wrapping an external dependency, with real and fake implementations. Fakes have observable state for testing. See `src/services/CLAUDE.md`.

**cardworks** — A former standalone card library, now removed. Its frontmatter-card primitives (`cardSchema()`, parsing, serialization, Zod-based validation, the frontmatter splitter) were absorbed into `src/cards/` in this repo and are exposed to box-local schemas via the public `beebox/cards` specifier. Its XML-card support (`element()`) was not carried forward — the XML file format went away with the package, not into `src/cards/`. See `docs/implemented-plans/remove-cardworks-package.md`.

**retrospective** — The `process-retrospective` procedure (driven by `bbx retro`): mines recent chat sessions for what the boxholder implicitly taught the agent and integrates it into personality/guide cards as `source: inferred` beliefs, confidence set by recurrence (1 session = hypothesis, 2–3 = low, 4+ = medium — the ceiling for inferred). Authoritative changes (briefing corrections, conflicts with `user-stated` beliefs) become question cards. Audit trail: run reports in `store/reviews/retro/`, ledger in `.beebox/retro/`, commits trailered `Retro-Run: <runId>`. See `docs/implemented-plans/box-retrospectives.md`.

**inbox** — `box/inbox/`. Where new cards land before processing.

**archive** — `store/archive/`. Where processed cards move after the wakeup cycle finishes with them.

## Chat and navigation

**session** — One resumable chat thread: the Agent SDK session behind it, its transcript, its registry entry (`src/core/chat/session/`). See `docs/chat-session-lifecycle.md`.
*User-facing:* **"chat"** — "New chat", "Recent chats", "this chat". Bare "session" never appears in UI labels ("chat session" in running prose is fine).

**agent** — The Claude Code (or Codex) process working inside a box: the thing the reactor invokes and the chat talks to.
*User-facing:* internal — never shown. The UI says "Thinking…" for a busy turn, and the assistant speaks as "I", never "the agent" or "your box assistant".

**landmark** — A curated navigation anchor for a box directory (`*.landmark.card`): symbol, label, bookmarks, routing destinations. See `docs/landmarks.md`.
*User-facing:* same — kept deliberately (boxholder decision, pending a better word); the agent introduces it with a gloss the first time ("your Landmarks page — the short list of places you jump to most").

**place** — The app bar's notion of where the user is: the pill's label plus the directory it resolves to (`src/frontend/src/lib/place-label.ts`).
*User-facing:* internal — the pill shows the place's *name*; the word "place" itself appears in no label. The root landing place is labeled **"Home"**.

**companion pane** — The chat page's split view: a card opened beside the conversation (full-screen flip on mobile). Tab-shaped and transient (`CompanionViewPanel`, `useChatTabs`).
*User-facing:* no coined noun — say "the tab" or the card's own name ("open it beside the chat").

## Tools and commands

**bbx** — The CLI. The universal interface to a box. Every operation an agent does in a box goes through `bbx` or through direct file edits.

**bbx attachments** — Umbrella command for asset/manifest maintenance: `verify`, `migrate`, `init-gitignore`, `untrack-assets`, `add`, `overwrite`. Operates on the attach scope as a whole even though most subcommands target the asset subset.

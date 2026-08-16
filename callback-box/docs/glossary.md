# Glossary

The Proper Nouns of callback-box. Two kinds of entries belong here:

1. **Names we coined** — terms that only mean something inside this project (Card, Box, Wakeup Cycle, Procedure, Connector).
2. **General words we've narrowed** — common words we've given a specific meaning that differs from or is sharper than the everyday sense (Attachment, Asset, Service, Inbox).

If a term is just normal English used in its normal sense, it doesn't belong here. If a term is specific to one corner of the codebase and doesn't need shared vocabulary, it belongs in that area's docs instead.

When a term here conflicts with how code or other docs use it, the glossary is the source of truth — update the code/docs to match, or update this file if the term has genuinely shifted.

Keep entries short. One paragraph max. Link to deeper docs rather than restating them.

**Open question — capitalization.** Proper nouns in English are normally capitalized. We may want to write "Asset" and "Card" with initial caps in prose to signal "this is the project term, not the everyday word." Not yet decided; entries below use lowercase pending that call. See [issues/decisions/2026-05-21-glossary-proper-nouns.md](../../issues/decisions/2026-05-21-glossary-proper-nouns.md).

## Storage and files

**box** — A single user's working directory under `~/src/boxes/` (or `/home/callback/boxes/` on the server). Contains the user's cards, config, and state. Each box is an independent git repo. For a v2 (package-layout) box, "box" specifically means the `content/` directory (`boxRoot`) nested inside the coding-session package (`packageRoot`) — see `docs/box-layout.md`.

**boxholder** — The human a box belongs to. Used in shared prose where "the user" is ambiguous (since agents are also "users" of the system). See CLAUDE.md note on avoiding personal names.

**card** — A typed file validated by a schema from `callback-box/cards`. The atomic unit of data in a box. Named `Title.type.card` (e.g. `Voice_Memo.memo.card`). Every card is YAML frontmatter + markdown body — the legacy XML card *file format* and its loader are gone (see the `cardworks` entry below). That doesn't mean XML-shaped markup is gone from card content: pseudo-XML elements like `<schedule>` (see `docs/chat-schedules.md`) still show up as a live pattern embedded *within* markdown bodies and chat text — a different thing from the on-disk file format. See `docs/adding-schemas.md` and `docs/cards-as-markdown.md`.

**attach scope** — A directory named `<basename>.attach/` sitting next to a card with the same basename. Holds the card's attached files. Cards reference into it via `<filename ref="attach/...">`. Nested cards have nested attach scopes.

**attachment** — Any file inside a `.attach/` scope, regardless of how it's stored in git. A markdown sidecar, a notes file, a photo — all attachments. Commits to git normally unless it's also an asset.

**asset** — The subset of attachments whose bytes live on disk only, not in git. Tracked via the asset manifest. Photos, PDFs, audio, video, gzipped data — anything in the gitignored extensions list. Every asset is an attachment; not every attachment is an asset.

**asset** — a photo, scan, audio, or video file inside a `.attach/` directory, tracked by git-annex: git records a small pointer, git-annex holds the bytes keyed by SHA-256. See `docs/assets.md`.

**asset manifest** — the *superseded* mechanism: a `manifest.json` in each `.attach/` directory recording every asset's size, mtime, and sha256, with the assets themselves gitignored. Still on disk in any box not yet migrated with `cb attachments to-annex`. See `docs/implemented-plans/asset-manifests.md`.

## System concepts

**wakeup cycle** — One full sync-and-process pass. `cb wakeup` preprocesses inbox items → housekeeping + on-wakeup scripts → runs connectors (creating job cards) → one reactor cycle over pending jobs → pushes to the box's git remote. Recurring wakeups are fired by `cb tick` (`docs/scheduler.md`); outbound cards are flushed by `cb finalize`, not by an "execute commands" step. See `docs/design/processing.md`.

**reactor** — The main processing loop (`src/core/reactor/DESIGN.md`): find job cards in `box/jobs/` → agent processing (batch jobs in one session; chat jobs with per-thread resumable sessions) → `cb finalize`. The wakeup cycle's engine.

**connector** — Code that syncs an external service (Gmail, RSS, Telegram, ...) with the box filesystem. Implements `Connector.sync()`. See `src/connectors/CLAUDE.md`.

**procedure** — A multi-step workflow defined as a `*.procedure.card` (YAML frontmatter, no body). Config in `config/procedures/`, runs in `procedure/runs/`. See `docs/procedure-implementation.md`.

**service** — A typed interface wrapping an external dependency, with real and fake implementations. Fakes have observable state for testing. See `src/services/CLAUDE.md`.

**cardworks** — A former standalone card library, now removed. Its frontmatter-card primitives (`cardSchema()`, parsing, serialization, Zod-based validation, the frontmatter splitter) were absorbed into `src/cards/` in this repo and are exposed to box-local schemas via the public `callback-box/cards` specifier. Its XML-card support (`element()`) was not carried forward — the XML file format went away with the package, not into `src/cards/`. See `docs/implemented-plans/remove-cardworks-package.md`.

**retrospective** — The `process-retrospective` procedure (driven by `cb retro`): mines recent chat sessions for what the boxholder implicitly taught the agent and integrates it into personality/guide cards as `source: inferred` beliefs, confidence set by recurrence (1 session = hypothesis, 2–3 = low, 4+ = medium — the ceiling for inferred). Authoritative changes (briefing corrections, conflicts with `user-stated` beliefs) become question cards. Audit trail: run reports in `store/reviews/retro/`, ledger in `.callback-box/retro/`, commits trailered `Retro-Run: <runId>`. See `docs/implemented-plans/box-retrospectives.md`.

**inbox** — `box/inbox/`. Where new cards land before processing.

**archive** — `store/archive/`. Where processed cards move after the wakeup cycle finishes with them.

## Tools and commands

**cb** — The CLI. The universal interface to a box. Every operation an agent does in a box goes through `cb` or through direct file edits.

**cb attachments** — Umbrella command for asset/manifest maintenance: `verify`, `migrate`, `init-gitignore`, `untrack-assets`, `add`, `overwrite`. Operates on the attach scope as a whole even though most subcommands target the asset subset.

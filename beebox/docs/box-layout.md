# Box Layout

The on-disk shape of a beebox. This is the canonical reference for beebox developers; agents working *inside* a box see a different summary in `.beebox/agent-guide.md`.

> **Keeping this in sync:** the canonical directory list is `BOX_LAYOUT` in `src/lib/box-layout-spec.ts` — `BOX_DIRS` (`src/lib/paths.ts`) and the in-box agent guide (`src/core/agent-guide/box-shape.ts`) both derive from it. When you add, remove, or rename a standard directory, edit `box-layout-spec.ts`, then update the `content/`/`bookkeeping/`/`config`/`publish`/`tmp`/`tricks`/`agent-config` tables below to match — `test/cli/lib/box-layout-spec.doctest.md` fails if this doc's tables drift from the spec.

## What a box is

A box is a directory marked by `.beebox/box.json`. It's a git repository (`bbx init` initialises one), and the working tree is the entire state of the system — there is no separate database. Boxes live outside this repo (typically `~/src/boxes/<name>/`) so agents operating inside a box don't inherit this repo's CLAUDE.md.

## The one-root layout (shapeVersion 3)

A box has **one root**: `.beebox/box.json`'s `shapeVersion` field is `3`, the
only shape this engine understands. See `getBoxShape`/`boxCodePaths` in
`src/lib/box-shape.ts`, and `docs/plans/one-root-box-layout.md` for the
design that replaced the old two-root package layout (a `content/` operational
root nested inside a separate coding-session package root — shapeVersion 2,
retired; `getBoxShape` on a v2 box throws a `bbx migrate`-pointing error).

`boxRoot` is this one root, everywhere: `package.json`, `src/`, `.claude/`,
`.beebox/`, and every underscore-prefixed operational area
(`_content/`, `_config/`, `_bookkeeping/`, `_publish/`, `_tmp/`) all live at
the same directory. `getBoxShape` recognizes a box when `<root>/.beebox/box.json`
declares `shapeVersion: 3` and `<root>/package.json` declares a `beebox`
dependency.

```
<box-root>/                        THE box root — one root, closed vocabulary
├── package.json                   { "dependencies": { "beebox": "^x.y.z" } }, private
├── pnpm-lock.yaml, tsconfig.json  npm namespace
├── node_modules/                  gitignored; beebox resolves here
├── .git/                          git repository
├── CLAUDE.md                      root agent instructions for this box
├── .claude/                       agent configuration (rules, skills, memory symlink, settings)
├── .beebox/                       runtime: box.json marker, dbs, logs, generated docs
├── src/
│   ├── schemas/                    box-local card-type definitions
│   ├── views/                      custom view definitions
│   └── tricks/                     agent-authored scripts (keeps its own nested package.json)
│                                                       ── box namespace (underscore) ──
├── _content/                      ONLY user content — the layout below
├── _config/                       meta-content: connectors, procedures, schedules, guides
├── _bookkeeping/                  the machine's paper trail: jobs, output, archive, trash, usage
├── _publish/                      staged public bundles
└── _tmp/                          scratch space (not committed)
```

Every path an agent sees (URLs, card refs, git trailers) is relative to this
one root. Paths come in two string forms (a leading `/` means
root-relative, not filesystem-absolute; see `src/shared/box-path.ts` for the
authoring vs. internal forms and where each is expected).

A box's URL slug (the `bbx serve`/`bbx hub` path prefix) is derived from the
root directory's own basename (see `boxSlug`/`boxSlugFromShape` in
`src/lib/box-slug.ts`) — stable, since there is only one root to name.

## Top-level layout (`_content/`)

```
_content/
├── briefing.briefing.card   top-level briefing card (bbx init installs)
├── briefing.md
├── Box.landmark.card        root landmark (chat can be scoped to the box root)
├── MAP.md
├── inbox/                   incoming items awaiting triage
├── chat/                    chat-thread cards
├── docs/                    box-specific docs (optional, agent-authored)
├── people/                  person cards
├── places/                  place cards (named locations)
├── recipes/                 recipe collection
├── todos/                   active todo lists
├── calendar/                two-way Google Calendar sync
├── drive/                   two-way Google Drive sync
└── reviews/retro/           retrospective run reports
    └── tmp-capture/         in-flight capture-mode media: one session dir
                             per capture (chunks/photos + session.json),
                             swept when abandoned (partial delivery); lives
                             inside the relevant chat's context area, not
                             literally under `reviews/`
```

Prepared captures land in a `tmp-capture/` directory inside the target
chat's context area (tracked and committed, unlike `_tmp/`) as a
capture-session card + attach scope; the chat agent annotates and files
them out — `tmp-capture/` must not accumulate. Flow reference:
`docs/implemented-plans/capture-mode.md`; agent duties:
`docs/generated/card-capture-session.md`.

A bulk file-upload batch (dozens of items / ~100 MB dropped at once — camera-roll
batches, document folders) lands the same way, as a sibling `tmp-upload/`
directory inside the target chat's context area: an `upload-batch` card + attach
scope, delivered to chat as a first-class `<upload doc="..." files="N" bytes="..."
failed="M">` message. The chat agent files each item out (destination card attach
scope, or `_content/inbox/`) and deletes the card + attach dir once
everything is placed — there is no terminal "filed" status, deletion *is* the
completion signal, and `tmp-upload/` must not accumulate either. Plan:
`docs/implemented-plans/bulk-file-upload.md`; agent duties:
`docs/generated/card-upload-batch.md`.

## Marker and runtime files (root)

| File | Purpose |
|------|---------|
| `.beebox/box.json` | JSON marker. Presence identifies the directory as a box. Contains version, `shapeVersion`, and creation timestamp. |
| `.bbx-lock` | Reactor lock. JSON with `pid` and `startedAt`. Removed on clean exit. |
| `.bbx-serve.pid` | Web-server PID file when `bbx serve` is running. |

## `_content/` — working state and user content

The only open-vocabulary area — everything a boxholder or agent authors.
Items move through the `inbox/` directories as they're processed. **Location
is state** — a card's directory determines its lifecycle stage. From
`BOX_DIRS`:

| Directory | Purpose |
|-----------|---------|
| `_content/inbox/` | Incoming items awaiting triage. Created by connectors, `bbx create`, `bbx scan-import`. (Composer captures don't land here — they deliver to chat; see below.) |
| `_content/inbox/unhandled/` | Items with no clear destination after triage. Pre-existing catch-all; predates the formal triage pipeline (its lifecycle is `docs/triage.md` Open Question #9). |
| `_content/inbox/intake/` | Items being prepared before triage (transcription, OCR, filename normalization). See `docs/triage.md`. |
| `_content/inbox/staged/` | Intake-complete; waiting for the triage agent. |
| `_content/inbox/triaged/` | Per-category holding spots (`<category>/`), plus `_unsure/` for low-confidence items paired with a question card. |
| `_content/inbox/triaged/_unsure/` | Low-confidence triage results; paired with a question card. |
| `_content/recipes/` | Recipe collection (free-form subdirectory tree). |
| `_content/todos/` | Active todo lists — human action items. |
| `_content/drive/` | Google Drive sync (spreadsheets as JSON, docs as markdown). |
| `_content/calendar/` | `.ics` files for two-way Google Calendar sync. |
| `_content/chat/` | Chat-thread cards, one directory per connector/thread (`_content/chat/<connector>/<slug>/`); web chat sessions live under `_content/chat/web/`. |
| `_content/reviews/retro/` | Retrospective run reports (`<runId>.md`): what sessions were examined, what was observed, what belief edits were made. Written by `bbx retro scan`, finalized by the `process-retrospective` procedure. Committed — this is the boxholder's audit trail for retrospective learning. |
| `_content/people/` | Person cards — referenced from briefings, useful for relationship-aware processing. |
| `_content/places/` | Place cards — named locations (Home, Office) the box recognizes; `bbx location get` names the place the boxholder is in, `bbx location mark` stamps a place's coordinates. |

## `_bookkeeping/` — the machine's paper trail

Working state, archives, and usage tracking — machine-owned, distinct from
user content.

| Directory | Purpose |
|-----------|---------|
| `_bookkeeping/jobs/` | Pending job cards for the reactor. Filename pattern: `<timestamp>.<type>.job.card`. |
| `_bookkeeping/output/` | Outbound cards staged for delivery (push notifications, replies). Flushed by `bbx finalize`. |
| `_bookkeeping/resources/` | Connector-synced external state that doesn't belong in the inbox. |
| `_bookkeeping/questions/` | Open questions awaiting a user answer. |
| `_bookkeeping/archive/done/` | Completed items archived after a successful pipeline run. |
| `_bookkeeping/archive/failed/` | Items that errored and were moved out of the working set. |
| `_bookkeeping/archive/processed/` | Items consumed by a procedure step (e.g., raw inputs after digestion). |
| `_bookkeeping/trash/` | Soft-deleted items (`bbx rm` moves here, not to `/dev/null`). |
| `_bookkeeping/usage/` | Usage tracking output — session manifest (`session-manifest.jsonl`) mapping agent sessions to tasks, read by `bbx usage`. |
| `_bookkeeping/connectors/` | Per-connector sync state (`<name>.state.json`) — machine-owned, split from `_config/connectors/` (which keeps `<name>.json` config and the gitignored `<name>.secret.json`). |

## `_publish/` — staged public bundles

| Directory | Purpose |
|-----------|---------|
| `_publish/` | Publications staged for external (Cloudflare) hosting — one `<pub-id>/` per publication, each holding a `manifest.json` and a rendered `bundle/`. Written by `bbx pub draft`; flipped live and uploaded by the human via `bbx pub go`. See `docs/plans/publish-pages.md`. |

## `_tmp/` — scratch

| Directory | Purpose |
|-----------|---------|
| `_tmp/` | Scratch space: chat file uploads and other transient staging, swept by wakeup housekeeping. Not committed. |

## `_config/` — configuration

Mostly hand-edited by humans, but `bbx init` installs templates.

| Path | What it holds |
|------|---------------|
| `_config/box.json` | Per-box settings: timezone, allowed emails, `agentEngine`/`agentModel` (see `docs/model-policy.md`), etc. |
| `_config/connectors/` | Per-connector config + secrets. Files: `<name>.json` (config), `<name>.secret.json` (credentials, gitignored). Sync state lives separately, in `_bookkeeping/connectors/`. |
| `_config/schemas/` | Legacy-location check only: schemas live at `src/schemas/` now. A `.ts` file left in `_config/schemas/` is invisible to the loader — `findLegacySchemaFiles` flags it. |
| `_config/procedures/` | Procedure cards (`*.procedure.card`). `bbx init` installs default templates. |
| `_config/schedules/` | Scheduled-script cards (`*.scheduled-script.card`). Fresh `bbx init` boxes enable map refresh and procedure-run cleanup; other seeded schedules require opt-in. |
| `_config/*.guide.card` | Guide cards (intake, calendar, chat) — agent-facing handling rules. |
| `_config/main.personality.card` | Personality card — voice and behavior tuning for the box's agent. |
| `_config/transcription.json` | Voice-memo transcription settings. |

`*.orig-*.card` and `*.bak` files are pre-edit snapshots, kept for diffing.

## `.beebox/` — runtime artifacts

Generated and managed by beebox itself; not hand-edited. Most contents are gitignored (logs, dbs); the agent guide and event database are the noteworthy exceptions.

| Path | What it is |
|------|------------|
| `box.json` | The shapeVersion marker (see above). |
| `agent-guide.md` | Agent-facing overview, regenerated by `generateDocs()` (`bbx init`, chat start, `bbx wakeup`, `bbx docs refresh`). The in-box equivalent of root CLAUDE.md plus this layout doc. Source: `src/core/agent-guide/`. |
| `client-debug.log` | Browser console errors and tagged native iOS diagnostics. See `docs/client-debug-log.md`. |
| `docid-debug` | Marker file. When present, `generateDocs()` embeds `<!-- DOCID:<path> -->` markers in agent-loaded files for tracing what gets into the prompt. |
| `docs-generated-at` | Timestamp of last `generateDocs()` run. |
| `events.db`, `events.db-shm`, `events.db-wal` | SQLite event bus database. |
| `logs/` | Per-run agent session logs (`<sessionId>.log`). |
| `box-growth-health.json` | Latest box file/directory/Git measurement, acknowledged size baseline, and explicit ongoing-rate expectations used by the growth health warning. Machine-written and schema-validated; use the dashboard actions instead of editing or deleting it. |
| `scheduler.jsonl` | One JSONL line per scheduler tick. Records which scripts ran/skipped/errored. |
| `usage.db` | Token-usage tracking database. |
| `chat-session-history.json`, `chat-session-id.json`, `chat-sessions.json`, `chat-thread-sessions.json` | Active chat session state. |
| `chat-models/<sessionId>.json` | One chat's own model choice. Absent means the chat follows the box default (`docs/model-policy.md`). |
| `retro/state.json`, `retro/observations.jsonl` | Retrospective walker state (which sessions were observed) and the append-only observation ledger that recurrence judgments draw on. Survives transcript clearing. |

## `.claude/` — agent configuration

| Path | Purpose |
|------|---------|
| `.claude/rules/` | Card-handling rules generated from schemas by `generateDocs` (so: `bbx init`, a chat-session start, a `bbx wakeup` cycle, or `bbx docs refresh`). |
| `.claude/memory/` | Symlinked to `~/.claude/projects/<box>/memory/` so auto-memory becomes git-tracked. |
| `.claude/settings.json`, `.claude/agents.json` | Standard Claude Code config. |

## `src/` — box-owned code

| Path | Purpose |
|------|---------|
| `src/schemas/` | Box-local card-type definitions (Zod + `beebox/cards`). Has its own CLAUDE.md. |
| `src/views/` | Custom view definitions (rendering customization). |
| `src/tricks/scripts/` | Agent-authored scripts. The agent can write small helpers here. |
| `src/tricks/lib/` | Shared helpers used by `src/tricks/scripts/`. |

## What's *not* in a box

- **No app code.** A box stores state and config; behaviour lives in the beebox repo.
- **No global secrets.** Each box keeps its own `_config/connectors/*.secret.json`. Secrets do not commute between boxes.
- **No cross-box references.** Boxes are self-contained — one box never reads from another's filesystem.

## Verifying

- `bbx status` summarises the current pipeline contents.
- `bbx validate` validates every card against its schema.
- `git status` shows uncommitted state — useful when something feels off after a partial wakeup.

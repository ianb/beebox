# Box Layout

The on-disk shape of a callback box. This is the canonical reference for callback-box developers; agents working *inside* a box see a different summary in `.callback-box/agent-guide.md`.

> **Keeping this in sync:** the canonical directory list lives in `BOX_DIRS` in `src/cli/lib/paths.ts`. The in-box agent-facing summary lives in `src/core/agent-guide/box-shape.ts`. When you add, remove, or rename a standard directory, update **all three** (this doc, `BOX_DIRS`, and `box-shape.ts`). Drift between them has bitten us before.

## What a box is

A box is a directory marked by a `.cb-box` file. It's a git repository (`cb init` initialises one), and the working tree is the entire state of the system — there is no separate database. Boxes live outside this repo (typically `~/src/boxes/<name>/`) so agents operating inside a box don't inherit this repo's CLAUDE.md.

## Shape versions: legacy (v1) vs package (v2)

`.cb-box`'s `shapeVersion` field selects the physical layout — see
`getBoxShape`/`boxCodePaths` in `src/cli/lib/box-shape.ts`, and "The box
repository" in `docs/plans/boxes-as-packages-v2.md` for the full design.

- **shapeVersion 1 (legacy, the default when the field is absent)** — the box
  root IS the package root. This is every box created before this plan and
  everything documented below.
- **shapeVersion 2 (package)** — `cb init` on a genuinely new path now
  scaffolds this shape. The box root (still found by `.cb-box`, everywhere
  called `boxRoot`) is a `content/` directory nested inside a coding-session
  package (`packageRoot`, `content/`'s parent):

  ```
  <package-root>/              the package — coding surfaces live here
  ├── package.json             { "dependencies": { "callback-box": "^x.y.z" } }, private
  ├── tsconfig.json             extends "callback-box/tsconfig.base.json"
  ├── node_modules/             gitignored; callback-box resolves here
  ├── CLAUDE.md                 thin: "this is a box package; the box is content/"
  ├── .claude/                  rules, skills, memory symlink, settings — HERE, not in content/
  ├── src/
  │   ├── schemas/               (was config/schemas/ in v1)
  │   ├── views/                 (was views/ in v1)
  │   └── tricks/                (was tricks/ in v1; keeps its own nested package.json)
  └── content/                  THE BOX — everything below, minus the three code dirs
  ```

  `content/` is exactly the v1 layout below MINUS `.claude/`, `config/schemas/`,
  `tricks/`, and `views/` (those moved up to the package root's `src/` and
  `.claude/`). Every box-root-relative path an agent sees (URLs, card refs,
  git trailers) is unaffected — only the three code dirs and `.claude/` moved.

  **The git-hooks trap:** `.git` sits at the package root, but git always
  invokes hooks with cwd = the package root regardless of where you ran `git
  commit` — so the installed `pre-commit`/`post-commit` hooks `cd` into
  `content/` before calling `cb` (see `src/core/install-validation-hooks.ts`).
  The `.claude/settings.json` PostToolUse hook needs no such fix; Claude Code
  invokes it with cwd = the operating agent's own cwd, which is already
  `content/` (or a subdirectory).

  Converting an *existing* legacy box to v2 is a later migration (Track H in
  the plan), not something `cb init` does — re-running `cb init` on an
  existing legacy box keeps it legacy.

## Top-level layout (legacy / shapeVersion 1)

```
<box-root>/
├── .cb-box                  marker file (presence = "this is a box")
├── .cb-lock                 reactor lock (json: pid, startedAt)
├── .cb-serve.pid            web server pid file (when serving)
├── .gitignore               box-specific gitignore (created by cb init)
├── .gitattributes           git attributes (line-endings, etc.)
├── .git/                    git repository
├── .claude/                 agent configuration (CLAUDE.md, rules, memory)
├── .callback-box/           runtime artifacts (logs, dbs, generated docs)
├── CLAUDE.md                root agent instructions for this box
├── briefing.briefing.card   top-level briefing card (cb init installs)
├── box/                     working state — items moving through pipelines
├── store/                   long-term state — archives, integrated content
├── config/                  configuration — connectors, guides, schemas
├── people/                  person cards
├── places/                  place cards (named locations)
├── docs/                    box-specific docs (optional, agent-authored)
├── procedure/               procedure runs (created on first run)
├── tricks/                  agent-authored scripts (optional)
├── views/                   custom view definitions (optional)
└── tmp/                     scratch space (not committed)
```

## Marker and runtime files (root)

| File | Purpose |
|------|---------|
| `.cb-box` | JSON marker. Presence identifies the directory as a box. Contains version + creation timestamp. |
| `.cb-lock` | Reactor lock. JSON with `pid` and `startedAt`. Removed on clean exit. |
| `.cb-serve.pid` | Web-server PID file when `cb serve` is running. |

## `box/` — working state

Items move through these directories as they're processed. **Location is state** — a card's directory determines its lifecycle stage. From `BOX_DIRS`:

| Directory | Purpose |
|-----------|---------|
| `box/inbox/` | Incoming items awaiting triage. Created by capture UI, connectors, `cb create`. |
| `box/inbox/intake/` | Items being prepared before triage (transcription, OCR, filename normalization). See `docs/plans/triage-design.md`. |
| `box/inbox/staged/` | Intake-complete; waiting for the triage agent. |
| `box/inbox/triaged/` | Per-category holding spots (`<category>/`), plus `_unsure/` for low-confidence items paired with a question card. |
| `box/inbox/unhandled/` | Items with no clear destination after triage. Pre-existing catch-all; predates the formal triage pipeline (its lifecycle is `docs/plans/triage-design.md` Open Question #9). |
| `box/jobs/` | Pending job cards for the reactor. Filename pattern: `<timestamp>.<type>.job.card`. |
| `box/output/` | Outbound cards staged for delivery (push notifications, replies). Flushed by `cb finalize`. |
| `box/questions/` | Open questions awaiting a user answer. |
| `box/resources/` | Connector-synced external state that doesn't belong in the inbox. |

Additional directories observed in active boxes that are **not** currently in `BOX_DIRS` but are referenced in code or generated content:

- `box/commands/`, `box/bookmarks/` — present in `test1`; legacy or ad-hoc.

When you find a directory in this category, decide: promote it into `BOX_DIRS` if it's canonical, or remove it from `box-shape.ts` / migrate the content if it isn't.

## `store/` — archives and long-term state

| Directory | Purpose |
|-----------|---------|
| `store/archive/done/` | Completed items archived after a successful pipeline run. |
| `store/archive/failed/` | Items that errored and were moved out of the working set. |
| `store/archive/processed/` | Items consumed by a procedure step (e.g., raw inputs after digestion). |
| `store/trash/` | Soft-deleted items (`cb rm` moves here, not to `/dev/null`). |
| `store/recipes/` | Recipe collection (free-form subdirectory tree). |
| `store/todos/` | Active todo lists — human action items. |
| `store/drive/` | Google Drive sync (spreadsheets as JSON, docs as markdown). |

Additional directories observed but not in `BOX_DIRS`:

- `store/calendar/` — `.ics` files for two-way Google Calendar sync. Referenced in `box-shape.ts`; should be added to `BOX_DIRS`.
- `store/chat/` — chat-thread cards. Should be added to `BOX_DIRS`.
- `store/usage/` — usage tracking output.
- `store/reviews/retro/` — retrospective run reports (`<runId>.md`): what sessions were examined, what was observed, what belief edits were made. Written by `cb retro scan`, finalized by the `process-retrospective` procedure. Committed — this is the boxholder's audit trail for retrospective learning.

## `config/` — configuration

Mostly hand-edited by humans, but `cb init` installs templates.

| Path | What it holds |
|------|---------------|
| `config/box.json` | Per-box settings: timezone, allowed emails, etc. |
| `config/connectors/` | Per-connector config + state + secrets. Files: `<name>.json` (config), `<name>.state.json` (sync state), `<name>.secret.json` (credentials). Secret files are gitignored. |
| `config/schemas/` | Box-local card-type definitions (Zod + cardworks). Has its own CLAUDE.md. |
| `config/procedures/` | Procedure cards (`*.procedure.card`). `cb init` installs default templates. |
| `config/schedules/` | Scheduled-script cards (`*.scheduled-script.card`). Disabled by default after `cb init`. |
| `config/*.guide.card` | Guide cards (intake, calendar, chat) — agent-facing handling rules. |
| `config/main.personality.card` | Personality card — voice and behavior tuning for the box's agent. |
| `config/transcription.json` | Voice-memo transcription settings. |

`*.orig-*.card` and `*.bak` files are pre-edit snapshots, kept for diffing.

## `.callback-box/` — runtime artifacts

Generated and managed by callback-box itself; not hand-edited. Most contents are gitignored (logs, dbs); the agent guide and event database are the noteworthy exceptions.

| Path | What it is |
|------|------------|
| `agent-guide.md` | Agent-facing overview, regenerated by `cb init` and `generateDocs()`. The in-box equivalent of root CLAUDE.md plus this layout doc. Source: `src/core/agent-guide/`. |
| `client-debug.log` | Browser console errors forwarded from the frontend. See `docs/client-debug-log.md`. |
| `docid-debug` | Marker file. When present, `generateDocs()` embeds `<!-- DOCID:<path> -->` markers in agent-loaded files for tracing what gets into the prompt. |
| `docs-generated-at` | Timestamp of last `generateDocs()` run. |
| `events.db`, `events.db-shm`, `events.db-wal` | SQLite event bus database. |
| `logs/` | Per-run agent session logs (`<sessionId>.log`). |
| `scheduler.jsonl` | One JSONL line per scheduler tick. Records which scripts ran/skipped/errored. |
| `usage.db` | Token-usage tracking database. |
| `chat-session-history.json`, `chat-session-id.json`, `chat-sessions.json`, `chat-thread-sessions.json` | Active chat session state. |
| `retro/state.json`, `retro/observations.jsonl` | Retrospective walker state (which sessions were observed) and the append-only observation ledger that recurrence judgments draw on. Survives transcript clearing. |

## `.claude/` — agent configuration

| Path | Purpose |
|------|---------|
| `.claude/rules/` | Card-handling rules generated from schemas by `cb init`. |
| `.claude/memory/` | Symlinked to `~/.claude/projects/<box>/memory/` so auto-memory becomes git-tracked. |
| `.claude/settings.json`, `.claude/agents.json` | Standard Claude Code config. |

## `people/`, `tricks/`, `views/`, `procedure/`

| Path | Purpose |
|------|---------|
| `people/` | Person cards — referenced from briefings, useful for relationship-aware processing. |
| `places/` | Place cards — named locations (Home, Office) the box recognizes; `cb location get` names the place the boxholder is in, `cb location mark` stamps a place's coordinates. |
| `tricks/scripts/` | Agent-authored scripts. The agent can write small helpers here. |
| `tricks/lib/` | Shared helpers used by `tricks/scripts/`. |
| `views/` | Custom view definitions (rendering customization). |
| `procedure/runs/` | Procedure run state. A recent cache, not an archive — no-op runs never persist and `cb procedure gc` deletes expired runs (git history retains everything). |

## What's *not* in a box

- **No app code.** A box stores state and config; behaviour lives in the callback-box repo.
- **No global secrets.** Each box keeps its own `config/connectors/*.secret.json`. Secrets do not commute between boxes.
- **No cross-box references.** Boxes are self-contained — one box never reads from another's filesystem.

## Verifying

- `cb status` summarises the current pipeline contents.
- `cb validate` validates every card against its schema.
- `git status` shows uncommitted state — useful when something feels off after a partial wakeup.

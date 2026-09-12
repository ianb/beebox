/**
 * Single source of truth for the box directory layout.
 *
 * Three surfaces used to hand-list this independently — `BOX_DIRS` (paths.ts),
 * the developer reference (`docs/box-layout.md`), and the in-box agent guide
 * (`agent-guide/box-shape.ts`) — and the code carried a comment warning they
 * drift. This file is now the one place the list, paths, and prose live:
 *
 *   - `BOX_DIRS` (paths.ts) is derived from the entries below that carry a
 *     `boxDirsKey`.
 *   - `directoryLayoutSection()` (agent-guide/box-shape.ts) looks up entries
 *     by key for its path/description text.
 *   - `docs/box-layout.md`'s per-area tables are checked against this spec by
 *     `test/cli/lib/box-layout-spec.doctest.md` (a doc that drifts fails the
 *     test rather than silently going stale).
 *
 * shapeVersion 3 (the one-root layout — `docs/implemented-plans/one-root-box-layout.md`):
 * a box has ONE root (`boxRoot`). Every path below is
 * relative to that one root. The root's own vocabulary is closed: the
 * underscore-prefixed areas below (`_content`, `_config`, `_bookkeeping`,
 * `_publish`, `_tmp`) plus the npm/agent-identity entries in
 * `BOX_ROOT_VOCABULARY`. Content is open below `_content/`; nothing else at
 * the root is.
 *
 * See "Track A — Shape v3 core" in `docs/implemented-plans/one-root-box-layout.md`.
 */

import type { BoxLayoutEntry } from "./box-layout-types.js";

export type { BoxLayoutArea, BoxLayoutEntry, BoxRootVocabularyEntry } from "./box-layout-types.js";
export const BOX_LAYOUT = [
  // _content/ — the box's user content. The only open-vocabulary area.
  {
    boxDirsKey: "inbox",
    path: "_content/inbox",
    area: "content",
    description:
      "Incoming items awaiting triage. Created by connectors, `bbx create`, `bbx scan-import`. " +
      "(Composer captures don't land here — they deliver to chat; see below.)",
    agentDescription: "Incoming items to be triaged",
  },
  {
    boxDirsKey: "inboxUnhandled",
    path: "_content/inbox/unhandled",
    area: "content",
    description:
      "Items with no clear destination after triage. Pre-existing catch-all; predates the formal " +
      "triage pipeline (its lifecycle is `docs/triage.md` Open Question #9).",
    agentDescription: "Items with no clear destination",
  },
  {
    boxDirsKey: "inboxIntake",
    path: "_content/inbox/intake",
    area: "content",
    description:
      "Items being prepared before triage (transcription, OCR, filename normalization). " +
      "See `docs/triage.md`.",
    agentDescription: "Items being prepared before triage (transcription, OCR, filename normalization).",
  },
  {
    boxDirsKey: "inboxStaged",
    path: "_content/inbox/staged",
    area: "content",
    description: "Intake-complete; waiting for the triage agent.",
    agentDescription: "Intake-complete; waiting for the triage agent.",
  },
  {
    boxDirsKey: "inboxTriaged",
    path: "_content/inbox/triaged",
    area: "content",
    description:
      "Per-category holding spots (`<category>/`), plus `_unsure/` for low-confidence items paired " +
      "with a question card.",
    agentDescription:
      "Categorized; awaiting the handler procedure. `<category>` is one of this box's triage " +
      "destinations (a landmark with a `for: [triage]` entry in its `destinations`), not a fixed list.",
  },
  {
    boxDirsKey: "inboxTriagedUnsure",
    path: "_content/inbox/triaged/_unsure",
    area: "content",
    description: "Low-confidence triage results; paired with a question card.",
    agentDescription: "Held low-confidence items, paired with a question card.",
  },
  {
    boxDirsKey: "recipes",
    path: "_content/recipes",
    area: "content",
    description: "Recipe collection (free-form subdirectory tree).",
    agentDescription: "Recipe collection (subdirectories for organization)",
  },
  {
    boxDirsKey: "todos",
    path: "_content/todos",
    area: "content",
    description: "Active todo lists — human action items.",
    agentDescription: "Active todo lists — human action items",
  },
  {
    boxDirsKey: "drive",
    path: "_content/drive",
    area: "content",
    description: "Google Drive sync (spreadsheets as JSON, docs as markdown).",
    agentDescription: "Google Drive files (spreadsheets as JSON, docs as markdown) — two-way sync",
  },
  {
    boxDirsKey: "calendar",
    path: "_content/calendar",
    area: "content",
    description: "`.ics` files for two-way Google Calendar sync.",
    agentDescription: "Calendar events (.ics files) — two-way sync with Google Calendar",
  },
  {
    boxDirsKey: "chat",
    path: "_content/chat",
    area: "content",
    description:
      "Chat-thread cards, one directory per connector/thread (`_content/chat/<connector>/<slug>/`); " +
      "web chat sessions live under `_content/chat/web/`.",
  },
  {
    boxDirsKey: "retroReports",
    path: "_content/reviews/retro",
    area: "content",
    description:
      "Retrospective run reports (`<runId>.md`): what sessions were examined, what was observed, what " +
      "belief edits were made. Written by `bbx retro scan`, finalized by the `process-retrospective` " +
      "procedure. Committed — this is the boxholder's audit trail for retrospective learning.",
    agentDescription: "Retrospective run reports (written by `bbx retro`)",
  },
  {
    boxDirsKey: "people",
    path: "_content/people",
    area: "content",
    description: "Person cards — referenced from briefings, useful for relationship-aware processing.",
    agentDescription: "Person cards — key people referenced from briefings",
  },
  {
    boxDirsKey: "places",
    path: "_content/places",
    area: "content",
    description:
      "Place cards — named locations (Home, Office) the box recognizes; `bbx location get` names the " +
      "place the boxholder is in, `bbx location mark` stamps a place's coordinates.",
    agentDescription: "Place cards — named locations the box recognizes (Home, Office)",
  },

  // _bookkeeping/ — the machine's paper trail: working state, archives, usage.
  {
    boxDirsKey: "jobs",
    path: "_bookkeeping/jobs",
    area: "bookkeeping",
    description: "Pending job cards for the reactor. Filename pattern: `<timestamp>.<type>.job.card`.",
    agentDescription: "Pending job cards for the reactor to process",
  },
  {
    boxDirsKey: "output",
    path: "_bookkeeping/output",
    area: "bookkeeping",
    description: "Outbound cards staged for delivery (push notifications, replies). Flushed by `bbx finalize`.",
    agentDescription:
      "Cards that make something happen **outside** the box — an action serialized as a card for an " +
      "external effector to pick up and execute (a Telegram message to send, etc.), flushed by " +
      "`bbx finalize`. Email drafts are the exception: a reply's `email-outbound` card goes in its " +
      "source thread's directory under `_content/inbox/email/` (next to the message it answers), not " +
      "here — the Gmail connector reads the thread from there for correct threading",
  },
  {
    boxDirsKey: "resources",
    path: "_bookkeeping/resources",
    area: "bookkeeping",
    description: "Connector-synced external state that doesn't belong in the inbox.",
    agentDescription: "Synced external state",
  },
  {
    boxDirsKey: "questions",
    path: "_bookkeeping/questions",
    area: "bookkeeping",
    description: "Open questions awaiting a user answer.",
    agentDescription: "Pending questions for the user",
  },
  {
    boxDirsKey: "archiveDone",
    path: "_bookkeeping/archive/done",
    area: "bookkeeping",
    description: "Completed items archived after a successful pipeline run.",
  },
  {
    boxDirsKey: "archiveFailed",
    path: "_bookkeeping/archive/failed",
    area: "bookkeeping",
    description: "Items that errored and were moved out of the working set.",
  },
  {
    boxDirsKey: "archiveProcessed",
    path: "_bookkeeping/archive/processed",
    area: "bookkeeping",
    description: "Items consumed by a procedure step (e.g., raw inputs after digestion).",
  },
  {
    boxDirsKey: "trash",
    path: "_bookkeeping/trash",
    area: "bookkeeping",
    description: "Soft-deleted items (`bbx rm` moves here, not to `/dev/null`).",
    agentDescription: "Soft-deleted items",
  },
  {
    boxDirsKey: "usage",
    path: "_bookkeeping/usage",
    area: "bookkeeping",
    description:
      "Usage tracking output — session manifest (`session-manifest.jsonl`) mapping agent sessions to " +
      "tasks, read by `bbx usage`.",
  },
  {
    boxDirsKey: "procedureRuns",
    path: "_bookkeeping/procedure/runs",
    area: "bookkeeping",
    description:
      "Procedure run state. A recent cache, not an archive — no-op runs never persist and " +
      "`bbx procedure gc` deletes expired runs (git history retains everything).",
  },
  {
    boxDirsKey: "connectorState",
    path: "_bookkeeping/connectors",
    area: "bookkeeping",
    description:
      "Per-connector sync state (`<name>.state.json`) — machine-owned, split from `_config/connectors/` " +
      "(which keeps `<name>.json` config and the gitignored `<name>.secret.json`).",
  },

  // _publish/ — staged public bundles.
  {
    boxDirsKey: "publish",
    path: "_publish",
    area: "publish",
    description:
      "Publications staged for external (Cloudflare) hosting — one `<pub-id>/` per publication, each " +
      "holding a `manifest.json` and a rendered `bundle/`. Written by `bbx pub draft`; flipped live and " +
      "uploaded by the human via `bbx pub go`. See `docs/plans/publish-pages.md`.",
    agentDescription:
      "Publications staged for external hosting (one `<pub-id>/` each: manifest + bundle). Drafted by " +
      "`bbx pub draft`; only the human makes one live with `bbx pub go`.",
  },

  // _tmp/ — scratch.
  {
    boxDirsKey: "tmp",
    path: "_tmp",
    area: "tmp",
    description: "Scratch space: chat file uploads and other transient staging, swept by wakeup housekeeping.",
    agentDescription: "Scratch space — transient, swept periodically",
  },

  // _config/ — configuration
  {
    boxDirsKey: "config",
    path: "_config",
    area: "config",
    description: "Box configuration — connectors, guides, schemas, procedures, schedules.",
    agentDescription: "Box configuration",
  },
  {
    path: "_config/interface",
    area: "config",
    description: "Canonical dashboard.card, settings.card, browse.card, questions.card, landmarks.card, history.card, inventory.card, and admin.card interface instruments. Keep their paths; the body holds source notes, not live UI state.",
  },
  {
    boxDirsKey: "connectors",
    path: "_config/connectors",
    area: "config",
    description:
      "Per-connector config: `<name>.json`. Connector credentials live in the machine secret " +
      "store (`docs/secrets.md`), not in the box; the connectors not yet moved there still keep " +
      "a gitignored `<name>.secret.json`, as do Google/Gmail OAuth token records. Sync state " +
      "lives separately, in `_bookkeeping/connectors/`.",
  },
  {
    boxDirsKey: "schemas",
    path: "_config/schemas",
    area: "config",
    description:
      "Legacy-location check only: schemas live at `src/schemas/` now. A `.ts` file left in " +
      "`_config/schemas/` is invisible to the loader — `findLegacySchemaFiles` flags it.",
  },
  {
    boxDirsKey: "procedures",
    path: "_config/procedures",
    area: "config",
    description: "Procedure cards (`*.procedure.card`). `bbx init` installs default templates.",
  },
  {
    boxDirsKey: "schedules",
    path: "_config/schedules",
    area: "config",
    description: "Scheduled-script cards (`*.scheduled-script.card`). Fresh `bbx init` boxes enable map refresh and procedure-run cleanup; other seeded schedules require opt-in.",
  },

  // src/tricks/ — agent-authored scripts (box code, not content).
  {
    boxDirsKey: "tricks",
    path: "src/tricks/scripts",
    area: "tricks",
    description: "Agent-authored scripts. The agent can write small helpers here.",
  },
  {
    boxDirsKey: "tricksLib",
    path: "src/tricks/lib",
    area: "tricks",
    description: "Shared helpers used by `src/tricks/scripts/`.",
  },

  // .claude/ — agent configuration
  {
    boxDirsKey: "claude",
    path: ".claude",
    area: "agent-config",
    description: "Agent configuration: CLAUDE.md, rules, memory, Claude Code settings.",
  },
  {
    boxDirsKey: "rules",
    path: ".claude/rules",
    area: "agent-config",
    description:
      "Card-handling rules generated from schemas by `generateDocs` (so: `bbx init`, a chat-session start, a `bbx wakeup` cycle, or `bbx docs refresh`).",
  },
] as const satisfies readonly BoxLayoutEntry[];

export type BoxLayoutEntryType = (typeof BOX_LAYOUT)[number];
export type BoxDirsEntry = Extract<BoxLayoutEntryType, { boxDirsKey: string }>;

/** The type of `BOX_DIRS` (paths.ts), derived from this spec's keyed entries. */
export type BoxDirs = { [E in BoxDirsEntry as E["boxDirsKey"]]: E["path"] };


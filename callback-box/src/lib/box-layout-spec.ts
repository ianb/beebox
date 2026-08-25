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
 * See "Track B — Box package contract" in `docs/implemented-plans/boxes-as-packages-v2.md`.
 */

import type { BoxLayoutEntry } from "./box-layout-types.js";

export type { BoxLayoutArea, BoxLayoutEntry } from "./box-layout-types.js";
export const BOX_LAYOUT = [
  // box/ — working state
  {
    boxDirsKey: "inbox",
    path: "box/inbox",
    area: "box",
    description:
      "Incoming items awaiting triage. Created by connectors, `cb create`, `cb scan-import`. " +
      "(Composer captures don't land here — they deliver to chat; see below.)",
    agentDescription: "Incoming items to be triaged",
  },
  {
    boxDirsKey: "inboxUnhandled",
    path: "box/inbox/unhandled",
    area: "box",
    description:
      "Items with no clear destination after triage. Pre-existing catch-all; predates the formal " +
      "triage pipeline (its lifecycle is `docs/triage.md` Open Question #9).",
    agentDescription: "Items with no clear destination",
  },
  {
    boxDirsKey: "inboxIntake",
    path: "box/inbox/intake",
    area: "box",
    description:
      "Items being prepared before triage (transcription, OCR, filename normalization). " +
      "See `docs/triage.md`.",
    agentDescription: "Items being prepared before triage (transcription, OCR, filename normalization).",
  },
  {
    boxDirsKey: "inboxStaged",
    path: "box/inbox/staged",
    area: "box",
    description: "Intake-complete; waiting for the triage agent.",
    agentDescription: "Intake-complete; waiting for the triage agent.",
  },
  {
    boxDirsKey: "inboxTriaged",
    path: "box/inbox/triaged",
    area: "box",
    description:
      "Per-category holding spots (`<category>/`), plus `_unsure/` for low-confidence items paired " +
      "with a question card.",
    agentDescription:
      "Categorized; awaiting the handler procedure. `<category>` is one of this box's triage " +
      "destinations (a landmark with a `for: [triage]` entry in its `destinations`), not a fixed list.",
  },
  {
    boxDirsKey: "inboxTriagedUnsure",
    path: "box/inbox/triaged/_unsure",
    area: "box",
    description: "Low-confidence triage results; paired with a question card.",
    agentDescription: "Held low-confidence items, paired with a question card.",
  },
  {
    boxDirsKey: "jobs",
    path: "box/jobs",
    area: "box",
    description: "Pending job cards for the reactor. Filename pattern: `<timestamp>.<type>.job.card`.",
    agentDescription: "Pending job cards for the reactor to process",
  },
  {
    boxDirsKey: "output",
    path: "box/output",
    area: "box",
    description: "Outbound cards staged for delivery (push notifications, replies). Flushed by `cb finalize`.",
    agentDescription:
      "Cards that make something happen **outside** the box — an action serialized as a card for an " +
      "external effector to pick up and execute (a Telegram message to send, etc.), flushed by " +
      "`cb finalize`. Email drafts are the exception: a reply's `email-outbound` card goes in its " +
      "source thread's directory under `box/inbox/email/` (next to the message it answers), not here " +
      "— the Gmail connector reads the thread from there for correct threading",
  },
  {
    boxDirsKey: "publish",
    path: "box/publish",
    area: "box",
    description:
      "Publications staged for external (Cloudflare) hosting — one `<pub-id>/` per publication, each " +
      "holding a `manifest.json` and a rendered `bundle/`. Written by `cb pub draft`; flipped live and " +
      "uploaded by the human via `cb pub go`. See `docs/plans/publish-pages.md`.",
    agentDescription:
      "Publications staged for external hosting (one `<pub-id>/` each: manifest + bundle). Drafted by " +
      "`cb pub draft`; only the human makes one live with `cb pub go`.",
  },
  {
    boxDirsKey: "questions",
    path: "box/questions",
    area: "box",
    description: "Open questions awaiting a user answer.",
    agentDescription: "Pending questions for the user",
  },
  {
    boxDirsKey: "resources",
    path: "box/resources",
    area: "box",
    description: "Connector-synced external state that doesn't belong in the inbox.",
    agentDescription: "Synced external state",
  },

  // Legacy/ad-hoc box/ directories: observed on disk, not wired into BOX_DIRS.
  {
    path: "box/commands",
    area: "legacy",
    description:
      "Present in `test1`; legacy or ad-hoc. Not referenced by canonical code beyond a precheck " +
      "ignore-glob. Promote into `BOX_DIRS` if it becomes canonical again, or remove/migrate its " +
      "content otherwise.",
  },
  {
    path: "box/bookmarks",
    area: "legacy",
    description: "Present in `test1`; legacy or ad-hoc. Not referenced anywhere in canonical code.",
  },

  // store/ — archives and long-term state
  {
    boxDirsKey: "archiveDone",
    path: "store/archive/done",
    area: "store",
    description: "Completed items archived after a successful pipeline run.",
  },
  {
    boxDirsKey: "archiveFailed",
    path: "store/archive/failed",
    area: "store",
    description: "Items that errored and were moved out of the working set.",
  },
  {
    boxDirsKey: "archiveProcessed",
    path: "store/archive/processed",
    area: "store",
    description: "Items consumed by a procedure step (e.g., raw inputs after digestion).",
  },
  {
    boxDirsKey: "trash",
    path: "store/trash",
    area: "store",
    description: "Soft-deleted items (`cb rm` moves here, not to `/dev/null`).",
    agentDescription: "Soft-deleted items",
  },
  {
    boxDirsKey: "recipes",
    path: "store/recipes",
    area: "store",
    description: "Recipe collection (free-form subdirectory tree).",
    agentDescription: "Recipe collection (subdirectories for organization)",
  },
  {
    boxDirsKey: "todos",
    path: "store/todos",
    area: "store",
    description: "Active todo lists — human action items.",
    agentDescription: "Active todo lists — human action items",
  },
  {
    boxDirsKey: "drive",
    path: "store/drive",
    area: "store",
    description: "Google Drive sync (spreadsheets as JSON, docs as markdown).",
    agentDescription: "Google Drive files (spreadsheets as JSON, docs as markdown) — two-way sync",
  },
  {
    boxDirsKey: "calendar",
    path: "store/calendar",
    area: "store",
    description: "`.ics` files for two-way Google Calendar sync.",
    agentDescription: "Calendar events (.ics files) — two-way sync with Google Calendar",
  },
  {
    boxDirsKey: "chat",
    path: "store/chat",
    area: "store",
    description:
      "Chat-thread cards, one directory per connector/thread (`store/chat/<connector>/<slug>/`); " +
      "web chat sessions live under `store/chat/web/`.",
  },
  {
    boxDirsKey: "usage",
    path: "store/usage",
    area: "store",
    description:
      "Usage tracking output — session manifest (`session-manifest.jsonl`) mapping agent sessions to " +
      "tasks, read by `cb usage`.",
  },
  {
    boxDirsKey: "retroReports",
    path: "store/reviews/retro",
    area: "store",
    description:
      "Retrospective run reports (`<runId>.md`): what sessions were examined, what was observed, what " +
      "belief edits were made. Written by `cb retro scan`, finalized by the `process-retrospective` " +
      "procedure. Committed — this is the boxholder's audit trail for retrospective learning.",
    agentDescription: "Retrospective run reports (written by `cb retro`)",
  },

  // people/, places/
  {
    boxDirsKey: "people",
    path: "people",
    area: "people-places",
    description: "Person cards — referenced from briefings, useful for relationship-aware processing.",
    agentDescription: "Person cards — key people referenced from briefings",
  },
  {
    boxDirsKey: "places",
    path: "places",
    area: "people-places",
    description:
      "Place cards — named locations (Home, Office) the box recognizes; `cb location get` names the " +
      "place the boxholder is in, `cb location mark` stamps a place's coordinates.",
    agentDescription: "Place cards — named locations the box recognizes (Home, Office)",
  },

  // config/ — configuration
  {
    boxDirsKey: "config",
    path: "config",
    area: "config",
    description: "Box configuration — connectors, guides, schemas, procedures, schedules.",
    agentDescription: "Box configuration",
  },
  {
    boxDirsKey: "connectors",
    path: "config/connectors",
    area: "config",
    description:
      "Per-connector config + state + secrets. Files: `<name>.json` (config), `<name>.state.json` " +
      "(sync state), `<name>.secret.json` (credentials). Secret files are gitignored.",
  },
  {
    boxDirsKey: "schemas",
    path: "config/schemas",
    area: "config",
    description: "Box-local card-type definitions (Zod + `callback-box/cards`). Has its own CLAUDE.md.",
  },
  {
    boxDirsKey: "procedures",
    path: "config/procedures",
    area: "config",
    description: "Procedure cards (`*.procedure.card`). `cb init` installs default templates.",
  },
  {
    boxDirsKey: "schedules",
    path: "config/schedules",
    area: "config",
    description: "Scheduled-script cards (`*.scheduled-script.card`). Fresh `cb init` boxes enable map refresh and procedure-run cleanup; other seeded schedules require opt-in.",
  },

  // tricks/ — agent-authored scripts
  {
    boxDirsKey: "tricks",
    path: "tricks/scripts",
    area: "tricks",
    description: "Agent-authored scripts. The agent can write small helpers here.",
  },
  {
    boxDirsKey: "tricksLib",
    path: "tricks/lib",
    area: "tricks",
    description: "Shared helpers used by `tricks/scripts/`.",
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
      "Card-handling rules generated from schemas by `generateDocs` (so: `cb init`, a chat-session start, a `cb wakeup` cycle, or `cb docs refresh`).",
  },
] as const satisfies readonly BoxLayoutEntry[];

export type BoxLayoutEntryType = (typeof BOX_LAYOUT)[number];
export type BoxDirsEntry = Extract<BoxLayoutEntryType, { boxDirsKey: string }>;

/** The type of `BOX_DIRS` (paths.ts), derived from this spec's keyed entries. */
export type BoxDirs = { [E in BoxDirsEntry as E["boxDirsKey"]]: E["path"] };

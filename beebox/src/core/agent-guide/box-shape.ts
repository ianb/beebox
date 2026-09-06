/**
 * Directory layout and intake mechanisms — the shape of the box and how
 * items get into it.
 *
 * This is the in-box agent-facing summary — a curated subset of directories,
 * some collapsed together (all of `_bookkeeping/archive/*` reads as one row
 * here). Canonical directory path and description text come from the single
 * `BOX_LAYOUT` spec (`src/lib/box-layout-spec.ts`); this file owns which rows
 * appear, in what order, plus the agent-only `_tmp/` scratch guidance and
 * `_bookkeeping/archive/` rollup that the spec doesn't itself model.
 */

import { BOX_PACKAGE_DOCS } from "../docs-gen/shared.js";
import { boxLayoutEntry, type BoxDirs } from "../../lib/paths.js";
import { boxCodePathsRelativeToBoxRoot, type BoxShape } from "../../lib/box-shape.js";

/** One row of the agent-facing directory table: its spec path (unless `path` overrides it) and description. */
function row(boxDirsKey: keyof BoxDirs, options?: { path: string }): string {
  const entry = boxLayoutEntry(boxDirsKey);
  const description = entry.agentDescription ?? entry.description;
  const path = options ? options.path : entry.path;
  return `| \`${path}/\` | ${description} |`;
}

export function directoryLayoutSection(): string {
  const rows = [
    row("inbox"),
    row("inboxIntake"),
    row("inboxStaged"),
    row("inboxTriaged", { path: "_content/inbox/triaged/<category>" }),
    row("inboxTriagedUnsure"),
    row("inboxUnhandled"),
    row("jobs"),
    row("questions"),
    row("resources"),
    row("output"),
    "| `_bookkeeping/archive/` | Processed/completed items |",
    row("calendar"),
    row("drive"),
    row("recipes"),
    row("retroReports"),
    row("todos"),
    row("trash"),
    row("people"),
    row("places"),
    row("config"),
    "| `_tmp/` | General scratch space for temporary files. Use this box-root directory, never the host `/tmp`; it is uncommitted and may be swept, so never rely on persistence. |",
  ].join("\n");

  return `## Directory Layout

Location is state — a card's directory determines its lifecycle stage:

| Directory | Purpose |
|-----------|---------|
${rows}

The area names are reserved words: never create a nested \`_content\`, \`_config\`, \`_bookkeeping\`, or \`_publish\` below the root (a nested \`_tmp\` scratch directory is fine — it is ignored at any depth).`;
}

/**
 * Where box-authored code lives, and what's editable, for a (shapeVersion 3,
 * one-root) box: schemas/views/tricks live under `src/` at this same box
 * root — no climb needed.
 */
export function boxCodeLocationSection(shape: BoxShape): string {
  const { schemasDir, viewsDir, tricksDir } = boxCodePathsRelativeToBoxRoot(shape);

  return `## Box-Owned Code

This box root also holds \`package.json\`, \`node_modules/\`, and the box's source code — box-authored code (schemas, views, tricks) lives right here, under \`src/\`:

| Code | Reached from here as |
|------|------------------------|
| Schemas | \`${schemasDir}/\` |
| Views | \`${viewsDir}/\` |
| Tricks | \`${tricksDir}/\` |

**Editable, hot-reloaded — no restart needed.** Edit files under those three directories freely; the schema loader, view compiler, and trick runner all pick up changes without a restart.

**Not yours to edit.** \`package.json\`, \`node_modules/\`, lockfiles, \`tsconfig.json\`, and anything else at the box root outside the underscore-prefixed content areas (\`_content/\`, \`_config/\`, \`_bookkeeping/\`, \`_publish/\`, \`_tmp/\`) and \`src/\` belong to the boxholder, not to you. Upgrading the engine — bumping the \`beebox\` dependency and everything that comes with it — is done with \`bbx upgrade\`, run by the boxholder from outside this session. Don't run \`bbx upgrade\` yourself unless explicitly asked to.

**Imports.** Box code may only import from the beebox library surface: \`beebox/cards\` (card/schema primitives), \`beebox/schema\` (Zod and YAML, version-pinned to the engine), and \`beebox/view-widgets\` (view components). Don't add other dependencies to \`package.json\` — that file isn't yours to edit.`;
}

export function howItemsEnterSection(): string {
  return `## How Items Enter the Box

Most items arrive on their own — you rarely need to place one by hand (though you do create and move cards with \`bbx create\` / \`bbx mv\` as part of your work). The arrival mechanisms:

- **Capture UI** — the user records voice memos, takes photos, or types text in the web interface. The preparation worker transcribes and assembles a timeline, then delivers the session as a \`<capture>\` chat message pointing at a capture-session card (its child image/audio cards live in that card's attach scope) — the chat agent annotates it and files it. \`bbx scan-import\` batches (photos/PDFs with no chat message) drop their capture-session card straight into \`_content/inbox/\` for triage instead.
- **Connectors** — external services (Gmail, Telegram, Google Calendar, Google Drive) sync during \`bbx wakeup\`. Connectors create cards in \`_content/inbox/\` and job cards in \`_bookkeeping/jobs/\` for processing.
- **\`bbx create\`** — the CLI command creates cards from templates. Use this when YOU need to create a card (e.g., a question, todo, or record). Example: \`bbx create _bookkeeping/questions/Color.question.card -t question\`
- **Chat** — users send messages through the chat UI, which creates/updates chat-thread cards.
- **Clerk browser extension** — the user's "Comment on this page" captures a web page as a \`*.webpage.card\`: the readable markdown rendering as its body, with \`source\`/\`captured\`/\`frozen\` frontmatter, plus a frozen self-contained snapshot at \`attach/page.frozen\`. The user's remarks live in a separate \`*.commentary.card\` *inside the webpage card's attach scope* (\`<basename>.attach/\`); the webpage view surfaces them inline, and bare \`{% source %}\` anchors there default to the containing page. "Save page" produces the same \`*.webpage.card\` without the commentary. It lands in the chosen \`[commentary]\` destination landmark dir, or \`_content/inbox/\` by default.

Two sorting mechanisms process items that land in \`_content/inbox/\`. Don't confuse a **job** (a card in \`_bookkeeping/jobs/\` that tells the reactor to do a unit of work) with a **triaged item** (an inbox item routed to a category to await its handler) — they're different things that happen to share the word "intake":

- **Jobs → reactor** — the primary routing path: \`bbx wakeup\` and the connectors create job cards in \`_bookkeeping/jobs/\`, and the reactor processes them one cycle per wakeup.
- **The intake → triage → handle pipeline** — runs when invoked directly (\`bbx intake\` / \`bbx triage\` / \`bbx handle\`), moving items through \`_content/inbox/intake/\` → \`staged/\` → \`triaged/<category>/\`. See \`${BOX_PACKAGE_DOCS}/triage.md\` (confidence levels, handler \`TRIAGE_ITEMS\` contract).

**Common mistake:** Do NOT tell users to "put" or "place" files in directories. Users interact through the web UI, chat, or external services. Only agents use \`bbx create\` and \`bbx mv\`.`;
}

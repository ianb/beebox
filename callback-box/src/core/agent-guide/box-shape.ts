/**
 * Directory layout and intake mechanisms — the shape of the box and how
 * items get into it.
 *
 * This is the in-box agent-facing summary. The canonical directory list
 * lives in BOX_DIRS (src/cli/lib/paths.ts) and the developer-facing
 * reference is docs/box-layout.md. When you change directories here, keep
 * those two in sync — drift between them has caused confusion before.
 */

export function directoryLayoutSection(): string[] {
  return [
    "## Directory Layout",
    "",
    "Location is state — a card's directory determines its lifecycle stage:",
    "",
    "| Directory | Purpose |",
    "|-----------|---------|",
    "| `box/inbox/` | Incoming items to be triaged |",
    "| `box/inbox/intake/` | Items being prepared before triage (transcription, OCR, filename normalization). |",
    "| `box/inbox/staged/` | Intake-complete; waiting for the triage agent. |",
    "| `box/inbox/triaged/<category>/` | Categorized; awaiting the handler procedure. `<category>` is one of this box's triage destinations (set by its `<destination for=\"triage\">` landmarks), not a fixed list. |",
    "| `box/inbox/triaged/_unsure/` | Held low-confidence items, paired with a question card. |",
    "| `box/inbox/unhandled/` | Items with no clear destination |",
    "| `box/jobs/` | Pending job cards for the reactor to process |",
    "| `box/questions/` | Pending questions for the user |",
    "| `box/resources/` | Synced external state |",
    "| `box/output/` | Cards that make something happen **outside** the box — an action serialized as a card for an external effector to pick up and execute (a Telegram message to send, etc.), flushed by `cb finalize` |",
    "| `box/pool/` | A working area for items being actively processed (created on demand) |",
    "| `store/archive/` | Processed/completed items |",
    "| `store/calendar/` | Calendar events (.ics files) — two-way sync with Google Calendar |",
    "| `store/drive/` | Google Drive files (spreadsheets as JSON, docs as markdown) — two-way sync |",
    "| `store/recipes/` | Recipe collection (subdirectories for organization) |",
    "| `store/reviews/retro/` | Retrospective run reports (written by `cb retro`) |",
    "| `store/todos/` | Active todo lists — human action items |",
    "| `store/trash/` | Soft-deleted items |",
    "| `people/` | Person cards — key people referenced from briefings |",
    "| `places/` | Place cards — named locations the box recognizes (Home, Office) |",
    "| `config/` | Box configuration |",
    "",
  ];
}

export function howItemsEnterSection(): string[] {
  return [
    "## How Items Enter the Box",
    "",
    "Most items arrive on their own — you rarely need to place one by hand (though you do create and move cards with `cb create` / `cb mv` as part of your work). The arrival mechanisms:",
    "",
    "- **Capture UI** — the user records voice memos, takes photos, or types text in the web interface. These are saved to `box/inbox/` automatically and processed via the `process-captures` procedure.",
    "- **Connectors** — external services (Gmail, Telegram, Google Calendar, Google Drive) sync during `cb wakeup`. Connectors create cards in `box/inbox/` and job cards in `box/jobs/` for processing.",
    "- **`cb create`** — the CLI command creates cards from templates. Use this when YOU need to create a card (e.g., a question, todo, or record). Example: `cb create box/questions/Color.question.card -t question`",
    "- **Chat** — users send messages through the chat UI, which creates/updates chat-thread cards.",
    "- **Clerk browser extension** — the user's \"Comment on this page\" captures a web page as a `*.webpage.card`: the readable markdown rendering as its body, with `source`/`captured`/`frozen` frontmatter, plus a frozen self-contained snapshot at `attach/page.frozen`. The user's remarks live in a separate `*.commentary.card` *inside the webpage card's attach scope* (`<basename>.attach/`); the webpage view surfaces them inline, and bare `{% source %}` anchors there default to the containing page. \"Save page\" produces the same `*.webpage.card` without the commentary. It lands in the chosen `<destination for=\"commentary\">` landmark dir, or `box/inbox/` by default.",
    "",
    "Two sorting mechanisms process items that land in `box/inbox/`. Don't confuse a **job** (a card in `box/jobs/` that tells the reactor to do a unit of work) with a **triaged item** (an inbox item routed to a category to await its handler) — they're different things that happen to share the word \"intake\":",
    "",
    "- **Jobs → reactor (the active path)** — `cb wakeup` and the connectors create job cards in `box/jobs/`, and the reactor processes them one cycle per wakeup. This is what actually runs today; most routing goes through it.",
    "- **The intake → triage → handle pipeline** — the newer path (`cb intake` / `cb triage` / `cb handle`), moving items through `box/inbox/intake/` → `staged/` → `triaged/<category>/`. See `docs/plans/triage-design.md`. It coexists with jobs but **is not wired into `cb wakeup` yet**.",
    "",
    "**Common mistake:** Do NOT tell users to \"put\" or \"place\" files in directories. Users interact through the web UI, chat, or external services. Only agents use `cb create` and `cb mv`.",
    "",
  ];
}

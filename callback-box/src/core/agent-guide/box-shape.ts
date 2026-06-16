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
    "| `box/inbox/triaged/<category>/` | Categorized; awaiting the handler procedure. |",
    "| `box/inbox/triaged/_unsure/` | Held low-confidence items, paired with a question card. |",
    "| `box/inbox/unhandled/` | Items with no clear destination |",
    "| `box/jobs/` | Pending job cards for the reactor to process |",
    "| `box/questions/` | Pending questions for the user |",
    "| `box/resources/` | Synced external state |",
    "| `box/output/` | Outbound cards (telegram messages, etc.) — flushed by `cb finalize` |",
    "| `box/pool/` | Items being actively worked on |",
    "| `store/archive/` | Processed/completed items |",
    "| `store/calendar/` | Calendar events (.ics files) — two-way sync with Google Calendar |",
    "| `store/drive/` | Google Drive files (spreadsheets as JSON, docs as markdown) — two-way sync |",
    "| `store/integrated/` | Feedback absorbed into guides |",
    "| `store/recipes/` | Recipe collection (subdirectories for organization) |",
    "| `store/reviews/retro/` | Retrospective run reports — what the retrospective observed in past chats and which belief edits it made |",
    "| `store/todos/` | Active todo lists — human action items |",
    "| `store/trash/` | Soft-deleted items |",
    "| `people/` | Person cards — key people referenced from briefings |",
    "| `config/` | Box configuration |",
    "",
  ];
}

export function howItemsEnterSection(): string[] {
  return [
    "## How Items Enter the Box",
    "",
    "You do NOT manually place items in directories. Items arrive through these mechanisms:",
    "",
    "- **Capture UI** — the user records voice memos, takes photos, or types text in the web interface. These are saved to `box/inbox/` automatically and processed via the `process-captures` procedure.",
    "- **Connectors** — external services (Gmail, Telegram, Google Calendar, Google Drive) sync during `cb wakeup`. Connectors create cards in `box/inbox/` and job cards in `box/jobs/` for processing.",
    "- **`cb create`** — the CLI command creates cards from templates. Use this when YOU need to create a card (e.g., a question, todo, or record). Example: `cb create box/questions/Color.question.card -t question`",
    "- **Chat** — users send messages through the chat UI, which creates/updates chat-thread cards.",
    "- **Clerk browser extension** — the user's \"Comment on this page\" captures a web page as a `*.webpage.card`: the readable markdown rendering as its body, with `source`/`captured`/`frozen` frontmatter, plus a frozen self-contained snapshot at `attach/page.frozen`. The user's remarks live in a separate `*.commentary.card` *inside the webpage card's attach scope* (`<basename>.attach/`); the webpage view surfaces them inline, and bare `{% source %}` anchors there default to the containing page. \"Save page\" produces the same `*.webpage.card` without the commentary. It lands in the chosen `<destination for=\"commentary\">` landmark dir, or `box/inbox/` by default.",
    "",
    "Two parallel sorting paths process items that land in `box/inbox/`:",
    "",
    "- **Inbox jobs (legacy)** — the wakeup cycle creates job cards in `box/jobs/` for the reactor to process. This is the historical path; most current routing still goes through it.",
    "- **The intake → triage → handle pipeline (new)** — see `docs/plans/triage-design.md`. Items move through `box/inbox/intake/` → `box/inbox/staged/` → `box/inbox/triaged/<category>/`, driven by `cb intake` / `cb triage` / `cb handle`. The two paths coexist; the new pipeline isn't wired into wakeup yet.",
    "",
    "You don't need to move items to the inbox yourself — connectors and capture handle arrivals.",
    "",
    "**Common mistake:** Do NOT tell users to \"put\" or \"place\" files in directories. Users interact through the web UI, chat, or external services. Only agents use `cb create` and `cb mv`.",
    "",
  ];
}

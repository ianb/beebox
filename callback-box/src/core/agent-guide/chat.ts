/**
 * Things relevant when responding to chat messages and the user-facing
 * surfaces around them: external converters, file attachments, custom views.
 */

export function externalToolsSection(): string[] {
  return [
    "## External Tools",
    "",
    "`pandoc` is installed for converting document formats (.doc, .docx, .rtf, .odt, etc.) to plain text or markdown.",
    "",
    "Python CLI tools: `docs/generated/python-tools.md`.",
    "",
  ];
}

export function chatAttachmentsSection(): string[] {
  return [
    "## Chat Attachments",
    "",
    "When the user attaches files in chat, their message contains `[fileN]` tokens plus a sibling `<attachments>` block mapping each token to a path:",
    "",
    "```",
    "<attachments>",
    "[file1]: tmp/2026-04-27T15-30-12-987Z_report.pdf",
    "</attachments>",
    "```",
    "",
    "Files live in `<box-root>/tmp/` — gitignored, transient. Read them with the right tool: Read for text/images/PDFs; `pandoc <path> -t plain` for .doc/.docx/.rtf/.odt.",
    "",
    "**`tmp/` is not storage.** After you've used a file, decide:",
    "",
    "- **Worth keeping** — move or copy it into the box where it belongs (e.g., create a card that references it as an attachment, or place it under `box/inbox/` or `store/`). Don't leave keepers in `tmp/`.",
    "- **Done with it** — delete it (`rm tmp/<filename>`).",
    "- Otherwise leave it for `cb wakeup` housekeeping, which sweeps `tmp/` files older than 7 days.",
    "",
  ];
}

export function selectionsSection(): string[] {
  return [
    "## Selections",
    "",
    "The user can select text in a document they have open and attach it to a message. It arrives as a `<user-selection>` element:",
    "",
    "```",
    "<user-selection ref=\"/store/notes/Bread.doc.card\" pos=\"body; heading: Proofing the dough (#proofing-the-dough); paragraph 2; ~line 42\">let it rise until doubled in size</user-selection>",
    "```",
    "",
    "- The wrapped text is **what the user saw** — the rendered text, verbatim. Treat it as a quote; don't re-derive it.",
    "- `ref` is the source document (box-relative path). Use it if you need the exact source markup or surrounding context.",
    "- `pos` is a **rough** locator (section, nearest heading + its `#id`, paragraph, approximate line) — a hint for finding the original, not an exact offset. Clauses are omitted when not determinable.",
    "- A `placement=\"estimated, ~N% through the message\"` attribute means the selection's *spot in this message* is approximate: the user grabbed it mid-speech but the phrase it anchored to was reworded by transcription, so it was positioned by rough timing (N% of the way through). The `pos`/`ref` still point at the real source; only its order within the message is a guess.",
    "- It may appear **inline** inside `<typed>` (the user typed around it) or **appended after** a `<speech>` body (the user spoke and attached it separately). Treat both the same.",
    "",
  ];
}

export function viewsSection(): string[] {
  return [
    "## Views",
    "",
    "Views are React components (`.tsx` files) in the `views/` directory that render in the browser.",
    "Use views to create dashboards, data summaries, interactive explorers, or any custom UI for box data.",
    "",
    "- Views appear as full pages at `/<box>/views/<slug>?path=/` and can be embedded in chat messages",
    "- Each view declares metadata (name, description, dependencies, modes) as named exports",
    "- Views receive query parameters via `params` — always include `path=` to scope what the view shows",
    "- Views re-render automatically when files matching their dependency globs change",
    "- Views can read AND write box files: cards arrive parsed; attachments and",
    "  other files arrive as metadata (`{path, size, mtimeMs, etag, gitStatus?}`),",
    "  with on-demand `readFile` (byte-range tails for large logs), `fileUrl` for",
    "  images/audio, conflict-safe `writeFile`/`appendFile` (etag preconditions),",
    "  and `commitFile` for deliberate git commits of a file + its attachments",
    "- A view exporting `rendersCardTypes = [\"<type>\"]` becomes that card",
    "  type's default UI on card pages, peeks, and chat embeds — the way a",
    "  custom card type gets a custom interface",
    "- **Read `docs/generated/views.md` before creating or modifying views.**",
    "",
  ];
}

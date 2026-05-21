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
    "- **Read `docs/generated/views.md` before creating or modifying views.**",
    "",
  ];
}

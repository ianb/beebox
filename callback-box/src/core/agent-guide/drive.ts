/**
 * Google Drive sync (sheets and docs in store/drive/).
 */

export function driveSection(): string[] {
  return [
    "## Google Drive",
    "",
    "Google Drive content syncs **two-way** into `store/drive/` (or wherever you place the card). A Drive card keeps all its data in its own **attach scope** (`<basename>.attach/`), so `cb mv` moves the card and everything with it in one step — the `drive-id` in the card keeps the upstream link. Don't move the pieces by hand.",
    "",
    "### Spreadsheets (`.sheet.card`)",
    "",
    "- **Find:** the card lists the title, Google link, and its tabs.",
    "- **Read:** each tab is a JSON file in the card's attach scope (referenced from the card). Plain cells are bare values; formula cells are `{\"f\": \"=SUM(A1:B1)\", \"v\": \"$42.00\"}` — both the formula and the computed result.",
    "- **Edit:** edit the tab's JSON and commit (for a formula cell, edit the `f` field). The next sync pushes to Google Sheets.",
    "- **Comments:** if the spreadsheet has comments, a `<basename>.comments.json` sidecar in the attach scope holds the full thread (referenced by `comments.ref:`). Read-only context.",
    "",
    "### Documents (`.gdoc.card`)",
    "",
    "- **Find:** the card carries only metadata; the document body is markdown at `attach/<basename>.md` in its attach scope.",
    "- **Read / edit:** open and edit `attach/<basename>.md`, then commit. The next sync converts the markdown to Doc format and pushes it.",
    "- **Comments:** collaborative feedback is captured read-only as a `<basename>.comments.json` sidecar in the attach scope (content, author, timestamps, resolved status, anchored text, replies). Editing/pushing the `.md` does NOT write comments back upstream — a push may even orphan the upstream anchors. Read it to understand reviewer feedback; don't expect it to round-trip.",
    "- **Lossy content:** the card's `lossy:` frontmatter lists upstream features that don't survive markdown export (footnotes, embedded images, equations, suggestions, complex tables). When it's non-empty, pushing local edits will destroy them — surface the loss to the user before encouraging a push.",
    "- **Conflicts:** if both local and remote changed since the last sync, the card status flips to `conflict` and the upstream content is written to `attach/<basename>.remote.md`. Resolve by merging the two, deleting `.remote.md`, and committing.",
    "",
    "CLI: `cb drive inspect <url>`, `cb drive add <url> <path>`, `cb drive sync`, `cb drive status`.",
    "",
  ];
}

/**
 * Google Drive sync (sheets and docs in store/drive/).
 */

export function driveSection(): string[] {
  return [
    "## Google Drive",
    "",
    "Google Drive content is synced into `store/drive/` (or wherever the card is placed). Sync is **two-way** for both file types.",
    "",
    "### Spreadsheets (`.sheet.card`)",
    "",
    "- **Find:** Look for `.sheet.card` files. The card lists the title, Google link, and sheet tabs.",
    "- **Read:** Each tab is a JSON file in a subdirectory matching the card basename. Plain cells are bare values; formula cells are `{\"f\": \"=SUM(A1:B1)\", \"v\": \"$42.00\"}` with both the formula and computed result.",
    "- **Edit:** Edit the JSON file directly and commit. For formula cells, edit the `f` field. Next sync pushes to Google Sheets.",
    "- **Comments:** If the spreadsheet has comments, a `{basename}.comments.json` sidecar in the attach scope holds the full thread (referenced by `comments.ref:`). Read-only context — see the docs note below.",
    "- **Move:** Move the `.sheet.card` and its data directory together. The `drive-id` in the card maintains the link.",
    "",
    "### Documents (`.gdoc.card`)",
    "",
    "- **Find:** Look for `.gdoc.card` files. The card sits next to a sibling markdown file with the same basename (e.g., `Notes.doc.card` + `Notes.md`).",
    "- **Read:** Open the `.md` file. The card itself only carries metadata.",
    "- **Edit:** Edit the `.md` file and commit. Next sync pushes to Google Docs (markdown is converted to Doc format on the server).",
    "- **Comments:** Collaborative feedback is captured as a `{basename}.comments.json` sidecar in the attach scope (referenced by `comments.ref:` when the doc has comments) — the full thread: content, author, timestamps, resolved status, anchored text, and replies. This is read-only context preserved for reading; editing/pushing the `.md` does NOT write comments back upstream (a push may even orphan the upstream anchors). Read it to understand reviewer feedback; don't expect it to round-trip.",
    "- **Lossy content:** A `<lossy>` block in the card lists features in the upstream Doc that don't survive markdown export (footnotes, embedded images, equations, suggestions, complex tables). When present, pushing local edits will destroy them. Surface the loss to the user before encouraging a push. (Comments are handled by the sidecar above, not counted here.)",
    "- **Conflicts:** If both local and remote changed since the last sync, the card status flips to `conflict` and the upstream content is written to `<basename>.remote.md`. Resolve by merging the two files, deleting `.remote.md`, and committing.",
    "- **Move:** Move the `.gdoc.card` and its `.md` together. The `drive-id` in the card maintains the link.",
    "",
    "CLI: `cb drive inspect <url>`, `cb drive add <url> <path>`, `cb drive sync`, `cb drive status`.",
    "",
  ];
}

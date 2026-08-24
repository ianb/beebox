# Google Drive Integration

Sync Google Sheets with the box as CSV files. Two-way sync: pull from Drive, push local edits back.

## Prerequisites

1. **Google OAuth** configured (see [google-setup.md](google-setup.md))
2. **Drive service** enabled for the box: set `googleServices.drive: true` in `config/box.json` or toggle it in the Admin page
3. The OAuth scopes `drive.readonly` and `drive.file` are already included in the default scope set

## Quick Start

```bash
# Inspect a spreadsheet before adding
cb drive inspect https://docs.google.com/spreadsheets/d/1abc.../edit

# Mount it at a local path
cb drive add https://docs.google.com/spreadsheets/d/1abc.../edit store/drive/budget

# Sync all mounted files
cb drive sync

# Check status
cb drive status

# Browse your spreadsheets
cb drive list
```

## How It Works

### File Layout

Each synced spreadsheet creates a card file and an attach scope of JSON files:

```
store/drive/Budget.gsheet.card     # frontmatter metadata (title, Drive ID, link, tabs)
store/drive/Budget.attach/
  Summary.json                          # one JSON per sheet tab
  Expenses.json
  Income.json
```

### The Card is the Config

The `.gsheet.card` file's frontmatter carries a `drive-id` field that links to Google Drive, plus a `sheets:` list of `{ref, title, gid}` objects pointing at each tab file in `Budget.attach/` via the `attach/` virtual prefix. Moving the card (and its `.attach/` scope) to a new location with `cb mv` is safe -- the link is maintained. No separate config file is needed for individual files.

### Stop or resume syncing one file

Use `cb rm <card-path>` to stop syncing one Drive file without deleting the
remote Google file. The command moves the card and its attach scope to
`store/trash/`; the Drive connector treats that committed trash card as a
durable tombstone. It neither syncs the trashed card nor re-creates it from a
configured folder mount.

Restore the card and its attach scope from trash to resume syncing. Running
`cb drive add` for the same Drive file also creates a new live mount.

A raw hard delete has different folder semantics. Hard-deleting an
individually added card untracks it, but hard-deleting a child of a configured
folder mount leaves the folder subscription in force, so the next sync
discovers the child again. Use `cb rm` to exclude one folder child, or remove
the folder entry from `config/connectors/google-drive.json` to stop tracking
the whole folder.

### Sync Flow

On `cb wakeup` or `cb drive sync`:

1. The connector finds live Drive cards outside infrastructure and
   `store/trash/`, while retaining trash Drive IDs as folder-discovery
   tombstones
2. For each live card, reads the `drive-id` field
3. Compares local JSON content hashes with stored hashes:
   - **Local file unchanged** -- pull remote changes (overwrite JSON)
   - **Local file edited** -- push changes to Google Sheets via API
4. Updates the card metadata (title, modified time)
5. Stages and commits changes

### Data Format

Each tab is a JSON file with one row per line:

```json
[
["Name", "Amount", "Total"],
["Alice", 100, {"f": "=SUM(B2:B3)", "v": "250"}],
["Bob", 150, ""]
]
```

- Plain cells are bare values (strings, numbers, booleans, null)
- Formula cells are objects: `{"f": "=SUM(...)", "v": "computed result"}` -- both the formula and the display value
- When pushing edits, formula strings are sent with `USER_ENTERED` so Google Sheets parses them

### Editing Spreadsheets

Edit the JSON file directly and commit. For plain cells, change the value. For formula cells, edit the `f` field. On next sync, the connector detects the change (via content hash) and pushes it to Google Sheets.

**Do NOT hand-edit the `.gsheet.card` frontmatter** -- it is managed by the connector.

## CLI Commands

| Command | Description |
|---------|-------------|
| `cb drive inspect <url-or-id>` | Preview file metadata (title, tabs, owner) |
| `cb drive add <url-or-id> <path>` | Mount a spreadsheet at a local path |
| `cb drive sync` | Sync all mounted files |
| `cb drive status` | Show all mounts and their state |
| `cb drive list [folder-url]` | Browse spreadsheets (or files in a folder) |

The `<url-or-id>` argument accepts:
- Full Google Sheets URL: `https://docs.google.com/spreadsheets/d/FILE_ID/edit`
- Full Drive URL: `https://drive.google.com/file/d/FILE_ID/view`
- Drive open URL: `https://drive.google.com/open?id=FILE_ID`
- Bare file ID

## Folder Mounts

To auto-sync all spreadsheets in a Drive folder, add a folder mount to `config/connectors/google-drive.json`:

```json
{
  "folders": [
    { "driveFolderId": "FOLDER_ID", "localPath": "store/drive/shared" }
  ]
}
```

New spreadsheets appearing in the folder are automatically pulled on sync.

## Architecture

The connector uses a **type handler registry** (`drive-types.ts`) so new file types can be added later (Google Docs as markdown, regular file downloads, etc.) without changing the core connector logic.

Current handlers:
- **Sheets** (`drive-handler-sheets.ts`) -- exports as CSV with formulas

## Limitations

- **Google Docs** not yet supported (planned: export as markdown)
- **Regular files** (PDFs, images) not yet supported (planned: direct download)
- **No new file creation** -- the connector only syncs existing Drive files
- **Export size** -- Google Sheets API has a 10MB response limit per request
- **Comments/formatting** -- JSON export preserves computed values but not formatting or comments. Edit in Google Sheets for formatting; edit JSON for data.

## Troubleshooting

### "Google auth not configured"

Run `cb google-auth` or connect via the Admin page.

### "Calendar service not enabled" (but you want Drive)

Enable Drive separately: set `googleServices.drive: true` in `config/box.json`.

### Sync doesn't detect local changes

The connector compares content hashes stored in transient state (`config/connectors/google-drive.state.json`). If this file is missing (e.g., new machine), the connector treats all files as fresh pulls. Re-sync to establish hashes.

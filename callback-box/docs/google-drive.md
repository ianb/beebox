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

Each synced spreadsheet creates a card file and a directory of CSV files:

```
store/drive/Budget.drive-sheet.card     # metadata (title, Drive ID, link, tabs)
store/drive/Budget/
  Summary.csv                           # one CSV per sheet tab
  Expenses.csv
  Income.csv
```

### The Card is the Config

The `.drive-sheet.card` file contains the `drive-id` attribute that links to Google Drive. Moving the card (and its CSV directory) to a new location is safe -- the link is maintained. No separate config file is needed for individual files.

### Sync Flow

On `cb wakeup` or `cb drive sync`:

1. The connector finds all `.drive-sheet.card` files anywhere in the box
2. For each card, reads the `drive-id` attribute
3. Compares local CSV content hashes with stored hashes:
   - **Local file unchanged** -- pull remote changes (overwrite CSV)
   - **Local file edited** -- push changes to Google Sheets via API
4. Updates the card metadata (title, modified time)
5. Stages and commits changes

### CSV Format

- CSVs contain **formulas** (e.g., `=SUM(A1:B1)`), not computed values
- This lets agents understand spreadsheet logic
- When pushing edits, values are sent with `USER_ENTERED` so Google Sheets parses formulas

### Editing Spreadsheets

Edit the CSV file directly and commit. On next sync, the connector detects the change (via content hash) and pushes it to Google Sheets.

**Do NOT edit the card XML** -- it is managed by the connector.

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
- **Comments/formatting** -- CSV export loses all formatting and comments. Edit in Google Sheets for formatting; edit CSV for data.

## Troubleshooting

### "Google auth not configured"

Run `cb google-auth` or connect via the Admin page.

### "Calendar service not enabled" (but you want Drive)

Enable Drive separately: set `googleServices.drive: true` in `config/box.json`.

### Sync doesn't detect local changes

The connector compares content hashes stored in transient state (`config/connectors/google-drive.state.json`). If this file is missing (e.g., new machine), the connector treats all files as fresh pulls. Edit and re-sync to establish hashes.

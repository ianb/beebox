# Google Drive Integration

Three kinds of Drive card, three promises:

- **Synced file** (`.gdoc.card` / `.gsheet.card`) -- content mirrored two-way:
  pull from Drive, push local edits back.
- **Mirrored folder** (`.gfolder.card`) -- the directory the card sits in
  mirrors the Drive folder's membership.
- **Pointer** (`.glink.card`) -- "this Drive item exists, here is where, here is
  what it is for." Nothing is copied.

Every one of them is a card; there is no mount config to edit.

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

# Mirror a whole Drive folder into a directory
cb drive mount https://drive.google.com/drive/folders/1xyz... store/drive/recipes

# Keep a pointer to something the box should know about but not copy
cb drive link https://drive.google.com/file/d/1pdf.../view store/drive/Lease
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

### Ambiguous local identity fails closed

One Drive file has one card. When local identity is ambiguous, the connector
declines to sync rather than guessing — the run reports a failure (which
`cb wakeup` counts as a connector error) and names the paths involved:

- **Two live cards with the same `drive-id`.** Transient content hashes are
  keyed by Drive ID while attachments live per card, so syncing either copy can
  push its stale attachments over the other's edit. Neither is synced; delete
  or re-point one card to resolve it. `cb drive add` refuses a Drive file that
  a live card already claims.
- **A remote file whose derived card name is already taken by a different
  `drive-id`.** Folder discovery reports the collision instead of skipping the
  child silently. Rename the local card (or the Drive file) to give the child a
  free name.
- **A Drive card whose `drive-id` cannot be read.** It may be the trash
  tombstone that suppresses a folder child, so folder discovery is skipped
  entirely for that run; per-card sync still runs. Fix or remove the card.

`cb drive status` lists all three alongside the healthy mounts.

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
| `cb drive inspect <url-or-id>` | Preview Drive metadata (title, tabs, owner) |
| `cb drive add <url-or-id> <path>` | Sync a Doc or Sheet at a local path |
| `cb drive mount <url-or-id> <dir>` | Mirror a Drive folder into a directory |
| `cb drive link <url-or-id> <path>` | Keep a pointer to any Drive item |
| `cb drive unmount <dir-or-card>` | Stop mirroring a folder (children stay) |
| `cb drive sync` | Sync every Drive card |
| `cb drive status` | Show every Drive card, its kind, and its state |
| `cb drive list [folder-url]` | Browse spreadsheets (or files in a folder) |

`cb drive status` names each card's kind -- `file` (synced two-way), `folder`
(mirrored), or `link` (a pointer, nothing copied) -- and for a folder mount also
prints its last sync outcome and time.

The `<url-or-id>` argument accepts:
- Full Google Sheets URL: `https://docs.google.com/spreadsheets/d/FILE_ID/edit`
- Full Drive URL: `https://drive.google.com/file/d/FILE_ID/view`
- Drive folder URL: `https://drive.google.com/drive/folders/FOLDER_ID`
- Drive open URL: `https://drive.google.com/open?id=FILE_ID`
- Bare file ID

## Folder Mounts

A folder mount is a **card**, not config. `cb drive mount <folder-url> <dir>`
writes a `.gfolder.card` inside `<dir>` and mirrors the Drive folder there
immediately:

```bash
cb drive mount https://drive.google.com/drive/folders/FOLDER_ID store/drive/recipes
```

```
store/drive/recipes/Recipes.gfolder.card      # the mount
store/drive/recipes/Sourdough.gdoc.card       # a Doc child, synced two-way
store/drive/recipes/Scan_2024.glink.card      # a PDF child, pointed at
store/drive/recipes/desserts/Desserts.gfolder.card   # a subfolder, mirrored
```

**The directory is the mount.** There is no mount table -- the card's own
location is the configuration. `<dir>` is required and never guessed. One
directory holds one mount; a second `mount` into the same directory is refused,
as is mounting a folder some other live card already claims. `cb mv` of the
directory moves the mount with its children; `cb mv` of the card alone re-homes
the mirror to the card's new directory.

**What the mirror promises.** Membership follows Drive one-way, on every sync:
Docs and Sheets become synced cards, subfolders become subdirectories with their
own `.gfolder.card`, shortcuts resolve to their target, and everything else --
PDFs, Slides, images -- becomes a `.glink.card` **pointer**: name, mime type,
and link, with nothing copied and a body for whoever wants to write down what it
is for. Recursion is bounded (8 levels, 500 folders per pass) and the folder
card carries `status` / `last-sync` / `error` from the last pass.

**Pointers on their own.** `cb drive link <url> <path>` writes a pointer to any
Drive item -- folders included -- with `origin: manual` (a mirror's pointers
carry `origin: mirror`). The path gets `.glink.card` appended if you leave it
off. The connector re-stamps a pointer's Drive metadata on each sync and never
touches its body.

**Unmounting.** `cb drive unmount <dir-or-card>` is exactly `cb rm` on the mount
card: it moves to `store/trash/` and **every child stays where it is** -- synced
cards keep syncing on their own, pointers keep pointing, nothing is deleted. The
trashed card also acts as a tombstone, so a parent mirror will not re-create the
mount. Pass either the mount directory or the card itself; a directory holding
two mount cards is refused rather than guessed at.

**A child trashed on Drive** has its card moved to `store/trash/` too. A child
that merely left the folder (moved elsewhere, or access lost) is left alone and
keeps syncing; the sync reports it as `not-in-folder`.

### Automatic conversion from the old config

Boxes set up before folder mounts were cards carry a `folders` array in
`config/connectors/google-drive.json`. The **first sync converts it**: each entry
becomes a `.gfolder.card` in its `localPath` (mirrored on the same pass), and the
config is rewritten without the entry, in the same commit. It is idempotent, and
nothing needs to be run by hand.

One case is refused rather than converted: an entry whose `localPath` already
holds a `.gfolder.card` for a *different* Drive folder. That entry is logged and
left in the config -- converting it would put two mirrors in one directory --
until someone trashes the card or repoints the entry.

## Architecture

The connector uses a **type handler registry** (`drive-types.ts`) so new file types can be added later (Google Docs as markdown, regular file downloads, etc.) without changing the core connector logic.

Current handlers:
- **Sheets** (`drive-handler-sheets.ts`) -- exports as JSON per tab, with formulas
- **Docs** (`drive-handler-docs.ts`) -- exports as markdown

A Drive item with no handler is not an error: the folder mirror emits a
`.glink.card` pointer for it (`schemas/glink.tsx`), and a folder mount itself is
a `.gfolder.card` (`schemas/gfolder.ts`) driven by `drive-folder-sync.ts`.

## Limitations

- **Regular files** (PDFs, images) are pointed at, not downloaded -- a
  `.glink.card` records what and where, and nothing is copied
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

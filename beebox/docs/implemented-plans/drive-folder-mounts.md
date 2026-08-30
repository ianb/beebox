---
title: "Drive mounts: pointers, synced files, synced folders"
status: implemented
workstream: drive-folder-mounts
issues:
  - ../../../issues/closed/bugs/2026-08-21-drive-folder-mounts-cannot-be-configured-from-anywhere.md
  - ../../../issues/closed/features/2026-06-26-drive-mounting-file-browsing-ui.md
---
# Drive mounts: pointers, synced files, synced folders

When I have a Google Drive folder my household or project lives in (recipes,
a shared "Trip 2026" folder, a client's deliverables), I want the box to
mirror it, so the agent can read and edit those documents and I can see the
folder in the box tree. When a Drive item is a PDF, a Slides deck, or a big
file I don't want copied, I want the box to know it exists and what it is
for, so the agent can point me at it or open it on demand. When I set any of
this up, I want to do it from the settings page or by asking in chat — not by
editing JSON on the server.

Today a Drive *file* mount exists and works. A Drive *folder* mount exists on
the backend but has no writer except a caller-less tRPC mutation, and no
concept of what the box promises about a folder. This plan names three Drive
concepts, makes each one a card, and gives them a settings surface, a chat
surface, and a CLI underneath.

**Issues addressed:**
`issues/bugs/2026-08-21-drive-folder-mounts-cannot-be-configured-from-anywhere.md`,
`issues/features/2026-06-26-drive-mounting-file-browsing-ui.md`. Related, not
closed here: `issues/features/2026-07-27-boxes-cant-create-new-google-drive-docs.md`
(box→Drive creation stays out; see NOT in scope),
`issues/code-quality/2026-08-22-rename-drive-comments-sidecar-to-gcomments.md`
(naming only). Searched the queue for `drive`, `mount`, `folder`, `gdoc`,
`gsheet`; the four closed 2026-08-21..23 drive items (folder discovery
fail-open, duplicate cards, trash-does-not-stop-sync, status hides YAML
health) are already landed and are the precedent this plan builds on.

## The three concepts

| Concept | Card | What the box promises |
|---|---|---|
| **Pointer** | `.glink.card` | "This Drive item exists, here is where, here is what it is for." Nothing is copied. The agent reads it on demand via `bbx drive inspect` / the Drive URL. |
| **Synced file** | `.gdoc.card` / `.gsheet.card` (exists) | Content mirrored two-way; the box owns the card; conflicts surface as `status: conflict`. |
| **Synced folder** | `.gfolder.card` | The directory the card lives in mirrors the Drive folder's membership: Docs and Sheets become synced files, every other child becomes a pointer, subfolders become subdirectories with their own `.gfolder.card`. Membership follows Drive one-way; content of synced children is two-way as today. |

The folder card is landmark-like on purpose: it lives *inside* the directory
it describes, the same convention as `.landmark.card`
(`src/schemas/landmark.ts:4-6`: *"the file lives inside the directory it
describes"*). Because the card is the mount, `config/connectors/google-drive.json`'s
`folders` array goes away — one way to mount (principle 8), and the same
rule the file mount already follows (`src/connectors/drive-config.ts:7`:
*"Individual file mounts don't need config — the card's existence IS the
config."*).

## Stated preferences this plan trades against

- Principle 8 (one way to do each thing): folder mounts are cards, not
  config; the `folders` config array and `drive.updateConfig` are removed.
- Principle 1 (types are structure): pointer vs synced folder are separate
  card types, not a `mode:` field on one type; the connector dispatches on
  type, never on an optional field.
- Principle 3 (validate at boundaries): the Drive `files.list` response is
  already parsed through zod (`test/services/google-drive-schemas.doctest.md`);
  new fields (`shortcutDetails`) go through the same schema.
- Principle 4 / 13 (never silent; a control shows real state): a folder card
  and its view show *pending*, *synced*, *conflict*, *unsupported* per child;
  Drive-side removals are reported, not silently absorbed.
- Principle 12 (maintainer is an agent): the agent gets `bbx drive mount` /
  `bbx drive link` and skill text; it is never told to edit connector JSON.
- `feedback: CLI is not a user surface` — settings page and chat are the
  operator surfaces; the CLI is the plumbing both call.
- `feedback: minimize invented concepts` — two new card types is the
  minimum that distinguishes "copied" from "not copied"; no new config
  file, no new registry, no new view mechanism (the schema renderer
  registry already exists).
- Recursion is in scope because the boxholder's ask is "the remote folder
  has all its contents mirrored over" (2026-08-26); a one-level mirror
  would be a different promise.
- Precedent: `CalendarSection.tsx` + `routers/calendar.ts` for the settings
  mutation; `syncFolder` (`src/connectors/google-drive.ts:267-306`) for
  discovery; `extfile` (`src/schemas/extfile.tsx:1-14`) for a pointer card
  with no body copy.

## What already exists

- Folder discovery: `google-drive.ts:267-306` `syncFolder` lists direct
  children (`services/google-drive.ts:167-185`, paged), skips children with
  a live card, skips mime types with no handler, derives
  `<localPath>/<safeName>.<type>.card`, and refuses to overwrite an occupant
  with a different Drive ID. **Reuse**; it becomes "sync one `.gfolder.card`".
- Tombstones: `google-drive-tracking.ts:90-136` collects `trashedDriveIds`
  from `store/trash/`; discovery honours them. **Reuse.**
- Two-way file sync, conflict handling, comments sidecar:
  `drive-handler-docs.ts`, `drive-handler-sheets.ts`. **Untouched.**
- URL parsing: `drive-types.ts:108-131` `extractDriveFileId` accepts
  `/d/<id>/`, `?id=`, bare ids. Folder URLs are
  `https://drive.google.com/drive/folders/<id>` — the `/d/` pattern does not
  match them; `list` today works only because a bare id falls through.
  **Extend** with a `/folders/<id>` pattern.
- Fake Drive service: `services/google-drive-fake.ts` (`createFakeGoogleDrive`,
  in-memory `files` with `parents`, `mimeType`). **Extend** with folder
  entries and a `trashed` flag.
- Settings precedent: `components/settings/CalendarSection.tsx:20` wires
  `calendar.updateConfig` with `utils.calendar.invalidate()`. **Copy the
  shape**, not the config-file semantics.
- Dead code to remove: `routers/drive.ts:44-63` `updateConfig` (no caller,
  verified by grep of `src/`), `DriveSection.tsx` read-only header and its
  `bbx drive add` instruction, `drive.available` (spreadsheet list; not a
  folder picker and not used for mounting), `drive-config.ts` `folders`
  after migration, `docs/google-drive.md:141-150` "Folder Mounts" section.
- Schema renderer registry: `frontend/src/file-type-registry.ts`
  `registerFileType`; `renderers/gsheet.tsx` and `renderers/extfile.tsx` are
  the shipped per-schema renderers a `gfolder` renderer copies.
- Sync trigger: `bbx wakeup` step 4 (`cli/commands/wakeup-connectors.ts`)
  and `bbx connector-sync`; no Drive-specific schedule. **Unchanged.**

## Prior art (external)

- Drive `files.list` pages (max 1000/page), no ordering guarantee; shared
  drives need `supportsAllDrives`+`includeItemsFromAllDrives` or they are
  invisible — https://developers.google.com/workspace/drive/api/guides/enable-shareddrives
- Drive allows duplicate names in one folder; `google-drive-ocamlfuse`
  suffixes a hash, inconsistently — https://github.com/astrada/google-drive-ocamlfuse/issues/875.
  We already refuse-and-report rather than suffix (`syncFolder` occupant
  check); keep that.
- Shortcuts (`application/vnd.google-apps.shortcut`) carry
  `shortcutDetails.targetId`; a folder listing returns the shortcut, not the
  target — https://developers.google.com/workspace/drive/api/guides/shortcuts
- `changes.list` is the incremental alternative to re-listing folders —
  https://developers.google.com/workspace/drive/api/guides/manage-changes.
  Not adopted: a box syncs a handful of folders on a daily wakeup; a full
  listing per folder is within quota by orders of magnitude.
- rclone vocabulary — `copy` never deletes, `sync` makes dest match source,
  `bisync` propagates both ways — https://rclone.org/bisync/. Our folder
  is `sync` for membership (Drive→box) and `bisync` for content; this plan
  uses "mirror" for the folder and never "sync" alone.
- Docs export to `text/markdown` is capped at 10 MB —
  https://developers.google.com/workspace/drive/api/reference/rest/v3/files/export.
  Already the file-handler's problem; a folder makes it likelier to hit.

## Tracks / scope

### Track 1 — `gfolder` and `glink` schemas, connector dispatch

**What.** Two card types and the connector logic that makes a `.gfolder.card`
the folder mount.

**Why.** There is no representation of "a Drive folder" in the box; the
config array is invisible in the tree, unversioned per-directory, and
unwriteable from any surface.

**Direction.**

`glink` (`src/schemas/glink.tsx`), frontmatter, body = purpose notes written
by the boxholder or agent:

```yaml
drive-id: 1AbC…        # required
link: https://…        # webViewLink, connector-stamped
name: Q3 budget.pdf    # Drive name, connector-stamped
mime: application/pdf  # connector-stamped
origin: mirror | manual   # mirror = emitted by a folder; manual = bbx drive link
```

`gfolder` (`src/schemas/gfolder.ts`), frontmatter only, lives inside the
mirrored directory as `<dir>/<safeName>.gfolder.card`:

```yaml
drive-id: 1XyZ…        # required; the Drive folder
link: https://…
name: Recipes          # Drive name
status: ok | error     # last sync outcome
last-sync: 2026-08-26T06:00:00Z
error: "…"             # present only when status: error
```

Connector (`google-drive.ts`): tracking today returns `{driveId, absPath,
relPath, content}` with no card type (`google-drive-tracking.ts:20-30`), and
`sync()` step (a) pushes every tracked card through `syncFile`
(`google-drive.ts:135`). That is not extendable by adding extensions:
`gfolder`/`glink` cards would flow into `syncFile` and no-op. So tracking
gains a `kind: "file" | "folder" | "link"` discriminant derived from the
extension, and `sync()` dispatches on it with `assertNever` (principle 2):
`file` → `syncFile`; `folder` → `syncFolder`; `link` → re-stamp
`name`/`link`/`mime` from `getFile` only. Step (b) then becomes "for each
tracked `folder` card". **Membership is the directory**: a folder card's
mount is the directory it sits in, and its children are that directory's
Drive cards; no separate membership table. Per folder:

1. `listFiles(folderId)` (add `supportsAllDrives`).
2. Child with handler → today's path (create synced card).
3. Child that is a folder → ensure `<dir>/<safeName>/<safeName>.gfolder.card`
   exists (with `origin` implicit — it is inside a mirrored dir); it is
   synced on this same pass (depth-first, cycle-guarded by Drive ID).
4. Child that is a shortcut → resolve `shortcutDetails.targetId` and treat
   as the target; the card's `drive-id` is the target's.
5. Any other child → ensure `<dir>/<safeName>.glink.card` with
   `origin: mirror`, body empty (the boxholder or agent adds purpose notes;
   the connector never touches the body).
6. Children with a live card in the directory whose Drive ID is no longer
   listed: `getFile` each one. `listFiles` filters `trashed = false`
   (`services/google-drive.ts:171`) and `DriveFile` has no `trashed` field
   (`:22`), so `DriveFile` gains `trashed: boolean` (zod schema + fake).
   Trashed on Drive → the card and its attach scope move to `store/trash/`
   (the existing tombstone path; local edits survive there and in git
   history) and the sync report lists it. Not trashed (moved to another
   folder, or access lost → 404) → left in place, still syncing, counted
   as `not-in-folder` in the report, the folder card's `status` summary,
   and a new `bbx drive status` column. Boxholder decision 2026-08-26:
   "definitely trash the box card (it's in history anyway)".
7. Failures on one child never abort the folder; the folder card gets
   `status: error` + `error:` only when the listing itself fails.

Unmount = `bbx rm <dir>/<name>.gfolder.card`: stops discovery; children stay
as ordinary synced files and pointers (non-destructive). The tombstone rule
already keeps the folder from being re-created by a parent mirror.

Moving: `bbx mv` of the *directory* moves the mount (card and children
together). `bbx mv` of the folder card alone re-homes the mount: the next
sync mirrors into the card's new directory, and the old children become
plain file mounts. That is the same "the card's location is the config"
rule the file mount has, and the skill text says it in one line; the
existing gdoc guidance (`schemas/gdoc.tsx:99`) only promises attach-scope
moves, so this is a new statement, not reuse.

**Vocabulary lock-ins.** Card types `gfolder`, `glink`; field `origin`
(`mirror|manual`) on `glink`; the word *mirror* for folder semantics in
docs, skill text, and UI; `bbx drive mount`, `bbx drive link`, `bbx drive
unmount` (alias of `bbx rm` on the folder card, for discoverability).

**First implementation chunk.** Schemas + registry entries + zod tests;
tracking gains `kind` and `sync()` dispatches on it; `extractDriveFileId`
accepts `/folders/<id>`; `DriveFile` gains `trashed`; fake service gains
folder, shortcut, and trashed fixtures; `syncFolder` reads from cards
instead of config, emits `glink` for unsupported children, trashes
Drive-trashed children, recurses one level per pass with a cycle guard.
Doctest: `test/connectors/connector-drive-folder.doctest.md`.

### Track 2 — CLI plumbing and migration

**What.** `bbx drive mount <folder-url> <dir>`, `bbx drive link <url> <path>`,
`bbx drive unmount <dir-or-card>`; a one-shot migration of existing config
`folders` entries into `.gfolder.card`s; removal of `drive-config.ts`
`folders`, `drive.updateConfig`, the docs section.

**Why.** Cards need a writer the agent and the settings page share.

**Direction.** `mount <url> <dir>` resolves the id, `getFile`s it, refuses
non-folders and already-mounted IDs (same guard style as `add`,
`drive.ts:172-260`), writes the card, runs one folder sync, commits. The
directory is always explicit — no default (boxholder, 2026-08-26); in chat
the agent proposes one and asks if unsure. `link <url> <path>` works for
any mime including folders; writes `origin: manual`. Migration: `bbx drive
migrate-folders` is NOT added; instead `sync()` converts each `folders`
entry into a card on first run, then rewrites the config without `folders`
and logs it. Two things this is not free on: `loadDriveConfig` is
`JSON.parse` with fall-back-to-empty (`drive-config.ts:25-40`), so the
conversion first raises it to a zod `safeParse` with a loud failure
(principle 3 — a malformed config must not silently convert to "no
mounts"); and `sync()` commits only `created/updated/pushed` paths
(`google-drive.ts:198`), so the rewritten config path is added to that
commit explicitly. Idempotent: an entry whose target directory already has
a `.gfolder.card` with the same id is dropped from config without a write.
`bbx-migration` skill consulted: this is a config-shape change, not a card
shape change; no `migrations/` entry.

**First implementation chunk.** The three subcommands + doctests, then the
in-sync conversion + a doctest that starts from a config with `folders`.

### Track 3 — Settings page and chat

**What.** `DriveSection.tsx` becomes a mount manager; `drive` router gains
`mounts` (query: every `.gfolder.card` with status/last-sync/child counts),
`mount` (mutation: url + dir), `unmount` (mutation: card path), `link`
(mutation). The skill text teaches the agent the three concepts and the
three commands.

**Why.** The boxholder's surfaces are settings and chat
(`feedback_cli_not_a_user_surface`).

**Direction.** The primary path is chat: the boxholder pastes a Drive URL
and says what they want ("mirror this", "keep a pointer to this for the
tax stuff"), and the agent runs `bbx drive mount` or `bbx drive link`. The
skill text says so, with the "ask for a directory if unsure" rule.
Settings is the second path: list of mounts (name → directory, last sync,
status, "open" link to the card), a "Mount a folder" form (folder URL,
target directory, required), "Add a pointer" form (URL, path). Errors from the mutation render inline (Calendar precedent
shows only the mutation error state; do the same). Chat: the skill text
gains a "Three kinds of Drive card" section and the mount/link/unmount
lines; the agent runs the CLI. Knowledge audits below.

**First implementation chunk.** Router procedures + settings list/mount
form; `drive.available` and `updateConfig` deleted in the same commit.

### Track 4 — Seeing a folder

**What.** A `gfolder` renderer (`renderers/gfolder.tsx`) registered via
`registerFileType`: the folder's children from the box tree with per-child
state (synced / pointer / conflict), the Drive link, last sync, and a
"Sync now" action calling a `drive.syncFolder` mutation. A `glink` renderer
showing name/mime/purpose and an open-in-Drive link.

**Why.** Principle 13: the folder card must show what the box actually
holds, including the unsupported children it only points at.

**Direction.** The directory renderer (`renderers/directory.tsx`) already
lists a directory; the gfolder renderer composes it and adds the Drive
column. No remote listing in v1 — the card view shows box state; "Sync now"
is how the boxholder reconciles.

**First implementation chunk.** Both renderers, `syncFolder` mutation, a
frontend doctest for the state column.

## Could this be simpler?

Simplest: wire `DriveSection.tsx` to the existing `drive.updateConfig` with
a URL+path form, and add `bbx drive mount` that appends to the config array.
Two files, an afternoon, closes both issues as written.

What the fuller plan buys, per principle: the simple version leaves a
folder invisible in the tree and unowned by any card, so the agent cannot
find "the Recipes folder" without reading connector config (principle 7 —
absence from the tree should mean absence), keeps two mount mechanisms
(config for folders, cards for files — principle 8), and has no place to
hang status, purpose, or a view (principle 13). It also cannot represent a
PDF in the folder at all; the boxholder's stated need includes pointers.
Track 4 is the part most safely dropped: without it the folder card renders
as raw frontmatter, which is degraded but not silent.

## Subplans

none — the only research-and-decide item (Drive-side removal handling) is
settled in Direction with the "trashed-only" rule and listed under Open
design questions for the boxholder's veto.

## Failure modes

| What can fail | Test exists? | Handling exists? | Clear-or-silent? |
|---|---|---|---|
| Folder URL pasted is a file, or a folder the token can't read | no → Track 2 doctest | `getFile` error surfaces from `mount`; add mime check | clear (mutation error) |
| Two children with the same safe name | yes (`connector-drive.doctest.md`, occupant check) | refuse + report | clear |
| Subfolder cycle via shortcut (A → shortcut to A) | no → Track 1 doctest | cycle guard by Drive ID per pass | clear (logged) |
| Shared-drive folder returns empty listing | no → Track 1 doctest (fake flag) | add `supportsAllDrives`+`includeItemsFromAllDrives` to `getFile`/`listFiles` params (`services/google-drive.ts:155-185`; not present today) | silent without the flag — **this is why the flag is in chunk 1** |
| Drive-side child trashed | no → Track 1 doctest | `getFile` per absent child; trashed → card + attach to `store/trash/`, reported | clear |
| Drive-side child moved out (or access lost) | no → Track 1 doctest | left in place, keeps syncing; `not-in-folder` in report, folder `status`, `bbx drive status` column | clear |
| `getFile` on an absent child fails transiently | no → doctest | child left in place this pass, counted as `unknown`; never trashed on an error | clear |
| Folder card hand-edited to a different `drive-id` | no → doctest | treated as a new mount; old children stay | clear via `status` |
| Config `folders` entry whose localPath now has a `.gfolder.card` with a different id | no → Track 2 doctest | conversion refuses that entry, logs, keeps it in config | clear |
| Deep tree (hundreds of subfolders) on daily wakeup | no → doctest for the cap | recursion capped at depth 8 and 500 folders per pass; folder card `status: error` names the cap | clear |
| Renderer shows a child as synced while its sync failed | no → Track 4 doctest | state derived from card `status` field | clear |

No critical gap: every silent row above has handling in chunk 1.

## Agent-flow / user-flow edge cases

- **Wrong type** — agent creates a `glink` when it meant to mount, or
  `bbx drive add` on a folder: ADDRESSED — `add` already refuses (no
  handler); `mount` refuses non-folders; skill text names the three.
- **Stale ref** — folder card moved with `bbx mv`: ADDRESSED — children are
  siblings and move with the directory; the `drive-id` keeps the link.
- **Two agents** — chat agent runs `bbx drive sync` during wakeup sync:
  ADDRESSED by existing delta-merge RMW of transient state
  (`commitDriveStateDelta`); folder card writes are whole-file with the
  same "compare Drive ID before overwrite" rule.
- **Hand-edit drift** — boxholder edits `name:` or `link:` on a folder card:
  ADDRESSED — connector re-stamps them each sync; body is theirs.
- **Fabricated free-form** — `glink` body is free text by design; `mime`,
  `name`, `link` are connector-stamped and lint-checked non-empty.
- **Validation error UX** — schema errors read as "gfolder: drive-id is
  required" via existing card lint; ADDRESSED.
- **Transition state** — a box with `folders` in config and no cards:
  ADDRESSED by the in-sync conversion (Track 2); until the first sync the
  settings page lists nothing and the config still works.

## NOT in scope

- **A Drive folder browser in settings** — paste-a-URL covers mounting; a
  tree picker is a separate feature (the 2026-06-26 issue's "bigger" path).
- **Box→Drive creation** (new Docs from the box, box-side `rm` deleting on
  Drive) — separate issue `2026-07-27-boxes-cant-create-new-google-drive-docs`.
- **Downloading binary children** (PDF bytes into the attach scope) — the
  pointer covers "know it exists"; a `docling`-style ingest is a later
  handler in the existing registry.
- **`changes.list` incremental sync** — not needed at daily-wakeup cadence.
- **Purge-on-unmount** — unmount is non-destructive; a `--purge` can follow.
- **Rename `.comments.json` → gcomments** — separate code-quality issue.
- **User-story catalog recheck** — run per the bug issue's instructions at
  /finish, not designed here.

## Open design questions

- Settled 2026-08-26 by the boxholder: pointer emission for unsyncable
  children is on; Drive-side trash trashes the box card; no default mount
  directory. Recorded in Direction.
- Should a mirrored subfolder be a `gfolder` card of its own (this plan:
  yes, so it can be unmounted or given purpose notes independently), or an
  implicit part of the parent? Lean: own card.
- Whether `not-in-folder` children should eventually be re-homed
  automatically when they reappear in another mirrored folder. Lean: no;
  `bbx mv` is enough.

## Knowledge audits

Add to `src/dev/knowledge-audits.yaml`, tag `drive`:
`drive-three-kinds` (knows_directly: pointer vs synced file vs mirrored
folder), `drive-mount-folder` (knows_directly: `bbx drive mount`),
`drive-pointer-for-pdf` (knows_directly: a PDF in a mirrored folder is a
`.glink.card`, not synced), `drive-unmount-keeps-children`,
`drive-url-in-chat` (knows_directly: given a folder URL and "mirror this",
run `bbx drive mount <url> <dir>`, choosing or asking for the directory),
`drive-link-in-chat` (knows_directly: "keep a pointer to this" →
`bbx drive link`), `drive-trashed-child` (knows_about: a child trashed on
Drive ends up in `store/trash/`). Run with
`pnpm knowledge-audit run --box <abs test1 path> --filter drive-` and
record status comments. Note the existing BOX DRIFT comment
(`knowledge-audits.yaml:1988`) — test1 has no Drive fixture; the new audits
are answerable from skill text alone.

## What will hold this after it ships

- Connector doctests with the fake service (`connector-drive-folder.doctest.md`)
  cover discovery, recursion, shortcuts, trashed children, shared-drive
  flag, conversion from config. The decision core — "given a listing and the
  current tracking, which children to create/trash/skip" — is extracted as a
  pure function (`planFolderSync(listing, tracking): FolderPlan`) so the
  doctest tests the plan, and the IO shell stays thin (principle 10).
- CLI doctests for `mount`/`link`/`unmount`.
- Router doctests for `mounts`/`mount`/`unmount`/`syncFolder`.
- Frontend doctest for the gfolder renderer state column.
- Knowledge audits above.

## Implementation order

1. Track 1 chunk (schemas, tracking, fake fixtures, `planFolderSync`,
   connector reads cards). Depends on nothing.
2. Track 2 CLI commands; then config→card conversion. Depends on 1.
3. Track 3 router + settings + skill text + audits. Depends on 2.
4. Track 4 renderers + `syncFolder` mutation. Depends on 3.
5. Docs: rewrite `docs/google-drive.md` folder section; amend the
   2026-06-26 issue (done at plan time); close both issues at /finish.

## Rollout shape

Tests first: `connector-drive-folder.doctest.md` is written with the
`planFolderSync` cases before the connector change; done-when = it passes
plus the existing five drive doctests unchanged. Migration is the in-sync
conversion; atomic per config entry, idempotent, logged. Cross-model review
of this plan before chunk 1; cross-model review of the branch diff before
/finish. Focused runs only (drive doctests, typecheck, eslint on touched
files); full suite at /finish.

---
title: "Calendar cards and readable event filenames"
status: implemented
workstream: calendar-cards
issues:
  - ../../../issues/closed/features/2026-10-10-a-calendar-is-a-card-with-its-events-under-it.md
  - ../../../issues/closed/features/2026-09-17-calendar-ics-filenames-carry-the-title.md
  - ../../../issues/closed/exploration/2026-09-17-caldir-calendar-as-a-directory.md
---
# Calendar cards and readable event filenames

Each synced Google calendar becomes a `calendar` card in `_content/calendar/`,
with its events as `.ics` files in the card's attach folder, named by date and
title. A one-time migration renames and moves the existing files.

**Issues addressed:** the three in the frontmatter. The caldir exploration
issue closes as folded into the filename issue. Searched the queue for
`calendar`, `ics`, `eventFilename`: no other open item. Related, not closed:
[connectors as plugins](../../../issues/features/2026-10-15-connectors-as-plugins.md)
(shape A chosen, connectors stay core, so the schema lives in `src/schemas/`).

## Design

[calendar-cards.design.md](calendar-cards.design.md). Boxholder decisions
(2026-10-29): events stay `.ics`; one card per synced calendar with events in
its attach folder; existing files are renamed and moved once.

## Smallest fix and budget

Smallest fix for the reported problem: change `eventFilename`
(`src/connectors/google-calendar/ics.ts:327`) to add the slug, plus a rename
migration. About 300 lines. It fixes unreadable names but leaves no calendar
card, which the boxholder asked for.

Chosen design, estimated changed lines (additions plus deletions):

| Track | Source | Tests |
|---|---|---|
| A. Filename and calendar folders in the sync | 450 | 350 |
| B. `calendar` schema, card upkeep in the connector | 250 | 150 |
| C. Migration | 250 | 200 |
| D. Card page in the app | 200 | 50 |
| E. Agent guidance text | 60 | — |
| **Total** | **1,210** | **750** |

About 1,960 lines, close to the 2,000-line BIG CHANGE threshold. Most of the
test count is existing connector tests whose fixture paths change from
`_content/calendar/x.ics` to `_content/calendar/Work.attach/x.ics`. If the
measured change passes 2,000, I report the number to the boxholder before
continuing. Authored docs (calendar.md, this plan excluded): about 120 lines.

## Stated preferences this plan trades against

- **Calendar doc rule: "no existing file is ever renamed"**
  (`docs/connectors/calendar.md`, Storage). Broken on purpose by the boxholder
  decision. After this work a file is renamed when its event's date or title
  changes, plus the one-time migration. The doc says so.
- **Minimize invented concepts; prefer primitives** (boxholder memory). The
  calendar folder is the existing attach scope (`docs/glossary.md:40`:
  *"A directory named `<basename>.attach/` sitting next to a card with the same
  basename. Holds the card's attached files."*). No new folder convention.
- **`beebox/AGENTS.md` "no features beyond the task".** No event card, no
  per-event renderer, no CalDAV. See NOT in scope.
- **Fail closed** (bias toward strict). An `.ics` outside any calendar folder,
  or a calendar with tracked events but no card, is reported and skipped. It is
  never guessed into a calendar.
- **Precedent:** `gfolder-last-sync-2026-10`
  (`src/scripts/migrate/gfolder-last-sync/`) for a connector-state plus card
  migration; `email-thread` (`src/schemas/email-thread.tsx`) for a connector
  card whose source data sits in one block the connector rewrites.

## What already exists

- `sanitizeFilenameStem` (`src/shared/filename.ts:17`): strips non-word
  characters, spaces to `_`, caps length, fallback. Reuse for event slugs and
  card names. Note: `\w` without the `u` flag is ASCII only, so "Café" becomes
  "Caf". Accepted; it matches every other box filename.
- `uniqueEventFilename` (`event-index.ts:178`): keeps a current name when
  *"current === filename || current.startsWith(`${stem}_`)"*. Reuse unchanged;
  it now runs within one calendar folder.
- `loadCalendarState` / `saveCalendarState` (`state.ts`): load re-keys an old
  index on load. The migration uses them, so test1's unversioned index (no
  `version` key, 116 entries) is handled by existing code.
- `loadAllEvents(calendarDir, range)` (`utils.ts:233`): flat readdir, expands
  recurrence. Reuse per folder for the card page and the CLI.
- The strand path (`strand.ts`, `STRANDED_DIR = "stranded"`): joins
  `calDir` + `stranded`. Reuse with the calendar folder as `calDir`.
- `calendarRouter` (`src/webapp/trpc/routers/calendar.ts`): add one query.
- The state file is tracked in git (`git ls-files` in test1 lists
  `_bookkeeping/connectors/google-calendar-state.json`), so the migration's
  file moves and index rewrite land in one commit.

## Prior art (external)

caldir (https://caldir.org/) names files by date and title and keeps one
folder per provider. Evaluated only, already recorded in the exploration
issue. No design decision here depends on another external premise.

## Ontology

- **calendar card** (new): `_content/calendar/<Stem>.calendar.card`, type
  `calendar`. Identified by `google-calendar.id`. Fields:
  `google-calendar: { id, name, access, syncing }`. The connector rewrites
  that block; the body is the person's. Not an event list; it holds no events.
- **calendar folder** (existing primitive, attach scope):
  `_content/calendar/<Stem>.attach/`. Holds the calendar's event files and its
  `stranded/` folder.
- **event file** (existing): an `.ics` in a calendar folder. New name:
  `{YYYY-MM-DD}_{slug}_{shortId}.ics`; `{YYYY-MM-DD}_{shortId}.ics` when the
  title has no usable characters.
- **index entry** (`EventFileEntry`, `event-index.ts:50`): unchanged shape and
  key. `filename` now means "name within the entry's calendar folder" (was
  "name within `_content/calendar/`"). The migration rewrites every value, so
  no entry holds the old meaning afterwards.
- **calendar folder map** (new, in memory): `calendarId → folder path`, built
  each sync by reading the `*.calendar.card` files directly in
  `_content/calendar/`. Not stored, so moving a card and its folder together
  needs no index change.
- **stray event file** (new term): an `.ics` directly in `_content/calendar/`.
  Reported each sync, never pushed.

## Tracks / scope

### A. Filenames and calendar folders in the sync

**What.** Event names carry the title, and every pass reads and writes inside
the event's calendar folder.

**Why.** Names are unreadable (issue), and the boxholder chose one folder per
calendar.

**Direction.**
- `eventFilename(event)` returns `${date}_${slug}_${shortId}.ics`, with
  `slug = sanitizeFilenameStem(event.summary ?? "", { maxLength: 40, fallback: "" })`
  and the slug segment omitted when empty. Export `eventFileStem({ date,
  summary, eventId })` so the migration builds the same name.
- New module `calendar-folders.ts`: `loadCalendarFolders(boxRoot)` reads
  `_content/calendar/*.calendar.card`, parses each with the card parser, and
  returns `{ folders: Map<calendarId, absDir>, problems: CalendarSyncFailure[] }`.
  Two cards with one id is a problem; that calendar is skipped this sync.
- `connector.ts` builds the map before the per-calendar loop and passes
  `calDir = folders.get(calendarId)` into `runCalendarSync`. A configured
  calendar with no card: if the index holds no entry for it, track B creates
  the card and folder; if it does, report "calendar card missing for <name>,
  <n> tracked events; restore the card or remove the calendar in settings" and
  skip it.
- The passes that take one `calDir` and loop over the whole index
  (`processLocalDeletes`, `pushPendingLocalEdits`, `dropDuplicateFilenames`)
  take the map and resolve each entry's folder from `entry.calendarId`. An
  entry with no folder is skipped and reported once. `dropDuplicateFilenames`
  groups by `(calendarId, filename)`. Every check that asks "does another entry
  hold this name" is scoped to one calendar: `uniqueEventFilename` receives
  only that calendar's entries, and the orphan pass builds its tracked set per
  folder. Two calendars may hold the same basename.
- `pushAndCleanOrphans` loops over the folders. The target calendar is the
  folder's calendar. `X-BBX-CALENDAR-ID` in a file that disagrees with its
  folder is a failure, not a silent re-route. `defaultCalendarId` goes away.
  It also lists `_content/calendar/` itself and reports each stray `.ics`.
- `loadAllEvents` stays per directory. `bbx calendar` calls it once per
  folder in the map and merges.
- The connector refuses to sync (a failed sync naming the file) while the
  migration journal (track C) exists.
- Calendars removed from the sync set keep today's behavior: no pull, but
  local edits and new files in their folders are still pushed (the pending
  pass iterates the whole index today, `local-push.ts:212`). The card says
  "Not pulled from Google" for them, not "no longer syncing".

**Vocabulary lock-ins.** Filename shape above; `calendar-folders.ts`;
"stray event file" in failure text.

**First implementation chunk.** `eventFileStem` plus `eventFilename` in
`event-filename.ts` with tests (`event-filename.test.ts`): title with
punctuation, emoji-only title, missing title, long title, all-day date.
Done in the first commit.

### B. `calendar` schema and card upkeep

**What.** A card type, and the connector writing it.

**Direction.** `src/schemas/calendar.tsx`:
`cardSchema("calendar", { category: "synced", fields: { "google-calendar":
z.object({ id: z.string(), access: z.string().optional(), syncing:
z.boolean() }), body }, instructions })`. The calendar's Google name is the
card's global `title`, as `gfolder` stamps its Drive name
(`src/schemas/gfolder.ts:84`). `access` is optional because the migration may
not know it: the settings save rewrites the config with only `calendars` and
the window, dropping the cached `calendarRoles` (`calendar.ts` router,
`updateConfig`), and the next sync stamps it. Instructions:
events are `.ics` files in `<card basename>.attach/`; to add an event to this
calendar write an `.ics` there; reader calendars are read-only in Google; the
connector rewrites `google-calendar:`; do not edit it. Register in
`src/schemas.ts` and the frontend list registry.

Card upkeep runs once per sync, after the folder map: for each configured
calendar with no card and no index entries, create
`<sanitizeFilenameStem(name)>.calendar.card` (suffix `_2`, `_3` on a name
taken) and its folder. For each card, rewrite `google-calendar` from the
fetched calendar list, with `syncing` = "id is in `config.calendars`". Write
only when the bytes change, and add written card paths to the sync's commit
list. The card name is fixed at creation; a Google rename changes `title` only.

**First chunk.** Schema plus a test that a card parses and summarizes.

### C. Migration `calendar-folders-2026-10`

**What.** Script migration (shape of
`src/scripts/migrate/briefing-openers/run.ts`: plan the whole box, apply,
verify, exit 1 without writing on a plan failure). It is not atomic on disk;
the runner's snapshot is a recovery copy, not a rollback
(`docs/cards/migrations.md`, "Admission, snapshots, and failures"). Crash
safety comes from a journal and the connector's refusal to run while it
exists (Apply, below).

**Plan step.** A journal on disk is resumed first (Apply, below), before
any other check. Load config and index with the connector's own loaders; an
absent index is an empty one. No calendar directory: exit 0. Already migrated
(every entry's file exists inside a calendar folder and no `.ics` sits at the
top level): exit 0. Otherwise:
- One card per calendar id that appears in the index or in
  `config.calendars`, named from `config.calendarNames[id]` (the cached
  names; fallback: the id), `access` from `config.calendarRoles`, `syncing`
  from `config.calendars`.
- For each entry: new name = `eventFileStem` with the short id from the
  index key's event id (last eight characters, as `eventFilename` does), the
  title from the file's `SUMMARY` (`(no title)`, which `eventToIcs` writes for
  a missing title at `ics.ts:285`, counts as none), and the date from the
  current filename when it starts `YYYY-MM-DD_` or `no-date_`. The date is
  reused so the name matches what the pull computes from Google's
  `start.dateTime`. A tracked file under any other name (a pushed local event
  keeps its own name until a pull renames it, `push.ts:120`) takes the date
  from its `DTSTART` value as written. A calendar-hash suffix is dropped:
  inside one folder it no longer disambiguates anything.
- Untracked top-level `.ics` (a local event not yet pushed): move into the
  folder of its `X-BBX-CALENDAR-ID`, else of `config.calendars[0]` (today's
  push default, `connector.ts:255`), keeping its name.
- `(legacy)` entries: attribute by `X-BBX-CALENDAR-ID`
  in the file; none found fails the plan.
- Two moves planned onto one path fails the plan, and so does any
  destination that already exists on disk. Only a resumed journal accepts an
  occupied destination, and only for a move the journal records.
- Calendar names and roles come from the config cache; a missing role leaves
  `access` out.
- Files in an existing `_content/calendar/stranded/` move to the
  `stranded/` folder of the calendar their `X-BBX-CALENDAR-ID` names. A file
  with no provable calendar stays where it is and is listed in the output;
  the push scan never reads that folder.

**Apply.** Write the full plan (every move, every card, the new index) to a
journal, `_bookkeeping/connectors/google-calendar-migration.json`, atomically
(`writeFileAtomic`, as `state.ts:224` writes the index), before the first
change. Then write cards, move files without overwriting, save the new
index, delete the journal. A rerun that finds a journal resumes it: a move
whose source is gone and whose destination exists is done. While the journal
exists the connector refuses to sync, so a half-moved box is never read as
untracked files to insert into Google. File content is untouched, so every
recorded `contentHash` still matches, and a pending local edit (hash
mismatch) keeps its `pendingSince` and stays pending.

**Verify.** Re-run the plan's "already migrated" check; fail with exit 1 if
not converged.

**First chunk.** Planner as a pure function over `{ entries, files,
config }` with tests, before any fs code.

### D. Card page in the app

**Direction.** tRPC `calendar.cardEvents({ path, from, to })`: validates
`path` ends in `.calendar.card` under `_content/calendar/`, loads
`<stem>.attach/` with `loadAllEvents`, then `filterByDateRange` (the load
expands recurrence in range but keeps out-of-range single events, as the CLI
already handles at `cli/commands/calendar.ts:91`), and returns `{ start, end,
allDay, summary, location, file }[]` plus `unreadable: string[]`, the files
that did not parse. A folder that cannot be read (other than missing) is a
query error, not an empty list. The page shows unreadable files above the
list, so "No events" is only said for a complete read. A `calendar` renderer (priority 100, like
`renderers/person.tsx`) shows the name, "Read-only in Google" for reader
access, "Not pulled from Google" when `syncing` is false, then the next 30 days
grouped by day, each row linking to its file. Empty: "No events between
<from> and <to>." The card body renders through the existing card chrome.

### E. Agent guidance

Update `src/core/init-rules.ts:37` (`connector-calendar`),
`src/schemas/guide/templates.tsx:86-91`, and
`src/core/box/guidance-sync/skills/content.ts:22-31`: events live in a
calendar card's attach folder; to target a calendar write there;
`X-BBX-CALENDAR-ID` is no longer how to choose one. The rule's glob
`_content/calendar/**/*.ics` already matches the new paths.

## Could this be simpler?

Simplest version: readable filenames in the flat folder, plus calendar cards
beside the files that filter by `X-BBX-CALENDAR-ID` (about 700 lines). It
fails on two points the boxholder weighed when choosing folders: the folder
stays one mixed list of every calendar's events, and a new local event must
still name its calendar inside the file. The per-folder design also deletes
the calendar-hash disambiguator's reason to exist (two calendars no longer
share a folder), though the function stays as a cheap guard.

Not built: storing the folder in the index (the card scan already says it),
a per-event card, an `.ics` renderer.

## Subplans

None.

## Failure modes

| What can fail | Test exists? | Handling exists? | Clear-or-silent? |
|---|---|---|---|
| Pending local edit at migration time loses its pending state | New: migration test with a hash-mismatched file | Content untouched, hash kept | Clear (pushed next sync) |
| Migration date differs from pull's date, so the next pull renames again | New: planner reuses the filename date | Reuses date | Clear (one rename in a sync commit) |
| Title changes in Google | New connector test | Existing rename path (`unlinkRenamed`, `sync.ts:96`) | Clear (sync commit) |
| Local title edit pushed, then write-back renames | New connector test | `writeBackPushedEvent` with `fallbackFilename` (`sync.ts:137`) | Clear |
| Stray `.ics` at top level | New | New: failure per file | Clear |
| Two cards with one calendar id | New | New: skip calendar, failure | Clear |
| Configured calendar's card deleted, entries remain | New | New: skip, failure names the fix | Clear |
| `X-BBX-CALENDAR-ID` disagrees with folder on a new local file | New | New: failure, not pushed | Clear |
| Strand moves a file | Existing `google-calendar.stranded-edits.test.ts`, fixtures move | Strand into `<folder>/stranded/` | Clear |
| 410 refetch deletes a stale file | Existing `google-calendar.test.ts` 410 cases, fixtures move | `stale.ts` with per-calendar `calDir` | Clear |
| Recurring master in folder | Existing recurrence tests, fixtures move | Unchanged | — |
| Plan cannot place an entry | New migration test | Exit 1, nothing written | Clear |
| Crash mid-migration, then a sync | New | Journal; connector refuses | Clear |
| Migration destination occupied by other bytes | New | Plan fails | Clear |
| Same basename in two calendars, one untracked | New | Per-calendar tracked set | Clear |
| Daily series older than 500 occurrences shows nothing upcoming | No | No (`MAX_EXPANSIONS`, `utils.ts:177`) | Silent; existing, also in the CLI. Accepted here; file an issue |
| Crash after the index save, before the journal is deleted | New | Journal resumed before the already-migrated check | Clear |

No critical gap.

## Agent-flow / user-flow edge cases

- **Wrong field:** an agent sets `X-BBX-CALENDAR-ID` to another calendar than
  the folder. ADDRESSED: failure, not pushed (track A).
- **Stale ref:** a chat message names an old event path after the migration.
  DEFERRED: old paths in chat history stay broken. Accepted with the rename
  decision.
- **Two agents:** chat agent writes an `.ics` while the sync runs. Unchanged
  from today; the push pass reads whatever is on disk.
- **Hand-edit drift:** a person moves an event file between calendar folders.
  GAP accepted: the index still points to the old folder, so the file reads as
  untracked in the new folder and is pushed as a new event, and the entry's
  file is missing. Documented in calendar.md; moving between calendars is not
  supported.
- **A person renames a card and its folder together.** ADDRESSED: the folder
  map is rebuilt from cards each sync.
- **Validation UX:** a hand-broken card fails card lint with the schema
  message; the sync reports the calendar skipped.
- **Partial migration:** ADDRESSED by the journal and the connector refusal
  (track C, Apply). Test: interrupt after the moves, before the index save;
  the sync refuses; the rerun finishes.

## NOT in scope

- Events as cards. Boxholder decision 1.
- An `.ics` event renderer. The card page lists events; the file opens as
  text. Considered; a later issue if wanted.
- CalDAV or `.ics` subscription sources. The card's source block leaves room.
- Rewriting the calendar-id/name/role properties that old files carry under
  the pre-rename product prefix (test1 has them; nothing reads them). Changing content would read
  as a local edit. File an issue.
- Moving events between calendars by moving files.
- Timed stranding for a new local event Google keeps rejecting. Today it stays
  untracked and is reported each sync (`push.ts:157`); unchanged.
- The settings save dropping cached calendar names and roles. Existing; the
  sync restores them. File an issue.
- Cards outside `_content/calendar/`.

## Open design questions

None blocking. Card page range (30 days) is a default; easy to change.

## Knowledge audits

One `knows_directly` entry in `src/dev/knowledge-audits.yaml`: "To add an
event to the Family calendar, where do you write the file?" Expected:
`_content/calendar/Family.attach/`, no `X-BBX-CALENDAR-ID` needed. Run on the
migrated test1 copy.

## What will hold this after it ships

Unit tests for `eventFileStem` and the migration planner (pure functions).
Connector tests against the existing fake calendar service for the folder
passes. The existing stranded/410/push-failure suites, with fixtures moved,
hold the old behavior. No new tier.

## Implementation order

1. Track A chunk 1 (filename) and track B chunk 1 (schema). Commit.
2. `calendar-folders.ts` and the connector, push, local-push, stale, strand
   changes; existing tests migrated; new connector tests. Commit.
3. Card upkeep in the connector. Commit.
4. Migration planner, apply, registry entry, tests; dry run and apply on this
   worktree's test1 copy. Commit.
5. CLI, tRPC query, renderer. Commit.
6. Guidance text, calendar.md, knowledge audit. Commit.
7. Exhibit; cross-model code review.

## Rollout shape

Done when: the new tests above pass; the three existing calendar suites pass
with moved fixtures; `pnpm typecheck` and `pnpm layout-check` pass; the
migration applies on this worktree's test1 copy, `bbx validate` is clean, and
a second run reports nothing to do. Migration is scripted and atomic per box.
No compatibility reader is kept for the flat layout, so no deferred cleanup
issue is owed.

## Implementation notes (2026-10-29)

- Measured size: 2,025 changed source and test lines, about 2,200 with the
  calendar doc and filed issues. That passes the 2,000-line BIG CHANGE line
  the estimate (1,960) sat just under; reported to the boxholder for approval.
- Card stems from an address-named calendar (the primary calendar is named by
  its account address) turn `@` and `.` into separators
  (`calendarCardStem`), so `me@example.com` is `me_example_com`.
- An attach folder that exists without its card is adopted when the connector
  creates that calendar's card.
- The card list line shows "Read-only in Google" for reader calendars and
  nothing otherwise; the raw access role read as jargon.
- Cross-model code review (codex gpt-6-astra, verified by gpt-6-sol) found
  five defects, all fixed. Accepted residual: the card page's 30-day window
  compares all-day events as server-local midnights against the browser's
  window, so across zones an all-day event exactly at the window's edge can
  be included or left out by a day.
- The migration was applied to this worktree's test1 clone by running the
  script directly (`--apply`), because the clone has other pending migrations
  and an open migration question that `bbx engine migrate --apply` would act
  on. 116 events moved into 6 calendar folders; a second run reported
  "already current"; `bbx validate` passed on the cards.

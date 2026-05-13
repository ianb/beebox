# Implementation spec: `.attach/` directories

**Status:** Draft. Phase 1 of the cards-as-markdown RFC, but designed to ship independently of any body-format change.

**Goal:** Replace today's basename-pairing convention for card attachments (`Voice_Memo.memo.card` + sibling `Voice_Memo.m4a`) with explicit `Foo.attach/` directories. No change to the XML card format or to cardworks.

## The rule, restated

- Every card may have a sibling directory named `<basename>.attach/`.
- Files in `<basename>.attach/` belong to the card with that basename.
- Two cards in the same directory may not share a basename. Lint error.
- A literal directory named `attach/` is forbidden anywhere in the regular box tree (lint error). Inside `Foo.attach/` scopes the rule loosens.
- Underscore-prefixed directories inside `Foo.attach/` (e.g. `Foo.attach/_files/`) are conventionally opaque to lint and most queries — for when an agent or pipeline needs to dump unpacked content somewhere.

For phase 1 (XML cards), refs to attachments continue to use the bare filename: `<filename ref="photo-001.jpg">` continues to mean "the file called `photo-001.jpg` in this card's attachment scope." The schema declares which `ref` attributes are attachment paths; the resolver knows to look in `<basename>.attach/`. We do not introduce the `attach/` virtual prefix until phase 2 (body format change), so existing card content stays unchanged in shape — only the on-disk location of attached files moves.

(Reasoning for not introducing the virtual prefix in phase 1: it would require touching every card's ref values during the migration, doubling the migrator's surface. We can revisit during phase 2.)

## Non-goals

- No body format change (no Markdown, no Markdoc, no frontmatter). XML stays.
- No new schema authoring system (cardworks `element()` stays).
- No removal of cardworks. That's phase 2+.
- No `Foo.<type>.attach/` form (settled on basename-only).
- No backward-compat dual-mode beyond the migration window.

## Surfaces to change

### Cardworks (minimal or zero)

Cardworks' job is XML parsing, Zod validation, JSX, ref resolution **for cross-card refs**. Attachment paths today are just Zod strings in card schemas (`<filename>` element's `ref` attribute is typed as `z.string()` with no special resolution).

Phase 1 doesn't change what cardworks does. The application code that *uses* an attachment path is what changes (looks in `.attach/` instead of as a sibling).

**Possible small addition** (optional): a helper in `cardworks/fs/` or similar called `attachmentPath(cardPath, fileName) → string` that computes `<basename>.attach/<fileName>`. Centralizes the convention. Could live in callback-box instead. Lean toward callback-box — keep cardworks format-agnostic.

**Verdict:** zero cardworks changes for phase 1. If a helper for path computation feels needed, it lives in callback-box (`src/lib/attach-path.ts` or similar).

### Callback-box: file-walking and card loading

Today's loader (`cardworks/loader/loader.ts` and callers in `src/core/`) walks the filesystem and identifies cards. It needs to learn:

- When listing a directory's cards, treat `Foo.attach/` directories as opaque — don't recurse into them as if they were regular box content.
- When computing "what files belong to this card," include `<basename>.attach/**`.

Look at `src/core/CardLoader` (or wherever the file walker is) — needs an attachment-aware mode.

### Callback-box: schemas with attachment refs

Today's image, audio, file, doc, sheet schemas all use a `<filename ref="...">` (or `<filename>` element with a path-attr) pattern. None of these need schema changes for phase 1 — the ref stays a bare filename string. The application code that consumes that string is what looks in the new place.

Schemas to audit:
- `src/schemas/image.tsx` — `<filename ref="...">`
- `src/schemas/audio.tsx` — `<filename ref="...">`
- `src/schemas/file.tsx` — `<filename ref="...">`
- `src/schemas/doc.tsx` — `<content ref="...">` pointing at sibling `.md`
- `src/schemas/sheet.tsx` — `<sheet-tab ref="...">` pointing into sibling directory
- `src/schemas/email-message.tsx` — `<body-file>...</body-file>` + `<attachment ref="...">`
- `src/schemas/email-thread.tsx` — `<message-ref ref="...">` (NOT attachment-refs; cross-card to message cards)
- `src/schemas/capture-session.tsx` — child cards in the session dir; not strictly "attachments" today but become attachments under the new layout

For phase 1, schemas don't change. Resolution logic does.

### Callback-box: connectors

Connectors create cards with attachments. Each needs to put the file in `<basename>.attach/` instead of as a sibling:

- `src/connectors/capture.ts` (or wherever capture sessions land) — write `<photo-id>.image.attach/<photo-id>.jpg` instead of sibling `.jpg`
- `src/connectors/gmail.ts` — write `<msg-id>.email-message.attach/<msg-id>.body.txt` + `attach/attachments/...`
- `src/connectors/google-drive.ts` — already uses a subdirectory pattern for Sheets; rename `Budget/` → `Budget.attach/` (small change). For Docs, the sibling `.md` moves into `Foo.attach/<basename>.md`.
- `src/connectors/rss.ts` — news items don't have attachments today; no change.
- `src/connectors/google-calendar.ts` — `.ics` files; check if they're sibling to a card or standalone.
- `src/connectors/telegram.ts` — outbound messages; no attachments today.

For each connector, the change is small: replace path-to-sibling with path-to-attach-dir, and ensure the `.attach/` directory exists before writing.

### Callback-box: file-serving routes

The webapp serves attached files for the frontend (image renderer, audio player, download endpoints). Today these resolve `Foo.jpg` next to `Foo.image.card`. Under the new layout, they resolve `Foo.image.attach/Foo.jpg`.

Files to audit:
- `src/webapp/routes/*.ts` — anything serving a file by basename
- `src/webapp/routes/files.ts` (if it exists) or equivalent
- `src/webapp/routes/briefs.ts` — image references for newsletter rendering
- `src/webapp/routes/chat-uploads.ts` — chat attachment serving

### Callback-box: frontend renderers

The frontend renders attached files (images in image cards, audio players, file download links). Today they resolve sibling files. Under the new layout, they resolve into `.attach/`.

Files to audit:
- `src/frontend/src/renderers/image.tsx`
- `src/frontend/src/renderers/audio.tsx` (if exists)
- `src/frontend/src/renderers/directory.tsx` — how directory views show `.attach/` subdirs (likely hide them by default)
- `src/frontend/src/components/FileView.tsx` — file viewer
- `src/frontend/src/components/ChatMessages.tsx` — attached file display in chat
- `src/frontend/src/lib/view-url.ts` — URL construction for attached files

### Callback-box: `cb mv` and `cb rm`

Today's `cb mv Foo.memo.card destination/` moves the card and any sibling files with matching basename. Under the new layout, it must also move `Foo.attach/`.

Files: `src/cli/commands/move.ts`, `src/cli/commands/trash.ts` (and rm).

Change: after moving the card, check for `<basename>.attach/` in the source directory; if present, move it too, preserving its contents.

`cb mv` also rewrites refs across the box when a card moves (existing behavior for cross-card refs). The `.attach/` move is a separate operation — no ref rewriting needed for attachment paths (those are relative to the card's `.attach/`, which moves with the card).

### Callback-box: `cb validate` lint rules

New rules to add:

1. **No basename collisions in a directory.** Two cards with the same basename in the same directory is an error.
2. **No literal `attach/` directory outside attach scopes.** A directory named `attach/` anywhere in the regular box tree (not inside a `Foo.attach/` scope) is an error.
3. **Attachment ref resolves.** For each schema that has an attachment-path ref, validate the file exists in the card's `<basename>.attach/`. (Today's validators might already check sibling existence; the resolution target moves.)

Files: `src/cli/commands/validate.ts`, `plugins/card-validator/` (the pre-commit hook).

### Callback-box: doc-graph and source editor

Doc-graph builds a cross-card-link visualization. Today it walks card refs. Under the new layout, attachment refs that today appear as "this card references this sibling file" need to be re-rooted to the new attach location.

Files: `src/dev/` and `src/frontend/src/pages/doc-graph/` (or wherever it lives).

Source editor (file viewer for cards in the frontend) needs to understand that `.attach/` directories are part of a card's "scope" when displaying file relationships.

### Callback-box: tests and fixtures

All test fixtures that have cards with sibling attachments need updating:
- `test/**/*.doctest.md` — fixtures that create cards with attached files
- `src/test-lib/makeTmpBox` and friends — helpers for building test boxes
- `src/scenario/` — multi-step scenario fixtures

Each test that creates a card with an attachment now creates the `.attach/` directory too.

## Migration tooling

A migrator script (`scripts/migrate-attachments.ts` or similar) that walks an existing box and converts:

```
inbox/Voice_Memo.memo.card        →  inbox/Voice_Memo.memo.card
inbox/Voice_Memo.m4a              →  inbox/Voice_Memo.attach/Voice_Memo.m4a

inbox/scan-XX/photo-001.image.card    →  inbox/scan-XX/photo-001.image.card
inbox/scan-XX/photo-001.jpg           →  inbox/scan-XX/photo-001.attach/photo-001.jpg
inbox/scan-XX/photo-001-back.jpg      →  inbox/scan-XX/photo-001.attach/photo-001-back.jpg
```

Algorithm:

1. Walk every card under the box.
2. For each card, find sibling files matching `<basename>*` (excluding other cards).
3. Create `<basename>.attach/` if it doesn't exist.
4. Move matching siblings into `<basename>.attach/`.
5. For schemas that need it, ensure the `<filename ref="...">` value matches (no change for the bare-filename convention).

Edge cases:

- **Capture-session children:** The current layout has the session card + image cards + audio cards + binary files all as siblings in `scan-XXX/`. Under the new layout, the session's children (image cards, audio cards) become attachments of the session: `scan-XXX/scan-XXX.capture-session.card` + `scan-XXX/scan-XXX.attach/photo-001.image.card` + `scan-XXX/scan-XXX.attach/photo-001.attach/photo-001.jpg`. The migrator must handle nested attach dirs.
- **Multiple cards sharing the directory:** today's structure sometimes has same-basename-different-type. The lint rule forbids this going forward. The migrator should flag (not auto-fix) these as user-intervention-required.
- **Email-thread directories:** today they have `attachments/` as a literal sibling subdirectory inside the thread folder. Under the rule, `attachments/` is forbidden as a top-level directory but the thread folder is itself inside the box. Probably fine; `attachments/` is a child of the thread directory (`box/inbox/email/thread-X/attachments/`), not a top-level reserved name. Validate the rule doesn't accidentally trigger here.

The migrator should:

- Run in dry-run mode by default. Print proposed moves; require `--apply` to execute.
- Make a backup of the box before any moves (git commit, or filesystem snapshot).
- Be idempotent (running it again on a migrated box is a no-op).
- Produce a log of what moved.

### Migration tests

- Run the migrator on a clone of test1.
- Run the migrator on a clone of the ledger box.
- After migration, run `cb validate` against the result. No errors.
- After migration, run the scenario tests. They should pass (modulo updates to fixtures).

## Coexistence strategy during the transition

The migration is per-box, not per-card-type. A box is fully old-style or fully new-style. The application code that reads attachments needs to handle:

**Option A: support both layouts simultaneously during the transition window.** Resolution logic tries `<basename>.attach/<file>` first, falls back to sibling `<file>`. Sniffs which layout the box is in.

**Option B: hard cutover.** Application code only supports the new layout. Migration runs as part of the deploy that ships the new code; before the deploy, old code reads sibling files; after, new code reads `.attach/`.

Lean (B). It's simpler. The transition window is small (one deploy + migration step per box). The boxes I run are small in number and coordinated; this is feasible.

Actual rollout:

1. Ship new code (new resolution logic + migrator). New code initially fails to find attached files in unmigrated boxes — that's the prompt to migrate.
2. Run migrator on each box (test1 first, then ledger, etc.).
3. Validate. Run scenario tests. Live with it.
4. Remove any "look in old location" fallback code after a few weeks.

Realistically, a `--legacy-fallback` flag during the transition is cheap insurance. Resolve attachment: try `.attach/`, fall back to sibling, log a warning if the fallback hit. Remove the flag after the warnings stop firing.

## Test plan

### Unit tests

- File walker: given a directory with a card and `.attach/`, identifies them correctly.
- File walker: given a directory with two same-basename cards, raises lint error.
- File walker: given a real `attach/` directory in the tree, raises lint error.
- `cb mv` moves the `.attach/` along with the card.
- `cb rm` removes the `.attach/` along with the card.
- Migrator: round-trips a single card with attachments correctly.
- Migrator: handles nested attach dirs (capture-session case).
- Migrator: flags same-basename-different-type cases as needing intervention.

### Doctest fixtures

Update each doctest that creates a card with an attachment to use the new layout. Hopefully the test-lib helpers (`makeTmpBox`, `addCard`, etc.) can paper over the change so doctest sources don't need many edits.

### Scenario tests

The scenarios in `src/scenario/` are end-to-end multi-step tests. After migrating fixtures and the loader code, all should pass.

### Manual smoke tests

- Open test1 in the browser after migration. Image cards render. Audio cards play. File downloads work.
- Capture a new voice memo. Confirms the capture connector writes to `.attach/`.
- Run `cb wakeup`. Confirm no errors.
- Send a chat message with an attachment. Confirm `attach/` placement.

## Rollout phases (within phase 1)

Reasonable order to implement:

1. **Lint rules first** (basename collisions, reserved `attach/` directory). Cheap, no dependency on other changes. Add as warnings before they become errors so any existing violations surface during normal `cb validate`.
2. **Resolution helper** (`attachmentPath(cardPath, fileName)` in `src/lib/`) and a flag-gated mode that uses it.
3. **File walker + loader** updated to recognize `.attach/`.
4. **Migrator** drafted and tested against test1.
5. **Connectors** updated to write into `.attach/`. One at a time; capture is highest priority.
6. **Frontend renderers and routes** updated to resolve via the new helper.
7. **`cb mv` and `cb rm`** updated.
8. **Migrate test1**. Run all tests. Observe for a few days.
9. **Migrate other boxes** (ledger, etc.).
10. **Remove legacy-fallback** after warnings stop firing.

Total scope: probably 1-2 weeks of focused work for a single engineer, plus living-with-it time before declaring complete.

## Open questions

- **Capture-session restructuring.** Today's capture-session directory has children as direct siblings. The migration moves them into `<session>.attach/`. Does anything in the capture pipeline assume direct-sibling placement that would break? The `cb capture import` flow, the transcript-assembly step, the timeline generator — all need a quick audit.
- **Email-thread `attachments/` subdirectory.** Today's threads have `attachments/` as a literal directory name inside the thread folder. The reserved-`attach/` lint rule must not trigger on this (it's a child of the thread folder, not a top-level reserved name). Confirm the rule is correctly scoped.
- **Sheet `Budget/` directory.** Today's drive-sheets connector writes JSON tab files into a `Budget/` subdirectory next to `Budget.sheet.card`. The migration renames `Budget/` to `Budget.attach/` and the sheet's internal `<sheet-tab ref="Budget/Summary.csv" />` becomes `<sheet-tab ref="Summary.csv" />` (since refs are now within the attach scope). This is a per-card ref-rewrite the migrator needs to handle for sheet cards specifically.
- **Doc `.md` siblings.** Today's drive-docs connector writes `Project_Notes.md` next to `Project_Notes.doc.card`. The migration moves the `.md` into `Project_Notes.attach/Project_Notes.md`. The card's `<content ref="...">` value needs to be rewritten accordingly.

These per-schema ref-rewrites are the largest non-mechanical part of the migrator. Each schema with attachments needs a small adapter in the migrator that knows how to update its refs after the file move.

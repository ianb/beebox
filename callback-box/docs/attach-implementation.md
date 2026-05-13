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

Today's loader (`cardworks/loader/loader.ts` and callers in `src/core/`) walks the filesystem and identifies cards. **`.attach/` directories are not opaque** — they can contain real cards (a capture-session's children are image cards living inside its `.attach/`), and the walker must recurse into them normally to find every card in the box.

What the walker DOES need to know:

- A card's `<basename>.attach/` directory is conceptually part of that card's scope. "What files belong to this card" includes `<basename>.attach/**` recursively, including any nested cards and their own `.attach/` subdirectories.
- The lint rule that forbids a directory literally named `attach/` applies only outside an existing `.attach/` scope.
- Inside a `.attach/` scope, underscore-prefixed subdirectories (`Foo.attach/_files/`, etc.) are the actual opaque case — lint and most queries skip them. This is the escape hatch for "I just need to dump some files."

So the walker walks everything; only `_*` directories inside attach scopes get skipped. Regular `.attach/` contents (cards, attached files, nested attach dirs) are first-class box content.

Look at `src/core/CardLoader` (or wherever the file walker is) — needs scope-awareness for path resolution but no recursion-skipping for `.attach/` itself.

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

A migrator script (`scripts/migrate-attachments.ts` or similar) that walks an existing box and does **two coordinated passes**:

1. **File move pass.** Move sibling files into `<basename>.attach/` directories.
2. **Ref rewrite pass.** Walk every card and rewrite any ref that points at a path that was moved.

The ref rewrite is the larger, trickier piece. Refs to attached files exist in two forms today, and they migrate differently:

| Today's form | After migration | Rewrite needed? |
|---|---|---|
| `<filename ref="photo-001.jpg">` on the owning card (bare filename, implicit-sibling) | `<filename ref="photo-001.jpg">` (same) — but resolves to `<basename>.attach/photo-001.jpg` | **No.** Bare filename stays; resolution logic in the schema looks in `.attach/` now. |
| `<source ref="/box/inbox/scan-XX/photo-001.jpg">` on a different card (full path to a sibling-located file) | `<source ref="/box/inbox/scan-XX/photo-001.image.attach/photo-001.jpg">` | **Yes.** Cross-card refs that include the file's path break when the file moves; migrator must rewrite. |
| `<source ref="scan-XX/photo-001.jpg">` (relative path including dir) | `<source ref="scan-XX/photo-001.image.attach/photo-001.jpg">` | **Yes.** Same as above. |
| `<sheet-tab ref="Budget/Summary.csv">` on a sheet card pointing into its data dir | `<sheet-tab ref="Summary.csv">` — if we collapse the path into the attach scope | **Yes, schema-specific.** The sheet card today uses a subdirectory ref that's effectively an attachment path. The migrator needs to rewrite per-schema. |
| `<content ref="Project_Notes.md">` on a doc card pointing at its sibling .md | `<content ref="Project_Notes.md">` (same — bare filename stays under the same convention) | **No.** Same logic as `<filename>`: bare filename resolves into `.attach/`. |

### Algorithm

1. **First pass: build the move map.**
   - Walk every card under the box.
   - For each card, find sibling files matching `<basename>*` (excluding other cards). These are the files that will move into `<basename>.attach/`.
   - Record old-path → new-path for every file to be moved. Resolve paths to box-root absolute for unambiguous lookup.
   - Do not yet write anything.

2. **Second pass: ref rewrite plan.**
   - Walk every card again. Parse it. For each `ref="..."` attribute (and other ref-shaped attributes — `path`, `src`, `link` for older cards, etc.), check whether the resolved path appears in the move map.
   - If yes, record the rewrite: this ref in this card should change to the new path.
   - Per-schema adapters handle the cases that need more than a path substitution (sheet's directory-collapse, etc.).

3. **Third pass: validate the plan.**
   - Same-basename-different-type collisions in the same directory: flag, abort. The user must resolve manually before re-running.
   - Empty `.attach/` directories already present in the source: warn, leave alone.
   - Any ref that resolves to a path that DOESN'T exist in the source box: log as a dangling ref, don't rewrite. (These were already broken before migration.)

4. **Fourth pass: execute (under `--apply`).**
   - Move files in the order computed in pass 1 (creating `.attach/` directories as needed).
   - Write back updated card content for each card with rewritten refs.
   - Log everything.

### Edge cases

- **Capture-session children.** Today the session card + image cards + audio cards + binary files all as siblings in `scan-XXX/`. Under the new layout the children get **doubly-nested**: `scan-XXX/scan-XXX.attach/photo-001.image.card` + `scan-XXX/scan-XXX.attach/photo-001.attach/photo-001.jpg`. The migrator must handle this carefully — the photo's `.attach/` directory is nested inside the session's `.attach/` directory, and refs to the photo file may currently be `/box/inbox/scan-XX/photo-001.jpg` (becoming `/box/inbox/scan-XX/scan-XX.attach/photo-001.attach/photo-001.jpg`). Lots of path segments shift; rebuild the move map accordingly.

  Also check: do any internal refs in the session card itself (`<image-ref ref="photo-001.image.card">`) need updating? Today the session refs to children by bare filename ("relative to the session directory"). Tomorrow the children live inside `.attach/`, so the refs become `<image-ref ref="scan-XX.attach/photo-001.image.card">` — OR — we keep the bare-filename convention with schema-specific resolution that knows to look in the parent's `.attach/`. Lean toward the latter for the same reason we don't introduce the `attach/` virtual prefix in phase 1: minimum textual change to existing cards.

- **Email-thread internal `attachments/` dir.** Today threads have a literal `attachments/` subdirectory inside the thread folder. The reserved-`attach/` lint rule must not trigger on this — it's a child of the thread folder, not a top-level reserved name. The lint rule needs to be scope-aware: "no directory named `attach/` anywhere in the box tree" is the right phrasing for the rule, but the migration plan needs to either rename the email `attachments/` directory to avoid collision OR adjust the lint rule to permit non-`attach/`-named-but-similar-purpose directories.

  Cleanest path: rename `attachments/` to `attach/` during migration so it becomes a proper attach scope, then the email-message card's `<attachment ref="...">` refs follow the same convention as everywhere else. The lint rule then only forbids `attach/` literally named at the top level — actually, even more specifically, it forbids `attach/` outside of attach scopes. An `attach/` directory that's a child of a thread folder IS the email-message card's attach scope (or arguably the thread's). Subtle; needs a clean call during implementation.

- **Sheet's `Budget/` directory.** Today's drive-sheets connector writes JSON tab files into a `Budget/` subdirectory next to `Budget.sheet.card`. Migration renames `Budget/` to `Budget.attach/`, and the sheet's `<sheet-tab ref="Budget/Summary.csv" />` becomes `<sheet-tab ref="Summary.csv" />` (within the attach scope). Per-schema migrator adapter needed.

- **Doc's sibling `.md`.** Today the drive-docs connector writes `Project_Notes.md` next to `Project_Notes.doc.card`. Migration moves it into `Project_Notes.attach/Project_Notes.md`. The card's `<content ref="Project_Notes.md">` stays the same (bare filename convention).

- **Same-basename-different-type collisions.** Today's structure may have `Foo.memo.card` + `Foo.image.card` in the same directory. Lint forbids this going forward. The migrator should flag these as user-intervention-required and abort before any moves until they're resolved (rename one of them, or move one to a different directory).

### Behavior requirements

The migrator should:

- Run in dry-run mode by default. Print proposed moves and ref rewrites; require `--apply` to execute.
- Be wrapped in a git commit boundary — the box should be in a clean git state before running, and the migrator's output is a single commit (or refuses to run if the tree is dirty).
- Be idempotent (running it again on an already-migrated box is a no-op).
- Produce a structured log: every file moved (old → new), every ref rewritten (card path, old value, new value), every same-basename collision flagged.
- Support `--abort-on-collision` (default true) and `--allow-collisions` (skip those cards, migrate the rest) for the user to choose.

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

- **Capture pipeline assumptions.** The migration moves capture-session children into `<session>.attach/`. Does anything in `cb capture import`, the transcript-assembly step, or the timeline generator assume direct-sibling placement of image/audio cards under the session directory? Quick audit needed before migrating fixture-heavy areas.
- **Lint rule scope precision.** The reserved-`attach/` rule needs careful scoping. The intended rule: a directory literally named `attach/` is forbidden anywhere except as a card's attachment scope (i.e., `<basename>.attach/` where `<basename>.<type>.card` exists as a sibling). The email-thread case (where today there's an `attachments/` literal subdirectory) gets migrated to a proper `<msg-id>.attach/` and the rule applies cleanly. Confirm the rule's check is implementable without false positives.
- **Should the bare-filename convention extend to capture-session children?** Today the session card refs to children as `<image-ref ref="photo-001.image.card">` — relative to the session directory. After migration, photo-001.image.card lives in `scan-XX.attach/`. The cleanest answer is "bare basename within the parent's attach scope" — same convention as `<filename ref="photo-001.jpg">`. Schemas with refs-into-attach-scope use bare names; the resolution logic knows where to look. Confirm this works across all the capture-session-internal refs without weird edge cases.

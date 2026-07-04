# Implementation spec: `.attach/` directories

**Shipped differently than this draft describes.** The `.attach/` convention landed, but as part of the asset-manifest system rather than this XML/cardworks-era design (which predates the Markdown card format and the manifest's SHA-256 tracking). See `docs/asset-manifests.md` for the living doc.

**Status:** Draft. Phase 1 of the cards-as-markdown RFC, but designed to ship independently of any body-format change.

**Goal:** Replace today's basename-pairing convention for card attachments (`Voice_Memo.memo.card` + sibling `Voice_Memo.m4a`) with explicit `Foo.attach/` directories. No change to the XML card format or to cardworks.

## The rule, restated

- Every card may have a sibling directory named `<basename>.attach/`.
- Files in `<basename>.attach/` belong to the card with that basename.
- Two cards in the same directory may not share a basename. Lint error.
- A directory or file with the exact name `attach` (no extension, exact spelling) is forbidden anywhere in the box. Names like `attachments/` (email-thread's existing layout), `attach-things/`, etc. are fine — only the exact name `attach` collides.

(An earlier idea — treating `_`-prefixed subdirectories as opaque escape hatches — is **not** part of phase 1. Revisit later if a real use case emerges.)

### Refs use the `attach/` virtual prefix from day one

Refs to a card's own attached files use the `attach/` prefix:

```xml
<filename ref="attach/photo-001.jpg" captured="..." source="gallery"/>
```

The prefix is resolved by the resolver against the current card's `<basename>.attach/` scope. It's only meaningful as the first path segment of a ref value; mid-path occurrences (e.g. `store/captures/scan-XX.attach/photo-001.jpg`) are literal directory names.

Cross-card refs to another card's attached files use the full path (no `attach/` prefix, since that prefix means "this card's scope"):

```xml
<source ref="/box/inbox/scan-XX.attach/photo-001.image.attach/photo-001.jpg">
  ...
</source>
```

(Earlier draft of this spec kept bare filenames in phase 1 and deferred the prefix to phase 2. Reversed: the prefix is uniform from day one. The migrator updates ref values during migration; ref-rewriting is a centerpiece of the migration anyway, so adding the prefix is a small extra rewrite. The benefit: phase 2 doesn't have to introduce the prefix as a separate change, and the resolution logic is the same throughout.)

## Non-goals

- No body format change (no Markdown, no Markdoc, no frontmatter). XML stays.
- No new schema authoring system (cardworks `element()` stays).
- No removal of cardworks. That's phase 2+.
- No `Foo.<type>.attach/` form (settled on basename-only).
- No backward-compat dual-mode. Hard cutover; migration is the single transition.
- No rename of dumb terminology (the `<filename>` element name, etc.). Future cleanup.
- No underscore-prefix opaque-directory feature. Future possibility.

## Surfaces to change

### Cardworks (minimal or zero)

Cardworks' job is XML parsing, Zod validation, JSX, ref resolution **for cross-card refs**. Attachment paths today are just Zod strings in card schemas (`<filename>` element's `ref` attribute is typed as `z.string()` with no special resolution).

Phase 1 doesn't change what cardworks does. The application code that *uses* an attachment path is what changes (looks in `.attach/` instead of as a sibling).

**Possible small addition** (optional): a helper in `cardworks/fs/` or similar called `attachmentPath(cardPath, fileName) → string` that computes `<basename>.attach/<fileName>`. Centralizes the convention. Could live in callback-box instead. Lean toward callback-box — keep cardworks format-agnostic.

**Verdict:** zero cardworks changes for phase 1. If a helper for path computation feels needed, it lives in callback-box (`src/shared/attach-path.ts` or similar).

### Callback-box: file-walking and card loading

Today's loader (`cardworks/loader/loader.ts` and callers in `src/core/`) walks the filesystem and identifies cards. **`.attach/` directories are not opaque** — they can contain real cards (a capture-session's children are image cards living inside its `.attach/`), and the walker must recurse into them normally to find every card in the box.

What the walker DOES need to know:

- A card's `<basename>.attach/` directory is conceptually part of that card's scope. "What files belong to this card" includes `<basename>.attach/**` recursively, including any nested cards and their own `.attach/` subdirectories.
- The lint rule that forbids a directory literally named `attach/` applies only outside an existing `.attach/` scope.

The walker walks everything. Regular `.attach/` contents (cards, attached files, nested attach dirs) are first-class box content.

Look at `src/core/CardLoader` (or wherever the file walker is) — needs scope-awareness for path resolution. No recursion-skipping for `.attach/`.

### Callback-box: schemas with attachment refs

Schemas don't need structural changes for phase 1 (refs are still strings, still validated as `z.string()`), but the content of refs changes — values pointing at attached files get the `attach/` prefix.

Schemas to audit:
- `src/schemas/image.tsx` — `<filename ref="attach/photo-001.jpg">` (was bare filename)
- `src/schemas/audio.tsx` — `<filename ref="attach/audio-001.webm">`
- `src/schemas/file.tsx` — `<filename ref="attach/source.pdf">`
- `src/schemas/doc.tsx` — `<content ref="attach/Project_Notes.md">`
- `src/schemas/sheet.tsx` — `<sheet-tab ref="attach/Summary.csv">` (was `Budget/Summary.csv`)
- `src/schemas/email-message.tsx` — `<body-file>attach/msg-001.body.txt</body-file>` + `<attachment ref="attach/attachments/foo.pdf">`. Note: `attachments/` inside an attach scope is fine (the exact-name-`attach` rule applies to literal `attach`, not `attachments`).
- `src/schemas/email-thread.tsx` — `<message-ref ref="attach/msg-001.email-message.card">` (children moved into thread's attach scope, like capture-session)
- `src/schemas/capture-session.tsx` — `<image-ref ref="attach/photo-001.image.card">` (children moved into session's attach scope)

Templates (`createXxxTemplate()` functions) in each schema emit the `attach/`-prefixed refs by default.

The "filename" element-name is dumb terminology for what's really an attachment ref. Could be renamed to `<image-ref>`, `<source-ref>`, etc. **Not part of phase 1** — the rename is invasive and unrelated to the attachment layout work. Leave the existing name.

### Callback-box: connectors

Connectors create cards with attachments. Each needs to put the file in `<basename>.attach/` instead of as a sibling:

- `src/connectors/capture.ts` (or wherever capture sessions land) — write `<photo-id>.image.attach/<photo-id>.jpg` instead of sibling `.jpg`
- `src/connectors/gmail.ts` — write `<msg-id>.email-message.attach/<msg-id>.body.txt` + `attach/attachments/...`
- `src/connectors/google-drive.ts` — already uses a subdirectory pattern for Sheets; rename `Budget/` → `Budget.attach/` (small change). For Docs, the sibling `.md` moves into `Foo.attach/<basename>.md`.
- `src/connectors/google-calendar.ts` — `.ics` files; check if they're sibling to a card or standalone.
- `src/connectors/telegram.ts` — outbound messages; no attachments today.

For each connector, the change is small: replace path-to-sibling with path-to-attach-dir, and ensure the `.attach/` directory exists before writing.

### Callback-box: file-serving routes

The webapp serves attached files for the frontend (image renderer, audio player, download endpoints). Today these resolve `Foo.jpg` next to `Foo.image.card`. Under the new layout, they resolve `Foo.image.attach/Foo.jpg`.

Files to audit:
- `src/webapp/routes/*.ts` — anything serving a file by basename
- `src/webapp/routes/files.ts` (if it exists) or equivalent
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

Today's `cb mv Foo.memo.card destination/` moves the card and any sibling files with matching basename. Under the new layout, it moves the card + `Foo.attach/` + everything inside `Foo.attach/` (recursively, including nested cards and their own attach scopes).

Files: `src/cli/commands/move.ts`, `src/cli/commands/trash.ts` (and rm).

What `cb mv` does:

1. Move the card file.
2. If `<basename>.attach/` exists, move the entire directory tree along with it.
3. Walk every card inside that attach tree recursively. For each one, recompute its own attach-scope location (since the parent moved). Card refs WITHIN the moved subtree (between cards inside the same attach scope, or pointing at non-card files in the attach scope) don't need rewriting — they were relative and stay correct.
4. Update cross-box refs that point INTO the moved subtree from outside. The existing cross-card-ref rewriting handles cards (`<message-ref ref="...">`-style refs). Non-card files inside the attach scope can also be referenced from outside (`<source ref="/box/.../photo.jpg">` in a record card), and those refs need rewriting too.

`cb mv` already rewrites cross-card refs today; the new piece is rewriting refs to non-card files inside attach scopes. Non-cards get moved as part of the directory copy without special tracking; the ref-rewrite pass updates references to their old paths.

### Frontend: cards with attachments appear as directories

In the UI, a card that has a `.attach/` directory is rendered as a navigable directory — you go INTO the card to see its attachments and any nested cards. The `.attach/` directory itself is not shown as a separate UI element; it's an implementation detail.

This matters because:
- Cards can contain nested cards (capture-sessions contain image cards; threads contain message cards). Browsing has to surface those.
- "What's inside this capture session" should be a natural navigation step, not "go into the session folder, then into the attach subfolder, then look at the image cards."
- The user model is "this card has these attached things," which the UI reflects directly.

Affected files:
- `src/frontend/src/components/FileView.tsx` (and the file-listing UI) — render card files with attachments as directory-like entries
- `src/frontend/src/renderers/directory.tsx` — when listing a directory's contents, treat `Foo.attach/` as folded into `Foo.<type>.card`
- The browse UI, tree views, breadcrumbs — should describe paths in terms of card-containment, not literal `.attach/` segments
- `src/frontend/src/lib/view-url.ts` — URLs for "inside a card" can use the card's path; attach-scope is implicit

### Prompt and doc language: "card attachments"

Throughout prompts, generated docs, agent instructions, and `CLAUDE.md` mentions, the user-facing terminology is "card attachments" — never "attach directory" or "the `.attach/` folder."

The disk layout is implementation detail. The conceptual model: cards have attachments. When the agent reads a description of how to attach a file to a card, that description talks about attaching it to the card, not creating a `.attach/` directory.

Files to audit:
- Per-card-type `instructions` strings in schemas
- `docs/generated/` outputs (driven by schema instructions)
- `docs/box-layout.md`
- `CLAUDE.md` Cards section
- Any in-code agent prompts that mention attachments

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

A migrator script (`scripts/migrate/attachments.ts` or similar) walks an existing box and does **two coordinated passes**:

1. **File move pass.** Move sibling files into `<basename>.attach/` directories.
2. **Ref rewrite pass.** Walk every card and rewrite any ref that points at a path that was moved — including both refs to attached files within the same card (now `attach/<file>`) and cross-card refs that included the old absolute or relative path.

All refs to attachments change shape during migration; nothing stays textually the same:

| Today's form | After migration | Rewrite |
|---|---|---|
| `<filename ref="photo-001.jpg">` on the owning card (bare filename) | `<filename ref="attach/photo-001.jpg">` | Add `attach/` prefix. |
| `<source ref="/box/inbox/scan-XX/photo-001.jpg">` on a different card (full path) | `<source ref="/box/inbox/scan-XX.attach/photo-001.image.attach/photo-001.jpg">` | New full path through nested attach scopes. |
| `<source ref="scan-XX/photo-001.jpg">` (relative path) | `<source ref="scan-XX.attach/photo-001.image.attach/photo-001.jpg">` | Same kind of rewrite. |
| `<sheet-tab ref="Budget/Summary.csv">` (subdir-based) | `<sheet-tab ref="attach/Summary.csv">` | Collapse the subdirectory into the attach scope. |
| `<content ref="Project_Notes.md">` (sibling) | `<content ref="attach/Project_Notes.md">` | Add `attach/` prefix. |
| `<image-ref ref="photo-001.image.card">` inside a capture session (sibling card in session dir) | `<image-ref ref="attach/photo-001.image.card">` | Add `attach/` prefix; the child cards move into the session's attach scope. |

### Filename-based heuristics for ref rewrites

Most attached filenames are unique within their card or within the box (`photo-001.jpg`, `audio-001.webm`, etc.). When the migrator rewrites a ref, it can:

1. Resolve the old ref to its old filesystem path.
2. Look up that path in the move map.
3. If it's there, rewrite the ref to point at the new location.

For ambiguous cases (multiple files with the same name in the box, or refs that don't cleanly resolve), the migrator can:
- Match by filename plus nearby context (the card's location, the schema field's expected scope)
- Fail loudly with diagnostics if it can't decide

The user's stance: don't pre-empt unusual cases. If migration fails on a real box, diagnose and fix the specific case at that point. The migrator's job is to handle the easy cases automatically and produce clear errors for the edge cases.

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

- **Capture-session restructure.** Today: `inbox/scan-XXX/` (directory) containing `scan-XXX.capture-session.card` + child image/audio/file cards + their binaries, all as siblings. New: `inbox/scan-XXX.capture-session.card` + `inbox/scan-XXX.attach/` containing the children. **The wrapper `scan-XXX/` directory goes away** — the session card lives at the inbox level alongside its attach scope. Not doubly nested; the depth is the same as today (`inbox/scan-XXX.attach/photo-001.image.card` matches today's `inbox/scan-XXX/photo-001.image.card`).

  Internal refs in the session card (`<image-ref ref="photo-001.image.card">`) get rewritten to `<image-ref ref="attach/photo-001.image.card">`. Same `attach/` prefix as everywhere else.

  The capture connector and any code that creates capture sessions needs to write to this new layout, not the wrapped form.

- **Email-thread internal `attachments/` dir.** Already fine: the exact-name lint rule only forbids literal `attach`. `attachments/` is a different name and doesn't trigger. No migration needed for the directory name.

  The migrator does update refs inside email-message cards to use `attach/` prefix for things that move into the message's attach scope, but the `attachments/` subdirectory of a thread stays as-is.

- **Sheet's `Budget/` subdirectory.** Today's drive-sheets connector writes JSON tab files into a `Budget/` subdirectory next to `Budget.sheet.card`. Migration moves the contents into `Budget.attach/`, and the sheet's `<sheet-tab ref="Budget/Summary.csv" />` becomes `<sheet-tab ref="attach/Summary.csv" />`. Per-schema migrator adapter for sheet.

- **Doc's sibling `.md`.** Today the drive-docs connector writes `Project_Notes.md` next to `Project_Notes.doc.card`. Migration moves it into `Project_Notes.attach/`, and the card's `<content ref="Project_Notes.md">` becomes `<content ref="attach/Project_Notes.md">`.

- **Same-basename-different-type cases.** The lint rule forbids `Foo.memo.card` + `Foo.image.card` in the same directory going forward. In practice the user expects these to be rare — and when they exist, they're probably patterns where one card should be attached to the other rather than a peer collision. Strategy: let the migrator fail loudly when it hits a collision, diagnose the specific case, fix it (relocate one card, or convert the pairing to a card-with-attachment), re-run.

### Behavior requirements

The migrator should:

- Run in dry-run mode by default. Print proposed moves and ref rewrites; require `--apply` to execute.
- Be wrapped in a git commit boundary — the box should be in a clean git state before running, and the migrator's output is a single commit (or refuses to run if the tree is dirty).
- Be idempotent (running it again on an already-migrated box is a no-op).
- Produce a structured log: every file moved (old → new), every ref rewritten (card path, old value, new value), every error.
- Fail loudly on basename collisions, ambiguous refs, or other unhandled cases. No silent skipping. Better to abort and have the user fix the specific case than to silently produce a partly-migrated box.

### Migration tests

- Run the migrator on a clone of test1.
- Run the migrator on a clone of the ledger box.
- After migration, run `cb validate` against the result. No errors.
- After migration, run the scenario tests. They should pass (modulo updates to fixtures).

## Cutover strategy

**Hard cutover. No legacy fallback.** Code only supports the new layout. The migration step is the cutover: before migration, a box uses the old layout and old code; after migration, both are new.

Rollout approach:

1. **Build the code on a branch** — walker, resolver, schemas (templates emit `attach/` prefix), connectors (write to `.attach/`), `cb mv`/`cb rm`, lint rules, frontend renderers, card-as-directory UI, migrator script.
2. **Test the migrator on real boxes** — clone test1, run migrator, run tests, run UI, exercise the system. Revert the test clone or just delete it. Same for ledger-box clone.
3. **Iterate on bugs and edge cases** — every failure surfaces something the migrator should handle or a piece of code that wasn't updated. Fix and re-test.
4. **Real cutover** — once the code feels solid and migrator runs cleanly on real boxes, do the final migration: deploy the new code, run migrator on each box, commit the result. Single coordinated step per box.

No phased dual-mode. No "look in both places" fallback. The migration is a one-time event that moves the box from old layout to new.

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

Reasonable order to implement (all on a branch, no production rollout until step 9):

1. **Resolution helper** for the `attach/` virtual prefix. A small util in `src/shared/attach-path.ts`: parse `attach/<file>` refs against a current-card context. Used everywhere attached files are resolved.
2. **File walker + loader** updated to recognize `.attach/` directories as part of card scope (still walks them; not opaque).
3. **Lint rules**: basename collisions in same directory, exact-name `attach` forbidden in box tree.
4. **Schemas and templates** updated: `createXxxTemplate()` functions emit `attach/`-prefixed refs.
5. **Connectors** updated: capture, gmail, google-drive, telegram (etc.) write files into `.attach/` and emit `attach/`-prefixed refs in cards they create. Capture is the highest-stakes connector; do it first.
6. **Webapp routes and frontend renderers** updated to use the new resolution helper.
7. **Card-as-directory UI**: cards with `.attach/` appear as navigable directories in the frontend; `.attach/` itself is hidden as a separate entity.
8. **`cb mv` and `cb rm`** updated to recurse over attachments (move card + attach scope + nested cards together; rewrite cross-box refs to non-card files in the attach scope).
9. **Migrator** drafted and tested against clones of real boxes (test1 first, then ledger). Iterate. Revert the test clones after each run.
10. **Real cutover**: deploy code, run migrator on each box. Done.

Pinned for after phase 1 (not blocking):
- **Knowledge test**: the agent should have first-order understanding of the attachment system — what attachments are, how to reference them, how to attach a file to a card. Update agent-facing docs, `CLAUDE.md`, per-card-type schema `instructions` strings, and any prompts that touch cards. Doable in parallel with the migration but flagged here so it doesn't get forgotten.

## Open questions

- **Capture pipeline assumptions.** The capture connector and its downstream processors (`cb capture import`, transcript-assembly, timeline generator) currently assume the session-wrap-directory layout (`inbox/scan-XXX/`). Audit for any code that expects to walk children as direct siblings of the session card. Decision (already made): drop the wrap directory; session card lives at the inbox level alongside its attach scope. Update the capture pipeline accordingly.

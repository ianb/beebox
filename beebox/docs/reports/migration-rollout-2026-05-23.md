# Migration rollout, May 2026, and retired migrators

Frozen 2026-09-25 from `docs/migrations.md`. The 2026-05-23 production
rollout of the XML-to-frontmatter migrators, the later dated rollouts, and
the two retired migrators whose names stay registered as no-ops. The current
runbook is [card migrations](../cards/migrations.md). Do not update in place.

## Production rollout history (box.example.com)

For reference. May 23–24, 2026.

1. Pushed migrators + `bbx migrate` to GitHub; post-commit hook deploys to `/opt/beebox/beebox/`.
2. Stopped `beebox-serve` + `beebox-scheduler` to avoid races.
3. Per-box backup: pre-migration commit SHA + a compact tar (text-only) into `/home/beebox/backups/pre-migration-<timestamp>/`. The card data is already in git; the tar is belt-and-suspenders for non-git state.
4. For each box: seeded the manifest (sometimes partially for legacy boxes), ran `bbx migrate --apply`, committed.
5. Some boxes hit pre-commit validation blocks from pre-existing data drift (broken refs, malformed templates). Cleaned those up via `scripts/clean-broken-refs.ts` plus hand-fixes; see commit history.
6. Restarted services.

Residual data fixes that were one-offs (won't apply to other boxes):

- `personal/config/main.personality.card` `<boxholder ref="...">` attr restored after the personality migrator dropped it. Migrator fixed to preserve.
- `hearth/Test_Timer*.memo.card` had `<memo created="...">` attr instead of a `<created>` child. Hand-converted; the migrator was not extended (one-off shape).
- `personal/store/beebox/beebox-interaction-primitives.memo.card` legacy `<card type="memo">` root. Hand-converted.
- Ledger's eulogy `.md` moved into a proper `.attach/` scope; trash duplicate removed.
- Several boxes had `Box.landmark.card` with `<label>` / `<symbol>` directly under `<landmark>` instead of inside `<navigation>`. Wrapped via perl one-liner.
- Ledger had two `*.email-outbound.card` files still in XML (no migrator existed for that type). Hand-converted to YAML.

## `todo-list-to-doc` (retirement — todo-list → doc + `{% todo %}`)

Registered after `retire-process-captures`. Converts every `*.todo-list.card`
into a sibling `*.doc.card` (same basename): `name` → `title`, `details` →
opening body paragraph, `items[]` → a markdown list with each item wrapped in
`{% todo %}…{% /todo %}` (status mapped pending→open/done/`status="dropped"`
for cancelled/`status="parked"` for deferred; nested `items` → indented
sub-lists; item `completed`/`agent-notes` preserved as trailing parenthetical
text inside the wrapper so nothing is silently dropped), card-level
`agent-notes` → a trailing blockquote. Rewrites any other card/markdown/view
that referenced the old path via the same resolution-based machinery `bbx mv`
uses (`rewrite-card-refs.ts`). Superseded by the universal `{% todo %}`
annotation (`docs/implemented-plans/todo-annotation.md`); see
`scripts/migrate/todo-list-to-doc.ts` (pure transform) and
`scripts/migrate/todo-list-to-doc-run.ts` (CLI driver) for the full mapping.
Idempotent: a box with no `*.todo-list.card` files is a clean no-op.

## `document-to-pdf` (rename — `document` → `pdf`)

Registered at the end of `MIGRATIONS`. Renames every `*.document.card` to
`*.pdf.card` (the type comes from the filename, so the rename is the type
change — no frontmatter edit) and rewrites inbound `.document.card`
references across every `.md`/`.card` file in the box. `document` collided
with the unrelated `doc.card` type, and the pipeline only reads PDFs today,
so the generic name (chosen to avoid a future rename — see
`docs/implemented-plans/scanner-ingest.md`, Track 4) bought nothing. Modeled on
`gsheet-rename.ts`: no XML variant exists to guard against (the type
post-dates the XML→frontmatter migration), so it's a pure rename + ref
rewrite, same shape as `gsheet-rename`. See
`scripts/migrate/document-to-pdf.ts`. Idempotent: a box with no
`*.document.card` is a clean no-op.

## `v2-refs-to-v3` (repair — v2-layout refs to v3 paths)

Registered just before `filename-attach-scope`. The one-root migration moved
every file but left some box-absolute refs in v2 form (`/store/archive/…`),
which the box namespace fence now refuses. For each such ref in a card or
`.md` file, the migrator maps the path with `mapV2Path` (the table the files
were moved with) and rewrites the ref only when the mapped target exists and
lies inside the box namespace. The query and fragment are kept; fenced code
examples are left alone. Refs whose target is gone stay as they are, and
`bbx validate` keeps reporting them as broken. See
`scripts/migrate/v2-refs-to-v3.ts`. Idempotent: a rewritten ref resolves.

## `filename-attach-scope` (repair — flat media files into attach scopes)

Registered at the end of `MIGRATIONS`. Old capture archives kept media in a
flat layout: `photo-004.jpg` beside `photo-004-<title>.image.card`, with
`filename.ref` holding the photo's path instead of `attach/photo-004.jpg`.
Every `filename.ref` reader accepts only the `attach/` form, so those cards
showed "Failed to load". For `image`, `audio`, `file` and `pdf` cards the
migrator moves the file into `<card name>.attach/` and rewrites the card's
own refs to `attach/<file>`; other cards, `.md` files and views that name
the file follow the move in their own style.

It is best effort. A card is repaired only when its file is certain: the ref
resolves to a file in the card's own directory (or is dangling and a file
with its basename is there — the damage an old `bbx mv` left), the file is
not a card, no other media card claims it, and the destination is free or
holds the same bytes. Every other card is printed with a reason and left
unchanged, and the exit code stays 0. `bbx validate` warns on each remaining
card, so an agent can finish them. See
`scripts/migrate/filename-attach-scope.ts`. Idempotent: repaired cards hold
`attach/` refs and are skipped.

## `one-root` (shape migration — v2 two-root → v3 one-root layout)

Registered at the end of `MIGRATIONS`, but unlike every migrator above it,
`one-root` runs against a box that ISN'T v3 yet — the v3 engine refuses v2
boxes outright (`getBoxShape`), so `bbx migrate` has a bootstrap path
(`src/cli/commands/migrate-bootstrap.ts`) that probes for a v2 box
(`src/core/migrations/one-root-v2-probe.ts`, tolerant of the pre-v3 marker)
and hands it straight to `src/core/migrations/one-root-run.ts`'s
`runOneRootMigration`, entirely outside the normal manifest-driven `pending`
loop (a v2 box has no `_config/migrations.jsonl` yet — the migration MOVES
that file into existence as part of converting `content/config/` →
`_config/`). See `docs/implemented-plans/one-root-box-layout.md` Track E for the full
design. In order: preflight (clean tree, no running-process lock files, the
v2 package root's own closed-vocabulary check); `git mv` every `content/`
file per `src/core/migrations/one-root-mapping.ts`'s table (exhaustive,
`assertNever`-terminated over the frozen v2 layout); `content/CLAUDE.md`
merges into the root `CLAUDE.md` instead of moving; `.beebox/` moves by
filesystem rename (gitignored runtime state, not git); marker bumped to
`shapeVersion: 3`; `.gitignore`/`.gitattributes` regenerated (reuses
`initBox`); every card/doc's refs rewritten to canonical `/`-form
(`one-root-ref-rewrite.ts`, YAML-aware — unlike `bbx mv`'s rewriter it DOES
handle inline-map `refs:` forms, since a migration commit reorders
frontmatter keys everywhere anyway); a hard link gate
(`one-root-link-gate.ts`) refuses to commit if the rewrite left any
reference dangling; the full `bbx init` tail regenerates rules/guides/docs/
search index; `hub.json`/`boxes.json` entries pointing at the old
`<root>/content` path are corrected. Everything lands in exactly ONE commit
(`migrate: one-root`) — a `git reset --soft` to the pre-migration SHA folds
in `bbx init`'s own incidental provisioning commit before the final commit,
so the plan's "one migration, one commit" holds even though the reused
init tail commits on its own. Rollback on ANY failure: rename `.beebox`
back under `content/`, `git reset --hard` + clean to the pre-migration SHA
— nothing commits until the very end, so this always fully undoes the
attempt. The bootstrap path (everything v2-shape-aware) is scheduled for
removal once the fleet has converged — see
`issues/deferred/2026-09-04-remove-one-root-v2-bootstrap.md`.

## `box-packageify` (retired — v2-assert no-op)

`box-packageify` used to convert a whole box in place from the old flat
(shapeVersion 1) layout into the v2 package layout. Every box is now v2, so the
conversion is gone: `scripts/migrate/box-packageify.ts` is now an **idempotent
no-op** (it asserts the box is a valid `shapeVersion === 2` package and exits 0,
or fails loud otherwise), and the 537-line converter logic, its smoke script, and
its doctests were deleted with the v1 shape (see
`docs/implemented-plans/remove-box-shape-v1.md`).

The name is kept deliberately. `_config/migrations.jsonl` is **append-only** and
`src/core/migrations.ts` is the ordered canonical list `bbx migrate` compares it
against — dropping a name that boxes have already recorded as applied would make
their manifests reference a migration the engine no longer knows, breaking the
invariant. A registered no-op preserves it: already-migrated boxes match, and a
box that never recorded it runs a harmless v2-assert.

## `retire-process-captures` (prune — retired pipeline cleanup)

`scripts/migrate/retire-process-captures.ts` is a **prune**, not a card
conversion: it removes the retired `process-captures` procedure card and its
one-shot trigger from a box, because `installProcedures` only ever adds/updates
template files — it never prunes — so deleting the template upstream leaves the
stale copies behind on every already-initialized box, now calling deleted `bbx`
commands (a wakeup-time failure). Behavior worth knowing:

- **Hash-gated delete vs. park.** `config/procedures/process-captures.procedure.card`
  is deleted only when its content hash matches one of the shipped stock versions
  enumerated in the script (`SHIPPED_PROCEDURE_HASHES` — the same canonical form
  `installTemplateFile` compares: raw bytes, since a procedure card has no
  `normalize`/`boxOwnedFields`). A boxholder-**modified** copy is not destroyed —
  it's parked to `config/_template-updates/config/procedures/…` (the standard
  template-review location) and cleared from the active procedures dir so it stops
  firing the deleted commands. Recompute/extend the hash list from
  `git show <ref>:beebox/templates/procedures/process-captures.procedure.card | shasum -a 256`.
  **Expect PARK on long-lived boxes, and treat it as success:** only two
  frontmatter-era template versions ever shipped, and box-side migrations
  (the XML→frontmatter card conversion, box-packageify) rewrote installed
  copies in place — so any box older than 2026-06-18, or migrated since,
  won't byte-match a shipped hash even if the boxholder never touched the
  card (observed on test1: parked, correctly). The parked file needs no
  merge work — review it for custom steps worth keeping, then delete it.
- **The trigger** (`config/schedules/process-captures.scheduled-script.card`) is
  auto-generated box state (never boxholder-authored) and always broken once the
  procedure is gone, so it's removed whenever present.
- **Legacy inbox capture-session cards are intentionally left in place.** In-flight
  `*.capture-session.card` files in `box/inbox/` (including the prod retry-loop
  victim, `issues/closed/bugs/2026-07-07-capture-pipeline-retries-broken-capture-forever.md`)
  stay as ordinary cards for the normal triage/agent flow — they are legacy data,
  not something this migration touches.
- Idempotent: a box with neither file (already retired, or one that never had the
  pipeline) is a clean no-op.

# Box Migrations

How box data migrations work, how to apply them, and how to write new ones.

A migration is a one-shot transformation of card data on disk — schema renames, field strips, layout flips, refactors. The system tracks which migrations a box has had applied so future runs only do the missing work.

## `cb migrate` is the entry point

Each box has `config/migrations.jsonl` — append-only JSONL, one `{name, applied-at}` per line — recording which migrations it's seen. `cb migrate` compares against the canonical ordered list in `src/core/migrations.ts` and runs anything missing in order, appending an entry after each success.

```bash
cb migrate                      # status — show applied + pending
cb migrate --apply              # run all pending in order
cb migrate --mark-all-applied   # seed the manifest as if every known migration ran
                                # (legacy box that was already fully migrated before this command existed)
```

`cb init` writes a seeded manifest (all-applied) for new boxes automatically — new boxes don't need to run historical migrations. A missing manifest in an existing box is a hard error; the user must explicitly `--mark-all-applied` to declare "this box is already up to date."

If a migration fails, the manifest is **not** updated for the failing entry and subsequent migrations are not attempted. Fix the underlying problem and re-run; the loop picks up where it stopped.

## Writing a new migration

1. **Write the script** at `scripts/migrate/<name>.ts`. New migrators should use the shared harness (`scripts/migrate/_harness.ts`), which handles arg parsing, the file walk, dry-run/apply, per-file error collection, and the final warning dump:

   ```ts
   #!/usr/bin/env tsx
   import { runMigration } from "./_harness.js";
   import { WarningCollector, checkElement, type ElementSpec } from "./_warnings.js";

   const SPEC: ElementSpec = {
     attrs: ["status", "version"],
     children: { /* ... */ },
   };

   await runMigration({
     description: "*.thing.card: XML → flat YAML.",
     match: (name) => name.endsWith(".thing.card"),
     convert: async (absPath, { warnings }) => {
       // read file, parse, checkElement({ node, source: absPath, spec: SPEC, warnings }),
       // write new content if changed — return "converted" or "already".
     },
   });
   ```

   Existing migrators in this directory predate the harness and still carry their own scaffolding; mirror one (e.g. `scripts/migrate/image.ts`) only if you can't fit the harness's shape.

2. **Be idempotent.** Detect the post-migration shape and skip cards already in it — second runs should report "already migrated N" rather than re-doing work or erroring. Two patterns we use:
   - Filename-based: skip cards whose name already has the new extension.
   - Content-based: skip cards whose frontmatter already has the target shape (e.g., a specific key present, or matching a regex marker).
   `cb migrate` re-runs partially-applied migrations on retry, and admins occasionally run individual scripts manually for debugging — idempotency makes both safe.

3. **Be noisy about data loss.** Every migrator must use the `scripts/migrate/_warnings.ts` helper to declare what attrs/children it knows how to map, and warn about anything outside that allow-list. The harness above already plumbs the `WarningCollector` through; what you write per-migration is just the spec + per-element check:

   ```ts
   const SPEC: ElementSpec = {
     attrs: ["status", "version"],
     children: {
       filename: { attrs: ["ref", "captured", "source"] },
       description: { attrs: [] },
       // ...
     },
   };

   // inside convert(), after parsing the card:
   checkElement({ node, source: absPath, spec: SPEC, warnings });
   ```

   At the end of a run, anything outside the spec prints with file path + field path:

   ```
   3 warning(s) about unrecognized fields:
     ledger.briefing.card: unknown child at <briefing>: <legal>
     store/.../Amherdt_Handwritten_Letter.record.card: unknown attr at <record> > <person>: role="Amherdt Group"
   ```

   A warning means data the migrator silently drops. When you see one against real data, the response is normally **extend the migrator**: add the field to the spec, map it in the converter, extend the target schema in `src/schemas/`. Re-run from a clean baseline. Accepting silent loss is rarely the right call; the warning is a prompt to think about each unmapped field.

4. **Register it.** Append a `{name, script}` entry to `MIGRATIONS` at the bottom of `src/core/migrations.ts`. **Never reorder, rename, or remove** existing entries — the `name` is the manifest key, so reordering changes which migrations a box thinks it has applied. New entries always go at the end.

5. **Document it.** Update the migrator table in this file (below) and mention any non-obvious behavior (e.g., the script renames files, deletes orphans, mutates non-card files). Commit migrator + registry entry + doc update together.

6. **Test it.** Run dry-run against a real box you can reset; then `--apply` and validate with `cb validate`. Confirm the manifest got an entry. If you have a noisy-mode warning, decide explicitly whether to handle it or accept the loss — and document the call.

Migrations are written for cards that already exist on disk; you almost never need to think about schema-level migrations (the schema files in `src/schemas/` evolve freely as long as old data still parses, or has a migrator to bring it forward).

## The migrators

In the canonical order (same order they run via `cb migrate --apply`):

All scripts live in `scripts/migrate/`.

| # | Name | Script | What it does |
|---|------|--------|---|
| 1 | `attachments`       | `attachments.ts`       | Structural: move flat sibling attachments into `<basename>.attach/` directories |
| 2 | `card-frontmatter`  | `card-frontmatter.ts`  | Phase 1: wrap every `.card` in `---\ncontent-type: application/x-card+xml\n---` so the loader treats them uniformly |
| 3 | `email-thread`      | `email-thread.ts`      | `*.email-thread.card`: XML → flat YAML frontmatter |
| 4 | `email-message`     | `email-message.ts`     | `*.email-message.card`: XML → flat YAML |
| 5 | `briefing`          | `briefing.ts`          | `*.briefing.card`: XML → YAML frontmatter + markdown body |
| 6 | `doc-sheet`         | `doc-sheet.ts`         | `*.doc.card`, `*.sheet.card`: XML → flat YAML (note: `.doc.card` was the Google-Doc type at the time; renamed to `gdoc` later — see #18) |
| 7 | `file`              | `file.ts`              | `*.file.card`: XML → flat YAML |
| 8 | `image`             | `image.ts`             | `*.image.card`: XML → flat YAML |
| 9 | `audio`             | `audio.ts`             | `*.audio.card`: XML → flat YAML |
| 10 | `record-person`    | `record-person.ts`     | `*.record.card`, `*.person.card`: XML → YAML + markdown body |
| 11 | `memo`             | `memo.ts`              | `*.memo.card`: XML → YAML + markdown body |
| 12 | `misc`             | `misc.ts`              | `*.todo-list.card`, `*.telegram-message.card`, `*.feedback.card` |
| 13 | `jobs`             | `jobs.ts`              | The four job schemas (intake, calendar-review, chat, question-followup) |
| 14 | `personality`      | `personality.ts`       | `*.personality.card`: XML → YAML + markdown body |
| 15 | `scheduled-script` | `scheduled-script.ts`  | `*.scheduled-script.card`: XML → flat YAML |
| 16 | `question`         | `question.ts`          | `*.question.card`: XML → flat YAML |
| 17 | `chat-thread`      | `chat-thread.ts`       | `*.chat-thread.card`: XML → YAML with discriminated entries[] |
| 18 | `doc-to-gdoc`      | `doc-to-gdoc.ts`       | Rename Google-Doc `.doc.card` → `.gdoc.card` and flip the YAML `type:` so the `doc` type name can be reused for a generic in-box document type |
| 19 | `strip-type-field` | `strip-type-field.ts`  | Remove the redundant `type:` field from every card's frontmatter — filename is the canonical type discriminator. Also renames `.X.job.card` → `.X-job.card` so the filename actually carries the canonical type for jobs |

## Manual runs (for debugging)

The per-schema scripts are runnable standalone (`npx tsx scripts/migrate/<name>.ts <boxRoot> --apply`). Useful for debugging a single migration or for one-off boxes. The manifest is **not** updated when scripts are run directly — that only happens via `cb migrate`. If you do this and want it to count, append the entry yourself or run `cb migrate --apply` afterwards.

## Maintenance tools

- `scripts/clean-broken-refs.ts` — not a migration; a one-off data-hygiene tool. Deletes orphan image cards (whose `filename.ref` target is gone), prunes dead refs from capture-sessions / records / jobs, and rewrites `../../../people/Foo.person.card` style relative refs to absolute form when the target exists. Idempotent; safe to re-run.

## Production rollout history (box.example.com)

For reference. May 23–24, 2026.

1. Pushed migrators + `cb migrate` to GitHub; post-commit hook deploys to `/opt/callback/callback-box/`.
2. Stopped `callback-serve` + `callback-scheduler` to avoid races.
3. Per-box backup: pre-migration commit SHA + a compact tar (text-only) into `/home/callback/backups/pre-migration-<timestamp>/`. The card data is already in git; the tar is belt-and-suspenders for non-git state.
4. For each box: seeded the manifest (sometimes partially for legacy boxes), ran `cb migrate --apply`, committed.
5. Some boxes hit pre-commit validation blocks from pre-existing data drift (broken refs, malformed templates). Cleaned those up via `scripts/clean-broken-refs.ts` plus hand-fixes; see commit history.
6. Restarted services.

Residual data fixes that were one-offs (won't apply to other boxes):

- `personal/config/main.personality.card` `<boxholder ref="...">` attr restored after the personality migrator dropped it. Migrator fixed to preserve.
- `hearth/Test_Timer*.memo.card` had `<memo created="...">` attr instead of a `<created>` child. Hand-converted; the migrator was not extended (one-off shape).
- `personal/store/callback-box/callback-box-interaction-primitives.memo.card` legacy `<card type="memo">` root. Hand-converted.
- Ledger's eulogy `.md` moved into a proper `.attach/` scope; trash duplicate removed.
- Several boxes had `Box.landmark.card` with `<label>` / `<symbol>` directly under `<landmark>` instead of inside `<navigation>`. Wrapped via perl one-liner.
- Ledger had two `*.email-outbound.card` files still in XML (no migrator existed for that type). Hand-converted to YAML.

## See also

- `docs/cards-as-markdown.md` — design rationale for the YAML-frontmatter format these migrators target
- `docs/maintenance.md` — where `cb migrate` and `clean-broken-refs.ts` sit in the broader maintenance surface
- `docs/adding-schemas.md` — when a *schema* change (not a data shape change) is the right move instead of a migrator
- `scripts/migrate/_warnings.ts` — the noisy-mode helper every migrator uses
- `scripts/migrate/_harness.ts` — shared scaffold for new migrators

## Rollback

Each pending migration is committed by the user (`cb migrate` doesn't auto-commit). If a migration produced unwanted changes:

```bash
git -C $BOX reset --hard <pre-migration-sha>
# also: remove the manifest entry for the migration you reverted
sed -i '/"name":"<migration-name>"/d' $BOX/config/migrations.jsonl
```

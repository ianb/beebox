/**
 * Canonical ordered list of box data migrations.
 *
 * `bbx migrate` reads this and the per-box manifest at
 * `config/migrations.jsonl` to decide what to run. New migrations get
 * appended to the array; never reorder or remove existing entries —
 * the `name` is the manifest key and reordering would change which
 * migrations a box thinks it has applied.
 *
 * Adding an entry here? File the legacy-removal issue too — whatever code now
 * exists only to tolerate the pre-migration shape should be named, with
 * `file:line`, while you still know which branches those are (step 7 of
 * "Writing a new migration" in docs/migrations.md). Applies to both kinds
 * below.
 *
 * A migration is one of two kinds:
 *   - script:    a deterministic migrator under `scripts/` invoked with the box
 *                root and `--apply`. Idempotent, noisy about data loss (see
 *                scripts/migrate/_warnings.ts, docs/migrations.md).
 *   - procedure: an agent-applied migration — runs a procedure definition (which
 *                typically drives an agent through a checklist and gates on a
 *                `validate.shells` check). See docs/plans/agent-applied-migrations.md.
 * The two are distinguished by which field is present (`script` vs `procedure`),
 * so existing entries need no `kind` field.
 */

interface BaseMigration {
  /** Stable key recorded in the box's migrations.jsonl. */
  readonly name: string;
}

/** A deterministic migrator script. */
export interface ScriptMigration extends BaseMigration {
  /** Path to the migrator script, relative to the beebox repo root. */
  readonly script: string;
}

/** An agent-applied migration that runs a procedure definition. */
export interface ProcedureMigration extends BaseMigration {
  /** Procedure definition name (resolved from config/procedures/). */
  readonly procedure: string;
}

export type Migration = ScriptMigration | ProcedureMigration;

/** Discriminate by the present field — no `kind` tag needed. */
export function isProcedureMigration(m: Migration): m is ProcedureMigration {
  return "procedure" in m;
}

export const MIGRATIONS: ReadonlyArray<Migration> = [
  { name: "attachments",       script: "scripts/migrate/attachments.ts" },
  { name: "card-frontmatter",  script: "scripts/migrate/card-frontmatter.ts" },
  { name: "email-thread",      script: "scripts/migrate/email-thread.ts" },
  { name: "email-message",     script: "scripts/migrate/email-message.ts" },
  { name: "briefing",          script: "scripts/migrate/briefing.ts" },
  { name: "doc-sheet",         script: "scripts/migrate/doc-sheet.ts" },
  { name: "file",              script: "scripts/migrate/file.ts" },
  { name: "image",             script: "scripts/migrate/image.ts" },
  { name: "audio",             script: "scripts/migrate/audio.ts" },
  { name: "record-person",     script: "scripts/migrate/record-person.ts" },
  { name: "memo",              script: "scripts/migrate/memo.ts" },
  { name: "misc",              script: "scripts/migrate/misc.ts" },
  { name: "jobs",              script: "scripts/migrate/jobs.ts" },
  { name: "personality",       script: "scripts/migrate/personality.ts" },
  { name: "scheduled-script",  script: "scripts/migrate/scheduled-script.ts" },
  { name: "question",          script: "scripts/migrate/question.ts" },
  { name: "chat-thread",       script: "scripts/migrate/chat-thread.ts" },
  { name: "doc-to-gdoc",       script: "scripts/migrate/doc-to-gdoc.ts" },
  { name: "strip-type-field",  script: "scripts/migrate/strip-type-field.ts" },
  { name: "repair-refs",       script: "scripts/migrate/repair-refs.ts" },
  { name: "asset-marker",      script: "scripts/migrate/asset-marker.ts" },
  { name: "webpage-card",      script: "scripts/migrate/webpage-card.ts" },
  { name: "landmark",          script: "scripts/migrate/landmark.ts" },
  { name: "recipe",            script: "scripts/migrate/recipe.ts" },
  { name: "procedure-run",     script: "scripts/migrate/procedure-run.ts" },
  { name: "procedure",         script: "scripts/migrate/procedure.ts" },
  { name: "guide",             script: "scripts/migrate/guide.ts" },
  { name: "capture-session",   script: "scripts/migrate/capture-session.ts" },
  { name: "delete-deprecated-cards", script: "scripts/migrate/delete-deprecated-cards.ts" },
  { name: "bill",              script: "scripts/migrate/bill.ts" },
  // First agent-applied (procedure-kind) migration: rewrite box-local views to
  // the post-cleanup ViewCard shape. See docs/plans/agent-applied-migrations.md.
  { name: "view-card-shape",   procedure: "view-card-shape" },
  // Normalize bare-string card refs onto a `ref` key (landmark procedure-ref,
  // webpage/commentary frozen). See the user-story audit (D11).
  { name: "normalize-ref-keys", script: "scripts/migrate/normalize-ref-keys.ts" },
  // Rename the person card `called` field to the standard `aliases`.
  { name: "person-aliases",    script: "scripts/migrate/person-aliases.ts" },
  // Retype recipe `source`/`hero-image` from freeform strings to typed objects.
  { name: "recipe-source-shape", script: "scripts/migrate/recipe-source-shape.ts" },
  // Split the person card's freeform `contact:` into email/phone/address.
  { name: "person-contact-split", script: "scripts/migrate/person-contact-split.ts" },
  // Rename the `sheet` card type to `gsheet` (.sheet.card → .gsheet.card + refs).
  { name: "gsheet-rename",       script: "scripts/migrate/gsheet-rename.ts" },
  // Move inline personality boxholder identity onto `boxholder: true` person cards.
  { name: "boxholder-person",    script: "scripts/migrate/boxholder-person.ts" },
  // Strip file-metadata timestamps (created-at/updated-at/added-at) from guide +
  // personality cards — git is the record; they were also a template-churn source.
  { name: "strip-entry-timestamps", script: "scripts/migrate/strip-entry-timestamps.ts" },
  // RETIRED tombstone. Once converted a legacy (shapeVersion 1) box in place
  // into the v2 package layout (Track H, docs/implemented-plans/boxes-as-packages-v2.md).
  // All boxes are v2 and the v1 shape is gone, so the converter is now an
  // idempotent v2-assert no-op — but the name stays registered (append-only
  // manifest, never remove an entry). See the script's module doc comment.
  { name: "box-packageify", script: "scripts/migrate/box-packageify.ts" },
  // Question-card lifecycle cleanup for the Track A schema change
  // (docs/implemented-plans/questions-end-to-end.md): strip answered-by,
  // backfill asked-at from git history, relocate stray question cards into
  // box/questions/, and fix retired <agent-needs-to-know> directives.
  { name: "question-lifecycle", script: "scripts/migrate/question-lifecycle-run.ts" },
  // Prune the retired process-captures procedure card + its one-shot trigger
  // from boxes (installProcedures never prunes). Stock copies are deleted by
  // hash match; a boxholder-modified copy is parked for review. See
  // docs/implemented-plans/capture-mode.md (Track 7).
  { name: "retire-process-captures", script: "scripts/migrate/retire-process-captures.ts" },
  // Retire the `todo-list` card type — superseded by the universal
  // `{% todo %}` annotation (docs/implemented-plans/todo-annotation.md).
  // Converts every *.todo-list.card into a sibling *.doc.card with items
  // rendered as {% todo %}-wrapped markdown, and rewrites inbound refs.
  { name: "todo-list-to-doc", script: "scripts/migrate/todo-list-to-doc-run.ts" },
  // Re-apply annex.largefiles + .git/info/attributes from the current
  // renderings. Unlike everything above it transforms no card data — it
  // converges box CONFIGURATION that is written once and then goes stale
  // whenever src/lib/asset-extensions.ts changes. A later rendering change
  // needs a new dated entry; see the script's module comment.
  { name: "annex-config-2026-08", script: "scripts/migrate/annex-config.ts" },
  // Rename the `document` card type to `pdf` (`document` collided with
  // `doc.card`; the pipeline only reads PDFs, so the generic name bought
  // nothing). *.document.card → *.pdf.card + inbound refs.
  { name: "document-to-pdf", script: "scripts/migrate/document-to-pdf.ts" },
  // Fold the legacy box-wide chat model pointer (.beebox/chat-model.json)
  // into the box model policy (`agentModel` in config/box.json), which chat and
  // the reactor both read. Configuration, not card data — like annex-config
  // above. See docs/implemented-plans/model-engine-policy.md.
  { name: "chat-model-to-box-config", script: "scripts/migrate/chat-model-to-box-config.ts" },
  // Rename the record card's `measures` field to `measurements` (the
  // vocabulary sweep's quantity/measurements split — `quantity` itself is new
  // and optional, nothing to migrate). See docs/plans/vocab-glossary-sweep.md.
  { name: "record-measurements", script: "scripts/migrate/record-measurements.ts" },
  { name: "gitignore-2026-09",  script: "scripts/migrate/box-gitignore.ts" },
  { name: "hooks-2026-09",      script: "scripts/migrate/box-hooks.ts" },
];

export const MANIFEST_PATH = "config/migrations.jsonl";

export interface ManifestEntry {
  readonly name: string;
  readonly "applied-at": string;
}

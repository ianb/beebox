/**
 * Canonical ordered list of box data migrations.
 *
 * `bbx migrate` reads this and the per-box manifest at
 * `_config/migrations.jsonl` to decide what to run. New migrations get
 * appended to the array; never reorder or remove existing entries —
 * the `name` is the manifest key and reordering would change which
 * migrations a box thinks it has applied.
 *
 * Adding an entry here? File the legacy-removal issue too — whatever code now
 * exists only to tolerate the pre-migration shape should be named, with
 * `file:line`, while you still know which branches those are (step 7 of
 * "Writing a new migration" in docs/cards/migrations.md). Applies to both kinds
 * below.
 *
 * A migration is one of two kinds:
 *   - script:    a deterministic migrator under `scripts/` invoked with the box
 *                root and `--apply`. Idempotent, noisy about data loss (see
 *                src/scripts/migrate/_warnings.ts, docs/cards/migrations.md).
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
  /** Procedure definition name (resolved from _config/procedures/). */
  readonly procedure: string;
}

export type Migration = ScriptMigration | ProcedureMigration;

/** Discriminate by the present field — no `kind` tag needed. */
export function isProcedureMigration(m: Migration): m is ProcedureMigration {
  return "procedure" in m;
}

export const MIGRATIONS: ReadonlyArray<Migration> = [
  { name: "attachments",       script: "src/scripts/migrate/attachments.ts" },
  { name: "card-frontmatter",  script: "src/scripts/migrate/card-frontmatter.ts" },
  { name: "email-thread",      script: "src/scripts/migrate/email-thread.ts" },
  { name: "email-message",     script: "src/scripts/migrate/email-message.ts" },
  { name: "briefing",          script: "src/scripts/migrate/briefing.ts" },
  { name: "doc-sheet",         script: "src/scripts/migrate/doc-sheet.ts" },
  { name: "file",              script: "src/scripts/migrate/file.ts" },
  { name: "image",             script: "src/scripts/migrate/image.ts" },
  { name: "audio",             script: "src/scripts/migrate/audio.ts" },
  { name: "record-person",     script: "src/scripts/migrate/record-person.ts" },
  { name: "memo",              script: "src/scripts/migrate/memo.ts" },
  { name: "misc",              script: "src/scripts/migrate/misc.ts" },
  { name: "jobs",              script: "src/scripts/migrate/jobs.ts" },
  { name: "personality",       script: "src/scripts/migrate/personality.ts" },
  { name: "scheduled-script",  script: "src/scripts/migrate/scheduled-script.ts" },
  { name: "question",          script: "src/scripts/migrate/question.ts" },
  { name: "chat-thread",       script: "src/scripts/migrate/chat-thread.ts" },
  { name: "doc-to-gdoc",       script: "src/scripts/migrate/doc-to-gdoc.ts" },
  { name: "strip-type-field",  script: "src/scripts/migrate/strip-type-field.ts" },
  { name: "repair-refs",       script: "src/scripts/migrate/repair-refs.ts" },
  { name: "asset-marker",      script: "src/scripts/migrate/asset-marker.ts" },
  { name: "webpage-card",      script: "src/scripts/migrate/webpage-card.ts" },
  { name: "landmark",          script: "src/scripts/migrate/landmark.ts" },
  { name: "recipe",            script: "src/scripts/migrate/recipe.ts" },
  { name: "procedure-run",     script: "src/scripts/migrate/procedure-run.ts" },
  { name: "procedure",         script: "src/scripts/migrate/procedure.ts" },
  { name: "guide",             script: "src/scripts/migrate/guide.ts" },
  { name: "capture-session",   script: "src/scripts/migrate/capture-session.ts" },
  { name: "delete-deprecated-cards", script: "src/scripts/migrate/delete-deprecated-cards.ts" },
  { name: "bill",              script: "src/scripts/migrate/bill.ts" },
  // First agent-applied (procedure-kind) migration: rewrite box-local views to
  // the post-cleanup ViewCard shape. See docs/plans/agent-applied-migrations.md.
  { name: "view-card-shape",   procedure: "view-card-shape" },
  // Normalize bare-string card refs onto a `ref` key (landmark procedure-ref,
  // webpage/commentary frozen). See the user-story audit (D11).
  { name: "normalize-ref-keys", script: "src/scripts/migrate/normalize-ref-keys.ts" },
  // Rename the person card `called` field to the standard `aliases`.
  { name: "person-aliases",    script: "src/scripts/migrate/person-aliases.ts" },
  // Retype recipe `source`/`hero-image` from freeform strings to typed objects.
  { name: "recipe-source-shape", script: "src/scripts/migrate/recipe-source-shape.ts" },
  // Split the person card's freeform `contact:` into email/phone/address.
  { name: "person-contact-split", script: "src/scripts/migrate/person-contact-split.ts" },
  // Rename the `sheet` card type to `gsheet` (.sheet.card → .gsheet.card + refs).
  { name: "gsheet-rename",       script: "src/scripts/migrate/gsheet-rename.ts" },
  // Move inline personality boxholder identity onto `boxholder: true` person cards.
  { name: "boxholder-person",    script: "src/scripts/migrate/boxholder-person.ts" },
  // Strip file-metadata timestamps (created-at/updated-at/added-at) from guide +
  // personality cards — git is the record; they were also a template-churn source.
  { name: "strip-entry-timestamps", script: "src/scripts/migrate/strip-entry-timestamps.ts" },
  // RETIRED tombstone. Once converted a legacy (shapeVersion 1) box in place
  // into the v2 package layout (Track H, docs/implemented-plans/boxes-as-packages-v2.md).
  // All boxes are v2 and the v1 shape is gone, so the converter is now an
  // idempotent v2-assert no-op — but the name stays registered (append-only
  // manifest, never remove an entry). See the script's module doc comment.
  { name: "box-packageify", script: "src/scripts/migrate/box-packageify.ts" },
  // Question-card lifecycle cleanup for the Track A schema change
  // (docs/implemented-plans/questions-end-to-end.md): strip answered-by,
  // backfill asked-at from git history, relocate stray question cards into
  // box/questions/, and fix retired <agent-needs-to-know> directives.
  { name: "question-lifecycle", script: "src/scripts/migrate/question-lifecycle-run/run.ts" },
  // Prune the retired process-captures procedure card + its one-shot trigger
  // from boxes (installProcedures never prunes). Stock copies are deleted by
  // hash match; a boxholder-modified copy is parked for review. See
  // docs/implemented-plans/capture-mode.md (Track 7).
  { name: "retire-process-captures", script: "src/scripts/migrate/retire-process-pages/captures.ts" },
  // Retire the `todo-list` card type — superseded by the universal
  // `{% todo %}` annotation (docs/implemented-plans/todo-annotation.md).
  // Converts every *.todo-list.card into a sibling *.doc.card with items
  // rendered as {% todo %}-wrapped markdown, and rewrites inbound refs.
  { name: "todo-list-to-doc", script: "src/scripts/migrate/todo-list-to-doc-run/run.ts" },
  // Re-apply annex.largefiles + .git/info/attributes from the current
  // renderings. Unlike everything above it transforms no card data — it
  // converges box CONFIGURATION that is written once and then goes stale
  // whenever src/lib/asset-extensions.ts changes. A later rendering change
  // needs a new dated entry; see the script's module comment.
  { name: "annex-config-2026-08", script: "src/scripts/migrate/annex-config.ts" },
  // Rename the `document` card type to `pdf` (`document` collided with
  // `doc.card`; the pipeline only reads PDFs, so the generic name bought
  // nothing). *.document.card → *.pdf.card + inbound refs.
  { name: "document-to-pdf", script: "src/scripts/migrate/document-to-pdf.ts" },
  // Fold the legacy box-wide chat model pointer (.beebox/chat-model.json)
  // into the box model policy (`agentModel` in _config/box.json), which chat and
  // the reactor both read. Configuration, not card data — like annex-config
  // above. See docs/implemented-plans/model-engine-policy.md.
  { name: "chat-model-to-box-config", script: "src/scripts/migrate/chat-model-to-box-config.ts" },
  // Rename the record card's `measures` field to `measurements` (the
  // vocabulary sweep's quantity/measurements split — `quantity` itself is new
  // and optional, nothing to migrate). See docs/plans/vocab-glossary-sweep.md.
  { name: "record-measurements", script: "src/scripts/migrate/record-measurements.ts" },
  { name: "gitignore-2026-09",  script: "src/scripts/migrate/box-gitignore.ts" },
  { name: "hooks-2026-09",      script: "src/scripts/migrate/box-hooks.ts" },
  // A landmark's mark moves out of the navigation role and onto the card
  // itself, now that `symbol` is a field every card may carry
  // (docs/plans/card-symbol.md). Readers accept both shapes during the
  // settling period; see the deferred cleanup issue.
  { name: "landmark-symbol", script: "src/scripts/migrate/landmark-symbol.ts" },
  // A landmark's hand-curated `links:` entries and a target's own
  // `prominence` used to be two ways to say "surface this" and could
  // disagree. Marks every in-subtree link target that has no `prominence`
  // yet as `primary` (docs/implemented-plans/card-prominence.md, Track D). The landmark
  // itself is never written.
  { name: "landmark-links-prominence", script: "src/scripts/migrate/landmark-links-prominence-run/run.ts" },
  // Scheduled-script cards still invoking the retired `cb` command point at
  // `bbx`. Configuration, not card data, like the hooks and gitignore
  // entries above; the rename rewrote everything but the boxes' own `runs:`.
  { name: "schedule-runs-bbx-2026-09", script: "src/scripts/migrate/schedule-runs-bbx.ts" },
  // MUST follow `schedule-runs-bbx-2026-09`, which repoints cards still naming
  // the retired command. This migrator only recognizes a command whose program
  // is already `bbx`, so running first it would pass such a card over, and that
  // rewrite would then leave it at a bare `bbx wakeup` — which no longer
  // resolves, with neither migration willing to look at it again.
  //
  // The CLI split (docs/implemented-plans/bbx-agent-surface.md) moved `wakeup`
  // and its siblings under `bbx engine`; stock schedule cards carry those verbs
  // as literal shell strings the scheduler runs through a shell.
  { name: "schedule-engine-verbs-2026-09", script: "src/scripts/migrate/schedule-engine-verbs.ts" },
  { name: "canonical-interface-cards", script: "src/scripts/migrate/canonical-interface-cards.ts" },
  { name: "remaining-interface-cards", script: "src/scripts/migrate/remaining-interface-cards.ts" },
  { name: "search-interface-card", script: "src/scripts/migrate/search-interface-card.ts" },
  // Review existing tricks for credential dependencies and add sibling
  // secrets.json declarations for the standard trick runtime.
  { name: "trick-secret-runtime", procedure: "trick-secret-runtime" },
  // Rewrite box-absolute refs still in v2 layout (`/store/…`) to the v3 path
  // the one-root migration moved their target to, when that target exists.
  // Runs before `filename-attach-scope`, which then sees v3-form refs.
  { name: "v2-refs-to-v3", script: "src/scripts/migrate/v2-refs-to-v3.ts" },
  // Move legacy flat-layout media files into their card's attach scope and
  // point `filename.ref` at `attach/<file>`. Best effort: uncertain cards are
  // reported, not failed; `bbx validate` keeps warning on them.
  { name: "filename-attach-scope", script: "src/scripts/migrate/filename-attach-scope.ts" },
  // Remove the retired process-pages procedure (installProcedures never
  // prunes). Its input, record cards in pages-saved/, has had no writer since
  // the clerk's Save Page was removed; a copy still reading it is deleted, a
  // repointed one is parked for review. See the script's module comment.
  { name: "retire-process-pages", script: "src/scripts/migrate/retire-process-pages/run.ts" },
  // Re-key `_config/template-versions.json` onto v3 paths: the one-root
  // migration moved the tracked files without renaming the tracker's keys, so
  // every tracked template read as untracked and parked. See the script.
  { name: "rekey-template-versions", script: "src/scripts/migrate/rekey-template-versions.ts" },
  // Agent observations now live as ordinary doc cards in _config/feedback.
  // Convert command-written Markdown in both active and resolved directories.
  { name: "feedback-to-doc-cards", script: "src/scripts/migrate/feedback-to-doc-cards.ts" },
  // Strip standard-looking fields that had no job: dead `status` on jobs and
  // five other types (record's becomes `reviewed`/`archived` booleans),
  // pub-submission `created`, audio `summary`, experiment observation `date`.
  // See docs/implemented-plans/standard-card-fields.md.
  { name: "standard-fields-2026-09", script: "src/scripts/migrate/card-fields/run.ts" },
  // Replace every remaining `status` with the specific fact it recorded
  // (presence fields, named booleans, `outcome`). See the script's planners.
  { name: "status-fields-2026-09", script: "src/scripts/migrate/card-fields/run.ts" },
  // Give each `source` that is not a derived-from pointer its own name, and
  // move media acquisition times into `filename.via`. See the script's planners.
  { name: "source-fields-2026-09", script: "src/scripts/migrate/card-fields/run.ts" },
  // Re-apply `.git/info/attributes`: bulk batches now name their attach scope
  // after the card (`<slug>.attach`), so the rendering gained a line for it.
  { name: "annex-config-2026-10", script: "src/scripts/migrate/annex-config.ts" },
  // The publication card is the publication: fold src/publications/<name>/ into
  // <name>.publication.card + <name>.attach/; retire the publications guidance.
  { name: "publication-cards-2026-10", script: "src/scripts/migrate/publication-cards/run.ts" },
];

export const MANIFEST_PATH = "_config/migrations.jsonl";

export interface ManifestEntry {
  readonly name: string;
  readonly "applied-at": string;
}

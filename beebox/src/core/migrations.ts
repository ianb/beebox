/**
 * Canonical ordered list of box data migrations.
 *
 * `bbx migrate` reads this and the per-box manifest at
 * `_config/migrations.jsonl` to decide what to run. New migrations get
 * appended to the array; never reorder or remove existing entries —
 * the `name` is the manifest key and reordering would change which
 * migrations a box thinks it has applied.
 *
 * Every box had applied every entry below as of 2026-10-08, so each one now
 * runs the shared no-op `src/scripts/migrate/retired.ts`; the migrators that
 * did the work are in git history. A retired entry keeps its name and position.
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
 *                docs/cards/migrations.md).
 *   - procedure: an agent-applied migration — runs a procedure definition (which
 *                typically drives an agent through a checklist and gates on a
 *                `validate.shells` check). See docs/implemented-plans/agent-applied-migrations.md.
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

const RETIRED = "src/scripts/migrate/retired.ts";

export const MIGRATIONS: ReadonlyArray<Migration> = [
  { name: "attachments", script: RETIRED },
  { name: "card-frontmatter", script: RETIRED },
  { name: "email-thread", script: RETIRED },
  { name: "email-message", script: RETIRED },
  { name: "briefing", script: RETIRED },
  { name: "doc-sheet", script: RETIRED },
  { name: "file", script: RETIRED },
  { name: "image", script: RETIRED },
  { name: "audio", script: RETIRED },
  { name: "record-person", script: RETIRED },
  { name: "memo", script: RETIRED },
  { name: "misc", script: RETIRED },
  { name: "jobs", script: RETIRED },
  { name: "personality", script: RETIRED },
  { name: "scheduled-script", script: RETIRED },
  { name: "question", script: RETIRED },
  { name: "chat-thread", script: RETIRED },
  { name: "doc-to-gdoc", script: RETIRED },
  { name: "strip-type-field", script: RETIRED },
  { name: "repair-refs", script: RETIRED },
  { name: "asset-marker", script: RETIRED },
  { name: "webpage-card", script: RETIRED },
  { name: "landmark", script: RETIRED },
  { name: "recipe", script: RETIRED },
  { name: "procedure-run", script: RETIRED },
  { name: "procedure", script: RETIRED },
  { name: "guide", script: RETIRED },
  { name: "capture-session", script: RETIRED },
  { name: "delete-deprecated-cards", script: RETIRED },
  { name: "bill", script: RETIRED },
  { name: "view-card-shape", script: RETIRED },
  { name: "normalize-ref-keys", script: RETIRED },
  { name: "person-aliases", script: RETIRED },
  { name: "recipe-source-shape", script: RETIRED },
  { name: "person-contact-split", script: RETIRED },
  { name: "gsheet-rename", script: RETIRED },
  { name: "boxholder-person", script: RETIRED },
  { name: "strip-entry-timestamps", script: RETIRED },
  { name: "box-packageify", script: RETIRED },
  { name: "question-lifecycle", script: RETIRED },
  { name: "retire-process-captures", script: RETIRED },
  { name: "todo-list-to-doc", script: RETIRED },
  { name: "annex-config-2026-08", script: RETIRED },
  { name: "document-to-pdf", script: RETIRED },
  { name: "chat-model-to-box-config", script: RETIRED },
  { name: "record-measurements", script: RETIRED },
  { name: "gitignore-2026-09", script: RETIRED },
  { name: "hooks-2026-09", script: RETIRED },
  { name: "landmark-symbol", script: RETIRED },
  { name: "landmark-links-prominence", script: RETIRED },
  { name: "schedule-runs-bbx-2026-09", script: RETIRED },
  { name: "schedule-engine-verbs-2026-09", script: RETIRED },
  { name: "canonical-interface-cards", script: RETIRED },
  { name: "remaining-interface-cards", script: RETIRED },
  { name: "search-interface-card", script: RETIRED },
  { name: "trick-secret-runtime", script: RETIRED },
  { name: "v2-refs-to-v3", script: RETIRED },
  { name: "filename-attach-scope", script: RETIRED },
  { name: "retire-process-pages", script: RETIRED },
  { name: "rekey-template-versions", script: RETIRED },
  { name: "feedback-to-doc-cards", script: RETIRED },
  { name: "standard-fields-2026-09", script: RETIRED },
  { name: "status-fields-2026-09", script: RETIRED },
  { name: "source-fields-2026-09", script: RETIRED },
  { name: "annex-config-2026-10", script: RETIRED },
  { name: "publication-cards-2026-10", script: RETIRED },
];

export const MANIFEST_PATH = "_config/migrations.jsonl";

export interface ManifestEntry {
  readonly name: string;
  readonly "applied-at": string;
}

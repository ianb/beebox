/**
 * Canonical ordered list of box data migrations.
 *
 * `cb migrate` reads this and the per-box manifest at
 * `config/migrations.jsonl` to decide what to run. New migrations get
 * appended to the array; never reorder or remove existing entries —
 * the `name` is the manifest key and reordering would change which
 * migrations a box thinks it has applied.
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
  /** Path to the migrator script, relative to the callback-box repo root. */
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
];

export const MANIFEST_PATH = "config/migrations.jsonl";

export interface ManifestEntry {
  readonly name: string;
  readonly "applied-at": string;
}

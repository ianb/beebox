/**
 * Canonical ordered list of box data migrations.
 *
 * `cb migrate` reads this and the per-box manifest at
 * `config/.migrations.jsonl` to decide what to run. New migrations get
 * appended to the array; never reorder or remove existing entries —
 * the `name` is the manifest key and reordering would change which
 * migrations a box thinks it has applied.
 *
 * Each migration is a script under `scripts/` invoked with the box root
 * and `--apply`. Scripts are expected to be idempotent (safe to re-run
 * if for some reason the manifest is wrong).
 */

export interface Migration {
  /** Stable key recorded in the box's migrations.jsonl. */
  readonly name: string;
  /** Path to the migrator script, relative to the callback-box repo root. */
  readonly script: string;
}

export const MIGRATIONS: ReadonlyArray<Migration> = [
  { name: "attachments",       script: "scripts/migrate-attachments.ts" },
  { name: "card-frontmatter",  script: "scripts/migrate-card-frontmatter.ts" },
  { name: "email-thread",      script: "scripts/migrate-email-thread.ts" },
  { name: "email-message",     script: "scripts/migrate-email-message.ts" },
  { name: "briefing",          script: "scripts/migrate-briefing.ts" },
  { name: "doc-sheet",         script: "scripts/migrate-doc-sheet.ts" },
  { name: "file",              script: "scripts/migrate-file.ts" },
  { name: "image",             script: "scripts/migrate-image.ts" },
  { name: "audio",             script: "scripts/migrate-audio.ts" },
  { name: "record-person",     script: "scripts/migrate-record-person.ts" },
  { name: "memo",              script: "scripts/migrate-memo.ts" },
  { name: "misc",              script: "scripts/migrate-misc.ts" },
  { name: "jobs",              script: "scripts/migrate-jobs.ts" },
  { name: "personality",       script: "scripts/migrate-personality.ts" },
  { name: "scheduled-script",  script: "scripts/migrate-scheduled-script.ts" },
  { name: "question",          script: "scripts/migrate-question.ts" },
  { name: "chat-thread",       script: "scripts/migrate-chat-thread.ts" },
  { name: "doc-to-gdoc",       script: "scripts/migrate-doc-to-gdoc.ts" },
  { name: "strip-type-field",  script: "scripts/strip-type-field.ts" },
];

export const MANIFEST_PATH = "config/.migrations.jsonl";

export interface ManifestEntry {
  readonly name: string;
  readonly "applied-at": string;
}

#!/usr/bin/env tsx
/**
 * Remove the standard-looking fields that had no job (part 1 of
 * docs/plans/standard-card-fields.md).
 *
 * - `status` on job cards (always `pending`; a finished job is deleted), file,
 *   pub-submission, email-thread, gsheet, and email-outbound. None of these
 *   was ever moved off its default by code, and nothing read it.
 * - `status` on record: `reviewed` / `archived` become `reviewed: true` /
 *   `archived: true`; `draft` (the default) is dropped.
 * - `created` on pub-submission (the connector's clock; `submitted-at` holds
 *   the real submission time), and a leftover `created` on job cards (the
 *   job schemas dropped it earlier; the filename carries the time).
 * - `summary` on audio. The transcript stays; a non-empty summary is dropped
 *   with a warning, since it was derived from the transcript.
 * - `date` on guide and personality experiment observations.
 *
 * Refuses (fails the card, leaving it unchanged) where dropping would change
 * behaviour: an email-outbound whose `status` is not `draft` would otherwise
 * be uploaded as a draft, and a record `status` outside its enum has no
 * mapping.
 *
 * Idempotent: a card with none of the fields is "already".
 *
 * Registered in src/core/migrations.ts. Also runnable directly:
 *   pnpm exec tsx src/scripts/migrate/standard-fields.ts <boxRoot>           # dry-run
 *   pnpm exec tsx src/scripts/migrate/standard-fields.ts <boxRoot> --apply
 */

import { readFile, writeFile } from "node:fs/promises";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { runMigration } from "./_harness.js";
import { splitCardContent } from "../../cards/frontmatter.js";
import { typeFromFilename } from "../../core/card-io.js";
import { isRecord } from "../../shared/is-record.js";

const JOB_TYPES = new Set(["chat-job", "intake-job", "contains-backfill-job", "question-followup-job", "todo-review-job"]);

/** Types whose `status` is dropped outright. */
const DROP_STATUS = new Set([
  "chat-job",
  "intake-job",
  "contains-backfill-job",
  "question-followup-job",
  "todo-review-job",
  "file",
  "pub-submission",
  "email-thread",
  "gsheet",
]);

const HANDLED_TYPES = new Set([...DROP_STATUS, "email-outbound", "record", "audio", "guide", "personality"]);

/**
 * A `status` value this migration has no safe mapping for; the card is left
 * unchanged for a person to decide.
 */
class UnmappedStatusError extends Error {
  readonly type: string;
  readonly status: unknown;
  constructor({ type, status }: { type: string; status: unknown }) {
    super(`${type} status ${JSON.stringify(status)} has no safe mapping; migrate this card by hand`);
    this.name = "UnmappedStatusError";
    this.type = type;
    this.status = status;
  }
}

export interface StandardFieldsResult {
  changed: boolean;
  /** Data dropped that someone may want to know about. */
  warnings: string[];
}

function dropObservationDates(fm: Record<string, unknown>): boolean {
  const experiments = fm["experiments"];
  if (!Array.isArray(experiments)) return false;
  let changed = false;
  for (const experiment of experiments) {
    if (!isRecord(experiment)) continue;
    const observations = experiment["observations"];
    if (!Array.isArray(observations)) continue;
    for (const observation of observations) {
      if (isRecord(observation) && "date" in observation) {
        delete observation["date"];
        changed = true;
      }
    }
  }
  return changed;
}

function migrateRecordStatus(fm: Record<string, unknown>): void {
  const status = fm["status"];
  delete fm["status"];
  if (status === "reviewed") fm["reviewed"] = true;
  else if (status === "archived") fm["archived"] = true;
  else if (status !== "draft") throw new UnmappedStatusError({ type: "record", status });
}

/**
 * Apply this migration to one card's parsed frontmatter, in place. Throws
 * {@link UnmappedStatusError} for a card it must not change.
 */
export function migrateStandardFields(type: string, fm: Record<string, unknown>): StandardFieldsResult {
  const warnings: string[] = [];
  let changed = false;
  if (DROP_STATUS.has(type) && "status" in fm) {
    delete fm["status"];
    changed = true;
  }
  if (type === "email-outbound" && "status" in fm) {
    // Any other value would, once dropped, make the card upload as a draft.
    if (fm["status"] !== "draft") throw new UnmappedStatusError({ type: "email-outbound", status: fm["status"] });
    delete fm["status"];
    changed = true;
  }
  if (type === "record" && "status" in fm) {
    migrateRecordStatus(fm);
    changed = true;
  }
  if ((type === "pub-submission" || JOB_TYPES.has(type)) && "created" in fm) {
    delete fm["created"];
    changed = true;
  }
  if (type === "audio" && "summary" in fm) {
    const summary = fm["summary"];
    if (typeof summary === "string" && summary.trim() !== "") warnings.push("dropped a non-empty audio summary (the transcript stays)");
    delete fm["summary"];
    changed = true;
  }
  if ((type === "guide" || type === "personality") && dropObservationDates(fm)) changed = true;
  return { changed, warnings };
}

// CLI entry — only when run directly (e.g. spawned by `bbx migrate`), not when
// imported by a test.
if (process.argv[1] !== undefined && import.meta.url === `file://${process.argv[1]}`) {
  await runMigration({
    description: "Strip dead standard fields: status, created, summary, observation date (see the module comment).",
    match: (name) => {
      const type = typeFromFilename(name);
      return type !== undefined && HANDLED_TYPES.has(type);
    },
    convert: async (file, { apply, warnings }) => {
      const type = typeFromFilename(file);
      const split = splitCardContent(await readFile(file, "utf8"));
      if (type === undefined || !split.hasFrontmatter) return "already";
      const parsed: unknown = parseYaml(split.frontmatterText);
      if (!isRecord(parsed)) return "already";
      const result = migrateStandardFields(type, parsed);
      for (const warning of result.warnings) warnings.push(file, warning);
      if (!result.changed) return "already";
      if (apply) await writeFile(file, `---\n${stringifyYaml(parsed)}---\n${split.body}`);
      return "converted";
    },
  });
}

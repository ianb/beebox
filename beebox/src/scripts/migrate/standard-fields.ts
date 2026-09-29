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

import { isRecord } from "../../shared/is-record.js";
import { UnmappedStatusError, runFieldEditMigration, type FieldEdit, type FieldEditPlan } from "./_field-edits.js";

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


function observationDateEdits(fm: Record<string, unknown>): FieldEdit[] {
  const experiments = fm["experiments"];
  if (!Array.isArray(experiments)) return [];
  const edits: FieldEdit[] = [];
  for (const [i, experiment] of experiments.entries()) {
    if (!isRecord(experiment)) continue;
    const observations = experiment["observations"];
    if (!Array.isArray(observations)) continue;
    for (const [j, observation] of observations.entries()) {
      if (isRecord(observation) && "date" in observation) {
        edits.push({ op: "delete", path: ["experiments", i, "observations", j, "date"] });
      }
    }
  }
  return edits;
}

function recordStatusEdits(status: unknown): FieldEdit[] {
  const edits: FieldEdit[] = [{ op: "delete", path: ["status"] }];
  if (status === "reviewed") edits.push({ op: "set", path: ["reviewed"], value: true });
  else if (status === "archived") edits.push({ op: "set", path: ["archived"], value: true });
  else if (status !== "draft") throw new UnmappedStatusError({ type: "record", status });
  return edits;
}

/**
 * The edits this migration makes to one card's parsed frontmatter. Throws
 * {@link UnmappedStatusError} for a card it must not change. An empty edit
 * list means the card is already migrated.
 */
export function planStandardFields(type: string, fm: Record<string, unknown>): FieldEditPlan {
  const warnings: string[] = [];
  const edits: FieldEdit[] = [];
  if (DROP_STATUS.has(type) && "status" in fm) edits.push({ op: "delete", path: ["status"] });
  if (type === "email-outbound" && "status" in fm) {
    // Any other value would, once dropped, make the card upload as a draft.
    if (fm["status"] !== "draft") throw new UnmappedStatusError({ type: "email-outbound", status: fm["status"] });
    edits.push({ op: "delete", path: ["status"] });
  }
  if (type === "record" && "status" in fm) edits.push(...recordStatusEdits(fm["status"]));
  if ((type === "pub-submission" || JOB_TYPES.has(type)) && "created" in fm) edits.push({ op: "delete", path: ["created"] });
  if (type === "audio" && "summary" in fm) {
    const summary = fm["summary"];
    if (typeof summary === "string" && summary.trim() !== "") warnings.push("dropped a non-empty audio summary (the transcript stays)");
    edits.push({ op: "delete", path: ["summary"] });
  }
  if (type === "guide" || type === "personality") edits.push(...observationDateEdits(fm));
  return { edits, warnings };
}

// CLI entry — only when run directly (e.g. spawned by `bbx migrate`), not when
// imported by a test.
if (process.argv[1] !== undefined && import.meta.url === `file://${process.argv[1]}`) {
  await runFieldEditMigration({
    description: "Strip dead standard fields: status, created, summary, observation date (see the module comment).",
    types: HANDLED_TYPES,
    plan: planStandardFields,
  });
}

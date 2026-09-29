#!/usr/bin/env tsx
/**
 * Replace every remaining `status` field with the specific fact it recorded
 * (part 2 of docs/plans/standard-card-fields.md). Each card type's planner
 * below says what its old values become; a value with no safe mapping fails
 * that card, unchanged ({@link UnmappedStatusError}).
 *
 * Idempotent: a card without the old field is "already".
 *
 * Registered in src/core/migrations.ts. Also runnable directly:
 *   pnpm exec tsx src/scripts/migrate/status-fields.ts <boxRoot>           # dry-run
 *   pnpm exec tsx src/scripts/migrate/status-fields.ts <boxRoot> --apply
 */

import { UnmappedStatusError, runFieldEditMigration, type FieldEdit, type FieldEditPlan } from "./_field-edits.js";

type Planner = (fm: Record<string, unknown>) => FieldEditPlan;

/** Per old value: the boolean fields that replace it (none: the value is just dropped). */
type StatusMapping = Readonly<Record<string, readonly string[]>>;

/**
 * A planner that deletes `status` and sets `true` on the fields `mapping`
 * names for its value. A value `mapping` does not list is refused.
 */
function booleanPlanner(type: string, mapping: StatusMapping): Planner {
  return (fm) => {
    if (!("status" in fm)) return { edits: [], warnings: [] };
    const status = fm["status"];
    const fields = typeof status === "string" && Object.hasOwn(mapping, status) ? mapping[status] : undefined;
    if (fields === undefined) throw new UnmappedStatusError({ type, status });
    const edits: FieldEdit[] = [{ op: "delete", path: ["status"] }];
    for (const field of fields) edits.push({ op: "set", path: [field], value: true });
    return { edits, warnings: [] };
  };
}

const planAudio = booleanPlanner("audio", { new: [], transcribed: [] });

/**
 * audio: `transcript` present now means transcribed, so the status goes. A
 * `transcribed` clip without a transcript will read as untranscribed; warn.
 */
function planAudioStatus(fm: Record<string, unknown>): FieldEditPlan {
  const plan = planAudio(fm);
  if (fm["status"] === "transcribed" && fm["transcript"] === undefined) {
    plan.warnings.push("audio marked transcribed has no transcript; it now reads as untranscribed");
  }
  return plan;
}

/**
 * Per card type: the edits that replace its `status`.
 *
 * - audio, image, pdf: analysis is recorded by its result (`transcript`,
 *   `description`, `docling`) and failure by an error field, so `new`,
 *   `transcribed` and `analyzed` are dropped. An agent's `invalid` becomes
 *   `unusable: true`.
 * - capture-session, upload-batch: `delivered` and `annotated` become
 *   booleans; annotating happens after delivery. The retired pipeline's
 *   `intake-complete` (images described) and `extracted` (records pulled
 *   out after that) were never delivered to chat and become `annotated`;
 *   its `transcribing` / `transcribed` stopped before annotation and are
 *   dropped.
 */
const PLANNERS: Readonly<Record<string, Planner>> = {
  audio: planAudioStatus,
  image: booleanPlanner("image", { new: [], analyzed: [], invalid: ["unusable"] }),
  pdf: booleanPlanner("pdf", { new: [], analyzed: [], invalid: ["unusable"] }),
  "capture-session": booleanPlanner("capture-session", {
    new: [],
    delivered: ["delivered"],
    annotated: ["delivered", "annotated"],
    transcribing: [],
    transcribed: [],
    "intake-complete": ["annotated"],
    extracted: ["annotated"],
  }),
  "upload-batch": booleanPlanner("upload-batch", { new: [], delivered: ["delivered"] }),
};

/** The edits this migration makes to one card of `type`; none for a type it doesn't handle. */
export function planStatusFields(type: string, fm: Record<string, unknown>): FieldEditPlan {
  const planner = PLANNERS[type];
  return planner === undefined ? { edits: [], warnings: [] } : planner(fm);
}

// CLI entry — only when run directly (e.g. spawned by `bbx migrate`), not when
// imported by a test.
if (process.argv[1] !== undefined && import.meta.url === `file://${process.argv[1]}`) {
  await runFieldEditMigration({
    description: "Replace remaining status fields with specific facts (see the module comment).",
    types: new Set(Object.keys(PLANNERS)),
    plan: planStatusFields,
  });
}

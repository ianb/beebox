#!/usr/bin/env tsx
/**
 * Give each non-derived-from `source` its own name, and move acquisition
 * times onto the media reference (part 3 of docs/plans/standard-card-fields.md).
 * Each card type's planner below says what its old keys become; a card the
 * planner cannot convert safely fails, unchanged ({@link UnmappedFieldError}).
 *
 * Idempotent: a card without the old keys is "already".
 *
 * Registered in src/core/migrations.ts. Also runnable directly:
 *   pnpm exec tsx src/scripts/migrate/source-fields.ts <boxRoot>           # dry-run
 *   pnpm exec tsx src/scripts/migrate/source-fields.ts <boxRoot> --apply
 */

import { UnmappedFieldError, runFieldEditMigration, type FieldEdit, type FieldEditPlan } from "./_field-edits.js";
import { isRecord } from "../../shared/is-record.js";

type Planner = (fm: Record<string, unknown>) => FieldEditPlan;

/**
 * A planner that folds a media reference's time key (`timeKey`) and
 * `source` into `filename.via: { channel, at }`, placed right after
 * `filename.ref`. A `filename` that is not a map, that already has `via`
 * alongside an old key, or that lacks either old key is refused.
 */
function mediaViaPlanner({ type, timeKey }: { type: string; timeKey: string }): Planner {
  return (fm) => {
    if (!("filename" in fm)) return { edits: [], warnings: [] };
    const filename = fm["filename"];
    if (!isRecord(filename)) throw new UnmappedFieldError({ type, field: "filename", problem: "not-a-map" });
    const hasOld = timeKey in filename || "source" in filename;
    if (!hasOld) return { edits: [], warnings: [] };
    if ("via" in filename) throw new UnmappedFieldError({ type, field: "filename", problem: "old-and-new" });
    const at = filename[timeKey];
    const channel = filename["source"];
    if (at === undefined || channel === undefined) throw new UnmappedFieldError({ type, field: "filename", problem: "incomplete" });
    const edits: FieldEdit[] = [
      { op: "set", path: ["filename", "via"], value: { channel, at }, after: "ref" },
      { op: "delete", path: ["filename", timeKey] },
      { op: "delete", path: ["filename", "source"] },
    ];
    return { edits, warnings: [] };
  };
}

/** feedback: `source` (`text` | `voice`) becomes `via: { channel }`, where `source` was. */
function planFeedback(fm: Record<string, unknown>): FieldEditPlan {
  if (!("source" in fm)) return { edits: [], warnings: [] };
  if ("via" in fm) throw new UnmappedFieldError({ type: "feedback", field: "source", problem: "old-and-new" });
  const edits: FieldEdit[] = [
    { op: "set", path: ["via"], value: { channel: fm["source"] }, after: "source" },
    { op: "delete", path: ["source"] },
  ];
  return { edits, warnings: [] };
}

/**
 * Per card type: the edits that retire its old keys.
 *
 * - image, file, pdf: `filename.captured` becomes `filename.via.at` and
 *   `filename.source` becomes `filename.via.channel`.
 * - audio: the same, from `filename.recorded`.
 * - feedback: `source` becomes `via.channel`.
 */
const PLANNERS: Readonly<Record<string, Planner>> = {
  image: mediaViaPlanner({ type: "image", timeKey: "captured" }),
  file: mediaViaPlanner({ type: "file", timeKey: "captured" }),
  pdf: mediaViaPlanner({ type: "pdf", timeKey: "captured" }),
  audio: mediaViaPlanner({ type: "audio", timeKey: "recorded" }),
  feedback: planFeedback,
};

/** The edits this migration makes to one card of `type`; none for a type it doesn't handle. */
export function planSourceFields(type: string, fm: Record<string, unknown>): FieldEditPlan {
  const planner = PLANNERS[type];
  return planner === undefined ? { edits: [], warnings: [] } : planner(fm);
}

// CLI entry — only when run directly (e.g. spawned by `bbx migrate`), not when
// imported by a test.
if (process.argv[1] !== undefined && import.meta.url === `file://${process.argv[1]}`) {
  await runFieldEditMigration({
    description: "Give non-derived-from source fields their own names (see the module comment).",
    types: new Set(Object.keys(PLANNERS)),
    plan: planSourceFields,
  });
}

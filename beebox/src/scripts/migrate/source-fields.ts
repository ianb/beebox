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
 * The edits that rename `map.from` to `to` in place (the new key lands where
 * the old one was), for the map at `path`. None when `from` is absent; a map
 * with both keys is refused.
 */
function renameKey({ type, map, path, from, to }: {
  type: string;
  map: Record<string, unknown>;
  path: ReadonlyArray<string | number>;
  from: string;
  to: string;
}): FieldEdit[] {
  if (!(from in map)) return [];
  if (to in map) throw new UnmappedFieldError({ type, field: [...path, from].join("."), problem: "old-and-new" });
  return [
    { op: "set", path: [...path, to], value: map[from], after: from },
    { op: "delete", path: [...path, from] },
  ];
}

/** A planner that renames one top-level key in place. */
function renameTopLevelPlanner({ type, from, to }: { type: string; from: string; to: string }): Planner {
  return (fm) => ({ edits: renameKey({ type, map: fm, path: [], from, to }), warnings: [] });
}

/**
 * A planner that renames `source` to `basis` on every entry of the belief
 * lists at `listPaths` (each a key path to an array of maps). A list or entry
 * of another shape is left alone; the schema reports it.
 */
function beliefBasisPlanner({ type, listPaths }: { type: string; listPaths: ReadonlyArray<readonly string[]> }): Planner {
  return (fm) => {
    const edits: FieldEdit[] = [];
    for (const listPath of listPaths) {
      const list = valueAt(fm, listPath);
      if (!Array.isArray(list)) continue;
      for (const [i, entry] of list.entries()) {
        if (!isRecord(entry)) continue;
        edits.push(...renameKey({ type, map: entry, path: [...listPath, i], from: "source", to: "basis" }));
      }
    }
    return { edits, warnings: [] };
  };
}

function valueAt(fm: Record<string, unknown>, keys: readonly string[]): unknown {
  let value: unknown = fm;
  for (const key of keys) {
    if (!isRecord(value)) return undefined;
    value = value[key];
  }
  return value;
}

/**
 * A planner for a job type whose `source` was a per-type constant naming its
 * one producer: the field is dropped. Any other value is dropped too (a job
 * card is transient), with a warning naming it.
 */
function constantSourcePlanner({ type, constant }: { type: string; constant: string }): Planner {
  return (fm) => {
    if (!("source" in fm)) return { edits: [], warnings: [] };
    const warnings = fm["source"] === constant ? [] : [`${type} source ${JSON.stringify(fm["source"])} dropped`];
    return { edits: [{ op: "delete", path: ["source"] }], warnings };
  };
}

/**
 * Intake-job `source` values that name no connector: a full wakeup's pair
 * (which only repeated `priority`) and scan import. The job becomes unscoped.
 */
const INTAKE_UNSCOPED_SOURCES: ReadonlySet<unknown> = new Set(["wakeup", "wakeup-captures", "scan"]);

/**
 * intake-job: an unscoped `source` is dropped; any other value is the name of
 * the connector whose scoped wakeup made the job, and becomes `connector`.
 */
function planIntakeJob(fm: Record<string, unknown>): FieldEditPlan {
  if (!("source" in fm)) return { edits: [], warnings: [] };
  if ("connector" in fm) throw new UnmappedFieldError({ type: "intake-job", field: "source", problem: "old-and-new" });
  if (INTAKE_UNSCOPED_SOURCES.has(fm["source"])) return { edits: [{ op: "delete", path: ["source"] }], warnings: [] };
  return { edits: renameKey({ type: "intake-job", map: fm, path: [], from: "source", to: "connector" }), warnings: [] };
}

/**
 * Per card type: the edits that retire its old keys.
 *
 * - image, file, pdf: `filename.captured` becomes `filename.via.at` and
 *   `filename.source` becomes `filename.via.channel`.
 * - audio: the same, from `filename.recorded`.
 * - feedback: `source` becomes `via.channel`.
 * - contains-backfill-job, question-followup-job, todo-review-job: the
 *   constant `source` is dropped.
 * - chat-job: `source` becomes `connector`.
 * - intake-job: see {@link planIntakeJob}.
 * - guide `triage-rules[]`, personality `boxholder.relationships[]`, `tone[]`
 *   and `traits[]`: `source` becomes `basis`.
 * - scheduled-script: `source` becomes `reason`.
 * - capture-session: `source` becomes `uploader`.
 */
const PLANNERS: Readonly<Record<string, Planner>> = {
  image: mediaViaPlanner({ type: "image", timeKey: "captured" }),
  file: mediaViaPlanner({ type: "file", timeKey: "captured" }),
  pdf: mediaViaPlanner({ type: "pdf", timeKey: "captured" }),
  audio: mediaViaPlanner({ type: "audio", timeKey: "recorded" }),
  feedback: planFeedback,
  "contains-backfill-job": constantSourcePlanner({ type: "contains-backfill-job", constant: "contains-backfill" }),
  "question-followup-job": constantSourcePlanner({ type: "question-followup-job", constant: "question-answer" }),
  "todo-review-job": constantSourcePlanner({ type: "todo-review-job", constant: "todo-review" }),
  "chat-job": renameTopLevelPlanner({ type: "chat-job", from: "source", to: "connector" }),
  "intake-job": planIntakeJob,
  guide: beliefBasisPlanner({ type: "guide", listPaths: [["triage-rules"]] }),
  personality: beliefBasisPlanner({
    type: "personality",
    listPaths: [["boxholder", "relationships"], ["tone"], ["traits"]],
  }),
  "scheduled-script": renameTopLevelPlanner({ type: "scheduled-script", from: "source", to: "reason" }),
  "capture-session": renameTopLevelPlanner({ type: "capture-session", from: "source", to: "uploader" }),
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

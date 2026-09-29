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
import { isRecord } from "../../shared/is-record.js";

type Planner = (fm: Record<string, unknown>) => FieldEditPlan;

/** Per old value: the boolean fields that replace it (none: the value is just dropped). */
type StatusMapping = Readonly<Record<string, readonly string[]>>;

/**
 * A planner that deletes `status` and sets `true` on the fields `mapping`
 * names for its value. A value `mapping` does not list is refused.
 */
function booleanPlanner(type: string, mapping: StatusMapping): Planner {
  const values: ValueMapping = Object.fromEntries(
    Object.entries(mapping).map(([status, fields]) => [status, Object.fromEntries(fields.map((field) => [field, true]))]),
  );
  return (fm) => ({ edits: mappedStatusEdits({ where: type, base: [], entry: fm, mapping: values }), warnings: [] });
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

/** What one old value becomes: fields to set (with their values). Empty: just dropped. */
type ValueMapping = Readonly<Record<string, Readonly<Record<string, unknown>>>>;

/**
 * The edits that replace `status` in the map at `base` (the frontmatter, or
 * one entry of a nested list) per `mapping`. No `status`: no edits. A value
 * `mapping` does not list is refused, naming `where`.
 */
function mappedStatusEdits({ where, base, entry, mapping }: {
  where: string;
  base: ReadonlyArray<string | number>;
  entry: Record<string, unknown>;
  mapping: ValueMapping;
}): FieldEdit[] {
  if (!("status" in entry)) return [];
  const status = entry["status"];
  const sets = typeof status === "string" && Object.hasOwn(mapping, status) ? mapping[status] : undefined;
  if (sets === undefined) throw new UnmappedStatusError({ type: where, status });
  const edits: FieldEdit[] = [{ op: "delete", path: [...base, "status"] }];
  for (const [field, value] of Object.entries(sets)) edits.push({ op: "set", path: [...base, field], value });
  return edits;
}

/**
 * The edits that rename `status` to `to` in the map at `base`, keeping the
 * value. A map that already has `to` is refused: the two would collide.
 */
function renameStatusEdits({ where, base, entry, to }: {
  where: string;
  base: ReadonlyArray<string | number>;
  entry: Record<string, unknown>;
  to: string;
}): FieldEdit[] {
  if (!("status" in entry)) return [];
  if (to in entry) throw new UnmappedStatusError({ type: `${where} (already has ${to})`, status: entry["status"] });
  return [
    { op: "delete", path: [...base, "status"] },
    { op: "set", path: [...base, to], value: entry["status"] },
  ];
}

/** A planner that applies `edit` to each map entry of the list at `field`. */
function nestedPlanner({ type, field, edit }: {
  type: string;
  field: string;
  edit: (args: { where: string; base: ReadonlyArray<string | number>; entry: Record<string, unknown> }) => FieldEdit[];
}): Planner {
  return (fm) => {
    const list = fm[field];
    if (!Array.isArray(list)) return { edits: [], warnings: [] };
    const edits: FieldEdit[] = [];
    for (const [i, entry] of list.entries()) {
      if (isRecord(entry)) edits.push(...edit({ where: `${type} ${field}[${String(i)}]`, base: [field, i], entry }));
    }
    return { edits, warnings: [] };
  };
}

/** Old experiment stages: `active` runs, a result becomes the `outcome`. */
const EXPERIMENT_MAPPING: ValueMapping = {
  proposed: {},
  active: { active: true },
  successful: { outcome: "successful" },
  unsuccessful: { outcome: "unsuccessful" },
  mixed: { outcome: "mixed" },
  inconclusive: { outcome: "inconclusive" },
};

const planExperiments = (type: string): Planner =>
  nestedPlanner({ type, field: "experiments", edit: (args) => mappedStatusEdits({ ...args, mapping: EXPERIMENT_MAPPING }) });

/** Used when a failed telegram message carries no `error` to move over. */
export const TELEGRAM_UNRECORDED_FAILURE =
  "Delivery failed before this card recorded why (the failure predates delivery-error)";

/**
 * telegram-message: `pending` and `sent` are dropped; `failed` becomes
 * `delivery-error`, carrying the old `error` text. A pending or sent card
 * with an `error` is refused: it is not clear whether to retry it.
 */
function planTelegramMessage(fm: Record<string, unknown>): FieldEditPlan {
  if (!("status" in fm)) return { edits: [], warnings: [] };
  const status = fm["status"];
  const error = fm["error"];
  const edits: FieldEdit[] = [{ op: "delete", path: ["status"] }];
  if (status === "failed") {
    edits.push(
      { op: "delete", path: ["error"] },
      { op: "set", path: ["delivery-error"], value: typeof error === "string" && error !== "" ? error : TELEGRAM_UNRECORDED_FAILURE },
    );
    return { edits, warnings: [] };
  }
  if ((status === "pending" || status === "sent") && error === undefined) return { edits, warnings: [] };
  throw new UnmappedStatusError({ type: "telegram-message", status });
}

/** todo-view: `status` is its todo-status filter, renamed. */
function planTodoView(fm: Record<string, unknown>): FieldEditPlan {
  return { edits: renameStatusEdits({ where: "todo-view", base: [], entry: fm, to: "todo-status" }), warnings: [] };
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
 * - telegram-message: see {@link planTelegramMessage}.
 * - browser-task `closed`, tab-arrangement `ready`, person and place
 *   `archived` become booleans; `inactive` people and places are archived.
 * - todo-view: `status` (a filter of todo statuses) is renamed `todo-status`.
 * - lesson-plan segments: `planned` becomes `planned: true`; `ready` goes
 *   (the `material` ref says the card exists).
 * - progress entries: `status` (a mastery level) is renamed `level`.
 * - guide and personality experiments: `proposed` goes, `active` becomes
 *   `active: true`, and a result becomes `outcome: <result>`.
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
  "telegram-message": planTelegramMessage,
  "browser-task": booleanPlanner("browser-task", { open: [], closed: ["closed"] }),
  "tab-arrangement": booleanPlanner("tab-arrangement", { draft: [], ready: ["ready"] }),
  person: booleanPlanner("person", { active: [], inactive: ["archived"], archived: ["archived"] }),
  place: booleanPlanner("place", { active: [], inactive: ["archived"], archived: ["archived"] }),
  "todo-view": planTodoView,
  "lesson-plan": nestedPlanner({
    type: "lesson-plan",
    field: "segments",
    edit: (args) => mappedStatusEdits({ ...args, mapping: { planned: { planned: true }, ready: {} } }),
  }),
  progress: nestedPlanner({ type: "progress", field: "entries", edit: (args) => renameStatusEdits({ ...args, to: "level" }) }),
  guide: planExperiments("guide"),
  personality: planExperiments("personality"),
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

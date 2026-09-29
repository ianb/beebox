/**
 * Replace every remaining `status` field with the specific fact it recorded
 * (part 2 of docs/implemented-plans/standard-card-fields.md). Each card type's planner
 * below says what its old values become; a value with no safe mapping fails
 * that card, unchanged ({@link UnmappedStatusError}).
 *
 * Idempotent: a card without the old field is "already".
 *
 * Applied by `src/scripts/migrate/card-fields/run.ts`, which runs this planner
 * together with the other card-field planners in one pass (see that file).
 */

import { UnmappedStatusError, type FieldEdit, type FieldEditPlan } from "./field-edits.js";
import { isRecord } from "../../../shared/is-record.js";

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

/** Used when a failed folder mount carries no `error` to say why. */
export const GFOLDER_UNRECORDED_FAILURE =
  "The last sync failed before this card recorded why (the failure predates the error field)";

/**
 * gfolder: `error` present now means the last sync failed, so `status` goes.
 * A failed mount with no `error` text gets a fixed message; an `ok` mount
 * that still carries an `error` is refused, since the new shape would read it
 * as failed.
 */
function planGfolder(fm: Record<string, unknown>): FieldEditPlan {
  if (!("status" in fm)) return { edits: [], warnings: [] };
  const status = fm["status"];
  const error = fm["error"];
  const edits: FieldEdit[] = [{ op: "delete", path: ["status"] }];
  if (status === "error") {
    if (typeof error !== "string" || error === "") edits.push({ op: "set", path: ["error"], value: GFOLDER_UNRECORDED_FAILURE });
    return { edits, warnings: [] };
  }
  if (status === "ok" && error === undefined) return { edits, warnings: [] };
  throw new UnmappedStatusError({ type: "gfolder", status });
}

/**
 * procedure-run: a finished run's `completed` / `failed` / `inconclusive`
 * becomes its `outcome`. The engine never wrote `pending`; `running` (live, or
 * a run that was interrupted) is the absence of an outcome. A card that
 * already has an `outcome` is refused.
 */
function planProcedureRun(fm: Record<string, unknown>): FieldEditPlan {
  if (!("status" in fm)) return { edits: [], warnings: [] };
  if ("outcome" in fm) throw new UnmappedStatusError({ type: "procedure-run (already has outcome)", status: fm["status"] });
  const edits = mappedStatusEdits({
    where: "procedure-run",
    base: [],
    entry: fm,
    mapping: {
      pending: {},
      running: {},
      completed: { outcome: "completed" },
      failed: { outcome: "failed" },
      inconclusive: { outcome: "inconclusive" },
    },
  });
  return { edits, warnings: [] };
}

/** Per old question status: the lifecycle fields it required, and all it allowed. */
const QUESTION_LIFECYCLE: Readonly<Record<string, { required: readonly string[]; allowed: readonly string[] }>> = {
  pending: { required: [], allowed: [] },
  answered: { required: ["answer", "answered-at"], allowed: ["answer", "answered-at", "answered-via"] },
  dismissed: { required: ["dismissed-at"], allowed: ["dismissed-at"] },
  expired: { required: ["expired-at"], allowed: ["expired-at"] },
};
const QUESTION_LIFECYCLE_FIELDS = ["answer", "answered-at", "answered-via", "dismissed-at", "expired-at"];

/**
 * question: the state is now read from the lifecycle timestamps
 * (`questionState` in the schema), so `status` is dropped when the fields
 * agree with it, by the rule the schema enforced until now. A card whose
 * fields disagree with its status, or whose status is unknown, is refused:
 * it could not load before this change either.
 */
function planQuestion(fm: Record<string, unknown>): FieldEditPlan {
  if (!("status" in fm)) return { edits: [], warnings: [] };
  const status = fm["status"];
  const rule = typeof status === "string" && Object.hasOwn(QUESTION_LIFECYCLE, status) ? QUESTION_LIFECYCLE[status] : undefined;
  if (rule === undefined) throw new UnmappedStatusError({ type: "question", status });
  const coherent =
    rule.required.every((field) => fm[field] !== undefined) &&
    QUESTION_LIFECYCLE_FIELDS.every((field) => fm[field] === undefined || rule.allowed.includes(field));
  if (!coherent) throw new UnmappedStatusError({ type: "question (lifecycle fields disagree)", status });
  return { edits: [{ op: "delete", path: ["status"] }], warnings: [] };
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
 * - gdoc: `conflict` becomes `conflict: true`; `synced`, `new` and `error`
 *   are dropped (the connector never wrote `new` or `error`, and recomputes
 *   `conflict` on every pull).
 * - gfolder: see {@link planGfolder}. procedure-run: see
 *   {@link planProcedureRun}. question: see {@link planQuestion}.
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
  gdoc: booleanPlanner("gdoc", { synced: [], new: [], error: [], conflict: ["conflict"] }),
  gfolder: planGfolder,
  "procedure-run": planProcedureRun,
  question: planQuestion,
};

/** The edits this migration makes to one card of `type`; none for a type it doesn't handle. */
/** The card types with a planner. */
export const STATUS_FIELD_TYPES: ReadonlySet<string> = new Set(Object.keys(PLANNERS));

export function planStatusFields(type: string, fm: Record<string, unknown>): FieldEditPlan {
  const planner = PLANNERS[type];
  return planner === undefined ? { edits: [], warnings: [] } : planner(fm);
}

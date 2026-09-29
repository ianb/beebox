#!/usr/bin/env tsx
/**
 * Give each non-derived-from `source` its own name, move acquisition times
 * onto the media reference, and put derived-from pointers in `sources` (part 3
 * of docs/plans/standard-card-fields.md).
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
 * A planner that renames `from` to `to` on every entry of the lists at
 * `listPaths` (each a key path to an array of maps). A list or entry of
 * another shape is left alone; the schema reports it.
 */
function listEntryRenamePlanner({ type, listPaths, from, to }: {
  type: string;
  listPaths: ReadonlyArray<readonly string[]>;
  from: string;
  to: string;
}): Planner {
  return (fm) => {
    const edits: FieldEdit[] = [];
    for (const listPath of listPaths) {
      const list = valueAt(fm, listPath);
      if (!Array.isArray(list)) continue;
      for (const [i, entry] of list.entries()) {
        if (!isRecord(entry)) continue;
        edits.push(...renameKey({ type, map: entry, path: [...listPath, i], from, to }));
      }
    }
    return { edits, warnings: [] };
  };
}

/** Guide and personality belief lists: each entry's `source` becomes `basis`. */
function beliefBasisPlanner({ type, listPaths }: { type: string; listPaths: ReadonlyArray<readonly string[]> }): Planner {
  return listEntryRenamePlanner({ type, listPaths, from: "source", to: "basis" });
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

/** A planner that runs each of `planners` and joins their edits and warnings. */
function allOf(...planners: Planner[]): Planner {
  return (fm) => {
    const plans = planners.map((planner) => planner(fm));
    return { edits: plans.flatMap((p) => p.edits), warnings: plans.flatMap((p) => p.warnings) };
  };
}

/**
 * A planner that replaces top-level `from` with `to: wrap(value)`, where
 * `from` was. A card with both keys is refused.
 */
function wrapTopLevelPlanner({ type, from, to, wrap }: {
  type: string;
  from: string;
  to: string;
  wrap: (value: unknown) => unknown;
}): Planner {
  return (fm) => {
    if (!(from in fm)) return { edits: [], warnings: [] };
    if (to in fm) throw new UnmappedFieldError({ type, field: from, problem: "old-and-new" });
    const edits: FieldEdit[] = [
      { op: "set", path: [to], value: wrap(fm[from]), after: from },
      { op: "delete", path: [from] },
    ];
    return { edits, warnings: [] };
  };
}

/**
 * webpage: `source` (the page URL) and `captured` (the capture instant)
 * become the one entry `sources: [{ href, retrieved }]`, where `source` was.
 * A card with `sources` alongside either old key, or with `captured` but no
 * `source`, is refused.
 */
function planWebpage(fm: Record<string, unknown>): FieldEditPlan {
  const hasSource = "source" in fm;
  const hasCaptured = "captured" in fm;
  if (!hasSource && !hasCaptured) return { edits: [], warnings: [] };
  if ("sources" in fm) throw new UnmappedFieldError({ type: "webpage", field: hasSource ? "source" : "captured", problem: "old-and-new" });
  if (!hasSource) throw new UnmappedFieldError({ type: "webpage", field: "captured", problem: "incomplete" });
  const entry: Record<string, unknown> = { href: fm["source"] };
  if (hasCaptured) entry["retrieved"] = fm["captured"];
  const edits: FieldEdit[] = [
    { op: "set", path: ["sources"], value: [entry], after: "source" },
    { op: "delete", path: ["source"] },
    { op: "delete", path: ["captured"] },
  ];
  return { edits, warnings: [] };
}

/**
 * recipe: the `source` object (`{ label?, href?, ref? }`) becomes the one
 * entry of `sources`, where `source` was. A `source` that is not a map, or
 * that has both `href` and `ref`, is refused.
 */
function planRecipe(fm: Record<string, unknown>): FieldEditPlan {
  if (!("source" in fm)) return { edits: [], warnings: [] };
  const source = fm["source"];
  if (!isRecord(source)) throw new UnmappedFieldError({ type: "recipe", field: "source", problem: "not-a-map" });
  if ("href" in source && "ref" in source) throw new UnmappedFieldError({ type: "recipe", field: "source", problem: "two-pointers" });
  return wrapTopLevelPlanner({ type: "recipe", from: "source", to: "sources", wrap: (value) => [value] })(fm);
}

/**
 * commentary: `source` (the annotated page's URL) becomes `about: { href }`,
 * where `source` was, and `captured` (the date the page was captured) becomes
 * `about.retrieved`. A card with `about` alongside `source`, or with
 * `captured` but no page to attach it to, is refused.
 */
function planCommentary(fm: Record<string, unknown>): FieldEditPlan {
  const hasSource = "source" in fm;
  const hasCaptured = "captured" in fm;
  if (!hasSource && !hasCaptured) return { edits: [], warnings: [] };
  const about = fm["about"];
  if (hasSource) {
    if (about !== undefined) throw new UnmappedFieldError({ type: "commentary", field: "source", problem: "old-and-new" });
    const value: Record<string, unknown> = { href: fm["source"] };
    if (hasCaptured) value["retrieved"] = fm["captured"];
    const edits: FieldEdit[] = [
      { op: "set", path: ["about"], value, after: "source" },
      { op: "delete", path: ["source"] },
      { op: "delete", path: ["captured"] },
    ];
    return { edits, warnings: [] };
  }
  if (!isRecord(about)) throw new UnmappedFieldError({ type: "commentary", field: "captured", problem: "incomplete" });
  if ("retrieved" in about) throw new UnmappedFieldError({ type: "commentary", field: "captured", problem: "old-and-new" });
  const edits: FieldEdit[] = [
    { op: "set", path: ["about", "retrieved"], value: fm["captured"] },
    { op: "delete", path: ["captured"] },
  ];
  return { edits, warnings: [] };
}

/**
 * A planner that moves top-level keys under one source-metadata key named
 * for the external system (`email`, `drive`). `moves` lists
 * `[oldKey, newKey]` pairs in the order the connector writes them; the
 * object lands where the card's first old key was. A card that already has
 * `key` alongside an old key is refused.
 */
function sourceMetadataPlanner({ type, key, moves }: {
  type: string;
  key: string;
  moves: ReadonlyArray<readonly [string, string]>;
}): Planner {
  return (fm) => {
    const present = moves.filter(([from]) => from in fm);
    const first = Object.keys(fm).find((name) => present.some(([from]) => from === name));
    if (first === undefined) return { edits: [], warnings: [] };
    if (key in fm) throw new UnmappedFieldError({ type, field: first, problem: "old-and-new" });
    const value: Record<string, unknown> = {};
    for (const [from, to] of present) value[to] = fm[from];
    const edits: FieldEdit[] = [
      { op: "set", path: [key], value, after: first },
      ...present.map(([from]): FieldEdit => ({ op: "delete", path: [from] })),
    ];
    return { edits, warnings: [] };
  };
}

/** The keys a key moves under unchanged. */
function same(...keys: string[]): Array<readonly [string, string]> {
  return keys.map((name) => [name, name] as const);
}

/**
 * Per card type: the edits that retire its old keys.
 *
 * - image, file, pdf: `filename.captured` becomes `filename.via.at` and
 *   `filename.source` becomes `filename.via.channel`. An image's `text[]`
 *   entries rename `source` (the surface the text is on) to `surface`.
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
 * - record `sources[]`: `time` (a moment in a transcript) becomes `pos`.
 * - webpage: see {@link planWebpage}.
 * - recipe: see {@link planRecipe}.
 * - commentary: see {@link planCommentary}.
 * - browser-task: `source` (the start URL) becomes `start: { href }`.
 * - tab-arrangement: `source` (the captured tabs) becomes `captured-tabs`.
 * - email-message: the headers the Gmail connector copied (`message-id`,
 *   `thread-id`, `from`, `to`, `cc`, `subject`, `snippet`) move under
 *   `email:`, and `date` (Gmail's arrival time) becomes `email.received`.
 * - email-thread: `thread-id`, `subject`, `participants`, `date-range` and
 *   `labels` move under `email:`.
 * - gdoc, gsheet: what the Drive connector copied moves under `drive:`
 *   (`drive-id` becomes `drive.id`; `link`, `owner`, `modified` and gdoc's
 *   `revision` keep their names).
 * - gfolder: `drive-id` and `link` move under `drive:`; `name` (the Drive
 *   name) becomes `title`, in place.
 * - glink: `drive-id`, `link` and `mime` move under `drive:`; `name` becomes
 *   `title`, in place.
 */
const PLANNERS: Readonly<Record<string, Planner>> = {
  image: allOf(
    mediaViaPlanner({ type: "image", timeKey: "captured" }),
    listEntryRenamePlanner({ type: "image", listPaths: [["text"]], from: "source", to: "surface" }),
  ),
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
  record: listEntryRenamePlanner({ type: "record", listPaths: [["sources"]], from: "time", to: "pos" }),
  webpage: planWebpage,
  recipe: planRecipe,
  commentary: planCommentary,
  "browser-task": wrapTopLevelPlanner({ type: "browser-task", from: "source", to: "start", wrap: (href) => ({ href }) }),
  "tab-arrangement": renameTopLevelPlanner({ type: "tab-arrangement", from: "source", to: "captured-tabs" }),
  "email-message": sourceMetadataPlanner({
    type: "email-message",
    key: "email",
    moves: [...same("message-id", "thread-id", "from", "to", "cc"), ["date", "received"], ...same("subject", "snippet")],
  }),
  "email-thread": sourceMetadataPlanner({
    type: "email-thread",
    key: "email",
    moves: same("thread-id", "subject", "participants", "date-range", "labels"),
  }),
  gdoc: sourceMetadataPlanner({
    type: "gdoc",
    key: "drive",
    moves: [["drive-id", "id"], ...same("link", "owner", "modified", "revision")],
  }),
  gsheet: sourceMetadataPlanner({
    type: "gsheet",
    key: "drive",
    moves: [["drive-id", "id"], ...same("link", "owner", "modified")],
  }),
  gfolder: allOf(
    sourceMetadataPlanner({ type: "gfolder", key: "drive", moves: [["drive-id", "id"], ...same("link")] }),
    renameTopLevelPlanner({ type: "gfolder", from: "name", to: "title" }),
  ),
  glink: allOf(
    sourceMetadataPlanner({ type: "glink", key: "drive", moves: [["drive-id", "id"], ...same("link", "mime")] }),
    renameTopLevelPlanner({ type: "glink", from: "name", to: "title" }),
  ),
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

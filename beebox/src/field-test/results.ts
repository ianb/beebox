/**
 * The raw result of a field run — what `results.json` holds
 * (`docs/plans/agent-field-tests.md`, Track 2).
 *
 * Deliberately dumb: plain data, no formatting, no judgement. Track 5's report
 * writer turns this into `report.md`, and a triage agent reads one or the
 * other. Keeping the shape flat and typed is what lets the two evolve apart —
 * the run records what happened, the report decides what it means.
 *
 * Written after EVERY item, not once at the end: a run that dies at item five
 * must still leave four items' evidence behind, since re-running costs an hour
 * of a real Opus operator.
 */

import * as path from "node:path";
import * as fs from "node:fs/promises";
import { z } from "zod";
import { writeFileAtomic } from "../lib/atomic-write.js";
import type { DebriefResult } from "./questionnaire.js";
import type { OperatorTurnStatus } from "./operator-turns.js";
import type { FieldCleanupPolicy } from "./scenario.js";
import type { QuiescenceOutcome } from "./quiescence.js";

/** Filename of the raw result inside the run directory. */
const RESULTS_FILENAME = "results.json";

export interface PreActionResult {
  type: "inject-email" | "advance-days";
  /** Human-readable subject: the fixture name, or "3 days → 2026-08-13T…". */
  detail: string;
  ok: boolean;
  error: string | null;
}

export interface CheckResult {
  /** Script filename inside the scenario's `checks/`. */
  script: string;
  passed: boolean;
  exitCode: number | null;
  stdout: string;
  stderr: string;
}

/** The operator's turn statuses, plus the one the harness itself produces: an
 *  item whose `pre` actions failed never reaches the operator at all. */
export type ActivityStatus = OperatorTurnStatus | "harness-skipped";

export interface ActivityResult {
  status: ActivityStatus;
  turns: number;
  /** The operator's own closing note, verbatim. */
  note: string;
  error: string | null;
}

export interface CleanupResult {
  policy: FieldCleanupPolicy;
  /** Checkpoint tag written after the item, whatever the policy. */
  tag: string;
  /** HEAD the checkpoint names. */
  head: string;
  /** For `reset`: the checkpoint the box was rewound to. */
  resetTo: string | null;
  /** For `reset`: whether the server was restarted afterwards. */
  serverRestarted: boolean;
  error: string | null;
}

export interface ItemResult {
  id: string;
  brief: string;
  /** Screenshot subdirectory for this item, relative to the run directory. */
  screenshotsDir: string;
  pre: PreActionResult[];
  activity: ActivityResult;
  /** Null when the debrief was skipped — see `debriefSkipped`. */
  debrief: DebriefResult | null;
  /** Why no debrief was asked, or null. */
  debriefSkipped: string | null;
  quiescence: QuiescenceOutcome;
  checks: CheckResult[];
  cleanup: CleanupResult;
  /** Harness-level notes for this item (retries, restarts, surprises). */
  events: string[];
}

export interface FieldRunResult {
  scenario: string;
  scenarioDir: string;
  runDir: string;
  /** Real wall-clock, ISO — when the harness started and finished. */
  startedAt: string;
  finishedAt: string | null;
  /** The box's simulated clock at the start, and after any day advances. */
  boxTimeStart: string;
  boxTimeEnd: string;
  models: { operator: string; chat: string };
  serverBaseUrl: string;
  browseSession: string;
  items: ItemResult[];
  /** Set when the run stopped early; `itemId` is where it stopped. */
  aborted: { itemId: string | null; reason: string } | null;
  /** Harness events not belonging to any one item. */
  events: string[];
}

/** Write (or rewrite) `results.json` in the run directory. */
export async function writeRunResults(result: FieldRunResult): Promise<void> {
  await writeFileAtomic(path.join(result.runDir, RESULTS_FILENAME), {
    content: `${JSON.stringify(result, null, 2)}\n`,
  });
}

// Read-side validation (principle #3, validate-at-boundaries): `results.json`
// is written by this module, but `loadRunResults` reads it back in a SEPARATE
// process (`bbx field-test report <run-dir>`, run any time after the writer
// exited), so a hand-edited or truncated file must fail loudly here rather
// than flow a malformed value into the report writer. Kept in lockstep with
// the interfaces above by hand — there is no schema-from-type derivation in
// this codebase's zod usage, so a shape change to any interface above needs
// the matching schema edit below.

const PreActionResultSchema = z.strictObject({
  type: z.enum(["inject-email", "advance-days"]),
  detail: z.string(),
  ok: z.boolean(),
  error: z.string().nullable(),
});

const CheckResultSchema = z.strictObject({
  script: z.string(),
  passed: z.boolean(),
  exitCode: z.number().nullable(),
  stdout: z.string(),
  stderr: z.string(),
});

const ActivityStatusSchema = z.enum(["completed", "turn-capped", "timed-out", "error", "harness-skipped"]);

const ActivityResultSchema = z.strictObject({
  status: ActivityStatusSchema,
  turns: z.number(),
  note: z.string(),
  error: z.string().nullable(),
});

const CleanupResultSchema = z.strictObject({
  policy: z.enum(["keep", "commit", "reset"]),
  tag: z.string(),
  head: z.string(),
  resetTo: z.string().nullable(),
  serverRestarted: z.boolean(),
  error: z.string().nullable(),
});

const QuestionAnswerSchema = z.strictObject({
  id: z.string(),
  question: z.string(),
  answer: z.string(),
  reAsked: z.boolean(),
});

const ScreenshotRefSchema = z.strictObject({ filename: z.string(), resolved: z.boolean() });

const DebriefResultSchema = z.strictObject({
  answers: z.array(QuestionAnswerSchema),
  outcome: z.enum(["smooth", "friction", "blocked", "unresolved"]),
  outcomeReason: z.string().nullable(),
  unanswered: z.array(z.string()),
  screenshotRefs: z.array(ScreenshotRefSchema),
  missingScreenshots: z.array(z.string()),
});

const QuiescenceOutcomeSchema = z.strictObject({
  quiescent: z.boolean(),
  waitedMs: z.number(),
  stuck: z.array(z.strictObject({ name: z.string(), detail: z.string().nullable() })),
});

const ItemResultSchema = z.strictObject({
  id: z.string(),
  brief: z.string(),
  screenshotsDir: z.string(),
  pre: z.array(PreActionResultSchema),
  activity: ActivityResultSchema,
  debrief: DebriefResultSchema.nullable(),
  debriefSkipped: z.string().nullable(),
  quiescence: QuiescenceOutcomeSchema,
  checks: z.array(CheckResultSchema),
  cleanup: CleanupResultSchema,
  events: z.array(z.string()),
});

const FieldRunResultSchema = z.strictObject({
  scenario: z.string(),
  scenarioDir: z.string(),
  runDir: z.string(),
  startedAt: z.string(),
  finishedAt: z.string().nullable(),
  boxTimeStart: z.string(),
  boxTimeEnd: z.string(),
  models: z.strictObject({ operator: z.string(), chat: z.string() }),
  serverBaseUrl: z.string(),
  browseSession: z.string(),
  items: z.array(ItemResultSchema),
  aborted: z.strictObject({ itemId: z.string().nullable(), reason: z.string() }).nullable(),
  events: z.array(z.string()),
});

/** Read and validate `results.json` from a run directory (the report writer's
 *  input when regenerating a report from an already-finished run). */
export async function loadRunResults(runDir: string): Promise<FieldRunResult> {
  const raw = await fs.readFile(path.join(runDir, RESULTS_FILENAME), "utf-8");
  return FieldRunResultSchema.parse(JSON.parse(raw));
}

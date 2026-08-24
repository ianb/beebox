/**
 * Shared types for the procedure engine and its sibling modules.
 *
 * Leaf module: no value imports from other engine-* files, so it can be
 * imported anywhere without creating an import cycle.
 */

import { type createAgent as realCreateAgent } from "../agent/index.js";
import type { ProcedureModelName } from "../../shared/agent-models.js";
import type { RunStepResult, ProcedureRunFields } from "../../schemas/procedure-run.js";
import type { ProcedureStepDef } from "../../schemas/procedure.js";
import type { InconclusiveReason } from "../../shared/inconclusive.js";

// Status/severity vocabularies, derived from the card schemas' z.enums so the
// engine's in-memory shapes can't drift from what validates on disk (Track B).
/** The run's overall lifecycle status. */
export type RunStatus = ProcedureRunFields["status"];
/** A step's lifecycle status (pending → running → completed/skipped/failed). */
export type StepStatus = RunStepResult["status"];
/** A precheck phase's outcome (pass/fail/skip). */
export type PrecheckStatus = NonNullable<RunStepResult["precheck"]>["status"];
/** A validate phase's outcome (pass/fail/warn/inconclusive). */
export type ValidateStatus = NonNullable<RunStepResult["validate"]>["status"];
/** How a failing validation phase gates the step (warn/review/abort). */
export type ProcedureSeverity = NonNullable<NonNullable<ProcedureStepDef["validate"]>["severity"]>;

/**
 * Why a procedure operation failed, in the {@link Result} error arm returned by
 * the engine's public functions. The cause lets callers dispatch (today they
 * only surface `message`, but the tag keeps the distinctions the free-text
 * strings used to blur):
 * - `not-found` — a procedure definition or named step doesn't exist.
 * - `parse` — a run card couldn't be read/parsed as valid frontmatter.
 * - `resume` — a resume request can't proceed (no run, or the step is gone).
 * - `step-failed` — the run executed but a step gated the procedure.
 */
export type ProcedureErrorCause = "not-found" | "parse" | "resume" | "step-failed";

export interface ProcedureError {
  cause: ProcedureErrorCause;
  message: string;
}

/**
 * Legal run-status transitions, encoding the lifecycle the run-card schema
 * documents (`pending → running → completed/failed`) plus the two moves the
 * engine actually makes that the prose glosses over:
 *
 * - `running → running` — resuming a run interrupted mid-execution (its
 *   on-disk status is still `running`); re-stamping it is idempotent.
 * - `failed → running` — resuming a failed run re-opens it (engine.ts:253).
 *   A `completed` run is never re-opened: `resumeProcedure` returns early
 *   before writing, so `completed` is terminal here.
 *
 * Keyed by `RunStatus`, so adding a status to the schema enum fails to compile
 * until its transitions are declared — the table can't silently drift from the
 * vocabulary. `isLegalRunStatusTransition` is the pure predicate the write
 * boundary (`updateRunCardStatus`) asserts against.
 */
const RUN_STATUS_TRANSITIONS: Record<RunStatus, readonly RunStatus[]> = {
  pending: ["running"],
  running: ["running", "completed", "failed", "inconclusive"],
  completed: [],
  // An inconclusive run's work is done but unjudged; resuming re-opens it the
  // same way a failed run re-opens, so a later run can try for a verdict.
  inconclusive: ["running"],
  failed: ["running"],
};

/** Whether `s` is a known run status (a key of the transition table). */
export function isRunStatus(s: string): s is RunStatus {
  return Object.prototype.hasOwnProperty.call(RUN_STATUS_TRANSITIONS, s);
}

/** Whether the run may move from `from` to `to` per {@link RUN_STATUS_TRANSITIONS}. */
export function isLegalRunStatusTransition(from: RunStatus, to: RunStatus): boolean {
  return RUN_STATUS_TRANSITIONS[from].includes(to);
}

/** Agent factory type — matches createAgent() signature */
export type AgentFactory = typeof realCreateAgent;

export interface ProcedureOptions {
  dryRun?: boolean;
  force?: boolean;
  /** Run only this step (by id), skip all others */
  step?: string;
  /** Run this step (by id) and every step after it — used by resume */
  fromStep?: string;
  /** Runtime directive string passed to procedure agents */
  directive?: string;
  /** Override the agent factory (default: createAgent from agent.ts) */
  createAgent?: AgentFactory;
}

// ─── Types for parsed procedure definitions ───────────────────────────

export interface ParsedPhase {
  shells: string[];
  agents: Array<{ prompt: string; model?: ProcedureModelName; maxTurns?: number }>;
  instructions: string[];
  whys: string[];
}

export interface ParsedStep {
  id: string;
  description: string;
  precheck?: ParsedPhase & { passOutput?: boolean };
  run?: ParsedPhase;
  validate?: { phase: ParsedPhase; severity: ProcedureSeverity; model?: ProcedureModelName };
}

export interface ParsedProcedure {
  name: string;
  description: string;
  steps: ParsedStep[];
  /** Override for completed-run expiry: duration ("60d") or "never" */
  runExpiry?: string;
  /** Override for failed-run expiry: duration ("180d") or "never" */
  failedRunExpiry?: string;
}

/**
 * One step whose work completed but whose review never reached a verdict.
 * Carried out of the engine so the CLI can report the non-answer as a
 * non-answer instead of letting it read as success or as failure.
 */
export interface ProcedureInconclusive {
  stepId: string;
  reason: InconclusiveReason;
  /** Human phrase for the reason, e.g. "reached max turns (8)". */
  detail: string;
}

/**
 * How a run that did NOT fail ended. `completed` is the ordinary success;
 * `inconclusive` means every step's work succeeded but at least one review
 * produced no verdict. A failed run is the `Result` error arm, not this.
 */
export interface ProcedureOutcome {
  status: "completed" | "inconclusive";
  /** The procedure this outcome describes, for diagnostics that name it. */
  procedure: string;
  /** Non-empty exactly when `status` is "inconclusive". */
  inconclusive: ProcedureInconclusive[];
}

export interface StepUpdate {
  status: StepStatus;
  startedAt?: string;
  completedAt?: string;
  precheck?: { status: PrecheckStatus; stdout?: string };
  run?: { sessionId?: string; stdout?: string; error?: string; gitRef?: string };
  validate?: { status: ValidateStatus; stdout?: string; review?: string; error?: string };
}

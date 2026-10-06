/**
 * Shared types for the procedure engine and its sibling modules.
 *
 * Leaf module: no value imports from other engine-* files, so it can be
 * imported anywhere without creating an import cycle.
 */

import { type createAgent as realCreateAgent } from "../agent/invoke/core.js";
import type { ProcedureModelName } from "../../shared/agent-models.js";
import type { RunStepResult, ProcedureRunFields } from "../../schemas/procedure-run.js";
import type { ProcedureStepDef } from "../../schemas/procedure.js";
import type { InconclusiveReason } from "../../shared/inconclusive.js";

// Status/severity vocabularies, derived from the card schemas' z.enums so the
// engine's in-memory shapes can't drift from what validates on disk (Track B).
/** How a finished run ended (absent on the card while it has not). */
export type RunOutcome = NonNullable<ProcedureRunFields["outcome"]>;
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
 * Which outcomes a resume may re-open. A run card's `outcome` is written once
 * per attempt, when the run finishes (`finishRunCard` refuses a card that
 * already has one); resuming re-opens the run by removing it
 * (`reopenRunCard`), which only these outcomes allow:
 *
 * - `failed` — resuming a failed run re-opens it.
 * - `completed` — never re-opened: `resumeProcedure` returns early before
 *   writing.
 * - `inconclusive` — every step's work finished and resume does not re-judge
 *   (no re-review path exists), so `resumeProcedure` reports the standing
 *   non-verdict instead.
 *
 * A run with no outcome (interrupted mid-execution) may always be re-opened;
 * re-stamping it is idempotent. Keyed by `RunOutcome`, so adding an outcome to
 * the schema enum fails to compile until it says whether it re-opens.
 */
const REOPENABLE: Record<RunOutcome, boolean> = {
  completed: false,
  inconclusive: false,
  failed: true,
};

/** Whether `s` is a known run outcome. */
export function isRunOutcome(s: unknown): s is RunOutcome {
  return typeof s === "string" && Object.prototype.hasOwnProperty.call(REOPENABLE, s);
}

/** Whether a run whose card has `outcome` (undefined: none yet) may be resumed. */
export function canReopenRun(outcome: RunOutcome | undefined): boolean {
  return outcome === undefined || REOPENABLE[outcome];
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
  /** `skipped`: every executed step's precheck skipped, so nothing ran and no run was kept. */
  status: "completed" | "inconclusive" | "skipped";
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
  validate?: {
    status: ValidateStatus;
    stdout?: string;
    review?: string;
    error?: string;
    reason?: InconclusiveReason;
  };
}

/**
 * Shared types for the procedure engine and its sibling modules.
 *
 * Leaf module: no value imports from other engine-* files, so it can be
 * imported anywhere without creating an import cycle.
 */

import { type createAgent as realCreateAgent } from "../agent.js";

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

/** Maps friendly model names to full model IDs */
export const MODEL_MAP: Record<string, string> = {
  haiku: "claude-haiku-4-5-20251001",
  sonnet: "claude-sonnet-4-6",
  opus: "claude-opus-4-8",
};

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
  agents: Array<{ prompt: string; model?: string; maxTurns?: number }>;
  instructions: string[];
  whys: string[];
}

export interface ParsedStep {
  id: string;
  description: string;
  precheck?: ParsedPhase & { passOutput?: boolean };
  run?: ParsedPhase;
  validate?: { phase: ParsedPhase; severity: string; model?: string };
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

export interface StepUpdate {
  status: string;
  startedAt?: string;
  completedAt?: string;
  precheck?: { status: string; stdout?: string };
  run?: { sessionId?: string; stdout?: string; gitRef?: string };
  validate?: { status: string; stdout?: string; review?: string };
}

/**
 * Shared types for the procedure engine and its sibling modules.
 *
 * Leaf module: no value imports from other engine-* files, so it can be
 * imported anywhere without creating an import cycle.
 */

import { type createAgent as realCreateAgent } from "../agent.js";

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
  validate?: { phase: ParsedPhase; severity: string };
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

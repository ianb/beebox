/**
 * Procedure run card schema.
 *
 * Tracks the execution state of a procedure run. Created in
 * procedure/runs/<name>_<timestamp>/run.procedure-run.card
 */

import { element } from "cardworks";
import { z } from "zod";

/**
 * Stdout captured from shell execution.
 */
export const RunStdout = element("stdout", {
  text: z.string(),
});

/**
 * Claude Code session ID from agent execution.
 */
export const RunSessionId = element("session-id", {
  text: z.string(),
});

/**
 * Git commit ref after step completion.
 */
export const RunGitRef = element("git-ref", {
  text: z.string(),
});

/**
 * Model review assessment from instruction evaluation.
 */
export const RunReview = element("review", {
  text: z.string(),
});

/**
 * Children shared by all run phase result containers.
 */
const RunPhaseResult = z.array(
  z.union([RunStdout, RunSessionId, RunGitRef, RunReview])
);

/**
 * Precheck result in the run card.
 */
export const RunStepPrecheck = element("precheck", {
  attrs: {
    status: z.enum(["pass", "fail", "skip"]),
  },
  children: RunPhaseResult,
});

/**
 * Run phase result in the run card.
 */
export const RunStepRun = element("run", {
  children: RunPhaseResult,
});

/**
 * Validate result in the run card.
 */
export const RunStepValidate = element("validate", {
  attrs: {
    status: z.enum(["pass", "fail", "warn"]),
  },
  children: RunPhaseResult,
});

/**
 * Step result in the run card.
 */
export const RunStep = element("step", {
  attrs: {
    id: z.string(),
    status: z.enum(["pending", "running", "completed", "skipped", "failed"]),
    "started-at": z.string().datetime({ offset: true }).optional(),
    "completed-at": z.string().datetime({ offset: true }).optional(),
  },
  children: z.array(
    z.union([RunStepPrecheck, RunStepRun, RunStepValidate])
  ),
});

/**
 * Procedure run schema — the root element.
 */
export const ProcedureRunSchema = element("procedure-run", {
  searchable: false,
  attrs: {
    procedure: z.string(),
    status: z.enum(["pending", "running", "completed", "failed"]),
    "started-at": z.string().datetime({ offset: true }),
    "completed-at": z.string().datetime({ offset: true }).optional(),
  },
  children: z.array(RunStep),
  instructions: `# Handling Procedure Runs

This card is managed by the procedure engine. Agents should read it to understand execution progress but should NOT modify it directly.

Check the root \`status\` attribute for overall progress: pending → running → completed/failed. Each <step> child also has its own status.

Step statuses: pending → running → completed/skipped/failed. Look at <precheck status="..."> to see why a step was skipped, and <validate status="..."> to see if validation passed.

The \`procedure\` attribute names the procedure definition this run belongs to. The run card lives in \`procedure/runs/<name>_<timestamp>/\`.`,
});

export type ProcedureRun = z.infer<typeof ProcedureRunSchema>;
export type RunStepResult = z.infer<typeof RunStep>;

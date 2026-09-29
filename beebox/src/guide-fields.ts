/**
 * Shared guide vocabulary — confidence, belief source, and experiment outcome.
 * An experiment is proposed until it is `active: true`, and concluded once it
 * has an `outcome`; {@link experimentStateIssues} flags one that says both.
 * Extracted from `schemas/guide/schema.tsx` because `schemas/personality/`
 * also needs them: two members of the schema set may not value-import each
 * other, so the shared vocabulary lives here, in the set's parent.
 */

import { z } from "zod";
import type { LintIssue } from "./cards/lint-format.js";
import { isRecord } from "./shared/is-record.js";

export const ConfidenceLevelSchema = z.enum([
  "confirmed",
  "high",
  "medium",
  "low",
  "hypothesis",
]);
export type ConfidenceLevel = z.infer<typeof ConfidenceLevelSchema>;

export const BeliefSourceSchema = z.enum([
  "user-stated",
  "feedback",
  "inferred",
  "default",
]);
export type BeliefSource = z.infer<typeof BeliefSourceSchema>;

/** How a concluded experiment turned out. */
export const ExperimentOutcomeSchema = z.enum([
  "successful",
  "unsuccessful",
  "mixed",
  "inconclusive",
]);
export type ExperimentOutcome = z.infer<typeof ExperimentOutcomeSchema>;

/** The fields every experiment entry carries for its stage. */
export const experimentStageFields = {
  /** The experiment is running. Absent (and no `outcome`) means proposed. */
  active: z.boolean().optional(),
  /** Set when the experiment concludes; it is then no longer running. */
  outcome: ExperimentOutcomeSchema.optional(),
};

/**
 * One validation error per experiment that is both `active: true` and has an
 * `outcome`: a concluded experiment is not running.
 */
export function experimentStateIssues(experiments: unknown): LintIssue[] {
  if (!Array.isArray(experiments)) return [];
  const issues: LintIssue[] = [];
  for (const [i, experiment] of experiments.entries()) {
    if (!isRecord(experiment)) continue;
    if (experiment["active"] === true && experiment["outcome"] !== undefined) {
      issues.push({
        type: "validation",
        severity: "error",
        message: `experiments[${String(i)}] has both active: true and an outcome; remove active once it concludes`,
      });
    }
  }
  return issues;
}

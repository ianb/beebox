/**
 * Shared guide enums — confidence, belief source, and experiment status.
 * Extracted from `schemas/guide/schema.tsx` because `schemas/personality/`
 * also needs them: two members of the schema set may not value-import each
 * other, so the shared vocabulary lives here, in the set's parent.
 */

import { z } from "zod";

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

export const ExperimentStatusSchema = z.enum([
  "proposed",
  "active",
  "successful",
  "unsuccessful",
  "mixed",
  "inconclusive",
]);
export type ExperimentStatus = z.infer<typeof ExperimentStatusSchema>;

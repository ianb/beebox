import { z } from "zod";

const growthCountsSchema = z.object({
  directories: z.number().int().nonnegative(),
  files: z.number().int().nonnegative(),
});

const availableHistorySchema = z.object({
  status: z.literal("available"),
  gitHead: z.string(),
  commits: z.number().int().nonnegative(),
  gitObjects: z.number().int().nonnegative(),
  gitBytes: z.number().int().nonnegative(),
});

const unavailableHistorySchema = z.object({
  status: z.literal("unavailable"),
  error: z.string(),
});

export const growthHistorySchema = z.discriminatedUnion("status", [
  availableHistorySchema,
  unavailableHistorySchema,
]);

export const subtreeCountsSchema = z.object({
  path: z.string(),
  directories: z.number().int().nonnegative(),
  files: z.number().int().nonnegative(),
  source: z.enum(["connector", "chat", "user-input", "automation", "unknown"]),
  sourceLabel: z.string().nullable(),
});

export const growthMeasurementSchema = z.object({
  measuredAt: z.iso.datetime(),
  counts: growthCountsSchema,
  complete: z.boolean().default(true),
  filesystemError: z.string().nullable().default(null),
  skippedDirectories: z.number().int().nonnegative().default(0),
  history: growthHistorySchema,
  largestSubtrees: z.array(subtreeCountsSchema).max(20),
});

const unmeasuredStateSchema = z.object({
  version: z.literal(1),
  status: z.literal("unmeasured"),
  lastAttemptAt: z.iso.datetime().nullable(),
  lastError: z.string().nullable(),
});

export const growthRateFindingKindSchema = z.enum([
  "rate-directories",
  "rate-files",
  "rate-commits",
  "rate-connector-directories",
  "rate-connector-files",
]);

export const growthRateExpectationSchema = z.object({
  kind: growthRateFindingKindSchema,
  path: z.string().nullable(),
  thresholdPerHour: z.number().nonnegative(),
  setAt: z.iso.datetime(),
});

const measuredStateSchema = z.object({
  version: z.literal(1),
  status: z.literal("measured"),
  accepted: growthMeasurementSchema,
  previous: growthMeasurementSchema,
  current: growthMeasurementSchema,
  acknowledgedAt: z.iso.datetime().nullable(),
  lastAttemptAt: z.iso.datetime(),
  lastError: z.string().nullable(),
  lastNotice: z.string().nullable().default(null),
  rateExpectations: z.array(growthRateExpectationSchema).max(50).default([]),
});

export const boxGrowthStateSchema = z.discriminatedUnion("status", [
  unmeasuredStateSchema,
  measuredStateSchema,
]);

export type GrowthCounts = z.infer<typeof growthCountsSchema>;
export type GrowthHistory = z.infer<typeof growthHistorySchema>;
export type SubtreeCounts = z.infer<typeof subtreeCountsSchema>;
export type GrowthMeasurement = z.infer<typeof growthMeasurementSchema>;
export type BoxGrowthState = z.infer<typeof boxGrowthStateSchema>;
export type GrowthRateExpectation = z.infer<typeof growthRateExpectationSchema>;

export type BoxGrowthStateRead =
  | BoxGrowthState
  | { status: "missing" }
  | { status: "invalid"; error: string };

export type GrowthRateFindingKind = z.infer<typeof growthRateFindingKindSchema>;

export type GrowthFindingKind =
  | "absolute-directories"
  | "absolute-files"
  | GrowthRateFindingKind;

export interface GrowthFinding {
  kind: GrowthFindingKind;
  actual: number;
  threshold: number;
  path?: string;
}

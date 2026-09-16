/**
 * GLM (Z.ai) coding-plan quota.
 *
 * Unlike Claude and Codex, which report usage through their own CLIs/SDKs, Z.ai
 * exposes a plain HTTP endpoint. Two oddities of that API, both confirmed
 * against a live key rather than taken from docs:
 *
 * - The API key goes in `Authorization` with **no `Bearer` prefix**.
 * - `usage` is the CAP and `currentValue` is what has been consumed, which is
 *   the opposite of how both words usually read. `percentage` is the used
 *   share, so that is what we carry and the two are never re-derived here.
 *
 * A window's `unit` is a period code — 3 is hours, 6 is weeks — with `number`
 * as the count, so the plan's 5-hour and weekly caps arrive as `{unit:3,
 * number:5}` and `{unit:6, number:1}`.
 */

import { z } from "zod";

import type { Quota } from "../shared/documents.js";

/** Period codes seen from the endpoint, as minutes. Anything else is unknown. */
const UNIT_MINUTES: Record<number, number> = { 3: 60, 6: 60 * 24 * 7 };

const limitSchema = z.object({
  unit: z.number().optional(),
  number: z.number().optional(),
  percentage: z.number().optional(),
  /** Epoch MILLISECONDS. Absent on a window that has not been consumed yet. */
  nextResetTime: z.number().optional(),
});

export const glmQuotaResponse = z.object({
  success: z.boolean().optional(),
  msg: z.string().optional(),
  data: z.object({
    level: z.string().optional(),
    limits: z.array(limitSchema).optional(),
  }).optional(),
});

export type GlmQuotaResponse = z.infer<typeof glmQuotaResponse>;

function windowLabel(minutes: number | null, level: string | undefined): string {
  const plan = level === undefined || level === "" ? "" : ` (${level})`;
  if (minutes === null) return `Window${plan}`;
  if (minutes % (60 * 24 * 7) === 0) {
    const weeks = minutes / (60 * 24 * 7);
    return `${weeks === 1 ? "Weekly" : `${String(weeks)}-week`} window${plan}`;
  }
  if (minutes % 60 === 0) return `${String(minutes / 60)}-hour window${plan}`;
  return `${String(minutes)}-minute window${plan}`;
}

export function parseGlmQuota(response: GlmQuotaResponse, fetchedAt: string): Quota {
  const level = response.data?.level;
  const windows = (response.data?.limits ?? []).flatMap((limit) => {
    const unitMinutes = limit.unit === undefined ? null : UNIT_MINUTES[limit.unit] ?? null;
    const durationMinutes = unitMinutes === null || limit.number === undefined ? null : unitMinutes * limit.number;
    const usedPercent = limit.percentage;
    if (usedPercent === undefined) return [];
    // A window that has never been consumed reports no reset — the 5-hour cap
    // refreshes five hours after the first spend, so there is genuinely no
    // instant to name yet. Say when it would end if spending started now,
    // rather than dropping the window and reporting less than we know.
    const resetsAt = limit.nextResetTime !== undefined
      ? new Date(limit.nextResetTime)
      : new Date(Date.parse(fetchedAt) + (durationMinutes ?? 0) * 60_000);
    if (Number.isNaN(resetsAt.getTime())) return [];
    return [{ label: windowLabel(durationMinutes, level), usedPercent, resetsAt: resetsAt.toISOString(), durationMinutes }];
  });
  return {
    provider: "glm",
    status: windows.length > 0 ? "available" : "unavailable",
    fetchedAt,
    windows,
    ...(windows.length === 0 ? { message: response.msg ?? "Z.ai returned no quota windows." } : {}),
  };
}

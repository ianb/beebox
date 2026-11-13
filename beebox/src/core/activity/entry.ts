/**
 * Activity entries: one action a person took in a view or figure. The page
 * sends `ActivityEntryInput`s; the writer stamps `seq`, `at` and `user` and
 * appends an `ActivityLine` to `.beebox/activity.jsonl`.
 */

import { z } from "zod";
import { ACTIVITY_KINDS } from "../../shared/card-activity-kinds.js";
import { truncateTitle } from "../file-summary.js";

/** A line stays under the size the filesystem appends atomically. */
export const MAX_LINE_BYTES = 4000;
export const MAX_DETAIL_CHARS = 500;

const idSchema = z.string().min(1).max(200);
const pathSchema = z.string().min(1).max(300);

export const activityInputSchema = z.object({
  card: pathSchema,
  via: pathSchema.optional(),
  kind: z.enum(ACTIVITY_KINDS),
  detail: z.string().optional(),
  activity: z.record(z.string(), z.unknown()).optional(),
  chat: idSchema.optional(),
  pendingChat: idSchema.optional(),
  afterMessage: idSchema.optional(),
  clientAt: z.string().max(64).optional(),
});

export type ActivityEntryInput = z.infer<typeof activityInputSchema>;

export const activityLineSchema = activityInputSchema.extend({
  seq: z.number().int().nonnegative(),
  at: z.string(),
  user: z.string().nullable(),
  truncated: z.literal(true).optional(),
});

export type ActivityLine = z.infer<typeof activityLineSchema>;

/** Valid entries in order; each invalid one is dropped with a warning. */
export function validEntries(raw: readonly unknown[]): ActivityEntryInput[] {
  const kept: ActivityEntryInput[] = [];
  for (const [index, item] of raw.entries()) {
    const parsed = activityInputSchema.safeParse(item);
    if (parsed.success) kept.push(parsed.data);
    else console.warn(`[activity] dropped entry ${String(index)}: ${parsed.error.issues[0]?.message ?? "invalid"}`);
  }
  return kept;
}

/**
 * Serialize under `MAX_LINE_BYTES`: shorten `detail`, then drop `activity`,
 * then drop `detail`, marking `truncated`. Null when even that does not fit.
 */
export function serializeLine(line: ActivityLine): string | null {
  const candidates: ActivityLine[] = [line];
  const detail = line.detail === undefined ? undefined : truncateTitle(line.detail, MAX_DETAIL_CHARS);
  const { activity: _activity, detail: _detail, ...bare } = line;
  if (detail !== line.detail) candidates[0] = { ...line, ...(detail === undefined ? {} : { detail }), truncated: true };
  candidates.push(
    { ...bare, ...(detail === undefined ? {} : { detail }), truncated: true },
    { ...bare, truncated: true },
  );
  for (const candidate of candidates) {
    const text = JSON.stringify(candidate);
    if (Buffer.byteLength(text) < MAX_LINE_BYTES) return `${text}\n`;
  }
  return null;
}

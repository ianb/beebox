/**
 * The job check's machine state, `.beebox/job-check.json`, and its lock,
 * `.beebox/job-check.lock`. Gitignored with the rest of `.beebox/`. Written
 * only under the lock (`./core.ts`).
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { z } from "zod";
import { writeFileAtomic } from "../../../lib/atomic-write.js";
import { errnoCode, errorMessage } from "../../../shared/error-guards.js";
import { EMPTY_STATE, type JobCheckState } from "./rules.js";

export function jobCheckStatePath(boxRoot: string): string {
  return path.join(boxRoot, ".beebox", "job-check.json");
}

export function jobCheckLockPath(boxRoot: string): string {
  return path.join(boxRoot, ".beebox", "job-check.lock");
}

const entrySchema = z.object({
  firstSeenAt: z.string().datetime(),
  hash: z.string(),
  attempts: z.number().int().min(0),
  nextAt: z.string().datetime().nullable(),
  givenUp: z.boolean(),
});

const stateSchema = z.object({
  day: z.string().nullable(),
  runsToday: z.number().int().min(0),
  boundLoggedDay: z.string().nullable(),
  jobs: z.record(z.string(), entrySchema),
});

/**
 * The state; the empty state when there is no file. `problem` says why a file
 * that exists could not be read or parsed: the check then starts nothing (it
 * may hide today's count) and logs it.
 */
export async function readJobCheckState(boxRoot: string): Promise<{ state: JobCheckState; problem: string | null }> {
  let raw: string;
  try {
    raw = await fs.readFile(jobCheckStatePath(boxRoot), "utf-8");
  } catch (e) {
    if (errnoCode(e) === "ENOENT") return { state: EMPTY_STATE, problem: null };
    return { state: EMPTY_STATE, problem: errorMessage(e) };
  }
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch (e) {
    return { state: EMPTY_STATE, problem: errorMessage(e) };
  }
  const parsed = stateSchema.safeParse(json);
  return parsed.success ? { state: parsed.data, problem: null } : { state: EMPTY_STATE, problem: parsed.error.message };
}

export async function writeJobCheckState(boxRoot: string, state: JobCheckState): Promise<void> {
  await writeFileAtomic(jobCheckStatePath(boxRoot), { content: `${JSON.stringify(state, null, 2)}\n` });
}

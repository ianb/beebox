/**
 * The question-review machine latch, `.beebox/reviewed-questions.json`
 * (gitignored `.beebox/` state, like the aging sweep's `notified-questions.json`).
 *
 * `reviewed` records when each question last finished a review, so a question
 * simplified in place is not taken up daily. `listed` is the set the last
 * `check` handed the agent, which `verify` judges. A lost or corrupt latch
 * only means a question is reviewed again early.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { z } from "zod";
import { errnoCode } from "../../shared/error-guards.js";

const LATCH_PATH = ".beebox/reviewed-questions.json";

export interface ReviewLatch {
  reviewed: Record<string, string>;
  listed: string[];
}

const latchSchema = z.object({
  reviewed: z.record(z.string(), z.string()).optional(),
  listed: z.array(z.string()).optional(),
});

export async function loadReviewLatch(boxRoot: string): Promise<ReviewLatch> {
  try {
    const raw = await fs.readFile(path.join(boxRoot, LATCH_PATH), "utf-8");
    const data = latchSchema.parse(JSON.parse(raw));
    return { reviewed: data.reviewed ?? {}, listed: data.listed ?? [] };
  } catch (e) {
    if (errnoCode(e) !== "ENOENT") {
      console.warn("Could not read reviewed-questions latch, treating as empty:", e);
    }
    return { reviewed: {}, listed: [] };
  }
}

export async function saveReviewLatch(boxRoot: string, latch: ReviewLatch): Promise<void> {
  const absPath = path.join(boxRoot, LATCH_PATH);
  await fs.mkdir(path.dirname(absPath), { recursive: true });
  await fs.writeFile(absPath, `${JSON.stringify(latch, null, 2)}\n`);
}

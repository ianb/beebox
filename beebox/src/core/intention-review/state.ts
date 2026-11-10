/**
 * The intention review's box-local state, `.beebox/intentions/reviewed.json`
 * (docs/implemented-plans/place-intention.md, Track D).
 *
 * `reviewed` maps each landmark's box-relative path to the commit the
 * `refresh-intentions` procedure last reviewed it at; `check` lists a place
 * again only when something under it changed after that commit. `run` is the
 * open run: the `HEAD` `check` saw and the landmarks it listed, which
 * `verify` judges. Gitignored bookkeeping, like the openers marker and
 * `review-state.ts`: losing it costs one extra review of every place.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { z } from "zod";
import { writeFileAtomic } from "../../lib/atomic-write.js";
import { loadJsonStateOrFresh } from "../../lib/json-state.js";

const STATE_PATH = ".beebox/intentions/reviewed.json";

const StateSchema = z.object({
  reviewed: z.record(z.string(), z.string()),
  run: z.object({ baseline: z.string(), listed: z.array(z.string()) }).optional(),
});

export interface IntentionReviewState {
  reviewed: Record<string, string>;
  run: { baseline: string; listed: string[] } | null;
}

export async function loadIntentionState(boxRoot: string): Promise<IntentionReviewState> {
  const data = await loadJsonStateOrFresh({
    filePath: path.join(boxRoot, STATE_PATH),
    name: STATE_PATH,
    label: "intention review",
    schema: StateSchema,
    fresh: (): z.infer<typeof StateSchema> => ({ reviewed: {} }),
  });
  return { reviewed: data.reviewed, run: data.run ?? null };
}

export async function saveIntentionState(boxRoot: string, state: IntentionReviewState): Promise<void> {
  const absPath = path.join(boxRoot, STATE_PATH);
  await fs.mkdir(path.dirname(absPath), { recursive: true });
  const data = { reviewed: state.reviewed, ...(state.run !== null && { run: state.run }) };
  await writeFileAtomic(absPath, { content: `${JSON.stringify(data, null, 2)}\n` });
}

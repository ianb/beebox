/**
 * `bbx engine question-review verify` — the validate step of the stock
 * `question-review` procedure.
 *
 * Judges the questions `check` listed. One still put away without a
 * `provisional` decision is unsettled: Later must come back, as a decision or
 * as the question asked again. Every other listed question is recorded in the
 * latch with the run time, so it is not taken up again for the latch window.
 * An unsettled question is not latched, so the retry and tomorrow's run see it.
 */

import { getBoxTimeISO } from "../../lib/time.js";
import { loadReviewCandidates } from "./check/candidates.js";
import { loadReviewLatch, saveReviewLatch } from "./latch.js";

export interface QuestionReviewVerifyResult {
  unsettled: Array<{ path: string; reason: string }>;
  settledCount: number;
}

export async function verifyQuestionReview(boxRoot: string): Promise<QuestionReviewVerifyResult> {
  const latch = await loadReviewLatch(boxRoot);
  const current = new Map((await loadReviewCandidates(boxRoot)).map((c) => [c.path, c]));
  const at = getBoxTimeISO(boxRoot);
  const unsettled: QuestionReviewVerifyResult["unsettled"] = [];
  const reviewed = { ...latch.reviewed };

  for (const path of latch.listed) {
    const card = current.get(path);
    if (card?.state === "dismissed" && !card.hasProvisional) {
      unsettled.push({ path, reason: "still put away with no decision; decide it (bbx question decide) or ask it again (bbx question reraise)" });
      continue;
    }
    reviewed[path] = at;
  }

  await saveReviewLatch(boxRoot, { reviewed, listed: latch.listed });
  return { unsettled, settledCount: latch.listed.length - unsettled.length };
}

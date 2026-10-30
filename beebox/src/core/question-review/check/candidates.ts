/**
 * Loads the box's question cards for the question review.
 */

import * as fs from "node:fs/promises";
import { getSystemState } from "../../state.js";
import { cardFields, parseCardText } from "../../card-io.js";
import { createCardSchemaMap } from "../../../schemas.js";
import { QuestionSchema, questionState } from "../../../schemas/question.js";
import type { ReviewCandidate } from "./select.js";

/** Every valid question card in the box. A card that fails to parse is skipped, loudly. */
export async function loadReviewCandidates(boxRoot: string): Promise<ReviewCandidate[]> {
  const state = await getSystemState(boxRoot);
  const schemas = await createCardSchemaMap(boxRoot);
  const candidates: ReviewCandidate[] = [];
  for (const q of state.questions) {
    try {
      const content = await fs.readFile(q.path, "utf-8");
      const fields = cardFields(parseCardText(content, { source: q.path, schemas }), QuestionSchema);
      candidates.push({
        path: q.relativePath,
        prompt: fields.prompt,
        state: questionState(fields),
        askedAt: fields["asked-at"],
        dismissedAt: fields["dismissed-at"],
        hasProvisional: fields.provisional !== undefined,
      });
    } catch (e) {
      console.warn(`Question review: could not load ${q.relativePath}, skipping:`, e);
    }
  }
  return candidates;
}

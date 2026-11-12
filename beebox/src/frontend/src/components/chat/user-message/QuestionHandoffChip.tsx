/**
 * How a "Decide for me" handoff renders in the transcript: the question's
 * title, linking its card. Sibling of `UploadChip`.
 *
 * The delivered message is an instruction to the agent (the card's path and
 * the skill to use). The person never wrote it, so the bubble shows what they
 * did: they handed this question to the box.
 */

import type { QuestionHandoffUserMessage } from "@shared/delivered-user-message";
import { AttachmentChipFrame } from "../AttachmentChipFrame";

export function QuestionHandoffChip({ model }: { model: QuestionHandoffUserMessage }) {
  return <AttachmentChipFrame doc={model.doc} title="Decide for me" summary={model.title} />;
}

/**
 * How a "Decide for me" handoff renders in the transcript: the question's
 * title, linking its card. Sibling of `UploadChip`.
 *
 * The delivered message is an instruction to the agent (the card's path and
 * the skill to use). The person never wrote it, so the bubble shows what they
 * did: they handed this question to the box.
 */

import { useParams } from "@tanstack/react-router";
import { withBase } from "../../../api";
import type { QuestionHandoffUserMessage } from "@shared/delivered-user-message";
import { cardUrl } from "@shared/card-url";

export function QuestionHandoffChip({ model }: { model: QuestionHandoffUserMessage }) {
  const { boxSlug } = useParams({ strict: false });
  const href = withBase(cardUrl(boxSlug ?? "", model.doc));
  return (
    <a href={href} className="bbx-chat-user-attachment block rounded-lg bg-black/15 px-3 py-2 hover:bg-black/25">
      <div className="text-sm font-medium">Decide for me</div>
      {model.title !== "" ? <div className="bbx-chat-user-attachment-summary mt-0.5 text-xs text-white/85">{model.title}</div> : null}
    </a>
  );
}

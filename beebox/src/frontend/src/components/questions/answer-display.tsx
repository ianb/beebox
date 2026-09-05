/**
 * Shared "what did the boxholder answer" display, used by both the archive
 * list (QuestionsList) and the single-card view (QuestionCardView).
 *
 * For most input types `answer.text` alone is the full story. `confirm` is
 * the exception: the card records the yes/no decision in `answer.selected`
 * and an optional free-text note in `answer.text` — showing only `text`
 * silently drops the decision whenever a note was given (the note replaces
 * `text`, it doesn't append to "yes"/"no"). So a confirm answer always
 * renders the decision, with the note appended when it adds information.
 */

import { Text } from "../ui/Text";
import type { QuestionInfo } from "./QuestionForm";

/** Human label for a confirm question's `answer.selected` ("yes" | "no"). */
function confirmDecisionLabel(selected: string): string {
  return selected === "yes" ? "Yes" : "No";
}

/**
 * Render a question's recorded answer, or `null` if there's nothing to show.
 * `size`/`tone` mirror the `Text` primitive's props so callers can match
 * their surrounding typography (the archive card uses `sm`/`default`, the
 * single-card view uses the default `p` styling).
 */
export function renderQuestionAnswer(
  question: Pick<QuestionInfo, "inputType" | "answer">,
  props?: { size?: "sm"; tone?: "default" | "emphasis" }
): React.ReactNode {
  const answer = question.answer;
  if (answer?.text === undefined || answer.text === "") {
    return null;
  }

  if (question.inputType === "confirm" && answer.selected !== undefined) {
    const decision = confirmDecisionLabel(answer.selected);
    // `text` equals `selected` exactly when no note was given (see
    // resolveConfirm in core/commands/answer.ts) — only append it when it's
    // more than a restatement of the decision.
    const note = answer.text !== answer.selected ? answer.text : undefined;
    return (
      <Text as="p" size={props?.size} tone={props?.tone ?? "emphasis"}>
        {decision}
        {note !== undefined ? ` — ${note}` : ""}
      </Text>
    );
  }

  return (
    <Text as="p" size={props?.size} tone={props?.tone ?? "emphasis"}>
      {answer.text}
    </Text>
  );
}

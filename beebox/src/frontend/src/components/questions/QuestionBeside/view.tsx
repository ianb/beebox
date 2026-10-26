/**
 * A question beside the chat (docs/plans/questions-later-and-figure-it-out.md,
 * Track A): the question pasted onto a stub card. No answer controls: the
 * person answers in the chat, in their own words, so a select question lists
 * its choices in a line. The pinned row offers the two other choices: "Later"
 * puts it away, "Figure it out" hands it to the box. A question the box
 * decided says so, and is still the person's to answer.
 *
 * The look lives in `themes/question-beside.css`, keyed on
 * `data-question-beside`; `data-chat-side` says where the notch points.
 */

import { Button } from "../../ui/Button";
import { Text } from "../../ui/Text";
import { bbxSource } from "../../../lib/source-tag";
import { LATER } from "../question-tab";
import { optionsLine } from "./options-line";
import { QuestionContext, type QuestionInfo } from "../QuestionForm/view";

export interface BesideActions {
  onLater: () => void;
  onFigureOut: () => void;
  /** The background start is in flight. */
  figuring: boolean;
  /** Set when the chat is hidden on the desktop, so "Answer in the chat" can bring it back. */
  onShowChat: (() => void) | undefined;
  /** Where the chat is, for the notch: beside on the desktop, below the card on the phone. */
  chatSide: "left" | "right" | "below";
}

/** The box's provisional decision, in words that never make it the person's. */
function BoxDecided({ decision, reasoning }: { decision: string; reasoning: string }) {
  return (
    <div className="mb-3" data-testid="question-box-decided">
      <Text as="p" size="sm" weight="semibold">The box decided for now: {decision}</Text>
      <Text as="p" size="sm" tone="subtle">{reasoning}</Text>
    </div>
  );
}

export function QuestionBeside({ question, actions }: { question: QuestionInfo; actions: BesideActions }) {
  const { onLater: handleLater, onFigureOut: handleFigureOut, onShowChat: handleShowChat } = actions;
  const choices = question.inputType === "select" ? optionsLine(question.options) : null;
  const decided = question.provisional;
  const pending = question.state === "pending";
  return (
    <div className="bbx-question-patch" data-question-beside="" data-chat-side={actions.chatSide} {...bbxSource("card", question.relativePath)}>
      <QuestionContext question={question} />
      {choices === null ? null : <Text as="p" className="bbx-question-choices mb-3">{choices}</Text>}
      {decided === undefined ? null : <BoxDecided decision={decided.decision} reasoning={decided.reasoning} />}
      <div className="bbx-question-row">
        {handleShowChat === undefined
          ? <Text as="p" size="sm" tone="subtle">{decided === undefined ? "Answer in the chat." : "Answer it yourself in the chat."}</Text>
          : <Button type="button" intent="secondary" size="sm" onClick={handleShowChat}>Answer in the chat</Button>}
        {pending ? <Button type="button" intent="ghost" size="sm" onClick={handleLater}>{LATER}</Button> : null}
        {decided === undefined ? (
          <Button type="button" intent="ghost" size="sm" loading={actions.figuring} loadingLabel="Handing it off…" onClick={handleFigureOut}>
            Figure it out
          </Button>
        ) : null}
      </div>
    </div>
  );
}

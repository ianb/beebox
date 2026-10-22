import { ChatOpeners } from "../openers/ChatOpeners";
import type { OpenerSendOutcome } from "../openers/opener-send";
import { InlineAction } from "../ui/InlineAction";
import { MaterialContext } from "../ui/material";
import { moreQuestionsLabel, openQuestionLine, type OpenQuestion } from "./open-question";

/**
 * The question the empty root chat asks, as the agent's opening line
 * (docs/implemented-plans/front-door.md, Track A): the prompt (a select question lists its
 * options in the sentence, "All the choices" when it has more than fit), the
 * card's memo under it in the quiet style, then "and N more" to the Questions
 * page and a quiet "Not now". Clicking the line
 * puts the cursor in the composer, whose placeholder is the prompt. Text for
 * every input type: the person answers by typing or speaking.
 */
function OpenQuestionLine({ question, onFocusComposer, onNotNow, onOpenQuestions }: {
  question: OpenQuestion;
  onFocusComposer: () => void;
  onNotNow: (path: string) => void;
  onOpenQuestions: () => void;
}) {
  const more = moreQuestionsLabel(question.more);
  return (
    // On the desk, like the "Start a conversation." line: themes dress the
    // pending-material plate, and everything inside takes its ink.
    <MaterialContext.Provider value>
      <div className="bbx-chat-pending-material flex flex-col items-center gap-1 max-w-md text-center text-card-ink" data-testid="chat-open-question">
        <button type="button" className="text-left text-lg leading-snug" onClick={onFocusComposer} data-question-path={question.path}>
          {openQuestionLine(question)}
        </button>
        {question.memo === null ? null : <p className="text-sm">{question.memo}</p>}
        <p className="text-sm">
          {question.optionsBeyond > 0 ? <><InlineAction intent="quiet" className="underline" onClick={onOpenQuestions}>All the choices</InlineAction>{" · "}</> : null}
          {more === null ? null : <><InlineAction intent="quiet" className="underline" onClick={onOpenQuestions}>{more}</InlineAction>{" · "}</>}
          <InlineAction intent="quiet" className="underline" onClick={() => onNotNow(question.path)}>Not now</InlineAction>
        </p>
      </div>
    </MaterialContext.Provider>
  );
}

/** An empty chat: the question the root chat asks when one is pending, the openers, then the plain empty-state line. */
export function EmptyChat({ openers, onSendOpener, openQuestion, onFocusComposer, onQuestionNotNow, onOpenQuestions }: {
  openers: string[];
  onSendOpener: (text: string) => OpenerSendOutcome;
  openQuestion: OpenQuestion | null;
  onFocusComposer: () => void;
  onQuestionNotNow: (path: string) => void;
  onOpenQuestions: () => void;
}) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-3 px-4">
      {openQuestion === null ? null : (
        <OpenQuestionLine question={openQuestion} onFocusComposer={onFocusComposer} onNotNow={onQuestionNotNow} onOpenQuestions={onOpenQuestions} />
      )}
      <ChatOpeners openers={openers} onSendOpener={onSendOpener} />
      <div className="bbx-chat-empty-label text-warm-700 text-sm">Start a conversation.</div>
    </div>
  );
}

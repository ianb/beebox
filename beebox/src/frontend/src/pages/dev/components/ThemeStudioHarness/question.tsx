/**
 * The theme studio's question card: a question beside the chat, pasted onto
 * a stub card on a patch (`themes/question-beside.css`), pending and
 * answered, as `QuestionCardView` draws them in the workspace.
 */

import type { ResolvedCardTheme } from "@shared/card-theme/core";
import { CardThemeSurface } from "../../../../components/themes/ThemedFileCard/CardThemeSurface";
import { QuestionBeside, QuestionPatch } from "../../../../components/questions/QuestionBeside/view";
import type { QuestionInfo } from "../../../../components/questions/QuestionForm/view";
import { AnsweredQuestion } from "../../../../components/QuestionCardView";
import { useMobileChatViewport } from "../../../../components/chat/everywhere/use-mobile-card-navigation";

export const QUESTION_PATH = "_bookkeeping/questions/Hall-opening.question.card";

function noop() { /* The specimen never puts a question away or hands it off. */ }

const PENDING: QuestionInfo = {
  path: `/box/${QUESTION_PATH}`, relativePath: QUESTION_PATH, name: "Hall-opening", type: "question", subdir: undefined,
  state: "pending", prompt: "When should the seed exchange open?", inputType: "select",
  options: ["Nine", "Ten", "Eleven"],
  memo: "The hall closes at noon. Dana asked for **ten**; Lee can bring tape either way.",
};

/** A question the box decided for now: still the person's to answer. */
const DECIDED: QuestionInfo = {
  ...PENDING, prompt: "Who brings the folding tables?", inputType: "text", memo: undefined, options: undefined,
  provisional: { decision: "Lee brings them", reasoning: "Lee offered last week and has the van.", undo: "Ask Dana instead.", "decided-at": "2026-10-01T10:00:00Z" },
};

const ANSWERED: QuestionInfo = {
  ...PENDING, state: "answered", prompt: "How many tables do we need?", inputType: "text",
  memo: undefined, options: undefined,
  answer: { text: "Four, with one by the door for labels." },
  learning: { sink: "briefing", proposal: "How much room the exchange takes, to book the hall next year." },
};

/**
 * The forms on one stub card (pending, decided by the box, answered), so one
 * capture shows each on the patch. The notch points at the chat: left and
 * right on a wide screen, below on a phone. A question card has no detail
 * line under its title.
 */
export function QuestionCard({ theme }: { theme: ResolvedCardTheme }) {
  const phone = useMobileChatViewport();
  return <CardThemeSurface theme={theme} title="Hall opening" symbol={null} boxSlug={undefined} mode="companion" properties={null}>
    <div className="p-4 max-w-2xl mx-auto space-y-4">
      <QuestionBeside question={PENDING} actions={{ onLater: noop, onFigureOut: noop, figuring: false, onShowChat: undefined, chatSide: phone ? "below" : "left" }} />
      <QuestionBeside question={DECIDED} actions={{ onLater: noop, onFigureOut: noop, figuring: false, onShowChat: undefined, chatSide: phone ? "below" : "right" }} />
      <QuestionPatch path={QUESTION_PATH} chatSide={phone ? "below" : "right"}>
        <AnsweredQuestion question={ANSWERED} others={2} onMore={noop} />
      </QuestionPatch>
    </div>
  </CardThemeSurface>;
}

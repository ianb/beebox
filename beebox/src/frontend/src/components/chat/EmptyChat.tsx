import { ChatOpeners } from "../openers/ChatOpeners";
import type { OpenerSendOutcome } from "../openers/opener-send";
import { useQuestionInFront } from "../questions/question-tab";
import { useCardIdentities } from "../../hooks/useCardIdentities";
import { displayName } from "../../lib/display-name";

/**
 * An empty chat: the openers, then the plain empty-state line. With a pending
 * question beside the chat, the line names it and the openers step aside, so
 * a reply reads as a probable answer to that question
 * (docs/implemented-plans/questions-later-and-figure-it-out.md). The name is the card's
 * title, as its tab shows it.
 */
export function EmptyChat({ openers, onSendOpener }: {
  openers: string[];
  onSendOpener: (text: string) => OpenerSendOutcome;
}) {
  const question = useQuestionInFront();
  const identities = useCardIdentities(question === null ? [] : [question]);
  const title = question === null ? null : identities.get(question)?.title ?? displayName(question);
  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-3 px-4">
      {title === null ? <ChatOpeners openers={openers} onSendOpener={onSendOpener} /> : null}
      <div className="bbx-chat-empty-label text-warm-700 text-sm text-center" data-testid="chat-empty-label">
        {title === null ? "Start a conversation." : `Answer the question “${title}” here, or start something else.`}
      </div>
    </div>
  );
}

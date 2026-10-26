import { ChatOpeners } from "../openers/ChatOpeners";
import type { OpenerSendOutcome } from "../openers/opener-send";
import { useQuestionInFront } from "../questions/question-tab";

/**
 * An empty chat: the openers, then the plain empty-state line. With a pending
 * question beside the chat, the line refers to it and the openers step aside,
 * so a reply reads as a probable answer
 * (docs/plans/questions-later-and-figure-it-out.md).
 */
export function EmptyChat({ openers, onSendOpener }: {
  openers: string[];
  onSendOpener: (text: string) => OpenerSendOutcome;
}) {
  const questionInFront = useQuestionInFront();
  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-3 px-4">
      {questionInFront ? null : <ChatOpeners openers={openers} onSendOpener={onSendOpener} />}
      <div className="bbx-chat-empty-label text-warm-700 text-sm">
        {questionInFront ? "Answer the question here, or start something else." : "Start a conversation."}
      </div>
    </div>
  );
}

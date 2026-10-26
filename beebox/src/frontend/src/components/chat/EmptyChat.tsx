import { ChatOpeners } from "../openers/ChatOpeners";
import type { OpenerSendOutcome } from "../openers/opener-send";

/**
 * An empty chat: the openers, then the plain empty-state line. A pending
 * question opens beside the chat instead of here
 * (docs/plans/questions-beside-the-chat.md, Track A).
 */
export function EmptyChat({ openers, onSendOpener }: {
  openers: string[];
  onSendOpener: (text: string) => OpenerSendOutcome;
}) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-3 px-4">
      <ChatOpeners openers={openers} onSendOpener={onSendOpener} />
      <div className="bbx-chat-empty-label text-warm-700 text-sm">Start a conversation.</div>
    </div>
  );
}

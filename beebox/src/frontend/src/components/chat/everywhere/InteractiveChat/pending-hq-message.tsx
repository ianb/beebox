import type { PendingHq } from "../../../../machines/composerMachine";
import { Button } from "../../../ui/Button";
import { MaterialContext } from "../../../ui/material";
import { UserMessageText } from "../../user-message-text";
import { QUEUED_EDGE } from "../../user-message/view";

/** The queued user bubble: the realtime text and the HQ job's status line. */
function PendingHqBubble({ pending }: { pending: PendingHq }) {
  return (
    <div
      className={`rounded-l-2xl bg-info text-white px-3 sm:px-4 py-2 min-w-[80px] sm:min-w-[120px] break-words ${QUEUED_EDGE}`}
      title="Waiting for the HQ transcript…"
    >
      <div className="text-sm whitespace-pre-wrap">
        <UserMessageText text={pending.text} />
      </div>
      {/* Inside the bubble, like the sent message's "Live text" line: the status belongs to this message. */}
      <div role="status" className="bbx-chat-user-status flex items-center gap-1.5 text-xs text-white mt-1">
        <span className="inline-block w-2 h-2 rounded-full bg-white animate-pulse" />
        {pending.status}
      </div>
    </div>
  );
}

/**
 * A voice message waiting for its HQ transcript
 * (docs/implemented-plans/resilient-voice-recording.md, Track 4): the realtime text as a
 * queued user bubble with the HQ job's status line inside it, and below it a
 * control to stop waiting and send the live text now.
 */
export function PendingHqMessage({ pending, onSendLive }: { pending: PendingHq; onSendLive: (id: string) => void }) {
  return (
    <div className="flex justify-end pl-12 sm:pl-24 py-1">
      <MaterialContext.Provider value>
        <div className="bbx-chat-pending-material flex flex-col items-end gap-1">
          <PendingHqBubble pending={pending} />
          <Button size="sm" intent="secondary" onClick={() => onSendLive(pending.id)}>Send live text now</Button>
        </div>
      </MaterialContext.Provider>
    </div>
  );
}

/** Display policy for the chat's "Agent is working…" status strip. */

import { useEffect, useState } from "react";
import { getChatStatus } from "../../api";
import type { ChatEvent } from "../../machines/chat-types";

export type ChatMachineDisplayPhase = "loading" | "idle" | "streaming" | "refreshing";
export type ProcessingBusyConfirmation = "unconfirmed" | "confirmed" | "clearing";

export function shouldShowAgentWorking(input: {
  phase: ChatMachineDisplayPhase;
  processBusy: boolean;
  confirmation: ProcessingBusyConfirmation;
}): boolean {
  if (input.phase === "streaming") return true;
  if (input.phase === "refreshing") return input.confirmation !== "clearing";
  return input.processBusy && input.confirmation === "confirmed";
}

/**
 * Confirm a load-time busy snapshot after 250ms, then poll every 5s while the
 * agent is busy with no live stream attached. A transient snapshot never
 * paints the status strip; a sustained turn appears after one status read.
 */
export function useProcessingStatusPoll(opts: {
  processBusy: boolean;
  isStreaming: boolean;
  isStreamingState: boolean;
  sessionId: string | null;
  send: (event: ChatEvent) => void;
}): boolean {
  const { processBusy, isStreaming, isStreamingState, sessionId, send } = opts;
  const [confirmation, setConfirmation] = useState<{
    sessionId: string;
    value: Exclude<ProcessingBusyConfirmation, "unconfirmed">;
  } | null>(null);
  useEffect(() => {
    if (!processBusy || isStreamingState) setConfirmation(null);
  }, [processBusy, isStreamingState, sessionId]);
  useEffect(() => {
    if (!processBusy || isStreaming || !sessionId) return;
    let ignored = false;
    const poll = () => {
      getChatStatus({ sessionId })
        .then((status) => {
          if (ignored) return;
          if (status.busy) {
            setConfirmation({ sessionId, value: "confirmed" });
          } else {
            setConfirmation({ sessionId, value: "clearing" });
            send({ type: "REFRESH" });
          }
        })
        .catch((e: unknown) => {
          console.warn(`[chatfsm] processing-status poll failed: ${e instanceof Error ? e.message : String(e)}`);
          if (!ignored) setConfirmation({ sessionId, value: "confirmed" });
        });
    };
    const confirmationId = setTimeout(poll, 250);
    const pollId = setInterval(poll, 5000);
    return () => {
      ignored = true;
      clearTimeout(confirmationId);
      clearInterval(pollId);
    };
  }, [processBusy, isStreaming, sessionId, send]);
  const value = confirmation?.sessionId === sessionId ? confirmation.value : "unconfirmed";
  return shouldShowAgentWorking({
    phase: isStreamingState ? "streaming" : isStreaming ? "refreshing" : "idle",
    processBusy,
    confirmation: value,
  });
}

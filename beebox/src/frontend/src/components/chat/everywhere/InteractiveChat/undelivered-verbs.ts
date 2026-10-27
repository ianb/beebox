/**
 * Resend and Discard for a message the box accepted and the agent never got
 * (`docs/plans/chat-not-delivered.md`). Both are the person's actions: the box
 * never resends on its own.
 */

import { useMemo } from "react";
import type { SessionEntry } from "../../../../api";
import { createTypedEmission } from "../../../../input/emission";
import type { Receipt } from "../../../../input/targets/receipts";
import { trpcClient } from "../../../../lib/trpc/client";
import type { ChatEvent } from "../../../../machines/chat-types";
import type { EmissionDispatch } from "../../conversation/use-bound-emission/hook";
import { originalDisplayText, type UndeliveredVerbs } from "../../user-message/view";

class ResendRefusedError extends Error {
  constructor(reason: string) { super(`Not sent again: ${reason}`); this.name = "ResendRefusedError"; }
}

export function useUndeliveredVerbs(opts: {
  captureEmissionDispatch: () => EmissionDispatch;
  send: (event: ChatEvent) => void;
  sessionId: string | null;
}): UndeliveredVerbs {
  const { captureEmissionDispatch, send, sessionId } = opts;
  return useMemo(() => {
    const discard = async (entry: SessionEntry): Promise<void> => {
      const messageId = entry.messageId ?? entry.uuid;
      // A refused send left nothing on the box to discard. Any other discard
      // is refused by the box unless it marked the message undelivered.
      if (entry.sendRefused !== true) await trpcClient.chat.discardUndelivered.mutate({ sessionId, messageId });
      send({ type: "MESSAGE_DISCARDED", messageId });
    };
    // The displayed words go out as a new typed send with a new message id,
    // through the composer's own dispatch, so the old id's dedup claim never
    // blocks it. The old copy goes only once the new one is accepted.
    const resend = async (entry: SessionEntry): Promise<void> => {
      const dispatch = captureEmissionDispatch();
      let receipt: Promise<Receipt>;
      try {
        receipt = dispatch(createTypedEmission({ text: originalDisplayText(entry), images: [], files: [], selections: [] }));
      } catch (cause) {
        dispatch.release();
        throw cause;
      }
      const settled = await receipt;
      if (settled.disposition === "rejected") throw new ResendRefusedError(settled.reason);
      await discard(entry);
    };
    return { resend, discard };
  }, [captureEmissionDispatch, send, sessionId]);
}

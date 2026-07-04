/**
 * The one user-send funnel (docs/plans/input-extraction.md chunk 1): every
 * send site builds an Emission and lands in `dispatchEmission`, which
 * assembles the wire payload via the chat-target assembler and dispatches
 * SEND. Witness context (open card, zoomed view, time passed) is captured
 * here — target-side — never threaded into the composer.
 */

import { useCallback } from "react";
import type { SessionEntry } from "../../api";
import { serializeViewUrl } from "../../lib/view-url";
import { refreshLocationIfStale } from "../../lib/location-share";
import { clearLastMessageAudio } from "../../lib/last-audio-cache";
import { createVoiceEmission, type Emission } from "../../input/emission";
import type { ChatWitness } from "../../input/targets/chat-assemble";
import { acceptEmission, planRestore, applyRestorePlan } from "../../input/targets/chat-target";
import type { Receipt } from "../../input/targets/receipts";
import type { EmissionStore } from "../../input/emission-store";
import { localTime, formatTimePassed } from "./InteractiveChat-helpers";
import type { ChatEvent } from "../../machines/chat-types";
import type { CardSendFields } from "./InteractiveChat-card-hooks";
import type { ViewTarget } from "../../lib/view-url";

export function useEmissionDispatch(opts: {
  send: (event: ChatEvent) => void;
  captureCardSend: () => CardSendFields;
  boxSlug: string | undefined;
  activeView: { target: ViewTarget } | null;
  messages: SessionEntry[];
  emissionStore: EmissionStore;
}) {
  const { send, captureCardSend, boxSlug, activeView, messages, emissionStore } = opts;

  // Frame state at the moment of sending, as plain values — consumed by the
  // chat-target assembler (input/targets/chat-assemble.ts).
  const getWitness = useCallback((): ChatWitness => {
    let timePassed: string | null = null;
    if (messages.length > 0) {
      const last = messages[messages.length - 1];
      timePassed = formatTimePassed(Date.now() - new Date(last.timestamp).getTime());
    }
    return {
      localTime: localTime(),
      zoomedView: activeView ? `view:${serializeViewUrl(activeView.target)}` : null,
      timePassed,
    };
  }, [activeView, messages]);

  // `captureCardSend` stamps the open card + activity since the last reply
  // onto every user turn. System sends (e.g. /compact) bypass this funnel,
  // leaving the accumulator be.
  //
  // Returns the settled Receipt (never rejects the promise itself — a
  // `rejected` disposition is a normal value, not a thrown error). Every
  // current call site is fire-and-forget and ignores the return value; it
  // exists for callers that DO want to await the outcome (docs/plans/
  // input-extraction.md chunk 3).
  const dispatchEmission = useCallback(
    (emission: Emission): Promise<Receipt> => {
      // Historical behavior, preserved exactly: only the voice funnel cleared
      // the cached recording (a voice send re-caches its own right after —
      // see runKeywordSend). Typed sends never cleared it. Chunk 5 replaces
      // this cache with emission-keyed retention and the asymmetry goes away.
      if (emission.origin === "voice") clearLastMessageAudio();
      void refreshLocationIfStale(boxSlug); // best-effort stale-fix refresh; no-op unless the user opted in
      const cardFields = captureCardSend();
      return acceptEmission(emission, { witness: getWitness(), cardFields, send }).then((receipt) => {
        if (receipt.disposition === "rejected") {
          // The composer was cleared optimistically at dispatch — put the
          // emission back rather than losing it to the error banner.
          const plan = planRestore(emissionStore.get(), emission);
          applyRestorePlan(emissionStore.editor, plan);
          console.warn(`[chat] send rejected, restored emission into composer: ${receipt.reason}`);
        }
        return receipt;
      });
    },
    [send, captureCardSend, boxSlug, getWitness, emissionStore]
  );

  // Voice segment without keyword machinery: the stop-and-send buttons and
  // dictation recovery — plain <speech>, no selections, not diarized.
  const sendVoiceSegment = useCallback(
    (text: string) => {
      dispatchEmission(createVoiceEmission({ text, selections: [], diarized: false }));
    },
    [dispatchEmission]
  );

  return { dispatchEmission, sendVoiceSegment };
}

/**
 * The one user-send funnel (docs/implemented-plans/input-extraction.md chunk 1): every
 * send site builds an Emission and lands in `dispatchEmission`, which
 * assembles the wire payload via the chat-target assembler and dispatches
 * SEND. Witness context (open card, zoomed view, time passed) is captured
 * here — target-side — never threaded into the composer.
 */

import { useCallback } from "react";
import type { SessionEntry } from "../../api";
import { serializeViewUrl } from "../../lib/view-url";
import { refreshLocationIfStale } from "../../lib/location-share";
import { createVoiceEmission, type Emission } from "../../input/emission";
import { markVoiceAudioAbsent } from "../../lib/last-audio";
import type { ChatWitness } from "../../input/targets/chat-assemble";
import { acceptEmission, planRestore, applyRestorePlan } from "../../input/targets/chat-target";
import type { Receipt } from "../../input/targets/receipts";
import type { EmissionStore } from "../../input/emission-store";
import type { SelectionItem } from "../../lib/selection-serialize";
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
  /** Live composer selections, for the stop-and-send buttons (see sendStopSend). */
  selections: SelectionItem[];
  resetSelections: () => void;
}) {
  const { send, captureCardSend, boxSlug, activeView, messages, emissionStore, selections, resetSelections } = opts;

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

  // Recovered dictation: a segment that survived a page drop (screen sleep,
  // tab eviction, reload) with no live composer state around it to fold in —
  // plain <speech>, no selections, not diarized (historical shape, pinned by
  // emission-assemble.doctest.md's "site 5").
  const sendVoiceSegment = useCallback(
    (text: string) => {
      const emission = createVoiceEmission({ text, selections: [], diarized: false });
      // No recording exists for this voice send — tombstone it so
      // get-last-audio answers none, not an older message's recording.
      markVoiceAudioAbsent(emission.id);
      dispatchEmission(emission);
    },
    [dispatchEmission]
  );

  // The desktop/mobile stop-and-send buttons: chunk 5's named decision is to
  // ALIGN these with every other send path and fold the live selections
  // snapshot in (they historically sent plain <speech> with none — an
  // accident of hand-built payloads, not a design; see docs/plans/
  // input-extraction.md). Selections reset after send, same as
  // runKeywordSend's freeze-and-clear.
  const sendStopSend = useCallback(
    (text: string) => {
      const emission = createVoiceEmission({ text, selections, diarized: false });
      // Same tombstone as sendVoiceSegment: this path carries no recording.
      markVoiceAudioAbsent(emission.id);
      dispatchEmission(emission);
      resetSelections();
    },
    [dispatchEmission, selections, resetSelections]
  );

  return { dispatchEmission, sendVoiceSegment, sendStopSend };
}

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
import { createVoiceEmission, draftAttachments, type Emission } from "../../input/emission";
import { resolveEmissionWords } from "../../input/unsure-words";
import { markVoiceAudioAbsent } from "../../lib/audio/last-audio";
import type { ChatWitness } from "../../input/targets/chat-assemble";
import { acceptEmission, planRestore, applyRestorePlan } from "../../input/targets/chat-target";
import type { Receipt } from "../../input/targets/receipts";
import type { EmissionStore } from "../../input/emission-store";
import type { SelectionItem } from "../../lib/selection/serialize";
import { localTime, formatTimePassed, type VoiceSegmentMeta } from "./InteractiveChat-helpers";
import type { ChatEvent } from "../../machines/chat-types";
import type { CardSendFields } from "./InteractiveChat-card-hooks";
import type { ViewTarget } from "../../lib/view-url";
import { chatSendReasonKind, observeChatSendReceipt } from "../../lib/chat-send-diagnostics";

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
  /** Clears pending images/files after a stop-and-send sweeps them (revokes object URLs too). */
  resetAttachments: () => void;
  /** Resolves once no file attachment is still uploading; a send waits on it. */
  awaitPendingUploads: () => Promise<void>;
  /** Every user send goes through here — the scroll controller's send anchor
   *  (rule 2, chat-scroll.ts) hangs off this, not off the composer button, so a
   *  voice segment, a stop-and-send and a native send anchor the same way. */
  onSent: () => void;
}) {
  const { send, captureCardSend, boxSlug, activeView, messages, emissionStore, selections, resetSelections, resetAttachments, onSent, awaitPendingUploads } = opts;

  // Frame state at the moment of sending, as plain values — consumed by the
  // chat-target assembler (input/targets/chat-assemble.ts).
  const getWitness = useCallback((): ChatWitness => {
    let timePassed: string | null = null;
    const last = messages.at(-1);
    if (last !== undefined) {
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
  // Most call sites are fire-and-forget. The native bridge awaits the receipt
  // so iOS can keep its draft pending until the backend accepts the send.
  const dispatchWithRestorePolicy = useCallback(
    (emission: Emission, restoreRejected: boolean): Promise<Receipt> => {
      void refreshLocationIfStale(boxSlug); // best-effort stale-fix refresh; no-op unless the user opted in
      const cardFields = captureCardSend();
      onSent();
      return acceptEmission(emission, { witness: getWitness(), cardFields, send }).then((receipt) => {
        observeChatSendReceipt({ emissionId: receipt.emissionId, disposition: receipt.disposition,
          ...(receipt.disposition === "rejected" ? { reasonKind: chatSendReasonKind(receipt.reason) } : {}) });
        if (receipt.disposition === "rejected" && restoreRejected) {
          // The composer was cleared optimistically at dispatch — put the
          // emission back rather than losing it to the error banner.
          const plan = planRestore(emissionStore.get(), emission);
          applyRestorePlan(emissionStore.editor, plan);
          console.warn(`[chat] send rejected, restored emission into composer: ${receipt.reason}`);
        }
        return receipt;
      });
    },
    [send, captureCardSend, boxSlug, getWitness, emissionStore, onSent]
  );
  const dispatchEmission = useCallback(
    (emission: Emission): Promise<Receipt> => dispatchWithRestorePolicy(emission, true),
    [dispatchWithRestorePolicy]
  );
  const dispatchNativeEmission = useCallback(
    (emission: Emission): Promise<Receipt> => dispatchWithRestorePolicy(emission, false),
    [dispatchWithRestorePolicy]
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
      // dispatchEmission's own .then already handles the "rejected"
      // disposition (restores the composer); the promise settles from
      // in-memory machine bookkeeping (expectReceipt), not I/O, so there's
      // nothing further to await or catch here.
      void dispatchEmission(emission);
    },
    [dispatchEmission]
  );

  // The desktop/mobile stop-and-send buttons: chunk 5's named decision is to
  // ALIGN these with every other send path and fold the live selections
  // snapshot in (they historically sent plain <speech> with none — an
  // accident of hand-built payloads, not a design; see docs/plans/
  // input-extraction.md). Pending images/files sweep in the same way (a file
  // attached mid-dictation used to be silently dropped). Selections and
  // attachments reset after send, same as runKeywordSend's freeze-and-clear.
  const runStopSend = useCallback(
    async (text: string, voice: VoiceSegmentMeta): Promise<void> => {
      // Same rule as every other send: never ship a `[file#N]` whose bytes
      // aren't on the box. `draftAttachments` carries only files that landed,
      // and `resetAttachments` below destroys the rest — so without this wait a
      // tap-send during an upload commits the token and deletes the file.
      // Resolves immediately when nothing is in flight.
      await awaitPendingUploads();
      const { images, files } = draftAttachments(emissionStore.get());
      const emission = createVoiceEmission({
        text, images, files, selections, diarized: false,
        // Fix D (docs/plans/transcript-confidence.md): the tap-send path
        // now carries the hook's realtime words too, same as a keyword
        // send — the interim tail (if any) simply has no words, which the
        // aligner tolerates (fail-open per word).
        words: resolveEmissionWords(voice.words),
        spokenStart: voice.spokenStart,
      });
      // Same tombstone as sendVoiceSegment: this path carries no recording.
      markVoiceAudioAbsent(emission.id);
      void dispatchEmission(emission);
      resetSelections();
      resetAttachments();
    },
    [dispatchEmission, emissionStore, selections, resetSelections, resetAttachments, awaitPendingUploads]
  );
  /**
   * Void-returning for the composer prop. The send now waits on in-flight
   * uploads, but a button has nothing to resume on and `runStopSend` reports
   * its own outcomes through the emission receipt.
   */
  const sendStopSend = useCallback(
    (text: string, voice: VoiceSegmentMeta): void => { void runStopSend(text, voice); },
    [runStopSend]
  );

  return { dispatchEmission, dispatchNativeEmission, sendVoiceSegment, sendStopSend };
}

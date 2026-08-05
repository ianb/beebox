/**
 * Recovered-dictation UI: persists the in-flight transcript so an interrupted
 * session (screen sleep, tab eviction, reload) doesn't erase it. Recovery
 * surfaces in a dedicated widget above the composer rather than autofilling
 * the field. Extracted from `InteractiveChat.tsx` to keep that component
 * under the line-count limit — this is pure UI wiring, not a reusable hook.
 */

import { useCallback, useEffect, type MutableRefObject } from "react";
import { useDictationDraft } from "../../hooks/useDictationDraft";
import { RecoveredDictation } from "./RecoveredDictation";
import { joinTranscript } from "./InteractiveChat-helpers";
import type { InputStore } from "./input-store";

export const RECOVERED_DICTATION_MIN_CHARACTERS = 20;

export function shouldSurfaceRecoveredDictation(text: string): boolean {
  return text.trim().length > RECOVERED_DICTATION_MIN_CHARACTERS;
}

export function dropSmallRecoveredDictation(text: string, clearDraft: () => void): boolean {
  if (shouldSurfaceRecoveredDictation(text)) return false;
  clearDraft();
  return true;
}

export function useRecoveredDictation(opts: {
  boxSlug: string | undefined;
  transcript: string;
  isTranscribing: boolean;
  narrationEnabled: boolean;
  hqInFlight: boolean;
  sessionId: string | null;
  sendVoiceSegment: (text: string) => void;
  inputStore: InputStore;
  startVoice: () => void;
  clearDraftRef: MutableRefObject<() => void>;
}) {
  const {
    boxSlug, transcript, isTranscribing, narrationEnabled, hqInFlight,
    sessionId, sendVoiceSegment, inputStore, startVoice, clearDraftRef,
  } = opts;

  const { recoveredDraft, clearDraft } = useDictationDraft({
    boxSlug,
    transcript,
    isTranscribing,
    narrationEnabled,
  });
  useEffect(() => { clearDraftRef.current = clearDraft; });

  const shouldDropRecoveredDraft = recoveredDraft !== null
    && !shouldSurfaceRecoveredDictation(recoveredDraft.text);
  useEffect(() => {
    if (recoveredDraft !== null) {
      dropSmallRecoveredDictation(recoveredDraft.text, clearDraft);
    }
  }, [recoveredDraft, clearDraft]);

  const handleRecoverSend = useCallback(() => {
    if (!recoveredDraft) return;
    // No audio survives a drop, so the realtime text stands in for the HQ pass
    // (the design's documented HQ-failure fallback). Sent as a narration
    // <speech> message; the session's narration flag re-syncs from the server.
    sendVoiceSegment(recoveredDraft.text);
    clearDraft();
  }, [recoveredDraft, sendVoiceSegment, clearDraft]);

  const handleRecoverContinue = useCallback(() => {
    if (!recoveredDraft) return;
    // Resume the interrupted message: the recovered text becomes composer
    // input — the prior-input slot every voice path already folds into the
    // next utterance (keyword send prepends it; a manual stop joins onto it) —
    // and the mic reopens.
    inputStore.set((existing) => joinTranscript(existing, recoveredDraft.text));
    clearDraft();
    startVoice();
  }, [recoveredDraft, inputStore, clearDraft, startVoice]);

  // Surface the recovery widget only when idle: hidden while the mic is open
  // and while an HQ commit is in flight (the mic briefly idles between
  // segments — don't flash the just-committed text as "recovered").
  const recoveredDictation = recoveredDraft
    && !shouldDropRecoveredDraft
    && !isTranscribing
    && !hqInFlight ? (
    <RecoveredDictation
      draft={recoveredDraft}
      sessionId={sessionId}
      onSend={handleRecoverSend}
      onContinue={handleRecoverContinue}
      onDiscard={clearDraft}
    />
  ) : null;

  return { recoveredDictation, clearDraft };
}

/**
 * Form state + transcription wiring for the PWA share-target page.
 *
 * Owns the note text, voice-usage flag, save lifecycle, and the bridge from
 * the realtime transcription stream into the note field. Returns everything
 * SharePage needs to render and to handle voice/save interactions.
 */

import { useState, useEffect, useCallback, useRef } from "react";
import { useRealtimeTranscription } from "../hooks/useRealtimeTranscription";
import { saveBookmark } from "./share-save";

type ShareState = "ready" | "saving" | "saved" | "error";

interface UseShareNoteOptions {
  boxSlug: string | undefined;
  sharedUrl: string;
  sharedTitle: string;
  sharedText: string;
}

export function useShareNote(options: UseShareNoteOptions) {
  const { boxSlug, sharedUrl, sharedTitle, sharedText } = options;

  const [note, setNote] = useState(sharedText);
  const [usedVoice, setUsedVoice] = useState(false);
  const [shareState, setShareState] = useState<ShareState>("ready");
  const [errorMessage, setErrorMessage] = useState("");

  const transcription = useRealtimeTranscription({
    onKeywordSend: (text) => {
      setNote((prev) => (prev ? `${prev}\n\n${text}` : text));
    },
  });

  // Append finalized transcription chunks into the note field. The ref
  // gate prevents duplicate appends when transcription state churns
  // without producing new text. setState is intentional: this is a
  // bridge from an external transcription stream to local form state.
  const prevTranscriptRef = useRef("");

  useEffect(() => {
    if (
      transcription.state === "idle" &&
      transcription.transcript &&
      transcription.transcript !== prevTranscriptRef.current
    ) {
      const text = transcription.transcript.trim();
      if (text) {
        setNote((prev) => (prev ? `${prev}\n\n${text}` : text));
      }
      prevTranscriptRef.current = transcription.transcript;
    }
  }, [transcription.state, transcription.transcript]);

  const handleSave = useCallback(async () => {
    if (!sharedUrl || !boxSlug) return;

    let extraNote = "";
    if (transcription.state === "recording") {
      const finalText = await transcription.stop();
      extraNote = finalText.trim();
    }

    setShareState("saving");
    setErrorMessage("");

    const fullNote = extraNote
      ? (note.trim() ? `${note.trim()}\n\n${extraNote}` : extraNote)
      : note.trim();

    try {
      await saveBookmark({
        boxSlug,
        sharedUrl,
        sharedTitle,
        note: fullNote,
        usedVoice,
      });
      setShareState("saved");
    } catch (err) {
      setShareState("error");
      setErrorMessage(err instanceof Error ? err.message : String(err));
    }
  }, [sharedUrl, sharedTitle, boxSlug, note, usedVoice, transcription]);

  const handleVoiceToggle = useCallback(() => {
    if (transcription.state === "recording") {
      transcription.stop();
    } else if (transcription.state === "idle") {
      prevTranscriptRef.current = "";
      setUsedVoice(true);
      transcription.start();
    }
  }, [transcription]);

  return {
    note,
    setNote,
    shareState,
    errorMessage,
    transcription,
    handleSave,
    handleVoiceToggle,
  };
}

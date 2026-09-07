import { useConversationSelectionSink } from "./everywhere/card-context";
import { useCallback, useEffect, useRef } from "react";
import { countWords, lastWords } from "../../lib/selection/serialize";
import type { AddSelectionInput } from "../../lib/selection/position";
import type { useChatSelections } from "./InteractiveChat-selections";
import type { useChatVoice } from "./InteractiveChat-voice";
import { useNativeComposerCommands } from "./use-native-composer-commands";

export function useCompanionSelection(
  {
    nativeComposer,
    selections,
    voice,
  }: {
    nativeComposer: boolean;
    selections: ReturnType<typeof useChatSelections>;
    voice: ReturnType<typeof useChatVoice>;
  },
): {
  handleAddSelection: (selection: AddSelectionInput) => void;
  nativeCommandError: string | null;
  dismissNativeCommandError: () => void;
} {
  const {
    addSelection: addNativeSelection,
    error: nativeCommandError,
    dismissError: dismissNativeCommandError,
  } = useNativeComposerCommands(nativeComposer);
  const transcriptRef = useRef("");
  const transcribingRef = useRef(false);
  useEffect(() => {
    transcriptRef.current = voice.transcription.transcript;
    transcribingRef.current = voice.isTranscribing;
  });
  // Depend on the stable `addSelection` callback, NOT the whole `selections`
  // object — useChatSelections returns a fresh object literal every render, so
  // depending on it would rebuild this handler each render and defeat the
  // memoized companion pane (which takes this as a prop).
  const { addSelection } = selections;
  const handleAddSelection = useCallback((selection: AddSelectionInput) => {
    if (nativeComposer) {
      addNativeSelection(selection);
      return;
    }
    if (!transcribingRef.current) {
      addSelection(selection, { anchor: null, spokenWords: null });
      return;
    }
    const transcript = transcriptRef.current;
    addSelection(selection, {
      anchor: lastWords(transcript, 8),
      spokenWords: countWords(transcript),
    });
  }, [addNativeSelection, nativeComposer, addSelection]);
  useConversationSelectionSink(handleAddSelection);
  return {
    handleAddSelection,
    nativeCommandError,
    dismissNativeCommandError,
  };
}

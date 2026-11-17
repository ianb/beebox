import { useConversationSelectionSink } from "../card-context/context";
import { useCallback, useEffect, useRef } from "react";
import { countWords, lastWords } from "../../../../lib/selection/serialize";
import type { AddSelectionInput } from "../../../../lib/selection/position";
import type { useChatSelections } from "./selections";
import type { useChatVoice } from "./voice";
import { useNativeComposerCommands } from "./use-native-composer-commands";
import { useWorkspace } from "../../workspace/WorkspaceProvider/provider";

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
  const workspace = useWorkspace();
  const workspaceRef = useRef(workspace);
  useEffect(() => {
    transcriptRef.current = voice.transcription.transcript;
    transcribingRef.current = voice.isTranscribing;
    workspaceRef.current = workspace;
  });
  // Depend on the stable `addSelection` callback, NOT the whole `selections`
  // object — useChatSelections returns a fresh object literal every render, so
  // depending on it would rebuild this handler each render and defeat the
  // memoized companion pane (which takes this as a prop).
  const { addSelection } = selections;
  const handleAddSelection = useCallback((selection: AddSelectionInput) => {
    // A focused card hides the composer; return to the split so the person sees what was added.
    const focused = workspaceRef.current;
    if (focused?.cardFocused === true && focused.state.layout.kind === "focus") focused.dispatch({ type: "backToSplit", pane: focused.state.layout.pane });
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

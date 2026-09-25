/**
 * Selection capture over the chat transcript: selecting message text shows
 * the same floating "+" a document selection gets, and clicking it attaches
 * the text to the composer through the conversation's selection sink (the
 * one `useCompanionSelection` registers). A transcript selection has no file
 * behind it, so its `ref` is null and its `position` names the chat and the
 * speaker.
 */

import { useCallback } from "react";
import type { ReactNode } from "react";
import { SelectionCapture } from "../SelectionCapture";
import { extractTranscriptSelection } from "../../lib/selection/position";
import { useConversationSelectionCapture } from "./everywhere/card-context";

export function TranscriptSelection({ children }: { children: ReactNode }) {
  const capture = useConversationSelectionCapture();
  const handleCapture = useCallback((selection: { text: string; position: string }) => {
    if (capture === undefined) {
      console.warn("No conversation is mounted to receive the transcript selection");
      return;
    }
    capture({ ref: null, text: selection.text, position: selection.position });
  }, [capture]);
  // The wrapper is also the transcript's scan boundary (see MessageList): one
  // element, so message rows stay at the depth chat-scroll-anchor.ts searches.
  return <SelectionCapture onCapture={handleCapture} extract={extractTranscriptSelection} data-bbx-scan="exclude">{children}</SelectionCapture>;
}

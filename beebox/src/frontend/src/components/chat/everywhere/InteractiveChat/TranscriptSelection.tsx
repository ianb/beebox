/**
 * Point selection over the chat transcript attaches a message part to the
 * ordinary composer through the conversation's selection sink. A transcript
 * selection has no file behind it, so its `ref` is null and its `position`
 * names the chat and the speaker.
 */

import { useCallback } from "react";
import type { ReactNode } from "react";
import { SelectionCapture } from "../../../SelectionCapture";
import { extractTranscriptPointSelection } from "../../../../lib/selection/position";
import { useConversationSelectionCapture } from "../card-context/context";
import { usePointSelection } from "../../../point-selection-context";

export function TranscriptSelection({ children }: { children: ReactNode }) {
  const capture = useConversationSelectionCapture();
  const point = usePointSelection();
  const handleCapture = useCallback((selection: { text: string; position: string }) => {
    if (capture === undefined) {
      console.warn("No conversation is mounted to receive the transcript selection");
      return;
    }
    capture({ ref: null, text: selection.text, position: selection.position });
  }, [capture]);
  // The wrapper is also the transcript's scan boundary (see MessageList): one
  // element, so message rows stay at the depth chat-scroll-anchor.ts searches.
  return <SelectionCapture onCapture={handleCapture} extractPoint={extractTranscriptPointSelection}
    pointMode={point?.active === true} onExitPointMode={() => point?.setActive(false)} data-bbx-scan="exclude">{children}</SelectionCapture>;
}

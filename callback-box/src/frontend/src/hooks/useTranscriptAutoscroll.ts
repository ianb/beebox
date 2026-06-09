import { useEffect } from "react";

/**
 * Keep a textarea pinned to the bottom while the live transcript streams in,
 * so the newest words stay visible once content overflows the textarea's max
 * height. `transcriptTick` is the streaming text itself (or any string that
 * changes with it) — each change re-runs the scroll.
 */
export function useTranscriptAutoscroll(opts: {
  isTranscribing: boolean;
  textareaRef: React.RefObject<HTMLTextAreaElement>;
  transcriptTick: string;
}) {
  const { isTranscribing, textareaRef, transcriptTick } = opts;

  useEffect(() => {
    if (isTranscribing && textareaRef.current) {
      const el = textareaRef.current;
      el.scrollTop = el.scrollHeight;
    }
  }, [isTranscribing, transcriptTick, textareaRef]);
}

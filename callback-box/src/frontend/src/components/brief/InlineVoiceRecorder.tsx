/**
 * InlineVoiceRecorder - Compact voice recorder for inline use in feedback areas.
 * Auto-starts recording when mounted.
 */

import { useCallback, useEffect } from "react";
import { useVoiceRecorder, type VoiceRecordingResult } from "../../hooks/useVoiceRecorder";
import {
  StopIcon,
  RecordingIndicator,
  UploadingIndicator,
} from "../VoiceRecorder";

export function InlineVoiceRecorder({
  onComplete,
  onCancel,
}: {
  onComplete: (blob: Blob) => Promise<void>;
  onCancel: () => void;
}) {
  const handleComplete = useCallback(
    async (result: VoiceRecordingResult) => {
      await onComplete(result.blob);
    },
    [onComplete]
  );

  const { state, error, duration, startRecording, stopRecording, formatDuration } =
    useVoiceRecorder({ onComplete: handleComplete });

  // Auto-start recording when component mounts
  useEffect(() => {
    if (state === "idle") {
      startRecording();
    }
  }, [state, startRecording]);

  if (state === "uploading") {
    return (
      <div className="flex items-center gap-2 py-2">
        <UploadingIndicator />
      </div>
    );
  }

  if (state === "recording") {
    return (
      <div className="flex items-center gap-3 py-2">
        <RecordingIndicator />
        <span className="font-mono text-sm">{formatDuration(duration)}</span>
        <button
          onClick={stopRecording}
          className="px-3 py-1 bg-danger-dark text-white text-sm rounded hover:bg-danger-dark flex items-center gap-1"
        >
          <StopIcon className="w-4 h-4" />
          Stop
        </button>
        <button
          onClick={onCancel}
          className="px-3 py-1 text-warm-700 text-sm hover:text-warm-800"
        >
          Cancel
        </button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 py-2">
      {error ? (
        <>
          <span className="text-danger-dark text-sm">{error}</span>
          <button onClick={onCancel} className="px-3 py-1 text-warm-700 text-sm hover:text-warm-800">
            Cancel
          </button>
        </>
      ) : (
        <span className="text-warm-600 text-sm">Starting recorder...</span>
      )}
    </div>
  );
}

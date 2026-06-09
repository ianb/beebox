/**
 * Voice recorder component using MediaRecorder API.
 */

import { useCallback } from "react";
import { createVoiceMemo } from "../api";
import { useVoiceRecorder, type VoiceRecordingResult } from "../hooks/useVoiceRecorder";
import { Button } from "./ui/Button";

interface VoiceRecorderProps {
  onCreated: () => void;
}

export function VoiceRecorder({ onCreated }: VoiceRecorderProps) {
  const handleComplete = useCallback(
    async (result: VoiceRecordingResult) => {
      await createVoiceMemo(result.blob);
      onCreated();
    },
    [onCreated]
  );

  const { state, error, duration, startRecording, stopRecording, formatDuration } =
    useVoiceRecorder({ onComplete: handleComplete });

  return (
    <div className="p-4 bg-white rounded-lg shadow">
      <h3 className="text-lg font-bold text-warm-900 mb-4">Voice Memo</h3>

      <div className="flex flex-col items-center gap-4">
        {state === "idle" && (
          <Button intent="primary" icon={<MicrophoneIcon />} onClick={startRecording}>
            Start Recording
          </Button>
        )}

        {state === "recording" && (
          <>
            <div className="flex items-center gap-3">
              <RecordingIndicator />
              <span className="text-lg font-mono">{formatDuration(duration)}</span>
            </div>
            <Button intent="destructive" icon={<StopIcon />} onClick={stopRecording}>
              Stop Recording
            </Button>
          </>
        )}

        {state === "uploading" && <UploadingIndicator />}

        {error ? <div className="text-danger-dark text-sm text-center">Error: {error}</div> : null}
      </div>

      <p className="text-xs text-warm-600 text-center mt-4">
        Voice memos will be transcribed automatically at the next wakeup.
      </p>
    </div>
  );
}

// Shared UI components for voice recording

export function MicrophoneIcon({ className }: { className?: string }) {
  className = className ?? "w-5 h-5";
  return (
    <svg className={className} fill="currentColor" viewBox="0 0 20 20">
      <path
        fillRule="evenodd"
        d="M7 4a3 3 0 016 0v4a3 3 0 11-6 0V4zm4 10.93A7.001 7.001 0 0017 8a1 1 0 10-2 0A5 5 0 015 8a1 1 0 00-2 0 7.001 7.001 0 006 6.93V17H6a1 1 0 100 2h8a1 1 0 100-2h-3v-2.07z"
        clipRule="evenodd"
      />
    </svg>
  );
}

export function StopIcon({ className }: { className?: string }) {
  className = className ?? "w-5 h-5";
  return (
    <svg className={className} fill="currentColor" viewBox="0 0 20 20">
      <path
        fillRule="evenodd"
        d="M10 18a8 8 0 100-16 8 8 0 000 16zM8 7a1 1 0 00-1 1v4a1 1 0 001 1h4a1 1 0 001-1V8a1 1 0 00-1-1H8z"
        clipRule="evenodd"
      />
    </svg>
  );
}

export function RecordingIndicator({ degraded }: { degraded?: boolean }) {
  // Degraded = the session is live but recovering (network or mic blip):
  // hold a steady warning dot instead of the pulsing record dot, so a glance
  // distinguishes "recording" from "trying to keep recording".
  if (degraded === true) {
    return (
      <span className="relative flex h-3 w-3" title="Recording interrupted — recovering">
        <span className="relative inline-flex rounded-full h-3 w-3 bg-warning" />
      </span>
    );
  }
  return (
    <span className="relative flex h-3 w-3">
      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-danger-light opacity-75" />
      <span className="relative inline-flex rounded-full h-3 w-3 bg-danger" />
    </span>
  );
}

export function UploadingIndicator() {
  return (
    <div className="flex items-center gap-2 text-warm-700">
      <svg
        className="animate-spin h-5 w-5"
        xmlns="http://www.w3.org/2000/svg"
        fill="none"
        viewBox="0 0 24 24"
      >
        <circle
          className="opacity-25"
          cx="12"
          cy="12"
          r="10"
          stroke="currentColor"
          strokeWidth="4"
         />
        <path
          className="opacity-75"
          fill="currentColor"
          d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
         />
      </svg>
      Uploading...
    </div>
  );
}

/**
 * Hook for voice recording using XState machine.
 *
 * Provides a reusable voice recording interface that can be used
 * for voice memos, feedback comments, query responses, etc.
 */

import { useCallback, useMemo } from "react";
import { useSSRMachine } from "./useSSRMachine";
import {
  voiceRecorderMachine,
  type VoiceRecordingResult,
} from "../machines/voiceRecorderMachine";

export type { VoiceRecordingResult };

export type RecordingState = "idle" | "recording" | "uploading";

export interface UseVoiceRecorderOptions {
  /** Called when recording completes successfully */
  onComplete: (result: VoiceRecordingResult) => Promise<void>;
}

export interface UseVoiceRecorderReturn {
  state: RecordingState;
  error: string | null;
  duration: number;
  startRecording: () => void;
  stopRecording: () => void;
  formatDuration: (seconds: number) => string;
}

/**
 * Hook for voice recording functionality.
 *
 * Usage:
 * ```tsx
 * const { state, error, duration, startRecording, stopRecording, formatDuration } = useVoiceRecorder({
 *   onComplete: async (result) => {
 *     // Upload the audio blob
 *     await uploadAudio(result.blob);
 *   },
 * });
 * ```
 */
export function useVoiceRecorder({
  onComplete,
}: UseVoiceRecorderOptions): UseVoiceRecorderReturn {
  const input = useMemo(() => ({ onComplete }), [onComplete]);
  const [snapshot, send] = useSSRMachine(voiceRecorderMachine, { input });

  // Map machine states to the simpler RecordingState
  const state: RecordingState = snapshot.matches("recording")
    ? "recording"
    : snapshot.matches("uploading")
      ? "uploading"
      : "idle";

  const startRecording = useCallback(() => {
    send({ type: "START" });
  }, [send]);

  const stopRecording = useCallback(() => {
    send({ type: "STOP" });
  }, [send]);

  const formatDuration = useCallback((seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  }, []);

  return {
    state,
    error: snapshot.context.error,
    duration: snapshot.context.duration,
    startRecording,
    stopRecording,
    formatDuration,
  };
}

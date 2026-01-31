/**
 * Voice recorder component using MediaRecorder API.
 */

import { useState, useRef, useCallback } from "react";
import { createVoiceMemo } from "../api";

interface VoiceRecorderProps {
  onCreated: () => void;
}

type RecordingState = "idle" | "recording" | "uploading";

export function VoiceRecorder({ onCreated }: VoiceRecorderProps) {
  const [state, setState] = useState<RecordingState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [duration, setDuration] = useState(0);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<number | null>(null);
  const startTimeRef = useRef<number>(0);

  const startRecording = useCallback(async () => {
    try {
      setError(null);

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

      // Prefer webm with opus codec, fallback to whatever is supported
      const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : MediaRecorder.isTypeSupported("audio/webm")
          ? "audio/webm"
          : "";

      const mediaRecorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      mediaRecorderRef.current = mediaRecorder;
      chunksRef.current = [];

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) {
          chunksRef.current.push(e.data);
        }
      };

      mediaRecorder.onstop = async () => {
        // Stop all tracks
        stream.getTracks().forEach((track) => track.stop());

        // Clear timer
        if (timerRef.current) {
          clearInterval(timerRef.current);
          timerRef.current = null;
        }

        // Create blob and upload
        const blob = new Blob(chunksRef.current, {
          type: mediaRecorder.mimeType || "audio/webm",
        });

        setState("uploading");

        try {
          await createVoiceMemo(blob);
          setState("idle");
          setDuration(0);
          onCreated();
        } catch (err) {
          setError((err as Error).message);
          setState("idle");
        }
      };

      mediaRecorder.onerror = () => {
        setError("Recording failed");
        setState("idle");
      };

      // Start recording
      mediaRecorder.start(1000); // Capture every second
      setState("recording");
      startTimeRef.current = Date.now();

      // Update duration timer
      timerRef.current = window.setInterval(() => {
        setDuration(Math.floor((Date.now() - startTimeRef.current) / 1000));
      }, 100);
    } catch (err) {
      const message = (err as Error).message;
      if (message.includes("Permission denied") || message.includes("NotAllowedError")) {
        setError("Microphone permission denied. Please allow microphone access.");
      } else {
        setError(`Failed to start recording: ${message}`);
      }
    }
  }, [onCreated]);

  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current && state === "recording") {
      mediaRecorderRef.current.stop();
    }
  }, [state]);

  const formatDuration = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  return (
    <div className="p-4 bg-white rounded-lg shadow">
      <h3 className="text-lg font-bold text-gray-900 mb-4">Voice Memo</h3>

      <div className="flex flex-col items-center gap-4">
        {state === "idle" && (
          <button
            onClick={startRecording}
            className="btn btn-primary flex items-center gap-2"
          >
            <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
              <path
                fillRule="evenodd"
                d="M7 4a3 3 0 016 0v4a3 3 0 11-6 0V4zm4 10.93A7.001 7.001 0 0017 8a1 1 0 10-2 0A5 5 0 015 8a1 1 0 00-2 0 7.001 7.001 0 006 6.93V17H6a1 1 0 100 2h8a1 1 0 100-2h-3v-2.07z"
                clipRule="evenodd"
              />
            </svg>
            Start Recording
          </button>
        )}

        {state === "recording" && (
          <>
            <div className="flex items-center gap-3">
              <span className="relative flex h-3 w-3">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-3 w-3 bg-red-500"></span>
              </span>
              <span className="text-lg font-mono">{formatDuration(duration)}</span>
            </div>
            <button
              onClick={stopRecording}
              className="btn bg-red-600 hover:bg-red-700 text-white flex items-center gap-2"
            >
              <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                <path
                  fillRule="evenodd"
                  d="M10 18a8 8 0 100-16 8 8 0 000 16zM8 7a1 1 0 00-1 1v4a1 1 0 001 1h4a1 1 0 001-1V8a1 1 0 00-1-1H8z"
                  clipRule="evenodd"
                />
              </svg>
              Stop Recording
            </button>
          </>
        )}

        {state === "uploading" && (
          <div className="flex items-center gap-2 text-gray-600">
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
              ></circle>
              <path
                className="opacity-75"
                fill="currentColor"
                d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
              ></path>
            </svg>
            Uploading...
          </div>
        )}

        {error && <div className="text-red-600 text-sm text-center">Error: {error}</div>}
      </div>

      <p className="text-xs text-gray-500 text-center mt-4">
        Voice memos will be transcribed automatically at the next wakeup.
      </p>
    </div>
  );
}

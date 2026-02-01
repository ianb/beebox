/**
 * NewMemo - Form for creating memos with text and/or voice.
 *
 * This is just the input form. When submitted, it calls onSubmit with the
 * command args, and the parent shows the CommandRunner.
 */

import { useState, useRef, useCallback } from "react";
import { uploadFile } from "../api";

export interface MemoCommandArgs {
  path: string;
  content?: string;
  attachment?: string;
  attachmentMimetype?: string;
  commit: boolean;
}

interface NewMemoProps {
  onSubmit: (args: MemoCommandArgs) => void;
  onClose: () => void;
}

type RecordingState = "idle" | "recording";

export function NewMemo({ onSubmit, onClose }: NewMemoProps) {
  // Text content
  const [content, setContent] = useState("");

  // Voice recording state
  const [recordingState, setRecordingState] = useState<RecordingState>("idle");
  const [duration, setDuration] = useState(0);
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);

  // Submit state
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Recording refs
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<number | null>(null);
  const startTimeRef = useRef<number>(0);

  const hasContent = content.trim().length > 0 || audioBlob !== null;

  const startRecording = useCallback(async () => {
    try {
      setError(null);

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

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

      mediaRecorder.onstop = () => {
        stream.getTracks().forEach((track) => track.stop());

        if (timerRef.current) {
          clearInterval(timerRef.current);
          timerRef.current = null;
        }

        const blob = new Blob(chunksRef.current, {
          type: mediaRecorder.mimeType || "audio/webm",
        });
        setAudioBlob(blob);
        setRecordingState("idle");
      };

      mediaRecorder.onerror = () => {
        setError("Recording failed");
        setRecordingState("idle");
      };

      mediaRecorder.start(1000);
      setRecordingState("recording");
      startTimeRef.current = Date.now();

      timerRef.current = window.setInterval(() => {
        setDuration(Math.floor((Date.now() - startTimeRef.current) / 1000));
      }, 100);
    } catch (err) {
      const message = (err as Error).message;
      if (message.includes("Permission denied") || message.includes("NotAllowedError")) {
        setError("Microphone permission denied");
      } else {
        setError(`Failed to start recording: ${message}`);
      }
    }
  }, []);

  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current && recordingState === "recording") {
      mediaRecorderRef.current.stop();
    }
  }, [recordingState]);

  const clearRecording = useCallback(() => {
    setAudioBlob(null);
    setDuration(0);
  }, []);

  const formatDuration = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  const handleSubmit = async () => {
    if (!hasContent) return;

    try {
      setError(null);

      // Generate card path
      const now = new Date();
      const timestamp = now.toISOString().replace(/[:.]/g, "-").slice(0, 19);

      // Determine card type based on content
      const hasAudio = audioBlob !== null;

      // If we have audio, use voice-memo template; otherwise memo
      const cardType = hasAudio ? "voice-memo" : "memo";
      const name = hasAudio ? `Voice_Memo_${timestamp}` : `Memo_${timestamp}`;
      const cardPath = `box/inbox/memos/${name}.${cardType}.card`;

      const args: MemoCommandArgs = {
        path: cardPath,
        commit: true,
      };

      // Add text content if present
      if (content.trim().length > 0) {
        args.content = content.trim();
      }

      // Upload audio if present
      if (hasAudio && audioBlob) {
        setUploading(true);

        const uploadResult = await uploadFile(audioBlob, "recording.webm");
        args.attachment = uploadResult.path;
        args.attachmentMimetype = uploadResult.mimetype;

        setUploading(false);
      }

      // Call parent with the args
      onSubmit(args);
    } catch (err) {
      setError((err as Error).message);
      setUploading(false);
    }
  };

  return (
    <div className="bg-white rounded-lg shadow p-4 max-w-xl">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-bold text-gray-900">New Memo</h3>
        <button
          onClick={onClose}
          className="text-gray-400 hover:text-gray-600"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* Text input */}
      <div className="mb-4">
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          placeholder="What's on your mind?"
          className="input w-full h-32 resize-none"
          disabled={uploading || recordingState === "recording"}
        />
      </div>

      {/* Voice recording section */}
      <div className="mb-4 p-3 bg-gray-50 rounded-lg">
        <div className="flex items-center justify-between">
          <span className="text-sm text-gray-600">Voice Recording</span>

          {recordingState === "idle" && !audioBlob && (
            <button
              onClick={startRecording}
              disabled={uploading}
              className="btn btn-sm bg-gray-200 hover:bg-gray-300 text-gray-700 flex items-center gap-1"
            >
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                <path
                  fillRule="evenodd"
                  d="M7 4a3 3 0 016 0v4a3 3 0 11-6 0V4zm4 10.93A7.001 7.001 0 0017 8a1 1 0 10-2 0A5 5 0 015 8a1 1 0 00-2 0 7.001 7.001 0 006 6.93V17H6a1 1 0 100 2h8a1 1 0 100-2h-3v-2.07z"
                  clipRule="evenodd"
                />
              </svg>
              Record
            </button>
          )}

          {recordingState === "recording" && (
            <div className="flex items-center gap-2">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-red-500"></span>
              </span>
              <span className="text-sm font-mono">{formatDuration(duration)}</span>
              <button
                onClick={stopRecording}
                className="btn btn-sm bg-red-600 hover:bg-red-700 text-white"
              >
                Stop
              </button>
            </div>
          )}

          {recordingState === "idle" && audioBlob && (
            <div className="flex items-center gap-2">
              <span className="text-sm text-green-600">
                ✓ {formatDuration(duration)} recorded
              </span>
              <button
                onClick={clearRecording}
                disabled={uploading}
                className="text-sm text-gray-500 hover:text-red-600"
              >
                Remove
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Error display */}
      {error && (
        <div className="text-red-600 text-sm mb-4">Error: {error}</div>
      )}

      {/* Submit button */}
      <div className="flex gap-2">
        <button
          onClick={handleSubmit}
          disabled={!hasContent || uploading || recordingState === "recording"}
          className="btn btn-primary flex-1 font-mono text-sm"
        >
          {uploading ? (
            "Uploading audio..."
          ) : (
            <>cb create</>
          )}
        </button>
        <button
          onClick={onClose}
          className="btn btn-secondary"
        >
          Cancel
        </button>
      </div>

      <p className="text-xs text-gray-500 text-center mt-3">
        {audioBlob
          ? "Voice will be transcribed at the next wakeup."
          : "You can type text and/or record voice."}
      </p>
    </div>
  );
}

/**
 * Build a command label for display.
 */
export function buildCreateCommandLabel(args: MemoCommandArgs): string {
  const parts = ["cb create", args.path];
  if (args.content) {
    parts.push('--content "..."');
  }
  if (args.attachment) {
    parts.push("--attachment <audio>");
  }
  parts.push("--commit");
  return parts.join(" ");
}

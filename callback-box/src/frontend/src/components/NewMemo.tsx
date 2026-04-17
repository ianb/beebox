/**
 * NewMemo - Form for creating memos with text and/or voice.
 *
 * This is just the input form. When submitted, it calls onSubmit with the
 * command args, and the parent shows the CommandRunner.
 */

import { useState, useRef, useCallback } from "react";
import { uploadFile } from "../api";
import { TextareaField } from "./ui/fields";
import { Button } from "./ui/Button";
import { InlineAction } from "./ui/InlineAction";
import { CloseButton } from "./ui/CloseButton";
import { CancelButton } from "./ui/CancelButton";

const MicIcon = () => (
  <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20" aria-hidden="true">
    <path fillRule="evenodd" d="M7 4a3 3 0 016 0v4a3 3 0 11-6 0V4zm4 10.93A7.001 7.001 0 0017 8a1 1 0 10-2 0A5 5 0 015 8a1 1 0 00-2 0 7.001 7.001 0 006 6.93V17H6a1 1 0 100 2h8a1 1 0 100-2h-3v-2.07z" clipRule="evenodd" />
  </svg>
);

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
        for (const track of stream.getTracks()) track.stop();

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
      const timestamp = now.toISOString().replace(/[.:]/g, "-").slice(0, 19);

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
        <h3 className="text-lg font-bold text-warm-900">New Memo</h3>
        <CloseButton onClick={onClose} />
      </div>

      {/* Text input */}
      <TextareaField
        label="Memo content"
        value={content}
        onChange={setContent}
        placeholder="What's on your mind?"
        rows={6}
        inputClassName="resize-none"
        disabled={uploading || recordingState === "recording"}
        className="mb-4"
      />

      {/* Voice recording section */}
      <div className="mb-4 p-3 bg-warm-50 rounded-lg">
        <div className="flex items-center justify-between">
          <span className="text-sm text-warm-700">Voice Recording</span>

          {recordingState === "idle" && !audioBlob && (
            <Button type="button" intent="secondary" size="sm" icon={<MicIcon />} onClick={startRecording} disabled={uploading}>
              Record
            </Button>
          )}

          {recordingState === "recording" && (
            <div className="flex items-center gap-2">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-danger-light opacity-75" />
                <span className="relative inline-flex rounded-full h-2 w-2 bg-danger" />
              </span>
              <span className="text-sm font-mono">{formatDuration(duration)}</span>
              <Button type="button" intent="destructive" size="sm" onClick={stopRecording}>Stop</Button>
            </div>
          )}

          {recordingState === "idle" && audioBlob ? (
            <div className="flex items-center gap-2 text-sm">
              <span className="text-success">
                ✓ {formatDuration(duration)} recorded
              </span>
              <InlineAction intent="danger" onClick={clearRecording} disabled={uploading}>
                Remove
              </InlineAction>
            </div>
          ) : null}
        </div>
      </div>

      {/* Error display */}
      {error ? <div className="text-danger-dark text-sm mb-4">Error: {error}</div> : null}

      {/* Submit button */}
      <div className="flex gap-2">
        <Button
          type="button"
          intent="primary"
          size="sm"
          fullWidth
          onClick={handleSubmit}
          disabled={!hasContent || recordingState === "recording"}
          loading={uploading}
          loadingLabel="Uploading audio…"
          className="flex-1"
        >
          <span className="font-mono">cb create</span>
        </Button>
        <CancelButton onClick={onClose} />
      </div>

      <p className="text-xs text-warm-600 text-center mt-3">
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

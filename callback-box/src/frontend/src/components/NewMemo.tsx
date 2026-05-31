/**
 * NewMemo - Form for creating memos with text and/or voice.
 *
 * This is just the input form. When submitted, it calls onSubmit with the
 * command args, and the parent shows the CommandRunner.
 */

import { useState } from "react";
import { uploadFile } from "../api";
import { TextareaField } from "./ui/fields";
import { Button } from "./ui/Button";
import { CloseButton } from "./ui/CloseButton";
import { CancelButton } from "./ui/CancelButton";
import { VoiceRecorder } from "./NewMemo-VoiceRecorder";
import { useVoiceRecording } from "./useVoiceRecording";

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

export function NewMemo({ onSubmit, onClose }: NewMemoProps) {
  // Text content
  const [content, setContent] = useState("");

  // Voice recording state
  const {
    recordingState,
    duration,
    audioBlob,
    error,
    startRecording,
    stopRecording,
    clearRecording,
    setError,
  } = useVoiceRecording();

  // Submit state
  const [uploading, setUploading] = useState(false);

  const hasContent = content.trim().length > 0 || audioBlob !== null;

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
      setError(err instanceof Error ? err.message : String(err));
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
      <VoiceRecorder
        recordingState={recordingState}
        duration={duration}
        audioBlob={audioBlob}
        uploading={uploading}
        onStart={startRecording}
        onStop={stopRecording}
        onClear={clearRecording}
      />

      {/* Error display */}
      {error ? <div className="text-danger-dark text-sm mb-4">Error: {error}</div> : null}

      {/* Submit button */}
      <div className="flex gap-2">
        <Button
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

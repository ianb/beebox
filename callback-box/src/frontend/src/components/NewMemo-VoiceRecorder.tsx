/**
 * NewMemo-VoiceRecorder - the voice-recording row inside the NewMemo form.
 *
 * Pure presentation over the useVoiceRecording state: shows a Record button
 * when idle, a live timer + Stop while recording, and a "recorded / Remove"
 * summary once a blob exists.
 */

import { Button } from "./ui/Button";
import { InlineAction } from "./ui/InlineAction";
import type { RecordingState } from "./useVoiceRecording";

const MicIcon = () => (
  <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20" aria-hidden="true">
    <path fillRule="evenodd" d="M7 4a3 3 0 016 0v4a3 3 0 11-6 0V4zm4 10.93A7.001 7.001 0 0017 8a1 1 0 10-2 0A5 5 0 015 8a1 1 0 00-2 0 7.001 7.001 0 006 6.93V17H6a1 1 0 100 2h8a1 1 0 100-2h-3v-2.07z" clipRule="evenodd" />
  </svg>
);

function formatDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

interface VoiceRecorderProps {
  recordingState: RecordingState;
  duration: number;
  audioBlob: Blob | null;
  uploading: boolean;
  onStart: () => void;
  onStop: () => void;
  onClear: () => void;
}

export function VoiceRecorder({
  recordingState,
  duration,
  audioBlob,
  uploading,
  onStart,
  onStop,
  onClear,
}: VoiceRecorderProps) {
  return (
    <div className="mb-4 p-3 bg-warm-50 rounded-lg">
      <div className="flex items-center justify-between">
        <span className="text-sm text-warm-700">Voice Recording</span>

        {recordingState === "idle" && !audioBlob && (
          <Button intent="secondary" size="sm" icon={<MicIcon />} onClick={onStart} disabled={uploading}>
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
            <Button intent="destructive" size="sm" onClick={onStop}>Stop</Button>
          </div>
        )}

        {recordingState === "idle" && audioBlob ? (
          <div className="flex items-center gap-2 text-sm">
            <span className="text-success">
              ✓ {formatDuration(duration)} recorded
            </span>
            <InlineAction intent="danger" onClick={onClear} disabled={uploading}>
              Remove
            </InlineAction>
          </div>
        ) : null}
      </div>
    </div>
  );
}

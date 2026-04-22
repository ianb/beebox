/**
 * Bottom control row for the capture page: cancel / record-toggle / done.
 * Also surfaces a retry prompt when photo uploads have failed.
 */

interface CaptureControlsProps {
  sessionId: string | null;
  recording: boolean;
  uploadsInProgress: boolean;
  finalizing: boolean;
  hasContent: boolean;
  photosFailed: number;
  audioFailed: number;
  filesFailed: number;
  onDone: () => void;
  onCancel: () => void;
  onToggleRecording: () => void;
  onRetryFailed: () => void;
}

function summarizeFailures({ photosFailed, audioFailed, filesFailed }: { photosFailed: number; audioFailed: number; filesFailed: number }): string {
  const parts: string[] = [];
  if (photosFailed > 0) parts.push(`${photosFailed} photo${photosFailed > 1 ? "s" : ""}`);
  if (audioFailed > 0) parts.push(`${audioFailed} audio chunk${audioFailed > 1 ? "s" : ""}`);
  if (filesFailed > 0) parts.push(`${filesFailed} file${filesFailed > 1 ? "s" : ""}`);
  return parts.join(", ");
}

export function CaptureControls(props: CaptureControlsProps) {
  const totalFailed = props.photosFailed + props.audioFailed + props.filesFailed;
  const doneDisabled = !props.sessionId || props.uploadsInProgress || props.finalizing || !props.hasContent;
  return (
    <div className="flex flex-col items-center bg-gray-900/80">
      {totalFailed > 0 ? (
        <div className="text-danger-light text-sm py-2 px-4 text-center">
          {summarizeFailures(props)} failed to upload.{" "}
          <button onClick={props.onRetryFailed} className="text-warning-light underline">Retry</button>
          {" "}or press Done to finalize without them.
        </div>
      ) : null}
      <div className="flex items-center justify-around w-full px-6 py-4">
        <button onClick={props.onCancel} disabled={!props.sessionId || props.finalizing || !props.hasContent}
          className="w-12 h-12 rounded-full bg-gray-700 flex items-center justify-center disabled:opacity-30 active:bg-gray-600">
          <svg xmlns="http://www.w3.org/2000/svg" className="w-6 h-6 text-danger-light" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
          </svg>
        </button>
        <button onClick={props.onToggleRecording} disabled={!props.sessionId}
          className={`w-16 h-16 rounded-full border-4 border-white flex items-center justify-center disabled:opacity-30 ${props.recording ? "bg-danger-dark" : ""}`}>
          {props.recording ? <span className="w-7 h-7 bg-white rounded-sm" /> : (
            <svg xmlns="http://www.w3.org/2000/svg" className="w-8 h-8 text-danger" fill="currentColor" viewBox="0 0 24 24">
              <path d="M12 14a3 3 0 003-3V5a3 3 0 10-6 0v6a3 3 0 003 3z" /><path d="M17 11a5 5 0 01-10 0H5a7 7 0 0014 0h-2z" />
              <rect x="11" y="19" width="2" height="3" rx="1" /><rect x="8" y="21" width="8" height="2" rx="1" />
            </svg>
          )}
        </button>
        <button onClick={props.onDone} disabled={doneDisabled}
          className="w-12 h-12 rounded-full bg-success flex items-center justify-center disabled:opacity-30 active:bg-success">
          {props.finalizing ? (
            <span className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
          ) : (
            <svg xmlns="http://www.w3.org/2000/svg" className="w-6 h-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}><path d="M5 13l4 4L19 7" /></svg>
          )}
        </button>
      </div>
    </div>
  );
}

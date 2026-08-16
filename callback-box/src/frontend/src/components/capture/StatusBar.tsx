/**
 * Top status bar for the capture page: recording indicator + elapsed
 * timer on the left, per-kind upload counts (audio/photos/files) plus
 * upload/gallery/settings icons on the right.
 *
 * Uploads run one at a time, so the in-flight transfer's percentage is shown
 * alongside the counts — a full-resolution photo on a weak uplink is genuinely
 * slow, and without a moving number that is indistinguishable from a hang.
 */

interface StatusBarProps {
  recording: boolean;
  recordingTime: number;
  formatTime: (s: number) => string;
  audioTotal: number;
  audioUploading: number;
  audioUploaded: number;
  audioFailed: number;
  photoTotal: number;
  photosUploading: number;
  photosUploaded: number;
  photosFailed: number;
  fileTotal: number;
  filesUploading: number;
  filesUploaded: number;
  filesFailed: number;
  /** Percent complete of the transfer currently on the wire, if any. */
  activeUploadPercent: number | null;
  /** Done is sealing: new media would race the seal, so producers are closed. */
  finalizing: boolean;
  showSettings: boolean;
  onToggleSettings: () => void;
  onPickGallery: () => void;
  onPickFile: () => void;
  onRetryFailed: () => void;
}

/** " 42%" for the in-flight transfer, or nothing while the size is unknown. */
function percentLabel(percent: number | null): string {
  return percent === null ? "" : ` ${String(percent)}%`;
}

export function StatusBar(props: StatusBarProps) {
  return (
    <div className="flex items-center justify-between px-4 py-2 bg-gray-900/80 z-10">
      <div className="flex items-center gap-3">
        {props.recording ? (
          <div className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 bg-danger rounded-full animate-pulse" />
            <span className="text-sm font-mono">{props.formatTime(props.recordingTime)}</span>
          </div>
        ) : null}
        {!props.recording && props.audioTotal > 0 ? (
          <div className="flex items-center gap-1.5 text-sm">
            {props.audioUploading > 0 ? (
              <><span className="w-2 h-2 bg-warning-light rounded-full animate-pulse" /><span className="text-warning-light">audio uploading</span></>
            ) : props.audioFailed > 0 ? (
              <>
                <span className="text-danger-light">&#10007;</span>
                <span className="text-danger-light">{props.audioFailed} audio failed</span>
                <button onClick={props.onRetryFailed} disabled={props.finalizing} className="text-warning-light underline ml-1 disabled:opacity-40">retry</button>
              </>
            ) : (
              <><span className="text-success-light">&#10003;</span><span className="text-success-light">audio ({props.audioUploaded})</span></>
            )}
          </div>
        ) : null}
      </div>
      <div className="flex items-center gap-3 text-sm">
        {props.photoTotal > 0 ? (
          <div className="flex items-center gap-1.5">
            {props.photosUploading > 0 ? (
              <><span className="w-2 h-2 bg-warning-light rounded-full animate-pulse" /><span className="text-warning-light">{props.photosUploaded}/{props.photoTotal}{percentLabel(props.activeUploadPercent)}</span></>
            ) : props.photosFailed > 0 ? (
              <>
                <span className="text-danger-light">&#10007;</span>
                <span className="text-danger-light">{props.photosFailed} failed</span>
                <button onClick={props.onRetryFailed} disabled={props.finalizing} className="text-warning-light underline ml-1 disabled:opacity-40">retry</button>
                {props.photosUploaded > 0 ? <span className="text-success-light">, {props.photosUploaded} ok</span> : null}
              </>
            ) : (
              <><span className="text-success-light">&#10003;</span><span className="text-success-light">{props.photoTotal} photos</span></>
            )}
          </div>
        ) : null}
        {props.fileTotal > 0 ? (
          <div className="flex items-center gap-1.5">
            {props.filesUploading > 0 ? (
              <><span className="w-2 h-2 bg-warning-light rounded-full animate-pulse" /><span className="text-warning-light">{props.filesUploaded}/{props.fileTotal} files{percentLabel(props.activeUploadPercent)}</span></>
            ) : props.filesFailed > 0 ? (
              <>
                <span className="text-danger-light">&#10007;</span>
                <span className="text-danger-light">{props.filesFailed} failed</span>
                <button onClick={props.onRetryFailed} disabled={props.finalizing} className="text-warning-light underline ml-1 disabled:opacity-40">retry</button>
                {props.filesUploaded > 0 ? <span className="text-success-light">, {props.filesUploaded} ok</span> : null}
              </>
            ) : (
              <><span className="text-success-light">&#10003;</span><span className="text-success-light">{props.fileTotal} files</span></>
            )}
          </div>
        ) : null}
        <button onClick={props.onPickFile} disabled={props.finalizing} className="text-gray-400 hover:text-white p-1 disabled:opacity-30" title="Upload file" aria-label="Upload file"><span aria-hidden="true">&#128206;</span></button>
        <button onClick={props.onPickGallery} disabled={props.finalizing} className="text-gray-400 hover:text-white p-1 disabled:opacity-30" title="Add from gallery" aria-label="Add from gallery"><span aria-hidden="true">&#128247;</span></button>
        <button
          onClick={props.onToggleSettings}
          className={`p-1 text-lg ${props.showSettings ? "text-white" : "text-gray-400 hover:text-white"}`}
          title="Device settings"
          aria-label="Device settings"
          aria-expanded={props.showSettings}
        ><span aria-hidden="true">&#9881;</span></button>
      </div>
    </div>
  );
}

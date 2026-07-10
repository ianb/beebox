/**
 * Full-screen capture overlay — capture mode for the chat composer (Track 4).
 *
 * Re-hosts the standalone capture surface (dark-themed status bar / camera
 * viewport / device settings / controls) as an overlay above the chat. Driven
 * by `useCaptureSession`, re-pointed at the current chat via `targetSessionId`
 * so the delivered `<capture>` message lands in this conversation. "Done" seals
 * the staging session (background preparation + delivery take over, surfaced by
 * the pending capture bubble) and calls `onExit`; "Cancel" discards and exits.
 *
 * Lives under `components/` (not `pages/`) so it's exempt from
 * restrict-component-classes and the reused dark palette stays intact. The mode
 * toggle lives in `InteractiveChat`; this only renders while active.
 */

import { CaptureShell } from "./CaptureShell";
import { StatusBar } from "./StatusBar";
import { DeviceSettings } from "./DeviceSettings";
import { CameraViewport } from "./CameraViewport";
import { CaptureErrorBanner } from "./CaptureErrorBanner";
import { CaptureControls } from "./CaptureControls";
import { useCaptureSession } from "../../pages/capture/useCaptureSession";

function formatTime(seconds: number): string {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

export function CaptureOverlay({ targetSessionId, onExit }: { targetSessionId: string | null; onExit: () => void }) {
  const { state, devices, uploads, inputs, camera, videoRef, actions } = useCaptureSession({ targetSessionId, onExit });
  const { recording, recordingTime, error, finalizing, showSettings, sessionId } = state;
  const { counts } = uploads;
  const { videoDevices, audioDevices, devicePrefs, updateDevicePref } = devices;
  const { galleryRef, uploadRef, pickFromGallery, pickFileToUpload, handleGallerySelect, handleFileSelect } = inputs;
  const { cameraOn, flashing, startCamera, toggleCamera, flipCamera } = camera;
  const { setShowSettings, setError, toggleRecording, takePhoto, retryFailedUploads, handleDone, handleCancel } = actions;

  return (
    <div className="fixed inset-0 z-50">
      <CaptureShell>
        <StatusBar
          recording={recording} recordingTime={recordingTime} formatTime={formatTime}
          audioTotal={counts.audioTotal} audioUploading={counts.audioUploading} audioUploaded={counts.audioUploaded} audioFailed={counts.audioFailed}
          photoTotal={counts.photoTotal} photosUploading={counts.photosUploading} photosUploaded={counts.photosUploaded} photosFailed={counts.photosFailed}
          fileTotal={counts.fileTotal} filesUploading={counts.filesUploading} filesUploaded={counts.filesUploaded} filesFailed={counts.filesFailed}
          showSettings={showSettings}
          onToggleSettings={() => setShowSettings((p) => !p)}
          onPickGallery={pickFromGallery} onPickFile={pickFileToUpload} onRetryFailed={retryFailedUploads}
        />

        {showSettings ? (
          <DeviceSettings
            videoDevices={videoDevices} audioDevices={audioDevices}
            devicePrefs={devicePrefs} onUpdate={updateDevicePref}
          />
        ) : null}

        <CameraViewport
          ref={videoRef}
          cameraOn={cameraOn}
          flashing={flashing}
          // Failures already surface via the overlay's `error` state
          // (useCaptureCamera/useCaptureSession's own try/catch); voided here
          // only to satisfy the sync attribute type.
          onTap={() => void (cameraOn ? takePhoto() : startCamera())}
          onToggleCamera={() => void toggleCamera()}
          onFlipCamera={() => void flipCamera()}
        />

        {error ? <CaptureErrorBanner message={error} onDismiss={() => setError(null)} /> : null}

        <input ref={galleryRef} type="file" accept="image/*" multiple hidden onChange={handleGallerySelect} />
        <input ref={uploadRef} type="file" multiple hidden onChange={handleFileSelect} />

        <CaptureControls
          sessionId={sessionId} recording={recording} uploadsInProgress={counts.uploadsInProgress} finalizing={finalizing}
          hasContent={counts.photoTotal > 0 || counts.audioTotal > 0 || counts.fileTotal > 0}
          photosFailed={counts.photosFailed} audioFailed={counts.audioFailed} filesFailed={counts.filesFailed}
          onDone={() => void handleDone()} onCancel={() => void handleCancel()} onToggleRecording={() => void toggleRecording()} onRetryFailed={retryFailedUploads}
        />
      </CaptureShell>
    </div>
  );
}

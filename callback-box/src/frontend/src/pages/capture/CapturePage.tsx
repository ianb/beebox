/**
 * Capture page — audio recording + photo capture.
 *
 * Ported from the legacy capture view. Sessions accumulate files
 * and finalize into inbox cards. Device preferences stored in localStorage.
 *
 * The dark-themed UI (status bar / camera viewport / device settings /
 * error banner / controls) lives under components/capture/ where the
 * off-palette colors can stay without tripping the restrict-component-classes
 * ESLint rule. This page coordinates state, sessions, and uploads via the
 * useCaptureSession hook; cohesive logic lives in the sibling capture-* hooks.
 */

import { CaptureShell } from "../../components/capture/CaptureShell";
import { StatusBar } from "../../components/capture/StatusBar";
import { DeviceSettings } from "../../components/capture/DeviceSettings";
import { CameraViewport } from "../../components/capture/CameraViewport";
import { CaptureErrorBanner } from "../../components/capture/CaptureErrorBanner";
import { CaptureControls } from "../../components/capture/CaptureControls";
import { useCaptureSession } from "./useCaptureSession";

function formatTime(seconds: number): string {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

export function CapturePage() {
  const { state, devices, uploads, inputs, camera, videoRef, actions } = useCaptureSession();
  const { recording, recordingTime, error, finalizing, showSettings, sessionId } = state;
  const { counts } = uploads;
  const { videoDevices, audioDevices, devicePrefs, updateDevicePref } = devices;
  const { galleryRef, uploadRef, pickFromGallery, pickFileToUpload, handleGallerySelect, handleFileSelect } = inputs;
  const { cameraOn, flashing, startCamera, toggleCamera, flipCamera } = camera;
  const { setShowSettings, setError, toggleRecording, takePhoto, retryFailedUploads, handleDone, handleCancel } = actions;

  return (
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
        // All four already surface failures via the page's `error` state
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
  );
}

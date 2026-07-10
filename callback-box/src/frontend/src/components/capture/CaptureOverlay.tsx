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
 * On entry (Track 5) it first asks whether an earlier capture was left
 * unfinished; if so it prompts resume / submit-now / discard (`CaptureResumeDialog`)
 * before starting the live surface.
 *
 * Lives under `components/` (not `pages/`) so it's exempt from
 * restrict-component-classes and the reused dark palette stays intact. The mode
 * toggle lives in `InteractiveChat`; this only renders while active.
 */

import { useState } from "react";
import { CaptureShell } from "./CaptureShell";
import { StatusBar } from "./StatusBar";
import { DeviceSettings } from "./DeviceSettings";
import { CameraViewport } from "./CameraViewport";
import { CaptureErrorBanner } from "./CaptureErrorBanner";
import { CaptureControls } from "./CaptureControls";
import { CaptureResumeDialog } from "./CaptureResumeDialog";
import { useCaptureResume, type ResumableCaptureView } from "./useCaptureResume";
import { useCaptureSession, type CaptureResumeTarget } from "../../pages/capture/useCaptureSession";

function formatTime(seconds: number): string {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

/** null = undecided (dialog may show); otherwise the surface runs fresh or resumed. */
type Decision = null | { kind: "fresh" } | { kind: "resume"; target: CaptureResumeTarget };

function toResumeTarget(capture: ResumableCaptureView): CaptureResumeTarget {
  return {
    id: capture.id,
    photoCount: capture.counts.photos,
    fileCount: capture.counts.files,
    segmentCount: capture.counts.audioSegments,
  };
}

export function CaptureOverlay({ targetSessionId, onExit }: { targetSessionId: string | null; onExit: () => void }) {
  const [decision, setDecision] = useState<Decision>(null);
  const [busy, setBusy] = useState(false);
  const { loading, resumable, submitNow, discard } = useCaptureResume(targetSessionId);

  // Prompt on the most recent unfinished capture until the user decides.
  const candidate = decision === null && resumable.length > 0 ? resumable[resumable.length - 1]! : null;

  const handleSubmit = async (id: string): Promise<void> => {
    setBusy(true);
    try {
      await submitNow(id);
    } catch (e) {
      console.error("[capture] Submit-now of resumable session failed:", e);
    } finally {
      setBusy(false);
      setDecision({ kind: "fresh" });
    }
  };

  const handleDiscard = async (id: string): Promise<void> => {
    setBusy(true);
    try {
      await discard(id);
    } catch (e) {
      console.error("[capture] Discard of resumable session failed:", e);
    } finally {
      setBusy(false);
      setDecision({ kind: "fresh" });
    }
  };

  return (
    <div className="fixed inset-0 z-50">
      {decision === null && loading ? (
        <CaptureShell />
      ) : candidate ? (
        <CaptureShell>
          <CaptureResumeDialog
            capture={candidate}
            busy={busy}
            onResume={() => setDecision({ kind: "resume", target: toResumeTarget(candidate) })}
            onSubmit={() => void handleSubmit(candidate.id)}
            onDiscard={() => void handleDiscard(candidate.id)}
          />
        </CaptureShell>
      ) : (
        <CaptureSurface
          targetSessionId={targetSessionId}
          resume={decision !== null && decision.kind === "resume" ? decision.target : null}
          onExit={onExit}
        />
      )}
    </div>
  );
}

function CaptureSurface({ targetSessionId, resume, onExit }: {
  targetSessionId: string | null;
  resume: CaptureResumeTarget | null;
  onExit: () => void;
}) {
  const { state, devices, uploads, inputs, camera, videoRef, actions } = useCaptureSession({ targetSessionId, resume, onExit });
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
  );
}

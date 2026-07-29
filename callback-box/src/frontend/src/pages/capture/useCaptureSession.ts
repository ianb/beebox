/**
 * Top-level state machine for the capture page: session lifecycle,
 * recording, photo capture, and the done/cancel flows. Composes the
 * device, upload, camera, and file-input sub-hooks.
 */

import { useState, useEffect, useRef, useCallback, type Dispatch, type SetStateAction } from "react";
import { ChunkedRecorder, type ChunkCallbackParams } from "../../lib/audio/recorder";
import { loadDevicePrefs, saveResumeSessionId, clearResumeSessionId, type UploadState } from "./capture-api";
import { useCaptureApi } from "./capture-api-context";
import { useCaptureDevices } from "./useCaptureDevices";
import { useCaptureUploads } from "./useCaptureUploads";
import { useCaptureInputs } from "./useCaptureInputs";
import { useCaptureCamera } from "./useCaptureCamera";

/**
 * Capture-mode recorder timeslice: 5s (vs the recorder's 20s default) shortens
 * the crash loss window to the tail since the last `dataavailable` (Track 5).
 */
const CAPTURE_TIMESLICE_MS = 5_000;

/**
 * A staging session the user chose to resume (Track 5). Adopting it means new
 * media must be numbered ABOVE the counts already on disk, or a fresh
 * `photo-001`/`audio-0-…` would overwrite the resumed session's media — so the
 * existing counts seed the client's upload indices.
 */
export interface CaptureResumeTarget {
  id: string;
  photoCount: number;
  fileCount: number;
  segmentCount: number;
}

/**
 * @param targetSessionId - the chat session capture was started from, recorded
 *   on the staging session so delivery lands in that chat. `null` for a fresh
 *   or unresolved chat (delivery falls back to most-active / a new session).
 * @param onExit - called after Done (finalize) or Cancel to close the capture
 *   surface and return to the composer. In capture-mode-in-chat there is no
 *   "loop into a fresh session" as the standalone page had — one capture, then
 *   back to chat.
 * @param resume - when set (the user chose "Resume" in the crash-resume prompt),
 *   adopt that open staging session instead of creating a fresh one; new media
 *   is numbered above its existing counts and a new recording is a new segment.
 */
export function useCaptureSession(opts: {
  targetSessionId: string | null;
  onExit: () => void;
  resume?: CaptureResumeTarget | null;
}) {
  const { targetSessionId, onExit } = opts;
  const resume = opts.resume ?? null;
  const { finalizeCaptureSession, cancelCaptureSession } = useCaptureApi();
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [recording, setRecording] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [finalizing, setFinalizing] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const isMobile = "ontouchstart" in window;

  const devices = useCaptureDevices();
  const uploads = useCaptureUploads();
  const { videoDevices, devicePrefs, refreshDevices, setVideoDevices, setAudioDevices } = devices;
  const { setPhotoStates, setFileStates, uploadPhoto, uploadFile, handleChunk } = uploads;
  const { awaitPending, abortPending, clearPendingAndFailed } = uploads;

  const camera = useCaptureCamera({
    videoDeviceId: devicePrefs.videoDeviceId, videoDevices, isMobile, setError, refreshDevices,
  });
  const { videoRef, cameraOn, startCamera, triggerFlash } = camera;

  const recorderRef = useRef<ChunkedRecorder | null>(null);
  const timerRef = useRef<number | null>(null);
  const recordStartRef = useRef<number>(0);
  // Each recording start is a new segment (toggle-off → toggle-on = new segment).
  // Seeded from a resumed session's existing segment count so new recordings
  // don't reuse an on-disk segment index.
  const segmentCountRef = useRef<number>(resume ? resume.segmentCount : 0);

  // Adopt (resume) or create the staging session on mount, then enumerate
  // devices. On resume, seed the upload-count arrays so new media numbers above
  // what's already staged; on create, persist the id for a later resume prompt.
  useBootstrapStagingSession({
    targetSessionId, resume,
    setSessionId, setError, setVideoDevices, setAudioDevices, setPhotoStates, setFileStates,
  });

  useEffect(() => {
    if (recording) {
      recordStartRef.current = Date.now();
      timerRef.current = window.setInterval(() => {
        setRecordingTime(Math.floor((Date.now() - recordStartRef.current) / 1000));
      }, 1000);
    } else {
      if (timerRef.current) clearInterval(timerRef.current);
    }
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [recording]);

  const toggleRecording = useCallback(async () => {
    if (recording) {
      // Await the final dataavailable so the tail chunk uploads before the
      // segment closes (a bare stop() would drop it — Track 5 loss window).
      if (recorderRef.current) { await recorderRef.current.stopAsync(); recorderRef.current = null; }
      setRecording(false);
      setRecordingTime(0);
    } else {
      if (!sessionId) return;
      try {
        const prefs = loadDevicePrefs();
        // A fresh recording start = a new segment; each segment gets its own
        // ChunkedRecorder (its own WebM header) and a stable id + index.
        const segmentIndex = segmentCountRef.current;
        segmentCountRef.current += 1;
        const segmentId = crypto.randomUUID();
        const segmentStartedAt = new Date().toISOString();
        const recorder = new ChunkedRecorder({
          onChunk: (chunk: ChunkCallbackParams) =>
            handleChunk({ sessionId, segmentId, segmentIndex, segmentStartedAt, ...chunk }),
          deviceId: prefs.audioDeviceId ?? undefined,
          timesliceMs: CAPTURE_TIMESLICE_MS,
        });
        recorderRef.current = recorder;
        await recorder.start();
        setRecording(true);
        refreshDevices();
      } catch (err) {
        setError(`Microphone access failed: ${err instanceof Error ? err.message : "unknown"}`);
      }
    }
  }, [recording, sessionId, handleChunk, refreshDevices]);

  const photoTotal = uploads.counts.photoTotal;
  const takePhoto = useCallback(async () => {
    if (!sessionId) return;
    if (!cameraOn) { await startCamera(); return; }
    triggerFlash();
    const { blob: blobPromise, source } = camera.takePhoto();
    const blob = await blobPromise;
    if (!blob) return;
    const index = photoTotal;
    const startedAt = new Date().toISOString();
    setPhotoStates((prev) => [...prev, "uploading"]);
    uploadPhoto({ sessionId, index, blob, startedAt, source });
  }, [sessionId, cameraOn, photoTotal, startCamera, triggerFlash, camera, uploadPhoto, setPhotoStates]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement) return;
      if (e.key === " ") { e.preventDefault(); void takePhoto(); }
      else if (e.key === "r" || e.key === "R") { e.preventDefault(); void toggleRecording(); }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [takePhoto, toggleRecording]);

  const inputs = useCaptureInputs({
    sessionId, photoTotal, fileTotal: uploads.counts.fileTotal,
    setPhotoStates, setFileStates, uploadPhoto, uploadFile,
  });

  const retryFailedUploads = useCallback(() => {
    if (sessionId) uploads.retryFailedUploads(sessionId);
  }, [sessionId, uploads]);

  // Abandon whatever is still on the wire and let the pending Done proceed with
  // what has landed. Aborted transfers settle as failures, so the `awaitPending`
  // that `handleDone` is sitting on resolves immediately after this.
  const skipPendingUploads = useCallback(() => {
    abortPending();
  }, [abortPending]);

  // Seal the staging session (fires background preparation → delivery) and exit
  // capture mode. A server-derived pending bubble takes over from here.
  //
  // Done is never blocked on uploads being finished (see CaptureControls): it
  // waits for outstanding transfers, showing the count and a Skip affordance,
  // so a slow link delays the seal but a broken one doesn't trap the user.
  const handleDone = useCallback(async () => {
    if (!sessionId || finalizing) return;
    setFinalizing(true);
    try {
      // Stop recorder and wait for the final dataavailable event to fire
      if (recording && recorderRef.current) {
        await recorderRef.current.stopAsync();
        recorderRef.current = null;
        setRecording(false);
      }
      await awaitPending();
      await finalizeCaptureSession(sessionId);
      clearResumeSessionId(); // sealed — no longer resumable
      camera.stopCamera();
      clearPendingAndFailed();
      onExit();
    } catch (err) { setError(`Finalize failed: ${err instanceof Error ? err.message : "unknown"}`); setFinalizing(false); }
  }, [sessionId, finalizing, recording, awaitPending, finalizeCaptureSession, camera, clearPendingAndFailed, onExit]);

  const handleCancel = useCallback(async () => {
    // Await the tail chunk even on cancel: it may become a resumable session.
    if (recording && recorderRef.current) { await recorderRef.current.stopAsync(); recorderRef.current = null; setRecording(false); }
    clearPendingAndFailed();
    camera.stopCamera();
    if (sessionId) {
      try {
        await cancelCaptureSession(sessionId);
        clearResumeSessionId(); // discarded — no longer resumable
      } catch (err) {
        console.error("Cancel failed:", err);
      }
    }
    onExit();
  }, [sessionId, recording, camera, cancelCaptureSession, clearPendingAndFailed, onExit]);

  return {
    state: { sessionId, recording, recordingTime, error, finalizing, showSettings },
    devices, uploads, inputs, camera,
    videoRef,
    actions: {
      setShowSettings, setError,
      toggleRecording, takePhoto,
      retryFailedUploads, skipPendingUploads, handleDone, handleCancel,
    },
  };
}

/**
 * Mount-time staging-session bootstrap: adopt a resumed session (seeding the
 * upload-count arrays so new media numbers above what's on disk) or create a
 * fresh one (persisting its id for a later resume prompt), then enumerate
 * devices. Extracted from {@link useCaptureSession} to keep it within its line
 * budget; runs exactly once per capture-mode entry.
 */
function useBootstrapStagingSession(opts: {
  targetSessionId: string | null;
  resume: CaptureResumeTarget | null;
  setSessionId: Dispatch<SetStateAction<string | null>>;
  setError: Dispatch<SetStateAction<string | null>>;
  setVideoDevices: (devices: MediaDeviceInfo[]) => void;
  setAudioDevices: (devices: MediaDeviceInfo[]) => void;
  setPhotoStates: Dispatch<SetStateAction<UploadState[]>>;
  setFileStates: Dispatch<SetStateAction<UploadState[]>>;
}): void {
  const { targetSessionId, resume, setSessionId, setError } = opts;
  const { setVideoDevices, setAudioDevices, setPhotoStates, setFileStates } = opts;
  const { createCaptureSession } = useCaptureApi();

  useEffect(() => {
    let cancelled = false;
    if (resume) {
      // Adopt the open session and seed the upload counts so the next photo is
      // `photo-${photoCount+1}` (not `photo-001`, which would clobber on disk).
      setSessionId(resume.id);
      setPhotoStates(Array.from<UploadState>({ length: resume.photoCount }).fill("uploaded"));
      setFileStates(Array.from<UploadState>({ length: resume.fileCount }).fill("uploaded"));
    } else {
      createCaptureSession(targetSessionId).then((result) => {
        if (cancelled) return;
        setSessionId(result.sessionId);
        saveResumeSessionId(result.sessionId);
      }).catch((err: Error) => {
        if (!cancelled) setError(`Session creation failed: ${err.message}`);
      });
    }
    navigator.mediaDevices.enumerateDevices().then((d) => {
      if (cancelled) return;
      setVideoDevices(d.filter((dev) => dev.kind === "videoinput"));
      setAudioDevices(d.filter((dev) => dev.kind === "audioinput"));
    }).catch((_e: Error) => {
      // Permission not yet granted — devices populate after first use
    });
    return () => { cancelled = true; };
  }, [targetSessionId, resume, createCaptureSession, setSessionId, setError, setVideoDevices, setAudioDevices, setPhotoStates, setFileStates]);
}

/**
 * Top-level state machine for the capture page: session lifecycle,
 * recording, photo capture, and the done/cancel flows. Composes the
 * device, upload, camera, and file-input sub-hooks.
 */

import { useState, useEffect, useRef, useCallback } from "react";
import { ChunkedRecorder, type ChunkCallbackParams } from "../../lib/audio/recorder";
import { loadDevicePrefs } from "./capture-api";
import { useCaptureApi } from "./capture-api-context";
import { useCaptureDevices } from "./useCaptureDevices";
import { useCaptureUploads } from "./useCaptureUploads";
import { useCaptureInputs } from "./useCaptureInputs";
import { useCaptureCamera } from "./useCaptureCamera";

/**
 * @param targetSessionId - the chat session capture was started from, recorded
 *   on the staging session so delivery lands in that chat. `null` for a fresh
 *   or unresolved chat (delivery falls back to most-active / a new session).
 * @param onExit - called after Done (finalize) or Cancel to close the capture
 *   surface and return to the composer. In capture-mode-in-chat there is no
 *   "loop into a fresh session" as the standalone page had — one capture, then
 *   back to chat.
 */
export function useCaptureSession(opts: { targetSessionId: string | null; onExit: () => void }) {
  const { targetSessionId, onExit } = opts;
  const { createCaptureSession, finalizeCaptureSession, cancelCaptureSession } = useCaptureApi();
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
  const { awaitPending, clearPendingAndFailed } = uploads;

  const camera = useCaptureCamera({
    videoDeviceId: devicePrefs.videoDeviceId, videoDevices, isMobile, setError, refreshDevices,
  });
  const { videoRef, cameraOn, startCamera, triggerFlash } = camera;

  const recorderRef = useRef<ChunkedRecorder | null>(null);
  const timerRef = useRef<number | null>(null);
  const recordStartRef = useRef<number>(0);
  // Each recording start is a new segment (toggle-off → toggle-on = new segment).
  const segmentCountRef = useRef<number>(0);

  // Create a staging session on mount + enumerate devices. `targetSessionId`
  // is the chat capture was started from, recorded so delivery lands there.
  useEffect(() => {
    let cancelled = false;
    createCaptureSession(targetSessionId).then((result) => {
      if (!cancelled) setSessionId(result.sessionId);
    }).catch((err: Error) => {
      if (!cancelled) setError(`Session creation failed: ${err.message}`);
    });
    navigator.mediaDevices.enumerateDevices().then((d) => {
      if (cancelled) return;
      setVideoDevices(d.filter((dev) => dev.kind === "videoinput"));
      setAudioDevices(d.filter((dev) => dev.kind === "audioinput"));
    }).catch((_e: Error) => {
      // Permission not yet granted — devices populate after first use
    });
    return () => { cancelled = true; };
  }, [targetSessionId, createCaptureSession, setVideoDevices, setAudioDevices]);

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
      if (recorderRef.current) { recorderRef.current.stop(); recorderRef.current = null; }
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

  // Seal the staging session (fires background preparation → delivery) and exit
  // capture mode. A server-derived pending bubble takes over from here.
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
      camera.stopCamera();
      clearPendingAndFailed();
      onExit();
    } catch (err) { setError(`Finalize failed: ${err instanceof Error ? err.message : "unknown"}`); setFinalizing(false); }
  }, [sessionId, finalizing, recording, awaitPending, finalizeCaptureSession, camera, clearPendingAndFailed, onExit]);

  const handleCancel = useCallback(async () => {
    if (recording && recorderRef.current) { recorderRef.current.stop(); recorderRef.current = null; setRecording(false); }
    clearPendingAndFailed();
    camera.stopCamera();
    if (sessionId) {
      try {
        await cancelCaptureSession(sessionId);
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
      retryFailedUploads, handleDone, handleCancel,
    },
  };
}

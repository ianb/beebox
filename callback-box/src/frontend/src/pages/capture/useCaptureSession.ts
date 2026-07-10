/**
 * Top-level state machine for the capture page: session lifecycle,
 * recording, photo capture, and the done/cancel flows. Composes the
 * device, upload, camera, and file-input sub-hooks.
 */

import { useState, useEffect, useRef, useCallback } from "react";
import { ChunkedRecorder, type ChunkCallbackParams } from "../../lib/audio/recorder";
import {
  loadDevicePrefs,
  createCaptureSession,
  finalizeCaptureSession,
  cancelCaptureSession,
} from "./capture-api";
import { useCaptureDevices } from "./useCaptureDevices";
import { useCaptureUploads } from "./useCaptureUploads";
import { useCaptureInputs } from "./useCaptureInputs";
import { useCaptureCamera } from "./useCaptureCamera";

export function useCaptureSession() {
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
  const { awaitPending, clearPendingAndFailed, resetState } = uploads;

  const camera = useCaptureCamera({
    videoDeviceId: devicePrefs.videoDeviceId, videoDevices, isMobile, setError, refreshDevices,
  });
  const { videoRef, cameraOn, startCamera, triggerFlash } = camera;

  const recorderRef = useRef<ChunkedRecorder | null>(null);
  const timerRef = useRef<number | null>(null);
  const recordStartRef = useRef<number>(0);
  // Each recording start is a new segment (toggle-off → toggle-on = new segment).
  const segmentCountRef = useRef<number>(0);

  // Create session on mount + enumerate devices. The standalone /capture page
  // has no chat context, so targetSessionId is null (capture-mode-in-chat will
  // pass the active session, Track 4).
  useEffect(() => {
    let cancelled = false;
    createCaptureSession(null).then((result) => {
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
  }, [setVideoDevices, setAudioDevices]);

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

  const startFreshSession = useCallback(async () => {
    try {
      const result = await createCaptureSession(null);
      segmentCountRef.current = 0;
      setSessionId(result.sessionId);
    } catch (err) { setError(`New session failed: ${err instanceof Error ? err.message : "unknown"}`); }
  }, []);

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
      setSessionId(null); resetState(); setError(null); setFinalizing(false);
      clearPendingAndFailed();
      await startFreshSession();
    } catch (err) { setError(`Finalize failed: ${err instanceof Error ? err.message : "unknown"}`); setFinalizing(false); }
  }, [sessionId, finalizing, recording, awaitPending, resetState, clearPendingAndFailed, startFreshSession]);

  const handleCancel = useCallback(async () => {
    if (!sessionId) return;
    if (recording && recorderRef.current) { recorderRef.current.stop(); recorderRef.current = null; setRecording(false); }
    clearPendingAndFailed();
    camera.stopCamera();
    try {
      await cancelCaptureSession(sessionId);
    } catch (err) {
      console.error("Cancel failed:", err);
    }
    setSessionId(null); resetState(); setError(null); setRecordingTime(0);
    await startFreshSession();
  }, [sessionId, recording, camera, clearPendingAndFailed, resetState, startFreshSession]);

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

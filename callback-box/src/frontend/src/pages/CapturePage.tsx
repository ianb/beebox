/**
 * Capture page — audio recording + photo capture.
 *
 * Ported from the legacy capture view. Sessions accumulate files
 * and finalize into inbox cards. Device preferences stored in localStorage.
 *
 * The dark-themed UI (status bar / camera viewport / device settings /
 * error banner / controls) lives under components/capture/ where the
 * off-palette colors can stay without tripping the restrict-component-classes
 * ESLint rule. This page coordinates state, sessions, and uploads.
 */

import { useState, useEffect, useRef, useCallback } from "react";
import { ChunkedRecorder } from "../lib/recorder";
import { CameraCapture } from "../lib/camera";
import { getApiBase } from "../api";
import { sanitizeFilename } from "../../../lib/filename";
import { CaptureShell } from "../components/capture/CaptureShell";
import { StatusBar } from "../components/capture/StatusBar";
import { DeviceSettings } from "../components/capture/DeviceSettings";
import { CameraViewport } from "../components/capture/CameraViewport";
import { CaptureErrorBanner } from "../components/capture/CaptureErrorBanner";
import { CaptureControls } from "../components/capture/CaptureControls";

type UploadState = "uploading" | "uploaded" | "failed";

interface AudioChunkStatus {
  index: number;
  state: UploadState;
}

// --- Device preferences (localStorage) ---

const STORAGE_KEY = "capture-device-prefs";

interface DevicePrefs {
  videoDeviceId: string | null;
  audioDeviceId: string | null;
}

function loadDevicePrefs(): DevicePrefs {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch (_e) {
    // corrupt data
  }
  return { videoDeviceId: null, audioDeviceId: null };
}

function saveDevicePrefs(prefs: DevicePrefs): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
}

// --- Capture API helpers ---

async function createCaptureSession(): Promise<{ sessionId: string; startedAt: string }> {
  const res = await fetch(`${getApiBase()}/capture/sessions`, { method: "POST" });
  if (!res.ok) throw new Error(`Create session failed: ${res.status}`);
  return res.json();
}

interface UploadFileOptions {
  sessionId: string;
  filename: string;
  blob: Blob;
  startedAt: string;
  source: string;
  originalName?: string;
  mimeType?: string;
}

const MAX_UPLOAD_RETRIES = 3;
const RETRY_BASE_DELAY_MS = 1000;

async function uploadCaptureFile(options: UploadFileOptions): Promise<void> {
  const { sessionId, filename, blob, startedAt, source, originalName, mimeType } = options;

  for (let attempt = 0; attempt <= MAX_UPLOAD_RETRIES; attempt++) {
    if (attempt > 0) {
      const delay = RETRY_BASE_DELAY_MS * Math.pow(2, attempt - 1);
      console.warn(`[capture] Retrying upload ${filename} (attempt ${attempt + 1}/${MAX_UPLOAD_RETRIES + 1}) after ${delay}ms`);
      await new Promise((r) => setTimeout(r, delay));
    }

    const formData = new FormData();
    formData.append("file", blob, filename);

    const headers: Record<string, string> = {
      "X-Capture-Filename": filename,
      "X-Capture-Started-At": startedAt,
      "X-Capture-Source": source,
    };
    if (originalName) headers["X-Capture-Original-Name"] = originalName;
    if (mimeType) headers["X-Capture-Mime-Type"] = mimeType;

    let res: Response;
    try {
      res = await fetch(`${getApiBase()}/capture/sessions/${sessionId}/upload`, {
        method: "POST",
        headers,
        body: formData,
      });
    } catch (networkErr) {
      // Network error (offline, DNS failure, etc.) — retry
      if (attempt < MAX_UPLOAD_RETRIES) continue;
      const msg = networkErr instanceof Error ? networkErr.message : String(networkErr);
      throw new Error(`Upload failed (network error after ${MAX_UPLOAD_RETRIES + 1} attempts): ${msg}`);
    }

    if (res.ok) return;

    // 4xx errors (except 408/429) are not retryable
    if (res.status >= 400 && res.status < 500 && res.status !== 408 && res.status !== 429) {
      let detail = "";
      try { detail = await res.text(); } catch (_e) { /* ignore */ }
      throw new Error(`Upload failed (${res.status}): ${detail || res.statusText}`);
    }

    // 5xx or 408/429 — retry
    if (attempt < MAX_UPLOAD_RETRIES) continue;

    let detail = "";
    try { detail = await res.text(); } catch (_e) { /* ignore */ }
    throw new Error(`Upload failed (${res.status} after ${MAX_UPLOAD_RETRIES + 1} attempts): ${detail || res.statusText}`);
  }
}

async function finalizeCaptureSession(sessionId: string): Promise<void> {
  const res = await fetch(`${getApiBase()}/capture/sessions/${sessionId}/finalize`, {
    method: "POST",
  });
  if (!res.ok) throw new Error(`Finalize failed: ${res.status}`);
}

async function cancelCaptureSession(sessionId: string): Promise<void> {
  const res = await fetch(`${getApiBase()}/capture/sessions/${sessionId}`, {
    method: "DELETE",
  });
  if (!res.ok) throw new Error(`Cancel failed: ${res.status}`);
}

// --- Component ---

export function CapturePage() {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [recording, setRecording] = useState(false);
  const [cameraOn, setCameraOn] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const [photoStates, setPhotoStates] = useState<UploadState[]>([]);
  const [fileStates, setFileStates] = useState<UploadState[]>([]);
  const [audioChunks, setAudioChunks] = useState<AudioChunkStatus[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [finalizing, setFinalizing] = useState(false);
  const [flashing, setFlashing] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [videoDevices, setVideoDevices] = useState<MediaDeviceInfo[]>([]);
  const [audioDevices, setAudioDevices] = useState<MediaDeviceInfo[]>([]);
  const [devicePrefs, setDevicePrefs] = useState<DevicePrefs>(loadDevicePrefs);
  const isMobile = "ontouchstart" in window;

  const recorderRef = useRef<ChunkedRecorder | null>(null);
  const cameraRef = useRef(new CameraCapture());
  const videoRef = useRef<HTMLVideoElement>(null);
  const timerRef = useRef<number | null>(null);
  const recordStartRef = useRef<number>(0);
  const galleryRef = useRef<HTMLInputElement>(null);
  const uploadRef = useRef<HTMLInputElement>(null);
  const pendingUploads = useRef<Promise<void>[]>([]);

  // Create session on mount + enumerate devices
  useEffect(() => {
    let cancelled = false;
    createCaptureSession().then((result) => {
      if (!cancelled) setSessionId(result.sessionId);
    }).catch((err: Error) => {
      if (!cancelled) setError(`Session creation failed: ${err.message}`);
    });
    navigator.mediaDevices.enumerateDevices().then((devices) => {
      if (cancelled) return;
      setVideoDevices(devices.filter((d) => d.kind === "videoinput"));
      setAudioDevices(devices.filter((d) => d.kind === "audioinput"));
    }).catch((_e: Error) => {
      // Permission not yet granted — devices populate after first use
    });
    return () => { cancelled = true; };
  }, []);

  // Re-enumerate after permission granted (labels become available)
  const refreshDevices = useCallback(() => {
    navigator.mediaDevices.enumerateDevices().then((devices) => {
      setVideoDevices(devices.filter((d) => d.kind === "videoinput"));
      setAudioDevices(devices.filter((d) => d.kind === "audioinput"));
    }).catch((_e: Error) => { /* ignore */ });
  }, []);

  const updateDevicePref = useCallback((key: keyof DevicePrefs, value: string | null) => {
    setDevicePrefs((prev) => {
      const next = { ...prev, [key]: value };
      saveDevicePrefs(next);
      return next;
    });
  }, []);

  // Restart camera when video device pref changes
  useEffect(() => {
    if (!cameraOn || !videoRef.current) return;
    const camera = cameraRef.current;
    camera.stop();
    const prefs = devicePrefs;
    if (prefs.videoDeviceId) {
      camera.startWithDeviceId(videoRef.current, prefs.videoDeviceId).catch((err: Error) => {
        setError(`Camera switch failed: ${err.message}`);
        setCameraOn(false);
      });
    } else {
      camera.start(videoRef.current).catch((err: Error) => {
        setError(`Camera switch failed: ${err.message}`);
        setCameraOn(false);
      });
    }
  }, [devicePrefs.videoDeviceId]); // eslint-disable-line react-hooks/exhaustive-deps

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

  const shutterAudio = useRef(new Audio("/earcons/shutter.mp3"));

  const triggerFlash = useCallback(() => {
    setFlashing(true);
    setTimeout(() => setFlashing(false), 250);
    shutterAudio.current.currentTime = 0;
    shutterAudio.current.play().catch((_e: Error) => { /* autoplay blocked */ });
  }, []);

  interface UploadPhotoParams {
    sessionId: string;
    index: number;
    blob: Blob;
    startedAt: string;
    source: string;
  }

  // Track failed photo blobs so we can retry them
  const failedPhotoData = useRef<Map<number, { blob: Blob; startedAt: string; source: string }>>(new Map());

  const uploadPhoto = useCallback(
    ({ sessionId: sid, index, blob, startedAt, source }: UploadPhotoParams) => {
      const ext = blob.type.includes("png") ? "png" : "jpg";
      const filename = `photo-${String(index + 1).padStart(3, "0")}.${ext}`;
      setPhotoStates((prev) => { const next = [...prev]; next[index] = "uploading"; return next; });
      const p = uploadCaptureFile({ sessionId: sid, filename, blob, startedAt, source })
        .then(() => {
          failedPhotoData.current.delete(index);
          setPhotoStates((prev) => { const next = [...prev]; next[index] = "uploaded"; return next; });
        })
        .catch((e: unknown) => {
          const msg = e instanceof Error ? e.message : String(e);
          console.error(`[capture] Photo upload failed (${filename}): ${msg}`);
          failedPhotoData.current.set(index, { blob, startedAt, source });
          setPhotoStates((prev) => { const next = [...prev]; next[index] = "failed"; return next; });
        });
      pendingUploads.current.push(p);
    },
    []
  );

  const retryFailedUploads = useCallback(() => {
    if (!sessionId) return;
    const entries = Array.from(failedPhotoData.current.entries());
    for (const [index, data] of entries) {
      failedPhotoData.current.delete(index);
      uploadPhoto({ sessionId, index, blob: data.blob, startedAt: data.startedAt, source: data.source });
    }
  }, [sessionId, uploadPhoto]);

  const handleChunk = useCallback(
    ({ blob, index, startedAt }: { blob: Blob; index: number; startedAt: string }) => {
      if (!sessionId) return;
      const filename = `audio-${String(index + 1).padStart(3, "0")}.webm`;
      setAudioChunks((prev) => [...prev, { index, state: "uploading" }]);
      const p = uploadCaptureFile({ sessionId, filename, blob, startedAt, source: "microphone" })
        .then(() => {
          setAudioChunks((prev) => prev.map((c) => (c.index === index ? { ...c, state: "uploaded" } : c)));
        })
        .catch((e: Error) => {
          console.error(`[capture] Audio upload failed (${filename}):`, e);
          setAudioChunks((prev) => prev.map((c) => (c.index === index ? { ...c, state: "failed" } : c)));
        });
      pendingUploads.current.push(p);
    },
    [sessionId]
  );

  const toggleRecording = useCallback(async () => {
    if (recording) {
      if (recorderRef.current) { recorderRef.current.stop(); recorderRef.current = null; }
      setRecording(false);
      setRecordingTime(0);
    } else {
      try {
        const prefs = loadDevicePrefs();
        const recorder = new ChunkedRecorder({
          onChunk: handleChunk,
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
  }, [recording, handleChunk, refreshDevices]);

  const startCamera = useCallback(async () => {
    try {
      if (videoRef.current) {
        const prefs = loadDevicePrefs();
        if (prefs.videoDeviceId) {
          await cameraRef.current.startWithDeviceId(videoRef.current, prefs.videoDeviceId);
        } else {
          await cameraRef.current.start(videoRef.current);
        }
        setCameraOn(true);
        refreshDevices();
      }
    } catch (err) {
      setError(`Camera access failed: ${err instanceof Error ? err.message : "unknown"}`);
    }
  }, [refreshDevices]);

  const toggleCamera = useCallback(async () => {
    if (cameraOn) { cameraRef.current.stop(); setCameraOn(false); }
    else { await startCamera(); }
  }, [cameraOn, startCamera]);

  const flipCamera = useCallback(async () => {
    if (!cameraOn) return;
    if (!isMobile && videoDevices.length > 1) { await cameraRef.current.cycleDevice(videoDevices); }
    else { await cameraRef.current.flip(); }
  }, [cameraOn, isMobile, videoDevices]);

  const takePhoto = useCallback(async () => {
    if (!sessionId) return;
    if (!cameraOn) { await startCamera(); return; }
    triggerFlash();
    const { blob: blobPromise, source } = cameraRef.current.takePhoto();
    const blob = await blobPromise;
    if (!blob) return;
    const index = photoStates.length;
    const startedAt = new Date().toISOString();
    setPhotoStates((prev) => [...prev, "uploading"]);
    uploadPhoto({ sessionId, index, blob, startedAt, source });
  }, [sessionId, cameraOn, photoStates.length, startCamera, triggerFlash, uploadPhoto]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement) return;
      if (e.key === " ") { e.preventDefault(); takePhoto(); }
      else if (e.key === "r" || e.key === "R") { e.preventDefault(); toggleRecording(); }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [takePhoto, toggleRecording]);

  const pickFromGallery = useCallback(() => { if (galleryRef.current) galleryRef.current.click(); }, []);

  const handleGallerySelect = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      if (!sessionId || !e.target.files) return;
      const files = Array.from(e.target.files);
      const baseIndex = photoStates.length;
      const placeholders: UploadState[] = Array.from({ length: files.length }, (): UploadState => "uploading");
      setPhotoStates((prev) => [...prev, ...placeholders]);
      for (const [i, file] of files.entries()) {
        const startedAt = new Date().toISOString();
        uploadPhoto({ sessionId, index: baseIndex + i, blob: file, startedAt, source: "gallery" });
      }
      e.target.value = "";
    },
    [sessionId, photoStates.length, uploadPhoto]
  );

  const pickFileToUpload = useCallback(() => { if (uploadRef.current) uploadRef.current.click(); }, []);

  const uploadFile = useCallback(
    ({ sessionId: sid, index, file }: { sessionId: string; index: number; file: File }) => {
      const safeName = sanitizeFilename(file.name, { fallback: "upload" });
      const filename = `file-${String(index + 1).padStart(3, "0")}-${safeName}`;
      const startedAt = new Date().toISOString();
      setFileStates((prev) => { const next = [...prev]; next[index] = "uploading"; return next; });
      const p = uploadCaptureFile({
        sessionId: sid,
        filename,
        blob: file,
        startedAt,
        source: "disk",
        originalName: file.name,
        mimeType: file.type || undefined,
      })
        .then(() => {
          setFileStates((prev) => { const next = [...prev]; next[index] = "uploaded"; return next; });
        })
        .catch((e: unknown) => {
          const msg = e instanceof Error ? e.message : String(e);
          console.error(`[capture] File upload failed (${filename}): ${msg}`);
          setFileStates((prev) => { const next = [...prev]; next[index] = "failed"; return next; });
        });
      pendingUploads.current.push(p);
    },
    []
  );

  const handleFileSelect = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      if (!sessionId || !e.target.files) return;
      const files = Array.from(e.target.files);
      const baseIndex = fileStates.length;
      const placeholders: UploadState[] = Array.from({ length: files.length }, (): UploadState => "uploading");
      setFileStates((prev) => [...prev, ...placeholders]);
      for (const [i, file] of files.entries()) {
        uploadFile({ sessionId, index: baseIndex + i, file });
      }
      e.target.value = "";
    },
    [sessionId, fileStates.length, uploadFile]
  );

  const photosUploaded = photoStates.filter((s) => s === "uploaded").length;
  const photosUploading = photoStates.filter((s) => s === "uploading").length;
  const photosFailed = photoStates.filter((s) => s === "failed").length;
  const photoTotal = photoStates.length;
  const audioUploaded = audioChunks.filter((c) => c.state === "uploaded").length;
  const audioUploading = audioChunks.filter((c) => c.state === "uploading").length;
  const audioTotal = audioChunks.length;
  const filesUploaded = fileStates.filter((s) => s === "uploaded").length;
  const filesUploading = fileStates.filter((s) => s === "uploading").length;
  const filesFailed = fileStates.filter((s) => s === "failed").length;
  const fileTotal = fileStates.length;
  const uploadsInProgress = photosUploading > 0 || audioUploading > 0 || filesUploading > 0;

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
      // Wait for all in-flight uploads (audio chunks + photos) to complete
      await Promise.all(pendingUploads.current);
      pendingUploads.current = [];
      await finalizeCaptureSession(sessionId);
      setSessionId(null); setPhotoStates([]); setFileStates([]); setAudioChunks([]); setError(null); setFinalizing(false);
      failedPhotoData.current.clear();
      try {
        const result = await createCaptureSession();
        setSessionId(result.sessionId);
      } catch (err) { setError(`New session failed: ${err instanceof Error ? err.message : "unknown"}`); }
    } catch (err) { setError(`Finalize failed: ${err instanceof Error ? err.message : "unknown"}`); setFinalizing(false); }
  }, [sessionId, finalizing, recording]);

  const handleCancel = useCallback(async () => {
    if (!sessionId) return;
    if (recording && recorderRef.current) { recorderRef.current.stop(); recorderRef.current = null; setRecording(false); }
    pendingUploads.current = [];
    if (cameraOn) { cameraRef.current.stop(); setCameraOn(false); }
    try {
      await cancelCaptureSession(sessionId);
    } catch (err) {
      console.error("Cancel failed:", err);
    }
    setSessionId(null); setPhotoStates([]); setFileStates([]); setAudioChunks([]); setError(null); setRecordingTime(0);
    try {
      const result = await createCaptureSession();
      setSessionId(result.sessionId);
    } catch (err) { setError(`New session failed: ${err instanceof Error ? err.message : "unknown"}`); }
  }, [sessionId, recording, cameraOn]);

  const formatTime = (seconds: number) => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;

  return (
    <CaptureShell>
      <StatusBar
        recording={recording} recordingTime={recordingTime} formatTime={formatTime}
        audioTotal={audioTotal} audioUploading={audioUploading} audioUploaded={audioUploaded}
        photoTotal={photoTotal} photosUploading={photosUploading} photosUploaded={photosUploaded} photosFailed={photosFailed}
        fileTotal={fileTotal} filesUploading={filesUploading} filesUploaded={filesUploaded} filesFailed={filesFailed}
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
        onTap={cameraOn ? takePhoto : startCamera}
        onToggleCamera={toggleCamera}
        onFlipCamera={flipCamera}
      />

      {error ? <CaptureErrorBanner message={error} onDismiss={() => setError(null)} /> : null}

      <input ref={galleryRef} type="file" accept="image/*" multiple hidden onChange={handleGallerySelect} />
      <input ref={uploadRef} type="file" multiple hidden onChange={handleFileSelect} />

      <CaptureControls
        sessionId={sessionId} recording={recording} uploadsInProgress={uploadsInProgress} finalizing={finalizing}
        hasContent={photoTotal > 0 || audioTotal > 0 || fileTotal > 0} photosFailed={photosFailed}
        onDone={handleDone} onCancel={handleCancel} onToggleRecording={toggleRecording} onRetryFailed={retryFailedUploads}
      />
    </CaptureShell>
  );
}


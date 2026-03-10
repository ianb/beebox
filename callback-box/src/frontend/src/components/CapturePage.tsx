/**
 * Capture page — audio recording + photo capture.
 *
 * Ported from the legacy capture view. Sessions accumulate files
 * and finalize into inbox cards. Device preferences stored in localStorage.
 */

import { useState, useEffect, useRef, useCallback } from "react";
import { ChunkedRecorder } from "../lib/recorder";
import { CameraCapture } from "../lib/camera";
import { getApiBase } from "../api";

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
}

async function uploadCaptureFile(options: UploadFileOptions): Promise<void> {
  const { sessionId, filename, blob, startedAt, source } = options;
  const formData = new FormData();
  formData.append("file", blob, filename);

  const res = await fetch(`${getApiBase()}/capture/sessions/${sessionId}/upload`, {
    method: "POST",
    headers: {
      "X-Capture-Filename": filename,
      "X-Capture-Started-At": startedAt,
      "X-Capture-Source": source,
    },
    body: formData,
  });
  if (!res.ok) throw new Error(`Upload failed: ${res.status}`);
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

  const uploadPhoto = useCallback(
    ({ sessionId: sid, index, blob, startedAt, source }: UploadPhotoParams) => {
      const ext = blob.type.includes("png") ? "png" : "jpg";
      const filename = `photo-${String(index + 1).padStart(3, "0")}.${ext}`;
      setPhotoStates((prev) => { const next = [...prev]; next[index] = "uploading"; return next; });
      const p = uploadCaptureFile({ sessionId: sid, filename, blob, startedAt, source })
        .then(() => {
          setPhotoStates((prev) => { const next = [...prev]; next[index] = "uploaded"; return next; });
        })
        .catch((_e) => {
          setPhotoStates((prev) => { const next = [...prev]; next[index] = "failed"; return next; });
        });
      pendingUploads.current.push(p);
    },
    []
  );

  const handleChunk = useCallback(
    ({ blob, index, startedAt }: { blob: Blob; index: number; startedAt: string }) => {
      if (!sessionId) return;
      const filename = `audio-${String(index + 1).padStart(3, "0")}.webm`;
      setAudioChunks((prev) => [...prev, { index, state: "uploading" }]);
      const p = uploadCaptureFile({ sessionId, filename, blob, startedAt, source: "microphone" })
        .then(() => {
          setAudioChunks((prev) => prev.map((c) => (c.index === index ? { ...c, state: "uploaded" } : c)));
        })
        .catch((_e: Error) => {
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
      for (const file of Array.from(e.target.files)) {
        const index = photoStates.length;
        const startedAt = new Date().toISOString();
        setPhotoStates((prev) => [...prev, "uploading"]);
        uploadPhoto({ sessionId, index, blob: file, startedAt, source: "gallery" });
      }
      e.target.value = "";
    },
    [sessionId, photoStates.length, uploadPhoto]
  );

  const photosUploaded = photoStates.filter((s) => s === "uploaded").length;
  const photosUploading = photoStates.filter((s) => s === "uploading").length;
  const photoTotal = photoStates.length;
  const audioUploaded = audioChunks.filter((c) => c.state === "uploaded").length;
  const audioUploading = audioChunks.filter((c) => c.state === "uploading").length;
  const audioTotal = audioChunks.length;
  const uploadsInProgress = photosUploading > 0 || audioUploading > 0;

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
      setSessionId(null); setPhotoStates([]); setAudioChunks([]); setError(null); setFinalizing(false);
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
    setSessionId(null); setPhotoStates([]); setAudioChunks([]); setError(null); setRecordingTime(0);
    try {
      const result = await createCaptureSession();
      setSessionId(result.sessionId);
    } catch (err) { setError(`New session failed: ${err instanceof Error ? err.message : "unknown"}`); }
  }, [sessionId, recording, cameraOn]);

  const formatTime = (seconds: number) => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;

  return (
    <div className="flex flex-col h-full bg-black relative text-white">
      <StatusBar
        recording={recording} recordingTime={recordingTime} formatTime={formatTime}
        audioTotal={audioTotal} audioUploading={audioUploading} audioUploaded={audioUploaded}
        photoTotal={photoTotal} photosUploading={photosUploading} photosUploaded={photosUploaded}
        showSettings={showSettings}
        onToggleSettings={() => setShowSettings((p) => !p)}
        onPickGallery={pickFromGallery}
      />

      {showSettings ? (
        <DeviceSettings
          videoDevices={videoDevices} audioDevices={audioDevices}
          devicePrefs={devicePrefs} onUpdate={updateDevicePref}
        />
      ) : null}

      <div
        className="flex-1 min-h-0 relative flex items-center justify-center overflow-hidden cursor-pointer"
        onClick={cameraOn ? takePhoto : startCamera}
      >
        <video
          ref={videoRef}
          className={`w-full h-full object-contain ${cameraOn ? "" : "hidden"}`}
          style={flashing ? { filter: "brightness(3) saturate(0)" } : undefined}
          playsInline muted
        />
        {cameraOn ? (
          <>
            <div className="absolute bottom-6 left-0 right-0 flex justify-center pointer-events-none z-10">
              <div className="w-16 h-16 rounded-full border-4 border-white/40" />
            </div>
            <button
              onClick={(e) => { e.stopPropagation(); toggleCamera(); }}
              className="absolute top-3 right-3 w-10 h-10 rounded-full flex items-center justify-center text-white/50 hover:text-white/80 z-10"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                <line x1="3" y1="3" x2="21" y2="21" strokeLinecap="round" />
              </svg>
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); flipCamera(); }}
              className="absolute bottom-3 right-3 w-10 h-10 rounded-full flex items-center justify-center text-white/50 hover:text-white/80 z-10"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
            </button>
          </>
        ) : (
          <div className="text-gray-600 text-center">
            <svg xmlns="http://www.w3.org/2000/svg" className="w-16 h-16 mx-auto mb-2 text-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
            </svg>
            <p className="text-sm">Tap to start camera</p>
          </div>
        )}
      </div>

      {error ? (
        <div className="absolute top-14 left-4 right-4 bg-red-900/80 text-red-200 text-sm px-3 py-2 rounded-lg z-20">
          {error}
          <button onClick={() => setError(null)} className="float-right text-red-300 hover:text-white">&times;</button>
        </div>
      ) : null}

      <input ref={galleryRef} type="file" accept="image/*" multiple className="hidden" onChange={handleGallerySelect} />

      <CaptureControls
        sessionId={sessionId} recording={recording} uploadsInProgress={uploadsInProgress} finalizing={finalizing}
        hasContent={photoTotal > 0 || audioTotal > 0}
        onDone={handleDone} onCancel={handleCancel} onToggleRecording={toggleRecording}
      />
    </div>
  );
}

// --- Extracted sub-components to keep CapturePage under limit ---

function StatusBar(props: {
  recording: boolean; recordingTime: number; formatTime: (s: number) => string;
  audioTotal: number; audioUploading: number; audioUploaded: number;
  photoTotal: number; photosUploading: number; photosUploaded: number;
  showSettings: boolean;
  onToggleSettings: () => void; onPickGallery: () => void;
}) {
  return (
    <div className="flex items-center justify-between px-4 py-2 bg-gray-900/80 z-10">
      <div className="flex items-center gap-3">
        {props.recording ? (
          <div className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 bg-red-500 rounded-full animate-pulse" />
            <span className="text-sm font-mono">{props.formatTime(props.recordingTime)}</span>
          </div>
        ) : null}
        {!props.recording && props.audioTotal > 0 ? (
          <div className="flex items-center gap-1.5 text-sm">
            {props.audioUploading > 0 ? (
              <><span className="w-2 h-2 bg-yellow-400 rounded-full animate-pulse" /><span className="text-yellow-400">audio uploading</span></>
            ) : (
              <><span className="text-green-400">&#10003;</span><span className="text-green-400">audio ({props.audioUploaded})</span></>
            )}
          </div>
        ) : null}
      </div>
      <div className="flex items-center gap-3 text-sm">
        {props.photoTotal > 0 ? (
          <div className="flex items-center gap-1.5">
            {props.photosUploading > 0 ? (
              <><span className="w-2 h-2 bg-yellow-400 rounded-full animate-pulse" /><span className="text-yellow-400">{props.photosUploaded}/{props.photoTotal}</span></>
            ) : (
              <><span className="text-green-400">&#10003;</span><span className="text-green-400">{props.photoTotal} photos</span></>
            )}
          </div>
        ) : null}
        <button onClick={props.onPickGallery} className="text-gray-400 hover:text-white p-1" title="Add from gallery">&#128247;</button>
        <button
          onClick={props.onToggleSettings}
          className={`p-1 text-lg ${props.showSettings ? "text-white" : "text-gray-400 hover:text-white"}`}
          title="Device settings"
        >&#9881;</button>
      </div>
    </div>
  );
}

function DeviceSettings(props: {
  videoDevices: MediaDeviceInfo[]; audioDevices: MediaDeviceInfo[];
  devicePrefs: DevicePrefs; onUpdate: (key: keyof DevicePrefs, value: string | null) => void;
}) {
  return (
    <div className="px-4 py-3 bg-gray-900/90 border-t border-gray-700 z-10 flex gap-4 text-sm">
      <label className="flex flex-col gap-1 flex-1">
        <span className="text-gray-400">Camera</span>
        <select
          value={props.devicePrefs.videoDeviceId ?? ""}
          onChange={(e) => props.onUpdate("videoDeviceId", e.target.value || null)}
          className="bg-gray-800 text-white border border-gray-600 rounded px-2 py-1 text-sm"
        >
          <option value="">Default</option>
          {props.videoDevices.map((d) => (
            <option key={d.deviceId} value={d.deviceId}>{d.label || `Camera ${d.deviceId.slice(0, 8)}`}</option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1 flex-1">
        <span className="text-gray-400">Microphone</span>
        <select
          value={props.devicePrefs.audioDeviceId ?? ""}
          onChange={(e) => props.onUpdate("audioDeviceId", e.target.value || null)}
          className="bg-gray-800 text-white border border-gray-600 rounded px-2 py-1 text-sm"
        >
          <option value="">Default</option>
          {props.audioDevices.map((d) => (
            <option key={d.deviceId} value={d.deviceId}>{d.label || `Mic ${d.deviceId.slice(0, 8)}`}</option>
          ))}
        </select>
      </label>
    </div>
  );
}

function CaptureControls(props: {
  sessionId: string | null; recording: boolean;
  uploadsInProgress: boolean; finalizing: boolean; hasContent: boolean;
  onDone: () => void; onCancel: () => void; onToggleRecording: () => void;
}) {
  return (
    <div className="flex items-center justify-around px-6 py-4 bg-gray-900/80">
      <button onClick={props.onCancel} disabled={!props.sessionId || props.finalizing || !props.hasContent}
        className="w-12 h-12 rounded-full bg-gray-700 flex items-center justify-center disabled:opacity-30 active:bg-gray-600">
        <svg xmlns="http://www.w3.org/2000/svg" className="w-6 h-6 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
        </svg>
      </button>
      <button onClick={props.onToggleRecording} disabled={!props.sessionId}
        className={`w-16 h-16 rounded-full border-4 border-white flex items-center justify-center disabled:opacity-30 ${props.recording ? "bg-red-600" : ""}`}>
        {props.recording ? <span className="w-7 h-7 bg-white rounded-sm" /> : (
          <svg xmlns="http://www.w3.org/2000/svg" className="w-8 h-8 text-red-500" fill="currentColor" viewBox="0 0 24 24">
            <path d="M12 14a3 3 0 003-3V5a3 3 0 10-6 0v6a3 3 0 003 3z" /><path d="M17 11a5 5 0 01-10 0H5a7 7 0 0014 0h-2z" />
            <rect x="11" y="19" width="2" height="3" rx="1" /><rect x="8" y="21" width="8" height="2" rx="1" />
          </svg>
        )}
      </button>
      <button onClick={props.onDone} disabled={!props.sessionId || props.uploadsInProgress || props.finalizing || !props.hasContent}
        className="w-12 h-12 rounded-full bg-green-600 flex items-center justify-center disabled:opacity-30 active:bg-green-500">
        {props.finalizing ? (
          <span className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
        ) : (
          <svg xmlns="http://www.w3.org/2000/svg" className="w-6 h-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}><path d="M5 13l4 4L19 7" /></svg>
        )}
      </button>
    </div>
  );
}

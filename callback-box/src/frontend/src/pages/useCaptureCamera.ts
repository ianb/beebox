/**
 * Camera concern for the capture page: owns the CameraCapture instance and
 * the <video> ref, exposes start/toggle/flip/stop, and restarts the stream
 * when the preferred video device changes.
 */

import { useState, useRef, useEffect, useCallback } from "react";
import { CameraCapture } from "../lib/camera";
import { withBase } from "../api";
import { loadDevicePrefs } from "./capture-api";

interface CaptureCameraOptions {
  videoDeviceId: string | null;
  videoDevices: MediaDeviceInfo[];
  isMobile: boolean;
  setError: (message: string) => void;
  refreshDevices: () => void;
}

interface CaptureCamera {
  videoRef: React.RefObject<HTMLVideoElement>;
  cameraOn: boolean;
  flashing: boolean;
  startCamera: () => Promise<void>;
  toggleCamera: () => Promise<void>;
  flipCamera: () => Promise<void>;
  takePhoto: () => { blob: Promise<Blob | null>; source: string };
  triggerFlash: () => void;
  stopCamera: () => void;
}

export function useCaptureCamera(options: CaptureCameraOptions): CaptureCamera {
  const { videoDeviceId, videoDevices, isMobile, setError, refreshDevices } = options;
  const [cameraOn, setCameraOn] = useState(false);
  const [flashing, setFlashing] = useState(false);
  const cameraRef = useRef(new CameraCapture());
  const videoRef = useRef<HTMLVideoElement>(null);
  const shutterAudio = useRef(new Audio(withBase("/earcons/shutter.mp3")));

  // Restart camera when video device pref changes
  useEffect(() => {
    if (!cameraOn || !videoRef.current) return;
    const camera = cameraRef.current;
    camera.stop();
    if (videoDeviceId) {
      camera.startWithDeviceId(videoRef.current, videoDeviceId).catch((err: Error) => {
        setError(`Camera switch failed: ${err.message}`);
        setCameraOn(false);
      });
    } else {
      camera.start(videoRef.current).catch((err: Error) => {
        setError(`Camera switch failed: ${err.message}`);
        setCameraOn(false);
      });
    }
  }, [videoDeviceId]); // eslint-disable-line react-hooks/exhaustive-deps

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
  }, [refreshDevices, setError]);

  const toggleCamera = useCallback(async () => {
    if (cameraOn) { cameraRef.current.stop(); setCameraOn(false); }
    else { await startCamera(); }
  }, [cameraOn, startCamera]);

  const flipCamera = useCallback(async () => {
    if (!cameraOn) return;
    if (!isMobile && videoDevices.length > 1) { await cameraRef.current.cycleDevice(videoDevices); }
    else { await cameraRef.current.flip(); }
  }, [cameraOn, isMobile, videoDevices]);

  const takePhoto = useCallback(() => cameraRef.current.takePhoto(), []);

  const triggerFlash = useCallback(() => {
    setFlashing(true);
    setTimeout(() => setFlashing(false), 250);
    shutterAudio.current.currentTime = 0;
    shutterAudio.current.play().catch((_e: Error) => { /* autoplay blocked */ });
  }, []);

  const stopCamera = useCallback(() => {
    if (cameraOn) { cameraRef.current.stop(); setCameraOn(false); }
  }, [cameraOn]);

  return { videoRef, cameraOn, flashing, startCamera, toggleCamera, flipCamera, takePhoto, triggerFlash, stopCamera };
}

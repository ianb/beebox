/**
 * Device enumeration + persisted device preferences for the capture page.
 *
 * Split out of CapturePage.tsx. Owns the media-device lists, the
 * localStorage-backed prefs, and the helpers to refresh/update them.
 */

import { useState, useCallback } from "react";
import { type DevicePrefs, loadDevicePrefs, saveDevicePrefs } from "./capture-api";

interface CaptureDevices {
  videoDevices: MediaDeviceInfo[];
  audioDevices: MediaDeviceInfo[];
  setVideoDevices: (devices: MediaDeviceInfo[]) => void;
  setAudioDevices: (devices: MediaDeviceInfo[]) => void;
  devicePrefs: DevicePrefs;
  refreshDevices: () => void;
  updateDevicePref: (key: keyof DevicePrefs, value: string | null) => void;
}

export function useCaptureDevices(): CaptureDevices {
  const [videoDevices, setVideoDevices] = useState<MediaDeviceInfo[]>([]);
  const [audioDevices, setAudioDevices] = useState<MediaDeviceInfo[]>([]);
  const [devicePrefs, setDevicePrefs] = useState<DevicePrefs>(loadDevicePrefs);

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

  return {
    videoDevices, audioDevices, setVideoDevices, setAudioDevices,
    devicePrefs, refreshDevices, updateDevicePref,
  };
}

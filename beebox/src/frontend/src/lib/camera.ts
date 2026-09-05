import { encodeCanvasBlob } from "./canvas-encode";
import { invariant } from "@shared/invariant";

export type FacingMode = "user" | "environment";

// Request the highest resolution the camera supports.
// The browser picks the closest match to `ideal`.
const HIGH_RES = { width: { ideal: 4096 }, height: { ideal: 3072 } };

export class CameraCapture {
  private stream: MediaStream | null = null;
  private videoEl: HTMLVideoElement | null = null;
  facingMode: FacingMode = "environment";
  private currentDeviceId: string | null = null;

  static async getVideoDevices(): Promise<MediaDeviceInfo[]> {
    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices.filter((d) => d.kind === "videoinput");
  }

  async start(videoEl: HTMLVideoElement, facing?: FacingMode): Promise<void> {
    if (facing) this.facingMode = facing;
    this.videoEl = videoEl;

    this.stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: this.facingMode, ...HIGH_RES },
      audio: false,
    });

    // getVideoTracks() can return an empty array in rare hardware cases; the
    // frontend tsconfig lacks noUncheckedIndexedAccess, so `[0]` alone would
    // type `track` as always-defined. `.at()` is typed `T | undefined`
    // regardless, keeping this check honest.
    const track = this.stream.getVideoTracks().at(0);
    this.currentDeviceId = track ? track.getSettings().deviceId ?? null : null;
    videoEl.srcObject = this.stream;
    await videoEl.play();
  }

  async startWithDeviceId(videoEl: HTMLVideoElement, deviceId: string): Promise<void> {
    this.videoEl = videoEl;
    this.currentDeviceId = deviceId;

    this.stream = await navigator.mediaDevices.getUserMedia({
      video: { deviceId: { exact: deviceId }, ...HIGH_RES },
      audio: false,
    });

    videoEl.srcObject = this.stream;
    await videoEl.play();
  }

  async flip(): Promise<void> {
    this.facingMode = this.facingMode === "user" ? "environment" : "user";
    this.stopStream();
    if (this.videoEl) {
      await this.start(this.videoEl);
    }
  }

  async cycleDevice(devices: MediaDeviceInfo[]): Promise<void> {
    if (devices.length < 2 || !this.videoEl) return;
    const currentIdx = devices.findIndex((d) => d.deviceId === this.currentDeviceId);
    const nextIdx = (currentIdx + 1) % devices.length;
    // nextIdx is always in [0, devices.length) given the guard above and the
    // modulo above — a missing element here would mean the index math is
    // broken, not a genuine runtime absence. `.at()` (unlike `[nextIdx]`) is
    // typed `T | undefined` even without noUncheckedIndexedAccess, so the
    // invariant below stays meaningful to the type checker.
    const nextDevice = devices.at(nextIdx);
    invariant(nextDevice !== undefined, "cycleDevice: nextIdx out of range");
    this.stopStream();
    await this.startWithDeviceId(this.videoEl, nextDevice.deviceId);
  }

  takePhoto(): { blob: Promise<Blob | null>; source: string } {
    if (!this.videoEl) {
      return { blob: Promise.resolve(null), source: `camera-${this.facingMode}` };
    }

    // Prefer ImageCapture API when available — it takes a full-resolution
    // still photo from the camera sensor, which is typically much higher
    // than the video stream resolution. Supported on Chrome/Android.
    const track = this.stream ? this.stream.getVideoTracks()[0] : null;
    if (track && typeof ImageCapture !== "undefined") {
      const capture = new ImageCapture(track);
      const blobPromise = capture.takePhoto()
        .catch((_e) => {
          // Fall back to canvas capture on failure
          return this.canvasCapture();
        });
      return { blob: blobPromise, source: `camera-${this.facingMode}` };
    }

    return { blob: this.canvasCapture(), source: `camera-${this.facingMode}` };
  }

  private canvasCapture(): Promise<Blob | null> {
    if (!this.videoEl) return Promise.resolve(null);
    const canvas = document.createElement("canvas");
    canvas.width = this.videoEl.videoWidth;
    canvas.height = this.videoEl.videoHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return Promise.resolve(null);
    ctx.drawImage(this.videoEl, 0, 0);
    // WebP when the browser can encode it, else JPEG — a direct encode
    // of the captured frame (no extra re-encode generation).
    return encodeCanvasBlob(canvas, { quality: 0.85, fallback: "image/jpeg" });
  }

  stop(): void {
    this.stopStream();
    if (this.videoEl) {
      this.videoEl.srcObject = null;
      this.videoEl = null;
    }
  }

  private stopStream(): void {
    if (this.stream) {
      for (const t of this.stream.getTracks()) t.stop();
      this.stream = null;
    }
  }

  get active(): boolean {
    return this.stream !== null && this.stream.active;
  }
}

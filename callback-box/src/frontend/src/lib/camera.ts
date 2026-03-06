export type FacingMode = "user" | "environment";

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
      video: { facingMode: this.facingMode },
      audio: false,
    });

    const track = this.stream.getVideoTracks()[0];
    this.currentDeviceId = track ? track.getSettings().deviceId ?? null : null;
    videoEl.srcObject = this.stream;
    await videoEl.play();
  }

  async startWithDeviceId(videoEl: HTMLVideoElement, deviceId: string): Promise<void> {
    this.videoEl = videoEl;
    this.currentDeviceId = deviceId;

    this.stream = await navigator.mediaDevices.getUserMedia({
      video: { deviceId: { exact: deviceId } },
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
    const nextDevice = devices[nextIdx];
    if (!nextDevice) return;
    this.stopStream();
    await this.startWithDeviceId(this.videoEl, nextDevice.deviceId);
  }

  takePhoto(): { blob: Promise<Blob | null>; source: string } {
    if (!this.videoEl) {
      return { blob: Promise.resolve(null), source: `camera-${this.facingMode}` };
    }

    const canvas = document.createElement("canvas");
    canvas.width = this.videoEl.videoWidth;
    canvas.height = this.videoEl.videoHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      return { blob: Promise.resolve(null), source: `camera-${this.facingMode}` };
    }
    ctx.drawImage(this.videoEl, 0, 0);

    const blobPromise = new Promise<Blob | null>((resolve) => {
      canvas.toBlob((b) => resolve(b), "image/jpeg", 0.85);
    });

    return { blob: blobPromise, source: `camera-${this.facingMode}` };
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

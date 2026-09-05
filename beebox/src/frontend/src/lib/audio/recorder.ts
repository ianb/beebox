/** Default MediaRecorder timeslice. Capture mode overrides this (see below). */
const DEFAULT_CHUNK_INTERVAL_MS = 20_000; // 20 seconds

export interface ChunkCallbackParams {
  blob: Blob;
  index: number;
  startedAt: string;
}

export type ChunkCallback = (params: ChunkCallbackParams) => void;

export interface ChunkedRecorderOptions {
  onChunk: ChunkCallback;
  deviceId?: string | undefined;
  /**
   * MediaRecorder timeslice (ms between `dataavailable` events). Shorter =
   * smaller loss window on a crash (only the tail since the last chunk is lost),
   * at the cost of more uploads. Capture mode passes ~5s; defaults to 20s.
   */
  timesliceMs?: number | undefined;
}

export class ChunkedRecorder {
  private mediaRecorder: MediaRecorder | null = null;
  private stream: MediaStream | null = null;
  private chunkIndex = 0;
  private chunkStartedAt: string = "";
  private onChunk: ChunkCallback;
  private deviceId: string | undefined;
  private timesliceMs: number;
  private stopResolve: (() => void) | null = null;

  constructor(options: ChunkedRecorderOptions) {
    this.onChunk = options.onChunk;
    this.deviceId = options.deviceId;
    this.timesliceMs = options.timesliceMs ?? DEFAULT_CHUNK_INTERVAL_MS;
  }

  static async getAudioDevices(): Promise<MediaDeviceInfo[]> {
    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices.filter((d) => d.kind === "audioinput");
  }

  async start(): Promise<void> {
    const audioConstraints: MediaTrackConstraints = this.deviceId
      ? { deviceId: { exact: this.deviceId } }
      : {};
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: audioConstraints,
      video: false,
    });

    // Prefer webm/opus, fall back to whatever is available
    const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
      ? "audio/webm;codecs=opus"
      : "audio/webm";

    this.chunkIndex = 0;
    this.chunkStartedAt = new Date().toISOString();

    this.mediaRecorder = new MediaRecorder(this.stream, { mimeType });

    this.mediaRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) {
        this.onChunk({
          blob: e.data,
          index: this.chunkIndex,
          startedAt: this.chunkStartedAt,
        });
        this.chunkIndex++;
        this.chunkStartedAt = new Date().toISOString();
      }
      // Resolve the stop promise after the final dataavailable fires
      if (this.stopResolve) {
        this.stopResolve();
        this.stopResolve = null;
      }
    };

    this.mediaRecorder.start(this.timesliceMs);
  }

  /**
   * Stop recording and return a promise that resolves after the final
   * dataavailable event has fired (and onChunk has been called).
   */
  stopAsync(): Promise<void> {
    return new Promise((resolve) => {
      if (!this.mediaRecorder || this.mediaRecorder.state === "inactive") {
        this.cleanup();
        resolve();
        return;
      }
      this.stopResolve = resolve;
      this.mediaRecorder.stop();
      this.cleanup();
    });
  }

  stop(): void {
    if (this.mediaRecorder && this.mediaRecorder.state !== "inactive") {
      this.mediaRecorder.stop();
    }
    this.cleanup();
  }

  private cleanup(): void {
    if (this.stream) {
      for (const t of this.stream.getTracks()) t.stop();
      this.stream = null;
    }
    this.mediaRecorder = null;
  }

  get recording(): boolean {
    if (!this.mediaRecorder) return false;
    return this.mediaRecorder.state === "recording";
  }
}

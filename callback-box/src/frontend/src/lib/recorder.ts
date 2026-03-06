const CHUNK_INTERVAL_MS = 20_000; // 20 seconds

export interface ChunkCallbackParams {
  blob: Blob;
  index: number;
  startedAt: string;
}

export type ChunkCallback = (params: ChunkCallbackParams) => void;

export interface ChunkedRecorderOptions {
  onChunk: ChunkCallback;
  deviceId?: string | undefined;
}

export class ChunkedRecorder {
  private mediaRecorder: MediaRecorder | null = null;
  private stream: MediaStream | null = null;
  private chunkIndex = 0;
  private chunkStartedAt: string = "";
  private onChunk: ChunkCallback;
  private deviceId: string | undefined;

  constructor(options: ChunkedRecorderOptions) {
    this.onChunk = options.onChunk;
    this.deviceId = options.deviceId;
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
    };

    this.mediaRecorder.start(CHUNK_INTERVAL_MS);
  }

  stop(): void {
    if (this.mediaRecorder && this.mediaRecorder.state !== "inactive") {
      this.mediaRecorder.stop();
    }
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

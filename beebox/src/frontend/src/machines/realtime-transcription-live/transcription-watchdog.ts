/** Liveness polling for one segment: a capture pipeline gone silent, or a socket whose sends stopped draining. */

/** Poll interval for the liveness watchdog. */
const WATCHDOG_INTERVAL_MS = 500;
/**
 * How long `ws.bufferedAmount` may stay above 0 before we judge the socket
 * stalled. A healthy socket drains our ~300ms PCM frames near-instantly.
 */
const STALL_TIMEOUT_MS = 2500;
/**
 * How long the worklet may deliver no PCM frames before we judge the capture
 * pipeline dead (catch-all behind MicCapture's track `ended`/`mute` handlers).
 */
const MIC_SILENT_TIMEOUT_MS = 4000;

export class LivenessWatchdog {
  private id: ReturnType<typeof setInterval> | null = null;
  private lastPcmAt = 0;
  private lastDrainedAt = 0;

  constructor(private readonly opts: {
    idle: () => boolean;
    micPresent: () => boolean;
    onMicSilent: () => void;
    socket: () => WebSocket | undefined;
    onStalled: (bufferedAmount: number) => void;
  }) {}

  /** A PCM frame arrived, or the mic came back. */
  notePcm() {
    this.lastPcmAt = performance.now();
  }

  /** A socket was just adopted: its send buffer starts clean. */
  noteDrained() {
    this.lastDrainedAt = performance.now();
  }

  start() {
    this.stop();
    this.noteDrained();
    this.notePcm();
    this.id = setInterval(() => {
      if (this.opts.idle()) return;
      if (this.opts.micPresent() && performance.now() - this.lastPcmAt > MIC_SILENT_TIMEOUT_MS) {
        this.opts.onMicSilent();
        return;
      }
      const ws = this.opts.socket();
      if (!ws || ws.readyState !== WebSocket.OPEN) return; // onclose owns real closes
      if (ws.bufferedAmount === 0) {
        this.noteDrained();
      } else if (performance.now() - this.lastDrainedAt > STALL_TIMEOUT_MS) {
        this.opts.onStalled(ws.bufferedAmount);
      }
    }, WATCHDOG_INTERVAL_MS);
  }

  stop() {
    if (this.id !== null) {
      clearInterval(this.id);
      this.id = null;
    }
  }
}

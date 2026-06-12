/**
 * Mic capture pipeline for the realtime transcription actor: getUserMedia,
 * AudioContext + PCM worklet, and OS-interruption detection/recovery.
 *
 * The network-resilience machinery in transcription-actor.ts can't see the
 * *input* side die: when the OS takes the microphone away (phone call, Siri,
 * app switch, screen lock) the WebSocket stays open and drained, so the
 * socket watchdog never fires and the UI would say "recording" while
 * capturing nothing. This module watches the capture side:
 *
 *   - `ended` on the mic track — the OS revoked it outright.
 *   - prolonged `mute` — iOS mutes (rather than ends) the track during
 *     shorter interruptions and unmutes when they pass; only a mute that
 *     outlasts {@link MIC_MUTE_GRACE_MS} means a dead mic.
 *
 * On either, {@link MicCapture.beginRecovery} re-acquires the mic with
 * jittered backoff, swapping the fresh stream into the existing audio graph
 * (the worklet and AudioContext survive, so the socket never notices). The
 * caller surfaces the degraded/restored transitions and bounds the recovery
 * window; an aborted recovery ends the segment loudly with everything
 * captured so far preserved.
 */

import pcmProcessorUrl from "../audio/pcm-processor.worklet.js?url";
import { delay, jitteredBackoff } from "./transcription-backoff";
import { setMicLevelSource, clearMicLevelSource } from "../lib/mic-level";

/**
 * How long the mic track may sit muted before we treat it as taken away.
 * Long enough to ride out transient mutes, short enough that the user isn't
 * left dictating into a dead mic for long.
 */
const MIC_MUTE_GRACE_MS = 4000;
/** Full-jitter backoff bounds between failed mic re-acquisition attempts. */
const MIC_RETRY_BACKOFF = { baseMs: 400, capMs: 2000 } as const;

/** A mic re-acquisition attempt failed (mic still held by the OS, or muted). */
class MicReacquireError extends Error {
  constructor(detail: string) {
    super(detail);
    this.name = "MicReacquireError";
  }
}

interface MicCaptureCallbacks {
  /** A ~300ms PCM s16le frame from the worklet (ownership transferred). */
  onPcm: (samples: ArrayBuffer) => void;
  /** Mic interruption detected; a recovery loop is starting. */
  onMicLost: () => void;
  /** Recovery succeeded: a fresh stream is feeding the same audio graph. */
  onMicRestored: () => void;
}

export class MicCapture {
  private audioContext: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private sourceNode: MediaStreamAudioSourceNode | null = null;
  private workletNode: AudioWorkletNode | null = null;
  private analyser: AnalyserNode | null = null;
  private levelData: Uint8Array<ArrayBuffer> | null = null;
  private muteGraceId: ReturnType<typeof setTimeout> | null = null;
  private recovering = false;
  private stopped = false;
  private readonly callbacks: MicCaptureCallbacks;
  /** Stable identity for register/clear with the mic-level bridge. */
  private readonly levelSource = () => this.readLevel();

  constructor(callbacks: MicCaptureCallbacks) {
    this.callbacks = callbacks;
  }

  /**
   * Mic input level in [0, 1] off the analyser tap, for the UI volume
   * indicator. Scale up, then non-linear to emphasize quieter sounds
   * (formula from memory-atlas). 0 when the graph isn't producing audio —
   * which makes a flat indicator an honest dead-mic signal.
   */
  private readLevel(): number {
    if (!this.analyser || !this.levelData) return 0;
    this.analyser.getByteFrequencyData(this.levelData);
    let sum = 0;
    for (const v of this.levelData) sum += v;
    const average = sum / this.levelData.length;
    return Math.min(1, Math.pow((average / 255) * 3, 0.4));
  }

  /**
   * Acquire the mic and stand up the audio graph. `step` reports pipeline
   * progress for the per-step debug log (see the actor's CONNECT_TIMEOUT
   * diagnostics). Throws on permission/setup failure; returns early without
   * a full graph if stopped mid-flight (the caller's disposed check handles
   * teardown).
   */
  async start({ step }: { step: (name: string) => void }) {
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    if (this.stopped) return;
    step("getUserMedia");

    this.audioContext = new AudioContext();
    await this.audioContext.audioWorklet.addModule(pcmProcessorUrl);
    if (this.stopped) return;
    step("audioWorklet");

    this.sourceNode = this.audioContext.createMediaStreamSource(this.stream);
    this.workletNode = new AudioWorkletNode(this.audioContext, "pcm-processor");
    this.sourceNode.connect(this.workletNode);
    this.workletNode.port.onmessage = (event) => {
      if (event.data.type === "pcm") this.callbacks.onPcm(event.data.samples);
    };
    this.analyser = this.audioContext.createAnalyser();
    this.analyser.fftSize = 256;
    this.sourceNode.connect(this.analyser);
    this.levelData = new Uint8Array(new ArrayBuffer(this.analyser.frequencyBinCount));
    setMicLevelSource(this.levelSource);
    this.watchTrack(this.stream);
  }

  /**
   * Recover from the OS taking the mic: notify the caller, then retry
   * re-acquisition with backoff until it succeeds or {@link stopCapture}
   * aborts the loop (the transcription machine bounds the window and stops
   * the segment on expiry). Idempotent while a loop is already running.
   */
  async beginRecovery() {
    if (this.recovering || this.stopped) return;
    this.recovering = true;
    this.clearMuteGrace();
    console.warn("[realtime-transcription] mic lost — attempting recovery");
    this.callbacks.onMicLost();
    for (let attempt = 1; !this.stopped; attempt++) {
      try {
        await this.reacquire();
        this.recovering = false;
        this.callbacks.onMicRestored();
        return;
      } catch (err) {
        console.warn("[realtime-transcription] mic re-acquire failed:", err);
        await delay(jitteredBackoff(attempt, MIC_RETRY_BACKOFF));
      }
    }
    this.recovering = false;
  }

  /** One attempt to swap a fresh mic stream into the existing audio graph. */
  private async reacquire() {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const track = stream.getAudioTracks()[0];
    if (this.stopped || !this.audioContext || !this.workletNode || !track || track.muted) {
      for (const t of stream.getTracks()) t.stop();
      throw new MicReacquireError(track && track.muted ? "mic still muted" : "capture torn down");
    }
    if (this.sourceNode) this.sourceNode.disconnect();
    this.stopTracks();
    this.stream = stream;
    this.sourceNode = this.audioContext.createMediaStreamSource(stream);
    this.sourceNode.connect(this.workletNode);
    if (this.analyser) this.sourceNode.connect(this.analyser);
    // iOS suspends the AudioContext during interruptions; resume alongside
    // the new stream or the worklet stays silent even with a live track.
    if (this.audioContext.state !== "running") await this.audioContext.resume();
    this.watchTrack(stream);
  }

  private watchTrack(stream: MediaStream) {
    const track = stream.getAudioTracks()[0];
    if (!track) return;
    // No `ended` guard needed for our own stopTracks(): a manual stop()
    // doesn't fire the event — only external (OS-level) causes do.
    track.onended = () => {
      console.warn("[realtime-transcription] mic track ended");
      void this.beginRecovery();
    };
    track.onmute = () => {
      console.warn("[realtime-transcription] mic track muted");
      this.clearMuteGrace();
      this.muteGraceId = setTimeout(() => {
        if (track.muted) void this.beginRecovery();
      }, MIC_MUTE_GRACE_MS);
    };
    track.onunmute = () => {
      console.info("[realtime-transcription] mic track unmuted");
      this.clearMuteGrace();
    };
  }

  private clearMuteGrace() {
    if (this.muteGraceId !== null) {
      clearTimeout(this.muteGraceId);
      this.muteGraceId = null;
    }
  }

  private stopTracks() {
    if (this.stream) {
      for (const track of this.stream.getTracks()) {
        track.stop();
      }
      this.stream = null;
    }
  }

  /** True while the re-acquisition loop is in flight (for arbitration with
   *  the actor's socket reconnect: "restored" means BOTH sides are live). */
  isRecovering(): boolean {
    return this.recovering;
  }

  /** Stop the mic stream and tear down the worklet; aborts any recovery. */
  stopCapture() {
    this.stopped = true;
    clearMicLevelSource(this.levelSource);
    this.clearMuteGrace();
    this.stopTracks();
    if (this.sourceNode) {
      this.sourceNode.disconnect();
      this.sourceNode = null;
    }
    if (this.workletNode) {
      this.workletNode.disconnect();
      this.workletNode = null;
    }
    if (this.analyser) {
      this.analyser.disconnect();
      this.analyser = null;
      this.levelData = null;
    }
  }

  /** Full teardown: capture plus the AudioContext. */
  dispose() {
    this.stopCapture();
    if (this.audioContext) {
      this.audioContext.close().catch(() => {});
      this.audioContext = null;
    }
  }
}

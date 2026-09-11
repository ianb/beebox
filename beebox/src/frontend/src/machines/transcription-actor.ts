/**
 * Callback actor for the realtime transcription machine: owns the mic
 * (AudioContext + worklet), the segment's staged recording, and the live
 * transcription socket for one recording segment.
 *
 * ## The recording outlives the socket
 *
 * (`docs/plans/resilient-voice-recording.md`, Track 3.) The segment starts in
 * this order: mint a recording id and enqueue its staging `create` (the
 * durable upload queue does not wait for the box); start the mic and send
 * MIC_LIVE; only then look up the live service and open a socket. Every PCM
 * frame goes to the {@link StagedRecording} whether or not a socket exists,
 * so a box that is down at segment start — or a socket that drops for a
 * minute during a deploy — costs live text, never audio. The segment end
 * hands the recording to the machine in TRANSCRIPTION_DONE as a sealing
 * obligation; CANCEL discards it; a teardown that nobody claimed seals any
 * captured audio with `hq: null`.
 *
 * ## One connect loop
 *
 * The first connect and every mid-recording drop run the same loop
 * ({@link connectLoop}): full-jitter backoff capped at 30 s, unbounded until
 * stop/cleanup. On a (re)connect it replays at most the last ~30 s of frames
 * (`ReplayRing`) — the frames since the socket went away plus a short pad
 * for the drop's detection latency. A longer gap leaves a hole in the live
 * text, which the HQ pass covers. A close the server would repeat for any
 * fresh socket (1003/1008) or a service error ends live text for the segment
 * and stops the loop; the recording continues.
 *
 * A stalled-but-not-closed transport (a phone clinging to dying wifi) keeps
 * `ws.readyState === OPEN` while `ws.send()` piles into `bufferedAmount`; the
 * liveness watchdog treats a `bufferedAmount` stuck above 0 for
 * {@link STALL_TIMEOUT_MS} (or a `window 'offline'` event) as a drop.
 *
 * ## Mic resilience
 *
 * The input side can die independently — the OS takes the mic for a call,
 * Siri, an app switch. MicCapture (transcription-mic.ts) detects and
 * re-acquires it; the watchdog adds a no-PCM-frames catch-all. When the mic
 * comes back the session reports CONNECTION_RESTORED if a socket is live, or
 * MIC_LIVE if only the recording is.
 */

import { fromCallback } from "xstate";
import { delay, jitteredBackoff } from "@shared/backoff.js";
import { enqueueChunk, enqueueCreate, enqueueDiscard, enqueueFinalize } from "../lib/audio/voice-staging-queue";
import { startStagedRecording, type StagedRecording } from "../lib/audio/voice-stager";
import { TranscriptionServiceResolver } from "../lib/audio/transcription-config-cache";
import { MicCapture } from "./transcription-mic";
import {
  type ConnectionHandle,
  type ServiceCallbacks,
  socketFinalText,
  socketFinalWords,
  startDeepgramConnection,
  startOpenAIRealtimeConnection,
  startVoxtralConnection,
} from "./transcription-connections";
import { openOnce } from "./transcription-wait-for-open";
import { ReplayRing } from "./transcription-replay-ring";
import { SegmentTranscript } from "./transcription-segment-text";
import type { TranscriptionService } from "@shared/transcription-services.js";
import type { TranscriptionActorCommand, TranscriptionActorInput, TranscriptionEvent } from "./transcription-events";

type SendBack = (event: TranscriptionEvent) => void;

const VOICE_STAGING_SINK = { enqueueCreate, enqueueChunk, enqueueFinalize, enqueueDiscard };

/** Poll interval for the liveness watchdog. */
const WATCHDOG_INTERVAL_MS = 500;
/**
 * How long `ws.bufferedAmount` may stay above 0 before we judge the socket
 * stalled. A healthy socket drains our ~300ms PCM frames near-instantly.
 */
const STALL_TIMEOUT_MS = 2500;
/** Per-attempt cap on waiting for a socket to open. */
const OPEN_TIMEOUT_MS = 2500;
/**
 * Replay ring: the last 100 worklet frames (~300 ms each, ≈30 s) — the most a
 * (re)connected socket is ever sent. Older audio exists only in staging.
 */
const REPLAY_CAP_CHUNKS = 100;
/**
 * Frames to replay from *before* a detected drop, covering its detection
 * latency (frames the dying socket buffered but never delivered before the
 * watchdog tripped). ~10 frames ≈ 3 s. Replaying the whole ring instead would
 * re-transcribe up to 30 s the live text already holds.
 */
const REPLAY_PAD_CHUNKS = 10;
/**
 * How long the worklet may deliver no PCM frames before we judge the capture
 * pipeline dead (catch-all behind MicCapture's track `ended`/`mute` handlers).
 */
const MIC_SILENT_TIMEOUT_MS = 4000;
/** Full-jitter backoff between failed connect attempts; the loop never gives up on its own. */
const RETRY_BACKOFF = { baseMs: 400, capMs: 30_000 } as const;
/**
 * Close codes a fresh socket would repeat: 1008/DATA-0000 means the audio
 * payload couldn't be decoded, 1003 is unsupported data. Everything else
 * (1006 abnormal, 1011 timeouts, 1012 restart) is a transient drop.
 */
const NON_RETRYABLE_CLOSE_CODES: ReadonlySet<number> = new Set([1003, 1008]);

class TranscriptionSession {
  private readonly sendBack: SendBack;
  private readonly recording: StagedRecording;
  private readonly services = new TranscriptionServiceResolver();
  private readonly replay = new ReplayRing({ capacity: REPLAY_CAP_CHUNKS });
  private readonly text = new SegmentTranscript();
  /** TRANSCRIPTION_DONE carried the recording out; it is no longer ours. */
  private handedOff = false;
  private cancelled = false;
  private connection: ConnectionHandle | null = null;
  private mic: MicCapture | null = null;
  private disposed = false;
  /**
   * Opaque read of `disposed` for checks after an `await`: TS narrowing
   * wrongly carries an earlier same-tick `false` across the await, though
   * stop()/cleanup() can land in between.
   */
  private isDisposed(): boolean {
    return this.disposed;
  }
  private connectedFired = false;
  /** True while the connect loop is wanted (no live socket, still trying). */
  private linking = false;
  /** Live text was abandoned for this segment (a close/error a retry can't fix). */
  private liveAbandoned = false;
  /** Last time the worklet delivered a PCM frame (mic liveness watchdog). */
  private lastPcmAt = 0;
  /** An intentional stop is in progress: a close now is the end of stream. */
  private stopping = false;
  private watchdogId: ReturnType<typeof setInterval> | null = null;
  private lastDrainedAt = 0;
  private readonly callbacks: ServiceCallbacks = {
    onTextUpdate: ({ finalText, interimText, finalWords }) => {
      if (this.disposed) return;
      // Only Deepgram sets `finalWords`; `undefined` must stay "no data".
      const merged = this.text.update({ finalText, finalWords: finalWords ?? null });
      this.sendBack({ type: "TEXT_UPDATE", finalText: merged.text, interimText, finalWords: merged.words });
    },
    onDone: (text) => {
      if (this.disposed || this.handedOff) return;
      this.sendBack({ type: "TRANSCRIPTION_DONE", text: this.text.textWith(text ?? ""), recording: this.handOff() });
    },
    onServerError: (message) => {
      if (this.disposed || !this.connection) return;
      console.error(`[realtime-transcription] service error — live text off for this segment: ${message}`);
      this.abandonLive({ type: "SERVER_ERROR", message });
    },
  };

  constructor(opts: { sendBack: SendBack; targetSessionId: string | null }) {
    this.sendBack = opts.sendBack;
    this.recording = startStagedRecording({
      recordingId: crypto.randomUUID(),
      targetSessionId: opts.targetSessionId,
      sink: VOICE_STAGING_SINK,
    });
  }

  private handOff(): StagedRecording {
    this.handedOff = true;
    return this.recording;
  }

  private stopWatchdog() {
    if (this.watchdogId !== null) {
      clearInterval(this.watchdogId);
      this.watchdogId = null;
    }
  }

  private startConnection(service: TranscriptionService): Promise<ConnectionHandle> {
    if (service === "deepgram") return startDeepgramConnection(this.callbacks);
    if (service === "openai-realtime") return startOpenAIRealtimeConnection(this.callbacks);
    // Default: voxtral (whisper has no realtime path; treat like voxtral)
    return Promise.resolve(startVoxtralConnection(this.callbacks));
  }

  /** Lifecycle handlers for an adopted (open) socket; `onmessage` is the service helper's. */
  private attachActorHandlers(ws: WebSocket) {
    // onerror carries no close code and is always followed by onclose.
    ws.onerror = () => console.error("[realtime-transcription] WebSocket error");
    ws.onclose = (event) => {
      if (this.disposed || this.connection?.ws !== ws) return;
      if (this.stopping) {
        this.finalizeFromHandle(ws);
        return;
      }
      if (NON_RETRYABLE_CLOSE_CODES.has(event.code)) {
        console.error(`[realtime-transcription] non-retryable close (code=${event.code} reason="${event.reason}") — recording continues without live text`);
        this.abandonLive({ type: "WS_ERROR", message: `Live transcription unavailable (code ${event.code}) — still recording` });
        return;
      }
      console.warn(`[realtime-transcription] socket dropped mid-recording (code=${event.code} reason="${event.reason}") — reconnecting`);
      this.dropLink();
    };
  }

  /** A closing socket after stop(): Deepgram/OpenAI keep the final transcript on the handle. */
  private finalizeFromHandle(ws: WebSocket) {
    if (this.handedOff) return; // stop() already ended the segment
    const finalFn = socketFinalText(ws);
    if (!finalFn) {
      this.sendBack({ type: "WS_CLOSED" });
      return;
    }
    const wordsFn = socketFinalWords(ws);
    const words = this.text.wordsWith(wordsFn ? wordsFn() : null);
    this.sendBack({ type: "TRANSCRIPTION_DONE", text: this.text.textWith(finalFn()), words, recording: this.handOff() });
  }

  private startWatchdog() {
    this.stopWatchdog();
    this.lastDrainedAt = performance.now();
    this.lastPcmAt = performance.now();
    this.watchdogId = setInterval(() => {
      if (this.disposed || this.stopping) return;
      // beginRecovery self-guards, so re-triggering while recovering is a no-op.
      if (this.mic && performance.now() - this.lastPcmAt > MIC_SILENT_TIMEOUT_MS) {
        void this.mic.beginRecovery();
        return;
      }
      const ws = this.connection?.ws;
      if (!ws || ws.readyState !== WebSocket.OPEN) return; // onclose owns real closes
      if (ws.bufferedAmount === 0) {
        this.lastDrainedAt = performance.now();
      } else if (performance.now() - this.lastDrainedAt > STALL_TIMEOUT_MS) {
        this.dropLink();
      }
    }, WATCHDOG_INTERVAL_MS);
  }

  /** Detach handlers and close a socket without firing machine events. */
  private discardSocket(handle: ConnectionHandle | null) {
    if (!handle) return;
    const ws = handle.ws;
    ws.onopen = null;
    ws.onerror = null;
    ws.onclose = null;
    ws.onmessage = null;
    if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
      ws.close();
    }
  }

  /** A live socket went away: keep recording, and reconnect. */
  private dropLink() {
    if (!this.connection || this.disposed || this.stopping) return;
    this.text.fold();
    this.discardSocket(this.connection);
    this.connection = null;
    this.replay.markGap({ padFrames: REPLAY_PAD_CHUNKS });
    this.sendBack({ type: "CONNECTION_DEGRADED", cause: "network" });
    this.beginLinking();
  }

  /** Give up on live text for this segment; the recording continues. */
  private abandonLive(event: { type: "WS_ERROR" | "SERVER_ERROR"; message: string }) {
    this.liveAbandoned = true;
    this.linking = false;
    this.text.fold();
    this.discardSocket(this.connection);
    this.connection = null;
    this.sendBack(event);
  }

  private linkWanted(): boolean {
    return this.linking && !this.disposed && !this.stopping && !this.liveAbandoned;
  }

  private beginLinking() {
    if (this.linking || this.disposed || this.stopping || this.liveAbandoned) return;
    this.linking = true;
    this.connectLoop().catch((e: unknown) => {
      console.error("[realtime-transcription] connect loop failed; recording continues without live text:", e);
      this.linking = false;
    });
  }

  /** The one connect loop: first connect and every reconnect. Runs until a socket is adopted or linking stops. */
  private async connectLoop(): Promise<void> {
    for (let attempt = 1; this.linkWanted(); attempt++) {
      const handle = await this.connectOnce();
      if (handle !== null) {
        if (this.linkWanted()) this.adopt(handle);
        else this.discardSocket(handle);
        return;
      }
      if (!this.linkWanted()) return;
      const waitMs = jitteredBackoff(attempt, RETRY_BACKOFF);
      console.warn(`[realtime-transcription] connect attempt ${String(attempt)} failed; retrying in ${String(waitMs)}ms (still recording)`);
      await delay(waitMs);
    }
  }

  private async connectOnce(): Promise<ConnectionHandle | null> {
    const service = await this.services.resolve();
    if (service === null || !this.linkWanted()) return null;
    try {
      return await openOnce(() => this.startConnection(service), {
        attemptTimeoutMs: OPEN_TIMEOUT_MS,
        discard: (handle) => this.discardSocket(handle),
      });
    } catch (e) {
      // e.g. minting a Deepgram/OpenAI key while the box is restarting.
      console.warn("[realtime-transcription] could not start a transcription connection:", e);
      return null;
    }
  }

  /** Make an open socket the live one. Synchronous, so no frame interleaves the replay. */
  private adopt(next: ConnectionHandle) {
    this.linking = false;
    this.connection = next;
    this.attachActorHandlers(next.ws);
    for (const frame of this.replay.sinceGap()) next.sendPcm(frame);
    this.lastDrainedAt = performance.now();
    const first = !this.connectedFired;
    this.connectedFired = true;
    // A mic mid-recovery owns the next event (see onMicRestored).
    if (this.mic?.isRecovering() === true) return;
    this.sendBack(first ? { type: "WS_CONNECTED" } : { type: "CONNECTION_RESTORED" });
  }

  /** Clean interface loss / DevTools "Offline" — react before the watchdog does. */
  private readonly onOffline = () => {
    if (this.disposed || !this.connection) return;
    this.dropLink();
  };

  async start(): Promise<void> {
    try {
      this.mic = new MicCapture({
        onPcm: (samples) => {
          this.lastPcmAt = performance.now();
          // The stager and the ring copy the frame; forwarding may transfer it.
          if (!this.handedOff) this.recording.push(samples);
          this.replay.push(samples.slice(0));
          if (this.connection) this.connection.sendPcm(samples);
        },
        onMicLost: () => {
          if (this.disposed || this.stopping) return;
          this.sendBack({ type: "CONNECTION_DEGRADED", cause: "microphone" });
        },
        onMicRestored: () => {
          if (this.disposed || this.stopping) return;
          this.lastPcmAt = performance.now();
          this.sendBack(this.connection ? { type: "CONNECTION_RESTORED" } : { type: "MIC_LIVE" });
        },
      });
      await this.mic.start();
      if (this.isDisposed()) {
        this.cleanup();
        return;
      }
    } catch (err) {
      if (!this.disposed) {
        const msg = err instanceof Error ? err.message : "Failed to start recording";
        console.error("[realtime-transcription] Start error:", msg);
        this.sendBack({ type: "SETUP_ERROR", message: msg });
      }
      this.cleanup();
      return;
    }
    this.sendBack({ type: "MIC_LIVE" });
    this.startWatchdog();
    window.addEventListener("offline", this.onOffline);
    this.beginLinking();
  }

  stop() {
    if (this.stopping || this.disposed) return;
    // `stopping` makes a close from here on the end of stream, and ends the loop.
    this.stopping = true;
    this.linking = false;
    this.stopWatchdog();
    if (this.mic) this.mic.stopCapture();
    if (this.connection) this.connection.endStream();
    // Finalize now rather than waiting on the socket's transcription.done
    // (seconds, or never): the machine already holds the realtime text, and
    // the recording is what carries the words.
    this.sendBack({ type: "TRANSCRIPTION_DONE", recording: this.handOff() });
  }

  cancel() {
    this.cancelled = true;
    this.cleanup();
  }

  /**
   * A recording nobody received: CANCEL or an empty one is discarded; one with
   * audio (the chat unmounted mid-segment) is kept, sealed without HQ.
   * Idempotent — cleanup can run twice when a stop races start().
   */
  private settleRecording() {
    if (this.handedOff) return;
    if (this.cancelled || !this.recording.hasAudio()) this.recording.discard();
    else this.recording.seal({ emissionId: null, hq: null });
  }

  cleanup() {
    this.disposed = true;
    this.linking = false;
    this.settleRecording();
    this.stopWatchdog();
    window.removeEventListener("offline", this.onOffline);
    if (this.mic) {
      this.mic.dispose();
      this.mic = null;
    }
    this.discardSocket(this.connection);
    this.connection = null;
  }
}

export const transcriptionActor = fromCallback<TranscriptionActorCommand, TranscriptionActorInput, TranscriptionEvent>(
  ({ sendBack, receive, input }) => {
    const session = new TranscriptionSession({ sendBack, targetSessionId: input.targetSessionId });
    void session.start();

    receive((event) => {
      if (event.type === "STOP") session.stop();
      else session.cancel();
    });

    return () => session.cleanup();
  },
);

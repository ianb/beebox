/**
 * Callback actor for the realtime transcription machine: owns the WebSocket,
 * AudioContext, MediaStream, and AudioWorklet for one recording segment.
 *
 * It queries the configured transcription service, opens the matching
 * connection (see `transcription-connections.ts`), pumps PCM frames from the
 * worklet to the service, and translates service callbacks + socket lifecycle
 * into machine events. Captured PCM is WAV-wrapped on done for narration's HQ
 * pass.
 *
 * ## Network resilience
 *
 * Three recovery paths, all reusing the same connection loop:
 *
 *   1. Connect-retry — the *initial* socket failing to open (the symptom we
 *      saw: a fresh segment whose WebSocket errored at connect, before any
 *      onopen) is retried a few times with jittered backoff before we surface a
 *      start failure. Lives in {@link start}.
 *   2. Mid-recording reconnect — an established socket that errors/closes
 *      mid-segment routes through {@link beginReconnect} (not straight to idle),
 *      preserving captured audio and replaying it onto a fresh socket. The
 *      close code decides: transient transport drops (1006/1011) reconnect;
 *      format errors (1008/1003) don't. Lives in {@link attachActorHandlers}.
 *   3. Stalled-transport watchdog — see below.
 *
 * A stalled-but-not-closed transport (the classic "phone clings to a dying
 * wifi signal" case) keeps `ws.readyState === OPEN` while no bytes actually
 * leave the device — `ws.send()` silently piles into `ws.bufferedAmount` and
 * neither `onerror` nor `onclose` fires until TCP eventually times out
 * (minutes). To catch this we run a liveness watchdog: while recording, any
 * live socket drains `bufferedAmount` to 0 between our ~300ms PCM frames, so a
 * `bufferedAmount` that stays above 0 for longer than {@link STALL_TIMEOUT_MS}
 * means the socket is dead. On that (or a `window 'offline'` event) we emit
 * CONNECTION_DEGRADED and attempt a transparent reconnect: tear down the dead
 * socket, re-open the same service, and replay the PCM captured during the gap
 * (we already keep every frame for narration). The mic/worklet/AudioContext
 * stay alive throughout, so capture is continuous. On success we emit
 * CONNECTION_RESTORED; the machine bounds the whole window and finalizes on the
 * captured audio if no attempt succeeds.
 *
 * ## Mic resilience
 *
 * The *input* side can die independently of the network — the OS takes the
 * microphone for a phone call/Siri/app switch and the socket stays healthy.
 * MicCapture (transcription-mic.ts) owns that detection + re-acquisition;
 * the session adds a no-PCM-frames check to the watchdog as a catch-all and
 * arbitrates so CONNECTION_RESTORED only fires when both sides are live.
 *
 * The per-segment state and lifecycle live in {@link TranscriptionSession};
 * the actor wrapper just bridges it to XState's sendBack/receive/dispose.
 */

import { fromCallback } from "xstate";
import { trpcClient } from "../lib/trpc";
import { MicCapture } from "./transcription-mic";
import { encodePcmChunksAsWav } from "../lib/audio/wav-encode";
import {
  type ConnectionHandle,
  type ServiceCallbacks,
  socketFinalText,
  startDeepgramConnection,
  startOpenAIRealtimeConnection,
  startVoxtralConnection,
} from "./transcription-connections";
import { openWithRetry } from "./transcription-wait-for-open";
import type { TranscriptionService } from "../../../core/transcription/index.js";
import type { TranscriptionEvent } from "./transcription-events";

interface TranscriptionActorInput {
  dummy?: never;
}

type SendBack = (event: TranscriptionEvent) => void;

/** Poll interval for the liveness watchdog. */
const WATCHDOG_INTERVAL_MS = 500;
/**
 * How long `ws.bufferedAmount` may stay above 0 before we judge the socket
 * stalled. A healthy socket drains our ~300ms PCM frames near-instantly, so a
 * few seconds of no drain is decisive. Kept comfortably above one frame's
 * worth of jitter.
 */
const STALL_TIMEOUT_MS = 2500;
/** Per-attempt cap on waiting for any socket (initial or reconnect) to open. */
const OPEN_TIMEOUT_MS = 2500;
/**
 * Worklet PCM frames to replay *before* the detected drop, to cover the
 * detection latency (frames the dying socket buffered-but-never-delivered in
 * the seconds before the watchdog tripped). Frames are ~300ms each
 * (CHUNK_DURATION_MS in pcm-processor.worklet.js), so ~10 frames ≈ 3s.
 */
const REPLAY_PAD_CHUNKS = 10;
/** Connect-retry: total attempts to open the *initial* socket before failing. */
const CONNECT_MAX_ATTEMPTS = 3;
/**
 * How long the worklet may deliver no PCM frames mid-recording before we
 * judge the capture pipeline dead. Frames normally arrive every ~300ms
 * (CHUNK_DURATION_MS); none for several seconds means the track ended or the
 * AudioContext was suspended without an event we caught. Catch-all behind
 * MicCapture's explicit track `ended`/`mute` handlers.
 */
const MIC_SILENT_TIMEOUT_MS = 4000;
/** Full-jitter backoff bounds between failed connect/reconnect attempts. */
const RETRY_BACKOFF = { baseMs: 400, capMs: 2000 } as const;
/**
 * WebSocket close codes we must not blind-retry: 1008/DATA-0000 means the audio
 * payload couldn't be decoded (wrong format/codec), so a fresh socket with the
 * same encoding would just fail the same way. 1003 (unsupported data) is the
 * same class. Everything else mid-recording (1006 abnormal, 1011 NET timeouts)
 * is a transient transport drop worth a transparent reconnect.
 */
const NON_RETRYABLE_CLOSE_CODES: ReadonlySet<number> = new Set([1003, 1008]);

class TranscriptionSession {
  private readonly sendBack: SendBack;
  private connection: ConnectionHandle | null = null;
  private mic: MicCapture | null = null;
  private disposed = false;
  /**
   * Opaque read of `disposed` for checks after an `await` in {@link start}.
   * A raw `this.disposed` read there gets flagged as an always-false dead
   * check — TS's control-flow narrowing (wrongly) treats the field as still
   * `false` from an earlier same-tick check, even though `stop()`/`cleanup()`
   * can genuinely land between the await and this line (a CANCEL event
   * arriving mid-`start()`). Routing through a method call is opaque to CFA,
   * so the check stays live for its real purpose.
   */
  private isDisposed(): boolean {
    return this.disposed;
  }
  private connectedFired = false;
  private service: TranscriptionService = "voxtral";
  private callbacks: ServiceCallbacks | null = null;
  /** Gates live worklet→socket forwarding; false during a reconnect replay. */
  private forwardLive = true;
  /** True while a reconnect attempt loop is in flight. */
  private reconnecting = false;
  /** Last time the worklet delivered a PCM frame (mic liveness watchdog). */
  private lastPcmAt = 0;
  /**
   * Set once we've initiated an intentional stop (user/silence/max-duration).
   * Distinguishes the normal end-of-stream close (finalize) from an unexpected
   * mid-recording drop (reconnect) in {@link attachActorHandlers}'s onclose.
   */
  private stopping = false;
  /**
   * Text confirmed by *previous* connections this segment. Each transport
   * emits its session's full accumulated transcript as `finalText` (replace,
   * not append) and a reconnect opens a fresh, empty-start session — so without
   * a prefix the first post-reconnect update would wipe everything said before
   * the drop. Folded in on reconnect, prepended to all the new session emits.
   */
  private committedPrefix = "";
  /** Most recent `finalText` from the *current* connection (sans prefix). */
  private lastConnectionFinal = "";
  private watchdogId: ReturnType<typeof setInterval> | null = null;
  /** Last time `bufferedAmount` was observed at 0 (i.e. fully drained). */
  private lastDrainedAt = 0;
  /**
   * PCM s16le chunks captured for this segment. Concatenated and WAV-wrapped
   * on TRANSCRIPTION_DONE so narration mode can re-send to the HQ pass. Also
   * the replay source for transparent reconnects.
   */
  private readonly audioChunks: ArrayBuffer[] = [];

  constructor(sendBack: SendBack) {
    this.sendBack = sendBack;
  }

  private takeAudioBlob(): Blob | undefined {
    if (this.audioChunks.length === 0) return undefined;
    const blob = encodePcmChunksAsWav(this.audioChunks);
    this.audioChunks.length = 0;
    return blob;
  }

  /** Prepend text confirmed by prior connections (see committedPrefix). */
  private mergeFinal(text: string): string {
    if (!this.committedPrefix) return text;
    if (!text) return this.committedPrefix;
    return `${this.committedPrefix} ${text}`;
  }

  private stopWatchdog() {
    if (this.watchdogId !== null) {
      clearInterval(this.watchdogId);
      this.watchdogId = null;
    }
  }

  private startConnection(cbs: ServiceCallbacks): Promise<ConnectionHandle> {
    if (this.service === "deepgram") return startDeepgramConnection(cbs);
    if (this.service === "openai-realtime") return startOpenAIRealtimeConnection(cbs);
    // Default: voxtral (whisper has no realtime path; treat like voxtral)
    return Promise.resolve(startVoxtralConnection(cbs));
  }

  /**
   * Wire the socket-lifecycle handlers the actor owns (onopen/onerror/onclose).
   * `onmessage` is set by the per-service connection helper. Used for both the
   * initial socket and reconnected ones.
   */
  private attachActorHandlers(ws: WebSocket) {
    ws.onopen = () => this.markConnected();
    // onerror carries no close code and an errored socket always then fires
    // onclose (which does) — so just log here and let onclose route the outcome.
    ws.onerror = () => console.error("[realtime-transcription] WebSocket error");
    ws.onclose = (event) => {
      if (this.disposed || this.reconnecting) return;
      // Intentional stop, or a not-yet-open socket: finalize as before.
      if (this.stopping || !this.connectedFired) {
        this.finalizeFromHandle(ws);
        return;
      }
      // Unexpected close mid-recording. Transient transport drops reconnect
      // transparently; format errors (which a fresh socket can't fix) surface.
      if (NON_RETRYABLE_CLOSE_CODES.has(event.code)) {
        console.error(`[realtime-transcription] non-retryable close (code=${event.code} reason="${event.reason}")`);
        this.sendBack({ type: "WS_ERROR", message: `Transcription closed (code ${event.code})` });
        return;
      }
      console.warn(`[realtime-transcription] socket dropped mid-recording (code=${event.code} reason="${event.reason}") — reconnecting`);
      this.beginReconnect();
    };
  }

  /** Mark the socket open: fire WS_CONNECTED once (idempotent across paths). */
  private markConnected() {
    if (this.disposed || this.connectedFired) return;
    this.connectedFired = true;
    this.sendBack({ type: "WS_CONNECTED" });
  }

  /**
   * Finalize the segment from a closing socket. For Deepgram/OpenAI the final
   * transcript lives on the handle, so emit TRANSCRIPTION_DONE; otherwise the
   * machine just needs to know the socket closed.
   */
  private finalizeFromHandle(ws: WebSocket) {
    const finalFn = socketFinalText(ws);
    if (finalFn) {
      const audioBlob = this.takeAudioBlob();
      this.sendBack({ type: "TRANSCRIPTION_DONE", text: this.mergeFinal(finalFn()), audioBlob });
    } else {
      this.sendBack({ type: "WS_CLOSED" });
    }
  }

  private startWatchdog() {
    this.stopWatchdog();
    this.lastDrainedAt = performance.now();
    this.lastPcmAt = performance.now();
    this.watchdogId = setInterval(() => {
      if (this.disposed || this.reconnecting) return;
      // Mic liveness: no PCM frames for too long means the capture side died
      // without an event MicCapture caught (e.g. a suspended AudioContext).
      // beginRecovery self-guards, so re-triggering while recovering is a no-op.
      if (!this.stopping && this.mic && performance.now() - this.lastPcmAt > MIC_SILENT_TIMEOUT_MS) {
        void this.mic.beginRecovery();
        return;
      }
      if (!this.connection) return;
      const ws = this.connection.ws;
      if (ws.readyState !== WebSocket.OPEN) return; // onclose/onerror owns real closes
      if (ws.bufferedAmount === 0) {
        this.lastDrainedAt = performance.now();
        return;
      }
      if (performance.now() - this.lastDrainedAt > STALL_TIMEOUT_MS) {
        this.beginReconnect();
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

  private beginReconnect() {
    if (this.reconnecting || this.disposed || !this.callbacks) return;
    this.reconnecting = true;
    this.forwardLive = false;
    // Fold the dying session's text into the prefix so the fresh session's
    // (empty-start) accumulator appends to it rather than replacing it.
    if (this.lastConnectionFinal) {
      this.committedPrefix = this.mergeFinal(this.lastConnectionFinal);
      this.lastConnectionFinal = "";
    }
    this.sendBack({ type: "CONNECTION_DEGRADED", cause: "network" });
    // Replay from before the drop to cover detection latency.
    const replayFrom = Math.max(0, this.audioChunks.length - REPLAY_PAD_CHUNKS);
    this.discardSocket(this.connection);
    this.connection = null;
    void this.attemptReconnect(replayFrom);
  }

  private async attemptReconnect(replayFrom: number) {
    const callbacks = this.callbacks;
    if (!callbacks) return;
    // Retries are bounded not by a count but by the machine's RECONNECT_WINDOW:
    // on expiry it stops the actor, which clears `reconnecting` and aborts us.
    const next = await openWithRetry(() => this.startConnection(callbacks), {
      attempts: Number.MAX_SAFE_INTEGER,
      attemptTimeoutMs: OPEN_TIMEOUT_MS,
      backoff: RETRY_BACKOFF,
      isAborted: () => this.disposed || !this.reconnecting,
      discard: (handle) => this.discardSocket(handle),
    });
    // A socket can open just as the window expires; honor the abort.
    if (!next) return;
    if (this.disposed || !this.reconnecting) {
      this.discardSocket(next);
      return;
    }
    // Synchronous from here: no await means no worklet message can interleave,
    // so the replay can't race live forwarding.
    this.connection = next;
    this.attachActorHandlers(next.ws);
    for (const chunk of this.audioChunks.slice(replayFrom)) {
      next.sendPcm(chunk);
    }
    this.forwardLive = true;
    this.reconnecting = false;
    this.lastDrainedAt = performance.now();
    // If the mic died during the network blip, its recovery owns "restored".
    if (!this.mic || !this.mic.isRecovering()) {
      this.sendBack({ type: "CONNECTION_RESTORED" });
    }
  }

  /** Clean interface loss / DevTools "Offline" toggle — fast-path reconnect. */
  private readonly onOffline = () => {
    // The stalled-wifi case keeps navigator.onLine true, so the bufferedAmount
    // watchdog is the real workhorse; this just reacts sooner when it can.
    if (this.disposed || this.reconnecting || !this.connection) return;
    this.beginReconnect();
  };

  async start() {
    try {
      const config = await trpcClient.transcription.config.query();
      if (this.disposed) { this.cleanup(); return; }
      this.service = config.service;

      this.mic = new MicCapture({
        onPcm: (samples) => {
          // Keep a copy for the HQ pass (narration mode) and for replay on
          // reconnect. Clone before forwarding because the worklet transfers
          // ownership of the ArrayBuffer to the main thread.
          this.lastPcmAt = performance.now();
          this.audioChunks.push(samples.slice(0));
          if (this.connection && this.forwardLive) this.connection.sendPcm(samples);
        },
        onMicLost: () => {
          if (this.disposed || this.stopping) return;
          this.sendBack({ type: "CONNECTION_DEGRADED", cause: "microphone" });
        },
        onMicRestored: () => {
          if (this.disposed || this.stopping) return;
          this.lastPcmAt = performance.now();
          // "Restored" means the whole pipeline is live again — if the socket
          // is still mid-reconnect, its own success will send the event.
          if (!this.reconnecting) this.sendBack({ type: "CONNECTION_RESTORED" });
        },
      });
      await this.mic.start();
      if (this.isDisposed()) { this.cleanup(); return; }

      this.callbacks = {
        onTextUpdate: (finalText, interimText) => {
          if (this.disposed) return;
          this.lastConnectionFinal = finalText;
          this.sendBack({ type: "TEXT_UPDATE", finalText: this.mergeFinal(finalText), interimText });
        },
        onDone: (text) => {
          if (this.disposed) return;
          const audioBlob = this.takeAudioBlob();
          this.sendBack({ type: "TRANSCRIPTION_DONE", text: this.mergeFinal(text ?? ""), audioBlob });
        },
        onServerError: (message) => {
          if (this.disposed || this.reconnecting) return;
          this.sendBack({ type: "SERVER_ERROR", message });
        },
      };

      const callbacks = this.callbacks;
      const opened = await openWithRetry(() => this.startConnection(callbacks), {
        attempts: CONNECT_MAX_ATTEMPTS,
        attemptTimeoutMs: OPEN_TIMEOUT_MS,
        backoff: RETRY_BACKOFF,
        isAborted: () => this.disposed,
        discard: (handle) => this.discardSocket(handle),
      });
      if (this.isDisposed()) { this.cleanup(); return; }
      if (!opened) {
        this.sendBack({ type: "WS_ERROR", message: "Couldn't connect to transcription service" });
        this.cleanup();
        return;
      }
      this.connection = opened;
      this.attachActorHandlers(opened.ws);
      this.markConnected();
      this.startWatchdog();
      window.addEventListener("offline", this.onOffline);
    } catch (err) {
      if (!this.disposed) {
        const msg = err instanceof Error ? err.message : "Failed to start recording";
        console.error("[realtime-transcription] Start error:", msg);
        this.sendBack({ type: "SETUP_ERROR", message: msg });
      }
      this.cleanup();
    }
  }

  stop() {
    // A stop can land mid-reconnect (window expiry, or a voice keyword the
    // user spoke during the blip) — abort the retry loop first. `stopping` tells
    // the close handler this is an intentional end (finalize, not reconnect).
    this.stopping = true;
    this.reconnecting = false;
    this.stopWatchdog();
    if (this.mic) this.mic.stopCapture();
    if (this.connection) {
      this.connection.endStream();
    }
    // Finalize the segment immediately rather than waiting on the WS to send
    // transcription.done — that often takes seconds or never arrives
    // (FINALIZE_TIMEOUT fallback). The realtime transcript in machine context
    // is what we have; if a better text arrives later from the WS, the machine
    // is already in idle and the event is ignored. The audio blob is the thing
    // we actually need for narration's HQ pass.
    const audioBlob = this.takeAudioBlob();
    this.sendBack({ type: "TRANSCRIPTION_DONE", audioBlob });
  }

  cleanup() {
    this.disposed = true;
    this.reconnecting = false;
    this.stopWatchdog();
    window.removeEventListener("offline", this.onOffline);
    if (this.mic) {
      this.mic.dispose();
      this.mic = null;
    }
    if (this.connection) {
      const ws = this.connection.ws;
      if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
        ws.close();
      }
      this.connection = null;
    }
  }
}

export const transcriptionActor = fromCallback<
  { type: "STOP" } | { type: "CANCEL" },
  TranscriptionActorInput,
  TranscriptionEvent
>(({ sendBack, receive }) => {
  const session = new TranscriptionSession(sendBack);
  void session.start();

  receive((event) => {
    if (event.type === "STOP") {
      session.stop();
    } else {
      session.cleanup();
    }
  });

  return () => session.cleanup();
});

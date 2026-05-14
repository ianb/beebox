/**
 * XState machine for realtime speech-to-text.
 *
 * States: idle → connecting → recording → finalizing → idle
 *
 * The callback actor branches by transcription service (configured per box):
 *
 *   - "voxtral":  WebSocket proxy through the backend, which forwards to
 *                 Mistral Voxtral Realtime. Audio frames go up as JSON
 *                 (base64 PCM); deltas come back as transcription.text.delta.
 *                 No interim/final distinction — every delta accumulates.
 *
 *   - "deepgram": Direct browser → Deepgram WebSocket using a short-lived
 *                 temp key minted by the backend. Audio frames go up as
 *                 raw 16kHz s16le PCM bytes. Results arrive with is_final
 *                 toggled — interim updates set interimTranscript, final
 *                 updates append to finalTranscript.
 *
 * Both branches feed the same internal events:
 *   TEXT_UPDATE { finalText, interimText }
 *   TRANSCRIPTION_DONE { text }
 *
 * Machine context keeps finalTranscript and interimTranscript separate so
 * keyword spotting can run on finals only.
 */

import { setup, assign, fromCallback } from "xstate";
import { getApiBase } from "../api";
import pcmProcessorUrl from "../audio/pcm-processor.worklet.js?url";
import { recordingStop } from "../lib/earcons";
import { trpcClient } from "../lib/trpc";
import { deepgramKeyManager } from "../lib/deepgram-key";
import { encodePcmChunksAsWav } from "../lib/wav-encode";

export type TranscriptionState = "idle" | "connecting" | "recording" | "finalizing";

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCodePoint(byte);
  }
  return btoa(binary);
}

// -- Events --

type TranscriptionEvent =
  | { type: "START" }
  | { type: "STOP" }
  | { type: "CANCEL" }
  | { type: "DISMISS_ERROR" }
  | { type: "WS_CONNECTED" }
  | { type: "WS_ERROR"; message: string }
  | { type: "WS_CLOSED" }
  | { type: "TEXT_UPDATE"; finalText: string; interimText: string }
  | { type: "TRANSCRIPTION_DONE"; text?: string; audioBlob?: Blob }
  | { type: "SERVER_ERROR"; message: string }
  | { type: "SETUP_ERROR"; message: string };

// -- Per-service connection helpers --

interface ConnectionHandle {
  ws: WebSocket;
  /** Send a chunk of 16-bit PCM (16kHz mono) to the service. */
  sendPcm: (samples: ArrayBuffer) => void;
  /** Tell the service we're done sending audio. */
  endStream: () => void;
}

interface ServiceCallbacks {
  onTextUpdate: (finalText: string, interimText: string) => void;
  onDone: (text?: string) => void;
  onServerError: (message: string) => void;
}

function startVoxtralConnection(callbacks: ServiceCallbacks): ConnectionHandle {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  const wsUrl = `${protocol}//${window.location.host}${getApiBase()}/chat/transcribe-ws`;
  const ws = new WebSocket(wsUrl);
  let accumulated = "";

  ws.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data);
      if (msg.type === "transcription.text.delta") {
        const delta = msg.delta ?? msg.text ?? "";
        if (delta) {
          accumulated += delta;
          callbacks.onTextUpdate(accumulated, "");
        }
      } else if (msg.type === "transcription.done") {
        const text = typeof msg.text === "string" && msg.text ? msg.text : accumulated;
        callbacks.onDone(text);
      } else if (msg.type === "error") {
        const errMsg = typeof msg.error === "object"
          ? (msg.error as { message?: string })?.message || JSON.stringify(msg.error)
          : msg.error || "Transcription error";
        callbacks.onServerError(String(errMsg));
      }
      // session.created, session.updated, transcription.segment,
      // transcription.language — log only / ignore
    } catch (_e) {
      // Non-JSON message, ignore
    }
  };

  return {
    ws,
    sendPcm: (samples) => {
      if (ws.readyState !== WebSocket.OPEN) return;
      ws.send(JSON.stringify({
        type: "input_audio.append",
        audio: arrayBufferToBase64(samples),
      }));
    },
    endStream: () => {
      if (ws.readyState !== WebSocket.OPEN) return;
      ws.send(JSON.stringify({ type: "input_audio.end" }));
    },
  };
}

async function startDeepgramConnection(callbacks: ServiceCallbacks): Promise<ConnectionHandle> {
  const tempKey = await deepgramKeyManager.getKey();
  const params = new URLSearchParams({
    model: "nova-3",
    encoding: "linear16",
    sample_rate: "16000",
    channels: "1",
    interim_results: "true",
    smart_format: "true",
    punctuate: "true",
    no_delay: "true",
    endpointing: "1500",
    utterance_end_ms: "1500",
    mip_opt_out: "true",
    language: "en-US",
  });
  const wsUrl = `wss://api.deepgram.com/v1/listen?${params.toString()}`;
  const ws = new WebSocket(wsUrl, ["token", tempKey]);
  let accumulatedFinal = "";

  ws.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data);
      if (msg.type === "Results") {
        const transcript: string = msg.channel?.alternatives?.[0]?.transcript ?? "";
        const isFinal: boolean = !!msg.is_final;
        if (isFinal) {
          if (transcript.trim()) {
            accumulatedFinal = (accumulatedFinal + " " + transcript).trim();
          }
          callbacks.onTextUpdate(accumulatedFinal, "");
        } else {
          callbacks.onTextUpdate(accumulatedFinal, transcript);
        }
      } else if (msg.type === "UtteranceEnd") {
        // Drop any stray interim
        callbacks.onTextUpdate(accumulatedFinal, "");
      } else if (msg.type === "Metadata") {
        // Sent at session end — ignore here, onclose drives done
      } else if (msg.type === "Error" || msg.type === "error") {
        const errMsg = msg.description || msg.message || JSON.stringify(msg);
        callbacks.onServerError(String(errMsg));
      }
    } catch (_e) {
      // Non-JSON message, ignore
    }
  };

  // The done signal is delivered when Deepgram closes the socket after
  // CloseStream — wire it via the actor's onclose handler below by stashing
  // the accumulated text on the handle.
  (ws as WebSocket & { __dgFinal?: () => string }).__dgFinal = () => accumulatedFinal;

  return {
    ws,
    sendPcm: (samples) => {
      if (ws.readyState !== WebSocket.OPEN) return;
      ws.send(samples);
    },
    endStream: () => {
      if (ws.readyState !== WebSocket.OPEN) return;
      ws.send(JSON.stringify({ type: "CloseStream" }));
    },
  };
}

// -- Callback actor: owns WebSocket + AudioContext + MediaStream + Worklet --

interface TranscriptionActorInput {
  dummy?: never;
}

const transcriptionActor = fromCallback<
  { type: "STOP" } | { type: "CANCEL" },
  TranscriptionActorInput,
  TranscriptionEvent
>(({ sendBack, receive }) => {
  let connection: ConnectionHandle | null = null;
  let audioContext: AudioContext | null = null;
  let stream: MediaStream | null = null;
  let workletNode: AudioWorkletNode | null = null;
  let disposed = false;
  let connectedFired = false;
  /**
   * PCM s16le chunks captured for this segment. Concatenated and WAV-wrapped
   * on TRANSCRIPTION_DONE so narration mode can re-send to the HQ pass.
   */
  const audioChunks: ArrayBuffer[] = [];

  function takeAudioBlob(): Blob | undefined {
    console.info(`[transcription-actor] takeAudioBlob called, audioChunks.length=${audioChunks.length}`);
    if (audioChunks.length === 0) return undefined;
    const blob = encodePcmChunksAsWav(audioChunks);
    audioChunks.length = 0;
    return blob;
  }

  function cleanup() {
    disposed = true;
    if (workletNode) {
      workletNode.disconnect();
      workletNode = null;
    }
    if (stream) {
      for (const track of stream.getTracks()) {
        track.stop();
      }
      stream = null;
    }
    if (audioContext) {
      audioContext.close().catch(() => {});
      audioContext = null;
    }
    if (connection) {
      const ws = connection.ws;
      if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
        ws.close();
      }
      connection = null;
    }
  }

  (async () => {
    try {
      const config = await trpcClient.transcription.config.query();
      if (disposed) { cleanup(); return; }
      const service = config.service;

      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (disposed) { cleanup(); return; }

      audioContext = new AudioContext();
      await audioContext.audioWorklet.addModule(pcmProcessorUrl);
      if (disposed) { cleanup(); return; }

      const source = audioContext.createMediaStreamSource(stream);
      workletNode = new AudioWorkletNode(audioContext, "pcm-processor");
      source.connect(workletNode);

      const callbacks: ServiceCallbacks = {
        onTextUpdate: (finalText, interimText) => {
          if (disposed) return;
          sendBack({ type: "TEXT_UPDATE", finalText, interimText });
        },
        onDone: (text) => {
          if (disposed) return;
          const audioBlob = takeAudioBlob();
          sendBack({ type: "TRANSCRIPTION_DONE", text, audioBlob });
        },
        onServerError: (message) => {
          if (disposed) return;
          sendBack({ type: "SERVER_ERROR", message });
        },
      };

      if (service === "deepgram") {
        connection = await startDeepgramConnection(callbacks);
      } else {
        // Default: voxtral (whisper has no realtime path; treat like voxtral)
        connection = startVoxtralConnection(callbacks);
      }
      if (disposed) { cleanup(); return; }

      const ws = connection.ws;
      ws.onopen = () => {
        if (disposed || connectedFired) return;
        connectedFired = true;
        sendBack({ type: "WS_CONNECTED" });
      };
      ws.onerror = () => {
        if (disposed) return;
        console.error("[realtime-transcription] WebSocket error");
        sendBack({ type: "WS_ERROR", message: "WebSocket connection error" });
      };
      ws.onclose = () => {
        if (disposed) return;
        // For Deepgram, the final transcript lives on the handle —
        // emit a TRANSCRIPTION_DONE so the machine can leave finalizing.
        const dgFinal = (ws as WebSocket & { __dgFinal?: () => string }).__dgFinal;
        if (dgFinal) {
          const audioBlob = takeAudioBlob();
          sendBack({ type: "TRANSCRIPTION_DONE", text: dgFinal(), audioBlob });
        } else {
          sendBack({ type: "WS_CLOSED" });
        }
      };

      let chunkCount = 0;
      workletNode.port.onmessage = (event) => {
        if (event.data.type === "pcm") {
          // Also keep a copy for the HQ pass (narration mode). Clone before
          // forwarding because the worklet transfers ownership of the
          // ArrayBuffer to the main thread.
          audioChunks.push(event.data.samples.slice(0));
          chunkCount += 1;
          if (chunkCount === 1 || chunkCount % 20 === 0) {
            console.info(`[transcription-actor] PCM chunk #${chunkCount} arrived, audioChunks.length=${audioChunks.length}`);
          }
          if (connection) connection.sendPcm(event.data.samples);
        }
      };
    } catch (err) {
      if (!disposed) {
        const msg = err instanceof Error ? err.message : "Failed to start recording";
        console.error("[realtime-transcription] Start error:", msg);
        sendBack({ type: "SETUP_ERROR", message: msg });
      }
      cleanup();
    }
  })();

  receive((event) => {
    if (event.type === "STOP") {
      // Stop capturing audio; tell the service we're done; keep WS open
      // so the final transcript can arrive.
      if (stream) {
        for (const track of stream.getTracks()) {
          track.stop();
        }
      }
      if (workletNode) {
        workletNode.disconnect();
        workletNode = null;
      }
      if (connection) {
        connection.endStream();
      }
    } else if (event.type === "CANCEL") {
      cleanup();
    }
  });

  return cleanup;
});

// -- Machine --

export const realtimeTranscriptionMachine = setup({
  types: {
    context: {} as {
      finalTranscript: string;
      interimTranscript: string;
      error: string | null;
      /** WAV blob of the segment's audio, set on TRANSCRIPTION_DONE.
       *  Consumed by narration mode for the HQ pass. */
      audioBlob: Blob | null;
    },
    events: {} as TranscriptionEvent,
  },
  actors: {
    transcriptionActor,
  },
  actions: {
    applyTextUpdate: assign(({ event }) => {
      if (event.type !== "TEXT_UPDATE") {
        throw new Error(`applyTextUpdate: unexpected event type "${event.type}"`);
      }
      return { finalTranscript: event.finalText, interimTranscript: event.interimText };
    }),
    clearTranscript: assign({ finalTranscript: "", interimTranscript: "", error: null, audioBlob: null }),
    setError: assign(({ event }) => {
      // setError is wired to WS_ERROR / SERVER_ERROR / SETUP_ERROR — all
      // share a `message: string` field. Narrow by checking the field
      // directly so the shared parent shape stays type-safe.
      if (!("message" in event) || typeof event.message !== "string") {
        throw new Error(`setError: event "${event.type}" has no message field`);
      }
      return { error: event.message };
    }),
    setFinalTranscript: assign(({ context, event }) => {
      if (event.type !== "TRANSCRIPTION_DONE") {
        // Wired only to the TRANSCRIPTION_DONE transition; anything else is
        // a configuration bug — surface it loudly rather than silently no-op.
        throw new Error(`setFinalTranscript: unexpected event type "${event.type}"`);
      }
      const final = event.text && event.text.length > 0 ? event.text : context.finalTranscript;
      return {
        finalTranscript: final,
        interimTranscript: "",
        audioBlob: event.audioBlob ?? context.audioBlob,
      };
    }),
    setTimeoutWarning: assign({
      error: "Transcription timed out — partial text preserved",
    }),
    sendStopToTranscriber: ({ system }) => {
      const transcriber = system.get("transcriber");
      if (transcriber) {
        transcriber.send({ type: "STOP" });
      }
    },
    playMicOffSound: () => {
      recordingStop.play();
    },
  },
  delays: {
    FINALIZE_TIMEOUT: 10000,
    SILENCE_TIMEOUT: 5 * 60 * 1000,
    MAX_DURATION: 15 * 60 * 1000,
  },
}).createMachine({
  id: "realtimeTranscription",
  initial: "idle",
  context: {
    finalTranscript: "",
    interimTranscript: "",
    error: null,
    audioBlob: null,
  },
  states: {
    idle: {
      on: {
        START: {
          target: "active",
          actions: "clearTranscript",
        },
        DISMISS_ERROR: {
          actions: assign({ error: null }),
        },
      },
    },
    active: {
      invoke: {
        id: "transcriber",
        src: "transcriptionActor",
        input: {},
      },
      after: {
        MAX_DURATION: {
          target: ".finalizing",
          actions: [
            () => {
              console.info("[realtime-transcription] Max duration reached — auto-stopping");
            },
            "sendStopToTranscriber",
            "playMicOffSound",
          ],
        },
      },
      on: {
        SERVER_ERROR: {
          target: "idle",
          actions: "setError",
        },
        WS_ERROR: {
          target: "idle",
          actions: "setError",
        },
        WS_CLOSED: "idle",
      },
      initial: "connecting",
      states: {
        connecting: {
          on: {
            WS_CONNECTED: "recording",
            SETUP_ERROR: {
              target: "#realtimeTranscription.idle",
              actions: "setError",
            },
            CANCEL: {
              target: "#realtimeTranscription.idle",
              actions: "clearTranscript",
            },
          },
        },
        recording: {
          after: {
            SILENCE_TIMEOUT: {
              target: "finalizing",
              actions: [
                () => {
                  console.info("[realtime-transcription] Silence timeout — auto-stopping");
                },
                "sendStopToTranscriber",
                "playMicOffSound",
              ],
            },
          },
          on: {
            TEXT_UPDATE: {
              target: "recording",
              reenter: true,
              actions: "applyTextUpdate",
            },
            STOP: {
              target: "finalizing",
              actions: "sendStopToTranscriber",
            },
            CANCEL: {
              target: "#realtimeTranscription.idle",
              actions: [
                "clearTranscript",
                ({ system }) => {
                  const transcriber = system.get("transcriber");
                  if (transcriber) {
                    transcriber.send({ type: "CANCEL" });
                  }
                },
              ],
            },
            TRANSCRIPTION_DONE: {
              target: "#realtimeTranscription.idle",
              actions: "setFinalTranscript",
            },
          },
        },
        finalizing: {
          after: {
            FINALIZE_TIMEOUT: {
              target: "#realtimeTranscription.idle",
              actions: [
                () => {
                  console.warn("[realtime-transcription] Timed out waiting for transcription.done");
                },
                "setTimeoutWarning",
              ],
            },
          },
          on: {
            TEXT_UPDATE: {
              actions: "applyTextUpdate",
            },
            TRANSCRIPTION_DONE: {
              target: "#realtimeTranscription.idle",
              actions: "setFinalTranscript",
            },
          },
        },
      },
    },
  },
});

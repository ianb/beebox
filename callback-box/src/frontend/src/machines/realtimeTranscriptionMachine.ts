/**
 * XState machine for realtime speech-to-text via WebSocket.
 *
 * States: idle → connecting → recording → finalizing → idle
 *
 * A callback actor owns all non-serializable resources (WebSocket,
 * AudioContext, MediaStream, AudioWorkletNode). The machine context
 * holds only serializable data: transcript, error.
 */

import { setup, assign, fromCallback } from "xstate";
import { getApiBase } from "../api";
import pcmProcessorUrl from "../audio/pcm-processor.worklet.js?url";

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
  | { type: "WS_CONNECTED" }
  | { type: "WS_ERROR"; message: string }
  | { type: "WS_CLOSED" }
  | { type: "TEXT_DELTA"; delta: string }
  | { type: "TRANSCRIPTION_DONE"; text?: string }
  | { type: "SERVER_ERROR"; message: string }
  | { type: "SETUP_ERROR"; message: string };

// -- Callback actor: owns WebSocket + AudioContext + MediaStream + Worklet --

interface TranscriptionActorInput {
  dummy?: never; // no input needed; resources created internally
}

const transcriptionActor = fromCallback<
  { type: "STOP" } | { type: "CANCEL" },
  TranscriptionActorInput,
  TranscriptionEvent
>(({ sendBack, receive }) => {
  let ws: WebSocket | null = null;
  let audioContext: AudioContext | null = null;
  let stream: MediaStream | null = null;
  let workletNode: AudioWorkletNode | null = null;
  let disposed = false;

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
    if (ws) {
      if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
        ws.close();
      }
      ws = null;
    }
  }

  // Start setup asynchronously
  (async () => {
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (disposed) { cleanup(); return; }

      audioContext = new AudioContext();
      await audioContext.audioWorklet.addModule(pcmProcessorUrl);
      if (disposed) { cleanup(); return; }

      const source = audioContext.createMediaStreamSource(stream);
      workletNode = new AudioWorkletNode(audioContext, "pcm-processor");
      source.connect(workletNode);

      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      const wsUrl = `${protocol}//${window.location.host}${getApiBase()}/chat/transcribe-ws`;
      ws = new WebSocket(wsUrl);

      ws.onopen = () => {
        if (!disposed) {
          console.log("[realtime-transcription] WebSocket connected");
          sendBack({ type: "WS_CONNECTED" });
        }
      };

      ws.onmessage = (event) => {
        if (disposed) return;
        try {
          const msg = JSON.parse(event.data);
          console.log("[realtime-transcription] Received:", msg.type || msg);

          if (msg.type === "transcription.text.delta") {
            const delta = msg.delta ?? msg.text ?? "";
            if (delta) {
              sendBack({ type: "TEXT_DELTA", delta });
            }
          } else if (msg.type === "transcription.done") {
            sendBack({ type: "TRANSCRIPTION_DONE", text: msg.text });
          } else if (msg.type === "error") {
            const errMsg = typeof msg.error === "object"
              ? (msg.error as { message?: string })?.message || JSON.stringify(msg.error)
              : msg.error || "Transcription error";
            sendBack({ type: "SERVER_ERROR", message: String(errMsg) });
          }
          // session.created, session.updated, transcription.segment, transcription.language — log only
        } catch {
          // Non-JSON message, ignore
        }
      };

      ws.onerror = () => {
        if (!disposed) {
          console.error("[realtime-transcription] WebSocket error");
          sendBack({ type: "WS_ERROR", message: "WebSocket connection error" });
        }
      };

      ws.onclose = (event) => {
        if (!disposed) {
          console.log("[realtime-transcription] WebSocket closed:", event.code, event.reason);
          sendBack({ type: "WS_CLOSED" });
        }
      };

      workletNode.port.onmessage = (event) => {
        if (event.data.type === "pcm" && ws && ws.readyState === WebSocket.OPEN) {
          const base64Audio = arrayBufferToBase64(event.data.samples);
          ws.send(JSON.stringify({
            type: "input_audio.append",
            audio: base64Audio,
          }));
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
      // Stop capturing audio, send end signal, keep WS open for final transcript
      if (stream) {
        for (const track of stream.getTracks()) {
          track.stop();
        }
      }
      if (workletNode) {
        workletNode.disconnect();
        workletNode = null;
      }
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "input_audio.end" }));
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
      transcript: string;
      error: string | null;
    },
    events: {} as TranscriptionEvent,
  },
  actors: {
    transcriptionActor,
  },
  actions: {
    appendDelta: assign(({ context, event }) => {
      const delta = (event as { type: "TEXT_DELTA"; delta: string }).delta;
      return { transcript: context.transcript + delta };
    }),
    clearTranscript: assign({ transcript: "", error: null }),
    setError: assign(({ event }) => {
      const msg = (event as { message: string }).message;
      return { error: msg };
    }),
    setFinalTranscript: assign(({ context, event }) => {
      const text = (event as { type: "TRANSCRIPTION_DONE"; text?: string }).text;
      return { transcript: text || context.transcript };
    }),
    eraseTranscript: assign({ transcript: "" }),
  },
  delays: {
    FINALIZE_TIMEOUT: 5000,
  },
}).createMachine({
  id: "realtimeTranscription",
  initial: "idle",
  context: {
    transcript: "",
    error: null,
  },
  states: {
    idle: {
      on: {
        START: {
          target: "active",
          actions: "clearTranscript",
        },
      },
    },
    active: {
      // Actor lives across connecting → recording → finalizing
      invoke: {
        id: "transcriber",
        src: "transcriptionActor",
        input: {},
      },
      initial: "connecting",
      on: {
        // Events that return to idle from any active substate
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
          on: {
            TEXT_DELTA: {
              actions: "appendDelta",
            },
            STOP: {
              target: "finalizing",
              actions: ({ system }) => {
                const transcriber = system.get("transcriber");
                if (transcriber) {
                  transcriber.send({ type: "STOP" });
                }
              },
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
              actions: () => {
                console.warn("[realtime-transcription] Timed out waiting for transcription.done");
              },
            },
          },
          on: {
            TEXT_DELTA: {
              actions: "appendDelta",
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

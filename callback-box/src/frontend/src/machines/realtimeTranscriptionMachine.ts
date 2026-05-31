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
 *   - "openai-realtime": Direct browser → OpenAI Realtime WebSocket using
 *                 a short-lived ephemeral client secret (`ek_...`) minted
 *                 by the backend against `gpt-realtime-whisper`. Audio
 *                 goes up as base64 PCM via `input_audio_buffer.append`.
 *                 Deltas (`conversation.item.input_audio_transcription
 *                 .delta`) update interim; `.completed` events append to
 *                 final.
 *
 * Both branches feed the same internal events:
 *   TEXT_UPDATE { finalText, interimText }
 *   TRANSCRIPTION_DONE { text }
 *
 * Machine context keeps finalTranscript and interimTranscript separate so
 * keyword spotting can run on finals only.
 */

import { setup, assign } from "xstate";
import { recordingStop } from "../lib/earcons";
import { transcriptionActor } from "./transcription-actor";
import type { TranscriptionEvent } from "./transcription-events";

export type TranscriptionState = "idle" | "connecting" | "recording" | "finalizing";

/**
 * A machine action was reached by an event it wasn't wired for (a config bug).
 * The detail names the action and the offending event.
 */
class MachineActionError extends Error {
  constructor(detail: string) {
    super(detail);
    this.name = "MachineActionError";
  }
}

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
        const message = `applyTextUpdate: unexpected event type "${event.type}"`;
        throw new MachineActionError(message);
      }
      return { finalTranscript: event.finalText, interimTranscript: event.interimText };
    }),
    clearTranscript: assign({ finalTranscript: "", interimTranscript: "", error: null, audioBlob: null }),
    setError: assign(({ event }) => {
      // setError is wired to WS_ERROR / SERVER_ERROR / SETUP_ERROR — all
      // share a `message: string` field. Narrow by checking the field
      // directly so the shared parent shape stays type-safe.
      if (!("message" in event) || typeof event.message !== "string") {
        const message = `setError: event "${event.type}" has no message field`;
        throw new MachineActionError(message);
      }
      return { error: event.message };
    }),
    setFinalTranscript: assign(({ context, event }) => {
      if (event.type !== "TRANSCRIPTION_DONE") {
        // Wired only to the TRANSCRIPTION_DONE transition; anything else is
        // a configuration bug — surface it loudly rather than silently no-op.
        const message = `setFinalTranscript: unexpected event type "${event.type}"`;
        throw new MachineActionError(message);
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
        // systemId makes the actor reachable via `system.get("transcriber")`
        // in actions. Without it, `id` is only scoped to the invocation
        // and system.get returns null — which silently broke
        // sendStopToTranscriber (pre-existing; never noticed because the
        // old voice flow used CANCEL which exits `active` and tears down
        // the actor that way).
        systemId: "transcriber",
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

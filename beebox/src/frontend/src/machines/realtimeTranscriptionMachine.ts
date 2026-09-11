/**
 * XState machine for realtime speech-to-text.
 *
 * States: idle → connecting → recordingLocal ⇄ recording → finalizing → idle
 *
 * The recording is independent of the live socket
 * (`docs/plans/resilient-voice-recording.md`, Track 3). `connecting` covers
 * only mic permission and worklet startup; once the mic is live (`MIC_LIVE`)
 * every frame stages to the box, and the live transcription socket is a
 * preview that may come and go:
 *
 *   - `recordingLocal`: audio is recording and staging, no live socket (not
 *     yet open, dropped, or given up). No live text, so no spoken commands
 *     and no silence timeout; STOP and CANCEL still work.
 *   - `recording`: live text flowing. A network drop returns to
 *     `recordingLocal` — nothing is lost, so nothing bounds it.
 *   - `reconnecting`: the microphone was lost. No audio flows, so
 *     `RECONNECT_WINDOW` bounds it and expiry ends the segment.
 *
 * Every end of a segment after `MIC_LIVE` goes through `TRANSCRIPTION_DONE`,
 * which carries the recording's sealing obligation (`PendingRecording`) —
 * except CANCEL, which tells the actor to discard it.
 *
 * The callback actor branches by transcription service (configured per box):
 * "voxtral" (WS proxy through the backend), "deepgram" (direct, temp key),
 * "openai-realtime" (direct, ephemeral secret). All feed the same events:
 *   TEXT_UPDATE { finalText, interimText }
 *   TRANSCRIPTION_DONE { text?, words?, recording }
 *
 * Machine context keeps finalTranscript and interimTranscript separate so
 * keyword spotting can run on finals only.
 *
 * This module does not import the real actor (it pulls in the audio worklet
 * and the network): `realtime-transcription-live.ts` provides it, and a
 * doctest provides a fake.
 */

import { setup, assign, emit, fromCallback, not, stateIn, type SnapshotFrom } from "xstate";
import { recordingStop, recordingError, recordingDropped, recordingResumed } from "../lib/audio/earcons";
import type { PendingRecording } from "../lib/audio/voice-stager";
import {
  MachineActionError,
  type FinalWord,
  type MaxDurationReached,
  type TranscriptionActorCommand,
  type TranscriptionActorInput,
  type TranscriptionEvent,
  type TranscriptionState,
} from "./transcription-events";

/**
 * Placeholder for `transcriptionActor`, typed like the real one. Reaching it
 * means the machine ran without `.provide()` — a wiring bug.
 */
const unprovidedTranscriptionActor = fromCallback<TranscriptionActorCommand, TranscriptionActorInput, TranscriptionEvent>(() => {
  const message = "transcriptionActor was not provided; use liveTranscriptionMachine";
  throw new MachineActionError(message);
});

function requireEvent<T extends TranscriptionEvent["type"]>(
  event: TranscriptionEvent,
  opts: { type: T; action: string },
): Extract<TranscriptionEvent, { type: T }> {
  // Narrowing through a type-predicate helper keeps the action bodies cast-free.
  const matches = (e: TranscriptionEvent): e is Extract<TranscriptionEvent, { type: T }> => e.type === opts.type;
  if (!matches(event)) {
    const message = `${opts.action}: unexpected event type "${event.type}"`;
    throw new MachineActionError(message);
  }
  return event;
}

const EMPTY_SEGMENT = {
  finalTranscript: "",
  interimTranscript: "",
  finalWords: null,
  error: null,
  recording: null,
} as const;

// -- Machine --

export const realtimeTranscriptionMachine = setup({
  types: {
    context: {} as {
      finalTranscript: string;
      interimTranscript: string;
      /**
       * Finalized words with confidence, aligned with finalTranscript —
       * updated in the same transitions so a reconnect can never drift the
       * two out of step (docs/plans/transcript-confidence.md). `null` means
       * no confidence data has been captured for this segment
       * (Voxtral/OpenAI realtime, or nothing finalized yet) — distinct from
       * `[]` (Deepgram captured words but none exist yet/anymore).
       */
      finalWords: FinalWord[] | null;
      error: string | null;
      /**
       * The ended segment's staged recording, set on TRANSCRIPTION_DONE. The
       * hook hands it to a submit, or seals it with `hq: null`.
       */
      recording: PendingRecording | null;
      /** Chat the segment started in, passed to the actor as input. */
      targetSessionId: string | null;
    },
    events: {} as TranscriptionEvent,
    emitted: {} as MaxDurationReached,
  },
  actors: {
    transcriptionActor: unprovidedTranscriptionActor,
  },
  guards: {
    micDrop: ({ event }) => event.type === "CONNECTION_DEGRADED" && event.cause === "microphone",
  },
  actions: {
    applyTextUpdate: assign(({ event }) => {
      const e = requireEvent(event, { type: "TEXT_UPDATE", action: "applyTextUpdate" });
      return { finalTranscript: e.finalText, interimTranscript: e.interimText, finalWords: e.finalWords };
    }),
    beginSegment: assign(({ event }) => {
      const e = requireEvent(event, { type: "START", action: "beginSegment" });
      return { ...EMPTY_SEGMENT, targetSessionId: e.targetSessionId };
    }),
    clearTranscript: assign(EMPTY_SEGMENT),
    setError: assign(({ event }) => {
      // Wired to WS_ERROR / SERVER_ERROR / SETUP_ERROR — all carry `message`.
      if (!("message" in event) || typeof event.message !== "string") {
        const message = `setError: event "${event.type}" has no message field`;
        throw new MachineActionError(message);
      }
      return { error: event.message };
    }),
    setFinalTranscript: assign(({ context, event }) => {
      const e = requireEvent(event, { type: "TRANSCRIPTION_DONE", action: "setFinalTranscript" });
      // e.words is decided by the SAME condition as e.text (both computed
      // together by the actor), so a provided text always brings its own word
      // list (possibly empty), and an absent/empty text keeps both.
      const textProvided = e.text !== undefined && e.text.length > 0;
      return {
        finalTranscript: textProvided ? e.text : context.finalTranscript,
        finalWords: textProvided ? (e.words ?? null) : context.finalWords,
        interimTranscript: "",
        recording: e.recording,
      };
    }),
    setTimeoutWarning: assign({ error: "Transcription timed out — partial text preserved" }),
    setMicInterrupted: assign({ error: "Microphone interrupted — recovering…" }),
    setMicDropEnded: assign({ error: "Recording stopped — the microphone was taken away" }),
    clearError: assign({ error: null }),
    playRecordingDropped: () => {
      recordingDropped.play();
    },
    playRecordingResumed: () => {
      recordingResumed.play();
    },
    setStartFailedError: assign({ error: "Recording didn't start. Please try again." }),
    sendStopToTranscriber: ({ system }) => {
      // systemId (below) makes the actor reachable here; `id` alone is
      // invocation-scoped and system.get would return undefined.
      system.get("transcriber")?.send({ type: "STOP" });
    },
    sendCancelToTranscriber: ({ system }) => {
      system.get("transcriber")?.send({ type: "CANCEL" });
    },
    playMicOffSound: () => {
      recordingStop.play();
    },
    playStartFailedSound: () => {
      recordingError.play();
    },
    emitMaxDurationReached: emit({ type: "maxDurationReached" }),
  },
  delays: {
    FINALIZE_TIMEOUT: 10000,
    SILENCE_TIMEOUT: 5 * 60 * 1000,
    // Memory no longer grows with the segment (audio stages to the box), so
    // a conversation is sent in hour-long parts rather than stopping.
    MAX_DURATION: 60 * 60 * 1000,
    // How long the microphone may stay lost before the segment ends. Bounds
    // only a mic loss: a network drop keeps recording in `recordingLocal`.
    RECONNECT_WINDOW: 8000,
    // How long mic permission + worklet startup may take before the start
    // counts as failed. Generous enough not to fire while a first-time
    // permission dialog is still open. The socket is not part of it.
    CONNECT_TIMEOUT: 8000,
  },
}).createMachine({
  id: "realtimeTranscription",
  initial: "idle",
  context: { ...EMPTY_SEGMENT, targetSessionId: null },
  states: {
    idle: {
      on: {
        START: { target: "active", actions: "beginSegment" },
        DISMISS_ERROR: { actions: assign({ error: null }) },
      },
    },
    active: {
      invoke: {
        id: "transcriber",
        systemId: "transcriber",
        src: "transcriptionActor",
        input: ({ context }) => ({ targetSessionId: context.targetSessionId }),
      },
      after: {
        // The segment is SUBMITTED, not folded: the emitted event lets the
        // hook park a send (the path a spoken "send" takes) before STOP's
        // TRANSCRIPTION_DONE lands, and the send re-arms the mic.
        MAX_DURATION: {
          guard: not(stateIn({ active: "finalizing" })),
          target: ".finalizing",
          actions: [
            () => console.info("[realtime-transcription] Max duration reached — submitting the segment"),
            "emitMaxDurationReached",
            "sendStopToTranscriber",
            "playMicOffSound",
          ],
        },
      },
      initial: "connecting",
      states: {
        connecting: {
          // Only mic permission + worklet startup happen here; nothing has
          // been recorded, so every failure is a plain failed start.
          after: {
            CONNECT_TIMEOUT: {
              target: "#realtimeTranscription.idle",
              actions: [
                () => console.warn("[realtime-transcription] Recording didn't start within timeout"),
                "setStartFailedError",
                "playStartFailedSound",
              ],
            },
          },
          on: {
            MIC_LIVE: "recordingLocal",
            SETUP_ERROR: {
              target: "#realtimeTranscription.idle",
              actions: ["setError", "playStartFailedSound"],
            },
            CANCEL: "cancelling",
          },
        },
        recordingLocal: {
          // No SILENCE_TIMEOUT: no live text arrives to reset it (MAX_DURATION
          // still bounds the segment). Errors about the live socket keep the
          // recording going; the actor has already stopped or kept retrying.
          on: {
            WS_CONNECTED: "recording",
            CONNECTION_RESTORED: {
              target: "recording",
              actions: ["playRecordingResumed", "clearError"],
            },
            CONNECTION_DEGRADED: {
              guard: "micDrop",
              target: "reconnecting",
              actions: ["playRecordingDropped", "setMicInterrupted"],
            },
            WS_ERROR: { actions: "setError" },
            SERVER_ERROR: { actions: "setError" },
            TEXT_UPDATE: { actions: "applyTextUpdate" },
            STOP: { target: "finalizing", actions: "sendStopToTranscriber" },
            CANCEL: "cancelling",
            TRANSCRIPTION_DONE: { target: "#realtimeTranscription.idle", actions: "setFinalTranscript" },
          },
        },
        recording: {
          after: {
            SILENCE_TIMEOUT: {
              target: "finalizing",
              actions: [
                () => console.info("[realtime-transcription] Silence timeout — auto-stopping"),
                "sendStopToTranscriber",
                "playMicOffSound",
              ],
            },
          },
          on: {
            TEXT_UPDATE: { target: "recording", reenter: true, actions: "applyTextUpdate" },
            CONNECTION_DEGRADED: [
              { guard: "micDrop", target: "reconnecting", actions: ["playRecordingDropped", "setMicInterrupted"] },
              // Network: the audio keeps staging, only live text pauses.
              { target: "recordingLocal", actions: "playRecordingDropped" },
            ],
            // A socket that can't be fixed by reconnecting (1003/1008 close,
            // or a service-level error) ends live text for this segment, not
            // the recording.
            WS_ERROR: { target: "recordingLocal", actions: ["setError", "playRecordingDropped"] },
            SERVER_ERROR: { target: "recordingLocal", actions: ["setError", "playRecordingDropped"] },
            WS_CLOSED: "recordingLocal",
            STOP: { target: "finalizing", actions: "sendStopToTranscriber" },
            CANCEL: "cancelling",
            TRANSCRIPTION_DONE: { target: "#realtimeTranscription.idle", actions: "setFinalTranscript" },
          },
        },
        reconnecting: {
          // Microphone recovery only. No audio flows while the mic is gone,
          // so the window bounds it; on expiry the segment ends with what
          // was captured (TRANSCRIPTION_DONE carries the recording).
          after: {
            RECONNECT_WINDOW: {
              target: "finalizing",
              actions: [
                () => console.warn("[realtime-transcription] Microphone not recovered — ending segment"),
                "setMicDropEnded",
                "sendStopToTranscriber",
                "playMicOffSound",
              ],
            },
          },
          on: {
            // The mic is back and so is the live socket…
            CONNECTION_RESTORED: {
              target: "recording",
              actions: ["playRecordingResumed", "clearError"],
            },
            // …or the mic is back but the socket is not.
            MIC_LIVE: {
              target: "recordingLocal",
              actions: ["playRecordingResumed", "clearError"],
            },
            WS_ERROR: { actions: "setError" },
            SERVER_ERROR: { actions: "setError" },
            TEXT_UPDATE: { actions: "applyTextUpdate" },
            STOP: { target: "finalizing", actions: "sendStopToTranscriber" },
            CANCEL: "cancelling",
            TRANSCRIPTION_DONE: { target: "#realtimeTranscription.idle", actions: "setFinalTranscript" },
          },
        },
        cancelling: {
          // Transient. A transition's own actions run after its exits — by
          // then leaving `active` has already stopped the transcriber, and a
          // CANCEL sent from the transition never arrives (the actor would
          // keep the audio as an unclaimed recording). Entering this substate
          // tells the actor to discard while it is still running.
          entry: "sendCancelToTranscriber",
          always: { target: "#realtimeTranscription.idle", actions: "clearTranscript" },
        },
        finalizing: {
          after: {
            FINALIZE_TIMEOUT: {
              target: "#realtimeTranscription.idle",
              actions: [
                () => console.warn("[realtime-transcription] Timed out waiting for transcription.done"),
                "setTimeoutWarning",
              ],
            },
          },
          on: {
            TEXT_UPDATE: { actions: "applyTextUpdate" },
            TRANSCRIPTION_DONE: { target: "#realtimeTranscription.idle", actions: "setFinalTranscript" },
          },
        },
      },
    },
  },
});

export type RealtimeTranscriptionSnapshot = SnapshotFrom<typeof realtimeTranscriptionMachine>;

const ACTIVE_STATES = ["connecting", "recordingLocal", "recording", "reconnecting", "finalizing"] as const;

/** Map the machine's nested state to the flat `TranscriptionState` the UI uses. */
export function transcriptionStateOf(snapshot: RealtimeTranscriptionSnapshot): TranscriptionState {
  return ACTIVE_STATES.find((s) => snapshot.matches({ active: s })) ?? "idle";
}

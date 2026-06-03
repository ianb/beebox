/**
 * Orchestration machine for the chat composer's modal input state.
 *
 * Background: the composer's behaviour was previously an emergent cross-product
 * of three independent machines (`chatMachine`, `realtimeTranscriptionMachine`,
 * `speechPlaybackMachine`) glued by a pile of `useState`/`useRef` flags and
 * `useEffect` bodies in `InteractiveChat-voice.ts` / `-speech.ts`. The single
 * worst offender was `voicePaused`: a boolean straining to encode "the mic was
 * paused *for* this speech, so resume it when playback ends." See
 * `docs/composer-input-machine.md` for the full design rationale.
 *
 * This machine makes that the explicit thing it is. The `voice` region is one
 * exclusive state chart — you cannot dictate while TTS plays, because TTS
 * *pauses* the mic — so `isTranscribing` / `speechPlaying` / `voicePaused`
 * collapse into four states: `idle | dictating | committing | speaking |
 * pausedForSpeech`. `pausedForSpeech` vs `speaking` is the whole of what
 * `voicePaused` meant: both have TTS playing; only the former resumes the mic.
 *
 * The machine is an *orchestrator*, not a re-implementation: the real mic and
 * TTS still live in their own machines (driven by `useRealtimeTranscription` /
 * `useSpeechPlayback`). This machine owns the *decisions* and commands those
 * devices through named action seams (`startMic`, `cancelMic`, `playSpeech`,
 * `stopSpeech`, `markPlayed`, `commitSend`) that the wiring layer provides via
 * `.provide()`. Guards are pure functions of context, so the entire decision
 * logic is unit-testable with no React (see `composerMachine.doctest.md`).
 */

import { setup, assign } from "xstate";
import type { SpeechSegment } from "../lib/speech-parsing";

export interface ComposerContext {
  /** Narration mode (HQ transcription on send, silent responses). Mirrored from the model hook. */
  narration: boolean;
  /** Speech muted. Mirrored from the mute hook; gates whether queued TTS ever plays. */
  muted: boolean;
  /** A voice conversation is active — restart the mic after the agent finishes speaking. */
  turnTaking: boolean;
  /** Whether the live transcript currently has text. Used to suppress TTS while the user is mid-utterance. */
  transcriptNonEmpty: boolean;
  /** Realtime text awaiting its HQ pass (narration). Rendered as a pending bubble; null when none. */
  pendingHqText: string | null;
}

export type ComposerEvent =
  // --- user intents from the composer buttons ---
  | { type: "START_DICTATION" }
  | { type: "STOP_DICTATION" }
  | { type: "STOP_SPEECH" }
  | { type: "RESUME" }
  // --- signals from the transcription device ---
  | { type: "KEYWORD_SEND"; text: string; audioBlob: Blob | null }
  | { type: "MIC_OFF" }
  | { type: "TRANSCRIPT"; nonEmpty: boolean }
  // --- signals from the playback device ---
  | { type: "SPEECH_QUEUED"; messageId: string; segments: SpeechSegment[]; baseIndex: number }
  | { type: "SPEECH_DONE" }
  // --- the narration HQ round-trip ---
  | { type: "START_HQ"; text: string }
  | { type: "HQ_DONE" }
  // --- mirrored settings + send ---
  | { type: "SET_NARRATION"; value: boolean }
  | { type: "SET_MUTE"; value: boolean }
  | { type: "MESSAGE_SENT" }
  // --- mobile keyboard shell ---
  | { type: "OPEN_KEYBOARD" }
  | { type: "CLOSE_KEYBOARD" }
  | { type: "TOGGLE_LOCK" };

export const composerMachine = setup({
  types: {
    context: {} as ComposerContext,
    events: {} as ComposerEvent,
    input: {} as Partial<Pick<ComposerContext, "narration" | "muted">>,
  },
  guards: {
    isMuted: ({ context }) => context.muted,
    transcriptNonEmpty: ({ context }) => context.transcriptNonEmpty,
    turnTaking: ({ context }) => context.turnTaking,
  },
  actions: {
    // Pure context assigns live here; side-effecting device commands are
    // declared as no-op stubs and overridden at wiring time via `.provide()`.
    beginTurn: assign({ turnTaking: true }),
    endTurn: assign({ turnTaking: false }),
    setNarration: assign(({ event }) => ({ narration: event.type === "SET_NARRATION" ? event.value : false })),
    setMute: assign(({ event }) => ({ muted: event.type === "SET_MUTE" ? event.value : false })),
    setTranscript: assign(({ event }) => ({ transcriptNonEmpty: event.type === "TRANSCRIPT" ? event.nonEmpty : false })),
    setPendingHq: assign(({ event }) => ({ pendingHqText: event.type === "START_HQ" ? event.text : null })),
    clearPendingHq: assign({ pendingHqText: null }),

    // --- device-command seams (provided by the wiring; no-ops here) ---
    /** Begin / resume a recording segment on the transcription device. */
    startMic: () => {},
    /** Tear down the current recording segment without finalizing. */
    cancelMic: () => {},
    /** Enqueue + play the segments carried on the current SPEECH_QUEUED event. */
    playSpeech: () => {},
    /** Stop TTS playback immediately. */
    stopSpeech: () => {},
    /** Mark the current SPEECH_QUEUED message as played without playing it (suppressed/muted). */
    markPlayed: () => {},
    /** Commit the KEYWORD_SEND utterance: build + dispatch the message, kick off the HQ pass in narration mode. */
    commitSend: () => {},
  },
}).createMachine({
  id: "composer",
  type: "parallel",
  context: ({ input }) => ({
    narration: input.narration ?? false,
    muted: input.muted ?? false,
    turnTaking: false,
    transcriptNonEmpty: false,
    pendingHqText: null,
  }),
  // Internal (target-less) root handlers: mirror settings + transcript. None
  // of these exit a region. (MESSAGE_SENT's turn-reset lives on the `voice`
  // region instead, so it isn't shadowed when the `keyboard` region also
  // handles the same event — an ancestor `on` loses to a descendant one.)
  on: {
    SET_NARRATION: { actions: "setNarration" },
    SET_MUTE: { actions: "setMute" },
    TRANSCRIPT: { actions: "setTranscript" },
  },
  states: {
    voice: {
      initial: "idle",
      // Region-level internal handler: any send ends the turn, in every
      // voice substate, without exiting it. Sibling to the keyboard region's
      // own MESSAGE_SENT transition, so both run.
      on: {
        MESSAGE_SENT: { actions: "endTurn" },
      },
      states: {
        idle: {
          on: {
            START_DICTATION: { target: "dictating", actions: ["beginTurn", "startMic"] },
            SPEECH_QUEUED: [
              { guard: "isMuted", actions: "markPlayed" },
              { target: "speaking", actions: "playSpeech" },
            ],
          },
        },
        dictating: {
          on: {
            KEYWORD_SEND: { target: "committing" },
            STOP_DICTATION: { target: "idle", actions: "cancelMic" },
            MIC_OFF: { target: "idle" },
            SPEECH_QUEUED: [
              { guard: "isMuted", actions: "markPlayed" },
              { guard: "transcriptNonEmpty", actions: "markPlayed" }, // suppress: don't talk over the user
              { target: "pausedForSpeech", actions: ["cancelMic", "playSpeech"] },
            ],
          },
        },
        // Transient: dispatch the utterance, then restart the mic so the user
        // can keep talking. `commitSend` reads the KEYWORD_SEND event that
        // brought us here (text + audioBlob) and, in narration mode, raises
        // START_HQ for the HQ round-trip.
        committing: {
          entry: "commitSend",
          always: { target: "dictating", actions: "startMic" },
        },
        speaking: {
          on: {
            SPEECH_DONE: [
              { guard: "turnTaking", target: "dictating", actions: "startMic" },
              { target: "idle" },
            ],
            STOP_SPEECH: { target: "idle", actions: "stopSpeech" },
            START_DICTATION: { target: "dictating", actions: ["stopSpeech", "beginTurn", "startMic"] },
            SPEECH_QUEUED: { actions: "playSpeech" }, // enqueue more segments, stay speaking
          },
        },
        pausedForSpeech: {
          on: {
            SPEECH_DONE: { target: "dictating", actions: "startMic" }, // auto-resume the mic
            RESUME: { target: "dictating", actions: ["stopSpeech", "startMic"] },
            STOP_SPEECH: { target: "dictating", actions: ["stopSpeech", "startMic"] },
            SPEECH_QUEUED: { actions: "playSpeech" },
          },
        },
      },
    },
    hq: {
      initial: "idle",
      states: {
        idle: { on: { START_HQ: { target: "inFlight", actions: "setPendingHq" } } },
        inFlight: { on: { HQ_DONE: { target: "idle", actions: "clearPendingHq" } } },
      },
    },
    keyboard: {
      initial: "closed",
      states: {
        closed: { on: { OPEN_KEYBOARD: "open" } },
        open: {
          initial: "unlocked",
          on: { CLOSE_KEYBOARD: "closed" },
          states: {
            unlocked: {
              on: {
                TOGGLE_LOCK: "locked",
                MESSAGE_SENT: "#composer.keyboard.closed", // auto-close after send
              },
            },
            locked: {
              on: { TOGGLE_LOCK: "unlocked" }, // stays open after send
            },
          },
        },
      },
    },
  },
});
